// 私有数据的单写入、原子文件存储。没有传入明确 private/ 子目录时不会创建任何文件。

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateSchema } from './validation.js';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PRIVATE_ROOT = path.join(PROJECT_ROOT, 'private');
export const FILE_FORMAT = 'application-copilot.file.v1';

export class StoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}

export class VersionConflictError extends StoreError {
  constructor(expected, actual) {
    super('VERSION_CONFLICT', `运行数据已被其他写入者更新（期望版本 ${expected}，实际 ${actual}）；未覆盖新数据。`);
    this.expected = expected;
    this.actual = actual;
  }
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function assertPrivateDirectory(directory, { privateRoot = PRIVATE_ROOT } = {}) {
  if (typeof directory !== 'string' || !directory.trim()) {
    throw new StoreError('PRIVATE_DIR_REQUIRED', '必须显式传入本项目 private/ 下的运行目录，默认不创建真实资料。');
  }
  const root = path.resolve(privateRoot);
  const target = path.resolve(directory);
  if (target === root) {
    throw new StoreError('PRIVATE_DIR_TOO_BROAD', '运行目录必须是 private/ 下的明确子目录，不能直接使用 private/ 根目录。');
  }
  if (!isInside(root, target)) {
    throw new StoreError('PATH_TRAVERSAL', '运行目录必须位于本项目 private/ 下，拒绝项目外或路径穿越目录。');
  }
  return target;
}

function assertFileName(fileName) {
  if (typeof fileName !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(fileName) || fileName.includes('..')) {
    throw new StoreError('INVALID_FILE_NAME', '文件名必须是 private 目录内的简单 .json 文件名。');
  }
  return fileName;
}

function samePath(a, b) {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

async function lstatIfExists(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// 拒绝任一已存在路径组件是 symlink / junction，并确认真实 privateRoot 与解析路径一致。
// 写入前和读取前都会调用；覆盖目录、runtime 文件以及 privateRoot 祖先。
export async function assertSafePrivatePaths({ privateRoot = PRIVATE_ROOT, directory, filePath = null } = {}) {
  const root = path.resolve(privateRoot);
  const target = path.resolve(directory);
  if (!isInside(root, target)) {
    throw new StoreError('PATH_TRAVERSAL', '运行目录必须位于本项目 private/ 下，拒绝项目外或路径穿越目录。');
  }
  const rootStat = await lstatIfExists(root);
  if (!rootStat) throw new StoreError('PRIVATE_ROOT_MISSING', 'private/ 根目录不存在，拒绝创建或读取运行数据。');
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new StoreError('PATH_SYMLINK', 'private/ 根目录本身是符号链接/联结点或不是目录，拒绝运行。');
  }
  const realRoot = await fs.realpath(root);
  if (!samePath(realRoot, root)) {
    throw new StoreError('PATH_SYMLINK', 'private/ 根目录的真实路径与解析路径不一致（祖先存在符号链接/联结点），拒绝运行。');
  }

  const chain = [];
  let current = target;
  while (!samePath(current, root)) {
    chain.push(current);
    const parent = path.dirname(current);
    if (samePath(parent, current) || (!samePath(parent, root) && !isInside(root, parent))) {
      throw new StoreError('PATH_TRAVERSAL', '运行目录路径无法安全解析到 private/ 下。');
    }
    current = parent;
  }
  chain.reverse();

  for (const component of chain) {
    const stat = await lstatIfExists(component);
    if (!stat) continue;
    if (stat.isSymbolicLink()) {
      throw new StoreError('PATH_SYMLINK', `运行目录路径包含符号链接/联结点：${component}`);
    }
    if (!stat.isDirectory()) {
      throw new StoreError('PATH_NOT_DIRECTORY', `运行目录路径组件不是目录：${component}`);
    }
    const real = await fs.realpath(component);
    if (!samePath(real, component) || (!isInside(realRoot, real) && !samePath(realRoot, real))) {
      throw new StoreError('PATH_SYMLINK', `运行目录真实路径越界或经过链接：${component}`);
    }
  }

  if (filePath) {
    const resolvedFile = path.resolve(filePath);
    if (path.dirname(resolvedFile) !== target) {
      throw new StoreError('PATH_TRAVERSAL', '运行文件名必须直接位于指定目录内。');
    }
    const fileStat = await lstatIfExists(resolvedFile);
    if (fileStat) {
      if (fileStat.isSymbolicLink()) {
        throw new StoreError('PATH_SYMLINK', 'runtime 文件是符号链接/联结点，拒绝读取或覆盖。');
      }
      if (!fileStat.isFile()) throw new StoreError('PATH_NOT_FILE', 'runtime 路径不是普通文件。');
      const realFile = await fs.realpath(resolvedFile);
      if (!samePath(realFile, resolvedFile) || !isInside(realRoot, realFile)) {
        throw new StoreError('PATH_SYMLINK', 'runtime 文件真实路径越界或经过链接。');
      }
    }
  }
  return { realRoot, directory: target, filePath };
}

const writeTails = new Map();

function serialize(key, task) {
  const previous = writeTails.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  writeTails.set(key, next.catch(() => {}));
  return next;
}

function clone(value) {
  return value === null || value === undefined ? value : structuredClone(value);
}

export class JsonFileStore {
  constructor({ directory, fileName = 'runtime.json', privateRoot = PRIVATE_ROOT, validate = null } = {}) {
    this.directory = assertPrivateDirectory(directory, { privateRoot });
    this.fileName = assertFileName(fileName);
    this.filePath = path.join(this.directory, this.fileName);
    this.privateRoot = path.resolve(privateRoot);
    this.validate = validate;
    this.data = null;
    this.revision = 0;
    this.loaded = false;
  }

  async assertSafePaths() {
    return assertSafePrivatePaths({
      privateRoot: this.privateRoot,
      directory: this.directory,
      filePath: this.filePath,
    });
  }

  async load({ force = false } = {}) {
    await this.assertSafePaths();
    if (this.loaded && !force) {
      return { data: clone(this.data), revision: this.revision, exists: this.data !== null };
    }
    let raw;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.loaded = true;
        this.data = null;
        this.revision = 0;
        return { data: null, revision: 0, exists: false };
      }
      throw error;
    }
    let wrapper;
    try {
      wrapper = JSON.parse(raw);
    } catch {
      throw new StoreError('CORRUPT_FILE', '运行数据文件不是有效 JSON；未覆盖原文件，请先核查或另存。');
    }
    if (!wrapper || wrapper.format !== FILE_FORMAT || !Number.isInteger(wrapper.revision) || wrapper.revision < 0
      || !Object.hasOwn(wrapper, 'data') || typeof wrapper.savedAt !== 'string') {
      throw new StoreError('CORRUPT_FILE', '运行数据文件格式异常；未覆盖原文件，请先核查或另存。');
    }
    if (this.validate) this.validate(wrapper.data);
    this.data = clone(wrapper.data);
    this.revision = wrapper.revision;
    this.loaded = true;
    return { data: clone(this.data), revision: this.revision, exists: true };
  }

