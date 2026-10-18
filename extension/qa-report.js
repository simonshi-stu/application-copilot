// 本地自检：只根据已存数据与已知规则列出问题，不调用模型、不访问网站。
// 用于提交前的第二遍人工复核辅助。

export function buildQaReport(entry = {}, { facts = [], unanswered = 0 } = {}) {
  const items = [];
  const add = (severity, text) => items.push({ severity, text });

  if (!entry.company) add('error', '公司名为空');
  if (!Array.isArray(entry.links) || !entry.links.length) add('error', '缺少招聘链接');
  if (entry.referral?.conflict && !entry.referral?.selected) add('error', '存在多个内推码，尚未选择');
  if (entry.referral?.selected && entry.referral.selected !== 'none' && !entry.referral.bindingVerified) {
    add('info', '内推码已选定，但尚未在官网确认绑定（链接携带不等于已绑定）');
  }
  if (unanswered > 0) add('warn', `还有 ${unanswered} 项公司补充未填写`);
  if (entry.review !== 'confirmed') add('warn', '尚未标记「已人工核对」');
  if (entry.review === 'confirmed' && !entry.sheetCopiedAt) add('info', '已核对，但尚未生成送审单');
  if (['ready', 'submitted', 'verified'].includes(entry.stage) && !entry.sheetCopiedAt) {
    add('warn', '进度已到提交阶段，但没有送审单生成记录');
  }
  if (['submitted', 'verified'].includes(entry.stage) && !entry.appliedAt) {
    add('info', '已标记提交，建议补填提交日期（仅本地记录）');
  }
  if (!entry.appliedAt && entry.stage === 'todo' && entry.review === 'confirmed') {
    add('info', '尚未填写提交日期；如已提交请在详情中更新进度');
  }
  const unconfirmed = facts.filter(fact => fact.status !== 'confirmed' && String(fact.value || '').trim()).length;
  if (unconfirmed) add('info', `资料库还有 ${unconfirmed} 个字段未确认，不会计入可复用`);
  for (const warning of entry.warnings || []) add('warn', warning);

  const order = { error: 0, warn: 1, info: 2 };
  items.sort((a, b) => order[a.severity] - order[b.severity]);
  const level = items.some(item => item.severity === 'error') ? 'error'
    : items.some(item => item.severity === 'warn') ? 'warn' : 'ok';
  return { level, items };
}
