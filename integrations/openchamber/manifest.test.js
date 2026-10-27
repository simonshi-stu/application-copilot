import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestedGuestCapabilities } from '@openchamber/sdk';
import { parseManifestJson } from '@openchamber/sdk/schemas';

const root = fileURLToPath(new URL('../..', import.meta.url));
const packagePath = resolve(root, 'package.json');

test('root package is an installable OpenChamber apiVersion 1 extension', async () => {
  const text = await readFile(packagePath, 'utf8');
  const result = parseManifestJson(text);
  assert.equal(result.ok, true, result.ok ? '' : `${result.code}: ${result.message}`);
  const manifest = result.manifest;
  const packageJson = JSON.parse(text);
  // The OpenChamber package version must match the root package version, but
  // tests should not pin an old release number. The Chrome extension manifest
  // is a separate package and is not this OpenChamber bundle.
  assert.equal(result.version, packageJson.version);
  assert.match(packageJson.version, /^\d+\.\d+\.\d+(?:[-+]|$)/);
  assert.equal(manifest.apiVersion, 1);
  assert.equal(
    manifest.engines.openchamber,
    `>=${packageJson.devDependencies['@openchamber/sdk']}`,
  );
  assert.equal(manifest.contributes.panel.id, 'application-copilot');
  assert.equal(manifest.contributes.panel.entry, 'integrations/openchamber/panel/index.html');
  assert.equal(manifest.contributes.page, true);
  assert.equal(
    manifest.contributes.service.entry,
    'integrations/openchamber/service/main.js',
  );
  assert.equal(manifest.contributes.service.runtime, 'host');
  assert.equal(manifest.contributes.service.permissions, undefined);
  assert.equal(manifest.contributes.service.provides, undefined);
  assert.equal(manifest.contributes.service.surface, undefined);
  assert.equal('capabilities' in manifest.contributes, false);
  assert.equal('filesystem' in manifest.contributes, false);
  assert.equal('origins' in manifest.contributes, false);
  assert.equal('integration' in manifest.contributes, false);
});

test('manifest requests only the local service capability', async () => {
  const parsed = JSON.parse(await readFile(packagePath, 'utf8'));
  assert.deepEqual(
    requestedGuestCapabilities(parsed.openchamber.contributes),
    ['service'],
  );
  assert.match(parsed.devDependencies['@openchamber/sdk'], /^\d+\.\d+\.\d+/);
  assert.match(parsed.devDependencies.esbuild, /^\d+\.\d+\.\d+/);
  assert.equal(parsed.scripts.test, 'node --test');
  assert.equal(parsed.scripts.serve, 'node scripts/serve.mjs');
  assert.equal(parsed.scripts['build:openchamber'], 'node scripts/build-openchamber.mjs');
  assert.equal(parsed.scripts['check:publication'], 'node scripts/check-publication.mjs');
});

test('panel entry loads one local classic bundle and no remote asset', async () => {
  const htmlPath = resolve(root, 'integrations/openchamber/panel/index.html');
  const html = await readFile(htmlPath, 'utf8');
  assert.match(html, /<script[^>]+src="\.\/main\.js"[^>]*><\/script>/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.doesNotMatch(html, /(?:src|href)=["']https?:/i);
  assert.doesNotMatch(html, /<button[^>]*>\s*提交官网\s*<\/button>/);
  assert.match(html, /没有“提交官网”按钮/);
});

test('panel source uses the SDK host bridge and local service only', async () => {
  const source = await readFile(resolve(root, 'integrations/openchamber/panel/app.js'), 'utf8');
  assert.match(source, /connectHost\(\)/);
  assert.match(source, /host\.serviceRequest\(/);
  assert.match(source, /请在 OpenChamber 扩展中打开/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /(?:window\.)?localStorage\s*[.(]/);
  assert.doesNotMatch(source, /host\.request\s*\(/);
  assert.doesNotMatch(source, /host\.generate\s*\(/);
  assert.doesNotMatch(source, /host\.prompt\s*\(/);
  assert.doesNotMatch(source, /agent\./);
  assert.doesNotMatch(source, /onSessionLifecycle|onSession\s*\(/);
  assert.match(source, /generation/);
  assert.match(source, /requestSeq/);
  assert.match(source, /confirmedByUser/);
  assert.match(source, /user\.reportSubmitted|COMMAND\.reportSubmitted/);
});

test('built panel bundle is an IIFE and does not ship a source map or demo storage', async () => {
  const bundlePath = resolve(root, 'integrations/openchamber/panel/main.js');
  const info = await stat(bundlePath);
  assert.ok(info.size > 1000);
  const bundle = await readFile(bundlePath, 'utf8');
  const code = bundle.replace(/^\/\*![\s\S]*?\*\/\s*/, '');
  assert.match(code, /^\(\(\)\s*=>|^\(function\s*\(/);
  assert.doesNotMatch(bundle, /sourceMappingURL=/);
  assert.doesNotMatch(bundle, /localStorage\s*\./);
  assert.doesNotMatch(bundle, /\bfetch\s*\(/);
  assert.doesNotMatch(bundle, /XMLHttpRequest|WebSocket|sendBeacon/);
  assert.match(bundle, /application-copilot|connectHost|serviceRequest/);
});
