import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewPrompt, parseReviewResponse, requestAiReview } from '../extension/ai-review.js';

const entry = {
  company: '示例公司',
  industry: { label: '银行/金融', value: 'bank' },
  stage: 'todo',
  review: 'confirmed',
  links: [{ url: 'https://x.example.invalid/jobs' }],
  referral: { selected: 'CODE1' },
  answers: {},
  warnings: [],
};

test('复核提示包含严格 JSON 要求与关键数据', () => {
  const { system, user } = buildReviewPrompt(entry, {
    facts: [{ label: '姓名', value: '测试同学', status: 'confirmed' }],
    blocks: [{ kind: 'internship_content', item: '示例公司', text: '开发样例。', approved: true }],
  });
  assert.match(system, /只做检查/);
  assert.match(system, /findings/);
  assert.match(user, /示例公司/);
  assert.match(user, /测试同学/);
  assert.match(user, /开发样例/);
});

test('解析 JSON 输出，异常时降级为单条提示', () => {
  const json = '```json\n{"findings":[{"severity":"warn","area":"内推码","message":"未绑定"}]}\n```';
  const parsed = parseReviewResponse(json);
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0].severity, 'warn');
  const fallback = parseReviewResponse('模型返回了纯文本');
  assert.equal(fallback.findings[0].severity, 'info');
  assert.deepEqual(parseReviewResponse(''), { findings: [] });
});

test('缺少配置时拒绝请求，不发起网络调用', async () => {
  await assert.rejects(requestAiReview({ apiKey: '', baseUrl: '', model: '' }, entry), /请先在「设置」/);
});
