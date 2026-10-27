// Moka 字段语义映射：纯函数，不做模型判断，不决定填写值。
// 只输出候选 factKey 与需要人工辨别的项。姓名、电话、邮箱、学校、实习公司/地点/岗位/正文、
// 项目名称/内容/本人职责严格分开；重复经历必须带稳定 entityId 才建议自动填写。

export const MOKA_FACT_KEYS = Object.freeze({
  NAME: 'basic.name',
  PHONE: 'basic.phone',
  EMAIL: 'basic.email',
  SCHOOL: 'education.school',
  INTERNSHIP_COMPANY: 'internship.company',
  INTERNSHIP_LOCATION: 'internship.location',
  INTERNSHIP_ROLE: 'internship.role',
  INTERNSHIP_CONTENT: 'internship.content',
  PROJECT_NAME: 'project.name',
  PROJECT_CONTENT: 'project.content',
  PROJECT_RESPONSIBILITIES: 'project.responsibilities',
});

export const MOKA_FACT_LABELS = Object.freeze({
  'basic.name': '姓名',
  'basic.phone': '电话',
  'basic.email': '邮箱',
  'education.school': '学校',
  'internship.company': '实习公司',
  'internship.location': '实习地点',
  'internship.role': '实习岗位',
  'internship.content': '实习正文',
  'project.name': '项目名称',
  'project.content': '项目内容',
  'project.responsibilities': '本人职责',
});

const EXPERIENCE_REGIONS = new Set(['education', 'internship', 'work', 'project']);

const NAME_PATTERN = /^(?:(?:真实|中文|申请人|本人)\s*)?姓名$|^名字$|^(?:full\s*)?name$/i;
const NAME_NEGATIVE = /(项目|公司|学校|院校|单位|企业|机构|文件|证书|岗位|职位|用户名|账号|账户|联系人|推荐人|导师|父亲|母亲|紧急|英文|拼音|曾用名|昵称|部门|部门名称)/;
const PHONE_PATTERN = /^(?:手机号码?|手机号|手机|联系电话|电话号码?|联系方式|电话|mobile(?:\s*phone)?|phone(?:\s*number)?|tel(?:ephone)?)$/i;
const PHONE_NEGATIVE = /(紧急|家庭|父亲|母亲|联系人|推荐人|导师|区号|分机|验证码|邮箱|传真)/;
const EMAIL_PATTERN = /^(?:电子邮箱|邮箱地址|邮箱|电子邮件|e-?mail)$/i;
const EMAIL_NEGATIVE = /(验证|确认|备用|第二|密码)/;
const SCHOOL_PATTERN = /^(?:毕业院校|就读学校|学校名称|院校名称|学校|院校|school|university|college)$/i;
const SCHOOL_EXTRA = /(?:毕业|就读)\s*(?:院校|学校)/;
const SCHOOL_NEGATIVE = /(专业|学历|学位|地点|城市|排名|邮箱|电话|公司|单位|类型|性质|是否|所在地)/;
const COMPANY_PATTERN = /^(?:实习公司|公司名称|公司|单位名称|单位|企业名称|机构名称|employer|company)$/i;
const COMPANY_EXTRA = /(?:实习|工作)\s*(?:公司|单位|企业|机构)/;
const COMPANY_NEGATIVE = /(项目|学校|推荐|证明人|联系人|邮箱|电话|地址|行业|规模|性质|是否|描述|内容|职责)/;
const LOCATION_PATTERN = /^(?:实习地点|工作地点|实习城市|工作城市|地点|城市|base|location|city)$/i;
const LOCATION_NEGATIVE = /(公司|学校|籍贯|户口|期望|意向|地址|邮编)/;
const ROLE_PATTERN = /^(?:(?:实习)?(?:岗位|职位|职务)(?:名称)?|role|position|title)$/i;
const ROLE_NEGATIVE = /(项目|公司|部门|序列|类别|期望|意向|招聘|城市)/;
const INTERNSHIP_CONTENT_PATTERN = /^(?:实习内容|实习正文|工作内容|实习描述|工作描述|职责描述|工作职责|主要职责|实习职责|description|responsibilities|duties)$/i;
const INTERNSHIP_CONTENT_EXTRA = /(实习|工作)\s*(?:内容|描述|职责)/;
const INTERNSHIP_CONTENT_NEGATIVE = /(项目|公司|岗位|职位|名称|时间|日期|证明人|联系人|地点)/;
const PROJECT_NAME_PATTERN = /^(?:项目名称|项目名|课题名称|project\s*name|project\s*title)$/i;
const PROJECT_NAME_NEGATIVE = /(内容|描述|职责|责任|角色|时间|日期|链接|公司|学校|课题内容)/;
const PROJECT_CONTENT_PATTERN = /^(?:项目内容|项目描述|项目简介|项目介绍|项目背景|课题内容|project\s*(?:description|content|summary))$/i;
const PROJECT_CONTENT_NEGATIVE = /(职责|责任|角色|名称|时间|日期|链接|本人)/;
const PROJECT_RESPONSIBILITY_PATTERN = /^(?:本人职责|项目职责|个人职责|我的职责|职责描述|职责|responsibilities|my\s+role|my\s+responsibilities|role\s+in\s+project)$/i;
const PROJECT_RESPONSIBILITY_EXTRA = /(本人|个人|项目)\s*职责/;
const PROJECT_RESPONSIBILITY_NEGATIVE = /(项目内容|项目描述|项目简介|名称|时间|日期|链接)/;

