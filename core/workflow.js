// 固定流程与合法迁移。流程由程序决定；模型只能准备数据，不能自行宣告已提交。

export const WORKFLOW_VERSION = '1';

export const COMPANY_STATUS = Object.freeze({
  QUEUED: 'queued',
  AWAITING_LOGIN: 'awaiting_login',
  RESEARCHING: 'researching',
  AWAITING_SELECTION: 'awaiting_selection',
  PREPARING: 'preparing',
  AWAITING_ISSUE_ANSWERS: 'awaiting_issue_answers',
  AWAITING_HUMAN_SUBMIT: 'awaiting_human_submit',
  HELD: 'held',
  BLOCKED: 'blocked',
  SUBMITTED_REPORTED: 'submitted_reported',
  COMPLETED: 'completed',
  NO_POSITIONS: 'no_positions',
  SKIPPED: 'skipped',
});

export const POSITION_STATUS = Object.freeze({
  CANDIDATE: 'candidate',
  SELECTED: 'selected',
  PREPARING: 'preparing',
  AWAITING_ISSUE_ANSWERS: 'awaiting_issue_answers',
  AWAITING_HUMAN_SUBMIT: 'awaiting_human_submit',
  SUBMITTED_REPORTED: 'submitted_reported',
  VERIFIED: 'verified',
  SKIPPED: 'skipped',
});

export const QUEUE_STATUS = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  DRAINED: 'drained',
});

export const COMPANY_TERMINAL = Object.freeze([
  COMPANY_STATUS.COMPLETED,
  COMPANY_STATUS.SUBMITTED_REPORTED,
  COMPANY_STATUS.NO_POSITIONS,
  COMPANY_STATUS.SKIPPED,
]);

export const COMPANY_ACTIVE = Object.freeze([
  COMPANY_STATUS.AWAITING_LOGIN,
  COMPANY_STATUS.RESEARCHING,
  COMPANY_STATUS.AWAITING_SELECTION,
  COMPANY_STATUS.PREPARING,
  COMPANY_STATUS.AWAITING_ISSUE_ANSWERS,
  COMPANY_STATUS.AWAITING_HUMAN_SUBMIT,
]);

export const POSITION_TERMINAL = Object.freeze([
  POSITION_STATUS.SUBMITTED_REPORTED,
  POSITION_STATUS.VERIFIED,
  POSITION_STATUS.SKIPPED,
]);

export const POSITION_BLOCKS_RESUBMISSION = Object.freeze([
  POSITION_STATUS.SUBMITTED_REPORTED,
  POSITION_STATUS.VERIFIED,
]);

const COMPANY_TRANSITIONS = Object.freeze({
  // 历史本人报告使用独立的公司级终态；它不伪造岗位状态，具体来源
  // 保存在 company.historicalSubmission 中。
  [COMPANY_STATUS.QUEUED]: [COMPANY_STATUS.AWAITING_LOGIN, COMPANY_STATUS.HELD, COMPANY_STATUS.BLOCKED, COMPANY_STATUS.SKIPPED, COMPANY_STATUS.SUBMITTED_REPORTED],
  [COMPANY_STATUS.AWAITING_LOGIN]: [COMPANY_STATUS.RESEARCHING, COMPANY_STATUS.HELD, COMPANY_STATUS.BLOCKED, COMPANY_STATUS.SKIPPED],
  [COMPANY_STATUS.RESEARCHING]: [COMPANY_STATUS.AWAITING_SELECTION, COMPANY_STATUS.NO_POSITIONS, COMPANY_STATUS.HELD, COMPANY_STATUS.BLOCKED, COMPANY_STATUS.SKIPPED],
  [COMPANY_STATUS.AWAITING_SELECTION]: [COMPANY_STATUS.PREPARING, COMPANY_STATUS.HELD, COMPANY_STATUS.BLOCKED, COMPANY_STATUS.SKIPPED],
  [COMPANY_STATUS.PREPARING]: [COMPANY_STATUS.AWAITING_ISSUE_ANSWERS, COMPANY_STATUS.AWAITING_HUMAN_SUBMIT, COMPANY_STATUS.COMPLETED, COMPANY_STATUS.HELD, COMPANY_STATUS.BLOCKED, COMPANY_STATUS.SKIPPED],
  [COMPANY_STATUS.AWAITING_ISSUE_ANSWERS]: [COMPANY_STATUS.PREPARING, COMPANY_STATUS.AWAITING_HUMAN_SUBMIT, COMPANY_STATUS.COMPLETED, COMPANY_STATUS.HELD, COMPANY_STATUS.BLOCKED, COMPANY_STATUS.SKIPPED],
  [COMPANY_STATUS.AWAITING_HUMAN_SUBMIT]: [COMPANY_STATUS.PREPARING, COMPANY_STATUS.AWAITING_ISSUE_ANSWERS, COMPANY_STATUS.COMPLETED, COMPANY_STATUS.HELD, COMPANY_STATUS.BLOCKED, COMPANY_STATUS.SKIPPED],
  // held / blocked 只能恢复到本人暂挂前的状态或明确跳过；具体目标由服务层按 resumeStatus 再校验。
  [COMPANY_STATUS.HELD]: [
    COMPANY_STATUS.AWAITING_LOGIN, COMPANY_STATUS.RESEARCHING, COMPANY_STATUS.AWAITING_SELECTION,
    COMPANY_STATUS.PREPARING, COMPANY_STATUS.AWAITING_ISSUE_ANSWERS, COMPANY_STATUS.AWAITING_HUMAN_SUBMIT,
    COMPANY_STATUS.BLOCKED, COMPANY_STATUS.SKIPPED,
  ],
  [COMPANY_STATUS.BLOCKED]: [
    COMPANY_STATUS.AWAITING_LOGIN, COMPANY_STATUS.RESEARCHING, COMPANY_STATUS.AWAITING_SELECTION,
    COMPANY_STATUS.PREPARING, COMPANY_STATUS.AWAITING_ISSUE_ANSWERS, COMPANY_STATUS.AWAITING_HUMAN_SUBMIT,
    COMPANY_STATUS.HELD, COMPANY_STATUS.SKIPPED,
  ],
  [COMPANY_STATUS.SUBMITTED_REPORTED]: [],
  [COMPANY_STATUS.COMPLETED]: [],
  [COMPANY_STATUS.NO_POSITIONS]: [],
  [COMPANY_STATUS.SKIPPED]: [],
});

