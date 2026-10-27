// 统一本地存储边界：串行写入、逐键读取、旧数据迁移。
// chrome.storage.local 优先，普通页面回退 localStorage。不联网、不清理未知数据。
import { INDUSTRIES, NATURES } from './company-classifier.js';
import { STAGES } from './review-sheet.js';

const extensionStorage = globalThis.chrome?.storage?.local;

export const KEYS = {
  blocks: 'applicationCopilot.blocks.v1',
  profile: 'applicationCopilot.resume.v1',
  companies: 'applicationCopilot.companies.v1',
  aliases: 'applicationCopilot.companyAliases.v1',
  companiesUnknown: 'applicationCopilot.companies.unknownRaw.v1',
  facts: 'applicationCopilot.profileFacts.v1',
};

// 旧版本曾用短键（blocks/profile/...）写入 chrome.storage。读取时作为兼容回退，
// 新写入一律使用 KEYS 中的完整键；旧键保留不删除，避免破坏未知数据。
export const LEGACY_KEYS = Object.freeze({
  blocks: 'blocks',
  profile: 'profile',
  companies: 'companies',
  aliases: 'aliases',
  companiesUnknown: 'companiesUnknown',
  facts: 'facts',
});

const KEY_ENTRIES = Object.entries(KEYS);

let queue = Promise.resolve();

function storedValue(result, key) {
  return Object.hasOwn(result, key) ? result[key] : undefined;
}

async function readPair(name) {
  const key = KEYS[name];
  const legacy = LEGACY_KEYS[name];
  if (extensionStorage) {
    const result = await extensionStorage.get([key, legacy]);
    const value = storedValue(result, key);
    return value !== undefined ? value : storedValue(result, legacy);
  }
  const current = localStorage.getItem(key);
  if (current !== null) return JSON.parse(current);
  const old = localStorage.getItem(legacy);
  return old === null ? undefined : JSON.parse(old);
}

export async function loadAll() {
  const values = await Promise.all(KEY_ENTRIES.map(([name]) => readPair(name)));
  return Object.fromEntries(KEY_ENTRIES.map(([name], index) => [name, values[index]]));
}

export function saveAll(data = {}) {
  const snapshot = structuredClone({
    blocks: data.blocks ?? null,
    profile: data.profile ?? null,
    companies: data.companies ?? [],
    aliases: data.aliases ?? {},
    companiesUnknown: data.companiesUnknown ?? [],
    facts: data.facts ?? [],
  });
  const write = queue.then(async () => {
    if (extensionStorage) {
      const payload = Object.fromEntries(KEY_ENTRIES.map(([name, key]) => [key, snapshot[name]]));
      await extensionStorage.set(payload);
    } else {
      for (const [name, key] of KEY_ENTRIES) {
        localStorage.setItem(key, JSON.stringify(snapshot[name]));
      }
    }
  });
  queue = write.catch(() => {});
  return write;
}

