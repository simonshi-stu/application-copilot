import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildOpenChamberPanel,
  buildOpenChamberService,
  verifyPanelBundle,
  verifyServiceBundle,
} from '../scripts/build-openchamber.mjs';
import { checkPublication } from '../scripts/package-openchamber.mjs';

const ROOT_URL = new URL('../', import.meta.url);

test('OpenChamber manifest pins the SDK and host versions', async () => {
  const packageJson = JSON.parse(await readFile(new URL('package.json', ROOT_URL), 'utf8'));
  assert.equal(packageJson.devDependencies['@openchamber/sdk'], '2.3.2');
  assert.equal(packageJson.openchamber.engines.openchamber, '>=2.3.2');
  assert.equal(packageJson.openchamber.contributes.service.entry, 'integrations/openchamber/service/main.js');
  assert.equal(packageJson.type, 'module');
});

test('builds a classic panel IIFE and one self-contained service ESM', async () => {
  const panel = await buildOpenChamberPanel();
  assert.match(panel.text.trimStart(), /^\/\*![\s\S]*?\*\/\s*\(/);
  verifyPanelBundle(panel.text);

  const service = await buildOpenChamberService();
  verifyServiceBundle(service.text);
  assert.match(service.text, /\b(?:from|import)\s*\(?\s*['"]node:/);
  assert.doesNotMatch(service.text, /(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)['"]\.{1,2}\//);
  assert.doesNotMatch(service.text, /sourceMappingURL=/);
});

test('guest action buttons avoid sandbox-native form submission', async () => {
  const html = await readFile(new URL('integrations/openchamber/panel/index.html', ROOT_URL), 'utf8');
  for (const id of [
    'enqueue-button',
    'import-fact-button',
    'defer-company-button',
    'save-fact-button',
    'confirm-skip-button',
  ]) {
    assert.match(html, new RegExp(`<button[^>]+id="${id}"[^>]+type="button"`));
  }
});

test('service verification rejects relative imports and missing bundles fail closed', async () => {
  const source = `import { helper } from '../../../core/index.js';\n${'// padding\n'.repeat(100)}`;
  assert.throws(() => verifyServiceBundle(source), /relative module/);
});

test('publication check passes with the built service bundle and actual SDK notice version', async () => {
  const report = await checkPublication();
  assert.equal(report.ok, true, report.errors.join('\n'));
});
