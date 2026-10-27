// 公司／岗位台账：稳定 ID、原始来源、本人提交回执与官网核验分开保存。
// 结果文案由结构化记录确定性生成，模型不能凭自述写入“已提交”。

import { validateSchema } from './validation.js';
import {
  COMPANY_STATUS,
  POSITION_STATUS,
  blocksResubmission,
  isCompanyTerminal,
  isPositionTerminal,
} from './workflow.js';

const nullableString = { type: ['string', 'null'] };
const iso = { type: 'string', minLength: 1 };

// 最小稳定身份：规范名 + 批次。链接只做规范化提示，不把公司名当永久唯一键。
export function normalizeCompanyName(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeBatch(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function companyIdentityKey(name, batch = '') {
  return `${normalizeCompanyName(name)}\u0000${normalizeBatch(batch)}`;
}

export function normalizeOfficialId(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase();
}

const TRACKING_PARAMS = /^(utm_|spm$|from$|source$|share_)/i;

export function canonicalLinkHint(url) {
  try {
    const parsed = new URL(String(url));
    parsed.hash = '';
    parsed.username = '';
    parsed.password = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    const search = [...parsed.searchParams.entries()]
      .filter(([key]) => !TRACKING_PARAMS.test(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, value]);
    parsed.search = '';
    for (const [key, value] of search) parsed.searchParams.append(key, value);
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${parsed.protocol}//${parsed.host}${pathname}${parsed.search}`;
  } catch {
    return String(url || '').trim();
  }
}

export function findApplicationDuplicate(company, officialId, companies = [], positions = []) {
  const identity = company.identityKey || companyIdentityKey(company.name, company.batch);
  const official = normalizeOfficialId(officialId);
  const companyById = new Map(companies.map(item => [item.id, item]));
  return positions.find(position => {
    if (position.companyId === company.id || normalizeOfficialId(position.officialId) !== official) return false;
    const otherCompany = companyById.get(position.companyId);
    const otherIdentity = otherCompany?.identityKey || companyIdentityKey(otherCompany?.name, otherCompany?.batch);
    return otherIdentity === identity;
  }) || null;
}

export const linkSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['url', 'kind', 'source'],
  properties: {
    url: { type: 'string', minLength: 1, format: 'uri' },
    kind: { enum: ['apply', 'job', 'referral', 'other'] },
    source: { type: 'string', maxLength: 1000 },
  },
});

export const referralCandidateSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['value', 'source'],
  properties: {
    value: { type: 'string', minLength: 1, maxLength: 200 },
    source: { type: 'string', maxLength: 1000 },
  },
});

export const noPositionsEvidenceSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['reason', 'sourceUrl', 'checkedAt', 'checkedBy', 'resultText'],
  properties: {
    reason: { type: 'string', minLength: 2, maxLength: 500 },
    sourceUrl: { type: 'string', minLength: 1, format: 'uri' },
    checkedAt: { type: 'string', minLength: 1, format: 'date-time' },
    checkedBy: { enum: ['user', 'agent'] },
    resultText: { type: 'string', minLength: 2, maxLength: 2000 },
  },
});

export const positionSourceSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['url', 'checkedAt', 'evidence'],
  properties: {
    url: { type: 'string', minLength: 1, format: 'uri' },
    checkedAt: { type: 'string', minLength: 1, format: 'date-time' },
    evidence: { type: 'string', minLength: 1, maxLength: 2000 },
  },
});

export const submissionSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['reportedAt', 'reference', 'recordedBy', 'eventId'],
  properties: {
    reportedAt: { type: 'string', minLength: 1, format: 'date-time' },
    reference: { type: 'string', maxLength: 500 },
    recordedBy: { const: 'user' },
    eventId: { type: 'string', minLength: 1 },
  },
});

// 历史本人报告没有可靠的岗位 ID 时，仍然要保留一个可审计的公司级
// 记录。它和岗位提交回执使用不同 schema，避免用虚构的 officialId
// 拼出一条看似完整的岗位申请。
export const historicalSubmissionSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['reportedAt', 'reference', 'recordedBy', 'eventId', 'source'],
  properties: {
    reportedAt: { type: 'string', minLength: 1, format: 'date-time' },
    reference: { type: 'string', minLength: 1, maxLength: 1000 },
    recordedBy: { const: 'user' },
    eventId: { type: 'string', minLength: 1 },
    source: { const: 'user_history' },
  },
});

