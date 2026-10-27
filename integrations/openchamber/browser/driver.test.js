import test from 'node:test';
import assert from 'node:assert/strict';
import { CdpConnection } from './cdp.js';
import { createPageAdapter } from './cdp-page.js';
import { createMokaBrowserDriverWithDeps } from './driver.js';
import { normalizeNewlines } from './url-policy.js';
import { suggestMokaFieldMappings } from './field-semantics.js';

function payloadOf(expression) {
  const marker = '/*ACOPILOT_PAYLOAD*/';
  const start = expression.indexOf(marker);
  if (start < 0) throw new Error('missing payload marker');
  return JSON.parse(expression.slice(start + marker.length, expression.lastIndexOf(')')));
}

function createFakePipe(handler) {
  let messageHandler = () => {};
  let closeHandler = () => {};
  let errorHandler = () => {};
  const pipe = {
    closed: false,
    start() {},
    onMessage(callback) { messageHandler = callback; return () => { messageHandler = () => {}; }; },
    onClose(callback) { closeHandler = callback; return () => { closeHandler = () => {}; }; },
    onError(callback) { errorHandler = callback; return () => { errorHandler = () => {}; }; },
    async send(text) {
      const message = JSON.parse(text);
      let response;
      try {
        response = await handler(message);
      } catch (error) {
        response = { id: message.id, error: { code: -32000, message: error?.message || 'fixture error' } };
      }
      if (response) queueMicrotask(() => messageHandler(response));
    },
    close(reason) {
      pipe.closed = true;
      queueMicrotask(() => closeHandler(new Error(reason || 'fixture closed')));
    },
  };
  pipe.emit = (message) => queueMicrotask(() => messageHandler(message));
  pipe.emitError = (error) => queueMicrotask(() => errorHandler(error));
  return pipe;
}

function rawControl(label, {
  regionType = 'basic',
  entityId = null,
  type = 'text',
  tag = type === 'select' ? 'select' : type === 'textarea' ? 'textarea' : 'input',
  maxLength = null,
  options = null,
  optionCount = options ? options.length : 0,
  ambiguous = false,
  writable = true,
  disabled = false,
  readOnly = false,
  value = '',
} = {}) {
  return {
    tag,
    type,
    name: label,
    id: '',
    autocomplete: '',
    placeholder: '',
    label,
    labelSource: 'label',
    region: { type: regionType, label: '', entityId, ambiguous },
    maxLength,
    minLength: null,
    pattern: '',
    required: false,
    disabled,
    readOnly,
    value,
    options,
    optionCount,
    writable,
    writableReason: null,
  };
}

