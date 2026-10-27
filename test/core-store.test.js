import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  JsonFileStore,
  PRIVATE_ROOT,
  PROJECT_ROOT,
  VersionConflictError,
  assertPrivateDirectory,
} from '../core/store.js';

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['value'],
  properties: { value: { type: 'string' } },
};

function tempDir() {
  return path.join(PRIVATE_ROOT, `test-core-store-${randomUUID()}`);
}

test('只允许 private/ 下的明确子目录，拒绝路径穿越和宽目录', () => {
  assert.throws(() => assertPrivateDirectory(''), /必须显式传入/);
  assert.throws(() => assertPrivateDirectory(PRIVATE_ROOT), /明确子目录/);
  assert.throws(() => assertPrivateDirectory(path.join(PRIVATE_ROOT, '..')), /项目外或路径穿越/);
  assert.throws(() => assertPrivateDirectory(path.join(PROJECT_ROOT, 'outside')), /项目外或路径穿越/);
  const dir = tempDir();
  assert.equal(assertPrivateDirectory(dir), path.resolve(dir));
  assert.throws(() => new JsonFileStore({ directory: dir, fileName: '../escape.json' }), /简单 \.json/);
});

test('原子写入、版本冲突和 schema 拒绝都不覆盖已有文件', async t => {
  const dir = tempDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(dir, { recursive: true });

  const first = new JsonFileStore({ directory: dir, fileName: 'runtime.json', validate: data => {
    assert.ok(data && typeof data.value === 'string');
  } });
  assert.deepEqual(await first.load(), { data: null, revision: 0, exists: false });
  await first.save({ value: '第一版' }, 0);

  const second = new JsonFileStore({ directory: dir, fileName: 'runtime.json', validate: data => {
    assert.ok(data && typeof data.value === 'string');
  } });
  assert.deepEqual(await second.load(), { data: { value: '第一版' }, revision: 1, exists: true });

  await first.save({ value: '第二版' }, 1);
  await assert.rejects(
    second.save({ value: '冲突版本' }, 1),
    error => error instanceof VersionConflictError && error.code === 'VERSION_CONFLICT',
  );
  const third = new JsonFileStore({ directory: dir, fileName: 'runtime.json' });
  assert.deepEqual((await third.load()).data, { value: '第二版' });

  await assert.rejects(first.save({ wrong: true }, 2), /value/);
  assert.deepEqual((await new JsonFileStore({ directory: dir, fileName: 'runtime.json' }).load()).data, { value: '第二版' });

  const entries = await fs.readdir(dir);
  assert.deepEqual(entries, ['runtime.json']);
});

test('损坏文件被拒绝而不是静默清空', async t => {
  const dir = tempDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'runtime.json'), '{not-json', 'utf8');
  const store = new JsonFileStore({ directory: dir, fileName: 'runtime.json' });
  await assert.rejects(store.load(), /不是有效 JSON/);
  assert.equal(await fs.readFile(path.join(dir, 'runtime.json'), 'utf8'), '{not-json');
});

const LINK_ERRORS = new Set(['EPERM', 'EACCES', 'UNKNOWN', 'ENOSYS']);

test('拒绝 private 子目录符号链接/联结点，读写前都检查', async t => {
  const token = randomUUID();
  const outside = path.join(PROJECT_ROOT, 'artifacts', `test-core-link-target-${token}`);
  const dir = path.join(PRIVATE_ROOT, `test-core-link-${token}`);
  const link = path.join(dir, 'linked');
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });
  await fs.mkdir(outside, { recursive: true });
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (LINK_ERRORS.has(error.code)) {
      t.skip(`当前 Windows/文件系统权限不允许创建目录链接（${error.code}），未执行该验证。`);
      return;
    }
    throw error;
  }
  const store = new JsonFileStore({ directory: link, fileName: 'runtime.json' });
  await assert.rejects(store.load(), error => error.code === 'PATH_SYMLINK');
  await assert.rejects(store.save({ value: 'x' }, 0), error => error.code === 'PATH_SYMLINK');
});

test('拒绝 runtime 文件符号链接，避免读写项目外目标', async t => {
  const token = randomUUID();
  const outside = path.join(PROJECT_ROOT, 'artifacts', `test-core-file-target-${token}`);
  const dir = path.join(PRIVATE_ROOT, `test-core-filelink-${token}`);
  const targetFile = path.join(outside, 'runtime.json');
  const linkFile = path.join(dir, 'runtime.json');
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });
  await fs.mkdir(outside, { recursive: true });
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(targetFile, '{"outside":true}', 'utf8');
  try {
    await fs.symlink(targetFile, linkFile, 'file');
  } catch (error) {
    if (LINK_ERRORS.has(error.code)) {
      t.skip(`当前 Windows/文件系统权限不允许创建文件符号链接（${error.code}），未执行该验证。`);
      return;
    }
    throw error;
  }
  const store = new JsonFileStore({ directory: dir, fileName: 'runtime.json' });
  await assert.rejects(store.load(), error => error.code === 'PATH_SYMLINK');
  await assert.rejects(store.save({ value: 'x' }, 0), error => error.code === 'PATH_SYMLINK');
});

test('privateRoot 自身为链接时拒绝运行', async t => {
  const token = randomUUID();
  const base = path.join(PROJECT_ROOT, 'artifacts', `test-core-rootlink-${token}`);
  const realRoot = path.join(base, 'real-private');
  const linkRoot = path.join(base, 'linked-private');
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await fs.mkdir(realRoot, { recursive: true });
  try {
    await fs.symlink(realRoot, linkRoot, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (LINK_ERRORS.has(error.code)) {
      t.skip(`当前 Windows/文件系统权限不允许创建根目录链接（${error.code}），未执行该验证。`);
      return;
    }
    throw error;
  }
  const store = new JsonFileStore({
    directory: path.join(linkRoot, 'runtime'),
    fileName: 'runtime.json',
    privateRoot: linkRoot,
  });
  await assert.rejects(store.load(), error => error.code === 'PATH_SYMLINK');
});
