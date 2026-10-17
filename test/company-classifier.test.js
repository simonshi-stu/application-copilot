import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCompany, setIndustry, INDUSTRIES, NATURES } from '../extension/company-classifier.js';

test('已知公司名单与名称关键词都能识别为银行', () => {
  const famous = classifyCompany({ company: '招商银行' });
  assert.equal(famous.industry, 'bank');
  assert.equal(famous.matchLevel, 'known');
  const keyword = classifyCompany({ company: '测试城市银行' });
  assert.equal(keyword.industry, 'bank');
  assert.equal(keyword.matchLevel, 'keyword');
  assert.match(keyword.reasons.join(' '), /名称/);
});

test('学习过的别名优先；未知名回退其他', () => {
  const learned = classifyCompany({ company: '示例小卖部' }, { aliases: { 示例小卖部: 'fmcg' } });
  assert.equal(learned.source, 'learned');
  assert.equal(learned.industry, 'fmcg');
  const unknown = classifyCompany({ company: '某某机构' });
  assert.equal(unknown.industry, 'other');
  assert.equal(unknown.matchLevel, 'none');
  const empty = classifyCompany({ company: '' });
  assert.match(empty.reasons.join(' '), /未识别公司名/);
});

test('多信号并列时给出备选而不静默吞掉', () => {
  const result = classifyCompany({ company: '示例智能汽车科技' });
  assert.equal(result.industry, 'auto');
  assert.ok(result.alternatives.some(item => item.industry === 'internet'));
});

test('用户选择写入别名；维度标签相互独立', () => {
  const aliases = {};
  const entry = { company: '示例机器狗公司' };
  const result = setIndustry(entry, 'manufacturing', aliases);
  assert.equal(result.source, 'user');
  assert.equal(aliases['示例机器狗公司'], 'manufacturing');
  assert.equal(INDUSTRIES.manufacturing, '制造/工业');
  assert.equal(NATURES.soe, '国企/央企');
  assert.equal(classifyCompany(entry, { aliases }).source, 'learned');
  assert.throws(() => setIndustry(entry, 'not-a-type', aliases), /未知行业选项/);
});
