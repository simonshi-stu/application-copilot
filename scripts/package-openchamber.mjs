import { readFile, stat, lstat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseManifestJson } from '@openchamber/sdk/schemas';
import { requestedGuestCapabilities } from '@openchamber/sdk';
import { verifyPanelBundle, verifyServiceBundle } from './build-openchamber.mjs';
import { writeZipFile } from './zip-writer.mjs';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Explicit runtime allowlist. Never replace this with a recursive repository
 * walk. The local service must be built into one `service/main.js`; if a future
 * backend needs unbundled core files, add their exact paths here after review.
 */
export const RUNTIME_FILES = Object.freeze([
  'LICENSE',
  'THIRD_PARTY_NOTICES',
  'integrations/openchamber/panel/index.html',
  'integrations/openchamber/panel/main.js',
  'integrations/openchamber/panel/styles.css',
]);

export const SERVICE_ENTRY = 'integrations/openchamber/service/main.js';
export const PANEL_ENTRY = 'integrations/openchamber/panel/index.html';
export const OPENCHAMBER_HOST_RANGE = '>=2.3.2';

const FORBIDDEN_PREFIXES = Object.freeze([
  'private/',
  '.cache/',
  'artifacts/',
  'node_modules/',
  '.git/',
  '.github/',
  '.runtime/',
  '.openchamber/',
  '.opencode/',
  'docs/',
  'test/',
  'extension/',
  'mcp/',
  'screenshots/',
  'logs/',
]);

const FORBIDDEN_NAMES = new Set([
  'AGENTS.md',
  'README.md',
  'README.en.md',
  'package-lock.json',
  '.gitignore',
  '.env',
]);

const FORBIDDEN_EXTENSIONS = Object.freeze([
  '.pdf',
  '.doc',
  '.docx',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.csv',
  '.db',
  '.sqlite',
  '.sqlite3',
  '.log',
  '.pem',
  '.key',
  '.p12',
  '.pfx',
]);

export class PublicationError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'PublicationError';
    this.code = code;
    this.details = details;
  }
}

export function isForbiddenPath(path) {
  const normalized = String(path).replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return true;
  if (normalized.split('/').some((part) => part === '..' || part === '')) return true;
  if (FORBIDDEN_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return true;
  if (FORBIDDEN_NAMES.has(normalized)) return true;
  const lower = normalized.toLowerCase();
  if (FORBIDDEN_EXTENSIONS.some((extension) => lower.endsWith(extension))) return true;
  if (/(^|\/)\.env(?:\.|$)|(^|\/)id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)/.test(lower)) return true;
  return false;
}

export function findForbiddenPaths(paths) {
  return paths.filter((path) => isForbiddenPath(path));
}

export async function loadRootPackage(rootDir = ROOT) {
  const packagePath = resolve(rootDir, 'package.json');
  const text = await readFile(packagePath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new PublicationError('INVALID_PACKAGE_JSON', `package.json 不是有效 JSON：${error.message}`);
  }
  const manifestResult = parseManifestJson(text);
  if (!manifestResult.ok) {
    throw new PublicationError(
      'INVALID_OPENCHAMBER_MANIFEST',
      `OpenChamber manifest 校验失败：${manifestResult.code} ${manifestResult.message}`,
    );
  }
  if (parsed.version !== manifestResult.version) {
    throw new PublicationError(
      'VERSION_MISMATCH',
      `package.json version 与 manifest 解析版本不一致：${parsed.version} / ${manifestResult.version}`,
    );
  }
  const exactVersion = /^\d+\.\d+\.\d+$/;
  const devDependencies = parsed.devDependencies ?? {};
  const sdkVersion = devDependencies['@openchamber/sdk'];
  const esbuildVersion = devDependencies.esbuild;
  if (typeof sdkVersion !== 'string' || !exactVersion.test(sdkVersion)) {
    throw new PublicationError(
      'SDK_VERSION_NOT_PINNED',
      '@openchamber/sdk 必须固定到精确版本，不能在发布包中使用版本范围。',
    );
  }
  if (typeof esbuildVersion !== 'string' || !exactVersion.test(esbuildVersion)) {
    throw new PublicationError(
      'ESBUILD_VERSION_NOT_PINNED',
      'esbuild 必须固定到精确版本，不能在发布包中使用版本范围。',
    );
  }
  if (parsed.openchamber?.engines?.openchamber !== OPENCHAMBER_HOST_RANGE) {
    throw new PublicationError(
      'HOST_ENGINE_MISMATCH',
      `openchamber.engines.openchamber 必须是 ${OPENCHAMBER_HOST_RANGE}。`,
    );
  }
  return {
    packagePath,
    text,
    packageJson: parsed,
    manifest: manifestResult.manifest,
    sdkVersion,
    esbuildVersion,
  };
}

