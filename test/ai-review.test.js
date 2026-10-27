import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewPrompt, describeReviewScope, parseReviewResponse, requestAiReview } from '../extension/ai-review.js';

const entry = {
  company: '示例公司',
  industry: { label: '银行/金融', value: 'bank' },
  stage: 'todo',
  review: 'confirmed',
  links: [{ url: 'https://x.example.invalid/jobs' }],
  referral: { selected: 'CODE1', candidates: ['CODE1', 'CODE2'] },
  answers: { '意向分行/城市': '示例城', '父母工作单位': '不应发送' },
  notes: '私密备注不应外发',
  warnings: [],
};

const facts = [
  { label: '姓名', value: '测试同学', status: 'confirmed', source: 'manual' },
  { label: '电话', value: '19900000000', status: 'unconfirmed', source: 'resume' },
  { label: '父母姓名', value: '测试家长', status: 'confirmed', source: 'manual' },
];

const blocks = [
  { id: 'b1', kind: 'internship_content', item: '示例公司', text: '开发样例。', approved: true, approvedText: '开发样例。' },
  { id: 'b2', kind: 'project_content', item: '示例项目', text: '修改后', approved: true, approvedText: '原确认文本' },
];

test('复核提示只含最少必要且已确认的资料', () => {
  const { system, user } = buildReviewPrompt(entry, { facts, blocks });
  assert.match(system, /只做检查/);
  assert.match(system, /findings/);
  assert.match(user, /示例公司/);
  assert.match(user, /测试同学/);
  assert.match(user, /开发样例/);
  assert.match(user, /CODE1/);
  assert.match(user, /意向分行/);
  assert.doesNotMatch(user, /19900000000/);
  assert.doesNotMatch(user, /测试家长/);
  assert.doesNotMatch(user, /私密备注/);
  assert.doesNotMatch(user, /CODE2/);
  assert.doesNotMatch(user, /修改后/);
  assert.doesNotMatch(user, /原确认文本/);
});

test('发送范围摘要说明排除项，便于界面显式授权', () => {
  const scope = describeReviewScope(entry, { facts, blocks });
  assert.deepEqual(scope.factLabels, ['姓名']);
  assert.deepEqual(scope.answerQuestions, ['意向分行/城市']);
  assert.equal(scope.excluded.unconfirmedFacts, 1);
  assert.equal(scope.excluded.sensitiveFacts, 1);
  assert.equal(scope.excluded.unconfirmedOrChangedBlocks, 1);
  assert.equal(scope.excluded.notes, true);
});

test('解析严格 JSON；正常 findings 通过', () => {
  const json = '```json\n{"findings":[{"severity":"warn","area":"内推码","message":"未绑定"}]}\n```';
  const parsed = parseReviewResponse(json);
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0].severity, 'warn');
  assert.deepEqual(parseReviewResponse('{"findings":[]}'), { findings: [] });
});

test('空响应、非 JSON、缺少 findings 或字段无效都失败而不是通过', () => {
  assert.throws(() => parseReviewResponse(''), /返回为空/);
  assert.throws(() => parseReviewResponse('模型返回了纯文本'), /不是有效 JSON/);
  assert.throws(() => parseReviewResponse('{"other":[]}'), /缺少 findings/);
  assert.throws(() => parseReviewResponse('{"findings":[{"message":"没有级别"}]}'), /severity/);
  assert.throws(() => parseReviewResponse('{"findings":[{"severity":"warn","message":""}]}'), /缺少说明/);
  assert.throws(() => parseReviewResponse('{"findings":[null]}'), /格式无效/);
});

test('缺少配置或未确认外发时不发起请求', async () => {
  await assert.rejects(requestAiReview({ apiKey: '', baseUrl: '', model: '' }, entry), /请先在「设置」/);
  await assert.rejects(
    requestAiReview({ apiKey: 'fake', baseUrl: 'https://api.example.invalid/v1', model: 'fake' }, entry),
    /尚未确认本次外发范围/,
  );
});

test('接口返回空内容时失败，不显示“未发现问题”', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '   ' } }] }),
  });
  try {
    await assert.rejects(
      requestAiReview(
        { apiKey: 'fake', baseUrl: 'https://api.example.invalid/v1', model: 'fake' },
        entry,
        { facts, blocks, consent: true },
      ),
      /返回为空/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
