import { KINDS, splitDrafts, reviseBlock, approveBlock, textForCopy } from './blocks.js';
import { parseResume, resumeBlocks, validateResume } from './resume-parser.js';
import { extractDocx } from './docx.js';
import { parseCompanies, companyKey } from './company-parser.js';
import { COMPANY_TYPES, classifyCompany, setType } from './company-classifier.js';
import { buildFieldCard, profileSummaryFromResume } from './field-cards.js';

const KEY = 'applicationCopilot.blocks.v1';
const PROFILE_KEY = 'applicationCopilot.resume.v1';
const COMPANIES_KEY = 'applicationCopilot.companies.v1';
const ALIASES_KEY = 'applicationCopilot.companyAliases.v1';
const $ = id => document.getElementById(id);
const extensionStorage = globalThis.chrome?.storage?.local;
let blocks = [];
let profile = null;
let companies = [];
let aliases = {};
let sourceName = '粘贴文本';
let storageQueue = Promise.resolve();

function notify(message) { $('status').textContent = message; }

function persist() {
  const snapshot = structuredClone(blocks);
  const profileSnapshot = structuredClone(profile);
  const companiesSnapshot = structuredClone(companies);
  const aliasesSnapshot = structuredClone(aliases);
  // Serialize writes so rapid edits cannot restore an older version.
  const write = storageQueue.then(async () => {
    if (extensionStorage) {
      await extensionStorage.set({ [KEY]: snapshot, [PROFILE_KEY]: profileSnapshot, [COMPANIES_KEY]: companiesSnapshot, [ALIASES_KEY]: aliasesSnapshot });
    } else {
      localStorage.setItem(KEY, JSON.stringify(snapshot));
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profileSnapshot));
      localStorage.setItem(COMPANIES_KEY, JSON.stringify(companiesSnapshot));
      localStorage.setItem(ALIASES_KEY, JSON.stringify(aliasesSnapshot));
    }
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

function renderProfile() {
  $('profile-section').hidden = !profile;
  $('profile').replaceChildren();
  if (!profile) return;
  const counts = `${profile.education.length} 段教育 · ${profile.internships.length} 段实习 · ${profile.projects.length} 个项目`;
  $('profile').append(element('p', counts, 'badge'));
  function inputField(container, title, value, changed) {
    const input = element('input'); input.type = 'text'; input.value = value || '';
    input.addEventListener('input', () => { changed(input.value); persist().catch(() => notify('本地保存失败。')); });
    container.append(labeled(title, input));
  }
  const personal = element('details'); personal.open = true;
  personal.append(element('summary', '个人信息'));
  const fields = element('div', undefined, 'fields');
  for (const [key, label] of Object.entries({ name: '姓名', phone: '电话', email: '邮箱', github: 'GitHub', intent: '求职意向' })) {
    inputField(fields, label, profile.personal[key], value => { profile.personal[key] = value; });
  }
  personal.append(fields); $('profile').append(personal);
  for (const [key, title] of [['education', '教育'], ['internships', '实习'], ['projects', '项目']]) {
    for (const entry of profile[key]) {
      const detail = element('details');
      const summary = element('summary', `${title}：${entry.name}`); detail.append(summary);
      const metadata = element('div', undefined, 'fields');
      for (const [field, label] of [['name', key === 'internships' ? '实习公司' : key === 'projects' ? '项目名称' : '学校'], ['location', '地点'], ['role', '岗位（未写明则留空）']]) {
        inputField(metadata, label, entry[field], value => {
          entry[field] = value;
          summary.textContent = `${title}：${entry.name}`;
          blocks = blocks.map(block => block.resumeProfileId === profile.id && block.resumeEntryId === entry.id
            ? reviseBlock(block, { item: entry.name }) : block);
          render();
        });
      }
      if (key === 'education') inputField(metadata, '专业原文', entry.major, value => { entry.major = value; });
      inputField(metadata, '开始月份（YYYY-MM）', entry.dates.start, value => { entry.dates.start = value || null; });
      inputField(metadata, '结束月份（进行中保留空白）', entry.dates.end, value => { entry.dates.end = value || null; });
      detail.append(metadata, element('p', `原日期：${entry.dates.raw || '未识别'}${entry.dates.ongoing ? ' · 进行中' : ''}`, 'hint'));
      if (Array.isArray(entry.honors) && entry.honors.length) detail.append(element('p', `学术荣誉：${entry.honors.join('；')}`));
      detail.append(element('p', '解析正文（布局重建，未确认）'), element('pre', entry.content));
      for (const warning of entry.warnings) detail.append(element('p', warning, 'hint'));
      if (entry.candidates) {
        detail.append(element('p', `项目候选 · ${entry.candidates.method} · 未确认`, 'badge'));
        detail.append(element('p', '候选简述'), element('pre', entry.candidates.summary.text));
        detail.append(element('p', '候选职责'), element('pre', entry.candidates.responsibilities.text));
        detail.append(element('p', '基于原文摘取或推导，不自动认定全部工作由本人独立完成；加入段落库后可修改或替换。', 'hint'));
      }
      const original = element('details'); original.append(element('summary', '查看标题原文'), element('pre', entry.rawHeader)); detail.append(original);
      $('profile').append(detail);
    }
  }
  for (const [key, title] of [['skills', '个人技能'], ['language', '语言与荣誉'], ['evaluation', '个人评价']]) {
    const detail = element('details'); detail.append(element('summary', title), element('pre', profile[key].join('\n\n') || '简历未提供，不自动生成。')); $('profile').append(detail);
  }
  for (const warning of profile.warnings) $('profile').append(element('p', warning, 'hint'));
  const original = element('details'); original.append(element('summary', '查看完整提取原文'), element('pre', profile.source.text)); $('profile').append(original);
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
    if (block.provenance) card.append(element('p', `来源：${block.provenance}；${block.sourceName || '本地简历'}。确认前仅为候选。`, 'hint'));

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

function showTab(name) {
  const blocksActive = name === 'blocks';
  $('panel-blocks').hidden = !blocksActive;
  $('panel-companies').hidden = blocksActive;
  $('tab-blocks').classList.toggle('active', blocksActive);
  $('tab-companies').classList.toggle('active', !blocksActive);
  $('tab-blocks').setAttribute('aria-pressed', String(blocksActive));
  $('tab-companies').setAttribute('aria-pressed', String(!blocksActive));
}

function applyClassification(entry) {
  entry.type = classifyCompany(entry, { aliases });
}

function renderCompanies() {
  const list = $('company-list');
  list.replaceChildren();
  $('companies-empty').hidden = companies.length > 0;
  for (const entry of companies) {
    const card = element('article', undefined, 'block');
    const heading = element('div', undefined, 'section-heading');
    const title = element('h3', entry.company || '未命名条目');
    const badge = element('span', '', 'badge');
    heading.append(title, badge);
    card.append(heading);
    const typeInfo = entry.type || { type: 'other', confidence: 0.2, reasons: [] };
    badge.textContent = `${COMPANY_TYPES[typeInfo.type] || COMPANY_TYPES.other} · 置信 ${Math.round((typeInfo.confidence ?? 0) * 100)}%`;
    const meta = [`识别依据：${(typeInfo.reasons || []).join('；') || '无'}`];
    if (entry.platform && entry.platform !== 'none') meta.push(`平台：${entry.platform}`);
    if (entry.batch) meta.push(`批次：${entry.batch}`);
    if (entry.deadline) meta.push(entry.deadline);
    card.append(element('p', meta.join(' ｜ '), 'hint'));

    const fields = element('div', undefined, 'fields');
    const nameInput = element('input'); nameInput.type = 'text'; nameInput.value = entry.company;
    nameInput.addEventListener('input', () => {
      entry.company = nameInput.value;
      title.textContent = entry.company || '未命名条目';
      persist().catch(() => notify('本地保存失败。'));
    });
    const typeSelect = element('select');
    for (const [value, label] of Object.entries(COMPANY_TYPES)) {
      const option = element('option', label); option.value = value; typeSelect.append(option);
    }
    typeSelect.value = typeInfo.type;
    typeSelect.addEventListener('change', () => {
      entry.type = setType(entry, typeSelect.value, aliases);
      persist().then(() => { renderCompanies(); notify('类型已更新，并记住你的选择（仅本机）。'); })
        .catch(() => notify('本地保存失败。'));
    });
    fields.append(labeled('公司名（可改）', nameInput), labeled('类型（可改）', typeSelect));
    card.append(fields);

    const linksArea = element('textarea'); linksArea.rows = Math.max(2, entry.links.length);
    linksArea.value = entry.links.map(link => link.url).join('\n');
    linksArea.addEventListener('input', () => {
      const previous = entry.links;
      entry.links = linksArea.value.split('\n').map(url => url.trim()).filter(Boolean)
        .map((url, index) => ({ url, kind: previous[index]?.kind || 'apply' }));
      persist().catch(() => notify('本地保存失败。'));
    });
    card.append(labeled('链接（每行一个，可改）', linksArea));

    if (entry.referral?.conflict && entry.referral.candidates.length > 1) {
      card.append(element('p', `⚠ 检测到多个不同内推码：${entry.referral.candidates.join(' / ')}——待人工核实，未自动选定。`, 'conflict'));
    }
    const codeRow = element('div', undefined, 'fields');
    const codeInput = element('input'); codeInput.type = 'text'; codeInput.value = entry.referral?.code || '';
    codeInput.addEventListener('input', () => {
      const value = codeInput.value.trim();
      entry.referral = { ...(entry.referral || {}), code: value, conflict: false, verified: false, candidates: value ? [value] : [] };
      persist().catch(() => notify('本地保存失败。'));
    });
    const channelInput = element('input'); channelInput.type = 'text'; channelInput.value = entry.channelHint || '';
    channelInput.addEventListener('input', () => {
      entry.channelHint = channelInput.value;
      persist().catch(() => notify('本地保存失败。'));
    });
    codeRow.append(labeled('内推码（没有可留空）', codeInput), labeled('渠道提示', channelInput));
    card.append(codeRow);

    const fieldCard = buildFieldCard(typeInfo.type, profileSummaryFromResume(profile));
    card.append(element('p', `需你补充：${fieldCard.ask.join('、') || '无'}`, 'entry-line'));
    const reuse = element('details');
    reuse.append(element('summary', `将直接复用（${fieldCard.reuse.length} 项）`), element('p', fieldCard.reuse.join('、')));
    const verify = element('details');
    verify.append(element('summary', `需官网核实（${fieldCard.verify.length} 项）`), element('p', fieldCard.verify.join('、') || '无'));
    const raw = element('details');
    raw.append(element('summary', '查看原文'), element('pre', entry.rawSource));
    card.append(reuse, verify, raw);
    for (const warning of entry.warnings || []) card.append(element('p', warning, 'hint'));

    const actions = element('div', undefined, 'actions');
    const remove = element('button', '删除此条', 'danger'); remove.type = 'button';
    remove.addEventListener('click', async () => {
      if (!confirm('删除此公司条目？')) return;
      companies = companies.filter(candidate => candidate.id !== entry.id);
      try { await persist(); renderCompanies(); notify('已删除。'); }
      catch { notify('删除未保存成功，请重试。'); }
    });
    actions.append(remove);
    card.append(actions);
    list.append(card);
  }
}

$('tab-blocks').addEventListener('click', () => showTab('blocks'));
$('tab-companies').addEventListener('click', () => showTab('companies'));

$('parse-companies').addEventListener('click', async () => {
  try {
    const { entries, skipped } = parseCompanies($('company-source').value);
    if (!entries.length) throw new Error('没有解析到公司条目，请检查粘贴内容。');
    const existing = new Set(companies.map(companyKey));
    let added = 0; let duplicate = 0;
    for (const entry of entries) {
      if (existing.has(companyKey(entry))) { duplicate++; continue; }
      applyClassification(entry);
      companies.push(entry);
      existing.add(companyKey(entry));
      added++;
    }
    await persist(); renderCompanies();
    notify(`解析出 ${entries.length} 家公司：新增 ${added} 条${duplicate ? `，跳过重复 ${duplicate} 条` : ''}${skipped ? `，忽略说明文字 ${skipped} 段` : ''}。请核对并修改。`);
  } catch (error) { notify(error.message); }
});
$('clear-company-source').addEventListener('click', () => { $('company-source').value = ''; });
$('clear-companies').addEventListener('click', async () => {
  if (!confirm('清空全部公司与清单条目？此操作不可恢复。')) return;
  companies = [];
  try { await persist(); renderCompanies(); notify('清单已清空。'); }
  catch { notify('清空未保存成功，请重试。'); }
});
$('export-companies').addEventListener('click', () => {
  if (!companies.length) return notify('清单为空，没有可导出的内容。');
  const payload = { schema: 'application-copilot.companies.v1', exportedAt: new Date().toISOString(), companies };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = element('a'); link.href = url; link.download = 'companies.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('已导出本地 JSON；文件可能包含你的内推信息，请勿公开分享。');
});
$('import-companies').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 4 * 1024 * 1024) throw new Error('文件过大。');
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data?.companies;
    if (!Array.isArray(list)) throw new Error('不是有效的公司清单 JSON。');
    const existing = new Set(companies.map(companyKey));
    let added = 0;
    for (const raw of list) {
      if (!raw || typeof raw.company !== 'string' || !Array.isArray(raw.links)) continue;
      const entry = {
        id: typeof raw.id === 'string' ? raw.id : crypto.randomUUID(),
        company: raw.company,
        links: raw.links.filter(link => link && typeof link.url === 'string').map(link => ({ url: link.url, kind: link.kind || 'apply' })),
        platform: typeof raw.platform === 'string' ? raw.platform : 'none',
        referral: raw.referral && typeof raw.referral === 'object'
          ? { code: String(raw.referral.code || ''), candidates: Array.isArray(raw.referral.candidates) ? raw.referral.candidates.map(String) : [], conflict: Boolean(raw.referral.conflict), type: String(raw.referral.type || 'unknown'), verified: Boolean(raw.referral.verified) }
          : { code: '', candidates: [], conflict: false, type: 'none', verified: false },
        channelHint: typeof raw.channelHint === 'string' ? raw.channelHint : '',
        batch: typeof raw.batch === 'string' ? raw.batch : '',
        deadline: typeof raw.deadline === 'string' ? raw.deadline : '',
        warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String) : [],
        status: 'new',
        rawSource: typeof raw.rawSource === 'string' ? raw.rawSource : '',
      };
      if (existing.has(companyKey(entry))) continue;
      if (raw.type && typeof raw.type === 'object' && Object.hasOwn(COMPANY_TYPES, raw.type.type)) entry.type = raw.type;
      else applyClassification(entry);
      companies.push(entry); existing.add(companyKey(entry)); added++;
    }
    await persist(); renderCompanies();
    notify(`已导入 ${added} 条；重复或无效条目已跳过。`);
  } catch (error) { notify(error.message); }
});

