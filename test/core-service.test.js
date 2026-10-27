import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PRIVATE_ROOT } from '../core/store.js';
import { createWorkbenchService } from '../core/service.js';
import { findApplicationDuplicate } from '../core/records.js';

const now = '2026-10-26T00:00:00.000Z';
const operator = { actor: 'operator' };
const agent = { actor: 'agent' };

test('没有明确 private 目录时不创建工作区', () => {
  assert.throws(() => createWorkbenchService(), error => error.code === 'PRIVATE_DIR_REQUIRED');
});

function makeService() {
  let count = 0;
  const dir = path.join(PRIVATE_ROOT, `test-core-service-${randomUUID()}`);
  return {
    dir,
    service: createWorkbenchService({
      directory: dir,
      now: () => now,
      newId: () => `id-${++count}`,
    }),
  };
}

async function prepareSelected(service, company, positions = 1) {
  await service.startQueue({ eventId: `start-${company.name}`, confirmedBy: 'user' }, operator);
  await service.recordHumanLogin({ companyId: company.id, eventId: `login-${company.name}`, confirmedBy: 'user' }, operator);
  const candidates = await service.recordPositionCandidates({
    companyId: company.id,
    eventId: `cand-${company.name}`,
    positions: Array.from({ length: positions }, (_, index) => ({
      officialId: `${company.name}-J${index + 1}`,
      title: `岗位${index + 1}`,
      sourceUrl: `https://jobs.example.invalid/${encodeURIComponent(company.name)}/${index + 1}`,
      checkedAt: now,
      matchEvidence: '虚构测试：官方 JD 与示例条件匹配。',
    })),
  }, agent);
  const selection = await service.selectPositions({
    companyId: company.id,
    positionIds: candidates.positions.map(position => position.id),
  }, operator);
  return { company: selection.company, positions: selection.positions };
}

