// 公司与内推信息解析（纯本地、纯函数，无网络）。
// 输入：任意粘贴文本（群消息、文档表格、链接列表）。
// 输出：结构化条目草稿——公司名、链接、内推码、渠道提示、批次、截止日期、原文。
// 解析结果永远只是草稿：由用户评审修改后才可保存。

const TITLE_RE = /【([^】\n]{1,60})】/;
const NUMBER_PREFIX = /^\s*(?:[0-9]{1,3}\s*[.、)）:：]|[0-9]\uFE0F?\u20E3|[\u2460-\u2473]|\uD83D\uDD1F)/u;
const CUT_RE = /(?:20\d{2}\s*届|校园招聘|校招|秋招|春招|提前批|正式批|招聘|岗位投递链接|投递链接|申请链接|内推链接|内推码|内推|合集|\d{1,2}月\d{1,2}日(?:截止)?)/;
const LEAD_DECOR = /^[\s⚠️❗📌🔗✨🎉🔥💼📮🌟✅🆕🈶]/u;

export const COMPANIES_SCHEMA = 'application-copilot.companies.v1';

export function normalizeNewlines(text) {
  return (text || '').replace(/\r\n?/g, '\n');
}

function stripLeadDecor(line) {
  let value = line.replace(NUMBER_PREFIX, '').trim();
  let previous;
  do {
    previous = value;
    value = value.replace(LEAD_DECOR, '').replace(/^新增\s*/, '').trim();
  } while (value !== previous);
  return value;
}

export function cleanCompanyName(input) {
  let name = stripLeadDecor(input || '');
  const cut = name.search(CUT_RE);
  if (cut > 0) name = name.slice(0, cut);
  return name.replace(/[\s，,、：:；;·—–\-~|｜]+$/u, '')
    .replace(/\s*20\d{2}\s*$/u, '')
    .replace(/\s+/g, ' ').trim();
}