$('split').addEventListener('click', async () => {
  const drafts = splitDrafts($('source').value);
  if (!drafts.length) return notify('请先粘贴文本。');
  blocks.push(...drafts);
  try {
    await persist(); $('source').value = ''; render();
    notify(`已追加 ${drafts.length} 块草稿，请手动分类并核对；没有生成新文案。`);
  } catch { render(); notify('本地保存失败，草稿仍在当前页。'); }
});

$('source').addEventListener('input', () => { sourceName = '粘贴文本'; });
$('parse').addEventListener('click', async () => {
  try {
    if (profile && !confirm('替换当前结构化解析结果？已有段落库不会删除，仍需逐块确认。')) return;
    const next = validateResume(parseResume($('source').value, { sourceName }));
    profile = next; await persist(); renderProfile();
    notify(`已识别 ${profile.internships.length} 段实习、${profile.projects.length} 个项目；请检查字段，尚未加入段落库。`);
  } catch (error) { notify(error.message); }
});
$('add-profile').addEventListener('click', async () => {
  try {
    if (!profile) throw new Error('请先解析或导入结构化简历。');
    if (blocks.some(block => block.resumeProfileId === profile.id) && !confirm('这份简历已有段落，仍要追加另一份草稿吗？')) return;
    const drafts = resumeBlocks(profile, { includeCandidates: $('include-candidates').checked });
    blocks.push(...drafts); await persist(); render();
    notify(`已追加 ${drafts.length} 块待确认正文；公司、地点、岗位不会混入正文。`);
  } catch (error) { notify(error.message); }
});
$('export-profile').addEventListener('click', () => {
  if (!profile) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' }));
  const link = element('a'); link.href = url; link.download = 'resume-parsed.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('已发起本地导出，文件含个人资料，请勿提交 Git 或公开分享。');
});

