import test from 'node:test';
import assert from 'node:assert/strict';

// 仅使用内存假存储；不读取真实扩展数据。

function fakeChromeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]));
    },
    async set(values) {
      Object.assign(data, values);
    },
  };
}

let version = 0;
async function loadFreshStorage() {
  version += 1;
  return import(`../extension/storage.js?storage-test=${version}`);
}

test('chrome 写入使用完整 KEYS，读取兼容旧短键且不删除旧数据', async t => {
  const legacyBlocks = [{ id: 'legacy', text: '旧段落', item: '示例', originalText: '旧段落', kind: 'other', approved: false }];
  const storage = fakeChromeStorage({
    blocks: legacyBlocks,
    facts: [{ id: 'old-fact', label: '姓名', value: '旧值' }],
  });
  const originalChrome = globalThis.chrome;
  globalThis.chrome = { storage: { local: storage } };
  t.after(() => {
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
  });

  const { KEYS, loadAll, saveAll } = await loadFreshStorage();
  const loaded = await loadAll();
  assert.deepEqual(loaded.blocks, legacyBlocks);
  assert.deepEqual(loaded.facts, [{ id: 'old-fact', label: '姓名', value: '旧值' }]);

  const nextBlocks = [{ id: 'new', text: '新段落', item: '示例', originalText: '新段落', kind: 'other', approved: false }];
  await saveAll({ blocks: nextBlocks, facts: [], companies: [], aliases: {}, companiesUnknown: [] });

  assert.deepEqual(storage.data[KEYS.blocks], nextBlocks);
  assert.deepEqual(storage.data[KEYS.facts], []);
  assert.deepEqual(storage.data.blocks, legacyBlocks);
  assert.deepEqual(storage.data.facts, [{ id: 'old-fact', label: '姓名', value: '旧值' }]);

  const reloaded = await loadAll();
  assert.deepEqual(reloaded.blocks, nextBlocks);
  assert.deepEqual(reloaded.facts, []);
});

test('localStorage 回退同样兼容旧短键且新写入使用 KEYS', async t => {
  const data = new Map([
    ['blocks', JSON.stringify([{ id: 'legacy' }])],
  ]);
  const localStorage = {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, value); },
    removeItem(key) { data.delete(key); },
  };
  const originalChrome = globalThis.chrome;
  const originalLocalStorage = globalThis.localStorage;
  delete globalThis.chrome;
  globalThis.localStorage = localStorage;
  t.after(() => {
    if (originalChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = originalChrome;
    if (originalLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalLocalStorage;
  });

  const { KEYS, loadAll, saveAll } = await loadFreshStorage();
  assert.deepEqual((await loadAll()).blocks, [{ id: 'legacy' }]);

  await saveAll({ blocks: [{ id: 'new' }], facts: [], companies: [], aliases: {}, companiesUnknown: [] });
  assert.equal(data.get(KEYS.blocks), JSON.stringify([{ id: 'new' }]));
  assert.equal(data.get('blocks'), JSON.stringify([{ id: 'legacy' }]));
  assert.deepEqual(JSON.parse(data.get(KEYS.facts)), []);
});
