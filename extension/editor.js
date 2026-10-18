import { KINDS, splitDrafts, reviseBlock, approveBlock, textForCopy } from './blocks.js';
import { parseResume, resumeBlocks, validateResume } from './resume-parser.js';
import { extractDocx } from './docx.js';
import { parseCompanies, companyKey } from './company-parser.js';
import { INDUSTRIES, NATURES, classifyCompany, setIndustry } from './company-classifier.js';
import { buildFieldCard } from './field-cards.js';
import { factsFromResume, makeFact, validateFacts } from './profile-facts.js';
import { STAGES, STAGE_FLOW, buildReviewSheet } from './review-sheet.js';
import { computeFlowSteps } from './flow-steps.js';
import { buildQaReport } from './qa-report.js';
import { KEYS, loadAll, saveAll, migrateCompanies } from './storage.js';

const $ = id => document.getElementById(id);
let blocks = [];
let profile = null;
let companies = [];
let companiesUnknown = [];
let aliases = {};
let facts = [];
let sourceName = '粘贴文本';
let selectedCompanyId = null;
let companyFilter = { text: '', status: 'all' };
let persistBusy = Promise.resolve();

function notify(message) { $('status').textContent = message; }

function setSaveState(text, kind) {
  const node = $('save-state');
  if (!node) return;
  node.textContent = text;
  node.classList.toggle('saving', kind === 'saving');
  node.classList.toggle('error', kind === 'error');
}

function persistedLabel() {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
  return `草稿已自动保存 · ${time}`;
}