test('部分完成不跳公司，全部结束后只自动推进一次，提交与核验分离且禁止重投', async t => {
  const { dir, service } = makeService();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const a = await service.addCompany({
    name: '示例甲公司',
    links: [{ url: 'https://a.example.invalid/jobs', kind: 'apply', source: '虚构粘贴' }],
    referralCandidates: [{ value: 'CODE-A', source: '虚构粘贴' }],
  }, operator);
  const b = await service.addCompany({
    name: '示例乙公司',
    links: [{ url: 'https://b.example.invalid/jobs', kind: 'apply', source: '虚构粘贴' }],
  }, operator);

  await assert.rejects(
    service.startQueue({ eventId: 'start-1', confirmedBy: 'user' }, agent),
    error => error.code === 'FORBIDDEN',
  );

  const started = await service.startQueue({ eventId: 'start-1', confirmedBy: 'user' }, operator);
  assert.equal(started.duplicate, false);
  assert.equal(started.queue.currentCompanyId, a.company.id);
  assert.equal((await service.getCompany({ companyId: a.company.id }, agent)).company.status, 'awaiting_login');

  await service.recordHumanLogin({ companyId: a.company.id, eventId: 'login-1', confirmedBy: 'user' }, operator);
  const candidates = await service.recordPositionCandidates({
    companyId: a.company.id,
    eventId: 'cand-1',
    positions: [
      {
        officialId: 'A-J1', title: '岗位甲', sourceUrl: 'https://a.example.invalid/jobs/1', checkedAt: now,
        matchEvidence: '虚构官方 JD：示例匹配依据 A。',
      },
      {
        officialId: 'A-J2', title: '岗位乙', sourceUrl: 'https://a.example.invalid/jobs/2', checkedAt: now,
        matchEvidence: '虚构官方 JD：示例匹配依据 B。',
      },
    ],
  }, agent);
  assert.equal(candidates.company.status, 'awaiting_selection');

  const selected = await service.selectPositions({
    companyId: a.company.id,
    positionIds: candidates.positions.map(position => position.id),
  }, operator);
  assert.equal(selected.company.status, 'preparing');
  assert.equal(selected.company.activePositionId, candidates.positions[0].id);

  const issue = await service.addIssue({
    companyId: a.company.id,
    positionId: candidates.positions[0].id,
    fieldKey: 'gpa',
    type: 'unknown',
    severity: 'warn',
    blocking: true,
    message: '示例字段含义不明确，需要本人确认。',
    evidence: '虚构页面字段 label=gpa',
  }, agent);
  assert.equal(issue.merged, false);
  assert.equal((await service.getCompany({ companyId: a.company.id }, agent)).company.status, 'awaiting_issue_answers');
  await assert.rejects(
    service.markPositionReadyForSubmit({ companyId: a.company.id, positionId: candidates.positions[0].id, confirmedBy: 'user' }, operator),
    error => error.code === 'BLOCKING_ISSUES',
  );

  const duplicateIssue = await service.addIssue({
    companyId: a.company.id,
    positionId: candidates.positions[0].id,
    fieldKey: 'gpa',
    type: 'unknown',
    severity: 'warn',
    blocking: true,
    message: '同一字段再次出现。',
  }, agent);
  assert.equal(duplicateIssue.merged, true);
  assert.equal(duplicateIssue.issue.occurrences, 2);
  const grouped = (await service.summary()).issueGroups.find(group => group.companyId === a.company.id);
  assert.equal(grouped.open, 1);
  assert.equal(grouped.blockingOpen, 1);

  await service.answerIssue({ issueId: issue.issue.id, answer: '本人确认为示例 GPA。' }, operator);
  assert.equal((await service.getCompany({ companyId: a.company.id }, agent)).company.status, 'awaiting_issue_answers');
  await service.resolveIssue({ issueId: issue.issue.id }, operator);
  assert.equal((await service.getCompany({ companyId: a.company.id }, agent)).company.status, 'preparing');

  await service.markPositionReadyForSubmit({ companyId: a.company.id, positionId: candidates.positions[0].id, confirmedBy: 'user' }, operator);
  const waiting = await service.getCompany({ companyId: a.company.id }, agent);
  assert.equal(waiting.company.status, 'awaiting_human_submit');
  assert.equal(waiting.company.activePositionId, candidates.positions[0].id);
  assert.match(waiting.result, /待本人提交：岗位甲/);
  assert.match(waiting.result, /待处理：岗位乙/);
  assert.equal((await service.listCompanies(agent)).find(company => company.id === a.company.id).status, 'awaiting_human_submit');

  await assert.rejects(
    service.recordHumanSubmission({
      companyId: a.company.id,
      positionId: candidates.positions[0].id,
      eventId: 'sub-agent',
      reportedAt: now,
      confirmedBy: 'user',
    }, agent),
    error => error.code === 'FORBIDDEN',
  );

  const firstSubmission = await service.recordHumanSubmission({
    companyId: a.company.id,
    positionId: candidates.positions[0].id,
    eventId: 'sub-a-1',
    reportedAt: now,
    reference: '虚构申请号-1',
    confirmedBy: 'user',
  }, operator);
  assert.equal(firstSubmission.position.status, 'submitted_reported');
  assert.equal(firstSubmission.company.status, 'preparing');
  assert.equal((await service.summary()).queue.currentCompanyId, a.company.id);
  assert.equal((await service.listCompanies(agent)).find(company => company.id === b.company.id).status, 'queued');

  const revisionBeforeDuplicate = await service.runtimeRevision();
  const duplicateSubmission = await service.recordHumanSubmission({
    companyId: a.company.id,
    positionId: candidates.positions[0].id,
    eventId: 'sub-a-1',
    reportedAt: now,
    reference: '虚构申请号-1',
    confirmedBy: 'user',
  }, operator);
  assert.equal(duplicateSubmission.duplicate, true);
  assert.equal(await service.runtimeRevision(), revisionBeforeDuplicate);
  await assert.rejects(
    service.recordHumanSubmission({
      companyId: a.company.id,
      positionId: candidates.positions[0].id,
      eventId: 'sub-a-1',
      reportedAt: now,
      reference: '不同的申请号',
      confirmedBy: 'user',
    }, operator),
    error => error.code === 'EVENT_ID_PAYLOAD_MISMATCH',
  );
  await assert.rejects(
    service.recordHumanLogin({ companyId: b.company.id, eventId: 'sub-a-1', confirmedBy: 'user' }, operator),
    error => error.code === 'EVENT_ID_REUSED',
  );
  const storedWrapper = JSON.parse(await fs.readFile(path.join(dir, 'runtime.json'), 'utf8'));
  const storedEvent = storedWrapper.data.events.find(event => event.id === 'sub-a-1');
  assert.deepEqual(Object.keys(storedEvent).sort(), ['at', 'companyId', 'digest', 'id', 'type']);
  assert.match(storedEvent.digest, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(storedEvent, 'reference'), false);

  await assert.rejects(
    service.recordHumanSubmission({
      companyId: a.company.id,
      positionId: candidates.positions[0].id,
      eventId: 'sub-a-1b',
      reportedAt: now,
      confirmedBy: 'user',
    }, operator),
    error => error.code === 'ALREADY_SUBMITTED',
  );
  await assert.rejects(
    service.addIssue({
      companyId: a.company.id,
      positionId: candidates.positions[0].id,
      fieldKey: 'history-field',
      type: 'unknown',
      message: '模型不能给非活动历史岗位写问题。',
    }, agent),
    error => error.code === 'NOT_ACTIVE_POSITION',
  );
  await assert.rejects(
    service.addIssue({
      companyId: b.company.id,
      fieldKey: 'other-company',
      type: 'unknown',
      message: '模型不能给非当前公司写问题。',
    }, agent),
    error => error.code === 'NOT_ACTIVE_COMPANY',
  );

  await service.markPositionReadyForSubmit({ companyId: a.company.id, positionId: candidates.positions[1].id, confirmedBy: 'user' }, operator);
  const secondSubmission = await service.recordHumanSubmission({
    companyId: a.company.id,
    positionId: candidates.positions[1].id,
    eventId: 'sub-a-2',
    reportedAt: now,
    confirmedBy: 'user',
  }, operator);
  assert.equal(secondSubmission.company.status, 'completed');
  assert.equal(secondSubmission.queue.currentCompanyId, b.company.id);
  assert.equal((await service.getCompany({ companyId: b.company.id }, agent)).company.status, 'awaiting_login');

  const revisionAfterAdvance = await service.runtimeRevision();
  const duplicateFinal = await service.recordHumanSubmission({
    companyId: a.company.id,
    positionId: candidates.positions[1].id,
    eventId: 'sub-a-2',
    reportedAt: now,
    confirmedBy: 'user',
  }, operator);
  assert.equal(duplicateFinal.duplicate, true);
  assert.equal(await service.runtimeRevision(), revisionAfterAdvance);
  assert.equal((await service.summary()).queue.currentCompanyId, b.company.id);

  const verified = await service.recordOfficialVerification({
    companyId: a.company.id,
    positionId: candidates.positions[1].id,
    eventId: 'verify-a-2',
    verifiedAt: now,
    sourceUrl: 'https://a.example.invalid/applications',
    evidenceText: '虚构官网申请记录显示已提交岗位乙。',
    confirmedBy: 'user',
  }, operator);
  assert.equal(verified.position.status, 'verified');
  assert.match((await service.getCompany({ companyId: a.company.id }, agent)).result, /官网已核验/);
  assert.equal((await service.summary()).queue.currentCompanyId, b.company.id);
  await assert.rejects(
    service.recordHumanSubmission({
      companyId: a.company.id,
      positionId: candidates.positions[1].id,
      eventId: 'sub-a-2-again',
      reportedAt: now,
      confirmedBy: 'user',
    }, operator),
    error => error.code === 'ALREADY_SUBMITTED',
  );
  await assert.rejects(
    service.skipPosition({
      companyId: a.company.id,
      positionId: candidates.positions[0].id,
      reason: '普通范围不能改历史公司。',
    }, operator),
    error => error.code === 'NOT_ACTIVE_COMPANY',
  );

  await service.recordHumanLogin({ companyId: b.company.id, eventId: 'login-2', confirmedBy: 'user' }, operator);
  await assert.rejects(
    service.recordNoPositions({ companyId: b.company.id, eventId: 'no-b-bad' }, agent),
    error => error.code === 'INVALID_INPUT',
  );
  const noPositions = await service.recordNoPositions({
    companyId: b.company.id,
    eventId: 'no-b',
    evidence: {
      reason: '本批次没有符合当前条件的官方岗位。',
      sourceUrl: 'https://b.example.invalid/jobs',
      checkedAt: now,
      checkedBy: 'agent',
      resultText: '虚构检索结果：0 个符合条件岗位。',
    },
  }, agent);
  assert.equal(noPositions.company.status, 'no_positions');
  assert.equal(noPositions.queue.status, 'drained');
  const recovered = await service.recover();
  assert.equal(recovered.currentCompany, null);
  assert.deepEqual(recovered.safeActions, []);
  assert.doesNotMatch(recovered.note, /重放提交/);
});

