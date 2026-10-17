import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCompany, setType, COMPANY_TYPES } from '../extension/company-classifier.js';

test('已知公司名单与名称关键词都能识别为银行', () => {
  const famous = classifyCompany({ company: '招商银行' });
  assert.equal(famous.type, 'bank');
  assert.ok(famous.confidence >= 0.85);
  const keyword = classifyCompany({ company: '测试城市银行' });
  assert.equal(keyword.type, 'bank');
  assert.ok(keyword.confidence >= 0.7);
  assert.match(keyword.reasons.join(' '), /名称/);
});

test('学习过的别名优先且置信度高；未知名回退其他', () => {
  const aliases = {};
  const learned = classifyCompany({ company: '示例小卖部' }, { aliases: { 示例小卖部: 'fmcg' } });
  assert.equal(learned.source, 'learned');
  assert.equal(learned.type, 'fmcg');
  const unknown = classifyCompany({ company: '某某机构' });
  assert.equal(unknown.type, 'other');
  assert.ok(unknown.confidence <= 0.3);
  const empty = classifyCompany({ company: '' });
  assert.match(empty.reasons.join(' '), /未识别公司名/);
});

test('多信号并列时给出备选而不静默吞掉', () => {
  const result = classifyCompany({ company: '示例智能汽车科技' });
  assert.equal(result.type, 'auto');
  assert.ok(result.alternatives.some(item => item.type === 'internet'));
});

test('用户选择写入别名并返回完整结果', () => {
  const aliases = {};
  const entry = { company: '示例机器狗公司' };
  const result = setType(entry, 'manufacturing', aliases);
  assert.equal(result.source, 'user');
  assert.equal(aliases['示例机器狗公司'], 'manufacturing');
  assert.equal(COMPANY_TYPES.manufacturing, '制造/国企/央企');
  assert.equal(classifyCompany(entry, { aliases }).source, 'learned');
  assert.throws(() => setType(entry, 'not-a-type', aliases), /未知公司类型/);
});
