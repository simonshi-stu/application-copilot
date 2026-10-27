// CDP target 附着与页面桥适配。命令只发往本驱动的 page session；
// 不创建全局 WebSocket，不暴露任意页面脚本。

import { CdpError } from './cdp.js';
import { buildPageExpression } from './page-bridge.js';

export class MokaPageError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'MokaPageError';
    this.code = code;
    this.details = details || null;
  }
}

function translateCdpError(error, fallbackCode) {
  if (error instanceof MokaPageError) return error;
  if (error instanceof CdpError) {
    if (error.code === 'CDP_TIMEOUT' || error.code === 'CDP_EVENT_TIMEOUT') {
      return new MokaPageError('PAGE_TIMEOUT', '浏览器页面响应超时。', { cause: error.code });
    }
    if (error.code === 'CDP_CLOSED' || error.code === 'CDP_PIPE_CLOSED') {
      return new MokaPageError('TARGET_UNAVAILABLE', '浏览器页面或 CDP 连接已关闭。', { cause: error.code });
    }
    if (error.code === -32602 && /target/i.test(error.message || '')) {
      return new MokaPageError('TARGET_UNAVAILABLE', '当前页面 target 已不存在。', { cause: error.code });
    }
    return new MokaPageError(fallbackCode || 'CDP_CALL_FAILED', '浏览器 CDP 调用失败。', {
      cause: error.code,
      cdpMessage: error.message,
    });
  }
  return new MokaPageError(fallbackCode || 'PAGE_FAILED', '浏览器页面操作失败。', {
    cause: error?.message || null,
  });
}

async function findPageTarget(cdp) {
  const result = await cdp.send('Target.getTargets', {});
  const targets = Array.isArray(result.targetInfos) ? result.targetInfos : [];
  const pages = targets.filter((target) => (
    target.type === 'page'
    && typeof target.url === 'string'
    && !target.url.startsWith('devtools://')
  ));
  return pages.find((target) => target.url === 'about:blank') || pages[0] || null;
}

/**
 * 找到/创建页面 target 并建立 flatten session。返回首屏页面适配器。
 */
export async function attachPage(cdp, { timeoutMs = 15000 } = {}) {
  let target = null;
  try {
    target = await findPageTarget(cdp);
  } catch (error) {
    throw translateCdpError(error, 'TARGET_LIST_FAILED');
  }
  if (!target) {
    try {
      const created = await cdp.send('Target.createTarget', { url: 'about:blank' }, { timeoutMs });
      target = { targetId: created.targetId, url: 'about:blank' };
    } catch (error) {
      throw translateCdpError(error, 'TARGET_CREATE_FAILED');
    }
  }
  if (!target?.targetId) {
    throw new MokaPageError('TARGET_CREATE_FAILED', '浏览器没有可用的页面 target。');
  }

  let sessionId;
  try {
    const attached = await cdp.send('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    }, { timeoutMs });
    sessionId = attached.sessionId;
  } catch (error) {
    throw translateCdpError(error, 'TARGET_ATTACH_FAILED');
  }
  if (!sessionId) {
    throw new MokaPageError('TARGET_ATTACH_FAILED', '浏览器页面 target 附着失败。');
  }

  try {
    await cdp.send('Page.enable', {}, { sessionId, timeoutMs });
    await cdp.send('Runtime.enable', {}, { sessionId, timeoutMs });
  } catch (error) {
    throw translateCdpError(error, 'PAGE_ENABLE_FAILED');
  }

  return {
    targetId: target.targetId,
    sessionId,
    page: createPageAdapter({ cdp, targetId: target.targetId, sessionId, timeoutMs }),
  };
}

/**
 * 生产页面适配器：只提供固定 op 的 eval、target 信息、导航。
 */
export function createPageAdapter({ cdp, targetId, sessionId, timeoutMs = 15000 }) {
  if (!cdp || !targetId || !sessionId) throw new TypeError('createPageAdapter 缺少 CDP 连接或 target/session');

  async function evaluate(payload, { timeout = timeoutMs } = {}) {
    let expression;
    try {
      expression = buildPageExpression(payload);
    } catch (error) {
      throw new MokaPageError('PAGE_PAYLOAD_INVALID', '页面参数无效或过大。', { cause: error?.message || null });
    }
    let response;
    try {
      response = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: false,
        includeCommandLineAPI: false,
      }, { sessionId, timeoutMs: timeout });
    } catch (error) {
      throw translateCdpError(error, 'PAGE_EVALUATE_FAILED');
    }
    if (response.exceptionDetails) {
      const description = response.exceptionDetails.exception?.description
        || response.exceptionDetails.text
        || '页面脚本异常';
      throw new MokaPageError('PAGE_SCRIPT_ERROR', '页面桥执行异常。', {
        reason: String(description).slice(0, 500),
      });
    }
    const value = response.result?.value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new MokaPageError('PAGE_RESULT_INVALID', '页面桥没有返回结构化结果。');
    }
    return value;
  }

  async function targetInfo() {
    let response;
    try {
      response = await cdp.send('Target.getTargetInfo', { targetId }, { timeoutMs });
    } catch (error) {
      throw translateCdpError(error, 'TARGET_UNAVAILABLE');
    }
    const info = response.targetInfo;
    if (!info || info.targetId !== targetId || info.type !== 'page') {
      throw new MokaPageError('TARGET_UNAVAILABLE', '当前页面 target 已变化或关闭。');
    }
    return {
      targetId: info.targetId,
      type: info.type,
      url: typeof info.url === 'string' ? info.url : '',
      title: typeof info.title === 'string' ? info.title : '',
      attached: info.attached !== false,
    };
  }

  async function navigate(url, { navigationTimeoutMs = 30000 } = {}) {
    if (typeof url !== 'string' || !url) throw new MokaPageError('INVALID_NAVIGATION_URL', '导航网址无效。');
    const loadEvent = cdp.waitForEvent('Page.loadEventFired', {
      sessionId,
      timeoutMs: navigationTimeoutMs,
    });
    let result;
    try {
      result = await cdp.send('Page.navigate', { url }, { sessionId, timeoutMs: navigationTimeoutMs });
    } catch (error) {
      await loadEvent.catch(() => {});
      throw translateCdpError(error, 'NAVIGATION_FAILED');
    }
    if (result.errorText) {
      await loadEvent.catch(() => {});
      throw new MokaPageError('NAVIGATION_FAILED', '浏览器页面导航失败。', {
        reason: String(result.errorText).slice(0, 300),
      });
    }
    let loaded = true;
    let warning = null;
    try {
      await loadEvent;
    } catch (error) {
      loaded = false;
      warning = error?.code || 'LOAD_EVENT_TIMEOUT';
    }
    return { url, loaded, warning };
  }

  return {
    targetId,
    sessionId,
    targetInfo,
    info: () => evaluate({ op: 'info' }),
    observe: ({ refPrefix, maxControls }) => evaluate({ op: 'observe', refPrefix, maxControls }),
    write: (item) => evaluate({ ...item, op: 'write' }),
    readback: ({ refs, expectedUrl }) => evaluate({ op: 'readback', refs, expectedUrl }),
    research: ({ maxJobs, maxText } = {}) => evaluate({ op: 'research', maxJobs, maxText }),
    navigate,
    close: async () => ({ closed: true }),
  };
}
