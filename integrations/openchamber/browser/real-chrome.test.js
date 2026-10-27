import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './launch.js';
import { attachPage } from './cdp-page.js';
import { createMokaDriverCore } from './driver.js';
import { BrowserLaunchError } from './chrome.js';
import { normalizeNewlines } from './url-policy.js';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CACHE_ROOT = path.join(PROJECT_ROOT, '.cache');
const ENABLED = process.env.MOKA_REAL_CHROME_TEST === '1';

const FIXTURE_HTML = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>虚构 Moka 表单</title></head>
<body>
  <section id="basic-section">
    <h2>基本信息</h2>
    <label for="name">姓名</label>
    <input id="name" name="name" maxlength="20">
    <label for="phone">手机号码</label>
    <input id="phone" name="phone" type="tel">
    <label for="email">电子邮箱</label>
    <input id="email" name="email" type="email">
    <label for="degree">学历</label>
    <select id="degree" name="degree">
      <option value="0">请选择</option>
      <option value="b">本科</option>
      <option value="m">硕士</option>
    </select>
    <input type="file" name="resume">
    <button type="submit">提交</button>
  </section>

  <section id="login-section">
    <h2>登录</h2>
    <label for="password">密码</label>
    <input id="password" name="password" type="password">
  </section>

  <section id="internship-section">
    <h2>实习经历</h2>
    <div class="exp-card">
      <h3>甲公司</h3>
      <label>公司名称<input name="company_1"></label>
      <label>实习岗位<input name="role_1"></label>
      <label>实习内容<textarea name="content_1"></textarea></label>
    </div>
    <div class="exp-card">
      <h3>乙公司</h3>
      <label>公司名称<input name="company_2"></label>
      <label>实习岗位<input name="role_2"></label>
      <label>实习内容<textarea name="content_2"></textarea></label>
    </div>
  </section>