function normalizeLoose(value) {
  return String(value == null ? '' : value)
    .replace(/[\s\u3000]+/g, ' ')
    .trim()
    .replace(/[*＊:：]+$/g, '')
    .trim();
}

export function normalizeFieldLabel(label) {
  return normalizeLoose(label);
}

function variants(label) {
  const normalized = normalizeLoose(label);
  if (!normalized) return [];
  const result = new Set([normalized]);
  const base = normalized.replace(/[（(][^）)]{1,30}[）)]/g, '').trim();
  if (base) result.add(base);
  const withoutColon = normalized.replace(/[：:].*$/, '').trim();
  if (withoutColon) result.add(withoutColon);
  return [...result];
}

function firstMatch(label, pattern) {
  return variants(label).some((value) => pattern.test(value));
}

function negative(label, pattern) {
  return variants(label).some((value) => pattern.test(value));
}

function exactMatch(label, pattern) {
  return variants(label).some((value) => pattern.test(value));
}

function matchBasic(control, label) {
  const region = control.region?.type || 'unknown';
  if (!['basic', 'unknown'].includes(region)) return null;
  if (firstMatch(label, NAME_PATTERN)) {
    if (negative(label, NAME_NEGATIVE)) return { kind: 'ambiguous', reason: '姓名标签带有项目/公司/账号等上下文，不能确定是本人姓名。' };
    return { factKey: MOKA_FACT_KEYS.NAME, confidence: 'high', matchType: 'exact' };
  }
  if (firstMatch(label, PHONE_PATTERN)) {
    if (negative(label, PHONE_NEGATIVE)) return { kind: 'ambiguous', reason: '电话标签带有联系人/验证码等上下文，不能确定是本人电话。' };
    return { factKey: MOKA_FACT_KEYS.PHONE, confidence: 'high', matchType: 'exact' };
  }
  if (firstMatch(label, EMAIL_PATTERN)) {
    if (negative(label, EMAIL_NEGATIVE)) return { kind: 'ambiguous', reason: '邮箱标签带有验证/备用等上下文，不能确定是本人主邮箱。' };
    return { factKey: MOKA_FACT_KEYS.EMAIL, confidence: 'high', matchType: 'exact' };
  }
  return null;
}

function matchSchool(control, label) {
  const region = control.region?.type || 'unknown';
  if (!['education', 'basic', 'unknown'].includes(region)) return null;
  if (!(firstMatch(label, SCHOOL_PATTERN) || (region === 'education' && exactMatch(label, SCHOOL_EXTRA)))) return null;
  if (negative(label, SCHOOL_NEGATIVE)) {
    return { kind: 'ambiguous', reason: '学校标签带有专业/地点/学历等上下文，需人工确认。' };
  }
  return { factKey: MOKA_FACT_KEYS.SCHOOL, confidence: 'high', matchType: 'exact' };
}

function matchInternship(control, label) {
  const region = control.region?.type || 'unknown';
  if (region === 'work') {
    return { kind: 'unsupported', reason: '当前只映射“实习”区域；工作经历字段需人工确认，避免把实习事实填到全职经历。' };
  }
  if (region !== 'internship') return null;

  if (firstMatch(label, COMPANY_PATTERN) || exactMatch(label, COMPANY_EXTRA)) {
    if (negative(label, COMPANY_NEGATIVE)) return { kind: 'ambiguous', reason: '实习公司标签带有项目/证明人/联系方式等上下文，需人工确认。' };
    return { factKey: MOKA_FACT_KEYS.INTERNSHIP_COMPANY, confidence: 'high', matchType: 'exact' };
  }
  if (firstMatch(label, LOCATION_PATTERN)) {
    if (negative(label, LOCATION_NEGATIVE)) return { kind: 'ambiguous', reason: '实习地点标签带有籍贯/期望等上下文，需人工确认。' };
    return { factKey: MOKA_FACT_KEYS.INTERNSHIP_LOCATION, confidence: 'high', matchType: 'exact' };
  }
  if (firstMatch(label, ROLE_PATTERN)) {
    if (negative(label, ROLE_NEGATIVE)) return { kind: 'ambiguous', reason: '实习岗位标签带有项目/期望等上下文，需人工确认。' };
    return { factKey: MOKA_FACT_KEYS.INTERNSHIP_ROLE, confidence: 'high', matchType: 'exact' };
  }
  if (firstMatch(label, INTERNSHIP_CONTENT_PATTERN) || exactMatch(label, INTERNSHIP_CONTENT_EXTRA)) {
    if (negative(label, INTERNSHIP_CONTENT_NEGATIVE)) return { kind: 'ambiguous', reason: '实习正文标签带有项目/名称/时间等上下文，需人工确认。' };
    return { factKey: MOKA_FACT_KEYS.INTERNSHIP_CONTENT, confidence: 'high', matchType: 'exact' };
  }
  return null;
}

