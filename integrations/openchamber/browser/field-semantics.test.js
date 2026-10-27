import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOKA_FACT_KEYS,
  MOKA_FACT_LABELS,
  normalizeFieldLabel,
  suggestMokaFieldMappings,
} from './field-semantics.js';

function control(label, {
  regionType = 'basic',
  entityId = null,
  writable = true,
  writableReason = null,
  type = 'text',
  options = null,
  optionCount = options ? options.length : 0,
  hasValue = false,
} = {}) {
  return {
    ref: `mc_ref-${Math.random().toString(16).slice(2)}`,
    label,
    type,
    tag: type === 'select' ? 'select' : type === 'textarea' ? 'textarea' : 'input',
    region: { type: regionType, label: '', entityId, ambiguous: false },
    writable,
    writableReason,
    options,
    optionCount,
    hasValue,
  };
}

test('姓名、电话、邮箱、学校互不混淆', () => {
  const controls = [
    control('姓名'),
    control('手机号码'),
    control('电子邮箱'),
    control('毕业院校', { regionType: 'education', entityId: 'education:0:aaa' }),
    control('项目名称', { regionType: 'project' }),
    control('公司名称', { regionType: 'internship' }),
    control('学校名称', { regionType: 'education', entityId: 'education:1:bbb' }),
  ];
  const result = suggestMokaFieldMappings(controls);
  const byLabel = new Map(result.candidates.map((candidate) => [candidate.label, candidate.factKey]));
  assert.equal(byLabel.get('姓名'), MOKA_FACT_KEYS.NAME);
  assert.equal(byLabel.get('手机号码'), MOKA_FACT_KEYS.PHONE);
  assert.equal(byLabel.get('电子邮箱'), MOKA_FACT_KEYS.EMAIL);
  assert.equal(byLabel.get('毕业院校'), MOKA_FACT_KEYS.SCHOOL);
  assert.equal(byLabel.get('项目名称'), MOKA_FACT_KEYS.PROJECT_NAME);
  assert.equal(byLabel.get('公司名称'), MOKA_FACT_KEYS.INTERNSHIP_COMPANY);
  assert.equal(byLabel.get('学校名称'), MOKA_FACT_KEYS.SCHOOL);
});

test('实习公司/地点/岗位/正文与项目名称/内容/本人职责严格分开', () => {
  const result = suggestMokaFieldMappings([
    control('实习公司', { regionType: 'internship', entityId: 'internship:0:a' }),
    control('实习地点', { regionType: 'internship', entityId: 'internship:0:a' }),
    control('实习岗位名称', { regionType: 'internship', entityId: 'internship:0:a' }),
    control('实习正文', { regionType: 'internship', entityId: 'internship:0:a' }),
    control('项目名称', { regionType: 'project', entityId: 'project:0:a' }),
    control('项目内容', { regionType: 'project', entityId: 'project:0:a' }),
    control('项目职责', { regionType: 'project', entityId: 'project:0:a' }),
    control('本人职责', { regionType: 'project', entityId: 'project:1:b' }),
  ]);
  const byLabel = new Map(result.candidates.map((candidate) => [candidate.label, candidate.factKey]));
  assert.equal(byLabel.get('实习公司'), MOKA_FACT_KEYS.INTERNSHIP_COMPANY);
  assert.equal(byLabel.get('实习地点'), MOKA_FACT_KEYS.INTERNSHIP_LOCATION);
  assert.equal(byLabel.get('实习岗位名称'), MOKA_FACT_KEYS.INTERNSHIP_ROLE);
  assert.equal(byLabel.get('实习正文'), MOKA_FACT_KEYS.INTERNSHIP_CONTENT);
  assert.equal(byLabel.get('项目名称'), MOKA_FACT_KEYS.PROJECT_NAME);
  assert.equal(byLabel.get('项目内容'), MOKA_FACT_KEYS.PROJECT_CONTENT);
  assert.equal(byLabel.get('项目职责'), MOKA_FACT_KEYS.PROJECT_RESPONSIBILITIES);
  assert.equal(byLabel.get('本人职责'), MOKA_FACT_KEYS.PROJECT_RESPONSIBILITIES);
  assert.ok(!result.candidates.some((candidate) => candidate.label === '项目职责' && candidate.factKey === MOKA_FACT_KEYS.PROJECT_CONTENT));
});

