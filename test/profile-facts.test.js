import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFact, validateFacts, factsFromResume, factsSummary } from '../extension/profile-facts.js';

// 全部为虚构示例，仅验证字段映射与状态。

test('factsFromResume 生成全部待确认的字段草稿', () => {
  const profile = {
    personal: { name: '测试同学', phone: '19900000000', email: 'candidate@example.invalid', github: 'github.com/example', intent: '数据应用' },
    education: [{ name: '示例大学', major: '统计', dates: { raw: '2023.09–2025.06' } }],
    internships: [{ name: '示例公司', role: '数据实习生', location: '示例城', dates: { raw: '2024.01–2024.06' } }],
    projects: [{ name: '示例诊断平台', dates: { raw: '2025.07-现在' } }],
    skills: ['Python', 'SQL'],
    language: ['托福100/120'],
    evaluation: ['耐心负责。'],
  };
  const facts = factsFromResume(profile);
  assert.ok(facts.length >= 8);
  assert.ok(facts.every(fact => fact.status === 'unconfirmed'));
  const labels = facts.map(fact => fact.label);
  assert.ok(labels.includes('姓名'));
  assert.ok(labels.includes('教育：示例大学'));
  assert.ok(labels.includes('实习：示例公司'));
  assert.ok(labels.includes('项目：示例诊断平台'));
  assert.ok(labels.includes('技能'));
  assert.deepEqual(factsFromResume(null), []);
});

test('validateFacts 容错并规范状态', () => {
  const facts = validateFacts([{ label: '电话', value: '123', status: 'confirmed' }, null, 'x', { label: 5 }]);
  assert.equal(facts.length, 2);
  assert.equal(facts[0].status, 'confirmed');
  assert.equal(facts[1].label, '');
  assert.deepEqual(validateFacts('nope'), []);
});

test('factsSummary 按确认状态分组，不改变内容', () => {
  const summary = factsSummary([makeFact('姓名', '测试', 'confirmed'), makeFact('电话', '1')]);
  assert.deepEqual(summary.confirmed, ['姓名：测试']);
  assert.deepEqual(summary.unconfirmed, ['电话：1']);
});
