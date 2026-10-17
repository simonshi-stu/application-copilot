// 公司类型识别：纯本地规则打分 + 用户别名学习。
// 平台（Moka/飞书/北森…）与类型（银行/车企/制造/互联网/快消）是两回事，分开存储。
// 识别结果只是预选：用户可随时修改，修改会被记住（仅本机）。

export const COMPANY_TYPES = Object.freeze({
  bank: '银行/金融',
  auto: '车企/智驾/机器人',
  manufacturing: '制造/国企/央企',
  internet: '互联网/科技',
  fmcg: '快消/运营/零售',
  other: '其他/自定义',
});

// 公开知名公司的小型种子名单（仅用于本地识别演示，无任何个人数据）。
export const SEED_COMPANIES = Object.freeze({
  中国工商银行: 'bank', 中国建设银行: 'bank', 中国农业银行: 'bank', 中国银行: 'bank',
  招商银行: 'bank', 中信证券: 'bank', 中国平安: 'bank',
  比亚迪: 'auto', 特斯拉: 'auto', 小鹏汽车: 'auto', 理想汽车: 'auto', 长城汽车: 'auto',
  国家电网: 'manufacturing', 中国中车: 'manufacturing', 中国建筑: 'manufacturing',
  中国石化: 'manufacturing', 中国石油: 'manufacturing', 中芯国际: 'manufacturing',
  腾讯: 'internet', 阿里巴巴: 'internet', 字节跳动: 'internet', 百度: 'internet',
  美团: 'internet', 京东: 'internet', 网易: 'internet', 小米: 'internet', 华为: 'internet',
  伊利: 'fmcg', 蒙牛: 'fmcg', 康师傅: 'fmcg', 宝洁: 'fmcg', 联合利华: 'fmcg',
  安踏: 'fmcg', 李宁: 'fmcg', 可口可乐: 'fmcg',
});

const TYPE_RULES = {
  bank: { keywords: ['银行', '证券', '保险', '基金', '信托', '理财', '金租', '期货'], domain: /bank/i, label: '名称含金融关键词' },
  auto: { keywords: ['汽车', '智驾', '智能驾驶', '自动驾驶', '机器人', '激光雷达', '出行', '新能源车'], domain: null, label: '名称含车/机器人关键词' },
  manufacturing: { keywords: ['集团', '重工', '钢铁', '能源', '电气', '装备', '制造', '中核', '中电', '中铁', '中建', '中交', '航天', '航空', '化工', '矿业', '电网', '仪器'], domain: null, label: '名称含制造/央国企关键词' },
  internet: { keywords: ['科技', '网络', '信息', '软件', '游戏', '互联', '数码', '数据', '智能'], domain: null, label: '名称含科技/互联网关键词' },
  fmcg: { keywords: ['食品', '饮料', '乳业', '服饰', '家居', '零售', '超市', '快消', '日化', '运动', '酒业', '餐饮', '化妆'], domain: null, label: '名称含消费/零售关键词' },
};

// 同分时的确定性优先级：更具体的行业优先。
const PRIORITY = ['bank', 'auto', 'manufacturing', 'fmcg', 'internet', 'other'];

function scoreType(company, links, type) {
  const rule = TYPE_RULES[type];
  if (!rule) return { score: 0, reasons: [] };
  let score = 0;
  const reasons = [];
  if (SEED_COMPANIES[company] === type) { score += 3; reasons.push('已知公司名单'); }
  const hits = rule.keywords.filter(keyword => company.includes(keyword));
  if (hits.length) { score += 2; reasons.push(`${rule.label}：${hits.join('、')}`); }
  if (rule.domain && (links || []).some(url => rule.domain.test(url))) { score += 1; reasons.push('链接域名特征'); }
  return { score, reasons };
}

function confidenceFor(score) {
  if (score >= 4) return 0.95;
  if (score === 3) return 0.85;
  if (score === 2) return 0.7;
  if (score === 1) return 0.45;
  return 0.2;
}

export function classifyCompany(entry, { aliases = {} } = {}) {
  const company = (entry.company || '').trim();
  if (!company) {
    return { type: 'other', label: COMPANY_TYPES.other, confidence: 0.2, source: 'auto', reasons: ['未识别公司名'], alternatives: [] };
  }
  if (Object.hasOwn(aliases, company) && Object.hasOwn(COMPANY_TYPES, aliases[company])) {
    return { type: aliases[company], label: COMPANY_TYPES[aliases[company]], confidence: 0.99, source: 'learned', reasons: ['已记住你的选择'], alternatives: [] };
  }
  const links = (entry.links || []).map(link => link.url || link);
  const scored = PRIORITY.filter(type => type !== 'other')
    .map(type => ({ type, ...scoreType(company, links, type) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || PRIORITY.indexOf(a.type) - PRIORITY.indexOf(b.type));
  if (!scored.length) {
    return { type: 'other', label: COMPANY_TYPES.other, confidence: 0.2, source: 'auto', reasons: ['未匹配到类型特征'], alternatives: [] };
  }
  const best = scored[0];
  const alternatives = scored.slice(1).filter(item => item.score === best.score || item.score >= 2)
    .map(item => ({ type: item.type, label: COMPANY_TYPES[item.type], score: item.score }));
  return {
    type: best.type,
    label: COMPANY_TYPES[best.type],
    confidence: confidenceFor(best.score),
    source: 'auto',
    reasons: best.reasons,
    alternatives,
  };
}

export function setType(entry, type, aliases = {}) {
  if (!Object.hasOwn(COMPANY_TYPES, type)) throw new Error('未知公司类型。');
  const company = (entry.company || '').trim();
  if (company) aliases[company] = type;
  return { type, label: COMPANY_TYPES[type], confidence: 1, source: 'user', reasons: ['你选择的类型'], alternatives: [] };
}