function matchProject(control, label) {
  const region = control.region?.type || 'unknown';
  if (region !== 'project') return null;

  if (firstMatch(label, PROJECT_RESPONSIBILITY_PATTERN) || exactMatch(label, PROJECT_RESPONSIBILITY_EXTRA)) {
    if (negative(label, PROJECT_RESPONSIBILITY_NEGATIVE)) return { kind: 'ambiguous', reason: '项目职责标签带有内容/名称等上下文，需人工确认。' };
    return { factKey: MOKA_FACT_KEYS.PROJECT_RESPONSIBILITIES, confidence: 'high', matchType: 'exact' };
  }
  if (firstMatch(label, PROJECT_CONTENT_PATTERN)) {
    if (negative(label, PROJECT_CONTENT_NEGATIVE)) return { kind: 'ambiguous', reason: '项目内容标签带有职责/名称等上下文，需人工确认。' };
    return { factKey: MOKA_FACT_KEYS.PROJECT_CONTENT, confidence: 'high', matchType: 'exact' };
  }
  if (firstMatch(label, PROJECT_NAME_PATTERN) || variants(label).includes('项目')) {
    if (negative(label, PROJECT_NAME_NEGATIVE)) return { kind: 'ambiguous', reason: '项目名称标签带有内容/职责等上下文，需人工确认。' };
    return { factKey: MOKA_FACT_KEYS.PROJECT_NAME, confidence: 'high', matchType: 'exact' };
  }
  return null;
}

function matchControl(control) {
  const label = normalizeFieldLabel(control?.label);
  const region = control?.region?.type || 'unknown';
  if (!label && region === 'unknown') {
    return { kind: 'ambiguous', reason: '字段没有可辨认标签或经历区域，保持 unknown。', possibleFactKeys: [] };
  }
  if (region === 'credential') {
    return { kind: 'unsupported', reason: '登录/凭据区域不允许自动填写。', possibleFactKeys: [] };
  }
  if (region === 'work') {
    return { kind: 'unsupported', reason: '工作经历区域尚未映射；不使用实习事实自动填写。', possibleFactKeys: [] };
  }

  const matches = [];
  for (const result of [
    matchBasic(control, label),
    matchSchool(control, label),
    matchInternship(control, label),
    matchProject(control, label),
  ]) {
    if (!result) continue;
    if (result.kind === 'ambiguous' || result.kind === 'unsupported') return result;
    matches.push(result);
  }

  if (!matches.length) {
    return {
      kind: 'ambiguous',
      reason: '字段语义未可靠匹配，保持 unknown，不自动填写。',
      possibleFactKeys: [],
    };
  }
  const unique = [...new Map(matches.map((match) => [match.factKey, match])).values()];
  if (unique.length > 1) {
    return {
      kind: 'ambiguous',
      reason: '字段可同时匹配多个事实类型，需人工确认。',
      possibleFactKeys: unique.map((match) => match.factKey),
    };
  }
  return unique[0];
}

function candidateKey(candidate) {
  return `${candidate.factKey}|${candidate.regionEntityId || 'single'}`;
}

/**
 * 只输出映射候选和人工辨别项，不填写、不判定录用。
 * @param {Array} controls observe() 返回的 controls
 */
