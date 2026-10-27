import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BROWSER_NAMES,
  BrowserLaunchError,
  browserBinaryCandidates,
  buildBrowserArgs,
  resolveInstalledBrowser,
  resolveProfileDirectory,
  sanitizedBrowserEnv,
} from './chrome.js';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CACHE_ROOT = path.join(PROJECT_ROOT, '.cache');

test('Windows 白名单只包含固定 Chrome/Edge 安装位置', () => {
  const env = {
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    LOCALAPPDATA: 'C:\\Users\\fixture\\AppData\\Local',
  };
  const candidates = browserBinaryCandidates({ platform: 'win32', env, home: 'C:\\Users\\fixture' });
  assert.ok(candidates.every((candidate) => BROWSER_NAMES.includes(candidate.browser)));
  assert.ok(candidates.some((candidate) => candidate.path.endsWith('Google\\Chrome\\Application\\chrome.exe')));
  assert.ok(candidates.some((candidate) => candidate.path.endsWith('Microsoft\\Edge\\Application\\msedge.exe')));
  assert.ok(candidates.every((candidate) => !/curl|wget|powershell|cmd\.exe/i.test(candidate.path)));
});

test('按偏好解析浏览器；找不到时明确 BROWSER_NOT_FOUND', () => {
  const env = {
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': '',
    LOCALAPPDATA: '',
  };
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const edgePath = 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe';
  const foundChrome = resolveInstalledBrowser({
    platform: 'win32',
    env,
    home: 'C:\\Users\\fixture',
    isFile: (candidate) => candidate === chromePath,
  });
  assert.equal(foundChrome.browser, 'chrome');
  assert.equal(foundChrome.executable, chromePath);

  const foundEdge = resolveInstalledBrowser({
    platform: 'win32',
    env,
    home: 'C:\\Users\\fixture',
    isFile: (candidate) => candidate === edgePath,
  });
  assert.equal(foundEdge.browser, 'edge');
  assert.equal(foundEdge.executable, edgePath);

  assert.throws(() => resolveInstalledBrowser({
    platform: 'win32',
    env,
    home: 'C:\\Users\\fixture',
    isFile: () => false,
  }), (error) => error instanceof BrowserLaunchError && error.code === 'BROWSER_NOT_FOUND');

  assert.throws(() => resolveInstalledBrowser({
    preference: 'chrome',
    platform: 'win32',
    env,
    home: 'C:\\Users\\fixture',
    isFile: (candidate) => candidate === edgePath,
  }), (error) => error.code === 'BROWSER_NOT_FOUND');
});

test('profile 只落在项目 .cache 的受约束子目录', () => {
  fs.mkdirSync(CACHE_ROOT, { recursive: true });
  const fixtureRoot = fs.mkdtempSync(path.join(CACHE_ROOT, 'moka-browser-test-'));
  try {
    const profile = resolveProfileDirectory({
      projectDirectory: fixtureRoot,
      browserName: 'chrome',
      instanceId: 'fixture',
    });
    const relative = path.relative(fixtureRoot, profile);
    assert.ok(relative.startsWith(`.cache${path.sep}moka-browser${path.sep}chrome-fixture`), relative);
    assert.equal(fs.statSync(profile).isDirectory(), true);

    assert.throws(() => resolveProfileDirectory({
      projectDirectory: 'relative\\path',
      browserName: 'chrome',
    }), (error) => error.code === 'INVALID_PROJECT_DIRECTORY');

    assert.throws(() => resolveProfileDirectory({
      projectDirectory: path.parse(fixtureRoot).root,
      browserName: 'chrome',
    }), (error) => error.code === 'INVALID_PROJECT_DIRECTORY');

    assert.throws(() => resolveProfileDirectory({
      projectDirectory: fixtureRoot,
      browserName: 'chrome',
      instanceId: '../escape',
    }), (error) => error.code === 'INVALID_INSTANCE_ID');
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('启动参数使用 pipe 与项目 profile，不开放端口或 no-sandbox', () => {
  const args = buildBrowserArgs({
    profileDir: 'C:\\项目\\.cache\\moka-browser\\chrome-moka',
    headless: false,
    initialUrl: 'about:blank',
  });
  assert.ok(args.includes('--remote-debugging-pipe'));
  assert.ok(args.includes('--user-data-dir=C:\\项目\\.cache\\moka-browser\\chrome-moka'));
  assert.ok(args.includes('about:blank'));
  assert.ok(!args.some((arg) => arg.startsWith('--remote-debugging-port')));
  assert.ok(!args.includes('--no-sandbox'));
  assert.ok(!args.includes('--disable-web-security'));
  assert.ok(!args.includes('--headless=new'));
  assert.equal(args[args.length - 1], 'about:blank');

  const headlessArgs = buildBrowserArgs({ profileDir: '/tmp/profile', headless: true });
  assert.ok(headlessArgs.includes('--headless=new'));
  assert.throws(() => buildBrowserArgs({ profileDir: '' }), (error) => error.code === 'INVALID_PROFILE_DIRECTORY');
});

test('传给浏览器的环境不包含业务密钥', () => {
  const env = sanitizedBrowserEnv({
    ...process.env,
    OPENAI_API_KEY: 'sk-secret',
    OPENCHAMBER_SERVICE_TOKEN: 'token-secret',
    AWS_SECRET_ACCESS_KEY: 'aws-secret',
    PATH: process.env.PATH,
  });
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.OPENCHAMBER_SERVICE_TOKEN, undefined);
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  if (process.env.PATH) assert.equal(env.PATH, process.env.PATH);
});