function makeWorld({ url = 'https://app.mokahr.com/apply/fixture', controls = [] } = {}) {
  const world = {
    url,
    title: 'Moka fixture',
    controls,
    refs: new Map(),
    writes: [],
    evaluateCalls: [],
    changedRefs: new Set(),
    readbackMismatchRefs: new Set(),
    observeIssues: [],
    targetClosed: false,
    closed: false,
    loginHint: false,
    hasPasswordField: false,
    researchResult: null,
    beforeWrite: null,
  };

  world.observe = (prefix) => {
    world.refs.clear();
    const raw = world.controls.map((control, index) => {
      const ref = `${prefix}-${index}`;
      const copy = { ...control, ref, region: { ...control.region } };
      world.refs.set(ref, copy);
      return copy;
    });
    return { ok: true, url: world.url, title: world.title, controls: raw, issues: world.observeIssues };
  };

  world.evaluate = async (payload) => {
    world.evaluateCalls.push(payload);
    if (payload.op === 'info') {
      return {
        ok: true,
        url: world.url,
        title: world.title,
        readyState: 'complete',
        hasPasswordField: world.hasPasswordField,
        loginHint: world.loginHint,
      };
    }
    if (payload.op === 'observe') {
      return world.observe(payload.refPrefix);
    }
    if (payload.op === 'write') {
      const control = world.refs.get(payload.ref);
      if (!control) return { ok: false, code: 'CONTROL_NOT_FOUND', url: world.url };
      if (world.changedRefs.has(payload.ref)) {
        return { ok: false, code: 'CHANGED_CONTROL', changedFields: ['label'], url: world.url };
      }
      if (world.url !== payload.expectedUrl) {
        return { ok: false, code: 'PAGE_URL_CHANGED', url: world.url };
      }
      if (control.type === 'select') {
        const option = payload.option;
        if (!option) return { ok: false, code: 'OPTION_REQUIRED', url: world.url };
        if (control.value === option.value) {
          return { ok: true, status: 'already_set', readBackMatched: true, url: world.url };
        }
        if (control.value) return { ok: false, code: 'CONTROL_NOT_EMPTY', url: world.url };
        const match = (control.options || []).find((candidate) => candidate.value === option.value && candidate.label === option.label);
        if (!match) return { ok: false, code: 'OPTION_NOT_FOUND', url: world.url };
        world.writes.push(payload);
        if (typeof world.beforeWrite === 'function') world.beforeWrite(world, payload);
        if (world.readbackMismatchRefs.has(payload.ref)) {
          return { ok: true, status: 'filled', readBackMatched: false, readBackLength: payload.text.length, url: world.url };
        }
        control.value = option.value;
        return {
          ok: true,
          status: 'filled',
          readBackMatched: true,
          readBackValue: option.value,
          readBackLabel: option.label,
          url: world.url,
        };
      }
      if (control.value === payload.text) {
        return { ok: true, status: 'already_set', readBackMatched: true, url: world.url };
      }
      if (control.value) return { ok: false, code: 'CONTROL_NOT_EMPTY', url: world.url };
      world.writes.push(payload);
      if (typeof world.beforeWrite === 'function') world.beforeWrite(world, payload);
      if (world.readbackMismatchRefs.has(payload.ref)) {
        return { ok: true, status: 'filled', readBackMatched: false, readBackLength: payload.text.length, url: world.url };
      }
      control.value = payload.text;
      return {
        ok: true,
        status: 'filled',
        readBackMatched: true,
        readBackLength: payload.text.length,
        url: world.url,
      };
    }
    if (payload.op === 'research') {
      return world.researchResult || { ok: true, status: 'ok', url: world.url, title: world.title, jobs: [], issues: [] };
    }
    return { ok: false, code: 'UNKNOWN_OPERATION' };
  };

  let pipe;
  const handler = async (message) => {
    if (message.method === 'Runtime.evaluate') {
      const payload = payloadOf(message.params.expression);
      const value = await world.evaluate(payload);
      return { id: message.id, result: { result: { type: 'object', value } } };
    }
    if (message.method === 'Target.getTargetInfo') {
      if (world.targetClosed) {
        return { id: message.id, error: { code: -32602, message: 'No target with given id found' } };
      }
      return {
        id: message.id,
        result: {
          targetInfo: {
            targetId: 'T1',
            type: 'page',
            url: world.url,
            title: world.title,
            attached: true,
          },
        },
      };
    }
    if (message.method === 'Page.navigate') {
      world.url = message.params.url;
      pipe.emit({ method: 'Page.loadEventFired', params: {}, sessionId: message.sessionId });
      return { id: message.id, result: { frameId: 'F1' } };
    }
    if (message.method === 'Target.getTargets') {
      return {
        id: message.id,
        result: {
          targetInfos: [{ targetId: 'T1', type: 'page', url: world.url, title: world.title, attached: true }],
        },
      };
    }
    if (message.method === 'Target.attachToTarget') {
      return { id: message.id, result: { sessionId: 'S1' } };
    }
    if (message.method === 'Page.enable' || message.method === 'Runtime.enable' || message.method === 'Browser.close') {
      return { id: message.id, result: {} };
    }
    return { id: message.id, error: { code: -32601, message: `unknown method ${message.method}` } };
  };

  pipe = createFakePipe(handler);
  const cdp = new CdpConnection(pipe, { defaultTimeoutMs: 2000 });
  const page = createPageAdapter({ cdp, targetId: 'T1', sessionId: 'S1', timeoutMs: 2000 });
  return { world, cdp, page, pipe };
}

function makeDriver(world, { openCalls = [] } = {}) {
  return createMokaBrowserDriverWithDeps({
    projectDirectory: 'C:\\fixture-project',
    headless: true,
    now: () => new Date('2026-10-26T00:00:00.000Z'),
  }, {
    openPage: async ({ approvedUrl }) => {
      openCalls.push(approvedUrl);
      world.url = approvedUrl;
      return {
        page: world.page,
        targetId: 'T1',
        browser: 'chrome',
        profileDir: 'C:\\fixture-project\\.cache\\moka-browser\\chrome-moka',
        headless: true,
        warning: null,
        close: async () => { world.closed = true; },
      };
    },
  });
}

