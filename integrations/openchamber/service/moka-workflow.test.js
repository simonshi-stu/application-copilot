import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createMokaWorkflow, createMemoryCredentialStore } from './moka-workflow.js';
import { ModelRouterError } from '../../../core/model-router.js';

const NOW = '2026-10-27T00:00:00.000Z';
const URL1 = 'https://app.mokahr.com/campus/c1';
const JOB1 = 'https://app.mokahr.com/jobs/J1';

function companyView(overrides = {}) {
  return {
    id: 'c1',
    name: '虚构公司甲',
    status: 'researching',
    activePositionId: null,
    selectedPositionIds: [],
    links: [{ url: URL1 }],
    ...overrides,
  };
}

function positionView(overrides = {}) {
  return {
    id: 'p1',
    companyId: 'c1',
    officialId: 'J1',
    title: '虚构岗位',
    status: 'preparing',
    source: { url: JOB1, checkedAt: NOW, evidence: '虚构来源' },
    ...overrides,
  };
}

function facts() {
  return [
    {
      id: 'f_name', section: 'basic', label: '姓名', value: '虚构姓名', version: 2, confirmed: true,
      confirmedVersion: 2, sensitivity: 'normal', scope: { type: 'global' }, entityId: null, allowedPurposes: [],
    },
    {
      id: 'f_phone', section: 'basic', label: '手机', value: '13800000000', version: 1, confirmed: true,
      confirmedVersion: 1, sensitivity: 'normal', scope: { type: 'global' }, entityId: null, allowedPurposes: [],
    },
    {
      id: 'f_family', section: 'family', label: '父亲姓名', value: '虚构家长', version: 1, confirmed: true,
      confirmedVersion: 1, sensitivity: 'family', scope: { type: 'global' }, entityId: null, allowedPurposes: [],
    },
  ];
}