function validateLeastPrivilege(manifest) {
  const contributes = manifest.contributes;
  if (!contributes.service) {
    throw new PublicationError('SERVICE_MISSING', 'manifest 未声明 contributes.service，不能生成可用包。');
  }
  if (contributes.service.runtime !== 'host') {
    throw new PublicationError('INVALID_SERVICE_RUNTIME', 'service.runtime 必须是 host。');
  }
  if (contributes.service.provides) {
    throw new PublicationError(
      'OVERPRIVILEGED_SERVICE',
      'service.provides 不得声明 browser/source-control 等未批准能力。',
    );
  }
  const requested = requestedGuestCapabilities(contributes);
  const unexpected = requested.filter((capability) => capability !== 'service');
  if (unexpected.length > 0) {
    throw new PublicationError(
      'OVERPRIVILEGED_CAPABILITIES',
      `发布包声明了未批准能力：${unexpected.join(', ')}。只允许 service。`,
    );
  }
  if (contributes.filesystem || contributes.origins || contributes.integration) {
    throw new PublicationError(
      'OVERPRIVILEGED_CAPABILITIES',
      '发布包不得声明 filesystem、origins 或 integration。',
    );
  }
  if (contributes.panel.entry !== PANEL_ENTRY) {
    throw new PublicationError(
      'PANEL_ENTRY_MISMATCH',
      `panel.entry 必须是 ${PANEL_ENTRY}。`,
    );
  }
  if (contributes.service.entry !== SERVICE_ENTRY) {
    throw new PublicationError(
      'SERVICE_ENTRY_MISMATCH',
      `service.entry 必须是 ${SERVICE_ENTRY}。`,
    );
  }
}

export function createPublicationManifest(packageJson) {
  const manifest = {
    name: packageJson.name,
    version: packageJson.version,
    license: packageJson.license || 'MIT',
    openchamber: packageJson.openchamber,
  };
  // The SDK service helper emits ESM for `service/main.js`. Keep the root
  // module type so Node can load that built entry from the installed package.
  if (packageJson.type === 'module') manifest.type = 'module';
  if (packageJson.description) manifest.description = packageJson.description;
  return manifest;
}

export async function fileInfo(rootDir, relativePath) {
  const absolute = resolve(rootDir, relativePath);
  const link = await lstat(absolute).catch(() => null);
  if (!link) {
    throw new PublicationError('MISSING_FILE', `缺少发布所需文件：${relativePath}`);
  }
  if (link.isSymbolicLink()) {
    throw new PublicationError('SYMLINK_FORBIDDEN', `发布文件不能是符号链接：${relativePath}`);
  }
  if (!link.isFile()) {
    throw new PublicationError('NOT_A_FILE', `发布路径不是普通文件：${relativePath}`);
  }
  if (link.size === 0) {
    throw new PublicationError('EMPTY_FILE', `发布文件为空：${relativePath}`);
  }
  return { absolute, size: link.size };
}

