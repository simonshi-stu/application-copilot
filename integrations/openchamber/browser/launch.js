// 用 Node 内置 child_process 启动本机已安装 Chrome/Edge。
// 通过 --remote-debugging-pipe 的 fd3/fd4 通信，不开放 TCP 调试端口。

import { spawn } from 'node:child_process';
import {
  BrowserLaunchError,
  buildBrowserArgs,
  resolveInstalledBrowser,
  resolveProfileDirectory,
  sanitizedBrowserEnv,
} from './chrome.js';
import { CdpConnection, createPipeTransport, waitForProcessExit } from './cdp.js';

function startFailureCode(error) {
  if (error?.code === 'CDP_TIMEOUT') return 'BROWSER_PIPE_TIMEOUT';
  if (error?.code === 'CDP_CLOSED') return 'BROWSER_EXITED';
  if (error?.code === 'CDP_PIPE_CLOSED') return 'BROWSER_PIPE_CLOSED';
  return 'BROWSER_LAUNCH_FAILED';
}

async function terminateChild(child, cdp) {
  try {
    cdp?.close('浏览器启动失败，关闭连接。');
  } catch {
    // 忽略清理错误。
  }
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill();
  } catch {
    // 忽略。
  }
  if (await waitForProcessExit(child, 3000)) return;
  try {
    child.kill('SIGKILL');
  } catch {
    // 忽略。
  }
  await waitForProcessExit(child, 2000);
}

/**
 * 启动浏览器并等待 Browser.getVersion。失败时会清理子进程。
 */
export async function launchBrowser({
  projectDirectory,
  browserPreference = 'auto',
  browserName = null,
  instanceId = 'moka',
  headless = false,
  startupTimeoutMs = 20000,
  spawnImpl = spawn,
} = {}) {
  const resolved = resolveInstalledBrowser({
    preference: browserPreference,
  });
  const browser = browserName || resolved.browser;
  const profileDir = resolveProfileDirectory({
    projectDirectory,
    browserName: browser,
    instanceId,
  });
  const args = buildBrowserArgs({ profileDir, headless, initialUrl: 'about:blank' });

  let child;
  try {
    child = spawnImpl(resolved.executable, args, {
      stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
      env: sanitizedBrowserEnv(process.env),
      windowsHide: !!headless,
      detached: false,
    });
  } catch (error) {
    throw new BrowserLaunchError('BROWSER_SPAWN_FAILED', '无法启动本机浏览器进程。', { reason: error?.code || null });
  }

  let stderrTail = '';
  child.stderr?.on('data', (chunk) => {
    stderrTail = `${stderrTail}${chunk.toString('utf8')}`.slice(-8000);
  });

  const transport = createPipeTransport({
    readable: child.stdio[4],
    writable: child.stdio[3],
  });
  transport.start();
  const cdp = new CdpConnection(transport, { defaultTimeoutMs: startupTimeoutMs });
  let exited = false;
  let exitInfo = null;
  child.once('exit', (code, signal) => {
    exited = true;
    exitInfo = { code, signal };
    cdp.close(`浏览器进程已退出（${code ?? signal ?? 'unknown'}）。`);
  });
  child.once('error', (error) => {
    cdp.close(`浏览器进程错误：${error?.message || 'unknown'}`);
  });

  let version;
  try {
    version = await cdp.send('Browser.getVersion', {}, { timeoutMs: startupTimeoutMs });
  } catch (error) {
    await terminateChild(child, cdp);
    const code = startFailureCode(error);
    throw new BrowserLaunchError(code, `浏览器 CDP pipe 启动失败（${code}）。`, {
      reason: error?.message || null,
      exited,
      exitCode: exitInfo?.code ?? null,
      stderrTail: stderrTail.slice(-1000),
    });
  }

  if (exited) {
    await terminateChild(child, cdp);
    throw new BrowserLaunchError('BROWSER_EXITED', '浏览器在建立 CDP pipe 前已退出。', {
      exitCode: exitInfo?.code ?? null,
      stderrTail: stderrTail.slice(-1000),
    });
  }

  let closed = false;
  async function close() {
    if (closed) return { closed: true, forced: false };
    closed = true;
    try {
      await cdp.send('Browser.close', {}, { timeoutMs: 1500 });
    } catch {
      // Browser.close 可能在响应前关闭 pipe，这是正常情况。
    }
    const exitedNormally = await waitForProcessExit(child, 3000);
    let forced = false;
    if (!exitedNormally) {
      forced = true;
      try {
        child.kill();
      } catch {
        // 忽略。
      }
      if (!(await waitForProcessExit(child, 1500))) {
        try {
          child.kill('SIGKILL');
        } catch {
          // 忽略。
        }
        await waitForProcessExit(child, 1500);
      }
    }
    cdp.close('浏览器已关闭。');
    await waitForProcessExit(child, 1000);
    return { closed: true, forced };
  }

  return {
    browser,
    executable: resolved.executable,
    profileDir,
    headless: !!headless,
    cdp,
    child,
    version: {
      product: version?.product || null,
      protocolVersion: version?.protocolVersion || null,
      userAgent: version?.userAgent || null,
    },
    stderrTail: () => stderrTail,
    close,
  };
}