function makeEnvironment({ status = 'researching', position = null, snapshot = null, observeSnapshot = null, router = null, factList = null, credentialStore = null, getRoles = null, routerFactory = null, fetchImpl = null, useRealRouter = false, fillImpl = null } = {}) {
  const base = path.join(os.tmpdir(), `acopilot-moka-${randomUUID()}`);
  const calls = { records: [], issues: [], fill: 0, readback: 0, review: 0, rank: 0, mapFields: 0, noPositions: 0, close: 0 };
  const state = {
    company: companyView({ status, activePositionId: position?.id || null, selectedPositionIds: position ? [position.id] : [] }),
    positions: position ? [position] : [],
    summary: { queue: { status: 'running', currentCompanyId: 'c1' }, profileVersion: 3 },
  };
  const fakeDriver = {
    getStatus: () => ({ status: 'open', closed: false, lastPageUrl: URL1 }),
    openCompany: async () => ({ ok: true, pageUrl: URL1, targetId: 'target-1' }),
    extractResearchSnapshot: async () => snapshot || {
      status: 'ok', sourceUrl: URL1, capturedAt: NOW,
      jobs: [{ jobId: 'J1', title: '虚构岗位', url: JOB1, city: '上海', jd: '虚构 JD' }],
      issues: [],
    },
    observe: async () => ({
      ok: true,
      snapshot: observeSnapshot || {
        id: 'snap-1', targetId: 'target-1', pageUrl: JOB1, capturedAt: NOW,
        controls: [
          { ref: 'mc_a-0', label: '姓名', type: 'text', region: { type: 'basic', entityId: null }, maxLength: 20, writable: true, options: null },
          { ref: 'mc_a-1', label: '手机', type: 'text', region: { type: 'basic', entityId: null }, maxLength: 20, writable: true, options: null },
          { ref: 'mc_a-2', label: '政治面貌', type: 'text', region: { type: 'basic', entityId: null }, maxLength: 20, writable: true, options: null },
        ],
      },
    }),
    fillConfirmedPlan: fillImpl || (async (plan) => {
      calls.fill += 1;
      return { ok: true, results: plan.items.map((item) => ({ controlRef: item.controlRef, status: 'filled' })), issues: [] };
    }),
    readbackApprovedPlan: async (plan) => {
      calls.readback += 1;
      return {
        ok: true, source: 'page_readback', url: JOB1, capturedAt: NOW,
        fields: plan.items.map((item) => ({
          fieldId: item.controlRef, controlId: item.controlRef, label: item.expectedLabel,
          readbackValue: item.optionLabel || item.text,
        })),
      };
    },
    close: async () => { calls.close += 1; return { ok: true }; },
  };
  const fakeRouter = router || {
    rankCandidates: async ({ officialSnapshot }) => {
      calls.rank += 1;
      return { suggestions: [{ officialId: officialSnapshot.jobs[0].officialId, title: officialSnapshot.jobs[0].title, reason: '虚构匹配', gaps: [] }] };
    },
    mapFields: async () => {
      calls.mapFields += 1;
      return { mappings: [] };
    },
    reviewReadback: async ({ expected }) => {
      calls.review += 1;
      return { passed: true, programDiffs: [], modelFindings: [], reviewKind: 'page_readback' };
    },
  };
  const registry = {
    invoke: async (name, input) => {
      if (name === 'get_company') return { company: state.company, positions: state.positions };
      if (name === 'list_profile_facts_for_local_edit') return factList ? factList() : facts();
      if (name === 'record_position_candidates') {
        calls.records.push(input);
        state.company = { ...state.company, status: 'awaiting_selection' };
        return { company: state.company, positions: [] };
      }
      if (name === 'record_no_positions') { calls.noPositions += 1; return {}; }
      if (name === 'add_issue') { calls.issues.push(input); return { issue: input }; }
      if (name === 'list_issues') return calls.issues.map((issue, index) => ({ id: `i${index}`, status: 'open', companyId: issue.companyId }));
      throw new Error(`unexpected tool ${name}`);
    },
  };
  const core = { summary: async () => state.summary };
  const workflow = createMokaWorkflow({
    projectPath: base,
    core,
    registry,
    credentialStore: credentialStore || createMemoryCredentialStore(),
    getRoles: getRoles || (async () => ({
      search: { provider: 'fake', model: 'research-v1', endpoint: 'https://models.example.invalid/v1' },
      execution: { provider: 'fake', model: 'execute-v1', endpoint: 'https://models.example.invalid/v1' },
      review: { provider: 'fake', model: 'review-v1', endpoint: 'https://models.example.invalid/v1' },
    })),
    now: () => NOW,
    newId: () => randomUUID(),
    driverFactory: () => fakeDriver,
    ...(useRealRouter ? {} : { routerFactory: routerFactory || (() => fakeRouter) }),
    ...(fetchImpl ? { fetchImpl } : {}),
  });
  return { base, calls, state, workflow, credentialStore: credentialStore || undefined };
}

