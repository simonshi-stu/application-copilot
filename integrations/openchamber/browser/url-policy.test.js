import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approvedMokaHref,
  isApprovedMokaOrigin,
  isApprovedMokaUrl,
  MokaUrlError,
  normalizeNewlines,
  parseApprovedMokaUrl,
  samePageUrl,
} from './url-policy.js';

test('只允许 https Moka 官方域名与标准端口', () => {
  const allowed = [
    'https://mokahr.com/',
    'https://app.mokahr.com/campus-recruitment/acme/123',
    'https://APP.MOKAHR.COM/jobs?jobId=1#detail',
    'https://sub.mokahr.com:443/path',
  ];
  for (const url of allowed) {
    assert.equal(isApprovedMokaUrl(url), true, url);
    assert.doesNotThrow(() => parseApprovedMokaUrl(url), url);
  }
});

test('拒绝伪后缀、userinfo、非标准端口和非 https', () => {
  const blocked = [
    'http://app.mokahr.com/',
    'ftp://app.mokahr.com/',
    'javascript:alert(1)',
    'data:text/html,<h1>x</h1>',
    'about:blank',
    'file:///C:/secret',
    'https://mokahr.com.evil.example/',
    'https://app.mokahr.com.evil.example/',
    'https://mokahr.com@evil.example/',
    'https://user:pass@mokahr.com/',
    'https://app.mokahr.com:8443/',
    'https://app.mokahr.com./',
    'https://mokahr.com..evil.example/',
    'not a url',
    '',
    '   ',
  ];
  for (const url of blocked) {
    assert.equal(isApprovedMokaUrl(url), false, url);
    assert.throws(() => parseApprovedMokaUrl(url), MokaUrlError, url);
  }
});

test('只把 CRLF / CR 归一为 LF，保留空行与其它字符', () => {
  const original = '第一段\r\n\r\n第二段\r第三段\n\n末尾  ';
  assert.equal(normalizeNewlines(original), '第一段\n\n第二段\n第三段\n\n末尾  ');
  assert.equal(normalizeNewlines('\r\n'), '\n');
  assert.throws(() => normalizeNewlines(null), TypeError);
});

test('origin 与页面 URL 比较使用规范化后的地址', () => {
  assert.equal(isApprovedMokaOrigin('https://app.mokahr.com/a'), true);
  assert.equal(isApprovedMokaOrigin('https://mokahr.com/a'), true);
  assert.equal(isApprovedMokaOrigin('https://evil.example/a'), false);
  assert.equal(samePageUrl('https://app.mokahr.com/a', 'https://app.mokahr.com/a#x'), false);
  assert.equal(approvedMokaHref('https://app.mokahr.com:443/a'), 'https://app.mokahr.com/a');
});
