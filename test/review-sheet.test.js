import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewSheet, STAGES, STAGE_FLOW } from '../extension/review-sheet.js';

// 全部为虚构示例。

const entry = {
  company: '示例公司',
  platform: 'moka',
  batch: '2027秋招',
  deadline: '',
  links: [{ url: 'https://x.example.invalid/jobs', kind: 'apply' }],
  referral: { candidates: ['CODEAAA', 'CODEBBB'], conflict: true, selected: 'CODEBBB', bindingVerified: false, legacyAutoValue: '' },
  review: 'confirmed',
  stage: 'todo',
  warnings: [],
  industry: { value: 'bank', label: '银行/金融', source: 'auto', reasons: [], alternatives: [] },
  nature: 'unknown',
  direction: '',
  answers: { '意向分行/城市': '示例城' },
  rawSource: '',
};

test('送审单包含公司、选择的内推码、回答与提交前检查', () => {
  const sheet = buildReviewSheet(entry);
  assert.match(sheet, /# 送审单：示例公司/);
  assert.match(sheet, /内推码选定：CODEBBB/);
  assert.match(sheet, /- \[x\] 意向分行\/城市：示例城/);
  assert.match(sheet, /提交前检查（由本人执行）/);
  assert.match(sheet, /最终提交由本人点击/);
  assert.match(sheet, /存在多个内推候选/);
});

test('未选内推码与未答字段如实标注，不编造', () => {
  const draft = { ...entry, referral: { ...entry.referral, selected: '', conflict: false }, answers: {}, review: 'draft', stage: 'preparing' };
  const sheet = buildReviewSheet(draft);
  assert.match(sheet, /内推码选定：未选择/);
  assert.match(sheet, /- \[ \] 意向分行\/城市：（待补充）/);
  assert.match(sheet, /进度：核对中/);
  assert.match(sheet, /人工核对状态：草稿/);
});

test('已确认字段进入送审单的可复用区；阶段常量可查', () => {
  const sheet = buildReviewSheet(entry, { facts: [{ id: '1', label: '姓名', value: '测试同学', status: 'confirmed' }] });
  assert.match(sheet, /姓名：测试同学（已确认）/);
  assert.equal(STAGES.todo, '待准备');
  assert.equal(STAGE_FLOW.ready, '等待本人提交');
  assert.equal(STAGE_FLOW.skip, '已跳过');
});

test('备注、申请号与进度记录进入送审单', () => {
  const sheet = buildReviewSheet({
    ...entry,
    applicationRef: 'JOB-123',
    appliedAt: '2026-10-18',
    notes: '材料已核对',
    history: [{ at: '2026-10-18T10:00:00.000Z', from: 'todo', to: 'preparing' }],
  });
  assert.match(sheet, /申请号 \/ 岗位ID：JOB-123/);
  assert.match(sheet, /提交日期（本人填写）：2026-10-18/);
  assert.match(sheet, /材料已核对/);
  assert.match(sheet, /待准备 → 核对中/);
});
