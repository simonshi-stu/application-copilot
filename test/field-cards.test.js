import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFieldCard, profileSummaryFromResume, DEFAULT_PROFILE_SUMMARY } from '../extension/field-cards.js';

test('银行信息卡询问声明类字段并复用个人资料', () => {
  const card = buildFieldCard('bank');
  assert.ok(card.ask.some(item => item.includes('征信')));
  assert.ok(card.ask.some(item => item.includes('家庭')));
  assert.ok(card.reuse.includes('个人信息'));
  assert.ok(card.verify.some(item => item.includes('学历认证')));
});

test('车企信息卡询问驾照，其他类型回退通用卡', () => {
  assert.ok(buildFieldCard('auto').ask.some(item => item.includes('驾照')));
  const generic = buildFieldCard('other');
  assert.ok(generic.ask.some(item => item.includes('调剂')));
  const unknown = buildFieldCard('not-a-type');
  assert.deepEqual(unknown.ask, generic.ask);
});

test('简历解析结果可生成复用摘要，缺失时使用默认摘要', () => {
  assert.deepEqual(profileSummaryFromResume(null), DEFAULT_PROFILE_SUMMARY);
  const summary = profileSummaryFromResume({ education: [1, 2], internships: [1, 2, 3, 4], projects: [1, 2, 3, 4], skills: ['x'], language: [], evaluation: [] });
  assert.ok(summary.includes('教育经历×2'));
  assert.ok(summary.includes('实习经历×4'));
  assert.ok(summary.includes('技能'));
  assert.ok(!summary.includes('自我评价'));
});
