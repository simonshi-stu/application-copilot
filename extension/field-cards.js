// 信息卡：类型模板 × 资料库 → “这家公司还需要补充/核实什么”。
// 只做集合差与展示，不生成任何个人信息。

export const FIELD_TEMPLATES = Object.freeze({
  bank: [
    { label: '身高体重', level: 'reuse' },
    { label: '政治面貌', level: 'reuse' },
    { label: '家庭/社会关系声明', level: 'ask' },
    { label: '奖惩/处分声明', level: 'ask' },
    { label: '征信/合规类声明', level: 'ask' },
    { label: '意向分行/城市', level: 'ask' },
    { label: '紧急联系人关系（如必填）', level: 'ask' },
    { label: '学历认证编号/日期', level: 'verify' },
  ],
  auto: [
    { label: '驾照（有无/类型）', level: 'ask' },
    { label: '出差/驻场/轮班', level: 'ask' },
    { label: '海外派遣及区域', level: 'ask' },
    { label: '意向城市数量', level: 'ask' },
    { label: '到岗时间', level: 'ask' },
    { label: '内推码绑定状态', level: 'verify' },
  ],
  manufacturing: [
    { label: '政治面貌', level: 'reuse' },
    { label: '户籍/档案信息', level: 'ask' },
    { label: '政审/体检类声明', level: 'ask' },
    { label: '家庭成员信息', level: 'ask' },
    { label: '处分/违法记录声明', level: 'ask' },
    { label: '学历认证材料', level: 'verify' },
  ],
  internet: [
    { label: 'GitHub/作品集', level: 'reuse' },
    { label: '游戏经历（如必填）', level: 'ask' },
    { label: '期望薪资', level: 'ask' },
    { label: '毕业窗口', level: 'verify' },
  ],
  fmcg: [
    { label: '英语成绩', level: 'reuse' },
    { label: '海外经历/签证', level: 'ask' },
    { label: '可实习时长/到岗', level: 'ask' },
    { label: '轮班/门店接受度', level: 'ask' },
  ],
  other: [
    { label: '是否接受调剂', level: 'ask' },
    { label: '到岗时间', level: 'ask' },
    { label: '期望薪资', level: 'ask' },
    { label: '内推码绑定状态', level: 'verify' },
  ],
});

export const DEFAULT_PROFILE_SUMMARY = ['个人信息', '教育经历', '实习经历', '项目经历', '语言成绩', '技能', '自我评价'];

export function profileSummaryFromResume(profile) {
  if (!profile) return DEFAULT_PROFILE_SUMMARY;
  const parts = ['个人信息'];
  if (profile.education?.length) parts.push(`教育经历×${profile.education.length}`);
  if (profile.internships?.length) parts.push(`实习经历×${profile.internships.length}`);
  if (profile.projects?.length) parts.push(`项目经历×${profile.projects.length}`);
  if (profile.language?.length) parts.push('语言成绩');
  if (profile.skills?.length) parts.push('技能');
  if (profile.evaluation?.length) parts.push('自我评价');
  return parts;
}

export function buildFieldCard(type, profileSummary = DEFAULT_PROFILE_SUMMARY) {
  const template = FIELD_TEMPLATES[type] || FIELD_TEMPLATES.other;
  return {
    ask: template.filter(field => field.level === 'ask').map(field => field.label),
    verify: template.filter(field => field.level === 'verify').map(field => field.label),
    reuse: [...profileSummary, ...template.filter(field => field.level === 'reuse').map(field => field.label)],
  };
}
