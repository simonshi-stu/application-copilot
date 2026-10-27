// 公司顺序队列：一次只允许一个活动公司；完成后才可能自动推进。

import { QUEUE_STATUS, isCompanyTerminal } from './workflow.js';

export const queueSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['status', 'currentCompanyId', 'startedAt', 'pausedAt', 'updatedAt'],
  properties: {
    status: { enum: Object.values(QUEUE_STATUS) },
    currentCompanyId: { type: ['string', 'null'] },
    startedAt: { type: ['string', 'null'] },
    pausedAt: { type: ['string', 'null'] },
    updatedAt: { type: ['string', 'null'] },
  },
});

export function createQueue(now) {
  return {
    status: QUEUE_STATUS.IDLE,
    currentCompanyId: null,
    startedAt: null,
    pausedAt: null,
    updatedAt: now,
  };
}

export function orderedCompanies(companies = []) {
  return [...companies].sort((a, b) => a.queueOrder - b.queueOrder);
}

export function nextQueuedCompany(companies = []) {
  return orderedCompanies(companies).find(company => company.status === 'queued') || null;
}

export function currentCompany(companies = [], queue) {
  if (!queue?.currentCompanyId) return null;
  return companies.find(company => company.id === queue.currentCompanyId) || null;
}

export function canAdvancePast(company) {
  return Boolean(company && (isCompanyTerminal(company.status) || company.status === 'held'));
}