function persist() {
  // Serialize writes so rapid edits cannot restore an older version.
  setSaveState('保存中…', 'saving');
  const write = persistBusy.then(() => saveAll({ blocks, profile, companies, aliases, companiesUnknown, facts }));
  persistBusy = write.catch(() => {});
  return write.then(
    result => { setSaveState(persistedLabel(), 'saved'); return result; },
    error => { setSaveState('保存失败，请勿关闭页面', 'error'); throw error; },
  );
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

function renderFacts() {
  const list = $('fact-list');
  list.replaceChildren();
  if (!facts.length) {
    list.append(element('p', '还没有资料字段。可以点下方按钮新增，或从已解析简历导入。', 'hint'));
    return;
  }
  for (const fact of facts) {
    const row = element('div', undefined, 'fact-row');
    const label = element('input'); label.type = 'text'; label.value = fact.label; label.placeholder = '字段名';
    label.addEventListener('input', () => { fact.label = label.value; persist().catch(() => notify('本地保存失败。')); });
    const value = element('input'); value.type = 'text'; value.value = fact.value; value.placeholder = '内容';
    value.addEventListener('input', () => { fact.value = value.value; persist().catch(() => notify('本地保存失败。')); });
    const confirmed = fact.status === 'confirmed';
    const status = element('button', confirmed ? '已确认' : '待确认', `button-mini ${confirmed ? '' : 'secondary'}`.trim());
    status.type = 'button';
    status.addEventListener('click', async () => {
      fact.status = confirmed ? 'unconfirmed' : 'confirmed';
      try {
        await persist(); renderFacts();
        notify(fact.status === 'confirmed'
          ? '已确认该字段；公司信息卡会将其计入「已确认可复用」。'
          : '已取消确认，字段回到「已识别待确认」。');
      } catch { notify('保存失败，请重试。'); }
    });
    const remove = element('button', '删除', 'button-mini danger'); remove.type = 'button';
    remove.addEventListener('click', async () => {
      if (!confirm(`删除字段「${fact.label || '未命名'}」？`)) return;
      facts = facts.filter(item => item.id !== fact.id);
      try { await persist(); renderFacts(); } catch { notify('删除未保存成功。'); }
    });
    row.append(label, value, element('span', fact.source === 'resume' ? '简历导入' : '手动', 'badge source'), status, remove);
    list.append(row);
  }
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

const PANELS = { companies: 'panel-companies', profile: 'panel-profile', blocks: 'panel-blocks' };

function showTab(name) {
  for (const [key, id] of Object.entries(PANELS)) {
    const active = key === name;
    $(id).hidden = !active;
    const button = $(`tab-${key}`);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function toStoredIndustry(result) {
  return {
    value: result.industry,
    source: result.source,
    reasons: Array.isArray(result.reasons) ? result.reasons : [],
    alternatives: Array.isArray(result.alternatives) ? result.alternatives : [],
    matchLevel: result.matchLevel || 'none',
  };
}

function applyClassification(entry) {
  entry.industry = toStoredIndustry(classifyCompany(entry, { aliases }));
}

function reviewLabel(entry) {
  if (entry.review === 'confirmed') return { text: '已人工确认', cls: 'ok' };
  if (entry.review === 'needs_review') return { text: '待核对', cls: 'warn' };
  return { text: '草稿', cls: '' };
}

function refreshDetailState(entry) {
  const badge = document.querySelector('#company-detail .detail-head .badge');
  if (!badge) return;
  const state = reviewLabel(entry);
  badge.textContent = state.text;
  badge.className = `badge ${state.cls}`.trim();
}

function entryHasIssues(entry) {
  return Boolean((entry.warnings && entry.warnings.length) || entry.referral?.conflict || !entry.company);
}

function unansweredAsks(entry) {
  const ask = buildFieldCard(entry.industry?.value || 'other', { profile, blocks, facts }).ask;
  return ask.filter(item => !String(entry.answers?.[item] || '').trim()).length;
}

function nextAction(entry) {
  if (!entry.company) return '补充公司名';
  if (!entry.links || !entry.links.length) return '补充链接';
  if (entry.referral?.conflict && !entry.referral?.selected) return '选择内推码';
  const unanswered = unansweredAsks(entry);
  if (unanswered) return `补充公司信息（${unanswered} 项）`;
  if (entry.review !== 'confirmed') return '核对并确认';
  const stage = entry.stage || 'todo';
  if ((stage === 'todo' || stage === 'preparing') && entry.sheetCopiedAt) return '等待本人提交';
  return STAGE_FLOW[stage] || '生成送审单';
}

function buildFlow(entry) {
  const flow = element('div', undefined, 'flow');
  const steps = computeFlowSteps(entry, { unanswered: unansweredAsks(entry) });
  const stepper = element('ol', undefined, 'steps');
  for (const step of steps) {
    const item = element('li', undefined, `step step-${step.state}`);
    item.append(element('span', '', 'step-dot'), element('span', step.label, 'step-label'));
    stepper.append(item);
  }
  flow.append(element('p', '准备流程', 'card-title'), stepper);
  const cta = element('button', `下一步：${nextAction(entry)}`, 'flow-cta');
  cta.type = 'button';
  cta.addEventListener('click', () => runNextAction(entry));
  flow.append(cta);
  return flow;
}

function refreshFlow(entry) {
  const container = document.querySelector('#company-detail .flow');
  if (container) container.replaceWith(buildFlow(entry));
}

function focusInDetail(selector) {
  const target = document.querySelector(`#company-detail ${selector}`);
  if (!target) return;
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  target.classList.add('flash');
  setTimeout(() => target.classList.remove('flash'), 1400);
  if (typeof target.focus === 'function') target.focus({ preventScroll: true });
}

function runNextAction(entry) {
  const action = nextAction(entry);
  if (action.startsWith('补充公司名')) return focusInDetail('[data-field="name"]');
  if (action.startsWith('补充链接')) return focusInDetail('[data-field="links"]');
  if (action.startsWith('选择内推码')) return focusInDetail('.ref-box');
  if (action.startsWith('补充公司信息')) {
    const inputs = Array.from(document.querySelectorAll('#company-detail .ask-input'));
    const target = inputs.find(input => !input.value.trim()) || inputs[0];
    if (!target) return;
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.add('flash');
    setTimeout(() => target.classList.remove('flash'), 1400);
    target.focus({ preventScroll: true });
    return;
  }
  if (action === '核对并确认') return focusInDetail('#detail-confirm');
  if (action === '生成送审单') {
    document.querySelector('#company-detail [data-action="sheet"]')?.click();
    return;
  }
  return focusInDetail('#detail-stage');
}

function touchEntry(entry) {
  if (entry.review === 'confirmed') entry.review = 'needs_review';
}

function renderCompanyRows() {
  const tbody = $('company-rows');
  tbody.replaceChildren();
  const text = companyFilter.text.trim().toLowerCase();
  const visible = companies.filter(entry => {
    if (text && !(entry.company || '').toLowerCase().includes(text)) return false;
    if (companyFilter.status === 'issues') return entryHasIssues(entry);
    if (companyFilter.status !== 'all' && entry.review !== companyFilter.status) return false;
    return true;
  });
  $('companies-count').textContent = `${visible.length} / ${companies.length} 条`;
  renderCompanyStats();
  $('companies-empty').hidden = companies.length > 0;
  for (const entry of visible) {
    const row = element('tr');
    row.dataset.companyId = entry.id;
    if (entry.id === selectedCompanyId) row.classList.add('selected');
    row.tabIndex = 0;
    const nameCell = element('td');
    if (entryHasIssues(entry)) nameCell.append(element('span', '⚠ ', 'row-flag'));
    nameCell.append(entry.company || '（未命名）');
    row.append(nameCell);
    row.append(element('td', entry.industry ? (INDUSTRIES[entry.industry.value] || INDUSTRIES.other) : '未判定'));
    const state = reviewLabel(entry);
    const stateCell = element('td'); stateCell.append(element('span', state.text, `badge ${state.cls}`.trim())); row.append(stateCell);
    const action = nextAction(entry);
    row.append(element('td', action, /补充|选择/.test(action) ? 'next-blocking' : 'next'));
    const select = () => {
      selectedCompanyId = entry.id;
      renderCompanies();
      $('company-workbench').classList.add('show-detail');
    };
    row.addEventListener('click', select);
    row.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); }
    });
    tbody.append(row);
  }
}