const POSITION_TRANSITIONS = Object.freeze({
  [POSITION_STATUS.CANDIDATE]: [POSITION_STATUS.SELECTED, POSITION_STATUS.SKIPPED],
  [POSITION_STATUS.SELECTED]: [POSITION_STATUS.PREPARING, POSITION_STATUS.AWAITING_ISSUE_ANSWERS, POSITION_STATUS.SKIPPED],
  [POSITION_STATUS.PREPARING]: [POSITION_STATUS.AWAITING_HUMAN_SUBMIT, POSITION_STATUS.AWAITING_ISSUE_ANSWERS, POSITION_STATUS.SKIPPED],
  [POSITION_STATUS.AWAITING_ISSUE_ANSWERS]: [POSITION_STATUS.PREPARING, POSITION_STATUS.AWAITING_HUMAN_SUBMIT, POSITION_STATUS.SKIPPED],
  [POSITION_STATUS.AWAITING_HUMAN_SUBMIT]: [POSITION_STATUS.SUBMITTED_REPORTED, POSITION_STATUS.AWAITING_ISSUE_ANSWERS, POSITION_STATUS.SKIPPED],
  [POSITION_STATUS.SUBMITTED_REPORTED]: [POSITION_STATUS.VERIFIED],
  [POSITION_STATUS.VERIFIED]: [],
  [POSITION_STATUS.SKIPPED]: [],
});

export class WorkflowError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WorkflowError';
    this.code = code;
  }
}

export function isCompanyTerminal(status) {
  return COMPANY_TERMINAL.includes(status);
}

export function isCompanyActive(status) {
  return COMPANY_ACTIVE.includes(status);
}

export function isPositionTerminal(status) {
  return POSITION_TERMINAL.includes(status);
}

export function blocksResubmission(status) {
  return POSITION_BLOCKS_RESUBMISSION.includes(status);
}

export function canTransitionCompany(from, to) {
  return Boolean(COMPANY_TRANSITIONS[from]?.includes(to));
}

export function canTransitionPosition(from, to) {
  return Boolean(POSITION_TRANSITIONS[from]?.includes(to));
}

export function assertCompanyTransition(from, to) {
  if (!canTransitionCompany(from, to)) {
    throw new WorkflowError('ILLEGAL_COMPANY_TRANSITION', `公司状态不能从 ${from} 直接变为 ${to}。`);
  }
  return to;
}

export function assertPositionTransition(from, to) {
  if (!canTransitionPosition(from, to)) {
    throw new WorkflowError('ILLEGAL_POSITION_TRANSITION', `岗位状态不能从 ${from} 直接变为 ${to}。`);
  }
  return to;
}

export function assertQueueTransition(from, to) {
  const allowed = {
    [QUEUE_STATUS.IDLE]: [QUEUE_STATUS.RUNNING, QUEUE_STATUS.DRAINED],
    [QUEUE_STATUS.RUNNING]: [QUEUE_STATUS.PAUSED, QUEUE_STATUS.DRAINED],
    [QUEUE_STATUS.PAUSED]: [QUEUE_STATUS.RUNNING],
    [QUEUE_STATUS.DRAINED]: [QUEUE_STATUS.RUNNING],
  };
  if (!allowed[from]?.includes(to)) {
    throw new WorkflowError('ILLEGAL_QUEUE_TRANSITION', `队列状态不能从 ${from} 直接变为 ${to}。`);
  }
  return to;
}

export function assertHumanConfirmation(input, operation) {
  if (input?.confirmedBy !== 'user') {
    throw new WorkflowError('HUMAN_CONFIRMATION_REQUIRED', `${operation} 必须由本人明确确认，模型或自动流程不能代替。`);
  }
}

export function assertOperator(context, operation) {
  if (context?.actor !== 'operator') {
    throw new WorkflowError('FORBIDDEN', `${operation} 只能通过本人操作入口执行。`);
  }
}

export function assertAgentOrOperator(context, operation) {
  if (context?.actor !== 'agent' && context?.actor !== 'operator') {
    throw new WorkflowError('FORBIDDEN', `${operation} 需要明确的操作者。`);
  }
}
