import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServiceServer } from '../integrations/openchamber/service/entry.js';
import { isSessionId, SESSION_ID_MAX } from '../integrations/openchamber/session-bridge.js';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
const STANDALONE_ROOT = path.join(ROOT, 'integrations', 'openchamber', 'standalone');
const STATIC_FILES = Object.freeze({
  '/standalone/index.html': {
    file: path.join(STANDALONE_ROOT, 'index.html'),
    contentType: 'text/html; charset=utf-8',
  },
  '/standalone/main.js': {
    file: path.join(STANDALONE_ROOT, 'main.js'),
    contentType: 'application/javascript; charset=utf-8',
  },
  '/standalone/styles.css': {
    file: path.join(STANDALONE_ROOT, 'styles.css'),
    contentType: 'text/css; charset=utf-8',
  },
});
const MAX_BODY_BYTES = 1_000_000;

export function parseArgs(argv = process.argv.slice(2)) {
  let projectRoot = ROOT;
  let noWindow = false;
  let targetSessionId = '';
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--no-window') {
      noWindow = true;
      continue;
    }
    if (argument === '--project') {
      const value = argv[index + 1];
      if (!value) throw new Error('--project 需要一个目录路径。');
      projectRoot = path.resolve(value);
      index += 1;
      continue;
    }
    if (argument === '--session') {
      const value = argv[index + 1];
      if (!value || !isSessionId(value)) throw new Error(`--session 需要有效的会话 ID（最多 ${SESSION_ID_MAX} 个字符）。`);
      targetSessionId = value;
      index += 1;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      return { help: true, noWindow, projectRoot, targetSessionId };
    }
    throw new Error(`未知参数：${argument}`);
  }
  return { help: false, noWindow, projectRoot, targetSessionId };
}

