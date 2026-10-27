// 资料库字段：本机个人信息列表，逐项确认。
// 只有「已确认」的字段才会进入公司信息卡的「已确认可复用」；解析导入一律为「待确认」。

function nextVersion(fact) {
  return Number.isInteger(fact?.version) && fact.version > 0 ? fact.version + 1 : 2;
}

export function makeFact(label = '', value = '', status = 'unconfirmed', source = 'manual') {
  return {
    id: crypto.randomUUID(),
    label: String(label),
    value: String(value),
    status: status === 'confirmed' ? 'confirmed' : 'unconfirmed',
    source: source === 'resume' ? 'resume' : 'manual',
    version: 1,
    confirmedAt: status === 'confirmed' ? new Date().toISOString() : null,
    updatedAt: new Date().toISOString(),
  };
}

// 修改内容即撤销人工确认；旧确认依据不再适用于新值。
export function reviseFact(fact, patch = {}) {
  const now = new Date().toISOString();
  return {
    ...fact,
    ...patch,
    id: fact.id,
    status: 'unconfirmed',
    confirmedAt: null,
    version: nextVersion(fact),
    updatedAt: now,
  };
}

// 人工确认只对当前版本有效；再次编辑会使该确认失效。
export function confirmFact(fact) {
  const now = new Date().toISOString();
  return {
    ...fact,
    status: 'confirmed',
    confirmedAt: now,
    updatedAt: now,
  };
}

export function validateFacts(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(item => item && typeof item === 'object' && !Array.isArray(item))
    .map(item => ({
      id: typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID(),
      label: typeof item.label === 'string' ? item.label : '',
      value: typeof item.value === 'string' ? item.value : '',
      status: item.status === 'confirmed' ? 'confirmed' : 'unconfirmed',
      source: item.source === 'resume' ? 'resume' : 'manual',
      version: Number.isInteger(item.version) && item.version > 0 ? item.version : 1,
      confirmedAt: typeof item.confirmedAt === 'string' ? item.confirmedAt : null,
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
    }));
}

// 从已解析简历生成字段草稿；全部为待确认，需要用户逐项核对。
export function factsFromResume(profile) {
  if (!profile) return [];
  const facts = [];
  const push = (label, value) => {
    const text = String(value || '').trim();
    if (label && text) facts.push(makeFact(label, text, 'unconfirmed', 'resume'));
  };
  const personal = profile.personal || {};
  push('姓名', personal.name);
  push('电话', personal.phone);
  push('邮箱', personal.email);
  push('GitHub', personal.github);
  push('求职意向', personal.intent);
  for (const entry of profile.education || []) push(`教育：${entry.name}`, [entry.major, entry.dates?.raw].filter(Boolean).join(' '));
  for (const entry of profile.internships || []) push(`实习：${entry.name}`, [entry.role, entry.location, entry.dates?.raw].filter(Boolean).join(' '));
  for (const entry of profile.projects || []) push(`项目：${entry.name}`, entry.dates?.raw || '');
  if (profile.skills?.length) push('技能', profile.skills.join('；'));
  if (profile.language?.length) push('语言与荣誉', profile.language.join('；'));
  if (profile.evaluation?.length) push('自我评价', profile.evaluation.join(' '));
  return facts;
}

export function factsSummary(facts = []) {
  const confirmed = [];
  const unconfirmed = [];
  for (const fact of facts) {
    const text = `${fact.label}：${fact.value}`;
    (fact.status === 'confirmed' ? confirmed : unconfirmed).push(text);
  }
  return { confirmed, unconfirmed };
}
