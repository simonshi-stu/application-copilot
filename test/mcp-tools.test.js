import test from 'node:test';
import assert from 'node:assert/strict';
import { toolByName } from '../mcp/tools.mjs';

const fact = { id: '1', label: '姓名', value: '测试同学', status: 'confirmed', source: 'manual' };
const block = { id: 'b1', kind: 'internship_content', item: '示例公司', text: '开发样例。', approved: true };
const entry = {
  company: '示例公司',
  links: [{ url: 'https://x.example.invalid/jobs' }],
  referral: { candidates: ['CODE1'], conflict: false, selected: 'CODE1', bindingVerified: true },
  review: 'confirmed',
  stage: 'todo',
  answers: { '意向分行/城市': '示例城' },
  applicationRef: 'JOB-1',
  warnings: [],
};

test('parse_companies_text 返回条目草稿', () => {
  const result = toolByName('parse_companies_text').run({ text: '1️⃣【示例公司】https://x.example.invalid/jobs' });
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].company, '示例公司');
});

test('build_fill_plan 只含已确认信息并带来源', () => {
  const items = toolByName('build_fill_plan').run({ entry, facts: [fact], blocks: [block] });
  assert.ok(items.every(item => item.status === 'ready'));
  assert.ok(items.some(item => item.label === '姓名' && item.value === '测试同学'));
  assert.ok(items.some(item => item.label.includes('实习内容')));
  assert.ok(items.some(item => item.label.includes('内推码')));
});

test('build_review_sheet 与 qa_report 可用', () => {
  const sheet = toolByName('build_review_sheet').run({ entry, facts: [fact], blocks: [block] });
  assert.match(sheet, /# 送审单：示例公司/);
  assert.match(sheet, /JOB-1/);
  const report = toolByName('qa_report').run({ entry, facts: [fact] });
  assert.equal(report.level, 'ok');
});

test('未知工具返回 undefined', () => {
  assert.equal(toolByName('nope'), undefined);
});