async function validatePanelIndex(rootDir) {
  const info = await fileInfo(rootDir, PANEL_ENTRY);
  const html = await readFile(info.absolute, 'utf8');
  if (!/<script[^>]+src=["']\.\/main\.js["'][^>]*>\s*<\/script>/i.test(html)) {
    throw new PublicationError('PANEL_SCRIPT_MISSING', 'panel/index.html 未加载 ./main.js。');
  }
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) {
    throw new PublicationError('PANEL_INLINE_SCRIPT', 'panel/index.html 不得包含内联脚本。');
  }
  if (/(?:src|href)=["']https?:/i.test(html)) {
    throw new PublicationError('REMOTE_ASSET', 'panel/index.html 不得引用远程脚本、样式或资源。');
  }
  return html;
}

async function validatePanelBundle(rootDir) {
  const info = await fileInfo(rootDir, 'integrations/openchamber/panel/main.js');
  const text = await readFile(info.absolute, 'utf8');
  verifyPanelBundle(text);
  if (/localStorage\s*\./.test(text)) {
    throw new PublicationError('LOCAL_STORAGE_DEMO', '面板 bundle 不得以 localStorage 模拟任务状态。');
  }
  return text;
}

async function validateServiceBundle(rootDir) {
  const info = await fileInfo(rootDir, SERVICE_ENTRY);
  const text = await readFile(info.absolute, 'utf8');
  verifyServiceBundle(text);
  return text;
}

async function validateThirdPartyNotices(rootDir, packageJson) {
  const info = await fileInfo(rootDir, 'THIRD_PARTY_NOTICES');
  const text = await readFile(info.absolute, 'utf8');
  const sdkVersion = packageJson.devDependencies['@openchamber/sdk'];
  const esbuildVersion = packageJson.devDependencies.esbuild;
  const required = [
    ['@openchamber/sdk version', `## @openchamber/sdk ${sdkVersion}`],
    ['esbuild version', `## esbuild ${esbuildVersion}`],
    ['OpenChamber SDK copyright', 'Bohdan Triapitsyn'],
    ['esbuild copyright', 'Evan Wallace'],
  ];
  for (const [label, token] of required) {
    if (!text.includes(token)) {
      throw new PublicationError('THIRD_PARTY_NOTICE_INCOMPLETE', `THIRD_PARTY_NOTICES 缺少 ${label}。`);
    }
  }
  if ((text.match(/MIT License/g) ?? []).length < 2) {
    throw new PublicationError(
      'THIRD_PARTY_LICENSE_TEXT_MISSING',
      'THIRD_PARTY_NOTICES 必须包含完整的第三方许可证文本，不能只写名称。',
    );
  }
  return text;
}

async function validateServiceImports(rootDir, serviceEntry, packagedPaths) {
  const absolute = resolve(rootDir, serviceEntry);
  const source = await readFile(absolute, 'utf8');
  const specifiers = new Set();
  const patterns = [
    /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  }
  for (const specifier of specifiers) {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;
    const candidates = [resolve(dirname(absolute), specifier)];
    if (!/\.[a-z0-9]+$/i.test(specifier)) candidates.push(`${candidates[0]}.js`);
    let found = null;
    for (const candidate of candidates) {
      const rel = relative(rootDir, candidate);
      if (rel.startsWith('..') || resolve(rootDir, rel) !== candidate) {
        throw new PublicationError(
          'SERVICE_IMPORT_OUTSIDE_PACKAGE',
          `service 的相对导入越出包目录：${specifier}`,
        );
      }
      const info = await lstat(candidate).catch(() => null);
      if (info?.isFile()) {
        found = rel.replaceAll('\\', '/');
        break;
      }
    }
    if (!found) {
      throw new PublicationError(
        'SERVICE_IMPORT_MISSING',
        `service 的相对导入不存在：${specifier}`,
      );
    }
    if (!packagedPaths.has(found)) {
      throw new PublicationError(
        'SERVICE_IMPORT_NOT_PACKAGED',
        `service 引用了未在白名单中的文件：${found}。请把 service 打包成单文件，或将该精确路径加入 RUNTIME_FILES。`,
      );
    }
  }
}

const SECRET_PATTERNS = Object.freeze([
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
]);

async function scanPublicationSecrets(files) {
  for (const file of files) {
    if (file.path === 'LICENSE') continue;
    const text = await readFile(file.absolute, 'utf8');
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(text)) {
        throw new PublicationError(
          'SECRET_IN_PUBLICATION',
          `发布白名单文件疑似包含凭证或私钥：${file.path}`,
        );
      }
    }
  }
}

