import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PRIVATE_ROOT } from '../core/store.js';
import { createWorkbenchService } from '../core/service.js';
import { createToolRegistry } from '../core/tools.js';

test('工具白名单严格校验 schema，agent 不能调用本人操作', async t => {
  const dir = path.join(PRIVATE_ROOT, `test-core-tools-${randomUUID()}`);
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const service = createWorkbenchService({
    directory: dir,
    now: () => '2026-10-26T00:00:00.000Z',
    newId: () => randomUUID(),
  });
  const agent = createToolRegistry(service, { access: 'agent' });
  const operator = createToolRegistry(service, { access: 'operator' });

  const agentNames = agent.list().map(tool => tool.name);
  const operatorNames = operator.list().map(tool => tool.name);
  assert.ok(agentNames.includes('get_workbench_summary'));
  assert.ok(!agentNames.includes('record_human_submission'));
  assert.ok(!agentNames.includes('start_queue'));
  assert.ok(!agentNames.includes('list_profile_facts_for_local_edit'));
  assert.ok(!agentNames.includes('acknowledge_recovery'));
  assert.ok(operatorNames.includes('record_human_submission'));
  assert.ok(operatorNames.includes('start_queue'));
  assert.ok(operatorNames.includes('list_profile_facts_for_local_edit'));
  assert.ok(operatorNames.includes('acknowledge_recovery'));
  assert.ok(!operatorNames.includes('set_state'));

  await assert.rejects(agent.invoke('record_human_submission', {}), error => error.code === 'TOOL_FORBIDDEN');
  await assert.rejects(agent.invoke('start_queue', { eventId: 'e-1', confirmedBy: 'user' }), error => error.code === 'TOOL_FORBIDDEN');
  await assert.rejects(agent.invoke('set_state', { status: 'completed' }), error => error.code === 'TOOL_NOT_FOUND');

  await assert.rejects(
    operator.invoke('add_company', { name: '示例公司', unexpected: '绕过' }),
    error => error.code === 'INVALID_INPUT' && /\$\.unexpected/.test(error.message),
  );
  await assert.rejects(
    operator.invoke('add_company', { name: '' }),
    error => error.code === 'INVALID_INPUT',
  );
  const added = await operator.invoke('add_company', {
    name: '示例公司',
    links: [{ url: 'https://example.invalid/jobs', kind: 'apply', source: '虚构' }],
  });
  assert.equal(added.company.name, '示例公司');

  await assert.rejects(
    operator.invoke('start_queue', { eventId: 'start-tool', confirmedBy: 'model' }),
    error => error.code === 'INVALID_INPUT',
  );
  await assert.rejects(
    agent.invoke('record_no_positions', { companyId: added.company.id, eventId: 'no-evidence' }),
    error => error.code === 'INVALID_INPUT',
  );
  await assert.rejects(
    agent.invoke('query_profile_facts', { purpose: 'family_form' }),
    error => error.code === 'INVALID_INPUT',
  );

  const summary = await agent.invoke('get_workbench_summary', {});
  assert.equal(summary.companies.length, 1);
  assert.equal(summary.companies[0].status, 'queued');
  assert.equal(summary.queue.status, 'idle');
  assert.equal(summary.queue.currentCompanyId, null);
});
