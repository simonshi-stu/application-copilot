import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPANY_STATUS,
  POSITION_STATUS,
  WorkflowError,
  assertCompanyTransition,
  assertHumanConfirmation,
  assertOperator,
  blocksResubmission,
  canTransitionCompany,
  canTransitionPosition,
  isCompanyTerminal,
  isPositionTerminal,
} from '../core/workflow.js';

test('公司状态迁移由固定表决定，不能从排队直接跳到完成', () => {
  assert.equal(canTransitionCompany(COMPANY_STATUS.QUEUED, COMPANY_STATUS.AWAITING_LOGIN), true);
  assert.equal(canTransitionCompany(COMPANY_STATUS.QUEUED, COMPANY_STATUS.COMPLETED), false);
  assert.throws(
    () => assertCompanyTransition(COMPANY_STATUS.QUEUED, COMPANY_STATUS.COMPLETED),
    error => error instanceof WorkflowError && error.code === 'ILLEGAL_COMPANY_TRANSITION',
  );
  assert.equal(isCompanyTerminal(COMPANY_STATUS.COMPLETED), true);
  assert.equal(isCompanyTerminal(COMPANY_STATUS.PREPARING), false);
});

test('本人提交回执与官网核验都是终态且都禁止重投', () => {
  assert.equal(canTransitionPosition(POSITION_STATUS.AWAITING_HUMAN_SUBMIT, POSITION_STATUS.SUBMITTED_REPORTED), true);
  assert.equal(canTransitionPosition(POSITION_STATUS.AWAITING_HUMAN_SUBMIT, POSITION_STATUS.VERIFIED), false);
  assert.equal(canTransitionPosition(POSITION_STATUS.SUBMITTED_REPORTED, POSITION_STATUS.VERIFIED), true);
  assert.equal(blocksResubmission(POSITION_STATUS.SUBMITTED_REPORTED), true);
  assert.equal(blocksResubmission(POSITION_STATUS.VERIFIED), true);
  assert.equal(blocksResubmission(POSITION_STATUS.PREPARING), false);
  assert.equal(isPositionTerminal(POSITION_STATUS.SUBMITTED_REPORTED), true);
  assert.equal(isPositionTerminal(POSITION_STATUS.VERIFIED), true);
});

test('人工确认和操作者边界不可由模型自述替代', () => {
  assert.doesNotThrow(() => assertHumanConfirmation({ confirmedBy: 'user' }, '提交'));
  assert.throws(
    () => assertHumanConfirmation({ confirmedBy: 'model' }, '提交'),
    error => error.code === 'HUMAN_CONFIRMATION_REQUIRED',
  );
  assert.throws(() => assertOperator({ actor: 'agent' }, '记录提交'), error => error.code === 'FORBIDDEN');
  assert.doesNotThrow(() => assertOperator({ actor: 'operator' }, '记录提交'));
});