async function waitFor(workflow, status = 'completed') {
  for (let i = 0; i < 200; i += 1) {
    const snapshot = await workflow.getState();
    if (snapshot.operation && snapshot.operation.status !== 'running') {
      assert.equal(snapshot.operation.status, status, snapshot.operation.message);
      return snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('operation did not finish');
}

async function openWindow(env) {
  await env.workflow.startOpen({ companyId: 'c1' });
  await waitFor(env.workflow);
}

test('research records only snapshot official ids and never turns incomplete snapshots into no positions', async () => {
  const env = makeEnvironment();
  await openWindow(env);
  await env.workflow.startResearch({ companyId: 'c1', sendAuthorized: true });
  await waitFor(env.workflow);
  assert.equal(env.calls.rank, 1);
  assert.equal(env.calls.records.length, 1);
  assert.equal(env.calls.records[0].positions[0].officialId, 'J1');
  assert.equal(env.calls.records[0].positions[0].sourceUrl, JOB1);
  assert.match(env.calls.records[0].positions[0].matchEvidence, /虚构匹配/);

  const incomplete = makeEnvironment({
    snapshot: { status: 'incomplete', sourceUrl: URL1, capturedAt: NOW, jobs: [], issues: [{ code: 'NO_RELIABLE_JOB_CARDS' }], message: '没有可靠岗位卡' },
  });
  await openWindow(incomplete);
  await incomplete.workflow.startResearch({ companyId: 'c1', sendAuthorized: true });
  await waitFor(incomplete.workflow);
  assert.equal(incomplete.calls.rank, 0);
  assert.equal(incomplete.calls.records.length, 0);
  assert.equal(incomplete.calls.noPositions, 0);
  assert.equal(incomplete.calls.issues.length, 1);
});

test('fill prepares confirmed local fields, rejects family data, reads back actual page values and never marks ready', async () => {
  const env = makeEnvironment({ status: 'preparing', position: positionView() });
  await openWindow(env);
  await env.workflow.startPrepare({ companyId: 'c1', jobId: 'p1', sendAuthorized: true });
  const prepared = await waitFor(env.workflow);
  assert.equal(prepared.plan.itemCount, 2);
  assert.equal(prepared.plan.items.some((item) => item.factId === 'f_family'), false);
  assert.ok(env.calls.issues.some((issue) => issue.fieldKey.includes('mc_a-2')));

  const planId = prepared.plan.planId;
  env.workflow.confirmPlan(planId, true);
  await env.workflow.startRun({ companyId: 'c1', jobId: 'p1', positionId: 'p1', planId, sendAuthorized: true });
  const done = await waitFor(env.workflow);
  assert.equal(env.calls.fill, 1);
  assert.equal(env.calls.review, 1);
  assert.equal(done.review.passed, true);
  assert.equal(done.review.programDiffCount, 0);
  assert.equal(done.review.readbackFields, 2);
  assert.equal(done.issueDigest.ready, true);

  env.state.summary = { ...env.state.summary, profileVersion: 4 };
  await env.workflow.startRun({ companyId: 'c1', jobId: 'p1', positionId: 'p1', planId, sendAuthorized: true }).catch(() => {});
  await waitFor(env.workflow, 'failed');
  assert.equal(env.calls.fill, 1, '旧计划或旧资料版本不能重放填写');
});

function projectFact(id, section, label, value, entityId = 'project_1') {
  return {
    id, section, label, value, entityId, version: 1, confirmed: true, confirmedVersion: 1,
    sensitivity: 'normal', scope: { type: 'global' }, allowedPurposes: [],
  };
}

function projectSnapshot(controls) {
  return {
    id: 'snap-project', targetId: 'target-1', pageUrl: JOB1, capturedAt: NOW,
    controls: controls.map((control, index) => ({
      ref: control.ref || `mc_p-${index}`, label: control.label, type: 'textarea',
      region: { type: 'project', entityId: control.entityId || 'project_1', ambiguous: false },
      maxLength: 500, writable: true, options: null,
    })),
  };
}

test('项目内容与本人职责严格分开，缺失时记录问题且不调用模型猜值', async () => {
  const content = projectFact('f_content', 'project_content', '项目内容', '项目内容第一段\n\n第二段');
  const responsibility = projectFact('f_responsibility', 'project_responsibilities', '本人职责', '职责第一段\n\n职责第二段');
  let seenPlan = null;
  const complete = makeEnvironment({
    status: 'preparing', position: positionView(), factList: () => [content, responsibility],
    observeSnapshot: projectSnapshot([{ label: '项目内容' }, { label: '本人职责' }]),
    fillImpl: async (plan) => {
      seenPlan = plan;
      return { ok: true, results: plan.items.map((item) => ({ controlRef: item.controlRef, status: 'filled' })), issues: [] };
    },
  });
  await openWindow(complete);
  await complete.workflow.startPrepare({ companyId: 'c1', jobId: 'p1', sendAuthorized: true });
  const prepared = await waitFor(complete.workflow);
  const byFact = new Map(prepared.plan.items.map((item) => [item.factId, item]));
  assert.equal(byFact.get('f_content').fieldKey, 'project.content');
  assert.equal(byFact.get('f_responsibility').fieldKey, 'project.responsibilities');
  complete.workflow.confirmPlan(prepared.plan.planId, true);
  await complete.workflow.startRun({ companyId: 'c1', jobId: 'p1', positionId: 'p1', planId: prepared.plan.planId, sendAuthorized: true });
  await waitFor(complete.workflow);
  const originalById = new Map(seenPlan.items.map((item) => [item.factId, item]));
  assert.equal(originalById.get('f_content').originalText, content.value);
  assert.equal(originalById.get('f_content').text, content.value);
  assert.equal(originalById.get('f_responsibility').text, responsibility.value);
  assert.equal(complete.calls.mapFields, 0);

  for (const [factsOnly, missingField] of [[[responsibility], '项目内容'], [[content], '本人职责']]) {
    const partial = makeEnvironment({
      status: 'preparing', position: positionView(), factList: () => factsOnly,
      observeSnapshot: projectSnapshot([{ label: '项目内容' }, { label: '本人职责' }]),
    });
    await openWindow(partial);
    await partial.workflow.startPrepare({ companyId: 'c1', jobId: 'p1', sendAuthorized: true });
    const result = await waitFor(partial.workflow).catch(async () => partial.workflow.getState());
    assert.equal(Boolean(result.plan?.items?.some((item) => item.label === missingField)), false);
    assert.equal(result.plan?.items?.length, 1);
    assert.equal(partial.calls.mapFields, 0, '缺失匹配资料时不应让模型猜值');
    assert.ok(partial.calls.issues.some((issue) => issue.message.includes('未让模型猜值')));
  }

  const mismatched = makeEnvironment({
    status: 'preparing', position: positionView(),
    factList: () => [responsibility, content],
    observeSnapshot: projectSnapshot([{ label: '项目内容' }, { label: '本人职责' }]),
  });
  await openWindow(mismatched);
  await mismatched.workflow.startPrepare({ companyId: 'c1', jobId: 'p1', sendAuthorized: true });
  const result = await waitFor(mismatched.workflow);
  const contentItem = result.plan.items.find((item) => item.label === '项目内容');
  const responsibilityItem = result.plan.items.find((item) => item.label === '本人职责');
  assert.equal(contentItem.factId, 'f_content');
  assert.equal(responsibilityItem.factId, 'f_responsibility');
  assert.equal(contentItem.regionEntityId, responsibilityItem.regionEntityId);
});

test('模型映射分支必须与该控件候选 factKey 精确兼容', async () => {
  const content1 = projectFact('f_c1', 'project_content', '项目内容', '内容一');
  const content2 = projectFact('f_c2', 'project_content', '项目描述', '内容二');
  const responsibility = projectFact('f_resp', 'project_responsibilities', '本人职责', '职责原文');
  const wrong = makeEnvironment({
    status: 'preparing', position: positionView(),
    factList: () => [content1, content2, responsibility],
    observeSnapshot: projectSnapshot([{ ref: 'mc_content', label: '项目内容' }]),
    router: {
      mapFields: async () => ({ mappings: [{ controlId: 'mc_content', factId: 'f_resp' }] }),
      rankCandidates: async () => ({ suggestions: [] }),
      reviewReadback: async () => ({ passed: true, modelFindings: [] }),
    },
  });
  await openWindow(wrong);
  await wrong.workflow.startPrepare({ companyId: 'c1', jobId: 'p1', sendAuthorized: true });
  const rejected = await waitFor(wrong.workflow, 'failed');
  assert.equal(rejected.plan, null);
  assert.ok(wrong.calls.issues.some((issue) => issue.message.includes('语义不兼容')));

  const right = makeEnvironment({
    status: 'preparing', position: positionView(),
    factList: () => [content1, content2],
    observeSnapshot: projectSnapshot([{ ref: 'mc_content', label: '项目内容' }]),
    router: {
      mapFields: async () => ({ mappings: [{ controlId: 'mc_content', factId: 'f_c1' }] }),
      rankCandidates: async () => ({ suggestions: [] }),
      reviewReadback: async () => ({ passed: true, modelFindings: [] }),
    },
  });
  await openWindow(right);
  await right.workflow.startPrepare({ companyId: 'c1', jobId: 'p1', sendAuthorized: true });
  const accepted = await waitFor(right.workflow);
  assert.equal(accepted.plan.items.length, 1);
  assert.equal(accepted.plan.items[0].factId, 'f_c1');
  assert.equal(accepted.plan.items[0].fieldKey, 'project.content');
  assert.equal(accepted.plan.items[0].label, '项目内容');
});

test('三个路由角色使用各自内存 Key；缺 Key 与无授权均零外发', async () => {
  const credentials = createMemoryCredentialStore();
  credentials.set('search', 'search-key');
  credentials.set('execution', 'execution-key');
  credentials.set('review', 'review-key');
  const calls = [];
  const fetchImpl = async (url, init) => {
    const payload = JSON.parse(JSON.parse(init.body).messages[1].content);
    calls.push({ node: payload.node, key: init.headers.Authorization.replace(/^Bearer /, '') });
    let data;
    if (payload.node === 'rank_official_candidates') data = { suggestions: [{ officialId: 'J1', reason: '虚构匹配', gaps: [] }] };
    else if (payload.node === 'map_visible_controls') data = { mappings: [{ controlId: payload.controls[0].controlId, factId: payload.confirmedFacts[0].id, entityId: payload.confirmedFacts[0].entityId }] };
    else if (payload.node === 'review_page_readback') data = { findings: [] };
    else throw new Error(`unexpected node ${payload.node}`);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(data) } }] }), { status: 200 });
  };
  const content1 = projectFact('f_c1', 'project_content', '项目内容', '内容一');
  const content2 = projectFact('f_c2', 'project_content', '项目描述', '内容二');
  const env = makeEnvironment({
    credentialStore: credentials, useRealRouter: true, fetchImpl,
    factList: () => [content1, content2],
    observeSnapshot: projectSnapshot([{ ref: 'mc_content', label: '项目内容' }]),
  });
  await openWindow(env);
  await env.workflow.startResearch({ companyId: 'c1', sendAuthorized: true });
  await waitFor(env.workflow);
  env.state.company = companyView({ status: 'preparing', activePositionId: 'p1', selectedPositionIds: ['p1'] });
  env.state.positions = [positionView()];
  await env.workflow.startPrepare({ companyId: 'c1', jobId: 'p1', sendAuthorized: true });
  const prepared = await waitFor(env.workflow);
  env.workflow.confirmPlan(prepared.plan.planId, true);
  await env.workflow.startRun({ companyId: 'c1', jobId: 'p1', positionId: 'p1', planId: prepared.plan.planId, sendAuthorized: true });
  await waitFor(env.workflow);
  assert.deepEqual(calls.map((call) => call.key), ['search-key', 'execution-key', 'review-key']);
  assert.deepEqual(calls.map((call) => call.node), ['rank_official_candidates', 'map_visible_controls', 'review_page_readback']);

  const noKey = makeEnvironment({ useRealRouter: true, fetchImpl });
  await openWindow(noKey);
  await noKey.workflow.startResearch({ companyId: 'c1', sendAuthorized: true });
  await waitFor(noKey.workflow, 'failed');
  assert.equal(calls.length, 3, '缺 Key 时不得发送任何外部请求，也不得复用其他角色 Key');

  const searchOnly = makeEnvironment({
    credentialStore: createMemoryCredentialStore(), useRealRouter: true, fetchImpl,
    factList: () => [content1, content2],
    observeSnapshot: projectSnapshot([{ ref: 'mc_content', label: '项目内容' }]),
  });
  searchOnly.credentialStore.set('search', 'search-key');
  await openWindow(searchOnly);
  await searchOnly.workflow.startResearch({ companyId: 'c1', sendAuthorized: true });
  await waitFor(searchOnly.workflow);
  assert.equal(calls.length, 4);
  searchOnly.state.company = companyView({ status: 'preparing', activePositionId: 'p1', selectedPositionIds: ['p1'] });
  searchOnly.state.positions = [positionView()];
  await searchOnly.workflow.startPrepare({ companyId: 'c1', jobId: 'p1', sendAuthorized: true });
  await waitFor(searchOnly.workflow, 'failed');
  assert.equal(calls.length, 4, '缺 execution Key 时不得回退使用 search Key');

  const unauthorized = makeEnvironment({ credentialStore: credentials, useRealRouter: true, fetchImpl });
  await openWindow(unauthorized);
  await unauthorized.workflow.startResearch({ companyId: 'c1', sendAuthorized: false });
  await waitFor(unauthorized.workflow, 'failed');
  assert.equal(calls.length, 4);
});