function outputPaths(manifest) {
  return [
    ...RUNTIME_FILES,
    manifest.contributes.service.entry,
  ];
}

export async function collectPublicationFiles({ rootDir = ROOT } = {}) {
  const loaded = await loadRootPackage(rootDir);
  validateLeastPrivilege(loaded.manifest);
  const paths = outputPaths(loaded.manifest);
  const forbidden = findForbiddenPaths(paths);
  if (forbidden.length > 0) {
    throw new PublicationError(
      'FORBIDDEN_PUBLICATION_PATH',
      `发布白名单包含禁止路径：${forbidden.join(', ')}`,
    );
  }
  const files = [];
  for (const relativePath of paths) {
    const info = await fileInfo(rootDir, relativePath);
    files.push({ path: relativePath, ...info });
  }
  const manifest = createPublicationManifest(loaded.packageJson);
  return {
    rootDir,
    packageJson: loaded.packageJson,
    manifest,
    manifestText: `${JSON.stringify(manifest, null, 2)}\n`,
    files,
    paths,
  };
}

export async function checkPublication({ rootDir = ROOT } = {}) {
  const errors = [];
  let plan = null;
  try {
    plan = await collectPublicationFiles({ rootDir });
  } catch (error) {
    return {
      ok: false,
      errors: [formatPublicationError(error)],
      files: [],
      plan: null,
    };
  }
  try {
    await validatePanelIndex(rootDir);
    await validatePanelBundle(rootDir);
    await validateThirdPartyNotices(rootDir, plan.packageJson);
    const serviceEntry = plan.manifest.openchamber.contributes.service.entry;
    const serviceInfo = await stat(resolve(rootDir, serviceEntry));
    if (!serviceInfo.isFile()) {
      errors.push('service entry 不是普通文件。');
    }
    await validateServiceImports(rootDir, serviceEntry, new Set(plan.paths));
    await validateServiceBundle(rootDir);
    await scanPublicationSecrets(plan.files);
  } catch (error) {
    errors.push(formatPublicationError(error));
  }
  if (plan.paths.includes('package.json')) {
    errors.push('生成包不能直接打包根 package.json，需使用裁剪后的运行时 manifest。');
  }
  return { ok: errors.length === 0, errors, files: plan.files, plan };
}

function formatPublicationError(error) {
  if (error instanceof PublicationError) return `[${error.code}] ${error.message}`;
  return error?.message ?? String(error);
}

export async function createOpenChamberPackage({ rootDir = ROOT, outDir = resolve(ROOT, 'artifacts') } = {}) {
  // Fail closed before creating any output. No service means no "usable" zip.
  const report = await checkPublication({ rootDir });
  if (!report.ok) {
    throw new PublicationError(
      'PUBLICATION_CHECK_FAILED',
      `发布检查失败，未生成 ZIP：\n${report.errors.map((line) => `- ${line}`).join('\n')}`,
      report,
    );
  }
  const zipPath = resolve(outDir, `application-copilot-openchamber-v${report.plan.packageJson.version}.zip`);
  const entries = [
    { name: 'package.json', data: report.plan.manifestText },
  ];
  for (const file of report.files) {
    entries.push({ name: file.path, data: await readFile(file.absolute) });
  }
  const result = await writeZipFile(zipPath, entries);
  return { ...result, report };
}

async function main() {
  try {
    const result = await createOpenChamberPackage();
    const outputPath = relative(ROOT, result.outfile).replaceAll('\\', '/');
    console.log(`Packaged ${outputPath} (${result.bytes} bytes, ${result.entries} entries).`);
    console.log('Allowed files:');
    for (const file of result.report.files) console.log(`  ${file.path}`);
    console.log('  package.json (runtime manifest generated from root package.json)');
  } catch (error) {
    console.error(error instanceof PublicationError ? error.message : error.stack);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main();
}