// 旧数据迁移：保留候选与原文，不信任旧的自动选定码；
// 无法识别的条目原样返回，由调用方保留在 companiesUnknown，绝不静默删除。
export function migrateCompanies(raw) {
  if (raw === undefined || raw === null) return { companies: [], unknown: [] };
  if (!Array.isArray(raw)) return { companies: [], unknown: [raw] };
  const companies = [];
  const unknown = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.company !== 'string') {
      unknown.push(item);
      continue;
    }
    const legacyType = item.industry || item.type;
    let industry = null;
    if (legacyType && typeof legacyType === 'object'
      && typeof legacyType.type === 'string' && Object.hasOwn(INDUSTRIES, legacyType.type)) {
      industry = {
        value: legacyType.type,
        source: legacyType.source === 'user' ? 'user' : (legacyType.source === 'learned' ? 'learned' : 'auto'),
        reasons: Array.isArray(legacyType.reasons) ? legacyType.reasons.map(String) : [],
        alternatives: [],
      };
    } else if (legacyType && typeof legacyType === 'object'
      && typeof legacyType.value === 'string' && Object.hasOwn(INDUSTRIES, legacyType.value)) {
      industry = {
        value: legacyType.value,
        source: legacyType.source === 'user' ? 'user' : (legacyType.source === 'learned' ? 'learned' : 'auto'),
        reasons: Array.isArray(legacyType.reasons) ? legacyType.reasons.map(String) : [],
        alternatives: Array.isArray(legacyType.alternatives) ? legacyType.alternatives : [],
        matchLevel: typeof legacyType.matchLevel === 'string' ? legacyType.matchLevel : 'none',
      };
    }
    const r = item.referral && typeof item.referral === 'object' ? item.referral : {};
    const candidates = Array.isArray(r.candidates) ? r.candidates.map(String).filter(Boolean) : [];
    const legacyCode = typeof r.code === 'string' ? r.code.trim() : '';
    if (legacyCode && !candidates.includes(legacyCode)) candidates.push(legacyCode);
    const warnings = Array.isArray(item.warnings) ? item.warnings.map(String) : [];
    const referral = {
      candidates,
      conflict: candidates.length > 1 || Boolean(r.conflict),
      type: typeof r.type === 'string' ? r.type : 'none',
      // 旧版自动填入的 code 不作为已选定；候选与提示保留。
      selected: (() => {
        if (typeof r.selected !== 'string') return '';
        if (r.selected === 'none') return 'none';
        return candidates.includes(r.selected) ? r.selected : '';
      })(),
      legacyAutoValue: legacyCode || (typeof r.legacyAutoValue === 'string' ? r.legacyAutoValue : ''),
      bindingVerified: Boolean(r.bindingVerified),
    };
    const review = item.review === 'confirmed' ? 'confirmed'
      : item.review === 'needs_review' ? 'needs_review'
        : (warnings.length || referral.conflict ? 'needs_review' : 'draft');
    companies.push({
      id: typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID(),
      company: item.company,
      links: Array.isArray(item.links)
        ? item.links.filter(link => link && typeof link === 'object' && typeof link.url === 'string')
          .map(link => ({ url: link.url, kind: typeof link.kind === 'string' ? link.kind : 'apply' }))
        : [],
      platform: typeof item.platform === 'string' ? item.platform : 'none',
      referral,
      channelHint: typeof item.channelHint === 'string' ? item.channelHint : '',
      batch: typeof item.batch === 'string' ? item.batch : '',
      deadline: typeof item.deadline === 'string' ? item.deadline : '',
      warnings,
      review,
      nature: typeof item.nature === 'string' && Object.hasOwn(NATURES, item.nature) ? item.nature : 'unknown',
      direction: typeof item.direction === 'string' ? item.direction : '',
      industry,
      answers: item.answers && typeof item.answers === 'object' && !Array.isArray(item.answers)
        ? Object.fromEntries(Object.entries(item.answers).filter(([key, value]) => typeof key === 'string' && typeof value === 'string'))
        : {},
      stage: Object.hasOwn(STAGES, item.stage) ? item.stage : 'todo',
      sheetCopiedAt: typeof item.sheetCopiedAt === 'string' ? item.sheetCopiedAt : '',
      applicationRef: typeof item.applicationRef === 'string' ? item.applicationRef : '',
      appliedAt: typeof item.appliedAt === 'string' ? item.appliedAt : '',
      notes: typeof item.notes === 'string' ? item.notes : '',
      history: Array.isArray(item.history)
        ? item.history
          .filter(step => step && typeof step === 'object' && typeof step.to === 'string' && Object.hasOwn(STAGES, step.to))
          .map(step => ({
            at: typeof step.at === 'string' ? step.at : '',
            from: typeof step.from === 'string' && Object.hasOwn(STAGES, step.from) ? step.from : 'todo',
            to: step.to,
          }))
          .slice(-50)
        : [],
      fillDone: item.fillDone && typeof item.fillDone === 'object' && !Array.isArray(item.fillDone)
        ? Object.fromEntries(Object.entries(item.fillDone).filter(([key, value]) => typeof key === 'string' && value === true))
        : {},
      aiReview: item.aiReview && typeof item.aiReview === 'object' && Array.isArray(item.aiReview.findings)
        ? {
          at: typeof item.aiReview.at === 'string' ? item.aiReview.at : '',
          findings: item.aiReview.findings
            .filter(finding => finding && typeof finding === 'object' && typeof finding.message === 'string')
            .map(finding => ({
              severity: ['error', 'warn', 'info'].includes(finding.severity) ? finding.severity : 'info',
              area: String(finding.area || ''),
              message: String(finding.message),
              suggestion: String(finding.suggestion || ''),
            })),
        }
        : null,
      rawSource: typeof item.rawSource === 'string' ? item.rawSource : '',
    });
  }
  return { companies, unknown };
}