async function openDriver(world, options = {}) {
  const openCalls = [];
  const driver = makeDriver(world, { openCalls, ...options });
  const opened = await driver.openCompany('https://app.mokahr.com/apply/fixture');
  return { driver, opened, openCalls };
}

function makePlan(snapshot, entries, overrides = {}) {
  return {
    schemaVersion: 'application-copilot.moka-fill-plan.v1',
    snapshotId: snapshot.id,
    pageUrl: snapshot.pageUrl,
    targetId: snapshot.targetId,
    items: entries.map(({ control, text, item = {} }) => ({
      controlRef: control.ref,
      factId: item.factId || `fact-${control.ref}`,
      factVersion: 1,
      confirmed: true,
      confirmedVersion: 1,
      originalText: text,
      text: normalizeNewlines(text),
      regionType: control.region.type,
      regionEntityId: control.region.entityId,
      expectedLabel: control.label,
      fieldKey: item.fieldKey || 'basic.name',
      ...item,
    })),
    ...overrides,
  };
}

test('工厂创建不启动浏览器；非法 Moka URL 在 launch 前拒绝', async () => {
  const { world, page } = makeWorld();
  world.page = page;
  const openCalls = [];
  const driver = makeDriver(world, { openCalls });
  assert.equal(openCalls.length, 0);
  for (const url of [
    'http://app.mokahr.com/',
    'https://evil.example/',
    'https://app.mokahr.com.evil.example/',
    'https://user:pass@app.mokahr.com/',
    'https://app.mokahr.com:8443/',
    'javascript:alert(1)',
  ]) {
    const result = await driver.openCompany(url);
    assert.equal(result.ok, false, url);
    assert.ok(['INVALID_SCHEME', 'HOST_NOT_ALLOWED', 'URL_HAS_CREDENTIALS', 'NON_STANDARD_PORT', 'INVALID_URL'].includes(result.code), `${url}: ${result.code}`);
  }
  assert.equal(openCalls.length, 0);
});

test('openCompany 成功后说明独立窗口，重定向离开 Moka 会阻断并关闭', async () => {
  const { world, page } = makeWorld();
  world.page = page;
  const { driver, opened, openCalls } = await openDriver(world);
  assert.equal(opened.ok, true);
  assert.equal(openCalls.length, 1);
  assert.equal(openCalls[0], 'https://app.mokahr.com/apply/fixture');
  assert.match(opened.note, /未内嵌/);
  assert.equal(opened.browser, 'chrome');

  const outsideWorld = makeWorld({ url: 'https://app.mokahr.com/apply/fixture' });
  const failingOpen = async () => {
    outsideWorld.world.url = 'https://evil.example/redirected';
    return {
      page: outsideWorld.page,
      targetId: 'T1',
      browser: 'chrome',
      profileDir: 'C:\\fixture',
      headless: true,
      close: async () => { outsideWorld.world.closed = true; },
    };
  };
  const failingDriver = createMokaBrowserDriverWithDeps({ projectDirectory: 'C:\\fixture' }, { openPage: failingOpen });
  const blocked = await failingDriver.openCompany('https://app.mokahr.com/apply/fixture');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'NAVIGATION_OUTSIDE_MOKA');
  assert.equal(outsideWorld.world.closed, true);

  await driver.close();
  assert.equal(world.closed, true);
});

test('observe 只返回可见原生可写控件，密码/文件/提交与敏感区域被过滤', async () => {
  const { world, page } = makeWorld({
    controls: [
      rawControl('姓名'),
      rawControl('手机号码'),
      rawControl('密码', { type: 'password' }),
      rawControl('提交', { type: 'submit' }),
      rawControl('上传简历', { type: 'file' }),
      rawControl('实习公司', { regionType: 'internship', entityId: 'internship:0:aaa', ambiguous: true }),
      rawControl('学校名称', { regionType: 'education', entityId: 'education:0:bbb' }),
    ],
  });
  world.page = page;
  world.observeIssues = [];
  const { driver } = await openDriver(world);
  const observed = await driver.observe();
  assert.equal(observed.ok, true);
  const labels = observed.snapshot.controls.map((control) => control.label);
  assert.deepEqual(labels, ['姓名', '手机号码', '实习公司', '学校名称']);
  assert.ok(observed.snapshot.controls.every((control) => !('value' in control) && !('signature' in control)));
  const codes = observed.snapshot.issues.map((issue) => issue.code);
  assert.ok(codes.includes('CREDENTIAL_FIELD_BLOCKED'));
  assert.ok(codes.includes('UNSUPPORTED_UPLOAD'));
  assert.ok(codes.includes('UNSUPPORTED_INPUT_TYPE'));
  assert.equal(observed.snapshot.controls.find((control) => control.label === '实习公司').writable, false);
  assert.equal(observed.snapshot.targetId, 'T1');
  assert.equal(observed.snapshot.counts.writable, 3);
  await driver.close();
});