$('file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (!/\.(txt|md|docx|json)$/i.test(file.name)) throw new Error('支持 DOCX／TXT／MD／本工具 JSON；PDF 请粘贴已提取文本。');
    if (file.size > (/\.docx$/i.test(file.name) ? 10 : 4) * 1024 * 1024) throw new Error('文件过大。');
    if (/\.json$/i.test(file.name)) {
      const next = validateResume(JSON.parse(await file.text()));
      if (profile && !confirm('替换当前结构化解析结果？已有段落库保留。')) return;
      profile = next; await persist(); renderProfile();
      notify('已导入结构化简历，全部保持未确认。');
    } else {
      $('source').value = /\.docx$/i.test(file.name) ? await extractDocx(new Uint8Array(await file.arrayBuffer())) : await file.text();
      sourceName = file.name;
      notify('已在本地提取文字，请点击自动解析简历区域；尚未确认。');
    }
  } catch (error) { notify(error.message); }
  event.target.value = '';
});

$('clear').addEventListener('click', async () => {
  if (!confirm('清空本扩展的全部段落及结构化简历？此操作不可恢复，不会清除系统剪贴板或导出文件。')) return;
  blocks = []; profile = null;
  try {
    await persist(); $('source').value = ''; render(); renderProfile();
    for (const id of ['split', 'parse', 'add-profile', 'file']) $(id).disabled = false;
    notify('本地资料已清空。');
  }
  catch { render(); notify('清空未保存成功，请重试。'); }
});