test('暂停立即停止后续写入、读回与复核，旧计划不可重放', async () => {
  let startedResolve;
  const started = new Promise((resolve) => { startedResolve = resolve; });
  let releaseWrite;
  const writeGate = new Promise((resolve) => { releaseWrite = resolve; });
  let fillCalls = 0;
  let seenSignal = null;
  const env = makeEnvironment({
    status: 'preparing', position: positionView(),
    fillImpl: async (plan, options = {}) => {
      fillCalls += 1;
      seenSignal = options.signal;
      startedResolve();
      await writeGate;
      return { ok: true, results: plan.items.map((item) => ({ controlRef: item.controlRef, status: 'filled' })), issues: [] };
    },
  });
  await openWindow(env);
  await env.workflow.startPrepare({ companyId: 'c1', jobId: 'p1', sendAuthorized: true });
  const prepared = await waitFor(env.workflow);
  env.workflow.confirmPlan(prepared.plan.planId, true);
  await env.workflow.startRun({ companyId: 'c1', jobId: 'p1', positionId: 'p1', planId: prepared.plan.planId, sendAuthorized: true });
  await started;
  const paused = await env.workflow.cancel('测试暂停');
  assert.equal(paused.cancelled, true);
  assert.equal(seenSignal.aborted, true);
  releaseWrite();
  await waitFor(env.workflow, 'cancelled');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(fillCalls, 1);
  assert.equal(env.calls.readback, 0, '取消后不得继续批量读回');
  assert.equal(env.calls.review, 0, '取消后不得继续模型复核');
  await env.workflow.startRun({ companyId: 'c1', jobId: 'p1', positionId: 'p1', planId: prepared.plan.planId, sendAuthorized: true });
  await waitFor(env.workflow, 'failed');
  assert.equal(fillCalls, 1, '取消后旧计划不得重放');
});

