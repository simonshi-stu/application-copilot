import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { CdpConnection, CdpError, createPipeTransport } from './cdp.js';

function makeConnection({ maxMessageBytes, timeoutMs = 200 } = {}) {
  const toBrowser = new PassThrough();
  const fromBrowser = new PassThrough();
  const transport = createPipeTransport({ readable: fromBrowser, writable: toBrowser, maxMessageBytes });
  transport.start();
  const cdp = new CdpConnection(transport, { defaultTimeoutMs: timeoutMs });
  return { cdp, transport, toBrowser, fromBrowser };
}

async function readMessage(stream) {
  const chunk = await new Promise((resolve, reject) => {
    stream.once('data', resolve);
    stream.once('error', reject);
  });
  assert.equal(chunk[chunk.length - 1], 0);
  return JSON.parse(chunk.subarray(0, chunk.length - 1).toString('utf8'));
}

test('pipe 消息以 NUL 结尾，sessionId 原样发送并可用 id 匹配响应', async () => {
  const { cdp, transport, toBrowser, fromBrowser } = makeConnection();
  try {
    const pending = cdp.send('Runtime.evaluate', { expression: '你好' }, { sessionId: 'S1' });
    const message = await readMessage(toBrowser);
    assert.equal(message.method, 'Runtime.evaluate');
    assert.equal(message.sessionId, 'S1');
    assert.equal(message.params.expression, '你好');
    fromBrowser.write(Buffer.from(`${JSON.stringify({ id: message.id, result: { ok: true } })}\0`, 'utf8'));
    assert.deepEqual(await pending, { ok: true });
  } finally {
    cdp.close();
    transport.close();
  }
});

test('多帧、跨 chunk 与 UTF-8 消息可正确解析', async () => {
  const { cdp, transport, fromBrowser } = makeConnection();
  const messages = [];
  transport.onMessage((message) => messages.push(message));
  const payload = Buffer.from(`${JSON.stringify({ method: 'Test.event', params: { text: '中文🙂' } })}\0${JSON.stringify({ method: 'Test.event', params: { text: '第二帧' } })}\0`, 'utf8');
  fromBrowser.write(payload.subarray(0, 1));
  fromBrowser.write(payload.subarray(1, 7));
  fromBrowser.write(payload.subarray(7));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(messages.length, 2);
  assert.equal(messages[0].params.text, '中文🙂');
  assert.equal(messages[1].params.text, '第二帧');
  cdp.close();
});

test('CDP error、超时和 pipe 关闭都转成明确错误', async () => {
  const { cdp, transport, toBrowser, fromBrowser } = makeConnection({ timeoutMs: 20 });
  const pendingError = cdp.send('Runtime.evaluate', {});
  const message = await readMessage(toBrowser);
  fromBrowser.write(Buffer.from(`${JSON.stringify({ id: message.id, error: { code: -32000, message: 'fixture error' } })}\0`, 'utf8'));
  await assert.rejects(pendingError, (error) => error instanceof CdpError && error.code === -32000 && error.message === 'fixture error');

  await assert.rejects(cdp.send('Never.responds', {}), (error) => error instanceof CdpError && error.code === 'CDP_TIMEOUT');

  const pendingClose = cdp.send('Pending.close', {});
  transport.close('fixture close');
  await assert.rejects(pendingClose, (error) => error instanceof CdpError && error.code === 'CDP_CLOSED');
});

test('waitForEvent 按 sessionId 过滤', async () => {
  const { cdp, transport, fromBrowser } = makeConnection();
  try {
    const waiting = cdp.waitForEvent('Page.loadEventFired', { sessionId: 'S1', timeoutMs: 500 });
    fromBrowser.write(Buffer.from(`${JSON.stringify({ method: 'Page.loadEventFired', sessionId: 'S2', params: { frameId: 'wrong' } })}\0`, 'utf8'));
    fromBrowser.write(Buffer.from(`${JSON.stringify({ method: 'Page.loadEventFired', sessionId: 'S1', params: { frameId: 'right' } })}\0`, 'utf8'));
    const event = await waiting;
    assert.equal(event.params.frameId, 'right');
    assert.equal(event.sessionId, 'S1');
  } finally {
    cdp.close();
    transport.close();
  }
});

test('超过上限的 pipe 消息触发错误并关闭', async () => {
  const { transport, fromBrowser } = makeConnection({ maxMessageBytes: 8 });
  const errors = [];
  transport.onError((error) => errors.push(error));
  fromBrowser.write(Buffer.from('this-is-too-long\0'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(errors.some((error) => error.code === 'PIPE_MESSAGE_TOO_LARGE'));
  assert.equal(transport.closed, true);
});