test('暂停阻止自动下家；重启恢复不重放，重复事件幂等', async t => {
  const { dir, service } = makeService();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const currentCompany = await service.addCompany({
    name: '示例丙公司',
    links: [{ url: 'https://c.example.invalid/jobs', kind: 'apply', source: '虚构' }],
  }, operator);
  const nextCompany = await service.addCompany({
    name: '示例丁公司',
    links: [{ url: 'https://d.example.invalid/jobs', kind: 'apply', source: '虚构' }],
  }, operator);
  const { company, positions } = await prepareSelected(service, currentCompany.company);
  assert.equal(company.name, '示例丙公司');

  await service.markPositionReadyForSubmit({ companyId: company.id, positionId: positions[0].id, confirmedBy: 'user' }, operator);
  await service.pauseQueue(operator);
  const pauseRevision = await service.runtimeRevision();
  const pausedAgain = await service.pauseQueue(operator);
  assert.equal(pausedAgain.idempotent, true);
  assert.equal(await service.runtimeRevision(), pauseRevision);

  await assert.rejects(
    service.recordPositionCandidates({
      companyId: company.id,
      eventId: 'paused-candidates',
      positions: [{
        officialId: 'PAUSED-1',
        title: '暂停候选',
        sourceUrl: 'https://c.example.invalid/paused',
        checkedAt: now,
        matchEvidence: '虚构暂停测试',
      }],
    }, agent),
    error => error.code === 'QUEUE_NOT_RUNNING',
  );
  await assert.rejects(
    service.recordNoPositions({
      companyId: company.id,
      eventId: 'paused-no-positions',
      evidence: {
        reason: '虚构暂停测试。',
        sourceUrl: 'https://c.example.invalid/jobs',
        checkedAt: now,
        checkedBy: 'agent',
        resultText: '虚构结果。',
      },
    }, agent),
    error => error.code === 'QUEUE_NOT_RUNNING',
  );
  await assert.rejects(
    service.addIssue({
      companyId: company.id,
      fieldKey: 'paused-field',
      type: 'unknown',
      message: '暂停时模型不应写问题。',
    }, agent),
    error => error.code === 'QUEUE_NOT_RUNNING',
  );

  const submitted = await service.recordHumanSubmission({
    companyId: company.id,
    positionId: positions[0].id,
    eventId: 'sub-c-1',
    reportedAt: now,
    confirmedBy: 'user',
  }, operator);
  assert.equal(submitted.company.status, 'completed');
  assert.equal(submitted.queue.status, 'paused');
  assert.equal(submitted.queue.currentCompanyId, company.id);
  assert.equal((await service.listCompanies(agent)).find(item => item.id === nextCompany.company.id).status, 'queued');

  const verifiedWhilePaused = await service.recordOfficialVerification({
    companyId: company.id,
    positionId: positions[0].id,
    eventId: 'verify-c-1',
    verifiedAt: now,
    sourceUrl: 'https://c.example.invalid/applications',
    evidenceText: '虚构官网核验：暂停期间只读记录。',
    confirmedBy: 'user',
  }, operator);
  assert.equal(verifiedWhilePaused.position.status, 'verified');
  assert.equal(verifiedWhilePaused.queue.status, 'paused');
  assert.equal(verifiedWhilePaused.queue.currentCompanyId, company.id);

  const resumed = await service.resumeQueue(operator);
  assert.equal(resumed.queue.status, 'running');
  assert.equal(resumed.queue.currentCompanyId, nextCompany.company.id);
  const resumeRevision = await service.runtimeRevision();
  const resumedAgain = await service.resumeQueue(operator);
  assert.equal(resumedAgain.idempotent, true);
  assert.equal(await service.runtimeRevision(), resumeRevision);

  const revision = await service.runtimeRevision();
  const reopened = createWorkbenchService({ directory: dir, now: () => now, newId: () => 'other-id' });
  const recovery = await reopened.recover();
  assert.equal(recovery.queue.currentCompanyId, nextCompany.company.id);
  assert.deepEqual(recovery.safeActions, ['human_login']);
  assert.equal(await reopened.runtimeRevision(), revision);
  assert.doesNotMatch(recovery.safeActions.join(','), /submit/i);

  const duplicate = await reopened.recordHumanSubmission({
    companyId: company.id,
    positionId: positions[0].id,
    eventId: 'sub-c-1',
    reportedAt: now,
    confirmedBy: 'user',
  }, operator);
  assert.equal(duplicate.duplicate, true);
  assert.equal(await reopened.runtimeRevision(), revision);
  assert.equal((await reopened.summary()).queue.currentCompanyId, nextCompany.company.id);
});