test('观察快照的 ref 可直接用于字段语义候选', async () => {
  const { world, page } = makeWorld({
    controls: [
      rawControl('姓名'),
      rawControl('项目名称', { regionType: 'project', entityId: 'project:0:aaa' }),
      rawControl('项目内容', { regionType: 'project', entityId: 'project:0:aaa' }),
      rawControl('本人职责', { regionType: 'project', entityId: 'project:0:aaa' }),
    ],
  });
  world.page = page;
  const { driver } = await openDriver(world);
  const observed = await driver.observe();
  const mapping = suggestMokaFieldMappings(observed.snapshot.controls);
  const byFact = new Map(mapping.candidates.map((candidate) => [candidate.factKey, candidate]));
  assert.equal(byFact.get('basic.name').controlRef, observed.snapshot.controls[0].ref);
  assert.equal(byFact.get('project.name').controlRef, observed.snapshot.controls[1].ref);
  assert.equal(byFact.get('project.content').controlRef, observed.snapshot.controls[2].ref);
  assert.equal(byFact.get('project.responsibilities').controlRef, observed.snapshot.controls[3].ref);
  await driver.close();
});

test('fill 只写确认原文，保留空行，逐项读回并拒绝覆盖已有值', async () => {
  const { world, page } = makeWorld({
    controls: [
      rawControl('姓名'),
      rawControl('手机号码'),
      rawControl('已有字段', { value: '本人已填' }),
    ],
  });
  world.page = page;
  const { driver } = await openDriver(world);
  const observed = await driver.observe();
  assert.equal(observed.ok, true);
  const [name, phone, existing] = observed.snapshot.controls;
  const text = '第一段\r\n\r\n第二段\r\n末尾';
  const plan = makePlan(observed.snapshot, [
    { control: name, text },
    { control: phone, text: '13800000000' },
    { control: existing, text: '试图覆盖' },
  ]);
  const result = await driver.fillConfirmedPlan(plan);
  assert.equal(result.ok, false);
  assert.equal(result.results[0].status, 'filled');
  assert.equal(result.results[1].status, 'filled');
  assert.equal(result.results[2].code, 'CONTROL_NOT_EMPTY');
  assert.equal(world.writes.length, 2);
  assert.equal(world.writes[0].text, '第一段\n\n第二段\n末尾');
  assert.equal(world.writes[0].expected.value, '');
  assert.equal(result.issues.some((issue) => issue.code === 'CONTROL_NOT_EMPTY'), true);
  assert.equal(result.note.includes('不代表网站保存成功'), true);
  await driver.close();
});

test('过期快照、混填 target 和 region 都拒绝写入', async () => {
  const { world, page } = makeWorld({
    controls: [
      rawControl('实习公司', { regionType: 'internship', entityId: 'internship:0:aaa' }),
      rawControl('项目名称', { regionType: 'project', entityId: 'project:0:bbb' }),
    ],
  });
  world.page = page;
  const { driver } = await openDriver(world);
  const first = await driver.observe();
  const firstPlan = makePlan(first.snapshot, [{ control: first.snapshot.controls[0], text: '甲公司' }]);
  await driver.observe();
  const stale = await driver.fillConfirmedPlan(firstPlan);
  assert.equal(stale.ok, false);
  assert.equal(stale.issues[0].code, 'STALE_SNAPSHOT');
  assert.equal(world.writes.length, 0);

  const second = await driver.observe();
  const [company, project] = second.snapshot.controls;
  const mixed = makePlan(second.snapshot, [
    { control: company, text: '甲公司', item: { regionEntityId: 'internship:1:wrong' } },
  ]);
  const mixedResult = await driver.fillConfirmedPlan(mixed);
  assert.equal(mixedResult.ok, false);
  assert.equal(mixedResult.results[0].code, 'REGION_MISMATCH');

  const wrongTarget = makePlan(second.snapshot, [{ control: project, text: '示例项目' }], { targetId: 'OTHER' });
  const targetResult = await driver.fillConfirmedPlan(wrongTarget);
  assert.equal(targetResult.ok, false);
  assert.equal(targetResult.issues[0].code, 'SNAPSHOT_TARGET_MISMATCH');
  assert.equal(world.writes.length, 0);
  await driver.close();
});

