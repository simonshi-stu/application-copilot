import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFillPlan, fillPlanProgress } from '../extension/fill-plan.js';

const entry = {
  company: '示例公司',
  links: [{ url: 'https://x.example.invalid/jobs' }],
  referral: { selected: 'CODE1', conflict: false },
  answers: { '意向分行/城市': '示例城' },
  applicationRef: 'JOB-1',
};

test('已确认字段与已确认段落进入填写计划，待确认字段标记 pending', () => {
  const items = buildFillPlan(entry, {
    facts: [
      { id: '1', label: '姓名', value: '测试同学', status: 'confirmed', source: 'manual' },
      { id: '2', label: '电话', value: '19900000000', status: 'unconfirmed', source: 'resume' },
    ],
    blocks: [
      { id: 'b1', kind: 'internship_content', item: '示例公司', text: '开发样例。', approved: true, approvedText: '开发样例。' },
      { id: 'b2', kind: 'project_original', item: '示例项目', text: '未确认段落。', approved: false, approvedText: null },
    ],
  });
  const name = items.find(item => item.label === '姓名');
  assert.equal(name.status, 'ready');
  assert.equal(name.source, '资料库 · 手动');
  const phone = items.find(item => item.label === '电话');
  assert.equal(phone.status, 'pending');
  assert.ok(items.some(item => item.label.includes('实习内容')));
  assert.ok(!items.some(item => item.value === '未确认段落。'));
  assert.ok(items.some(item => item.label === '内推码' && item.value === 'CODE1'));
  assert.ok(items.some(item => item.label.startsWith('公司补充')));
  assert.ok(items.some(item => item.label === '投递链接'));
  assert.ok(items.some(item => item.label.includes('申请号')));
});

test('填写计划保留原文空白，不 trim；仅 approved 但文本已改的段落不进入', () => {
  const items = buildFillPlan({}, {
    facts: [{ label: '姓名', value: '  测试同学\n', status: 'confirmed', source: 'manual' }],
    blocks: [
      { id: 'b1', kind: 'internship_content', item: '示例公司', text: '修改后', approved: true, approvedText: '原确认文本' },
      { id: 'b2', kind: 'internship_content', item: '示例公司', text: '已确认原文\n第二行', approved: true, approvedText: '已确认原文\n第二行' },
    ],
  });
  assert.equal(items.find(item => item.label === '姓名').value, '  测试同学\n');
  assert.ok(items.some(item => item.value === '已确认原文\n第二行'));
  assert.ok(!items.some(item => item.value === '修改后'));
  assert.ok(!items.some(item => item.value === '原确认文本'));
});

test('确认版本被修改或所属经历为空时，段落不进入计划', () => {
  const items = buildFillPlan({}, {
    blocks: [
      { id: 'b1', kind: 'project_content', item: '', text: '无归属', approved: true, approvedText: '无归属' },
      { id: 'b2', kind: 'unassigned', item: '示例项目', text: '未分类', approved: true, approvedText: '未分类' },
    ],
  });
  assert.equal(items.length, 0);
});

test('空值不进入计划；进行中的内推选择（本次不用）不出现', () => {
  const items = buildFillPlan({ ...entry, referral: { selected: 'none' } }, { facts: [{ label: '空', value: '', status: 'confirmed' }] });
  assert.ok(!items.some(item => item.label === '空'));
  assert.ok(!items.some(item => item.label === '内推码'));
});

test('进度只统计 ready 项并按 key 记录', () => {
  const items = [
    { key: 'a#0', status: 'ready' },
    { key: 'b#0', status: 'ready' },
    { key: 'c#0', status: 'pending' },
  ];
  const progress = fillPlanProgress({ fillDone: { 'a#0': true } }, items);
  assert.deepEqual(progress, { finished: 1, total: 2 });
  assert.deepEqual(fillPlanProgress({}, items), { finished: 0, total: 2 });
});
