// 问题队列：结构化、可恢复、按稳定键合并。关闭弹窗不改变问题状态。

import { validateSchema } from './validation.js';

export const ISSUE_TYPES = Object.freeze(['missing', 'conflict', 'overlong', 'unknown', 'blocking', 'safety', 'review']);
export const ISSUE_STATUSES = Object.freeze(['open', 'answered', 'resolved']);

export const issueSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['id', 'companyId', 'positionId', 'fieldKey', 'type', 'severity', 'blocking', 'message', 'evidence', 'status', 'answer', 'dependencies', 'occurrences', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string', minLength: 1 },
    companyId: { type: 'string', minLength: 1 },
    positionId: { type: ['string', 'null'] },
    fieldKey: { type: 'string', minLength: 1, maxLength: 160 },
    type: { enum: ISSUE_TYPES },
    severity: { enum: ['error', 'warn', 'info'] },
    blocking: { type: 'boolean' },
    message: { type: 'string', minLength: 1, maxLength: 1000 },
    evidence: { type: 'string', maxLength: 2000 },
    status: { enum: ISSUE_STATUSES },
    answer: { type: ['string', 'null'], maxLength: 4000 },
    dependencies: { type: 'array', items: { type: 'string', maxLength: 160 }, maxItems: 20 },
    occurrences: { type: 'integer', minimum: 1 },
    createdAt: { type: 'string', minLength: 1 },
    updatedAt: { type: 'string', minLength: 1 },
  },
});

export function issueKey(issue) {
  return [issue.companyId, issue.positionId || '', issue.fieldKey, issue.type].join('|');
}

export function createIssue({ id, companyId, positionId = null, fieldKey, type, severity = 'warn', blocking = false, message, evidence = '', dependencies = [], now }) {
  return {
    id,
    companyId,
    positionId,
    fieldKey,
    type,
    severity,
    blocking,
    message,
    evidence,
    status: 'open',
    answer: null,
    dependencies: [...dependencies],
    occurrences: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function validateIssue(issue) {
  validateSchema(issue, issueSchema);
  return issue;
}

export function groupIssues(issues = []) {
  const byCompany = new Map();
  for (const issue of issues) {
    const group = byCompany.get(issue.companyId) || {
      companyId: issue.companyId,
      open: 0,
      answered: 0,
      resolved: 0,
      blockingOpen: 0,
      positions: {},
    };
    group[issue.status] += 1;
    if (issue.blocking && issue.status !== 'resolved') group.blockingOpen += 1;
    if (issue.positionId) {
      group.positions[issue.positionId] = (group.positions[issue.positionId] || 0) + 1;
    }
    byCompany.set(issue.companyId, group);
  }
  return [...byCompany.values()];
}

export function openBlockingIssues(issues = [], companyId) {
  return issues.filter(issue => issue.companyId === companyId && issue.blocking && issue.status !== 'resolved');
}
