// AI 复核：可选。把当前公司与已确认资料发给用户自带的 OpenAI 兼容接口，
// 只返回问题清单，不修改任何字段、不生成经历内容、不访问招聘网站。

export function buildReviewPrompt(entry = {}, { facts = [], blocks = [] } = {}) {
  const payload = {
    company: entry.company,
    industry: entry.industry?.label || entry.industry?.value || '',
    stage: entry.stage,
    review: entry.review,
    links: (entry.links || []).map(link => link.url),
    referral: entry.referral,
    answers: entry.answers || {},
    applicationRef: entry.applicationRef,
    appliedAt: entry.appliedAt,
    notes: entry.notes,
    warnings: entry.warnings || [],
    facts: facts.map(fact => ({ label: fact.label, value: fact.value, status: fact.status, source: fact.source })),
    blocks: blocks.filter(block => block.approved).map(block => ({ kind: block.kind, item: block.item, text: block.text })),
  };
  const system = [
    '你是求职网申资料复核助手。只做检查，不改写、不生成新的经历或个人信息，也不判断录用。',
    '根据提供的数据找出：1) 明显缺失的必填信息；2) 自相矛盾或可疑的值（重复、过期、冲突的内推码等）；3) 未经确认却被当作已确认的内容；4) 与当前进度不一致的状态。',
    '遇到无法判断或缺少依据的内容，记为待确认问题，不要编造。',
    '输出严格 JSON：{"findings":[{"severity":"error|warn|info","area":"字段/区域","message":"问题说明","suggestion":"可选的处理建议"}]}；没有问题输出 {"findings":[]}。',
  ].join('\n');
  return { system, user: JSON.stringify(payload, null, 2) };
}

export function parseReviewResponse(text) {
  if (typeof text !== 'string' || !text.trim()) return { findings: [] };
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const data = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(data.findings)) {
        const findings = data.findings
          .filter(item => item && typeof item === 'object')
          .map(item => ({
            severity: ['error', 'warn', 'info'].includes(item.severity) ? item.severity : 'info',
            area: String(item.area || ''),
            message: String(item.message || ''),
            suggestion: String(item.suggestion || ''),
          }))
          .filter(item => item.message);
        return { findings };
      }
    } catch { /* fall through to plain text */ }
  }
  return { findings: [{ severity: 'info', area: '模型输出', message: text.trim().slice(0, 500), suggestion: '' }] };
}

export async function requestAiReview(config, entry, context = {}) {
  if (!config?.apiKey || !config?.baseUrl || !config?.model) {
    throw new Error('请先在「设置」中填写接口地址、模型名与 API Key。');
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
    return parseReviewResponse(typeof content === 'string' ? content : JSON.stringify(content || ''));
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
