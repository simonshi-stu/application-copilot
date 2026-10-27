// 固定平台已安装浏览器白名单与项目内独立 profile 解析。
// 不下载浏览器、不读取用户日常 profile、不接受任意可执行文件路径。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const BROWSER_NAMES = Object.freeze(['chrome', 'edge']);
const SAFE_ENV_KEYS = Object.freeze([
  'SystemRoot', 'windir', 'ComSpec', 'PATHEXT', 'PATH',
  'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432',
  'LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
  'TEMP', 'TMP', 'HOME', 'USER', 'LOGNAME',
  'LANG', 'LC_ALL', 'TMPDIR',
  'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS',
]);

export class BrowserLaunchError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'BrowserLaunchError';
    this.code = code;
    this.details = details || null;
  }
}

function pathApi(platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

function envValue(env, key) {
  return env && typeof env[key] === 'string' && env[key] ? env[key] : '';
}

/**
 * 返回固定白名单候选路径，不读取注册表、不执行 where / which。
 * 测试可以传入 platform / env / home 覆盖。
 */
export function browserBinaryCandidates({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const join = pathApi(platform).join;
  const candidates = [];
  const add = (browser, ...parts) => {
    const values = parts.flat().filter(Boolean);
    if (values.some((part) => typeof part !== 'string' || !part)) return;
    candidates.push({ browser, path: join(...values) });
  };

  if (platform === 'win32') {
    const programFiles = envValue(env, 'ProgramFiles');
    const programFilesX86 = envValue(env, 'ProgramFiles(x86)');
    const localAppData = envValue(env, 'LOCALAPPDATA');
    for (const root of [programFiles, programFilesX86, localAppData]) {
      add('chrome', root, 'Google', 'Chrome', 'Application', 'chrome.exe');
    }
    for (const root of [programFiles, programFilesX86, localAppData]) {
      add('edge', root, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    }
  } else if (platform === 'darwin') {
    for (const root of ['/Applications', join(home, 'Applications')]) {
      add('chrome', root, 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome');
      add('edge', root, 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge');
    }
  } else {
    add('chrome', '/usr/bin', 'google-chrome');
    add('chrome', '/usr/bin', 'google-chrome-stable');
    add('chrome', '/opt/google/chrome', 'chrome');
    add('edge', '/usr/bin', 'microsoft-edge');
    add('edge', '/usr/bin', 'microsoft-edge-stable');
    add('edge', '/opt/microsoft/msedge', 'msedge');
  }

  // 去重，保持 Chrome 优先、Edge 次之。
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = platform === 'win32' ? candidate.path.toLowerCase() : candidate.path;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 只在白名单候选中解析已安装的 Chrome / Edge。
 * @returns {{browser: 'chrome'|'edge', executable: string, checked: Array}}
 */
export function resolveInstalledBrowser({
  preference = 'auto',
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
  isFile = (candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  },
} = {}) {
  if (!['auto', ...BROWSER_NAMES].includes(preference)) {
    throw new BrowserLaunchError('INVALID_BROWSER_PREFERENCE', '只能选择自动、Chrome 或 Edge。');
  }
  const checked = browserBinaryCandidates({ platform, env, home });
  const ordered = preference === 'auto'
    ? checked
    : checked.filter((candidate) => candidate.browser === preference);
  for (const candidate of ordered) {
    if (isFile(candidate.path)) {
      return {
        browser: candidate.browser,
        executable: candidate.path,
        checked: ordered,
      };
    }
  }
  throw new BrowserLaunchError(
    'BROWSER_NOT_FOUND',
    '未找到已安装的 Chrome 或 Edge。本项目不下载浏览器；请先在本机安装受支持的浏览器。',
    { checked: ordered.map((candidate) => ({ browser: candidate.browser, path: candidate.path })) },
  );
}

function isPathInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function safeInstanceId(instanceId) {
  const value = String(instanceId || 'moka');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) {
    throw new BrowserLaunchError('INVALID_INSTANCE_ID', '浏览器 profile 标识只能包含字母、数字、下划线和短横线。');
  }
  return value;
}

/**
 * 由宿主传入的 projectDirectory 得到受约束的 profile 子目录：
 * <project>/.cache/moka-browser/<browser>-<instanceId>
 * 不接触用户日常浏览器 profile。
 */
export function resolveProfileDirectory({
  projectDirectory,
  browserName = 'chrome',
  instanceId = 'moka',
  fsImpl = fs,
} = {}) {
  if (typeof projectDirectory !== 'string' || !projectDirectory.trim()) {
    throw new BrowserLaunchError('INVALID_PROJECT_DIRECTORY', '缺少项目目录，不能创建浏览器 profile。');
  }
  if (!path.isAbsolute(projectDirectory)) {
    throw new BrowserLaunchError('INVALID_PROJECT_DIRECTORY', '项目目录必须是绝对路径。');
  }
  if (!BROWSER_NAMES.includes(browserName)) {
    throw new BrowserLaunchError('INVALID_BROWSER_NAME', '浏览器名称不受支持。');
  }

  const root = path.resolve(projectDirectory);
  if (root === path.parse(root).root) {
    throw new BrowserLaunchError('INVALID_PROJECT_DIRECTORY', '项目目录不能是文件系统根目录。');
  }
  const cacheRoot = path.join(root, '.cache');
  const profileRoot = path.join(cacheRoot, 'moka-browser');
  const profileDir = path.join(profileRoot, `${browserName}-${safeInstanceId(instanceId)}`);

  if (!isPathInside(cacheRoot, root) || !isPathInside(profileDir, cacheRoot)) {
    throw new BrowserLaunchError('PROFILE_PATH_UNSAFE', '浏览器 profile 路径越出项目 .cache 目录。');
  }

  try {
    fsImpl.mkdirSync(profileDir, { recursive: true, mode: 0o700 });
    const realRoot = fsImpl.realpathSync.native ? fsImpl.realpathSync.native(root) : fsImpl.realpathSync(root);
    const realCache = fsImpl.realpathSync.native ? fsImpl.realpathSync.native(cacheRoot) : fsImpl.realpathSync(cacheRoot);
    const realProfile = fsImpl.realpathSync.native ? fsImpl.realpathSync.native(profileDir) : fsImpl.realpathSync(profileDir);
    if (!isPathInside(realCache, realRoot) || !isPathInside(realProfile, realCache)) {
      throw new BrowserLaunchError('PROFILE_PATH_UNSAFE', '浏览器 profile 的真实路径越出项目 .cache 目录。');
    }
  } catch (error) {
    if (error instanceof BrowserLaunchError) throw error;
    throw new BrowserLaunchError('PROFILE_DIRECTORY_FAILED', '无法创建项目内浏览器 profile 目录。', { reason: error?.code || null });
  }

  return profileDir;
}

/** 只把运行浏览器必需的系统环境传给子进程，避免把业务密钥带进浏览器进程。 */
export function sanitizedBrowserEnv(env = process.env) {
  const result = {};
  for (const key of SAFE_ENV_KEYS) {
    if (typeof env[key] === 'string') result[key] = env[key];
  }
  return result;
}

/** 构造 Chrome / Edge 启动参数。使用 pipe，不开放 TCP 调试端口。 */
export function buildBrowserArgs({ profileDir, headless = false, initialUrl = 'about:blank' } = {}) {
  if (typeof profileDir !== 'string' || !profileDir || profileDir.includes('\0')) {
    throw new BrowserLaunchError('INVALID_PROFILE_DIRECTORY', '浏览器 profile 路径无效。');
  }
  if (typeof initialUrl !== 'string' || initialUrl.includes('\0')) {
    throw new BrowserLaunchError('INVALID_INITIAL_URL', '浏览器初始页面无效。');
  }
  const args = [
    '--remote-debugging-pipe',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--disable-extensions',
    '--disable-default-apps',
    '--disable-component-update',
    '--disable-background-networking',
    '--disable-client-side-phishing-detection',
    '--disable-popup-blocking',
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
    '--metrics-recording-only',
    '--password-store=basic',
    '--use-mock-keychain',
    '--window-size=1280,900',
    '--lang=zh-CN',
  ];
  if (headless) {
    args.push('--headless=new', '--disable-gpu');
  }
  args.push(initialUrl);
  return args;
}