export function suggestMokaFieldMappings(controls) {
  const list = Array.isArray(controls) ? controls : [];
  const rawCandidates = [];
  const ambiguous = [];
  const unsupported = [];

  for (const control of list) {
    if (!control || typeof control !== 'object') continue;
    const controlRef = typeof control.controlRef === 'string'
      ? control.controlRef
      : (typeof control.ref === 'string' ? control.ref : null);
    if (!controlRef) continue;
    const label = normalizeFieldLabel(control.label);
    const region = control.region && typeof control.region === 'object' ? control.region : { type: 'unknown' };
    const base = {
      controlRef,
      label,
      regionType: region.type || 'unknown',
      regionLabel: typeof region.label === 'string' ? region.label : '',
      regionEntityId: region.entityId || null,
      controlType: control.type || control.tag || 'unknown',
    };

    if (region.ambiguous) {
      ambiguous.push({
        ...base,
        reason: '重复经历区域无法稳定分组，必须由本人确认 entityId 后再填写。',
        possibleFactKeys: [],
      });
      continue;
    }
    if (control.writable === false) {
      unsupported.push({
        ...base,
        code: control.writableReason || 'NOT_WRITABLE',
        reason: control.writableReason === 'AMBIGUOUS_REGION'
          ? '重复经历区域无法稳定分组，不能自动填写。'
          : '控件当前不可写或不在本层支持范围。',
      });
      continue;
    }
    if (region.type === 'credential') {
      unsupported.push({ ...base, code: 'CREDENTIAL_REGION_BLOCKED', reason: '登录/凭据区域不允许自动填写。' });
      continue;
    }

    const match = matchControl(control);
    if (match.kind === 'ambiguous') {
      ambiguous.push({
        ...base,
        reason: match.reason,
        possibleFactKeys: match.possibleFactKeys || [],
      });
      continue;
    }
    if (match.kind === 'unsupported') {
      unsupported.push({
        ...base,
        code: 'REGION_NOT_SUPPORTED',
        reason: match.reason,
        possibleFactKeys: match.possibleFactKeys || [],
      });
      continue;
    }

    rawCandidates.push({
      ...base,
      factKey: match.factKey,
      factLabel: MOKA_FACT_LABELS[match.factKey] || match.factKey,
      confidence: match.confidence || 'medium',
      matchType: match.matchType || 'contains',
      requiresEntityId: EXPERIENCE_REGIONS.has(region.type) && ['education', 'internship', 'project'].includes(region.type),
      choiceRequired: (control.type || control.tag) === 'select',
      optionCount: Number.isInteger(control.optionCount) ? control.optionCount : null,
      hasValue: control.hasValue === true,
      note: control.hasValue
        ? '字段已有值；本层默认不覆盖，需本人确认或手动清空。'
        : ((control.type || control.tag) === 'select'
          ? '需要从快照 options 中选择精确且唯一的选项后再生成计划。'
          : null),
    });
  }

  const byKey = new Map();
  for (const candidate of rawCandidates) {
    const key = candidateKey(candidate);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(candidate);
  }

  const duplicateKeys = new Set();
  for (const [key, group] of byKey) {
    if (group.length > 1) duplicateKeys.add(key);
  }
  const byFact = new Map();
  for (const candidate of rawCandidates) {
    if (!byFact.has(candidate.factKey)) byFact.set(candidate.factKey, []);
    byFact.get(candidate.factKey).push(candidate);
  }

  const candidates = [];
  for (const candidate of rawCandidates) {
    if (duplicateKeys.has(candidateKey(candidate))) {
      ambiguous.push({
        controlRef: candidate.controlRef,
        label: candidate.label,
        regionType: candidate.regionType,
        regionLabel: candidate.regionLabel,
        regionEntityId: candidate.regionEntityId,
        controlType: candidate.controlType,
        reason: `同一经历区域内出现多个「${candidate.factLabel}」候选，无法确定唯一控件。`,
        possibleFactKeys: [candidate.factKey],
      });
      continue;
    }

    const group = byFact.get(candidate.factKey) || [];
    const entities = new Set(group.map((item) => item.regionEntityId || 'single'));
    const nullEntityCount = group.filter((item) => !item.regionEntityId).length;
    if (group.length > 1 && nullEntityCount > 0) {
      ambiguous.push({
        controlRef: candidate.controlRef,
        label: candidate.label,
        regionType: candidate.regionType,
        regionLabel: candidate.regionLabel,
        regionEntityId: candidate.regionEntityId,
        controlType: candidate.controlType,
        reason: `「${candidate.factLabel}」出现多次，但至少一个控件没有稳定 entityId，不能自动对应。`,
        possibleFactKeys: [candidate.factKey],
      });
      continue;
    }

    candidates.push({
      ...candidate,
      requiresEntityBinding: entities.size > 1,
      entityCount: entities.size,
    });
  }

  const notes = [
    '候选只表示字段语义可能对应的事实类型，不表示已有可填值或已确认。',
    '重复经历（实习/项目/教育）只有 entityId 稳定且计划显式绑定同一 entityId 时才允许自动填写。',
    '下拉字段不会自动选选项；计划必须携带精确且唯一的 optionValue/optionLabel。',
    '工作经历区域、Moka 自定义组件和未知字段保持人工处理。',
  ];

  return {
    candidates,
    ambiguous,
    unsupported,
    notes,
    counts: {
      candidates: candidates.length,
      ambiguous: ambiguous.length,
      unsupported: unsupported.length,
    },
    factKeys: MOKA_FACT_KEYS,
    factLabels: MOKA_FACT_LABELS,
  };
}