test('暂停信号在串行驱动层阻止第二字段，已发出的一次写入允许完成', async () => {
  const { world, page } = makeWorld({ controls: [rawControl('姓名'), rawControl('手机号码')] });
  world.page = page;
  const originalEvaluate = world.evaluate;
  let releaseWrite;
  const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
  let startedResolve;
  const writeStarted = new Promise((resolve) => { startedResolve = resolve; });
  let delayed = false;
  world.evaluate = async (payload) => {
    if (payload.op === 'write' && !delayed) {
      delayed = true;
      startedResolve();
      await writeGate;
    }
    return originalEvaluate(payload);
  };
  const { driver } = await openDriver(world);
  const observed = await driver.observe();
  const [name, phone] = observed.snapshot.controls;
  const controller = new AbortController();
  const filling = driver.fillConfirmedPlan(makePlan(observed.snapshot, [
    { control: name, text: '虚构姓名' },
    { control: phone, text: '13800000000' },
  ]), { signal: controller.signal });
  await writeStarted;
  controller.abort();
  releaseWrite();
  const result = await filling;
  assert.equal(world.writes.length, 1, '第二字段不得写入');
  assert.equal(result.ok, false);
  assert.equal(result.results[0].status, 'filled');
  assert.equal(result.results[1].status, 'skipped');
  assert.equal(result.results[1].code, 'FILL_CANCELLED');
  assert.equal(result.issues.some((issue) => issue.code === 'FILL_CANCELLED'), true);
  await driver.close();
});

test('同一事实 ID 不能跨两个经历 entity 混填', async () => {
  const { world, page } = makeWorld({
    controls: [
      rawControl('实习公司', { regionType: 'internship', entityId: 'internship:0:aaa' }),
      rawControl('实习公司', { regionType: 'internship', entityId: 'internship:1:bbb' }),
    ],
  });
  world.page = page;
  const { driver } = await openDriver(world);
  const observed = await driver.observe();
  const [first, second] = observed.snapshot.controls;
  const plan = makePlan(observed.snapshot, [
    { control: first, text: '甲公司', item: { factId: 'shared-fact' } },
    { control: second, text: '乙公司', item: { factId: 'shared-fact' } },
  ]);
  const result = await driver.fillConfirmedPlan(plan);
  assert.equal(result.ok, false);
  assert.equal(result.issues[0].code, 'FACT_ENTITY_CONFLICT');
  assert.equal(world.writes.length, 0);
  await driver.close();
});

test('超长文本在写前拒绝，不交给页面', async () => {
  const { world, page } = makeWorld({ controls: [rawControl('姓名', { maxLength: 5 })] });
  world.page = page;
  const { driver } = await openDriver(world);
  const observed = await driver.observe();
  const plan = makePlan(observed.snapshot, [{ control: observed.snapshot.controls[0], text: '一二三四五六' }]);
  const result = await driver.fillConfirmedPlan(plan);
  assert.equal(result.ok, false);
  assert.equal(result.results[0].code, 'TOO_LONG');
  assert.equal(world.writes.length, 0);
  await driver.close();
});

test('changed control 与读回不一致不阻断其余独立安全字段', async () => {
  const { world, page } = makeWorld({
    controls: [rawControl('姓名'), rawControl('手机号码'), rawControl('电子邮箱')],
  });
  world.page = page;
  const { driver } = await openDriver(world);
  const observed = await driver.observe();
  const [name, phone, email] = observed.snapshot.controls;
  world.changedRefs.add(name.ref);
  world.readbackMismatchRefs.add(phone.ref);
  const plan = makePlan(observed.snapshot, [
    { control: name, text: '张三' },
    { control: phone, text: '13800000000' },
    { control: email, text: 'fixture@example.invalid' },
  ]);
  const result = await driver.fillConfirmedPlan(plan);
  assert.equal(result.ok, false);
  assert.equal(result.results[0].code, 'CHANGED_CONTROL');
  assert.equal(result.results[1].code, 'READBACK_MISMATCH');
  assert.equal(result.results[2].status, 'filled');
  assert.equal(world.writes.length, 2);
  await driver.close();
});