export const verificationSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['verifiedAt', 'sourceUrl', 'evidenceText', 'recordedBy', 'eventId'],
  properties: {
    verifiedAt: { type: 'string', minLength: 1, format: 'date-time' },
    sourceUrl: { type: 'string', minLength: 1, format: 'uri' },
    evidenceText: { type: 'string', minLength: 1, maxLength: 2000 },
    recordedBy: { const: 'user' },
    eventId: { type: 'string', minLength: 1 },
  },
});

export const transitionSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['at', 'from', 'to', 'event'],
  properties: {
    at: { type: 'string', minLength: 1 },
    from: { type: 'string', minLength: 1 },
    to: { type: 'string', minLength: 1 },
    event: { type: 'string', minLength: 1, maxLength: 100 },
  },
});

export const companySchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'id', 'name', 'batch', 'identityKey', 'links', 'referralCandidates', 'referralSelected', 'queueOrder',
    'status', 'resumeStatus', 'activePositionId', 'selectedPositionIds', 'noPositionsEvidence',
    'holdReason', 'skipReason', 'checkpoint', 'history', 'createdAt', 'updatedAt',
  ],
  properties: {
    id: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1, maxLength: 200 },
    batch: { type: 'string', maxLength: 100 },
    identityKey: { type: 'string', minLength: 1, maxLength: 500 },
    links: { type: 'array', items: linkSchema, maxItems: 30 },
    referralCandidates: { type: 'array', items: referralCandidateSchema, maxItems: 30 },
    referralSelected: nullableString,
    queueOrder: { type: 'integer', minimum: 1 },
    status: { enum: Object.values(COMPANY_STATUS) },
    resumeStatus: { type: ['string', 'null'] },
    activePositionId: { type: ['string', 'null'] },
    selectedPositionIds: { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 30 },
    noPositionsEvidence: { anyOf: [noPositionsEvidenceSchema, { type: 'null' }] },
    holdReason: { type: ['string', 'null'], maxLength: 500 },
    skipReason: { type: ['string', 'null'], maxLength: 500 },
    historicalSubmission: { anyOf: [historicalSubmissionSchema, { type: 'null' }] },
    checkpoint: {
      type: 'object',
      additionalProperties: false,
      required: ['phase', 'activePositionId', 'requiresObservation', 'updatedAt'],
      properties: {
        phase: { type: 'string', minLength: 1 },
        activePositionId: { type: ['string', 'null'] },
        requiresObservation: { type: 'boolean' },
        updatedAt: { type: ['string', 'null'] },
      },
    },
    history: { type: 'array', items: transitionSchema, maxItems: 80 },
    createdAt: iso,
    updatedAt: iso,
  },
});

export const positionSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: [
    'id', 'companyId', 'officialId', 'title', 'city', 'priority', 'status', 'source',
    'submission', 'verification', 'skipReason', 'history', 'createdAt', 'updatedAt',
  ],
  properties: {
    id: { type: 'string', minLength: 1 },
    companyId: { type: 'string', minLength: 1 },
    officialId: { type: 'string', minLength: 1, maxLength: 200 },
    title: { type: 'string', minLength: 1, maxLength: 300 },
    city: { type: 'string', maxLength: 100 },
    priority: { type: 'integer', minimum: 0 },
    status: { enum: Object.values(POSITION_STATUS) },
    source: positionSourceSchema,
    submission: { anyOf: [submissionSchema, { type: 'null' }] },
    verification: { anyOf: [verificationSchema, { type: 'null' }] },
    skipReason: { type: ['string', 'null'], maxLength: 500 },
    history: { type: 'array', items: transitionSchema, maxItems: 80 },
    createdAt: iso,
    updatedAt: iso,
  },
});

