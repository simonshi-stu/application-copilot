import { build } from 'esbuild';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = resolve(ROOT, 'integrations/openchamber/panel/app.js');
const OUTFILE = resolve(ROOT, 'integrations/openchamber/panel/main.js');
export const HUD_ENTRY = resolve(ROOT, 'integrations/openchamber/hud/app.js');
export const HUD_OUTFILE = resolve(ROOT, 'integrations/openchamber/hud/main.js');
export const SERVICE_ENTRY = resolve(ROOT, 'integrations/openchamber/service/entry.js');
export const SERVICE_OUTFILE = resolve(ROOT, 'integrations/openchamber/service/main.js');

const BANNER = [
  '/*!',
  ' * Application Copilot OpenChamber bundle.',
  ' * Built with esbuild. Third-party notices: THIRD_PARTY_NOTICES.',
  ' */',
].join('\n');

async function writeBundle(outfile, text) {
  await mkdir(dirname(outfile), { recursive: true });
  const temporary = `${outfile}.tmp-${process.pid}`;
  await writeFile(temporary, text, 'utf8');
  await rm(outfile, { force: true });
  await rename(temporary, outfile);
  const info = await stat(outfile);
  return { outfile, bytes: info.size, text };
}

export async function buildOpenChamberPanel({ rootDir = ROOT, minify = true } = {}) {
  const entry = resolve(rootDir, 'integrations/openchamber/panel/app.js');
  const outfile = resolve(rootDir, 'integrations/openchamber/panel/main.js');
  const result = await build({
    entryPoints: [entry],
    absWorkingDir: rootDir,
    outfile,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome110', 'firefox115', 'safari16'],
    minify,
    sourcemap: false,
    legalComments: 'none',
    banner: { js: BANNER },
    write: false,
    logLevel: 'silent',
  });
  if (result.errors.length > 0) {
    throw new Error(result.errors.map((error) => error.text).join('\n'));
  }
  if (result.outputFiles.length !== 1) {
    throw new Error('esbuild produced an unexpected number of output files.');
  }
  const text = result.outputFiles[0].text;
  verifyPanelBundle(text);
  return writeBundle(outfile, text);
}

export async function buildOpenChamberHud({ rootDir = ROOT, minify = true } = {}) {
  const entry = resolve(rootDir, 'integrations/openchamber/hud/app.js');
  const outfile = resolve(rootDir, 'integrations/openchamber/hud/main.js');
  const result = await build({
    entryPoints: [entry],
    absWorkingDir: rootDir,
    outfile,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome110', 'firefox115', 'safari16'],
    minify,
    sourcemap: false,
    legalComments: 'none',
    banner: { js: BANNER },
    write: false,
    logLevel: 'silent',
  });
  if (result.errors.length > 0) {
    throw new Error(result.errors.map((error) => error.text).join('\n'));
  }
  if (result.outputFiles.length !== 1) {
    throw new Error('esbuild produced an unexpected number of HUD output files.');
  }
  const text = result.outputFiles[0].text;
  verifyPanelBundle(text);
  return writeBundle(outfile, text);
}

export async function buildOpenChamberService({ rootDir = ROOT, minify = true } = {}) {
  const entry = resolve(rootDir, 'integrations/openchamber/service/entry.js');
  const outfile = resolve(rootDir, 'integrations/openchamber/service/main.js');
  const result = await build({
    entryPoints: [entry],
    absWorkingDir: rootDir,
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node22'],
    external: ['node:*'],
    minify,
    sourcemap: false,
    legalComments: 'none',
    banner: { js: BANNER },
    write: false,
    logLevel: 'silent',
  });
  if (result.errors.length > 0) {
    throw new Error(result.errors.map((error) => error.text).join('\n'));
  }
  if (result.outputFiles.length !== 1) {
    throw new Error('esbuild produced an unexpected number of output files.');
  }
  const text = result.outputFiles[0].text;
  verifyServiceBundle(text);
  return writeBundle(outfile, text);
}

export function verifyPanelBundle(text) {
  if (typeof text !== 'string' || text.length < 1000) {
    throw new Error('Panel bundle is unexpectedly small.');
  }
  const withoutBanner = text.replace(/^\/\*![\s\S]*?\*\/\s*/, '');
  if (!/^\(\(\)\s*=>|^\(function\s*\(/.test(withoutBanner)) {
    throw new Error('Panel bundle is not a classic IIFE.');
  }
  if (/^\s*(?:import|export)\s/m.test(withoutBanner)) {
    throw new Error('Panel bundle contains ESM syntax; OpenChamber requires a classic script.');
  }
  if (/sourceMappingURL=/.test(text)) {
    throw new Error('Panel bundle must not contain a source map reference.');
  }
  if (text.length > 5_000_000) {
    throw new Error('Panel bundle exceeds the 5 MB safety limit.');
  }
  return true;
}

export function verifyServiceBundle(text) {
  if (typeof text !== 'string' || text.length < 1000) {
    throw new Error('Service bundle is unexpectedly small.');
  }
  if (/sourceMappingURL=/.test(text)) {
    throw new Error('Service bundle must not contain a source map reference.');
  }
  // The packaged service must be one self-contained ESM file. A relative
  // import would mean core or another local module was left unbundled.
  const relativeSpecifier = /(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)['"]\.{1,2}\//;
  if (relativeSpecifier.test(text)) {
    throw new Error('Service bundle still imports a relative module; expected one self-contained file.');
  }
  if (!/\b(?:from|import)\s*\(?\s*['"]node:/.test(text)) {
    throw new Error('Service bundle does not keep Node built-ins external.');
  }
  if (text.length > 10_000_000) {
    throw new Error('Service bundle exceeds the 10 MB safety limit.');
  }
  return true;
}

async function main() {
  const panel = await buildOpenChamberPanel();
  const hud = await buildOpenChamberHud();
  const service = await buildOpenChamberService();
  const panelPath = relative(ROOT, panel.outfile).replaceAll('\\', '/');
  const hudPath = relative(ROOT, hud.outfile).replaceAll('\\', '/');
  const servicePath = relative(ROOT, service.outfile).replaceAll('\\', '/');
  console.log(`Built ${panelPath} (${panel.bytes} bytes, classic IIFE).`);
  console.log(`Built ${hudPath} (${hud.bytes} bytes, classic IIFE).`);
  console.log(`Built ${servicePath} (${service.bytes} bytes, single-file ESM).`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`OpenChamber build failed: ${error.message}`);
    process.exitCode = 1;
  });
}

export { ENTRY, OUTFILE, ROOT };