test('历史本人投递使用公司级终态，不伪造岗位 ID 且禁止再次启动', async t => {
  const { dir, service } = makeService();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const historical = await service.addCompany({
    name: '虚构历史公司',
    links: [{ url: 'https://history.example.invalid/jobs', kind: 'apply', source: '虚构历史记录' }],
  }, operator);
  const next = await service.addCompany({
    name: '虚构后续公司',
    links: [{ url: 'https://next.example.invalid/jobs', kind: 'apply', source: '虚构' }],
  }, operator);

  const reported = await service.recordHistoricalSubmission({
    companyId: historical.company.id,
    eventId: 'historical-submission-1',
    reportedAt: now,
    reference: '本人确认历史上已完成投递；岗位官方 ID 待补，禁止重投。',
    confirmedBy: 'user',
  }, operator);
  assert.equal(reported.company.status, 'submitted_reported');
  assert.equal(reported.company.historicalSubmission.source, 'user_history');
  assert.deepEqual(reported.company.selectedPositionIds, []);
  assert.match((await service.getCompany({ companyId: historical.company.id }, operator)).result, /历史本人记录/);

  await assert.rejects(
    service.recordHistoricalSubmission({
      companyId: historical.company.id,
      eventId: 'historical-submission-2',
      reportedAt: now,
      reference: '重复记录',
      confirmedBy: 'user',
    }, operator),
    error => error.code === 'ALREADY_SUBMITTED',
  );
  await assert.rejects(
    service.recordHistoricalSubmission({
      companyId: next.company.id,
      eventId: 'historical-agent',
      reportedAt: now,
      reference: '模型不应记录本人历史投递',
      confirmedBy: 'user',
    }, agent),
    error => error.code === 'FORBIDDEN',
  );

  const started = await service.startQueue({ eventId: 'historical-start', confirmedBy: 'user' }, operator);
  assert.equal(started.currentCompanyId, next.company.id);
  assert.equal((await service.getCompany({ companyId: historical.company.id }, operator)).company.status, 'submitted_reported');
});

