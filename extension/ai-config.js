// API 配置：仅存本机，不进入资料/公司清单导出，也不写入日志。
// 默认 OpenAI 兼容接口；CORS 支持取决于服务商。

const KEY = 'applicationCopilot.aiConfig.v1';
const extensionStorage = globalThis.chrome?.storage?.local;

export const DEFAULT_AI_CONFIG = Object.freeze({
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  apiKey: '',
  autoReview: false,
  sendConsent: false,
});

function normalize(config = {}) {
  return {
    baseUrl: String(config.baseUrl || DEFAULT_AI_CONFIG.baseUrl).trim(),
    model: String(config.model || '').trim(),
    apiKey: String(config.apiKey || '').trim(),
    autoReview: Boolean(config.autoReview),
    // 外发授权必须由本人显式勾选；配置导入或旧数据不自动升级为已授权。
    sendConsent: Boolean(config.sendConsent),
  };
}

export async function loadAiConfig() {
  try {
    const raw = extensionStorage
      ? (await extensionStorage.get(KEY))[KEY]
      : JSON.parse(localStorage.getItem(KEY) || 'null');
    return normalize(raw || {});
  } catch {
    return { ...DEFAULT_AI_CONFIG };
  }
}

export async function saveAiConfig(config) {
  const value = normalize(config);
  if (extensionStorage) await extensionStorage.set({ [KEY]: value });
  else localStorage.setItem(KEY, JSON.stringify(value));
  return value;
}

export async function clearAiConfig() {
  if (extensionStorage) await extensionStorage.remove(KEY);
  else localStorage.removeItem(KEY);
  return { ...DEFAULT_AI_CONFIG };
}
