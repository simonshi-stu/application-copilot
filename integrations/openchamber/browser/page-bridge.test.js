import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_BRIDGE_SOURCE_TEXT,
  PAGE_SIGNATURE_KEYS,
  PAGE_SCRIPT_LIMITS,
  buildPageExpression,
} from './page-bridge.js';

function payloadOf(expression) {
  const marker = '/*ACOPILOT_PAYLOAD*/';
  const start = expression.indexOf(marker);
  assert.ok(start > 0);
  const json = expression.slice(start + marker.length, expression.lastIndexOf(')'));
  return JSON.parse(json);
}

test('读回只携带已注册引用和绑定 URL，不接受 selector/脚本', () => {
  const expression = buildPageExpression({
    op: 'readback',
    expectedUrl: 'https://app.mokahr.com/apply',
    refs: ['mc_abc123-0'],
  });
  const payload = payloadOf(expression);
  assert.equal(payload.op, 'readback');
  assert.deepEqual(payload.refs, ['mc_abc123-0']);
  assert.equal(payload.expectedUrl, 'https://app.mokahr.com/apply');
  assert.equal(Object.hasOwn(payload, 'selector'), false);
  assert.match(PAGE_BRIDGE_SOURCE_TEXT, /PASSWORD_READBACK_BLOCKED/);
});

test('页面表达式把计划内容作为 JSON 实参，不拼接为代码语句', () => {
  const text = '第一行\n\n第二行 "</script>" `x` ${y} \u2028 结束';
  const expression = buildPageExpression({
    op: 'write',
    expectedUrl: 'https://app.mokahr.com/apply',
    ref: 'mc_abc123-0',
    text,
    expected: { value: '', label: '姓名' },
  });
  assert.ok(expression.startsWith('/*ACOPILOT_PAGE*/;'));
  const payload = payloadOf(expression);
  assert.equal(payload.op, 'write');
  assert.equal(payload.text, text);
  assert.equal(payload.expected.value, '');
  assert.ok(expression.includes('\\u2028') || !expression.includes('\u2028'));
});

test('页面桥没有 click / submit / requestSubmit / 任意脚本入口', () => {
  assert.ok(PAGE_SIGNATURE_KEYS.includes('value'));
  assert.ok(PAGE_SIGNATURE_KEYS.includes('regionEntityId'));
  assert.ok(PAGE_SIGNATURE_KEYS.includes('maxLength'));
  assert.doesNotMatch(PAGE_BRIDGE_SOURCE_TEXT, /\.click\s*\(/i);
  assert.doesNotMatch(PAGE_BRIDGE_SOURCE_TEXT, /\.submit\s*\(/i);
  assert.doesNotMatch(PAGE_BRIDGE_SOURCE_TEXT, /requestSubmit\s*\(/i);
  assert.doesNotMatch(PAGE_BRIDGE_SOURCE_TEXT, /\.requestSubmit\s*\(/i);
  assert.doesNotMatch(PAGE_BRIDGE_SOURCE_TEXT, /\beval\s*\(/i);
  assert.doesNotMatch(PAGE_BRIDGE_SOURCE_TEXT, /new\s+Function\s*\(/i);
  assert.doesNotMatch(PAGE_BRIDGE_SOURCE_TEXT, /dispatchEvent\(\s*new\s+MouseEvent/i);
});

test('过大的页面参数被拒绝，限额可审计', () => {
  const huge = 'x'.repeat(PAGE_SCRIPT_LIMITS.maxExpressionLength + 10);
  assert.throws(() => buildPageExpression({ op: 'write', text: huge }), /参数过大/);
  assert.equal(PAGE_SCRIPT_LIMITS.maxControls, 200);
  assert.equal(PAGE_SCRIPT_LIMITS.maxOptions, 200);
});