function collectUrls(raw) {
  const found = [];
  const seen = new Set();
  const push = (url, index) => {
    const cleaned = url.replace(/[),.;，。；、\]】]+$/u, '');
    if (!cleaned || seen.has(cleaned)) return;
    seen.add(cleaned);
    const before = raw.slice(Math.max(0, index - 18), index);
    const kind = /登记|文档|表格|合集|表单/.test(before) ? 'doc' : (/内推|推荐|邀请/.test(before) ? 'referral' : 'apply');
    found.push({ url: cleaned, kind });
  };
  for (const match of raw.matchAll(/https?:\/\/[^\s"'<>【】（）()]+/gu)) push(match[0], match.index);
  for (const pattern of [
    /(?:^|[\s：:🔗])((?:dwz\.cn|wxmpurl\.cn|s\.51job\.com|job\.qq\.com)\/[^\s【】"'<>（）()]*)/giu,
    /(?:^|[\s：:🔗])((?:[a-z0-9-]+\.)+(?:com|cn|net|org|io|co)(?:\/[^\s【】"'<>（）()]+)+)/giu,
  ]) {
    for (const match of raw.matchAll(pattern)) {
      if (match[0].includes('@')) continue;
      push(match[1], match.index);
    }
  }
  return found;
}

function collectCodes(raw) {
  const codes = [];
  const seen = new Set();
  const push = (value, source) => {
    const code = String(value).trim();
    if (!code || seen.has(code)) return;
    seen.add(code);
    codes.push({ value: code, source });
  };
  for (const match of raw.matchAll(/[?&]recommendCode=([A-Za-z0-9_-]{3,40})/gu)) push(match[1], 'link_param');
  for (const match of raw.matchAll(/(?:内推码|推荐码|内推编号|内推ID|邀请码)\s*[:：]?\s*([A-Za-z0-9_-]{4,40})/gu)) push(match[1], 'text');
  for (const match of raw.matchAll(/([A-Za-z0-9]{5,40})\s*[（(]\s*注意[^）)]*内推码[^）)]*[）)]/gu)) push(match[1], 'text');
  for (const match of raw.matchAll(/acotycoCode=([A-Za-z0-9_-]{3,40})/gu)) push(match[1], 'link_param');
  return codes;
}

export function detectChannel(raw) {
  if (/校园大使|大使推荐/.test(raw)) return '大使推荐';
  if (/员工内推|内部推荐|员工推荐/.test(raw)) return '员工内推';
  if (/链接自带/.test(raw)) return '链接自带';
  if (/点击链接[^。\n]{0,12}即可/.test(raw)) return '点击链接即可内推';
  if (/内推(?!码)/.test(raw)) return '内推（未注明类型）';
  return '';
}

function detectBatch(raw) {
  const match = raw.match(/20\d{2}\s*届|提前批|正式批|秋招|春招/);
  return match ? match[0].replace(/\s/g, '') : '';
}

function detectDeadline(raw) {
  const match = raw.match(/\d{1,2}月\d{1,2}日[^。\n]{0,6}截止/) || raw.match(/截止[^。\n]{0,14}/);
  return match ? match[0].trim() : '';
}

export function detectPlatform(urls) {
  const rules = [
    [/mokahr\.com/i, 'moka'],
    [/jobs\.feishu\.cn/i, 'feishu'],
    [/zhiye\.com/i, 'beisen'],
    [/hotjob\.cn/i, 'hotjob'],
    [/51job\.com/i, '51job'],
    [/liepin\.com/i, 'liepin'],
    [/shixiseng\.com/i, 'shixiseng'],
    [/nowcoder\.com/i, 'nowcoder'],
  ];
  for (const url of urls || []) {
    for (const [pattern, name] of rules) if (pattern.test(url)) return name;
  }
  return urls && urls.length ? 'other' : 'none';
}

export function extractCompanyName(raw) {
  const title = raw.match(TITLE_RE);
  if (title) return cleanCompanyName(title[1]);
  const firstLine = raw.split('\n').map(line => line.trim())
    .find(line => line && !/^(?:https?:\/\/|🔗|内推码|推荐码)/.test(line)) || '';
  let name = firstLine;
  const urlIndex = name.search(/https?:\/\//);
  if (urlIndex >= 0) name = name.slice(0, urlIndex);
  return cleanCompanyName(name);
}

function extractEntry(raw, id) {
  const urls = collectUrls(raw);
  const codes = collectCodes(raw);
  const candidates = [...new Set(codes.map(code => code.value))];
  const company = extractCompanyName(raw);
  const warnings = [];
  if (!company) warnings.push('未识别公司名，请手动填写。');
  if (!urls.length) warnings.push('未识别链接，请补充。');
  return {
    id,
    company,
    links: urls,
    platform: detectPlatform(urls.map(item => item.url)),
    referral: {
      code: candidates[0] || '',
      candidates,
      conflict: candidates.length > 1,
      type: codes.some(code => code.source === 'link_param') ? 'link_builtin' : (codes.length ? 'text' : 'none'),
      verified: false,
    },
    channelHint: detectChannel(raw),
    batch: detectBatch(raw),
    deadline: detectDeadline(raw),
    warnings,
    status: 'new',
    rawSource: raw,
  };
}

export function parseCompanies(text, makeId = () => crypto.randomUUID()) {
  const lines = normalizeNewlines(text).split('\n');
  const blocks = [];
  let current = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (NUMBER_PREFIX.test(line) || TITLE_RE.test(line) || !current) {
      current = [line];
      blocks.push(current);
    } else {
      current.push(line);
    }
  }
  const entries = [];
  let skipped = 0;
  for (const block of blocks) {
    const raw = block.join('\n').trim();
    const hasSignal = /https?:\/\//.test(raw) || /【[^】]+】/.test(raw) || /(?:内推码|推荐码)/.test(raw);
    if (!hasSignal) { skipped++; continue; }
    entries.push(extractEntry(raw, makeId()));
  }
  return { entries, skipped, total: entries.length };
}

export function companyKey(entry) {
  return `${(entry.company || '').trim()}|${entry.links && entry.links[0] ? entry.links[0].url : ''}`;
}
