import test from 'node:test';
import assert from 'node:assert/strict';
import { splitDrafts, approveBlock, reviseBlock, textForCopy } from '../extension/blocks.js';

function draft(text = '使用 Python 整理数据。\n\n保留验证范围，不宣称上线。') {
  return { id: 'fictional', originalText: text, text, item: '虚构项目', kind: 'project_responsibilities', approved: false, approvedText: null };
}

test('按空行产生草稿，不猜栏目、不改写或去除段内缩进', () => {
  const blocks = splitDrafts('  原文第一行\r\n第二行\r\n\r\n另一段。', () => 'id');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].text, '  原文第一行\n第二行');
  assert.equal(blocks[0].approved, false);
  assert.equal(blocks[0].kind, 'unassigned');
  assert.equal(blocks[1].originalText, '另一段。');
});
test('空输入不产生段落', () => assert.deepEqual(splitDrafts(' \n\n\t'), []));
test('未确认不可复制', () => assert.throws(() => textForCopy(draft()), /未确认/));
test('确认后逐字符保留文字、数字、换行和空行', () => {
  const block = approveBlock(draft());
  assert.equal(textForCopy(block), block.text);
});
test('缺少所属经历、栏目或正文时不能确认', () => {
  assert.throws(() => approveBlock({ ...draft(), item: '' }), /所属/);
  assert.throws(() => approveBlock({ ...draft(), kind: 'unassigned' }), /栏目/);
  assert.throws(() => approveBlock({ ...draft(), kind: '__proto__' }), /栏目/);
  assert.throws(() => approveBlock({ ...draft(), text: '\n ' }), /空段落/);
});
test('改正文、分类或所属经历后，原确认失效', () => {
  for (const patch of [{ text: '本人修改。' }, { item: '另一项目' }, { kind: 'project_content' }]) {
    const revised = reviseBlock(approveBlock(draft()), patch);
    assert.equal(revised.approved, false);
    assert.equal(revised.approvedText, null);
    assert.throws(() => textForCopy(revised), /重新确认/);
  }
});
test('修改正文却保留旧确认标志时仍拒绝复制', () => {
  const block = { ...approveBlock(draft()), text: '另一内容。' };
  assert.throws(() => textForCopy(block), /重新确认/);
});
test('超限拒绝复制，不能截断原文', () => {
  const block = approveBlock(draft());
  assert.throws(() => textForCopy(block, { maxLength: 5 }), /不自动截断/);
  assert.equal(textForCopy(block, { maxLength: block.text.length }), block.text);
});
test('禁止把项目内容当项目职责使用', () => {
  const block = approveBlock({ ...draft(), kind: 'project_content' });
  assert.throws(() => textForCopy(block, { expectedKind: 'project_responsibilities' }), /栏目不匹配/);
});
test('非法字符上限被拒绝', () => {
  const block = approveBlock(draft());
  for (const maxLength of [0, -1, 1.2, NaN]) {
    assert.throws(() => textForCopy(block, { maxLength }), /正整数/);
  }
});
