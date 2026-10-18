// 填写计划：把已确认的资料整理成“逐项复制”的填表清单。
// 只使用已确认字段/段落与本人回答；待确认项会标注，不能当作已确认内容。

import { BLOCK_LABELS } from './field-cards.js';

export function buildFillPlan(entry = {}, { facts = [], blocks = [] } = {}) {
  const items = [];
  const seen = new Map();
  const push = ({ label, value, source, status = 'ready' }) => {
    const text = String(value ?? '').trim();
    if (!label || !text) return;
    const count = seen.get(label) || 0;
    seen.set(label, count + 1);
    items.push({
      key: `${label}#${count}`,
      label: count ? `${label}（${count + 1}）` : label,
      value: text,
      source,
      status,
    });
  };

  for (const fact of facts) {
    if (!String(fact.value || '').trim()) continue;
    push({
      label: fact.label,
      value: fact.value,
      source: fact.source === 'resume' ? '资料库 · 简历导入' : '资料库 · 手动',
      status: fact.status === 'confirmed' ? 'ready' : 'pending',
    });
  }

  for (const block of blocks) {
    if (!block?.approved) continue;
    push({
      label: `${BLOCK_LABELS[block.kind] || '段落'}${block.item ? `｜${block.item}` : ''}`,
      value: block.text,
      source: '段落库 · 已确认',
    });
  }

  if (entry.referral?.selected && entry.referral.selected !== 'none') {
    push({ label: '内推码', value: entry.referral.selected, source: '公司条目' });
  }
  for (const [question, answer] of Object.entries(entry.answers || {})) {
    push({ label: `公司补充：${question}`, value: answer, source: '本公司与本批次' });
  }
  if (entry.links?.length) {
    push({ label: '投递链接', value: entry.links.map(link => link.url).join('\n'), source: '公司条目' });
  }
  if (entry.applicationRef) {
    push({ label: '申请号 / 岗位ID', value: entry.applicationRef, source: '本机记录' });
  }
  return items;
}

export function fillPlanProgress(entry = {}, items = []) {
  const done = entry.fillDone && typeof entry.fillDone === 'object' ? entry.fillDone : {};
  const ready = items.filter(item => item.status === 'ready');
  const finished = ready.filter(item => done[item.key]).length;
  return { finished, total: ready.length };
}
