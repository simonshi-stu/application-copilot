// 流程步骤推导：把“下一步”从一条文案升级为可展示的步骤状态。
// 只根据本地已存字段判断，不猜测官网状态。

export const FLOW_LABELS = Object.freeze(['链接与内推', '公司问答', '核对确认', '送审单', '提交与核验']);

export function computeFlowSteps(entry = {}, { unanswered = 0 } = {}) {
  const stage = entry.stage || 'todo';
  const linkReady = Boolean(
    entry.company
    && Array.isArray(entry.links) && entry.links.length
    && (!entry.referral?.conflict || entry.referral?.selected),
  );
  const answersReady = unanswered <= 0;
  const reviewReady = entry.review === 'confirmed';
  const sheetReady = Boolean(entry.sheetCopiedAt) || ['ready', 'submitted', 'verified'].includes(stage);
  const submitDone = stage === 'submitted' || stage === 'verified';
  const submitSkipped = stage === 'skip';
  const doneFlags = [linkReady, answersReady, reviewReady, sheetReady, submitDone];

  return FLOW_LABELS.map((label, index) => {
    let state;
    if (index === 4 && submitSkipped) state = 'skipped';
    else if (doneFlags.slice(0, index + 1).every(Boolean)) state = 'done';
    else state = doneFlags.slice(0, index).every(Boolean) ? 'current' : 'todo';
    return { label, state };
  });
}
