import test from 'node:test';
import assert from 'node:assert/strict';
import { parseResume, resumeBlocks, validateResume } from '../extension/resume-parser.js';
import { textForCopy } from '../extension/blocks.js';

// Entirely fictional fixture; no real resume or contacts in the repository.
const resume = `教育经历
示例大学  统计｜学术荣誉两次  2023.09–2025.6
实习经历
示例科技公司，示例城\t数据实习生  2024.01–2024.06

使用 Python 整理公开示例数据。

开发可视化样例，不代表生产部署。
项目经历
示例诊断平台  2025.07-现在

构建公开数据的诊断平台。支持本地结果展示。

使用 Python 实现可视化；真实用户验证待完成。
个人技能
数据与开发：Python、SQL
语言与荣誉：托福100/120；示例荣誉
自我评价
耐心负责，重视协作。
## Header
测试同学
电话 199 0000 0000 邮箱 applicant@example.invalid
求职意向：数据应用
`;

test('自动识别区域，DOCX页眉位于末尾也能提取个人信息', () => {
  const profile = parseResume(resume);
  assert.equal(profile.personal.name, '测试同学');
  assert.equal(profile.personal.phone, '19900000000');
  assert.equal(profile.personal.email, 'applicant@example.invalid');
  assert.equal(profile.education.length, 1);
  assert.equal(profile.internships.length, 1);
  assert.equal(profile.projects.length, 1);
  assert.equal(profile.education[0].major, '统计');
  assert.deepEqual(profile.education[0].honors, ['学术荣誉两次']);
  assert.equal(profile.language.length, 1);
  assert.equal(profile.evaluation[0], '耐心负责，重视协作。');
  assert.equal(profile.source.text, resume);
});

test('公司、地点、岗位与正文分离，不混入职责段落', () => {
  const entry = parseResume(resume).internships[0];
  assert.equal(entry.name, '示例科技公司');
  assert.equal(entry.location, '示例城');
  assert.equal(entry.role, '数据实习生');
  assert.equal(entry.content, '使用 Python 整理公开示例数据。\n\n开发可视化样例，不代表生产部署。');
  assert.equal(entry.content.includes('数据实习生'), false);
});

test('月精度日期不虚构具体日，进行中无假结束日，项目角色保持空白', () => {
  const profile = parseResume(resume);
  assert.equal(profile.education[0].dates.end, '2025-06');
  assert.equal(profile.projects[0].dates.start, '2025-07');
  assert.equal(profile.projects[0].dates.end, null);
  assert.equal(profile.projects[0].dates.ongoing, true);
  assert.equal(profile.projects[0].role, '');
});

test('PDF公司名断行与多条项目符号可重建，原始换行仍保留', () => {
  const input = `实习经历\n示例甲公司\n，甲城   分析实习生   2024.01-2024.03\n 使用 Python 分析\n  示例数据。\n 保留验证限制。\n示例乙公司\n，乙城   开发实习生   2024.04-2024.06\n 第二家正文。\n项目经历\n示例平台   2024.07-现在\n 开发样例。`;
  const profile = parseResume(input);
  assert.equal(profile.internships.length, 2);
  assert.equal(profile.internships[0].name, '示例甲公司');
  assert.equal(profile.internships[1].name, '示例乙公司');
  assert.equal(profile.internships[0].content, '使用 Python 分析示例数据。\n\n保留验证限制。');
  assert.equal(profile.internships[0].paragraphs[0].raw.includes('\n'), true);
  assert.equal(profile.internships[0].content.includes('示例乙公司'), false);
});

test('正文中的日期不是条目标题', () => {
  const profile = parseResume(resume.replace('使用 Python 整理公开示例数据。', '使用 2022.01-2023.01 的历史记录分析。'));
  assert.equal(profile.internships.length, 1);
  assert.match(profile.internships[0].content, /2022.01-2023.01/);
  const bullet = parseResume(resume.replace('使用 Python 整理公开示例数据。', ' 使用历史记录，范围2022.01-2023.01'));
  assert.equal(bullet.internships.length, 1);
  assert.match(bullet.internships[0].content, /2022.01-2023.01/);
});

test('项目候选有出处、保留未完成限制，并且不可直接复制', () => {
  const profile = parseResume(resume);
  const project = profile.projects[0];
  assert.equal(project.candidates.status, 'unconfirmed');
  assert.deepEqual(project.candidates.summary.sourceParagraphIds, ['projects-1:p1']);
  assert.match(project.candidates.responsibilities.text, /真实用户验证待完成/);
  const blocks = resumeBlocks(profile, { includeCandidates: true });
  assert.equal(blocks.filter(b => b.kind === 'project_content').length, 1);
  assert.equal(blocks.filter(b => b.kind === 'project_responsibilities').length, 1);
  for (const block of blocks) assert.throws(() => textForCopy(block), /未确认/);
});

test('默认不加入候选，项目原文独立保留', () => {
  const blocks = resumeBlocks(parseResume(resume));
  assert.equal(blocks.some(b => b.kind === 'project_responsibilities'), false);
  assert.equal(blocks.find(b => b.kind === 'project_original').text.includes('真实用户验证待完成'), true);
});

test('缺失评价不自动生成，未知区域仍有原文可查', () => {
  const profile = parseResume('项目经历\n示例平台  2024.01-现在\n开发原型。');
  assert.deepEqual(profile.evaluation, []);
  assert.equal(profile.personal.name, '');
  assert.match(profile.warnings.join(' '), /未提供个人评价/);
});

test('无效月份不自动使用', () => {
  const profile = parseResume(resume.replace('2025.07-现在', '2025.13-现在'));
  assert.equal(profile.projects[0].dates.invalid, true);
  assert.equal(profile.projects[0].dates.start, null);
});

test('导入的确认标志一律重置，候选来源无效则拒绝', () => {
  const profile = parseResume(resume);
  profile.status = 'approved'; profile.projects[0].status = 'approved';
  profile.projects[0].candidates.status = 'approved';
  validateResume(profile);
  assert.equal(profile.status, 'unconfirmed');
  assert.equal(profile.projects[0].candidates.status, 'unconfirmed');
  profile.projects[0].candidates.summary.sourceParagraphIds = ['nonexistent'];
  assert.throws(() => validateResume(profile), /出处/);
  assert.throws(() => validateResume({}), /结构化简历/);
});
