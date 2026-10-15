// Minimal local OOXML text extraction: no external service, macros or embedded objects.
// ZIP entries are bounded before inflation. Only Word body and headers are read.
export async function extractDocx(bytes, { inflate } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length > 10 * 1024 * 1024) throw new Error('DOCX 文件无效或超过 10 MB。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
    if (view.getUint32(p, true) === 0x06054b50 && p + 22 + view.getUint16(p + 20, true) === bytes.length) { end = p; break; }
  }
  if (end < 0) throw new Error('不是有效的 DOCX ZIP 文件。');
  const count = view.getUint16(end + 10, true);
  if (count > 2000 || view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) throw new Error('不支持此 DOCX 压缩结构。');
  let cursor = view.getUint32(end + 16, true);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const entries = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('DOCX 目录损坏。');
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const packed = view.getUint32(cursor + 20, true);
    const unpacked = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const next = cursor + 46 + nameLength + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
    if (next > end) throw new Error('DOCX 目录长度无效。');
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (/^word\/(document|header\d+)\.xml$/.test(name)) {
      total += unpacked;
      if ((flags & 1) || unpacked > 4 * 1024 * 1024 || total > 8 * 1024 * 1024 || ![0, 8].includes(method)) throw new Error('DOCX 内容加密、过大或使用不支持的压缩。');
      const local = view.getUint32(cursor + 42, true);
      if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) throw new Error('DOCX 数据位置无效。');
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      if (start + packed > bytes.length) throw new Error('DOCX 数据越界。');
      entries.push({ name, method, packed: bytes.subarray(start, start + packed), unpacked });
    }
    cursor = next;
  }
  if (!entries.some(e => e.name === 'word/document.xml')) throw new Error('DOCX 缺少正文。');
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const sections = [];
  for (const entry of entries) {
    let data;
    if (entry.method === 0) data = entry.packed;
    else if (inflate) data = await inflate(entry.packed, entry.unpacked);
    else {
      let stream;
      try { stream = new Blob([entry.packed]).stream().pipeThrough(new DecompressionStream('deflate-raw')); }
      catch { throw new Error('当前浏览器不支持本地 DOCX 解压，请使用新版 Chrome／Edge 或粘贴文本。'); }
      const reader = stream.getReader();
      const chunks = []; let size = 0;
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > entry.unpacked || size > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('DOCX 解压大小不符。'); }
        chunks.push(value);
      }
      data = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    }
    if (data.byteLength !== entry.unpacked) throw new Error('DOCX 解压大小不符。');
    const xml = decoder.decode(data);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('不支持包含外部实体声明的文档。');
    const text = wordXmlToText(xml);
    if (text.trim()) sections.push(entry.name.includes('header') ? `\n## Header\n${text}` : text);
  }
  return sections.join('\n\n');
}

export function wordXmlToText(xml) {
  // Tokenize only Word text/run delimiters; never execute or render document markup.
  const tokens = xml.match(/<[^>]+>|[^<]+/g) || [];
  let inText = false;
  let out = '';
  for (const token of tokens) {
    if (/^<w:t(?:\s|>)/.test(token)) inText = true;
    else if (/^<\/w:t\s*>/.test(token)) inText = false;
    else if (/^<w:tab(?:\s|\/|>)/.test(token)) out += '\t';
    else if (/^<w:(?:br|cr)(?:\s|\/|>)/.test(token)) out += '\n';
    else if (/^<\/w:p\s*>/.test(token)) out += '\n\n';
    else if (/^<\/w:tc\s*>/.test(token)) out += '\t';
    else if (!token.startsWith('<') && inText) {
      out += token.replace(/&#(x[\da-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi, (whole, code, name) => {
        if (name) return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[name.toLowerCase()];
        const number = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
        return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : whole;
      });
    }
  }
  return out;
}
