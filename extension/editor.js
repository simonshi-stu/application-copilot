import { KINDS, splitDrafts, reviseBlock, approveBlock, textForCopy } from './blocks.js';

const KEY = 'applicationCopilot.blocks.v1';
const $ = id => document.getElementById(id);
const extensionStorage = globalThis.chrome?.storage?.local;
let blocks = [];
let storageQueue = Promise.resolve();

function notify(message) { $('status').textContent = message; }

function persist() {
  const snapshot = structuredClone(blocks);
  // Serialize writes so rapid edits cannot restore an older version.
  const write = storageQueue.then(async () => {
    if (extensionStorage) await extensionStorage.set({ [KEY]: snapshot });
    else localStorage.setItem(KEY, JSON.stringify(snapshot));
  });
  storageQueue = write.catch(() => {});
  return write;
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function labeled(text, control) {
  control.setAttribute('aria-label', text);
  const label = element('label', text);
  label.append(control);
  return label;
}

function render() {
  $('blocks').replaceChildren();
  $('empty').hidden = blocks.length > 0;
  for (const block of blocks) {
    const card = element('article', undefined, 'block');
    const heading = element('div', undefined, 'section-heading');
    heading.append(element('h3', block.item || '未命名经历'));
    const badge = element('span', block.approved ? '已确认原文' : '草稿 · 不可复制', 'badge');
    heading.append(badge);
    card.append(heading);

    const item = element('input'); item.type = 'text'; item.value = block.item;
    const kind = element('select');
    for (const [value, name] of Object.entries(KINDS)) {
      const option = element('option', name); option.value = value; kind.append(option);
    }
    kind.value = block.kind;
    const fields = element('div', undefined, 'fields');
    fields.append(labeled('所属公司／项目', item), labeled('目标栏目', kind));
    card.append(fields);

    const text = element('textarea'); text.rows = 7; text.value = block.text;
    card.append(labeled('由本人编辑的待确认文本（保留空行）', text));
    const counter = element('p', `${block.text.length} 字符（UTF-16）`, 'counter');
    card.append(counter);
    const original = element('details');
    original.append(element('summary', '查看最初拆分原文'), element('pre', block.originalText));
    card.append(original);

    const confirmed = element('input'); confirmed.type = 'checkbox';
    card.append(labeled('我已核对所属经历、栏目及全文，允许原样复制', confirmed));
    const actions = element('div', undefined, 'actions');
    const approve = element('button', '确认并保存'); approve.type = 'button';
    const copy = element('button', '复制确认原文'); copy.type = 'button'; copy.disabled = !block.approved;
    const limit = element('input'); limit.type = 'number'; limit.min = '1'; limit.step = '1'; limit.placeholder = '可不填';
    const remove = element('button', '删除此块', 'danger'); remove.type = 'button';
    actions.append(approve, copy, labeled('网站字符上限', limit), remove);
    card.append(actions);

    function changed(patch) {
      Object.assign(block, reviseBlock(block, patch));
      confirmed.checked = false; copy.disabled = true;
      badge.textContent = '草稿 · 不可复制';
      heading.querySelector('h3').textContent = block.item || '未命名经历';
      counter.textContent = `${block.text.length} 字符（UTF-16）`;
      persist().catch(() => notify('本地保存失败，请勿关闭页面。'));
    }
    item.addEventListener('input', () => changed({ item: item.value }));
    kind.addEventListener('change', () => changed({ kind: kind.value }));
    text.addEventListener('input', () => changed({ text: text.value }));
    approve.addEventListener('click', async () => {
      try {
        if (!confirmed.checked) throw new Error('请先勾选本人核对确认。');
        Object.assign(block, approveBlock(block));
        await persist();
        // Edits during the save must not re-enable copying a draft.
        copy.disabled = !block.approved;
        badge.textContent = block.approved ? '已确认原文' : '草稿 · 不可复制';
        notify(block.approved ? '已在本地保存确认文本，复制时不会改写。' : '已修改，请重新确认。');
      } catch (error) {
        Object.assign(block, reviseBlock(block, {}));
        copy.disabled = true; badge.textContent = '草稿 · 不可复制';
        notify(error.message);
      }
    });
    copy.addEventListener('click', async () => {
      try {
        const value = textForCopy(block, { maxLength: limit.value === '' ? null : Number(limit.value) });
        await navigator.clipboard.writeText(value);
        notify('已原文复制；请粘贴到对应栏目并核对，不代提交。');
      } catch (error) { notify(error.message); }
    });
    remove.addEventListener('click', async () => {
      if (!confirm('删除此块及其本地确认文本？')) return;
      blocks = blocks.filter(candidate => candidate.id !== block.id);
      try { await persist(); render(); notify('已删除此块。'); }
      catch { notify('删除未保存成功，请重试。'); }
    });
    $('blocks').append(card);
  }
}

$('split').addEventListener('click', async () => {
  const drafts = splitDrafts($('source').value);
  if (!drafts.length) return notify('请先粘贴文本。');
  blocks.push(...drafts);
  try {
    await persist(); $('source').value = ''; render();
    notify(`已追加 ${drafts.length} 块草稿，请手动分类并核对；没有生成新文案。`);
  } catch { render(); notify('本地保存失败，草稿仍在当前页。'); }
});

$('file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (!/\.(txt|md)$/i.test(file.name)) throw new Error('仅支持 TXT / Markdown。');
    if (file.size > 2 * 1024 * 1024) throw new Error('文本文件过大，请使用不超过 2 MB 的文件。');
    $('source').value = await file.text();
    notify('文字已在本页载入，尚未拆分或确认。');
  } catch (error) { notify(error.message); }
  event.target.value = '';
});

$('clear').addEventListener('click', async () => {
  if (!confirm('清空本扩展的全部本地段落？此操作不可恢复，不会清除系统剪贴板。')) return;
  blocks = [];
  try { await persist(); $('source').value = ''; render(); notify('本地段落库已清空。'); }
  catch { render(); notify('清空未保存成功，请重试。'); }
});

try {
  const saved = extensionStorage ? (await extensionStorage.get(KEY))[KEY] : JSON.parse(localStorage.getItem(KEY) || '[]');
  if (saved !== undefined && !Array.isArray(saved)) throw new Error('本地资料格式异常。');
  blocks = (saved || []).map(block => {
    if (!block || typeof block.id !== 'string' || typeof block.text !== 'string' || typeof block.item !== 'string'
      || typeof block.originalText !== 'string' || !Object.hasOwn(KINDS, block.kind)) {
      throw new Error('本地段落格式异常，不自动覆盖。');
    }
    try { textForCopy(block); return block; }
    catch { return reviseBlock(block, {}); }
  });
  render();
} catch (error) {
  $('split').disabled = true;
  notify(`${error.message} 已禁用追加以免覆盖，请核查存储或明确选择清空。`);
}
