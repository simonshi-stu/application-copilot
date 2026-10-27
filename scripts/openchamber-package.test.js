import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PublicationError,
  RUNTIME_FILES,
  checkPublication,
  collectPublicationFiles,
  createOpenChamberPackage,
  findForbiddenPaths,
  isForbiddenPath,
} from './package-openchamber.mjs';
import { readStoredZip } from './zip-writer.mjs';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const fixtureBase = resolve(repositoryRoot, '.cache', 'openchamber-package-tests');

function fixtureManifest(version = '9.9.9') {
  return {
    name: 'fixture-openchamber',
    version,
    license: 'MIT',
    private: true,
    type: 'module',
    scripts: { test: 'echo do-not-ship' },
    devDependencies: { '@openchamber/sdk': '2.3.2', esbuild: '0.28.2' },
    openchamber: {
      apiVersion: 1,
      engines: { openchamber: '>=2.3.2' },
      contributes: {
        panel: {
          id: 'fixture-panel',
          name: 'Fixture panel',
          icon: 'window',
          entry: 'integrations/openchamber/panel/index.html',
        },
        page: true,
        service: {
          entry: 'integrations/openchamber/service/main.js',
          runtime: 'host',
        },
      },
    },
  };
}

function fakeBundle() {
  return `/*! fixture */\n(()=>{${'void 0;'.repeat(180)}})();\n`;
}

function fakeServiceBundle() {
  return `// fictional fixture service; never executed\nimport http from "node:http";\nvoid http;\n${'// padding\n'.repeat(120)}`;
}

const notices = `# Third-party notices

## @openchamber/sdk 2.3.2
MIT License
Copyright (c) 2025 Bohdan Triapitsyn

## esbuild 0.28.2
MIT License
Copyright (c) 2020 Evan Wallace
`;

async function createFixture({ service = true, decoys = true } = {}) {
  await mkdir(fixtureBase, { recursive: true });
  const root = await mkdtemp(join(fixtureBase, 'fixture-'));
  const files = {
    'package.json': `${JSON.stringify(fixtureManifest(), null, 2)}\n`,
    LICENSE: 'MIT License\n\nCopyright (c) fixture\n',
    'THIRD_PARTY_NOTICES': notices,
    'integrations/openchamber/panel/index.html':
      '<!doctype html><html><body><div id="app"></div><script src="./main.js"></script></body></html>\n',
    'integrations/openchamber/panel/main.js': fakeBundle(),
    'integrations/openchamber/panel/styles.css': 'body { margin: 0; }\n',
    'integrations/openchamber/service/main.js': fakeServiceBundle(),
  };
  if (service) {
    // service is included in files above; no-op keeps fixture shape explicit.
  } else {
    delete files['integrations/openchamber/service/main.js'];
  }
  if (decoys) {
    files['private/secret.txt'] = 'fictional private data, must not ship\n';
    files['.cache/cache.txt'] = 'fictional cache\n';
    files['artifacts/log.txt'] = 'fictional log\n';
    files['node_modules/pkg/index.js'] = 'module.exports = 1;\n';
    files['screenshots/shot.png'] = 'fictional png\n';
    files['docs/plan.md'] = '# fictional docs\n';
    files['extension/editor.js'] = '// fictional existing extension\n';
    files['.env'] = 'FICTIONAL_SECRET=do-not-ship\n';
    files['package-lock.json'] = '{}\n';
    files['AGENTS.md'] = '# fictional agent instructions\n';
  }
  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = resolve(root, relativePath);
    await mkdir(resolve(absolute, '..'), { recursive: true });
    await writeFile(absolute, content, 'utf8');
  }
  return root;
}

test('publication allowlist is explicit and never recursive', async (t) => {
  const root = await createFixture();
  t.after(async () => rm(root, { recursive: true, force: true }));
  const plan = await collectPublicationFiles({ rootDir: root });
  const expected = [
    ...RUNTIME_FILES,
    'integrations/openchamber/service/main.js',
  ];
  assert.deepEqual(plan.paths, expected);
  assert.deepEqual(plan.files.map((file) => file.path), expected);
  assert.equal(plan.paths.includes('package.json'), false);
  assert.equal(plan.paths.includes('private/secret.txt'), false);
  assert.equal(plan.paths.includes('node_modules/pkg/index.js'), false);
  assert.equal(plan.paths.includes('package-lock.json'), false);
  assert.equal(plan.manifest.devDependencies, undefined);
  assert.equal(plan.manifest.scripts, undefined);
  assert.equal(plan.manifest.private, undefined);
  assert.equal(plan.manifest.openchamber.contributes.service.runtime, 'host');
});

test('forbidden paths cover private data, caches, logs and credentials', () => {
  const forbidden = findForbiddenPaths([
    'private/resume.json',
    '.cache/sdk-reference/package.json',
    'artifacts/screenshot.png',
    'node_modules/x/index.js',
    'docs/ARCHITECTURE.md',
    'extension/editor.js',
    'test/core-workflow.test.js',
    'screenshots/shot.png',
    'logs/run.log',
    '.env.local',
    'id_ed25519',
    'secrets/key.pem',
    'resume.pdf',
    'package-lock.json',
  ]);
  assert.equal(forbidden.length, 14);
  assert.equal(isForbiddenPath('integrations/openchamber/panel/main.js'), false);
  assert.equal(isForbiddenPath('THIRD_PARTY_NOTICES'), false);
  assert.equal(isForbiddenPath('private/real-resume.docx'), true);
  assert.equal(isForbiddenPath('artifacts/application-copilot-openchamber-v0.4.0.zip'), true);
});

