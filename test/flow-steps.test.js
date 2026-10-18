import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFlowSteps } from '../extension/flow-steps.js';

const base = {
  company: '示例公司',
  links: [{ url: 'https://x.example.invalid/jobs' }],
  referral: { conflict: false, selected: '' },
  review: 'draft',
  stage: 'todo',
  sheetCopiedAt: '',
};

test('缺名称/链接时停在第一步，后续步骤保持 todo', () => {
  const steps = computeFlowSteps({ ...base, company: '', links: [] });
  assert.equal(steps[0].state, 'current');
  assert.equal(steps[1].state, 'todo');
  assert.equal(steps.length, 5);
});

test('内推冲突未选择时阻塞第一步', () => {
  const steps = computeFlowSteps({ ...base, referral: { conflict: true, selected: '' } });
  assert.equal(steps[0].state, 'current');
  const decided = computeFlowSteps({ ...base, referral: { conflict: true, selected: 'none' } });
  assert.equal(decided[0].state, 'done');
});

test('问答未完成时第二步为当前', () => {
  const steps = computeFlowSteps(base, { unanswered: 2 });
  assert.equal(steps[0].state, 'done');
  assert.equal(steps[1].state, 'current');
  assert.equal(steps[2].state, 'todo');
});

test('确认后送审单为当前；复制后提交为当前', () => {
  const confirmed = { ...base, review: 'confirmed' };
  let steps = computeFlowSteps(confirmed);
  assert.equal(steps[3].state, 'current');
  steps = computeFlowSteps({ ...confirmed, sheetCopiedAt: '2026-10-18T00:00:00.000Z' });
  assert.equal(steps[3].state, 'done');
  assert.equal(steps[4].state, 'current');
});

test('已核验全部完成；跳过标记为 skipped', () => {
  const done = computeFlowSteps({ ...base, review: 'confirmed', sheetCopiedAt: 'x', stage: 'verified' });
  assert.equal(done[4].state, 'done');
  const skipped = computeFlowSteps({ ...base, stage: 'skip' });
  assert.equal(skipped[4].state, 'skipped');
});
