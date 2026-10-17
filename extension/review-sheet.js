// 送审单：把当前公司条目、公司补充回答与信息卡整理为一份可复制的交接文本。
// 只整理已有内容，不生成新事实；最终提交始终由本人操作。

import { buildFieldCard } from './field-cards.js';

export const STAGES = Object.freeze({
  todo: '待准备',
  preparing: '核对中',
  ready: '待本人提交',
  submitted: '本人已提交',
  verified: '官网已核验',
  skip: '已跳过',
});

export const STAGE_FLOW = Object.freeze({
  todo: '生成送审单',
  preparing: '生成送审单',
  ready: '等待本人提交',
  submitted: '提交后核验记录',
  verified: '已完成',
  skip: '已跳过',
});

export function buildReviewSheet(entry, { profile = null, blocks = [], facts = [] } = {}) {
  const lines = [];
  const name = entry.company || '（未命名）';
  lines.push(`# 送审单：${name}`);
  lines.push('');
  const industry = entry.industry
    ? `${entry.industry.label || entry.industry.value}（来源：${entry.industry.source === 'user' ? '你选择' : entry.industry.source === 'learned' ? '已记住' : '本地规则建议'}）`
    : '未判定';
  lines.push(`- 行业建议：${industry}`);
  lines.push(`- 企业性质：${entry.nature && entry.nature !== 'unknown' ? entry.nature : '未填'}｜岗位方向：${entry.direction || '未填'}`);
  lines.push(`- 平台：${entry.platform || 'unknown'}｜批次：${entry.batch || '未填'}｜截止：${entry.deadline || '未填'}`);
  if (entry.links?.length) {
    lines.push('- 链接：');
    for (const link of entry.links) lines.push(`  - ${link.url}`);
  } else {
    lines.push('- 链接：未填（待补充）');
  }
  const referral = entry.referral || {};
  const selected = referral.selected === 'none' ? '本次不用内推'
    : referral.selected ? referral.selected : '未选择';
  lines.push(`- 内推码选定：${selected}｜官网绑定：${referral.bindingVerified ? '已人工确认' : '未核实'}`);
  if (referral.conflict) lines.push('- ⚠ 存在多个内推候选：按你当前的选择生成；内容仍需官网核实。');
  lines.push(`- 人工核对状态：${entry.review === 'confirmed' ? '已人工核对' : entry.review === 'needs_review' ? '待核对' : '草稿'}`);
  lines.push(`- 进度：${STAGES[entry.stage] || STAGES.todo}`);
  lines.push('');

  const card = buildFieldCard(entry.industry?.value || 'other', { profile, blocks, facts });
  const answers = entry.answers || {};
  const answered = card.ask.filter(item => String(answers[item] || '').trim());
  lines.push('## 公司补充（仅此公司，不跨公司复用）');
  if (card.ask.length) {
    for (const item of card.ask) {
      const value = String(answers[item] || '').trim();
      lines.push(`- [${value ? 'x' : ' '}] ${item}：${value || '（待补充）'}`);
    }
  } else {
    lines.push('-（该行业无固定补充项）');
  }
  lines.push('');

  const group = (title, items, empty) => {
    lines.push(`## ${title}`);
    if (items.length) for (const item of items) lines.push(`- ${item}`);
    else lines.push(`-（${empty}）`);
    lines.push('');
  };
  group('已确认可复用', card.reuse, '暂无已确认内容');
  group('已识别待确认', card.pending, '尚未导入简历');
  group('需官网核实', card.verify, '无');
  if (entry.warnings?.length) {
    lines.push('## 待处理提醒');
    for (const warning of entry.warnings) lines.push(`- ${warning}`);
    lines.push('');
  }

  lines.push('## 提交前检查（由本人执行）');
  lines.push('- [ ] 已在官网登录，并核对历史投递、剩余额度与毕业窗口');
  lines.push('- [ ] 页面填写内容与确认文本一致（逐字读回）');
  lines.push('- [ ] 内推码已在官网确认绑定（如适用）');
  lines.push('- [ ] 最终提交由本人点击，提交后回填进度');
  return lines.join('\n');
}
