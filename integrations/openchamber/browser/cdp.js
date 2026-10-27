// 最小 CDP 客户端：通过 Chrome DevTools remote-debugging-pipe 的 fd3/fd4
// 交换以 NUL 结尾的 JSON 消息。不打开、不监听任何 TCP 调试端口。

import { once } from 'node:events';

export class CdpError extends Error {
  constructor(code, message, data) {
    super(message || code || 'CDP error');
    this.name = 'CdpError';
    this.code = code;
    this.data = data;
  }
}

const DEFAULT_MAX_MESSAGE_BYTES = 64 * 1024 * 1024;

/**
 * @param {NodeJS.ReadableStream} readable 父进程从 fd4 读 Chrome 的响应
 * @param {NodeJS.WritableStream} writable 父进程向 fd3 写命令
 */
export function createPipeTransport({ readable, writable, maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES } = {}) {
  if (!readable || typeof readable.on !== 'function') throw new TypeError('readable 缺失');
  if (!writable || typeof writable.write !== 'function') throw new TypeError('writable 缺失');

  let buffer = Buffer.alloc(0);
  let started = false;
  let closed = false;
  const messageHandlers = new Set();
  const closeHandlers = new Set();
  const errorHandlers = new Set();

  const emit = (handlers, value) => {
    for (const handler of handlers) {
      try {
        handler(value);
      } catch {
        // 监听者错误不能破坏协议读取。
      }
    }
  };

  const onData = (chunk) => {
    if (closed) return;
    let data;
    try {
      data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    } catch {
      emit(errorHandlers, new CdpError('PIPE_DATA_INVALID', 'CDP pipe 收到无法读取的数据。'));
      return;
    }
    buffer = buffer.length ? Buffer.concat([buffer, data]) : data;
    if (buffer.length > maxMessageBytes) {
      emit(errorHandlers, new CdpError('PIPE_MESSAGE_TOO_LARGE', 'CDP pipe 消息超过大小上限。'));
      close();
      return;
    }

    let index;
    while (!closed && (index = buffer.indexOf(0)) !== -1) {
      const frame = buffer.subarray(0, index);
      buffer = buffer.subarray(index + 1);
      if (!frame.length) continue;
      const text = frame.toString('utf8');
      if (!text.trim()) continue;
      let message;
      try {
        message = JSON.parse(text);
      } catch {
        emit(errorHandlers, new CdpError('PIPE_MESSAGE_INVALID', 'CDP pipe 收到非 JSON 消息。'));
        continue;
      }
      emit(messageHandlers, message);
    }
  };

  const onEnd = () => close('CDP pipe 已关闭。');
  const onError = (error) => {
    emit(errorHandlers, new CdpError('PIPE_ERROR', error?.message || 'CDP pipe 错误。'));
    close();
  };

  function start() {
    if (started) return;
    started = true;
    readable.on('data', onData);
    readable.on('end', onEnd);
    readable.on('close', onEnd);
    readable.on('error', onError);
    writable.on('error', onError);
  }

  function close(reason) {
    if (closed) return;
    closed = true;
    buffer = Buffer.alloc(0);
    if (started) {
      readable.off('data', onData);
      readable.off('end', onEnd);
      readable.off('close', onEnd);
      readable.off('error', onError);
      writable.off('error', onError);
    }
    emit(closeHandlers, new CdpError('CDP_PIPE_CLOSED', reason || 'CDP pipe 已关闭。'));
  }

  async function send(text) {
    if (closed) throw new CdpError('CDP_PIPE_CLOSED', 'CDP pipe 已关闭。');
    if (typeof text !== 'string' || !text) throw new CdpError('CDP_MESSAGE_EMPTY', 'CDP 消息为空。');
    const payload = Buffer.from(`${text}\0`, 'utf8');
    try {
      await new Promise((resolve, reject) => {
        writable.write(payload, (error) => {
          if (error) reject(new CdpError('CDP_WRITE_FAILED', error.message || 'CDP 写入失败。'));
          else resolve();
        });
      });
    } catch (error) {
      if (error instanceof CdpError) throw error;
      throw new CdpError('CDP_WRITE_FAILED', error?.message || 'CDP 写入失败。');
    }
  }

  return {
    start,
    send,
    close,
    get closed() {
      return closed;
    },
    onMessage(handler) {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },
    onClose(handler) {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    onError(handler) {
      errorHandlers.add(handler);
      return () => errorHandlers.delete(handler);
    },
  };
}

/**
 * CDP 连接：按 id 匹配响应，按 sessionId 发送 target 级命令，并分发事件。
 */
export class CdpConnection {
  constructor(transport, { defaultTimeoutMs = 15000 } = {}) {
    if (!transport || typeof transport.send !== 'function') throw new TypeError('CDP transport 缺失');
    this.transport = transport;
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.eventHandlers = new Set();
    this.eventWaiters = new Set();
    this.closed = false;
    this.closeReason = null;

    transport.onMessage((message) => this.#handleMessage(message));
    transport.onClose((error) => this.#handleClose(error));
    transport.onError((error) => this.#emitEvent({ method: '$transportError', params: { error } }));
  }

  #handleMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(message, 'id')) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new CdpError(message.error.code ?? 'CDP_ERROR', message.error.message || 'CDP 调用失败。', message.error.data));
      } else {
        pending.resolve(message.result || {});
      }
      return;
    }
    if (typeof message.method !== 'string') return;
    const event = {
      method: message.method,
      params: message.params || {},
      sessionId: message.sessionId || null,
    };
    this.#emitEvent(event);
    for (const waiter of [...this.eventWaiters]) {
      if (waiter.method !== event.method) continue;
      if (waiter.sessionId && waiter.sessionId !== event.sessionId) continue;
      try {
        if (waiter.predicate && !waiter.predicate(event)) continue;
      } catch {
        continue;
      }
      this.eventWaiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(event);
    }
  }

  #emitEvent(event) {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // 事件监听者错误不能影响 CDP 响应。
      }
    }
  }

  #handleClose(error) {
    if (this.closed) return;
    this.closed = true;
    this.closeReason = error?.message || 'CDP 连接已关闭。';
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new CdpError('CDP_CLOSED', this.closeReason));
    }
    this.pending.clear();
    for (const waiter of this.eventWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new CdpError('CDP_CLOSED', this.closeReason));
    }
    this.eventWaiters.clear();
    this.#emitEvent({ method: '$closed', params: { reason: this.closeReason }, sessionId: null });
  }

  send(method, params = {}, { sessionId = null, timeoutMs = this.defaultTimeoutMs } = {}) {
    if (this.closed) return Promise.reject(new CdpError('CDP_CLOSED', this.closeReason || 'CDP 连接已关闭。'));
    if (typeof method !== 'string' || !method) return Promise.reject(new CdpError('CDP_METHOD_INVALID', 'CDP 方法名无效。'));
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CdpError('CDP_TIMEOUT', `CDP 调用超时：${method}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer, method });
      this.transport.send(JSON.stringify(message)).catch((error) => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        clearTimeout(pending.timer);
        pending.reject(error instanceof CdpError ? error : new CdpError('CDP_WRITE_FAILED', error?.message || 'CDP 写入失败。'));
      });
    });
  }

  waitForEvent(method, { sessionId = null, predicate = null, timeoutMs = this.defaultTimeoutMs } = {}) {
    if (this.closed) return Promise.reject(new CdpError('CDP_CLOSED', this.closeReason || 'CDP 连接已关闭。'));
    return new Promise((resolve, reject) => {
      const waiter = { method, sessionId, predicate, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.eventWaiters.delete(waiter);
        reject(new CdpError('CDP_EVENT_TIMEOUT', `等待 CDP 事件超时：${method}`));
      }, timeoutMs);
      waiter.timer.unref?.();
      this.eventWaiters.add(waiter);
    });
  }

  onEvent(handler) {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  close(reason = 'CDP 连接已关闭。') {
    if (this.closed) return;
    this.transport.close(reason);
    this.#handleClose(new CdpError('CDP_CLOSED', reason));
  }
}

export async function waitForProcessExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true;
  try {
    await Promise.race([
      once(child, 'exit'),
      new Promise((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        timer.unref?.();
      }),
    ]);
  } catch {
    return child.exitCode !== null || child.signalCode !== null;
  }
  return child.exitCode !== null || child.signalCode !== null;
}