test('页面 URL 变化或 target 关闭时全局停止，不再写入', async () => {
  const { world, page } = makeWorld({ controls: [rawControl('姓名'), rawControl('手机号码')] });
  world.page = page;
  const { driver } = await openDriver(world);
  const observed = await driver.observe();
  world.url = 'https://evil.example/';
  const changed = await driver.fillConfirmedPlan(makePlan(observed.snapshot, [
    { control: observed.snapshot.controls[0], text: '张三' },
  ]));
  assert.equal(changed.ok, false);
  assert.equal(changed.issues[0].code, 'PAGE_NOT_APPROVED');
  assert.equal(world.writes.length, 0);

  world.url = 'https://app.mokahr.com/apply/fixture';
  const reobserved = await driver.observe();
  world.targetClosed = true;
  const closed = await driver.fillConfirmedPlan(makePlan(reobserved.snapshot, [
    { control: reobserved.snapshot.controls[0], text: '张三' },
  ]));
  assert.equal(closed.ok, false);
  assert.equal(closed.issues[0].code, 'TARGET_UNAVAILABLE');
  assert.equal(world.writes.length, 0);
  await driver.close();
});

test('密码/提交控件无法进入计划，未知动作字段整份拒绝', async () => {
  const { world, page } = makeWorld({
    controls: [rawControl('姓名'), rawControl('密码', { type: 'password' }), rawControl('提交', { type: 'submit' })],
  });
  world.page = page;
  const { driver } = await openDriver(world);
  const observed = await driver.observe();
  const name = observed.snapshot.controls.find((control) => control.label === '姓名');
  const passwordAttempt = makePlan(observed.snapshot, [
    { control: { ...name, ref: 'mc_password-9', label: '密码', region: { type: 'basic', entityId: null } }, text: 'secret' },
  ]);
  const passwordResult = await driver.fillConfirmedPlan(passwordAttempt);
  assert.equal(passwordResult.ok, false);
  assert.equal(passwordResult.results[0].code, 'UNKNOWN_CONTROL');
  assert.equal(world.writes.length, 0);

  const clickPlan = makePlan(observed.snapshot, [{ control: name, text: '张三', item: { click: true } }]);
  const clickResult = await driver.fillConfirmedPlan(clickPlan);
  assert.equal(clickResult.ok, false);
  assert.ok(clickResult.issues.some((issue) => issue.code === 'UNKNOWN_ITEM_KEY'));
  assert.equal(world.writes.length, 0);

  assert.equal(typeof driver.submit, 'undefined');
  assert.equal(typeof driver.click, 'undefined');
  assert.equal(typeof driver.runScript, 'undefined');
  await driver.close();
});

test('下拉必须匹配快照中唯一且精确的启用选项', async () => {
  const { world, page } = makeWorld({
    controls: [
      rawControl('学校名称', {
        regionType: 'education',
        entityId: 'education:0:aaa',
        type: 'select',
        options: [
          { value: 'b', label: '本科', disabled: false, selected: false },
          { value: 'm', label: '硕士', disabled: false, selected: false },
          { value: 'd', label: '博士', disabled: true, selected: false },
        ],
      }),
    ],
  });
  world.page = page;
  const { driver } = await openDriver(world);
  const observed = await driver.observe();
  const control = observed.snapshot.controls[0];
  const good = makePlan(observed.snapshot, [{
    control,
    text: '硕士',
    item: { optionValue: 'm', optionLabel: '硕士' },
  }]);
  const okResult = await driver.fillConfirmedPlan(good);
  assert.equal(okResult.ok, true);
  assert.equal(okResult.results[0].status, 'filled');
  assert.equal(world.writes[0].option.value, 'm');

  const bad = makePlan(observed.snapshot, [{
    control,
    text: '博士',
    item: { optionValue: 'x', optionLabel: '博士' },
  }]);
  const badResult = await driver.fillConfirmedPlan(bad);
  assert.equal(badResult.ok, false);
  assert.equal(badResult.results[0].code, 'OPTION_NOT_FOUND');
  await driver.close();
});

