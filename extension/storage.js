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

let queue = Promise.resolve();

async function readKey(key) {
  if (extensionStorage) return (await extensionStorage.get(key))[key];
  const raw = localStorage.getItem(key);
  if (raw === null) return undefined;
  return JSON.parse(raw);
}

export async function loadAll() {
  const [blocks, profile, companies, aliases, companiesUnknown, facts] = await Promise.all(
    Object.values(KEYS).map(readKey),
  );
  return { blocks, profile, companies, aliases, companiesUnknown, facts };
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
    if (extensionStorage) await extensionStorage.set(snapshot);
    else {
      for (const [name, value] of Object.entries(snapshot)) {
        localStorage.setItem(KEYS[name], JSON.stringify(value));
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
      rawSource: typeof item.rawSource === 'string' ? item.rawSource : '',
    });
  }
  return { companies, unknown };
}
