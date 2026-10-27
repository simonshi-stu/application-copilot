// Moka 官方地址白名单。这里只做纯函数校验，不访问网络、不启动浏览器。
// 生产驱动只允许 https://mokahr.com 及其子域；不接受登录凭据、非标准端口或其它协议。

export const MOKA_HOST = 'mokahr.com';
export const MOKA_URL_SCHEMA_VERSION = 'application-copilot.moka-url.v1';
const MAX_URL_LENGTH = 4096;

export class MokaUrlError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MokaUrlError';
    this.code = code;
  }
}

/**
 * 解析并规范化批准的 Moka URL。
 * 只允许 HTTPS、mokahr.com 严格后缀、无 userinfo、端口为空或 443。
 */
export function parseApprovedMokaUrl(input) {
  if (typeof input !== 'string') {
    throw new MokaUrlError('INVALID_URL', '网址必须是字符串。');
  }
  const raw = input.trim();
  if (!raw || raw.length > MAX_URL_LENGTH) {
    throw new MokaUrlError('INVALID_URL', '网址为空或过长。');
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new MokaUrlError('INVALID_URL', '网址无法解析。');
  }

  if (url.protocol !== 'https:') {
    throw new MokaUrlError('INVALID_SCHEME', '只允许 https:// 的 Moka 官方页面。');
  }
  if (url.username || url.password) {
    throw new MokaUrlError('URL_HAS_CREDENTIALS', '网址不能携带登录凭据。');
  }
  if (url.port !== '' && url.port !== '443') {
    throw new MokaUrlError('NON_STANDARD_PORT', '只允许标准 HTTPS 端口。');
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname.endsWith('.')) {
    throw new MokaUrlError('INVALID_HOST', '主机名不能以点结尾。');
  }
  if (hostname !== MOKA_HOST && !hostname.endsWith(`.${MOKA_HOST}`)) {
    throw new MokaUrlError('HOST_NOT_ALLOWED', '只允许 mokahr.com 官方子域。');
  }
  if (hostname.includes('..') || hostname.includes('%')) {
    throw new MokaUrlError('INVALID_HOST', '主机名格式不受支持。');
  }

  // URL 会把 443 端口归一化为空；上面的检查只拒绝显式非标准端口。
  return url;
}

export function approvedMokaHref(input) {
  return parseApprovedMokaUrl(input).href;
}

export function isApprovedMokaUrl(input) {
  try {
    parseApprovedMokaUrl(input);
    return true;
  } catch {
    return false;
  }
}

export function isApprovedMokaOrigin(input) {
  try {
    const url = parseApprovedMokaUrl(input);
    return url.origin === `https://${MOKA_HOST}` || url.origin.endsWith(`.${MOKA_HOST}`) || url.hostname === MOKA_HOST;
  } catch {
    return false;
  }
}

// 只允许 CRLF / CR 归一为 LF；不 trim、不折叠空行、不改写正文。
export function normalizeNewlines(text) {
  if (typeof text !== 'string') {
    throw new TypeError('text 必须是字符串');
  }
  return text.replace(/\r\n?/g, '\n');
}

export function samePageUrl(left, right) {
  try {
    return new URL(left).href === new URL(right).href;
  } catch {
    return false;
  }
}

export function describeMokaPolicy() {
  return Object.freeze({
    schemaVersion: MOKA_URL_SCHEMA_VERSION,
    protocols: ['https:'],
    host: MOKA_HOST,
    subdomains: true,
    ports: ['', '443'],
    userinfo: false,
    note: '仅限 Moka 官方 https 页面；不访问其它域名，不读取登录凭据。',
  });
}
