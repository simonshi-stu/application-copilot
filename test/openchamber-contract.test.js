import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMAND,
  buildCommandPayload,
  companyApplicationCategory,
  validateCommandInput,
} from '../integrations/openchamber/contract.js';

test('历史本人投递命令需要说明和明确确认', () => {
  assert.throws(
    () => validateCommandInput(COMMAND.reportHistoricalSubmission, {
      companyId: 'company-1',
      confirmedByUser: true,
    }),
    error => error.code === 'INVALID_FIELD',
  );
  const input = validateCommandInput(COMMAND.reportHistoricalSubmission, {
    companyId: 'company-1',
    note: '本人确认历史上已完成投递。',
    confirmedByUser: true,
  });
  assert.deepEqual(input, {
    companyId: 'company-1',
    note: '本人确认历史上已完成投递。',
    confirmedByUser: true,
  });
  assert.equal(
    buildCommandPayload({ directory: 'C:\\fictional-project', command: COMMAND.reportHistoricalSubmission, input }).command,
    COMMAND.reportHistoricalSubmission,
  );
});

test('公司投递分类区分待投递、本人记录/官网核验和无合适岗位', () => {
  assert.equal(companyApplicationCategory({ status: 'queued', application: { kind: 'none' } }), 'pending');
  assert.equal(companyApplicationCategory({ status: 'submitted_self_reported', application: { kind: 'self_reported' } }), 'submitted');
  assert.equal(companyApplicationCategory({ status: 'submitted_verified', application: { kind: 'verified' } }), 'submitted');
  assert.equal(companyApplicationCategory({ status: 'no_suitable_jobs', application: { kind: 'no_suitable_jobs' } }), 'no_suitable_jobs');
  assert.equal(companyApplicationCategory({ status: 'skipped', application: { kind: 'skipped' } }), 'skipped');
});