  async readDiskRevision() {
    await this.assertSafePaths();
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const wrapper = JSON.parse(raw);
      if (!wrapper || wrapper.format !== FILE_FORMAT || !Number.isInteger(wrapper.revision)) {
        throw new StoreError('CORRUPT_FILE', '运行数据文件格式异常；未覆盖原文件。');
      }
      return wrapper.revision;
    } catch (error) {
      if (error.code === 'ENOENT') return 0;
      throw error;
    }
  }

  async save(data, expectedRevision) {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new StoreError('INVALID_REVISION', '保存时必须提供预期的非负整数版本。');
    }
    if (this.validate) this.validate(data);
    const snapshot = clone(data);
    return serialize(this.filePath, async () => {
      const diskRevision = await this.readDiskRevision();
      if (diskRevision !== expectedRevision) throw new VersionConflictError(expectedRevision, diskRevision);
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      // 创建目录后再次确认，避免已有目录通过链接被替换。
      await this.assertSafePaths();
      const nextRevision = expectedRevision + 1;
      const wrapper = {
        format: FILE_FORMAT,
        revision: nextRevision,
        savedAt: new Date().toISOString(),
        data: snapshot,
      };
      const tempPath = path.join(this.directory, `.${this.fileName}.${process.pid}.${randomUUID()}.tmp`);
      let handle;
      try {
        handle = await fs.open(tempPath, 'wx', 0o600);
        await handle.writeFile(JSON.stringify(wrapper, null, 2), 'utf8');
        await handle.sync();
        await handle.close();
        handle = null;
        await fs.rename(tempPath, this.filePath);
      } catch (error) {
        if (handle) await handle.close().catch(() => {});
        await fs.rm(tempPath, { force: true }).catch(() => {});
        throw error;
      }
      this.data = clone(snapshot);
      this.revision = nextRevision;
      this.loaded = true;
      return { revision: nextRevision, data: clone(this.data) };
    });
  }

  async revisionOnDisk() {
    return this.readDiskRevision();
  }
}

export function createStoreValidator(schema) {
  return data => validateSchema(data, schema);
}
