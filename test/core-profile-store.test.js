import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PRIVATE_ROOT } from '../core/store.js';
import {
  PROFILE_SCHEMA_VERSION,
  createProfileStore,
  validateProfileDocument,
} from '../core/profile-store.js';

const operator = { actor: 'operator' };
const agent = { actor: 'agent' };

function makeIds() {
  let count = 0;
  return () => `fact-${++count}`;
}

test('确认版本、编辑撤销、来源与作用域保护', async t => {
  const dir = path.join(PRIVATE_ROOT, `test-core-profile-${randomUUID()}`);
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const profileFile = path.join(dir, 'profile.json');
  await assert.rejects(fs.access(profileFile));
  const store = createProfileStore({ directory: dir, now: () => '2026-10-26T00:00:00.000Z', newId: makeIds() });

  await assert.rejects(
    store.createFact({ label: '姓名', value: '测试同学', section: 'basic' }, operator),
    error => error.code === 'SOURCE_REQUIRED',
  );

  const fact = await store.createFact({
    label: '姓名',
    value: '测试同学',
    section: 'basic',
    source: { type: 'user', ref: '本人填写' },
  }, operator);
  assert.equal(fact.confirmed, false);
  assert.deepEqual(await store.queryFacts({}, agent), []);
  await assert.rejects(
    store.getFactForFill(fact.id, {}, agent),
    error => error.code === 'NOT_CONFIRMED',
  );

  const confirmed = await store.confirmFact(fact.id, { expectedVersion: 1 }, operator);
  assert.equal(confirmed.confirmed, true);
  assert.equal(confirmed.confirmedVersion, 1);
  assert.equal((await store.queryFacts({}, agent))[0].value, '测试同学');
  assert.equal((await store.getFactForFill(fact.id, {}, agent)).value, '测试同学');

  const revised = await store.reviseFact(fact.id, { value: '测试同学2' }, { expectedVersion: 1 }, operator);
  assert.equal(revised.version, 2);
  assert.equal(revised.confirmed, false);
  assert.equal(revised.history[0].value, '测试同学');
  await assert.rejects(
    store.confirmFact(fact.id, { expectedVersion: 1 }, operator),
    error => error.code === 'PROFILE_VERSION_CONFLICT',
  );
  await assert.rejects(
    store.getFactForFill(fact.id, {}, agent),
    error => error.code === 'NOT_CONFIRMED',
  );

  const scoped = await store.createFact({
    label: '意向城市',
    value: '示例城',
    section: 'company_answer',
    source: { type: 'company_answer', ref: '示例公司表单' },
    scope: { type: 'company', companyId: 'company-a', positionId: null },
  }, operator);
  await store.confirmFact(scoped.id, { expectedVersion: 1 }, operator);
  assert.equal((await store.getFactForFill(scoped.id, { companyId: 'company-a' }, agent)).value, '示例城');
  await assert.rejects(
    store.getFactForFill(scoped.id, { companyId: 'company-b' }, agent),
    error => error.code === 'SCOPE_MISMATCH',
  );

  const reopened = createProfileStore({ directory: dir, now: () => '2026-10-26T00:01:00.000Z' });
  const all = await reopened.queryFacts({ includeUnconfirmed: true }, operator);
  assert.equal(all[0].value, '测试同学2');
  assert.equal(await reopened.revision(), 5);
});