function renderCompanyDetail() {
  const pane = $('company-detail');
  pane.replaceChildren();
  const entry = companies.find(item => item.id === selectedCompanyId);
  if (!entry) {
    pane.append(element('p', '从列表选择一家公司，查看详情与信息卡。', 'hint'));
    return;
  }

  const head = element('div', undefined, 'detail-head');
  const back = element('button', '← 返回列表', 'secondary detail-back'); back.type = 'button';
  back.addEventListener('click', () => { $('company-workbench').classList.remove('show-detail'); });
  const title = element('h3', entry.company || '（未命名条目）');
  const state = reviewLabel(entry);
  head.append(back, title, element('span', state.text, `badge ${state.cls}`.trim()));
  pane.append(head);

  pane.append(buildFlow(entry));

  function touch() { touchEntry(entry); refreshDetailState(entry); }
  function saved() { persist().then(() => { renderCompanyRows(); }).catch(() => notify('本地保存失败，请勿关闭页面。')); }

  const basics = element('div', undefined, 'fields');
  const nameInput = element('input'); nameInput.type = 'text'; nameInput.value = entry.company;
  nameInput.dataset.field = 'name';
  nameInput.addEventListener('input', () => {
    entry.company = nameInput.value;
    touch(); title.textContent = entry.company || '（未命名条目）'; saved();
  });
  const industrySelect = element('select');
  const blank = element('option', '未判定'); blank.value = '';
  industrySelect.append(blank);
  for (const [value, label] of Object.entries(INDUSTRIES)) {
    const option = element('option', label); option.value = value; industrySelect.append(option);
  }
  industrySelect.value = entry.industry ? entry.industry.value : '';
  industrySelect.addEventListener('change', () => {
    if (!industrySelect.value) { entry.industry = null; touch(); saved(); return; }
    entry.industry = toStoredIndustry(setIndustry(entry, industrySelect.value, aliases));
    touch(); saved();
    notify('行业已更新，并记住你的选择（仅本机）。');
  });
  const natureSelect = element('select');
  for (const [value, label] of Object.entries(NATURES)) {
    const option = element('option', label); option.value = value; natureSelect.append(option);
  }
  natureSelect.value = entry.nature || 'unknown';
  natureSelect.addEventListener('change', () => { entry.nature = natureSelect.value; touch(); saved(); });
  const directionInput = element('input'); directionInput.type = 'text'; directionInput.value = entry.direction || '';
  directionInput.placeholder = '如：开发／数据／产品／运营';
  directionInput.addEventListener('input', () => { entry.direction = directionInput.value; touch(); saved(); });
  const stageSelect = element('select');
  for (const [value, stageLabel] of Object.entries(STAGES)) {
    const option = element('option', stageLabel); option.value = value; stageSelect.append(option);
  }
  stageSelect.value = entry.stage || 'todo';
  stageSelect.id = 'detail-stage';
  stageSelect.addEventListener('change', () => {
    const from = entry.stage || 'todo';
    const to = stageSelect.value;
    entry.stage = to;
    if (from !== to) {
      entry.history = Array.isArray(entry.history) ? entry.history : [];
      entry.history.push({ at: new Date().toISOString(), from, to });
      entry.history = entry.history.slice(-50);
    }
    saved();
    renderCompanyDetail();
  });
  basics.append(labeled('公司名（可改）', nameInput), labeled('行业建议（可改）', industrySelect), labeled('企业性质', natureSelect), labeled('岗位方向（自填）', directionInput), labeled('进度（手动更新）', stageSelect));
  pane.append(basics);

  const appFields = element('div', undefined, 'fields');
  const refInput = element('input'); refInput.type = 'text'; refInput.value = entry.applicationRef || '';
  refInput.placeholder = '如官方岗位ID / 申请号（仅本机记录）';
  refInput.addEventListener('input', () => { entry.applicationRef = refInput.value; touch(); saved(); });
  const appliedInput = element('input'); appliedInput.type = 'date'; appliedInput.value = entry.appliedAt || '';
  appliedInput.addEventListener('input', () => { entry.appliedAt = appliedInput.value; touch(); saved(); });
  appFields.append(labeled('申请号 / 岗位ID（本机记录）', refInput), labeled('提交日期（本人填写）', appliedInput));
  pane.append(appFields);

  if (entry.industry) {
    const info = [`判断依据：${(entry.industry.reasons || []).join('；') || '无'}`];
    info.push(entry.industry.source === 'user' ? '来源：你选择'
      : entry.industry.source === 'learned' ? '来源：已记住的选择' : '来源：本地规则建议');
    const alternatives = entry.industry.alternatives || [];
    if (alternatives.length) {
      info.push(`备选：${alternatives.map(item => `${INDUSTRIES[item.industry] || item.industry}`).join('、')}（点上方下拉可改）`);
    }
    pane.append(element('p', info.join(' ｜ '), 'hint'));
  }

  const linksArea = element('textarea'); linksArea.rows = Math.max(2, entry.links.length);
  linksArea.classList.add('mono');
  linksArea.dataset.field = 'links';
  linksArea.value = entry.links.map(link => link.url).join('\n');
  linksArea.addEventListener('input', () => {
    const previous = entry.links;
    entry.links = linksArea.value.split('\n').map(url => url.trim()).filter(Boolean)
      .map((url, index) => ({ url, kind: previous[index]?.kind || 'apply' }));
    touch(); saved();
  });
  pane.append(labeled('链接（每行一个，可改）', linksArea));

  const referral = entry.referral;
  const refBox = element('div', undefined, 'ref-box');
  if (referral?.legacyAutoValue && !referral.selected) {
    refBox.append(element('p', `旧版曾自动填入 ${referral.legacyAutoValue}，不代表已选定，请核对下方候选。`, 'hint'));
  }
  if (referral && referral.candidates.length) {
    refBox.append(element('p', referral.conflict
      ? '⚠ 检测到多个不同内推码，请自行选择（不自动选定）：'
      : '内推码候选（选择后仍须在官网核实是否真正绑定）：'));
    const options = element('div', undefined, 'ref-options');
    const makeChoice = (value, label) => {
      const input = element('input'); input.type = 'radio'; input.name = `ref-${entry.id}`; input.value = value;
      input.checked = (referral.selected || '') === value;
      input.addEventListener('change', () => { referral.selected = value; touch(); saved(); refreshFlow(entry); });
      const wrap = element('label');
      wrap.append(input, value && value !== 'none' ? element('span', label, 'mono') : label);
      return wrap;
    };
    for (const code of referral.candidates) options.append(makeChoice(code, code));
    options.append(makeChoice('none', '本次不用内推'));
    refBox.append(options);
  } else {
    refBox.append(element('p', '未识别到内推码；没有内推码可以留空，不影响建档。', 'hint'));
  }
  const bindLabel = element('label');
  const bindInput = element('input'); bindInput.type = 'checkbox'; bindInput.checked = Boolean(referral?.bindingVerified);
  bindInput.addEventListener('change', () => { referral.bindingVerified = bindInput.checked; saved(); });
  bindLabel.append(bindInput, '已在官网确认内推绑定（链接携带不等于已绑定）');
  refBox.append(bindLabel);
  pane.append(refBox);

  const channelInput = element('input'); channelInput.type = 'text'; channelInput.value = entry.channelHint || '';
  channelInput.addEventListener('input', () => { entry.channelHint = channelInput.value; touch(); saved(); });
  pane.append(labeled('渠道提示', channelInput));
  const notesArea = element('textarea'); notesArea.rows = 2;
  notesArea.placeholder = '仅本机记录：沟通情况、材料版本、待跟进事项…';
  notesArea.value = entry.notes || '';
  notesArea.addEventListener('input', () => { entry.notes = notesArea.value; touch(); saved(); });
  pane.append(labeled('备注（仅本机）', notesArea));
  const metaLine = [];
  if (entry.platform && entry.platform !== 'none') metaLine.push(`平台：${entry.platform}`);
  if (entry.batch) metaLine.push(`批次：${entry.batch}`);
  if (entry.deadline) metaLine.push(entry.deadline);
  if (metaLine.length) pane.append(element('p', metaLine.join(' ｜ '), 'hint'));

  if (Array.isArray(entry.history) && entry.history.length) {
    const historyBox = element('details');
    historyBox.append(element('summary', `进度记录（${entry.history.length}）`));
    const ul = element('ul');
    for (const step of entry.history.slice(-20).reverse()) {
      const at = step.at ? step.at.slice(0, 16).replace('T', ' ') : '时间未知';
      ul.append(element('li', `${at} · ${STAGES[step.from] || step.from || '—'} → ${STAGES[step.to] || step.to}`));
    }
    historyBox.append(ul);
    pane.append(historyBox);
  }

  const cardData = buildFieldCard(entry.industry?.value || 'other', { profile, blocks, facts });
  const card = element('div', undefined, 'field-card');
  card.append(element('h4', '信息卡'));
  const group = (titleText, items, fallback, className) => {
    const box = element('div', undefined, className);
    box.append(element('p', titleText, 'card-title'));
    if (items.length) {
      const ul = element('ul');
      for (const item of items) ul.append(element('li', item));
      box.append(ul);
    } else {
      box.append(element('p', fallback, 'hint'));
    }
    return box;
  };
  card.append(group('已确认可复用', cardData.reuse, '暂无已确认内容：只有「段落库」里确认过的段落才会出现在这里。', 'fc-group fc-reuse'));
  card.append(group('已识别待确认', cardData.pending, '尚未导入结构化简历；解析结果不会自动视为可复用。', 'fc-group fc-pending'));
  const answeredCount = cardData.ask.filter(item => String(entry.answers?.[item] || '').trim()).length;
  const askBox = element('div', undefined, 'fc-group fc-ask');
  askBox.append(element('p', `待本人补充（逐公司确认 ${answeredCount}/${cardData.ask.length}）`, 'card-title'));
  if (cardData.ask.length) {
    for (const item of cardData.ask) {
      const input = element('input'); input.type = 'text'; input.value = entry.answers?.[item] || '';
      input.classList.add('ask-input');
      input.addEventListener('input', () => {
        entry.answers = entry.answers || {};
        entry.answers[item] = input.value;
        touch();
        refreshRowNext(entry);
        refreshFlow(entry);
        persist().catch(() => notify('本地保存失败，请勿关闭页面。'));
      });
      askBox.append(labeled(item, input));
    }
    askBox.append(element('p', '这些回答只用于本公司与本批次，不会跨公司复用。', 'hint'));
  } else {
    askBox.append(element('p', '该行业无固定补充项。', 'hint'));
  }
  card.append(askBox);
  card.append(group('需官网核实', cardData.verify, '无', 'fc-group fc-verify'));
  if (cardData.possible.length) {
    const possible = element('details');
    possible.append(element('summary', `部分单位可能要求（${cardData.possible.length} 项，不会提前收集）`));
    const ul = element('ul');
    for (const item of cardData.possible) ul.append(element('li', item));
    possible.append(ul, element('p', '这些字段以实际申请表为准；本工具不会主动提前收集敏感信息。', 'hint'));
    card.append(possible);
  }
  pane.append(card);

  for (const warning of entry.warnings || []) pane.append(element('p', warning, 'conflict'));

  const raw = element('details');
  raw.append(element('summary', '查看原文'), element('pre', entry.rawSource || '（无原文）'));
  pane.append(raw);

  const actions = element('div', undefined, 'actions');
  const confirmButton = element('button', '标记为已人工核对'); confirmButton.type = 'button';
  confirmButton.id = 'detail-confirm';
  confirmButton.addEventListener('click', async () => {
    entry.review = 'confirmed';
    refreshDetailState(entry);
    refreshFlow(entry);
    try {
      await persist(); renderCompanyRows();
      notify('已标记为人工核对（仅本地记录；内推绑定与投递结果仍需官网核验）。');
    } catch { notify('保存失败，请重试。'); }
  });
  const remove = element('button', '删除此条', 'danger'); remove.type = 'button';
  remove.addEventListener('click', async () => {
    if (!confirm('删除此公司条目？')) return;
    companies = companies.filter(candidate => candidate.id !== entry.id);
    selectedCompanyId = companies.length ? companies[0].id : null;
    try { await persist(); renderCompanies(); notify('已删除。'); }
    catch { notify('删除未保存成功，请重试。'); }
  });
  async function copySheet() {
    try {
      const text = buildReviewSheet(entry, { profile, blocks, facts });
      await navigator.clipboard.writeText(text);
      entry.sheetCopiedAt = new Date().toISOString();
      try { await persist(); } catch { notify('送审单已复制，但本地保存失败。'); }
      refreshFlow(entry);
      renderCompanyRows();
      notify('送审单已复制；请按清单在官网核对，最终提交由你本人点击。');
    } catch (error) { notify(`复制失败：${error.message}`); }
  }
  const sheetButton = element('button', '复制送审单', 'secondary'); sheetButton.type = 'button';
  sheetButton.dataset.action = 'sheet';
  sheetButton.addEventListener('click', copySheet);

  const downloadButton = element('button', '下载送审单', 'secondary'); downloadButton.type = 'button';
  downloadButton.addEventListener('click', () => {
    const text = buildReviewSheet(entry, { profile, blocks, facts });
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const link = element('a');
    link.href = url;
    link.download = `送审单-${(entry.company || '未命名').replace(/[\\/:*?"<>|]/g, '-')}.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    entry.sheetCopiedAt = entry.sheetCopiedAt || new Date().toISOString();
    refreshFlow(entry);
    renderCompanyRows();
    persist().catch(() => notify('送审单已下载，但本地保存失败。'));
    notify('已下载送审单 Markdown；提交仍由本人操作。');
  });

  let qaBox = null;
  const qaButton = element('button', '本地自检', 'secondary'); qaButton.type = 'button';
  qaButton.addEventListener('click', () => {
    const report = buildQaReport(entry, { facts, unanswered: unansweredAsks(entry) });
    if (qaBox) qaBox.remove();
    qaBox = element('div', undefined, `qa-box qa-${report.level}`);
    qaBox.append(element('p', report.level === 'ok'
      ? '自检通过：未发现明显问题。'
      : '自检结果：以下条目需要你确认（不会自动修改或提交）。', 'card-title'));
    if (report.items.length) {
      const ul = element('ul');
      for (const item of report.items) ul.append(element('li', `[${item.severity}] ${item.text}`));
      qaBox.append(ul);
    }
    pane.insertBefore(qaBox, actions);
  });
  actions.append(confirmButton, sheetButton, downloadButton, qaButton, remove);
  pane.append(actions);
}

function renderCompanies() {
  renderCompanyRows();
  renderCompanyDetail();
}

// 局部刷新某一行「下一步」，避免输入时整表重绘、丢失焦点。
function refreshRowNext(entry) {
  const row = document.querySelector(`#company-rows tr[data-company-id="${entry.id}"]`);
  if (!row || row.children.length < 4) return;
  const cell = row.children[3];
  const action = nextAction(entry);
  cell.textContent = action;
  cell.className = /补充|选择/.test(action) ? 'next-blocking' : 'next';
}

function renderCompanyStats() {
  const counts = { all: companies.length, needs_review: 0, confirmed: 0, issues: 0 };
  for (const entry of companies) {
    if (entry.review === 'needs_review') counts.needs_review += 1;
    if (entry.review === 'confirmed') counts.confirmed += 1;
    if (entryHasIssues(entry)) counts.issues += 1;
  }
  const targets = { all: 'stat-all', needs_review: 'stat-review', confirmed: 'stat-confirmed', issues: 'stat-issues' };
  for (const [key, id] of Object.entries(targets)) $(id).textContent = counts[key];
  for (const card of document.querySelectorAll('#company-stats .stat-card')) {
    card.classList.toggle('active', card.dataset.status === companyFilter.status);
  }
}

$('tab-blocks').addEventListener('click', () => showTab('blocks'));
$('tab-companies').addEventListener('click', () => showTab('companies'));
$('tab-profile').addEventListener('click', () => showTab('profile'));

$('add-fact').addEventListener('click', async () => {
  facts.push(makeFact('', ''));
  try { await persist(); renderFacts(); } catch { notify('本地保存失败。'); }
});
$('import-facts').addEventListener('click', async () => {
  try {
    if (!profile) throw new Error('请先在「简历与段落」里解析或导入简历，再导入字段。');
    const incoming = factsFromResume(profile)
      .filter(item => !facts.some(fact => fact.label === item.label && fact.value === item.value));
    if (!incoming.length) return notify('没有可新增的字段（可能已导入过）。');
    facts.push(...incoming);
    await persist(); renderFacts();
    notify(`已导入 ${incoming.length} 个字段，全部为「待确认」；请逐项核对后确认。`);
  } catch (error) { notify(error.message); }
});
$('export-facts').addEventListener('click', () => {
  if (!facts.length) return notify('资料库为空，没有可导出的内容。');
  const payload = { schema: 'application-copilot.profileFacts.v1', exportedAt: new Date().toISOString(), facts };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = element('a'); link.href = url; link.download = 'profile-facts.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('已导出资料字段 JSON（可能含未确认字段），请勿公开分享。');
});

$('parse-companies').addEventListener('click', async () => {
  try {
    const { entries, skipped } = parseCompanies($('company-source').value);
    if (!entries.length) throw new Error('没有解析到公司条目，请检查粘贴内容。');
    const existing = new Set(companies.map(companyKey));
    let added = 0; let duplicate = 0; let firstAddedId = null;
    for (const raw of entries) {
      const entry = {
        id: raw.id,
        company: raw.company,
        links: raw.links,
        platform: raw.platform,
        referral: {
          candidates: raw.referral.candidates,
          conflict: raw.referral.conflict,
          type: raw.referral.type,
          selected: '',
          legacyAutoValue: '',
          bindingVerified: false,
        },
        channelHint: raw.channelHint,
        batch: raw.batch,
        deadline: raw.deadline,
        warnings: raw.warnings,
        review: (raw.warnings.length || raw.referral.conflict) ? 'needs_review' : 'draft',
        nature: 'unknown',
        direction: '',
        industry: null,
        answers: {},
        stage: 'todo',
        sheetCopiedAt: '',
        applicationRef: '',
        appliedAt: '',
        notes: '',
        history: [],
        rawSource: raw.rawSource,
      };
      if (existing.has(companyKey(entry))) { duplicate++; continue; }
      applyClassification(entry);
      companies.push(entry);
      existing.add(companyKey(entry));
      if (!firstAddedId) firstAddedId = entry.id;
      added++;
    }
    if (firstAddedId) selectedCompanyId = firstAddedId;
    await persist(); renderCompanies();
    notify(`解析出 ${entries.length} 家公司：新增 ${added} 条${duplicate ? `，跳过重复 ${duplicate} 条` : ''}${skipped ? `，忽略说明文字 ${skipped} 段` : ''}。请逐条核对。`);
  } catch (error) { notify(error.message); }
});
$('clear-company-source').addEventListener('click', () => { $('company-source').value = ''; });
$('clear-companies').addEventListener('click', async () => {
  if (!confirm('清空全部公司与清单条目？此操作不可恢复。')) return;
  companies = []; selectedCompanyId = null;
  try { await persist(); renderCompanies(); notify('清单已清空。'); }
  catch { notify('清空未保存成功，请重试。'); }
});
$('export-companies').addEventListener('click', () => {
  if (!companies.length) return notify('清单为空，没有可导出的内容。');
  const payload = { schema: 'application-copilot.companies.v2', exportedAt: new Date().toISOString(), companies };
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
    const migrated = migrateCompanies(list);
    const existing = new Set(companies.map(companyKey));
    let added = 0;
    for (const entry of migrated.companies) {
      if (existing.has(companyKey(entry))) continue;
      entry.id = crypto.randomUUID();
      // 导入不信任确认与绑定标记，一律重新核对。
      entry.review = 'needs_review';
      if (entry.referral) entry.referral.bindingVerified = false;
      if (!entry.industry) applyClassification(entry);
      companies.push(entry); existing.add(companyKey(entry)); added++;
    }
    if (added && !companies.some(entry => entry.id === selectedCompanyId)) selectedCompanyId = companies[0]?.id || null;
    if (migrated.unknown.length) companiesUnknown = [...companiesUnknown, ...migrated.unknown];
    await persist(); renderCompanies();
    notify(`已导入 ${added} 条（确认与绑定标记已重置，需重新核对）${migrated.unknown.length ? `；${migrated.unknown.length} 条无法识别，已原样保留` : ''}。`);
  } catch (error) { notify(error.message); }
});
$('company-search').addEventListener('input', () => { companyFilter.text = $('company-search').value; renderCompanyRows(); });
$('company-filter').addEventListener('change', () => { companyFilter.status = $('company-filter').value; renderCompanyRows(); });
$('company-stats').addEventListener('click', event => {
  const card = event.target.closest('.stat-card');
  if (!card) return;
  companyFilter.status = card.dataset.status;
  $('company-filter').value = companyFilter.status;
  renderCompanyRows();
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
  const stored = await loadAll();
  profile = stored.profile ? validateResume(stored.profile) : null;
  if (stored.blocks !== undefined && !Array.isArray(stored.blocks)) throw new Error('本地段落库格式异常。');
  blocks = (stored.blocks || []).map(block => {
    if (!block || typeof block.id !== 'string' || typeof block.text !== 'string' || typeof block.item !== 'string'
      || typeof block.originalText !== 'string' || !Object.hasOwn(KINDS, block.kind)) {
      throw new Error('本地段落格式异常，不自动覆盖。');
    }
    try { textForCopy(block); return block; }
    catch { return reviseBlock(block, {}); }
  });
  const migrated = migrateCompanies(stored.companies);
  companies = migrated.companies;
  companiesUnknown = Array.isArray(stored.companiesUnknown) ? stored.companiesUnknown : [];
  if (migrated.unknown.length) companiesUnknown = [...companiesUnknown, ...migrated.unknown];
  aliases = (stored.aliases && typeof stored.aliases === 'object' && !Array.isArray(stored.aliases)) ? stored.aliases : {};
  facts = validateFacts(stored.facts);
  for (const entry of companies) if (!entry.industry) applyClassification(entry);
  selectedCompanyId = companies.length ? companies[0].id : null;
  render(); renderProfile(); renderFacts(); renderCompanies();
  if (migrated.unknown.length) {
    notify(`${migrated.unknown.length} 条旧数据未能识别，已原样保留在本地（不会被覆盖或删除）。`);
  }
} catch (error) {
  for (const id of ['split', 'parse', 'add-profile', 'file', 'parse-companies', 'import-companies', 'export-companies']) {
    if ($(id)) $(id).disabled = true;
  }
  notify(`${error.message} 已禁用追加以免覆盖，请核查存储或明确选择清空。`);
}