export async function createStandaloneUiServer({ projectRoot, servicePort, serviceToken, accessToken, targetSessionId = '' }) {
  const assets = new Map();
  for (const [urlPath, descriptor] of Object.entries(STATIC_FILES)) {
    assets.set(urlPath, {
      ...descriptor,
      body: await readFile(descriptor.file),
    });
  }

  const server = createServer((req, res) => {
    void handleRequest(req, res).catch((error) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendJson(res, 500, {
        ok: false,
        error: { code: 'STANDALONE_SERVER_ERROR', message: '独立窗口服务发生内部错误。' },
      });
      if (process.env.NODE_ENV === 'test') process.emitWarning(error);
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });

  async function handleRequest(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/standalone/index.html') {
      if (req.method !== 'GET' || url.searchParams.get('access') !== accessToken) {
        sendJson(res, 403, { ok: false, error: { code: 'UNAUTHORIZED', message: '独立窗口访问凭据无效。' } });
        return;
      }
      sendAsset(res, assets.get(url.pathname));
      return;
    }

    if (url.pathname === '/api/config') {
      if (req.method !== 'GET' || !hasAccess(req, url)) {
        sendJson(res, 403, { ok: false, error: { code: 'UNAUTHORIZED', message: '独立窗口访问凭据无效。' } });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        directory: projectRoot,
        projectName: path.basename(projectRoot),
        sessionAvailable: false,
        sessionBridgeAvailable: true,
        targetSessionId: targetSessionId || null,
      });
      return;
    }

    if (url.pathname === '/api/session-message') {
      if (req.method !== 'POST' || !hasAccess(req, url)) {
        sendJson(res, 403, { ok: false, error: { code: 'UNAUTHORIZED', message: '独立窗口访问凭据无效。' } });
        return;
      }
      const body = await readJsonBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).some((key) => !['text', 'targetSessionId'].includes(key))
        || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 16000
        || (body.targetSessionId !== undefined && body.targetSessionId !== '' && !isSessionId(body.targetSessionId))) {
        sendJson(res, 400, { ok: false, error: { code: 'INVALID_SESSION_MESSAGE', message: '会话消息不能为空且不能超过 16000 个字符。' } });
        return;
      }
      const messageTarget = body.targetSessionId === undefined ? targetSessionId : body.targetSessionId;
      await proxyJson(res, `http://127.0.0.1:${servicePort}/api/session-inbox`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          directory: projectRoot,
          text: body.text,
          ...(messageTarget ? { targetSessionId: messageTarget } : {}),
        }),
      });
      return;
    }

    if (url.pathname === '/api/state') {
      if (req.method !== 'GET' || !hasAccess(req, url)) {
        sendJson(res, 403, { ok: false, error: { code: 'UNAUTHORIZED', message: '独立窗口访问凭据无效。' } });
        return;
      }
      if (!isProjectRequest(url.searchParams.get('directory'))) {
        sendJson(res, 403, { ok: false, error: { code: 'INVALID_DIRECTORY', message: '只能读取启动时绑定的项目目录。' } });
        return;
      }
      await proxyJson(res, `http://127.0.0.1:${servicePort}/api/state?directory=${encodeURIComponent(projectRoot)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${serviceToken}` },
      });
      return;
    }

    if (url.pathname === '/api/command') {
      if (req.method !== 'POST' || !hasAccess(req, url)) {
        sendJson(res, 403, { ok: false, error: { code: 'UNAUTHORIZED', message: '独立窗口访问凭据无效。' } });
        return;
      }
      const body = await readJsonBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        sendJson(res, 400, { ok: false, error: { code: 'INVALID_BODY', message: '请求体必须是 JSON 对象。' } });
        return;
      }
      if (!isProjectRequest(body.directory)) {
        sendJson(res, 403, { ok: false, error: { code: 'INVALID_DIRECTORY', message: '只能操作启动时绑定的项目目录。' } });
        return;
      }
      await proxyJson(res, `http://127.0.0.1:${servicePort}/api/command`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      return;
    }

    if (url.pathname === '/standalone/main.js' || url.pathname === '/standalone/styles.css') {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: '只允许 GET。' } });
        return;
      }
      sendAsset(res, assets.get(url.pathname));
      return;
    }

    if (url.pathname === '/') {
      res.writeHead(302, { Location: `/standalone/index.html?access=${encodeURIComponent(accessToken)}` });
      res.end();
      return;
    }

    sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: '独立窗口资源不存在。' } });
  }

  function hasAccess(req, url) {
    return req.headers['x-application-copilot-standalone'] === accessToken
      || url.searchParams.get('access') === accessToken;
  }

  function isProjectRequest(directory) {
    return typeof directory === 'string' && path.normalize(directory) === path.normalize(projectRoot);
  }

  return {
    server,
    host: '127.0.0.1',
    port: server.address().port,
    async stop() {
      if (!server.listening) return;
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

export async function startStandaloneHud({ projectRoot = ROOT, launchWindow = true, targetSessionId = '' } = {}) {
  const resolvedRoot = await realpath(projectRoot);
  const rootStat = await stat(resolvedRoot);
  if (!rootStat.isDirectory()) throw new Error('项目路径不是目录。');
  if (targetSessionId && !isSessionId(targetSessionId)) throw new Error('目标会话 ID 无效。');

  const serviceToken = randomBytes(32).toString('hex');
  const accessToken = randomBytes(32).toString('hex');
  const service = createServiceServer({ token: serviceToken, projectRoots: [resolvedRoot] });
  const serviceInfo = await service.start();
  let ui = null;
  let child = null;
  try {
    ui = await createStandaloneUiServer({
      projectRoot: resolvedRoot,
      servicePort: serviceInfo.port,
      serviceToken,
      accessToken,
      targetSessionId,
    });
    const url = `http://${ui.host}:${ui.port}/standalone/index.html?access=${encodeURIComponent(accessToken)}`;
    if (launchWindow) {
      const mshta = process.env.SystemRoot
        ? path.join(process.env.SystemRoot, 'System32', 'mshta.exe')
        : 'mshta.exe';
      child = spawn(mshta, [url], { stdio: 'ignore', windowsHide: false });
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
    }
    return {
      projectRoot: resolvedRoot,
      service,
      ui,
      child,
      url,
      async stop() {
        if (child && child.exitCode === null && !child.killed) child.kill();
        await ui.stop();
        await service.stop();
      },
    };
  } catch (error) {
    await ui?.stop().catch(() => {});
    await service.stop().catch(() => {});
    throw error;
  }
}

async function proxyJson(res, url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  res.writeHead(response.status, {
    'Content-Type': response.headers.get('content-type') || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function sendAsset(res, asset) {
  if (!asset) {
    sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: '独立窗口资源不存在。' } });
    return;
  }
  res.writeHead(200, {
    'Content-Type': asset.contentType,
    'Content-Length': asset.body.length,
    'Cache-Control': 'no-store',
  });
  res.end(asset.body);
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('REQUEST_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve(null);
      }
    });
    req.on('error', reject);
  });
}

function printHelp() {
  console.log('用法：node scripts/standalone-hud.mjs [--project <目录>] [--session <会话 ID>] [--no-window]');
  console.log('默认绑定当前项目，并使用 Windows 内置 mshta.exe 打开独立 HUD 窗口。');
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printHelp();
    return;
  }
  const runtime = await startStandaloneHud({
    projectRoot: options.projectRoot,
    targetSessionId: options.targetSessionId,
    launchWindow: !options.noWindow,
  });
  console.log(`Standalone HUD started on 127.0.0.1:${runtime.ui.port}.`);
  if (options.noWindow) {
    console.log('窗口启动已跳过；按 Ctrl+C 停止本地服务。');
  }
  const shutdown = async () => {
    await runtime.stop().catch(() => {});
  };
  process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
  process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
  if (runtime.child) {
    runtime.child.once('exit', () => void shutdown().finally(() => process.exit(0)));
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`Standalone HUD failed: ${error.message}`);
    process.exitCode = 1;
  });
}
