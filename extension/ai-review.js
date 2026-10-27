// AI 复核：可选。把当前公司与最少必要的已确认资料发给用户自带的 OpenAI 兼容接口，
// 只返回问题清单，不修改任何字段、不生成经历内容、不访问招聘网站。
// 未确认字段、家庭/敏感字段、备注与未确认段落默认不进入请求体。

import { textForCopy } from './blocks.js';

const SENSITIVE_LABEL = /(父母|父亲|母亲|家庭|家人|亲属|配偶|子女|紧急联系人|身份证|护照|户口|户籍|婚姻|健康|病史|疾病|残疾|征信|银行卡|政治面貌|宗教)/;

export function isSensitiveLabel(label) {
  return SENSITIVE_LABEL.test(String(label || ''));
}

export function isSensitiveFact(fact) {
  return Boolean(fact && (['sensitive', 'family'].includes(fact.sensitivity) || isSensitiveLabel(fact.label)));
}

function usableFacts(facts = []) {
  return facts.filter(fact => fact
    && fact.status === 'confirmed'
    && !isSensitiveFact(fact)
    && typeof fact.value === 'string'
    && fact.value.trim());
}

function usableBlocks(blocks = []) {
  const result = [];
  for (const block of blocks) {
    try {
      const text = textForCopy(block);
      result.push({ kind: block.kind, item: block.item, text });
    } catch { /* 未确认或已修改的段落不发送 */ }
  }
  return result;
}

function usableAnswers(answers = {}) {
  const result = {};
  for (const [question, answer] of Object.entries(answers || {})) {
    if (typeof answer !== 'string' || !answer.trim() || isSensitiveLabel(question)) continue;
    result[question] = answer;
  }
  return result;
}

export function describeReviewScope(entry = {}, { facts = [], blocks = [] } = {}) {
  const safeFacts = usableFacts(facts);
  const safeBlocks = usableBlocks(blocks);
  const answers = usableAnswers(entry.answers);
  const unconfirmedFacts = facts.filter(fact => fact?.status !== 'confirmed' && String(fact?.value || '').trim()).length;
  const sensitiveFacts = facts.filter(fact => isSensitiveFact(fact) && String(fact?.value || '').trim()).length;
  const invalidBlocks = blocks.filter(block => {
    try { textForCopy(block); return false; } catch { return true; }
  }).length;
  return {
    company: String(entry.company || ''),
    factLabels: safeFacts.map(fact => String(fact.label || '')),
    blockLabels: safeBlocks.map(block => String(block.item || block.kind || '')),
    answerQuestions: Object.keys(answers),
    includesReferral: Boolean(entry.referral?.selected && entry.referral.selected !== 'none'),
    excluded: {
      unconfirmedFacts,
      sensitiveFacts,
      unconfirmedOrChangedBlocks: invalidBlocks,
      notes: Boolean(entry.notes),
    },
  };
}

export function buildReviewPrompt(entry = {}, { facts = [], blocks = [] } = {}) {
  const safeFacts = usableFacts(facts);
  const safeBlocks = usableBlocks(blocks);
  const payload = {
    company: String(entry.company || ''),
    industry: entry.industry?.label || entry.industry?.value || '',
    stage: entry.stage,
    review: entry.review,
    linkCount: Array.isArray(entry.links) ? entry.links.length : 0,
    referral: entry.referral?.selected && entry.referral.selected !== 'none'
      ? { selected: entry.referral.selected }
      : null,
    answers: usableAnswers(entry.answers),
    warningCount: Array.isArray(entry.warnings) ? entry.warnings.length : 0,
    facts: safeFacts.map(fact => ({
      label: fact.label,
      value: fact.value,
      status: fact.status,
      source: fact.source,
    })),
    blocks: safeBlocks,
  };
  const system = [
    '你是求职网申资料复核助手。只做检查，不改写、不生成新的经历或个人信息，也不判断录用。',
    '你只会收到经过筛选的已确认资料；未提供的内容视为未授权外发，不要猜测或补写。',
    '根据提供的数据找出：1) 明显缺失的必填信息；2) 自相矛盾或可疑的值（重复、过期、冲突的内推码等）；3) 未经确认却被当作已确认的内容；4) 与当前进度不一致的状态。',
    '遇到无法判断或缺少依据的内容，记为待确认问题，不要编造。',
    '输出严格 JSON：{"findings":[{"severity":"error|warn|info","area":"字段/区域","message":"问题说明","suggestion":"可选的处理建议"}]}；没有问题输出 {"findings":[]}。不得输出 JSON 以外的文字。',
  ].join('\n');
  return {
    system,
    user: JSON.stringify(payload, null, 2),
    scope: describeReviewScope(entry, { facts, blocks }),
  };
}

export function parseReviewResponse(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('模型返回为空，未获得有效复核结果。');
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型输出不是有效 JSON，复核未通过。');
  let data;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('模型输出 JSON 无法解析，复核未通过。');
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.findings)) {
    throw new Error('模型输出缺少 findings 数组，复核未通过。');
  }
  const findings = data.findings.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`模型输出第 ${index + 1} 条问题格式无效，复核未通过。`);
    }
    if (!['error', 'warn', 'info'].includes(item.severity)) {
      throw new Error(`模型输出第 ${index + 1} 条问题缺少有效 severity，复核未通过。`);
    }
    if (typeof item.message !== 'string' || !item.message.trim()) {
      throw new Error(`模型输出第 ${index + 1} 条问题缺少说明，复核未通过。`);
    }
    return {
      severity: item.severity,
      area: String(item.area || ''),
      message: item.message,
      suggestion: String(item.suggestion || ''),
    };
  });
  return { findings };
}

export async function requestAiReview(config, entry, context = {}) {
  if (!config?.apiKey || !config?.baseUrl || !config?.model) {
    throw new Error('请先在「设置」中填写接口地址、模型名与 API Key。');
  }
  if (context.consent !== true) {
    throw new Error('尚未确认本次外发范围，未发送任何资料。');
  }
  const { system, user } = buildReviewPrompt(entry, context);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 160);
      throw new Error(`接口返回 ${response.status}：${detail}`);
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('模型返回为空，未获得有效复核结果。');
    }
    return parseReviewResponse(content);
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('AI 复核超时（25 秒）。');
    if (error instanceof TypeError) {
      throw new Error('请求失败：可能是网络或 CORS 限制。线上页面请使用允许浏览器直连的接口，或用 MCP/本地服务运行复核。');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