test('重复公司条目合并来源而不创建可重投分身；新批次可入', async t => {
  const { dir, service } = makeService();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const first = await service.addCompany({
    name: '  示例重名公司  ',
    batch: '2026春',
    links: [{ url: 'https://dup.example.invalid/jobs?utm_source=a', kind: 'apply', source: '来源A' }],
    referralCandidates: [{ value: 'CODE-1', source: '来源A' }],
  }, operator);
  assert.equal(first.duplicate, false);
  const duplicate = await service.addCompany({
    name: '示例重名公司',
    batch: '2026春',
    links: [{ url: 'https://dup.example.invalid/jobs?utm_source=b&job=1', kind: 'apply', source: '来源B' }],
    referralCandidates: [{ value: 'CODE-2', source: '来源B' }],
  }, operator);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.company.id, first.company.id);
  assert.equal(duplicate.company.name, '  示例重名公司  ');
  assert.equal(duplicate.company.links.length, 2);
  assert.deepEqual(duplicate.company.referralCandidates.map(item => item.value).sort(), ['CODE-1', 'CODE-2']);
  assert.equal(duplicate.company.referralSelected, null);
  assert.equal(duplicate.canonicalLinks.length, 2);
  assert.equal((await service.listCompanies(agent)).length, 1);

  const newBatch = await service.addCompany({
    name: '示例重名公司',
    batch: '2026秋',
    links: [{ url: 'https://dup.example.invalid/jobs?utm_source=a', kind: 'apply', source: '来源A' }],
  }, operator);
  assert.equal(newBatch.duplicate, false);
  assert.notEqual(newBatch.company.id, first.company.id);
  assert.equal((await service.listCompanies(agent)).length, 2);

  const companies = [
    { id: 'company-a', name: '示例公司', batch: '2026春', identityKey: 'identity' },
    { id: 'company-b', name: '示例公司', batch: '2026春', identityKey: 'identity' },
  ];
  const positions = [{ id: 'position-old', companyId: 'company-a', officialId: 'JOB 1', title: '旧岗位' }];
  assert.equal(findApplicationDuplicate(companies[1], ' job 1 ', companies, positions).id, 'position-old');
  assert.equal(findApplicationDuplicate(companies[1], 'JOB 2', companies, positions), null);
});