export function createCompany({ id, name, batch = '', links = [], referralCandidates = [], queueOrder, now }) {
  return {
    id,
    name,
    batch,
    identityKey: companyIdentityKey(name, batch),
    links,
    referralCandidates,
    referralSelected: null,
    queueOrder,
    status: COMPANY_STATUS.QUEUED,
    resumeStatus: null,
    activePositionId: null,
    selectedPositionIds: [],
    noPositionsEvidence: null,
    holdReason: null,
    skipReason: null,
    historicalSubmission: null,
    checkpoint: { phase: COMPANY_STATUS.QUEUED, activePositionId: null, requiresObservation: false, updatedAt: now },
    history: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createPosition({ id, companyId, officialId, title, city = '', source, now }) {
  return {
    id,
    companyId,
    officialId,
    title,
    city,
    priority: 0,
    status: POSITION_STATUS.CANDIDATE,
    source,
    submission: null,
    verification: null,
    skipReason: null,
    history: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function validateCompany(company) {
  validateSchema(company, companySchema);
  return company;
}

export function validatePosition(position) {
  validateSchema(position, positionSchema);
  return position;
}

export function selectedPositions(company, positions) {
  const order = new Map(company.selectedPositionIds.map((id, index) => [id, index]));
  return positions
    .filter(position => order.has(position.id) && position.companyId === company.id)
    .sort((a, b) => order.get(a.id) - order.get(b.id));
}

export function companyIsComplete(company, positions, openBlockingCount = 0) {
  if (company.status === COMPANY_STATUS.NO_POSITIONS || company.status === COMPANY_STATUS.SKIPPED) return true;
  if (company.status === COMPANY_STATUS.COMPLETED) return true;
  if (openBlockingCount > 0) return false;
  const selected = selectedPositions(company, positions);
  return selected.length > 0 && selected.every(position => isPositionTerminal(position.status));
}

export function companyResultText(company, positions) {
  if (company.historicalSubmission) return '已投递：历史本人记录（待官网核验）';
  if (company.status === COMPANY_STATUS.NO_POSITIONS) return '未投递：没有符合职位';
  if (company.status === COMPANY_STATUS.SKIPPED) {
    return `未投递：本人跳过${company.skipReason ? `（${company.skipReason}）` : ''}`;
  }
  const selected = selectedPositions(company, positions);
  if (!selected.length) return '待处理：尚未选择岗位';
  const verified = selected.filter(position => position.status === POSITION_STATUS.VERIFIED);
  const reported = selected.filter(position => position.status === POSITION_STATUS.SUBMITTED_REPORTED);
  const skipped = selected.filter(position => position.status === POSITION_STATUS.SKIPPED);
  const pending = selected.filter(position => !isPositionTerminal(position.status));
  const ready = pending.filter(position => position.status === POSITION_STATUS.AWAITING_HUMAN_SUBMIT);
  const waiting = pending.filter(position => position.status !== POSITION_STATUS.AWAITING_HUMAN_SUBMIT);
  const parts = [];
  if (verified.length) parts.push(`已投递：${verified.map(position => `${position.title}（官网已核验）`).join('、')}`);
  if (reported.length) parts.push(`已投递：${reported.map(position => `${position.title}（本人记录，待官网核验）`).join('、')}`);
  if (skipped.length) parts.push(`未投递：${skipped.map(position => `${position.title}（本人跳过）`).join('、')}`);
  if (ready.length) parts.push(`待本人提交：${ready.map(position => position.title).join('、')}`);
  if (waiting.length) parts.push(`待处理：${waiting.map(position => position.title).join('、')}`);
  return parts.join('；');
}

export function assertNotResubmittable(position, action = '再次提交') {
  if (blocksResubmission(position.status) || position.submission || position.verification) {
    throw new Error(`${action}被拒绝：岗位「${position.title}」已有本人提交回执或官网核验记录，禁止重复申请。`);
  }
}

export function positionPreventsResubmission(position) {
  return blocksResubmission(position.status) || Boolean(position.submission) || Boolean(position.verification);
}

export function companyHasBlockingPosition(company, positions) {
  return selectedPositions(company, positions).some(position => !isPositionTerminal(position.status));
}

export function isCompanyDone(status) {
  return isCompanyTerminal(status);
}