</body>
</html>`;

function pageValuesExpression() {
  return `JSON.stringify({
    name: document.querySelector('#name').value,
    phone: document.querySelector('#phone').value,
    email: document.querySelector('#email').value,
    degree: document.querySelector('#degree').value,
    company1: document.querySelector('[name="company_1"]').value,
    company2: document.querySelector('[name="company_2"]').value,
    content2: document.querySelector('[name="content_2"]').value
  })`;
}

async function readPageValues(cdp, sessionId) {
  const response = await cdp.send('Runtime.evaluate', {
    expression: pageValuesExpression(),
    returnByValue: true,
  }, { sessionId, timeoutMs: 3000 });
  return JSON.parse(response.result.value);
}

test('真实 Chrome headless：虚构 Moka 表单的观察/写入/读回', {
  skip: ENABLED ? false : '设置 MOKA_REAL_CHROME_TEST=1 才运行本机 Chrome 虚构页面测试。',
  timeout: 60000,
}, async (t) => {
  fs.mkdirSync(CACHE_ROOT, { recursive: true });
  const fixtureRoot = fs.mkdtempSync(path.join(CACHE_ROOT, 'moka-real-chrome-'));
  let launched = null;
  let unsubscribe = null;
  let core = null;
  try {
    try {
      launched = await launchBrowser({
        projectDirectory: fixtureRoot,
        browserPreference: 'chrome',
        instanceId: 'fixture',
        headless: true,
        startupTimeoutMs: 20000,
      });
    } catch (error) {
      if (error instanceof BrowserLaunchError && error.code === 'BROWSER_NOT_FOUND') {
        t.skip('本机没有白名单内的 Chrome。');
        return;
      }
      throw error;
    }

    const { page, sessionId } = await attachPage(launched.cdp, { timeoutMs: 15000 });
    await launched.cdp.send('Fetch.enable', {
      patterns: [{ urlPattern: 'https://fixture.mokahr.com/*', requestStage: 'Request' }],
    }, { sessionId, timeoutMs: 5000 });

    let intercepted = false;
    unsubscribe = launched.cdp.onEvent(async (event) => {
      if (event.method !== 'Fetch.requestPaused' || event.sessionId !== sessionId) return;
      const url = event.params?.request?.url || '';
      if (!url.startsWith('https://fixture.mokahr.com/')) return;
      intercepted = true;
      await launched.cdp.send('Fetch.fulfillRequest', {
        requestId: event.params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'content-type', value: 'text/html; charset=utf-8' }],
        body: Buffer.from(FIXTURE_HTML, 'utf8').toString('base64'),
      }, { sessionId, timeoutMs: 5000 });
    });

    await page.navigate('https://fixture.mokahr.com/acopilot-fixture', { navigationTimeoutMs: 20000 });
    assert.equal(intercepted, true, 'Fetch 拦截应阻止任何真实网络请求');
    core = createMokaDriverCore({
      page,
      now: () => new Date('2026-10-26T00:00:00.000Z'),
      closeImpl: async () => launched.close(),
    });

    const observed = await core.observe();
    assert.equal(observed.ok, true);
    assert.equal(observed.snapshot.pageUrl, 'https://fixture.mokahr.com/acopilot-fixture');
    const labels = observed.snapshot.controls.map((control) => control.label);
    t.diagnostic(`observed labels: ${labels.join(' | ')}`);
    assert.ok(labels.includes('姓名'));
    assert.ok(labels.includes('手机号码'));
    assert.ok(labels.includes('电子邮箱'));
    assert.ok(labels.includes('学历'));
    assert.ok(!labels.includes('密码'));
    assert.ok(!labels.includes('提交'));

    const companies = observed.snapshot.controls.filter((control) => control.label === '公司名称');
    assert.equal(companies.length, 2);
    assert.ok(companies[0].region.entityId);
    assert.ok(companies[1].region.entityId);
    assert.notEqual(companies[0].region.entityId, companies[1].region.entityId);
    const contents = observed.snapshot.controls.filter((control) => control.label === '实习内容');
    assert.equal(contents.length, 2);

    const byLabel = (label) => observed.snapshot.controls.find((control) => control.label === label);
    const name = byLabel('姓名');
    const phone = byLabel('手机号码');
    const email = byLabel('电子邮箱');
    const degree = byLabel('学历');
    const plan = {
      schemaVersion: 'application-copilot.moka-fill-plan.v1',
      snapshotId: observed.snapshot.id,
      pageUrl: observed.snapshot.pageUrl,
      targetId: observed.snapshot.targetId,
      items: [
        {
          controlRef: name.ref,
          factId: 'fixture-name',
          factVersion: 1,
          confirmed: true,
          confirmedVersion: 1,
          originalText: '张三',
          text: '张三',
          regionType: name.region.type,
          regionEntityId: name.region.entityId,
          expectedLabel: name.label,
          fieldKey: 'basic.name',
        },
        {
          controlRef: phone.ref,
          factId: 'fixture-phone',
          factVersion: 1,
          confirmed: true,
          confirmedVersion: 1,
          originalText: '13800000000',
          text: '13800000000',
          regionType: phone.region.type,
          regionEntityId: phone.region.entityId,
          expectedLabel: phone.label,
          fieldKey: 'basic.phone',
        },
        {
          controlRef: email.ref,
          factId: 'fixture-email',
          factVersion: 1,
          confirmed: true,
          confirmedVersion: 1,
          originalText: 'fixture@example.invalid',
          text: 'fixture@example.invalid',
          regionType: email.region.type,
          regionEntityId: email.region.entityId,
          expectedLabel: email.label,
          fieldKey: 'basic.email',
        },
        {
          controlRef: degree.ref,
          factId: 'fixture-degree',
          factVersion: 1,
          confirmed: true,
          confirmedVersion: 1,
          originalText: '硕士',
          text: '硕士',
          regionType: degree.region.type,
          regionEntityId: degree.region.entityId,
          expectedLabel: degree.label,
          fieldKey: 'education.degree',
          optionValue: 'm',
          optionLabel: '硕士',
        },
        {
          controlRef: companies[1].ref,
          factId: 'fixture-company-2',
          factVersion: 1,
          confirmed: true,
          confirmedVersion: 1,
          originalText: '乙公司',
          text: '乙公司',
          regionType: companies[1].region.type,
          regionEntityId: companies[1].region.entityId,
          expectedLabel: companies[1].label,
          fieldKey: 'internship.company',
        },
        {
          controlRef: contents[1].ref,
          factId: 'fixture-content-2',
          factVersion: 1,
          confirmed: true,
          confirmedVersion: 1,
          originalText: '第一段\r\n\r\n第二段',
          text: normalizeNewlines('第一段\r\n\r\n第二段'),
          regionType: contents[1].region.type,
          regionEntityId: contents[1].region.entityId,
          expectedLabel: contents[1].label,
          fieldKey: 'internship.content',
        },
      ],
    };

    const filled = await core.fillConfirmedPlan(plan);
    t.diagnostic(`fill issues: ${JSON.stringify(filled.issues)}`);
    assert.equal(filled.ok, true, JSON.stringify(filled.issues));
    assert.ok(filled.results.every((result) => result.status === 'filled' || result.status === 'already_set'));

    const values = await readPageValues(launched.cdp, sessionId);
    assert.equal(values.name, '张三');
    assert.equal(values.phone, '13800000000');
    assert.equal(values.email, 'fixture@example.invalid');
    assert.equal(values.degree, 'm');
    assert.equal(values.company1, '');
    assert.equal(values.company2, '乙公司');
    assert.equal(values.content2, '第一段\n\n第二段');

    const readback = await core.readbackApprovedPlan(plan);
    assert.equal(readback.ok, true);
    const readbackByControl = new Map(readback.fields.map((field) => [field.controlId, field.readbackValue]));
    assert.equal(readbackByControl.get(name.ref), '张三');
    assert.equal(readbackByControl.get(phone.ref), '13800000000');
    assert.equal(readbackByControl.get(email.ref), 'fixture@example.invalid');
    assert.equal(readbackByControl.get(degree.ref), '硕士');
    assert.equal(readbackByControl.get(companies[1].ref), '乙公司');
    assert.equal(readbackByControl.get(contents[1].ref), '第一段\n\n第二段');
    assert.equal(readbackByControl.get(companies[0].ref), undefined);

    const crossPlan = {
      ...plan,
      items: [{
        ...plan.items[4],
        controlRef: companies[0].ref,
        regionEntityId: companies[1].region.entityId,
      }],
    };
    const cross = await core.fillConfirmedPlan(crossPlan);
    assert.equal(cross.ok, false);
    assert.equal(cross.results[0].code, 'REGION_MISMATCH');
    const afterCross = await readPageValues(launched.cdp, sessionId);
    assert.equal(afterCross.company1, '');

    // 观察后用户或其他脚本修改了控件值：页面桥必须比对签名并拒绝覆盖。
    const observedAgain = await core.observe();
    assert.equal(observedAgain.ok, true);
    const companyOne = observedAgain.snapshot.controls.filter((control) => control.label === '公司名称')[0];
    await launched.cdp.send('Runtime.evaluate', {
      expression: 'document.querySelector(\'[name="company_1"]\').value = "本人已填"; true',
      returnByValue: true,
    }, { sessionId, timeoutMs: 3000 });
    const changedPlan = {
      schemaVersion: 'application-copilot.moka-fill-plan.v1',
      snapshotId: observedAgain.snapshot.id,
      pageUrl: observedAgain.snapshot.pageUrl,
      targetId: observedAgain.snapshot.targetId,
      items: [{
        controlRef: companyOne.ref,
        factId: 'fixture-company-1',
        factVersion: 1,
        confirmed: true,
        confirmedVersion: 1,
        originalText: '甲公司',
        text: '甲公司',
        regionType: companyOne.region.type,
        regionEntityId: companyOne.region.entityId,
        expectedLabel: companyOne.label,
        fieldKey: 'internship.company',
      }],
    };
    const changed = await core.fillConfirmedPlan(changedPlan);
    assert.equal(changed.ok, false);
    assert.equal(changed.results[0].code, 'CHANGED_CONTROL');
    const afterChanged = await readPageValues(launched.cdp, sessionId);
    assert.equal(afterChanged.company1, '本人已填');
  } finally {
    try { unsubscribe?.(); } catch { /* ignore */ }
    try { await core?.close(); } catch { /* ignore */ }
    try { await launched?.close(); } catch { /* ignore */ }
    try {
      fs.rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {
      // Chrome 仍可能持有 profile 文件；保留在 .cache 中，不删除用户文件。
    }
  }
});