test('重启后准备阶段必须由本人确认观察，模型不能直接继续写', async t => {
  const { dir, service } = makeService();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const added = await service.addCompany({
    name: '示例恢复公司',
    links: [{ url: 'https://g.example.invalid/jobs', kind: 'apply', source: '虚构' }],
  }, operator);
  const { company, positions } = await prepareSelected(service, added.company);
  await service.markPositionReadyForSubmit({
    companyId: company.id,
    positionId: positions[0].id,
    confirmedBy: 'user',
  }, operator);

  const reopened = createWorkbenchService({ directory: dir, now: () => now, newId: () => 'recovery-id' });
  const recovery = await reopened.recover();
  assert.equal(recovery.recoveryPending, true);
  assert.ok(recovery.safeActions.includes('acknowledge_recovery_by_user'));
  assert.ok(!recovery.safeActions.some(action => ['record_human_submission', 'auto_submit'].includes(action)));
  await assert.rejects(
    reopened.addIssue({
      companyId: company.id,
      positionId: positions[0].id,
      fieldKey: 'recovery-field',
      type: 'unknown',
      message: '模型不能忽略恢复观察。',
    }, agent),
    error => error.code === 'RECOVERY_OBSERVATION_REQUIRED',
  );
  const ack = await reopened.acknowledgeRecovery({ confirmedBy: 'user', observedAt: now }, operator);
  assert.equal(ack.recoveryPending, false);
  const issue = await reopened.addIssue({
    companyId: company.id,
    positionId: positions[0].id,
    fieldKey: 'recovery-field',
    type: 'unknown',
    blocking: true,
    message: '本人确认现场后允许记录。',
  }, agent);
  assert.equal(issue.company.status, 'awaiting_issue_answers');

  const third = createWorkbenchService({ directory: dir, now: () => now, newId: () => 'recovery-id-2' });
  assert.equal((await third.recover()).recoveryPending, true);
});

test('明确暂挂可继续下家，但不标完成且不能同时恢复两家', async t => {
  const { dir, service } = makeService();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const held = await service.addCompany({
    name: '示例戊公司',
    links: [{ url: 'https://e.example.invalid/jobs', kind: 'apply', source: '虚构' }],
  }, operator);
  const next = await service.addCompany({
    name: '示例己公司',
    links: [{ url: 'https://f.example.invalid/jobs', kind: 'apply', source: '虚构' }],
  }, operator);
  await service.startQueue({ eventId: 'start-e', confirmedBy: 'user' }, operator);
  const holding = await service.holdCompany({ companyId: held.company.id, reason: '本人暂挂，先处理下一家。' }, operator);
  assert.equal(holding.company.status, 'held');
  assert.equal(holding.queue.currentCompanyId, next.company.id);
  assert.equal((await service.getCompany({ companyId: held.company.id }, agent)).company.status, 'held');
  assert.equal((await service.getCompany({ companyId: next.company.id }, agent)).company.status, 'awaiting_login');
  await assert.rejects(
    service.resumeHeldCompany({ companyId: held.company.id }, operator),
    error => error.code === 'QUEUE_BUSY',
  );
});