test('missing service fails closed before any zip is produced', async (t) => {
  const root = await createFixture({ service: false });
  t.after(async () => rm(root, { recursive: true, force: true }));
  const check = await checkPublication({ rootDir: root });
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((line) => line.includes('service/main.js')));
  const outDir = resolve(root, 'generated-artifacts');
  await assert.rejects(
    () => createOpenChamberPackage({ rootDir: root, outDir }),
    (error) =>
      error instanceof PublicationError &&
      error.code === 'PUBLICATION_CHECK_FAILED' &&
      /未生成 ZIP/.test(error.message),
  );
  await assert.rejects(() => access(outDir), (error) => error.code === 'ENOENT');
});

test('complete fixture builds a deterministic whitelist zip with a sanitized manifest', async (t) => {
  const root = await createFixture();
  t.after(async () => rm(root, { recursive: true, force: true }));
  const outDir = resolve(root, 'generated-artifacts');
  const result = await createOpenChamberPackage({ rootDir: root, outDir });
  assert.ok(result.bytes > 0);
  const zip = readStoredZip(await readFile(result.outfile));
  const names = [...zip.keys()].sort();
  assert.deepEqual(
    names,
    [
      'LICENSE',
      'THIRD_PARTY_NOTICES',
      'integrations/openchamber/panel/index.html',
      'integrations/openchamber/panel/main.js',
      'integrations/openchamber/panel/styles.css',
      'integrations/openchamber/service/main.js',
      'package.json',
    ].sort(),
  );
  assert.equal(names.some((name) => name.startsWith('private/')), false);
  assert.equal(names.some((name) => name.startsWith('node_modules/')), false);
  assert.equal(names.some((name) => name.startsWith('artifacts/')), false);
  assert.equal(names.some((name) => name.endsWith('.log')), false);
  assert.equal(names.some((name) => name.endsWith('.png')), false);
  const packaged = JSON.parse(zip.get('package.json').toString('utf8'));
  assert.equal(packaged.version, '9.9.9');
  assert.equal(packaged.devDependencies, undefined);
  assert.equal(packaged.scripts, undefined);
  assert.equal(packaged.private, undefined);
  assert.equal(packaged.type, 'module');
  assert.equal(packaged.openchamber.contributes.panel.entry, 'integrations/openchamber/panel/index.html');
  assert.equal(
    packaged.openchamber.contributes.service.entry,
    'integrations/openchamber/service/main.js',
  );
  assert.equal(
    packaged.openchamber.contributes.service.runtime,
    'host',
  );
  assert.equal(packaged.openchamber.contributes.capabilities, undefined);
  assert.equal(zip.get('THIRD_PARTY_NOTICES').toString('utf8').includes('Evan Wallace'), true);
});

test('a panel bundle containing a local-storage demo is rejected', async (t) => {
  const root = await createFixture();
  t.after(async () => rm(root, { recursive: true, force: true }));
  await writeFile(
    resolve(root, 'integrations/openchamber/panel/main.js'),
    `/*! fixture */\n(()=>{window.localStorage.setItem('demo','1');${'void 0;'.repeat(220)}})();\n`,
    'utf8',
  );
  const check = await checkPublication({ rootDir: root });
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((line) => line.includes('localStorage')));
});

test('a credential-looking value in a whitelist file is rejected', async (t) => {
  const root = await createFixture();
  t.after(async () => rm(root, { recursive: true, force: true }));
  await writeFile(
    resolve(root, 'integrations/openchamber/service/main.js'),
    `import http from "node:http";\nvoid http;\nconst key = "AKIAABCDEFGHIJKLMNOP";\nexport { key };\n${'// padding\n'.repeat(120)}`,
    'utf8',
  );
  const check = await checkPublication({ rootDir: root });
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((line) => line.includes('SECRET_IN_PUBLICATION')));
});

test('an unbundled service import outside the allowlist fails closed', async (t) => {
  const root = await createFixture();
  t.after(async () => rm(root, { recursive: true, force: true }));
  await mkdir(resolve(root, 'integrations/openchamber'), { recursive: true });
  await writeFile(
    resolve(root, 'integrations/openchamber/contract.js'),
    'export const CONTRACT_VERSION = 1;\n',
    'utf8',
  );
  await writeFile(
    resolve(root, 'integrations/openchamber/service/main.js'),
    "import { CONTRACT_VERSION } from '../contract.js';\nconsole.log(CONTRACT_VERSION);\n",
    'utf8',
  );
  const check = await checkPublication({ rootDir: root });
  assert.equal(check.ok, false);
  assert.ok(
    check.errors.some(
      (line) => line.includes('SERVICE_IMPORT_NOT_PACKAGED') && line.includes('contract.js'),
    ),
  );
});
