// 行业建议与标签维度：纯本地规则打分 + 用户别名学习。
// 平台（Moka/飞书/北森…）与行业是两回事；企业性质、岗位方向与本文件分开。
// 结果只是建议：显示匹配依据与来源，不展示未经校准的百分比。

export const INDUSTRIES = Object.freeze({
  bank: '银行/金融',
  auto: '车企/智驾/机器人',
  manufacturing: '制造/工业',
  internet: '互联网/科技',
  fmcg: '快消/运营/零售',
  other: '其他/未确定',
});

export const NATURES = Object.freeze({
  unknown: '未知',
  soe: '国企/央企',
  private: '民企',
  foreign: '外企',
  joint: '合资',
  other: '其他',
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
  manufacturing: { keywords: ['集团', '重工', '钢铁', '能源', '电气', '装备', '制造', '中核', '中电', '中铁', '中建', '中交', '航天', '航空', '化工', '矿业', '电网', '仪器'], domain: null, label: '名称含制造/工业关键词' },
  internet: { keywords: ['科技', '网络', '信息', '软件', '游戏', '互联', '数码', '数据', '智能'], domain: null, label: '名称含科技/互联网关键词' },
  fmcg: { keywords: ['食品', '饮料', '乳业', '服饰', '家居', '零售', '超市', '快消', '日化', '运动', '酒业', '餐饮', '化妆'], domain: null, label: '名称含消费/零售关键词' },
};

// 同分时的确定性优先级：更具体的行业优先。
const PRIORITY = ['bank', 'auto', 'manufacturing', 'fmcg', 'internet', 'other'];

function scoreIndustry(company, links, key) {
  const rule = TYPE_RULES[key];
  if (!rule) return { score: 0, reasons: [], matchLevel: 'none' };
  let score = 0;
  const reasons = [];
  const marks = [];
  if (SEED_COMPANIES[company] === key) { score += 3; reasons.push('已知公司名单'); marks.push('known'); }
  const hits = rule.keywords.filter(keyword => company.includes(keyword));
  if (hits.length) { score += 2; reasons.push(`${rule.label}：${hits.join('、')}`); marks.push('keyword'); }
  if (rule.domain && (links || []).some(url => rule.domain.test(url))) { score += 1; reasons.push('链接域名特征'); marks.push('domain'); }
  const matchLevel = marks.includes('known') ? 'known' : marks.includes('keyword') ? 'keyword' : marks.includes('domain') ? 'domain' : 'none';
  return { score, reasons, matchLevel };
}

export function classifyCompany(entry, { aliases = {} } = {}) {
  const company = (entry.company || '').trim();
  if (!company) {
    return { industry: 'other', label: INDUSTRIES.other, source: 'auto', matchLevel: 'none', reasons: ['未识别公司名'], alternatives: [] };
  }
  if (Object.hasOwn(aliases, company) && Object.hasOwn(INDUSTRIES, aliases[company])) {
    return { industry: aliases[company], label: INDUSTRIES[aliases[company]], source: 'learned', matchLevel: 'learned', reasons: ['已记住你的选择'], alternatives: [] };
  }
  const links = (entry.links || []).map(link => link.url || link);
  const scored = PRIORITY.filter(key => key !== 'other')
    .map(key => ({ industry: key, ...scoreIndustry(company, links, key) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || PRIORITY.indexOf(a.industry) - PRIORITY.indexOf(b.industry));
  if (!scored.length) {
    return { industry: 'other', label: INDUSTRIES.other, source: 'auto', matchLevel: 'none', reasons: ['未匹配到行业特征'], alternatives: [] };
  }
  const best = scored[0];
  const alternatives = scored.slice(1).filter(item => item.score === best.score || item.score >= 2)
    .map(item => ({ industry: item.industry, label: INDUSTRIES[item.industry], score: item.score }));
  return {
    industry: best.industry,
    label: INDUSTRIES[best.industry],
    source: 'auto',
    matchLevel: best.matchLevel,
    reasons: best.reasons,
    alternatives,
  };
}

export function setIndustry(entry, industry, aliases = {}) {
  if (!Object.hasOwn(INDUSTRIES, industry)) throw new Error('未知行业选项。');
  const company = (entry.company || '').trim();
  if (company) aliases[company] = industry;
  return { industry, label: INDUSTRIES[industry], source: 'user', matchLevel: 'user', reasons: ['你选择的行业'], alternatives: [] };
}
