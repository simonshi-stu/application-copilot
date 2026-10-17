import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFieldCard, pendingSummaryFromResume, approvedSummaryFromBlocks } from '../extension/field-cards.js';

test('没有资料时没有任何可复用项，可能字段只作提示', () => {
  const card = buildFieldCard('bank', { profile: null, blocks: [] });
  assert.deepEqual(card.reuse, []);
  assert.deepEqual(card.pending, []);
  assert.ok(card.ask.some(item => item.includes('意向分行')));
  assert.ok(card.possible.some(item => item.includes('征信')));
  assert.ok(card.verify.some(item => item.includes('内推绑定')));
});

test('已解析未确认只进入“已识别待确认”', () => {
  const summary = pendingSummaryFromResume({ education: [1, 2], internships: [1], projects: [], language: [], skills: ['x'], evaluation: [] });
  assert.ok(summary.includes('教育×2'));
  assert.ok(summary.includes('实习×1'));
  const card = buildFieldCard('internet', {
    profile: { education: [1], internships: [], projects: [], language: [], skills: [], evaluation: [] },
    blocks: [],
  });
  assert.deepEqual(card.reuse, []);
  assert.ok(card.pending.length > 0);
});

test('只有已确认段落计入可复用', () => {
  const blocks = [
    { kind: 'internship_content', approved: true },
    { kind: 'project_original', approved: false },
    { kind: 'language', approved: true },
  ];
  const card = buildFieldCard('bank', { profile: null, blocks });
  assert.equal(card.reuse.length, 2);
  assert.ok(card.reuse.some(item => item.includes('实习内容')));
  assert.ok(!card.reuse.some(item => item.includes('项目原文')));
  assert.deepEqual(approvedSummaryFromBlocks([]), []);
});

test('行业模板只给可能字段，未知行业回退通用', () => {
  const auto = buildFieldCard('auto');
  assert.ok(auto.ask.some(item => item.includes('到岗')));
  const unknown = buildFieldCard('not-a-type');
  const other = buildFieldCard('other');
  assert.deepEqual(unknown.ask, other.ask);
  assert.deepEqual(unknown.possible, []);
});

test('资料库字段按确认状态分流：确认才可复用', () => {
  const facts = [
    { id: '1', label: '姓名', value: '测试同学', status: 'confirmed' },
    { id: '2', label: '电话', value: '19900000000', status: 'unconfirmed' },
  ];
  const card = buildFieldCard('bank', { profile: null, blocks: [], facts });
  assert.ok(card.reuse.some(item => item.includes('姓名') && item.includes('已确认')));
  assert.ok(card.pending.some(item => item.includes('电话') && item.includes('待确认')));
  assert.ok(!card.reuse.some(item => item.includes('电话')));
});
