// 信息卡：按“真实存在性与确认状态”分组，不生成任何个人信息。
// 已确认可复用 / 已识别待确认 / 待本人补充 / 需官网核实 / 部分单位可能要求。
// 可能要求的字段只是提示，不代表网站必填，也不会提前收集敏感信息。

export const INDUSTRY_TEMPLATES = Object.freeze({
  bank: {
    ask: ['意向分行/城市'],
    possible: ['身高体重', '家庭/社会关系声明', '奖惩/处分声明', '征信/合规类声明', '紧急联系人关系', '学历认证编号/日期'],
  },
  auto: {
    ask: ['意向城市数量', '到岗时间'],
    possible: ['驾照（有无/类型）', '出差/驻场/轮班', '海外派遣及区域'],
  },
  manufacturing: {
    ask: ['是否接受调剂'],
    possible: ['政治面貌', '户籍/档案信息', '政审/体检类声明', '家庭成员信息', '处分/违法记录声明'],
  },
  internet: {
    ask: ['期望薪资'],
    possible: ['GitHub/作品集', '游戏经历（如实际表单要求）'],
  },
  fmcg: {
    ask: ['可实习时长/到岗', '轮班/门店接受度'],
    possible: ['英语成绩', '海外经历/签证'],
  },
  other: {
    ask: ['是否接受调剂', '到岗时间', '期望薪资'],
    possible: [],
  },
});

const VERIFY_COMMON = ['毕业窗口是否覆盖本人毕业时间', '官网历史投递与剩余额度', '内推绑定状态（链接携带不等于已绑定）'];

const BLOCK_LABELS = {
  internship_content: '实习内容',
  project_content: '项目简述',
  project_responsibilities: '项目职责',
  project_original: '项目原文',
  language: '语言与荣誉',
  evaluation: '个人评价',
  other: '其他段落',
};

// 仅统计已确认的段落；解析或草稿一律不计入复用。
export function approvedSummaryFromBlocks(blocks = []) {
  const counts = new Map();
  for (const block of blocks) {
    if (!block || !block.approved) continue;
    const label = BLOCK_LABELS[block.kind] || '段落';
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => `${label}×${count}（已确认段落）`);
}

// 已解析但未确认的简历内容，只进入“待确认”，不能称为可复用。
export function pendingSummaryFromResume(profile) {
  if (!profile) return [];
  const parts = ['个人信息'];
  if (profile.education?.length) parts.push(`教育×${profile.education.length}`);
  if (profile.internships?.length) parts.push(`实习×${profile.internships.length}`);
  if (profile.projects?.length) parts.push(`项目×${profile.projects.length}`);
  if (profile.language?.length) parts.push('语言成绩');
  if (profile.skills?.length) parts.push('技能');
  if (profile.evaluation?.length) parts.push('自我评价');
  return parts;
}

export function buildFieldCard(industry, { profile = null, blocks = [] } = {}) {
  const template = INDUSTRY_TEMPLATES[industry] || INDUSTRY_TEMPLATES.other;
  return {
    reuse: approvedSummaryFromBlocks(blocks),
    pending: pendingSummaryFromResume(profile),
    ask: [...template.ask],
    verify: [...VERIFY_COMMON],
    possible: [...template.possible],
  };
}
