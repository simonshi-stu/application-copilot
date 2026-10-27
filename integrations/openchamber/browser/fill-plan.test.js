import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOKA_FILL_PLAN_SCHEMA_VERSION,
  MOKA_FORBIDDEN_PLAN_KEYS,
  MOKA_PLAN_ITEM_KEYS,
  normalizePlanText,
  validateMokaFillPlan,
} from './fill-plan.js';

function makeItem(overrides = {}) {
  return {
    controlRef: 'mc_abc12345-0',
    factId: 'fact-name',
    factVersion: 3,
    confirmed: true,
    confirmedVersion: 3,
    originalText: '第一段\r\n\r\n第二段',
    text: '第一段\n\n第二段',
    regionType: 'basic',
    regionEntityId: null,
    expectedLabel: '姓名',
    fieldKey: 'basic.name',
    ...overrides,
  };
}

function makePlan(overrides = {}) {
  return {
    schemaVersion: MOKA_FILL_PLAN_SCHEMA_VERSION,
    snapshotId: 'snap_fixture-1',
    pageUrl: 'https://app.mokahr.com/apply/fixture',
    targetId: 'TARGET1',
    items: [makeItem()],
    ...overrides,
  };
}

function codes(result) {
  return result.issues.map((issue) => issue.code);
}

test('合法计划保留原文空行，只接受 CRLF/CR→LF 归一', () => {
  const result = validateMokaFillPlan(makePlan());
  assert.equal(result.ok, true);
  assert.equal(result.plan.items[0].text, '第一段\n\n第二段');
  assert.equal(result.plan.items[0].originalText, '第一段\r\n\r\n第二段');
  assert.equal(normalizePlanText('a\r\n\r\nb\rc'), 'a\n\nb\nc');
});

test('未知字段、selector、脚本、点击、提交、URL 一律拒绝', () => {
  const plan = makePlan({
    items: [makeItem({
      selector: '#name',
      script: 'alert(1)',
      click: true,
      submit: true,
      action: 'submit',
      url: 'https://evil.example',
      expression: '1+1',
    })],
  });
  const result = validateMokaFillPlan(plan);
  assert.equal(result.ok, false);
  const unknown = result.issues.filter((issue) => issue.code === 'UNKNOWN_ITEM_KEY');
  assert.ok(unknown.length >= 6);
  assert.deepEqual(
    unknown.map((issue) => issue.path.split('.').pop()).sort(),
    ['action', 'click', 'expression', 'script', 'selector', 'submit', 'url'].sort(),
  );
  assert.ok(MOKA_FORBIDDEN_PLAN_KEYS.every((key) => !MOKA_PLAN_ITEM_KEYS.includes(key)));
});

test('必须绑定确认状态、事实版本和原文；不得润色截断', () => {
  assert.equal(validateMokaFillPlan(makePlan({ items: [makeItem({ confirmed: false })] })).ok, false);
  assert.ok(codes(validateMokaFillPlan(makePlan({ items: [makeItem({ confirmedVersion: 2 })] }))).includes('STALE_CONFIRMATION'));
  assert.ok(codes(validateMokaFillPlan(makePlan({ items: [makeItem({ text: '第一段\n\n第二段（润色）' })] }))).includes('TEXT_NOT_ORIGINAL'));
  assert.ok(codes(validateMokaFillPlan(makePlan({ items: [makeItem({ text: ' 第一段\n\n第二段 ' })] }))).includes('TEXT_NOT_ORIGINAL'));
  assert.ok(codes(validateMokaFillPlan(makePlan({ items: [makeItem({ originalText: '', text: '' })] }))).includes('INVALID_ORIGINAL_TEXT'));
  assert.ok(codes(validateMokaFillPlan(makePlan({ items: [makeItem({ originalText: 'x\u0000y', text: 'x\u0000y' })] }))).includes('INVALID_ORIGINAL_TEXT'));
});

test('页面、快照、target、区域和选项都必须结构化绑定', () => {
  assert.ok(codes(validateMokaFillPlan(makePlan({ pageUrl: 'https://evil.example' }))).includes('INVALID_PAGE_URL'));
  assert.ok(codes(validateMokaFillPlan(makePlan({ snapshotId: '' }))).includes('INVALID_SNAPSHOT_ID'));
  assert.ok(codes(validateMokaFillPlan(makePlan({ targetId: '' }))).includes('INVALID_TARGET_ID'));
  assert.ok(codes(validateMokaFillPlan(makePlan({ items: [makeItem({ regionType: 'basic', regionEntityId: 'internship:0:abc' })] }))).includes('REGION_ENTITY_NOT_ALLOWED'));
  assert.ok(codes(validateMokaFillPlan(makePlan({ items: [makeItem({ regionType: 'nonsense' })] }))).includes('INVALID_REGION_TYPE'));
  assert.ok(codes(validateMokaFillPlan(makePlan({ items: [makeItem({ optionValue: '本科' })] }))).includes('INCOMPLETE_OPTION'));
  assert.ok(codes(validateMokaFillPlan(makePlan({ items: [makeItem({ optionLabel: '本科' })] }))).includes('INCOMPLETE_OPTION'));
});

test('重复控件引用与空计划被拒绝', () => {
  const item = makeItem();
  assert.ok(codes(validateMokaFillPlan(makePlan({ items: [item, { ...item }] }))).includes('DUPLICATE_CONTROL_REF'));
  assert.ok(codes(validateMokaFillPlan(makePlan({ items: [] }))).includes('INVALID_PLAN_ITEMS'));
  const tooMany = Array.from({ length: 51 }, (_, index) => makeItem({ controlRef: `mc_abc12345-${index}` }));
  assert.ok(codes(validateMokaFillPlan(makePlan({ items: tooMany }))).includes('INVALID_PLAN_ITEMS'));
});

test('JSON 中的 __proto__ 不能绕过未知字段检查', () => {
  const raw = JSON.parse(`{
    "schemaVersion": "${MOKA_FILL_PLAN_SCHEMA_VERSION}",
    "snapshotId": "snap_fixture-1",
    "pageUrl": "https://app.mokahr.com/apply/fixture",
    "targetId": "TARGET1",
    "items": [{
      "controlRef": "mc_abc12345-0",
      "factId": "fact-name",
      "factVersion": 1,
      "confirmed": true,
      "confirmedVersion": 1,
      "originalText": "姓名",
      "text": "姓名",
      "regionType": "basic",
      "regionEntityId": null,
      "__proto__": { "selector": "#name" }
    }]
  }`);
  const result = validateMokaFillPlan(raw);
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('UNKNOWN_ITEM_KEY'));
});