test('重复实习只有稳定 entityId 才建议自动绑定，宁缺勿串', () => {
  const controls = [
    control('实习公司', { regionType: 'internship', entityId: 'internship:0:aaa' }),
    control('实习公司', { regionType: 'internship', entityId: 'internship:1:bbb' }),
    control('实习内容', { regionType: 'internship', entityId: null }),
    control('实习内容', { regionType: 'internship', entityId: null }),
  ];
  const result = suggestMokaFieldMappings(controls);
  const companies = result.candidates.filter((candidate) => candidate.factKey === MOKA_FACT_KEYS.INTERNSHIP_COMPANY);
  assert.equal(companies.length, 2);
  assert.ok(companies.every((candidate) => candidate.requiresEntityBinding === true));
  assert.deepEqual(companies.map((candidate) => candidate.regionEntityId).sort(), ['internship:0:aaa', 'internship:1:bbb']);
  assert.equal(result.candidates.filter((candidate) => candidate.factKey === MOKA_FACT_KEYS.INTERNSHIP_CONTENT).length, 0);
  assert.ok(result.ambiguous.some((entry) => entry.factKey === MOKA_FACT_KEYS.INTERNSHIP_CONTENT || entry.possibleFactKeys.includes(MOKA_FACT_KEYS.INTERNSHIP_CONTENT)));
});

test('同一经历内重复同名候选、工作经历和未知字段保持人工处理', () => {
  const result = suggestMokaFieldMappings([
    control('项目名称', { regionType: 'project', entityId: 'project:0:a' }),
    control('项目名称', { regionType: 'project', entityId: 'project:0:a' }),
    control('公司名称', { regionType: 'work', entityId: 'work:0:a' }),
    control('所属部门', { regionType: 'basic' }),
    control('密码', { regionType: 'credential' }),
    control('文件', { type: 'file', writable: false, writableReason: 'UNSUPPORTED_UPLOAD' }),
  ]);
  assert.equal(result.candidates.length, 0);
  assert.ok(result.ambiguous.some((entry) => entry.label === '项目名称'));
  assert.ok(result.ambiguous.some((entry) => entry.label === '所属部门'));
  assert.ok(result.unsupported.some((entry) => entry.label === '公司名称' && entry.code === 'REGION_NOT_SUPPORTED'));
  assert.ok(result.unsupported.some((entry) => entry.label === '密码' && entry.code === 'CREDENTIAL_REGION_BLOCKED'));
  assert.ok(result.unsupported.some((entry) => entry.label === '文件'));
});

test('下拉只给候选，不替用户选选项', () => {
  const result = suggestMokaFieldMappings([
    control('学校名称', {
      regionType: 'education',
      entityId: 'education:0:a',
      type: 'select',
      options: [{ value: '1', label: '示例大学' }, { value: '2', label: '另一所大学' }],
      optionCount: 2,
    }),
  ]);
  assert.equal(result.candidates.length, 1);
  const [candidate] = result.candidates;
  assert.equal(candidate.factKey, MOKA_FACT_KEYS.SCHOOL);
  assert.equal(candidate.choiceRequired, true);
  assert.equal(candidate.optionCount, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(candidate, 'optionValue'), false);
});

test('标签标准化与事实标签保持可读', () => {
  assert.equal(normalizeFieldLabel('  项目名称：  '), '项目名称');
  assert.equal(normalizeFieldLabel('姓名*'), '姓名');
  assert.equal(MOKA_FACT_LABELS[MOKA_FACT_KEYS.PROJECT_RESPONSIBILITIES], '本人职责');
});
