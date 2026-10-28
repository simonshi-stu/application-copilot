import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServiceServer } from '../integrations/openchamber/service/entry.js';
import { createStandaloneUiServer, parseArgs } from './standalone-hud.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('standalone HUD accepts an explicit OpenChamber session binding', () => {
  assert.deepEqual(parseArgs(['--session', 'ses_virtual_test', '--no-window']).targetSessionId, 'ses_virtual_test');
  assert.throws(() => parseArgs(['--session', 'not a session']), /会话 ID/);
});

test('standalone HUD serves a loopback page and proxies only the bound project', async (t) => {
  const base = path.join(ROOT, 'private', `test-standalone-${randomUUID()}`);
  const project = path.join(base, 'project');
  await fs.mkdir(project, { recursive: true });
  const serviceToken = randomBytes(24).toString('hex');
  const accessToken = randomBytes(24).toString('hex');
  const service = createServiceServer({ token: serviceToken, projectRoots: [base] });
  const serviceInfo = await service.start();
  const ui = await createStandaloneUiServer({
    projectRoot: project,
    servicePort: serviceInfo.port,
    serviceToken,
    accessToken,
  });
  t.after(async () => {
    await ui.stop().catch(() => {});
    await service.stop().catch(() => {});
    await fs.rm(base, { recursive: true, force: true });
  });

  const baseUrl = `http://${ui.host}:${ui.port}`;
  const page = await fetch(`${baseUrl}/standalone/index.html?access=${accessToken}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /独立投递 HUD/);

  const config = await fetch(`${baseUrl}/api/config?access=${accessToken}`);
  assert.equal(config.status, 200);
  const configBody = await config.json();
  assert.equal(configBody.directory, project);
  assert.equal(configBody.sessionAvailable, false);
  assert.equal(configBody.sessionBridgeAvailable, true);
  assert.equal(configBody.targetSessionId, null);

  const queuedMessage = await fetch(`${baseUrl}/api/session-message`, {
    method: 'POST',
    headers: {
      'X-Application-Copilot-Standalone': accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: '  虚构独立窗口消息  ', targetSessionId: 'ses_virtual_test' }),
  });
  assert.equal(queuedMessage.status, 200);
  const queuedMessageBody = await queuedMessage.json();
  assert.equal(queuedMessageBody.message.text, '  虚构独立窗口消息  ');
  assert.equal(queuedMessageBody.message.targetSessionId, 'ses_virtual_test');
  const inbox = await fetch(
    `http://127.0.0.1:${serviceInfo.port}/api/session-inbox?directory=${encodeURIComponent(project)}`,
    { headers: { Authorization: `Bearer ${serviceToken}` } },
  );
  assert.equal(inbox.status, 200);
  const inboxBody = await inbox.json();
  assert.equal(inboxBody.messages[0].id, queuedMessageBody.message.id);
  assert.equal(inboxBody.messages[0].targetSessionId, 'ses_virtual_test');

  async function standaloneCommand(command, input, expectedRevision) {
    const response = await fetch(`${baseUrl}/api/command`, {
      method: 'POST',
      headers: {
        'X-Application-Copilot-Standalone': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ directory: project, command, input, expectedRevision }),
    });
    return { status: response.status, body: await response.json() };
  }
  const first = await standaloneCommand('user.enqueue', {
    url: 'https://first.example.invalid/jobs',
    companyName: '虚构第一家公司',
  }, 0);
  const second = await standaloneCommand('user.enqueue', {
    url: 'https://second.example.invalid/jobs',
    companyName: '虚构第二家公司',
  }, first.body.revision);
  const secondId = second.body.state.companies.find(company => company.name === '虚构第二家公司').id;
  const prioritized = await standaloneCommand('user.prioritizeCompany', { companyId: secondId }, second.body.revision);
  assert.equal(prioritized.status, 200);
  const started = await standaloneCommand('user.start', {}, prioritized.body.revision);
  assert.equal(started.status, 200);
  assert.equal(started.body.state.currentCompanyId, secondId);

  const state = await fetch(`${baseUrl}/api/state?directory=${encodeURIComponent(project)}`, {
    headers: { 'X-Application-Copilot-Standalone': accessToken },
  });
  assert.equal(state.status, 200);
  const stateBody = await state.json();
  assert.equal(stateBody.ok, true);
  assert.equal(stateBody.state.companies.length, 2);
  assert.equal(stateBody.state.currentCompanyId, secondId);

  const wrongProject = await fetch(`${baseUrl}/api/state?directory=${encodeURIComponent(base)}`, {
    headers: { 'X-Application-Copilot-Standalone': accessToken },
  });
  assert.equal(wrongProject.status, 403);

  const noAccess = await fetch(`${baseUrl}/api/state?directory=${encodeURIComponent(project)}`);
  assert.equal(noAccess.status, 403);
});