test('家庭字段默认不返回，必须由本人授权明确用途与公司', async t => {
  const dir = path.join(PRIVATE_ROOT, `test-core-profile-sensitive-${randomUUID()}`);
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = createProfileStore({ directory: dir, now: () => '2026-10-26T00:00:00.000Z', newId: makeIds() });

  const family = await store.createFact({
    label: '父亲姓名',
    value: '测试家长',
    section: 'family',
    source: { type: 'user', ref: '本人填写' },
    scope: { type: 'company', companyId: 'company-a', positionId: null },
    sensitivity: 'family',
    allowedPurposes: ['family_form'],
  }, operator);
  await store.confirmFact(family.id, { expectedVersion: 1 }, operator);

  assert.deepEqual(await store.queryFacts({ companyId: 'company-a' }, agent), []);
  await assert.rejects(
    store.getFactForFill(family.id, { companyId: 'company-a' }, agent),
    error => error.code === 'SENSITIVE_AUTH_REQUIRED',
  );
  await assert.rejects(
    store.getFact(family.id, { companyId: 'company-a' }, agent),
    error => error.code === 'SENSITIVE_AUTH_REQUIRED',
  );
  await assert.rejects(
    store.grantSensitiveUse({
      factIds: [family.id],
      purpose: 'family_form',
      scope: { type: 'company', companyId: 'company-a' },
      confirmedBy: 'user',
    }, agent),
    error => error.code === 'FORBIDDEN',
  );

  const grant = await store.grantSensitiveUse({
    factIds: [family.id],
    purpose: 'family_form',
    scope: { type: 'company', companyId: 'company-a' },
    confirmedBy: 'user',
  }, operator);
  assert.equal(grant.grantedBy, 'user');

  const value = await store.getFactForFill(family.id, {
    companyId: 'company-a',
    purpose: 'family_form',
  }, agent);
  assert.equal(value.value, '测试家长');
  assert.equal((await store.queryFacts({ companyId: 'company-a', purpose: 'family_form' }, agent))[0].value, '测试家长');
  await assert.rejects(
    store.getFactForFill(family.id, { companyId: 'company-a', purpose: 'job_matching' }, agent),
    error => error.code === 'SENSITIVE_AUTH_REQUIRED',
  );
  await assert.rejects(
    store.getFactForFill(family.id, { companyId: 'company-b', purpose: 'family_form' }, agent),
    error => error.code === 'SCOPE_MISMATCH',
  );
  assert.equal((await store.getFactForLocalEdit(family.id, operator)).value, '测试家长');
  assert.equal((await store.listFactsForLocalEdit(operator)).length, 1);
  await assert.rejects(
    store.listFactsForLocalEdit(agent),
    error => error.code === 'FORBIDDEN',
  );

  const revised = await store.reviseFact(family.id, { value: '测试家长2' }, { expectedVersion: 1 }, operator);
  assert.equal(revised.version, 2);
  await store.confirmFact(family.id, { expectedVersion: 2 }, operator);
  await assert.rejects(
    store.getFactForFill(family.id, { companyId: 'company-a', purpose: 'family_form' }, agent),
    error => error.code === 'SENSITIVE_AUTH_REQUIRED',
  );
  const regranted = await store.grantSensitiveUse({
    factIds: [family.id],
    purpose: 'family_form',
    scope: { type: 'company', companyId: 'company-a' },
    confirmedBy: 'user',
  }, operator);
  assert.notEqual(regranted.id, grant.id);
  assert.equal((await store.getFactForFill(family.id, {
    companyId: 'company-a',
    purpose: 'family_form',
  }, agent)).value, '测试家长2');
});

test('资料写操作串行化：并发创建成功，同字段旧版本确认可靠冲突', async t => {
  const dir = path.join(PRIVATE_ROOT, `test-core-profile-serial-${randomUUID()}`);
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = createProfileStore({ directory: dir, now: () => '2026-10-26T00:00:00.000Z', newId: makeIds() });

  const created = await Promise.all(Array.from({ length: 12 }, (_, index) => store.createFact({
    entityId: `entity-${index}`,
    label: `并发字段${index}`,
    value: `值${index}`,
    section: 'other',
    source: { type: 'user', ref: '并发测试' },
  }, operator)));
  assert.equal(new Set(created.map(fact => fact.id)).size, 12);
  assert.equal((await store.queryFacts({ includeUnconfirmed: true }, operator)).length, 12);
  assert.equal(await store.revision(), 12);

  const target = created[0];
  const results = await Promise.allSettled([
    store.reviseFact(target.id, { value: '并发修改' }, { expectedVersion: 1 }, operator),
    store.confirmFact(target.id, { expectedVersion: 1 }, operator),
  ]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.code, 'PROFILE_VERSION_CONFLICT');
  const finalFact = await store.getFactForLocalEdit(target.id, operator);
  assert.equal(finalFact.version, 2);
  assert.equal(finalFact.confirmed, false);
  assert.equal((await store.listFactsForLocalEdit(operator)).length, 12);
});

test('entityId 支持按经历精确查询，旧数据缺少 entityId 仍可校验', async t => {
  const dir = path.join(PRIVATE_ROOT, `test-core-profile-entity-${randomUUID()}`);
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = createProfileStore({ directory: dir, now: () => '2026-10-26T00:00:00.000Z', newId: makeIds() });

  const a = await store.createFact({
    section: 'project_responsibilities',
    entityId: 'project-a',
    label: '项目职责',
    value: '职责 A',
    source: { type: 'user', ref: '项目 A' },
  }, operator);
  const b = await store.createFact({
    section: 'project_responsibilities',
    entityId: 'project-b',
    label: '项目职责',
    value: '职责 B',
    source: { type: 'user', ref: '项目 B' },
  }, operator);
  await store.confirmFact(a.id, { expectedVersion: 1 }, operator);
  await store.confirmFact(b.id, { expectedVersion: 1 }, operator);

  const exact = await store.queryFacts({ section: 'project_responsibilities', entityId: 'project-a' }, agent);
  assert.equal(exact.length, 1);
  assert.equal(exact[0].value, '职责 A');
  assert.equal((await store.queryFacts({ label: '项目职责' }, agent)).length, 2);

  const legacy = structuredClone(a);
  delete legacy.entityId;
  assert.doesNotThrow(() => validateProfileDocument({
    schemaVersion: PROFILE_SCHEMA_VERSION,
    facts: [legacy],
    grants: [],
  }));
});