test('another company cannot use a cached plan and an empty model response fails closed', async () => {
  const env = makeEnvironment({ status: 'preparing', position: positionView() });
  await openWindow(env);
  await env.workflow.startPrepare({ companyId: 'c1', jobId: 'p1', sendAuthorized: true });
  const prepared = await waitFor(env.workflow);
  env.workflow.confirmPlan(prepared.plan.planId, true);
  env.state.summary = { ...env.state.summary, queue: { status: 'running', currentCompanyId: 'c2' } };
  await env.workflow.startRun({ companyId: 'c1', jobId: 'p1', positionId: 'p1', planId: prepared.plan.planId, sendAuthorized: true });
  await waitFor(env.workflow, 'failed');
  assert.equal(env.calls.fill, 0);

  const empty = makeEnvironment({
    router: {
      rankCandidates: async () => { throw new ModelRouterError('MODEL_EMPTY_RESPONSE', '模型返回为空'); },
      mapFields: async () => ({ mappings: [] }),
      reviewReadback: async () => ({ passed: false }),
    },
  });
  await openWindow(empty);
  await empty.workflow.startResearch({ companyId: 'c1', sendAuthorized: true });
  await waitFor(empty.workflow, 'failed');
  assert.equal(empty.calls.records.length, 0);
});
