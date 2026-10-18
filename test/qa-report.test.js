import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQaReport } from '../extension/qa-report.js';

const base = {
  company: '示例公司',
  links: [{ url: 'https://x.example.invalid/jobs' }],
  referral: { selected: 'CODE1', conflict: false, bindingVerified: false },
  review: 'draft',
  stage: 'todo',
  warnings: [],
};

test('基础条目缺少核对与送审记录时给出提醒', () => {
  const report = buildQaReport(base);
  assert.equal(report.level, 'warn');
  assert.ok(report.items.some(item => item.text.includes('尚未标记')));
  assert.ok(report.items.some(item => item.text.includes('未在官网确认绑定')));
});

test('缺链接与未选冲突码是错误级', () => {
  const report = buildQaReport({ ...base, links: [], referral: { conflict: true, selected: '' } });
  assert.equal(report.level, 'error');
  assert.ok(report.items.some(item => item.text.includes('缺少招聘链接')));
  assert.ok(report.items.some(item => item.text.includes('尚未选择')));
});

test('未答项、未确认字段与提交阶段缺记录', () => {
  const report = buildQaReport(
    { ...base, review: 'confirmed', stage: 'submitted', sheetCopiedAt: '' },
    { unanswered: 2, facts: [{ status: 'unconfirmed', value: 'x' }] },
  );
  assert.ok(report.items.some(item => item.text.includes('2 项公司补充')));
  assert.ok(report.items.some(item => item.text.includes('未确认')));
  assert.ok(report.items.some(item => item.text.includes('没有送审单')));
});

test('数据齐全时返回 ok', () => {
  const report = buildQaReport(
    {
      ...base,
      review: 'confirmed',
      stage: 'ready',
      sheetCopiedAt: '2026-10-18T00:00:00.000Z',
      appliedAt: '2026-10-18',
      referral: { selected: 'CODE1', conflict: false, bindingVerified: true },
    },
    { facts: [{ status: 'confirmed', value: 'x' }] },
  );
  assert.equal(report.level, 'ok');
  assert.deepEqual(report.items, []);
});