try {
  const saved = extensionStorage ? (await extensionStorage.get(KEY))[KEY] : JSON.parse(localStorage.getItem(KEY) || '[]');
  const savedProfile = extensionStorage ? (await extensionStorage.get(PROFILE_KEY))[PROFILE_KEY] : JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
  profile = savedProfile ? validateResume(savedProfile) : null;
  if (saved !== undefined && !Array.isArray(saved)) throw new Error('本地资料格式异常。');
  blocks = (saved || []).map(block => {
    if (!block || typeof block.id !== 'string' || typeof block.text !== 'string' || typeof block.item !== 'string'
      || typeof block.originalText !== 'string' || !Object.hasOwn(KINDS, block.kind)) {
      throw new Error('本地段落格式异常，不自动覆盖。');
    }
    try { textForCopy(block); return block; }
    catch { return reviseBlock(block, {}); }
  });
  render(); renderProfile();
  const savedCompanies = extensionStorage ? (await extensionStorage.get(COMPANIES_KEY))[COMPANIES_KEY] : JSON.parse(localStorage.getItem(COMPANIES_KEY) || '[]');
  const savedAliases = extensionStorage ? (await extensionStorage.get(ALIASES_KEY))[ALIASES_KEY] : JSON.parse(localStorage.getItem(ALIASES_KEY) || '{}');
  if (savedCompanies !== undefined && !Array.isArray(savedCompanies)) throw new Error('本地清单格式异常。');
  companies = (savedCompanies || []).map(entry => {
    if (!entry || typeof entry.id !== 'string' || typeof entry.company !== 'string'
      || !Array.isArray(entry.links) || typeof entry.rawSource !== 'string') {
      throw new Error('本地清单条目格式异常，不自动覆盖。');
    }
    return entry;
  });
  aliases = (savedAliases && typeof savedAliases === 'object' && !Array.isArray(savedAliases)) ? savedAliases : {};
  renderCompanies();
} catch (error) {
  for (const id of ['split', 'parse', 'add-profile', 'file', 'parse-companies', 'import-companies', 'export-companies']) {
    if ($(id)) $(id).disabled = true;
  }
  notify(`${error.message} 已禁用追加以免覆盖，请核查存储或明确选择清空。`);
}
