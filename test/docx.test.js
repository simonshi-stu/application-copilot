import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { extractDocx, wordXmlToText } from '../extension/docx.js';

function zip(entries) {
  const local = []; const central = []; let offset = 0;
  for (const [name, text, method = 8] of entries) {
    const nameBytes = Buffer.from(name); const data = Buffer.from(text);
    const packed = method === 8 ? deflateRawSync(data) : data;
    const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50);
    head.writeUInt16LE(method, 8); head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(nameBytes.length, 26);
    local.push(head, nameBytes, packed);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(method, 10); directory.writeUInt32LE(packed.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(nameBytes.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, nameBytes); offset += head.length + nameBytes.length + packed.length;
  }
  const dirs = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirs.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, dirs, end]);
}
const xml = '<w:document><w:p><w:r><w:t>示例公司</w:t><w:tab/><w:t>示例岗位</w:t></w:r></w:p><w:p><w:r><w:t>A &amp; B</w:t><w:br/><w:t>第二行</w:t></w:r></w:p></w:document>';

test('OOXML仅提取文字、制表符和段落，不执行或渲染标记', () => {
  assert.equal(wordXmlToText(xml), '示例公司\t示例岗位\n\nA & B\n第二行\n\n');
  assert.equal(wordXmlToText('<w:p><w:t>&lt;script&gt;&#65;</w:t></w:p>'), '<script>A\n\n');
});
test('本地解压DOCX正文和页眉，忽略嵌入对象', async () => {
  const file = zip([['word/document.xml', xml], ['word/header1.xml', '<w:p><w:t>测试同学</w:t></w:p>'], ['word/embeddings/unused.bin', 'ignored']]);
  const text = await extractDocx(file, { inflate: (data, size) => inflateRawSync(data, { maxOutputLength: size }) });
  assert.match(text, /示例公司\t示例岗位/);
  assert.match(text, /## Header\n测试同学/);
  assert.equal(text.includes('ignored'), false);
});
test('浏览器兼容解压流路径支持deflate压缩', async () => {
  const text = await extractDocx(zip([['word/document.xml', xml]]));
  assert.match(text, /示例公司/);
});
test('存储压缩方式和无正文、损坏文件处理', async () => {
  assert.match(await extractDocx(zip([['word/document.xml', xml, 0]])), /示例公司/);
  await assert.rejects(extractDocx(new Uint8Array([1, 2])), /有效/);
  await assert.rejects(extractDocx(zip([['word/header1.xml', xml]])), /正文/);
});
test('拒绝实体声明与不支持的压缩方式', async () => {
  await assert.rejects(extractDocx(zip([['word/document.xml', '<!DOCTYPE a><w:t>text</w:t>']])), /实体/);
  await assert.rejects(extractDocx(zip([['word/document.xml', xml, 99]])), /压缩/);
});
