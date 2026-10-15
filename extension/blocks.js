export const KINDS = Object.freeze({
  unassigned: '待分类',
  internship_content: '实习内容／工作职责',
  project_original: '项目原始正文（未拆分）',
  project_content: '项目内容／项目描述',
  project_responsibilities: '项目职责／本人贡献',
  language: '语言与荣誉',
  evaluation: '个人评价',
  other: '其他已确认原文',
});

export function normalizeNewlines(text) {
  return text.replace(/\r\n?/g, '\n');
}

export function splitDrafts(source, makeId = () => crypto.randomUUID()) {
  return normalizeNewlines(source)
    .split(/\n[\t ]*\n(?:[\t ]*\n)*/)
    .filter(text => text.trim().length > 0)
    .map(text => ({
      id: makeId(), originalText: text, text, item: '', kind: 'unassigned',
      approved: false, approvedText: null,
    }));
}

export function reviseBlock(block, patch) {
  return { ...block, ...patch, approved: false, approvedText: null };
}

export function approveBlock(block) {
  if (!block.item.trim()) throw new Error('请先填写所属公司或项目。');
  if (!Object.hasOwn(KINDS, block.kind) || block.kind === 'unassigned') {
    throw new Error('请先选择栏目，不自动猜测内容和职责。');
  }
  if (!block.text.trim()) throw new Error('不能确认空段落。');
  return { ...block, approved: true, approvedText: block.text };
}

export function textForCopy(block, { expectedKind = block.kind, maxLength = null } = {}) {
  if (!block.approved || block.approvedText !== block.text) {
    throw new Error('段落尚未确认或已修改，请重新确认。');
  }
  if (!block.item.trim() || block.kind === 'unassigned' || !Object.hasOwn(KINDS, block.kind)) {
    throw new Error('所属经历或栏目无效，请重新确认。');
  }
  if (block.kind !== expectedKind) throw new Error('栏目不匹配，禁止把内容当作职责。');
  if (maxLength !== null) {
    if (!Number.isInteger(maxLength) || maxLength < 1) throw new Error('上限应为正整数。');
    if (block.approvedText.length > maxLength) {
      throw new Error(`原文 ${block.approvedText.length} 字符，超过 ${maxLength} 上限；请本人调整，不自动截断。`);
    }
  }
  return block.approvedText;
}