test('未安装浏览器/启动失败明确阻断，不伪造成功', async () => {
  const driver = createMokaBrowserDriverWithDeps({ projectDirectory: 'C:\\fixture' }, {
    openPage: async () => {
      const error = new Error('fixture browser not found');
      error.name = 'BrowserLaunchError';
      error.code = 'BROWSER_NOT_FOUND';
      throw error;
    },
  });
  const result = await driver.openCompany('https://app.mokahr.com/apply/fixture');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BROWSER_NOT_FOUND');
  assert.match(result.message, /fixture browser not found/);
  assert.equal(driver.getStatus().lastError.code, 'BROWSER_NOT_FOUND');
});

test('已有相同值返回 already_set，不重复写入', async () => {
  const { world, page } = makeWorld({ controls: [rawControl('姓名', { value: '张三' })] });
  world.page = page;
  const { driver } = await openDriver(world);
  const observed = await driver.observe();
  assert.equal(observed.snapshot.controls[0].hasValue, true);
  const result = await driver.fillConfirmedPlan(makePlan(observed.snapshot, [
    { control: observed.snapshot.controls[0], text: '张三' },
  ]));
  assert.equal(result.ok, true);
  assert.equal(result.results[0].status, 'already_set');
  assert.equal(world.writes.length, 0);
  await driver.close();
});

test('下拉占位项不能被当作确认值', async () => {
  const { world, page } = makeWorld({
    controls: [
      rawControl('学历', {
        type: 'select',
        options: [
          { value: '', label: '请选择', disabled: false, selected: true },
          { value: 'b', label: '本科', disabled: false, selected: false },
        ],
      }),
    ],
  });
  world.page = page;
  const { driver } = await openDriver(world);
  const observed = await driver.observe();
  const result = await driver.fillConfirmedPlan(makePlan(observed.snapshot, [{
    control: observed.snapshot.controls[0],
    text: '请选择',
    item: { optionValue: '', optionLabel: '请选择' },
  }]));
  assert.equal(result.ok, false);
  assert.equal(result.results[0].code, 'OPTION_PLACEHOLDER');
  assert.equal(world.writes.length, 0);
  await driver.close();
});

test('岗位读取只返回批准域名的可见岗位；空页/登录页不冒充无岗位', async () => {
  const { world, page } = makeWorld();
  world.page = page;
  const { driver } = await openDriver(world);
  world.researchResult = {
    ok: true,
    status: 'ok',
    url: world.url,
    title: '岗位列表',
    jobs: [
      {
        jobId: 'job-1',
        title: '示例岗位',
        url: 'https://app.mokahr.com/apply/fixture/job-1',
        city: '示例市',
        jd: '职位描述示例',
        visibleText: '示例岗位 示例市',
        source: 'visible-list',
      },
      {
        jobId: 'evil',
        title: '外部岗位',
        url: 'https://evil.example/job-2',
        city: null,
        jd: null,
      },
    ],
    issues: [],
  };
  const research = await driver.extractResearchSnapshot();
  assert.equal(research.status, 'ok');
  assert.equal(research.jobs.length, 1);
  assert.equal(research.jobs[0].sourceUrl, 'https://app.mokahr.com/apply/fixture/job-1');
  assert.equal(research.capturedAt, '2026-10-26T00:00:00.000Z');
  assert.ok(research.issues.some((issue) => issue.code === 'EXTERNAL_JOB_LINK_DROPPED'));
  assert.equal(Object.prototype.hasOwnProperty.call(research, 'noPositions'), false);

  world.researchResult = { ok: true, status: 'incomplete', url: world.url, title: '空页', jobs: [], issues: [] };
  const incomplete = await driver.extractResearchSnapshot();
  assert.equal(incomplete.status, 'incomplete');
  assert.equal(incomplete.code, 'NO_RELIABLE_JOB_CARDS');
  assert.equal(incomplete.jobs.length, 0);

  world.info = null;
  world.loginHint = true;
  world.hasPasswordField = true;
  const blocked = await driver.extractResearchSnapshot();
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.code, 'LOGIN_REQUIRED');
  assert.equal(blocked.jobs.length, 0);
  await driver.close();
});
