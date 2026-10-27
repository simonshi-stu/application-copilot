import { KINDS, splitDrafts, reviseBlock, approveBlock, textForCopy } from './blocks.js';
import { parseResume, resumeBlocks, validateResume } from './resume-parser.js';
import { extractDocx } from './docx.js';
import { parseCompanies, companyKey } from './company-parser.js';
import { INDUSTRIES, NATURES, classifyCompany, setIndustry } from './company-classifier.js';
import { buildFieldCard } from './field-cards.js';
import { factsFromResume, makeFact, validateFacts, reviseFact, confirmFact } from './profile-facts.js';
import { STAGES, STAGE_FLOW, buildReviewSheet } from './review-sheet.js';
import { computeFlowSteps } from './flow-steps.js';
import { buildQaReport } from './qa-report.js';
import { buildFillPlan, fillPlanProgress } from './fill-plan.js';
import { DEFAULT_AI_CONFIG, loadAiConfig, saveAiConfig, clearAiConfig } from './ai-config.js';
import { buildReviewPrompt, requestAiReview, describeReviewScope } from './ai-review.js';
import { KEYS, loadAll, saveAll, migrateCompanies } from './storage.js';

const $ = id => document.getElementById(id);
let blocks = [];
let profile = null;
let companies = [];
let companiesUnknown = [];
let aliases = {};
let facts = [];
let aiConfig = { ...DEFAULT_AI_CONFIG };
const aiReviewedThisSession = new Set();
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
  return `已保存 · ${time}`;
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

function tip(text) {
  const node = element('span', '?', 'tip');
  node.tabIndex = 0;
  node.setAttribute('role', 'note');
  node.setAttribute('aria-label', text);
  node.dataset.tip = text;
  return node;
}

document.addEventListener('click', event => {
  const target = event.target.closest('.tip');
  document.querySelectorAll('.tip-open').forEach(node => { if (node !== target) node.classList.remove('tip-open'); });
  if (target) { event.preventDefault(); target.classList.toggle('tip-open'); }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') document.querySelectorAll('.tip-open').forEach(node => node.classList.remove('tip-open'));
});

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
    const status = element('button');
    status.type = 'button';
    const syncStatus = () => {
      const confirmed = fact.status === 'confirmed';
      status.textContent = confirmed ? '已确认' : '待确认';
      status.className = `button-mini ${confirmed ? '' : 'secondary'}`.trim();
    };
    syncStatus();
    const edit = patch => {
      const wasConfirmed = fact.status === 'confirmed';
      Object.assign(fact, reviseFact(fact, patch));
      syncStatus();
      persist().catch(() => notify('本地保存失败。'));
      if (wasConfirmed) notify('字段已修改，之前的人工确认已撤销，请重新核对确认。');
    };
    const label = element('input'); label.type = 'text'; label.value = fact.label; label.placeholder = '字段名';
    label.addEventListener('input', () => { edit({ label: label.value }); });
    const value = element('input'); value.type = 'text'; value.value = fact.value; value.placeholder = '内容';
    value.addEventListener('input', () => { edit({ value: value.value }); });
    status.addEventListener('click', async () => {
      Object.assign(fact, fact.status === 'confirmed' ? reviseFact(fact, {}) : confirmFact(fact));
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

const PANELS = { blocks: 'panel-blocks', profile: 'panel-profile', companies: 'panel-companies', settings: 'panel-settings' };

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
  if (entry.review === 'confirmed') return { text: '已核对', cls: 'ok' };
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
  flow.append(element('p', '进度', 'card-title'), stepper);
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

function buildFillPlanSection(entry) {
  const items = buildFillPlan(entry, { facts, blocks });
  const progress = fillPlanProgress(entry, items);
  const box = element('details', undefined, 'fill-plan');
  box.open = true;
  const summary = element('summary', `照着填（已填 ${progress.finished}/${progress.total}）`);
  box.append(summary);
  if (!items.length) {
    box.append(element('p', '还没有可用的内容。先去确认字段或段落。', 'hint'));
    return box;
  }
  const planHint = element('p', '复制 → 粘贴到表单 → 勾选。', 'hint');
  planHint.append(tip('只显示确认过的内容；待确认项不能复制。勾选只代表你填过，不会自动提交。'));
  box.append(planHint);
  for (const item of items) {
    const row = element('div', undefined, 'fill-item');
    const check = element('input'); check.type = 'checkbox';
    check.disabled = item.status !== 'ready';
    check.checked = Boolean(entry.fillDone?.[item.key]);
    check.addEventListener('change', async () => {
      entry.fillDone = entry.fillDone || {};
      if (check.checked) entry.fillDone[item.key] = true;
      else delete entry.fillDone[item.key];
      const next = fillPlanProgress(entry, items);
      summary.textContent = `照着填（已填 ${next.finished}/${next.total}）`;
      persist().catch(() => notify('本地保存失败。'));
    });
    const text = element('div', undefined, 'fill-text');
    text.append(element('div', item.label, 'fill-label'));
    const preview = item.value.length > 120 ? `${item.value.slice(0, 120)}…` : item.value;
    text.append(element('div', preview, 'fill-value'));
    text.append(element('div', `${item.source}${item.status === 'ready' ? '' : ' · 待确认'}`, 'hint'));
    const copy = element('button', '复制', 'button-mini secondary'); copy.type = 'button';
    copy.disabled = item.status !== 'ready';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(item.value); notify(`已复制：${item.label}`); }
      catch { notify('复制失败，请手动选择文本。'); }
    });
    row.append(check, text, copy);
    box.append(row);
  }
  return box;
}

function buildAiSection(entry) {
  const box = element('div', undefined, 'ai-box');
  const head = element('div', undefined, 'section-heading');
  const aiTitle = element('p', '让模型检查（可选）', 'card-title');
  aiTitle.append(tip('会把这家公司和已确认资料发送到你设置的模型接口；可能收费，只给建议，不改字段。'));
  head.append(aiTitle);
  const configured = Boolean(aiConfig.apiKey && aiConfig.model);
  const run = element('button', '检查一次', 'button-mini secondary'); run.type = 'button';
  run.disabled = !(configured && aiConfig.sendConsent);
  run.addEventListener('click', () => runAiReview(entry));
  head.append(run);
  box.append(head);
  const scope = describeReviewScope(entry, { facts, blocks });
  const scopeParts = [];
  if (scope.factLabels.length) scopeParts.push(`已确认字段 ${scope.factLabels.length} 项（${scope.factLabels.join('、')}）`);
  if (scope.blockLabels.length) scopeParts.push(`已确认原文 ${scope.blockLabels.length} 段`);
  if (scope.answerQuestions.length) scopeParts.push(`公司补充 ${scope.answerQuestions.length} 项`);
  if (scope.includesReferral) scopeParts.push('已选内推码');
  const excludedParts = [];
  if (scope.excluded.unconfirmedFacts) excludedParts.push(`未确认字段 ${scope.excluded.unconfirmedFacts}`);
  if (scope.excluded.sensitiveFacts) excludedParts.push(`家庭/敏感字段 ${scope.excluded.sensitiveFacts}`);
  if (scope.excluded.unconfirmedOrChangedBlocks) excludedParts.push(`未确认或已修改段落 ${scope.excluded.unconfirmedOrChangedBlocks}`);
  if (scope.excluded.notes) excludedParts.push('备注');
  box.append(element('p', `发送范围：当前公司与岗位选择、${scopeParts.join('、') || '无个人资料'}。${excludedParts.length ? `不发送：${excludedParts.join('、')}。` : ''}`, 'hint'));
  if (!configured) {
    box.append(element('p', '还没配置模型。去「设置」填写，或复制提示词到任意模型（复制不会联网）。', 'hint'));
  } else if (!aiConfig.sendConsent) {
    box.append(element('p', '尚未开启外发授权。请到「设置」阅读发送范围并显式勾选；本工具不会默认发送。', 'conflict'));
  }
  const renderLastReview = () => {
    if (!entry.aiReview) return;
    box.append(element('p', `上次检查：${entry.aiReview.at ? entry.aiReview.at.slice(0, 16).replace('T', ' ') : '时间未知'}`, 'hint'));
    if (!entry.aiReview.findings.length) box.append(element('p', '未发现问题。'));
    else {
      const ul = element('ul');
      for (const finding of entry.aiReview.findings) {
        ul.append(element('li', `[${finding.severity}] ${finding.area ? `${finding.area}：` : ''}${finding.message}${finding.suggestion ? `（建议：${finding.suggestion}）` : ''}`));
      }
      box.append(ul);
    }
  };
  if (!configured || !aiConfig.sendConsent) {
    const copyPrompt = element('button', '复制提示词', 'button-mini secondary'); copyPrompt.type = 'button';
    copyPrompt.addEventListener('click', async () => {
      const { system, user } = buildReviewPrompt(entry, { facts, blocks });
      try { await navigator.clipboard.writeText(`${system}\n\n---\n\n${user}`); notify('提示词已复制，粘贴给任意模型即可（复制不会联网）。'); }
      catch { notify('复制失败，请手动选择文本。'); }
    });
    box.append(copyPrompt);
    renderLastReview();
    return box;
  }
  box.append(element('p', aiConfig.autoReview ? '自动检查已开：打开公司详情调用一次。只提示，不改字段。' : '点「检查一次」看看有没有漏填或矛盾。只提示，不改字段。', 'hint'));
  renderLastReview();
  return box;
}

async function runAiReview(entry, { auto = false } = {}) {
  if (!(aiConfig.apiKey && aiConfig.model)) { notify('请先在「设置」配置模型接口。'); return; }
  if (!aiConfig.sendConsent) { notify('尚未开启外发授权，未发送任何资料。'); return; }
  aiReviewedThisSession.add(entry.id);
  const box = document.querySelector('#company-detail .ai-box');
  if (box) box.prepend(element('p', 'AI 复核中…', 'hint'));
  try {
    const result = await requestAiReview(aiConfig, entry, { facts, blocks, consent: true });
    entry.aiReview = { at: new Date().toISOString(), findings: result.findings };
    await persist();
    if (selectedCompanyId === entry.id) renderCompanyDetail();
    else renderCompanyRows();
    notify(auto ? '自动检查完成（只提示，不改）。' : '检查完成（只提示，不改）。');
  } catch (error) {
    notify(`检查失败：${error.message}`);
    if (box) box.prepend(element('p', `复核失败：${error.message}`, 'conflict'));
  }
}

function renderCompanyDetail() {
  const pane = $('company-detail');
  pane.replaceChildren();
  const entry = companies.find(item => item.id === selectedCompanyId);
  if (!entry) {
    pane.append(element('p', '点左边一家公司看详情。', 'hint'));
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
  const group = (titleText, items, fallback, className, tipText) => {
    const box = element('div', undefined, className);
    const title = element('p', titleText, 'card-title');
    if (tipText) title.append(tip(tipText));
    box.append(title);
    if (items.length) {
      const ul = element('ul');
      for (const item of items) ul.append(element('li', item));
      box.append(ul);
    } else {
      box.append(element('p', fallback, 'hint'));
    }
    return box;
  };
  card.append(group('确认过的资料', cardData.reuse, '还没有确认过的内容。', 'fc-group fc-reuse', '只有资料库里确认过的字段、段落库里确认过的段落，才会出现在这里。'));
  card.append(group('已解析，待确认', cardData.pending, '还没导入简历。', 'fc-group fc-pending', '解析结果不算数。确认后才会进入上面的“确认过的资料”。'));
  const answeredCount = cardData.ask.filter(item => String(entry.answers?.[item] || '').trim()).length;
  const askBox = element('div', undefined, 'fc-group fc-ask');
  const askTitle = element('p', `这家公司要补的（${answeredCount}/${cardData.ask.length}）`, 'card-title');
  askTitle.append(tip('只用于这家公司与本批次，不会带到其他公司。'));
  askBox.append(askTitle);
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
  card.append(group('去官网确认', cardData.verify, '无', 'fc-group fc-verify', '毕业时间窗口、剩余投递次数、内推是否绑定等，需要你到官网核对。'));
  if (cardData.possible.length) {
    const possible = element('details');
    possible.append(element('summary', `可能还会要（${cardData.possible.length} 项，不提前收集）`));
    const ul = element('ul');
    for (const item of cardData.possible) ul.append(element('li', item));
    possible.append(ul, element('p', '这些字段以实际申请表为准；本工具不会主动提前收集敏感信息。', 'hint'));
    card.append(possible);
  }
  pane.append(card);

  pane.append(buildFillPlanSection(entry));
  pane.append(buildAiSection(entry));

  for (const warning of entry.warnings || []) pane.append(element('p', warning, 'conflict'));

  const raw = element('details');
  raw.append(element('summary', '查看原文'), element('pre', entry.rawSource || '（无原文）'));
  pane.append(raw);

  const actions = element('div', undefined, 'actions');
  const confirmButton = element('button', '我已核对'); confirmButton.type = 'button';
  confirmButton.id = 'detail-confirm';
  confirmButton.addEventListener('click', async () => {
    entry.review = 'confirmed';
    refreshDetailState(entry);
    refreshFlow(entry);
    try {
      await persist(); renderCompanyRows();
      notify('已记录“我已核对”。内推绑定和投递结果仍要你到官网确认。');
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
      notify('清单已复制。照着填，最后你自己提交。');
    } catch (error) { notify(`复制失败：${error.message}`); }
  }
  const sheetButton = element('button', '复制清单', 'secondary'); sheetButton.type = 'button';
  sheetButton.dataset.action = 'sheet';
  sheetButton.addEventListener('click', copySheet);

  const downloadButton = element('button', '下载清单', 'secondary'); downloadButton.type = 'button';
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
    notify('清单已下载。提交还是你自己来。');
  });

  let qaBox = null;
  const qaButton = element('button', '检查一遍', 'secondary'); qaButton.type = 'button';
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

  if (aiConfig.autoReview && aiConfig.sendConsent && aiConfig.apiKey && aiConfig.model && !entry.aiReview && !aiReviewedThisSession.has(entry.id)) {
    aiReviewedThisSession.add(entry.id);
    setTimeout(() => { void runAiReview(entry, { auto: true }); }, 0);
  }
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
$('tab-settings').addEventListener('click', () => showTab('settings'));

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
    notify('导入完成，默认“待确认”，请逐项确认。');
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

function syncAiSettings() {
  $('ai-base-url').value = aiConfig.baseUrl || '';
  $('ai-model').value = aiConfig.model || '';
  $('ai-key').value = aiConfig.apiKey || '';
  $('ai-auto-review').checked = Boolean(aiConfig.autoReview);
  $('ai-send-consent').checked = Boolean(aiConfig.sendConsent);
  const configured = Boolean(aiConfig.apiKey && aiConfig.model);
  $('ai-status').textContent = configured
    ? `已配置${aiConfig.sendConsent ? ' · 已允许外发' : ' · 未授权外发'}${aiConfig.autoReview ? ' · 自动检查开' : ''}`
    : '未配置';
  $('ai-status').className = `badge ${configured && aiConfig.sendConsent ? 'ok' : ''}`.trim();
  $('ai-consent-note').textContent = configured
    ? `当前接口：${aiConfig.baseUrl || '未填写'}｜模型：${aiConfig.model}。只发送已确认且非敏感的当前公司资料。`
    : '填写接口并保存后，才能明确授权外发。未确认和家庭/敏感字段不会发送。';
}

$('ai-save').addEventListener('click', async () => {
  aiConfig = await saveAiConfig({
    baseUrl: $('ai-base-url').value,
    model: $('ai-model').value,
    apiKey: $('ai-key').value,
    autoReview: $('ai-auto-review').checked,
    sendConsent: $('ai-send-consent').checked,
  });
  syncAiSettings();
  notify('设置已保存（只存本机）。');
});
$('ai-clear').addEventListener('click', async () => {
  if (!confirm('清除本机保存的 API Key 与模型设置？')) return;
  aiConfig = await clearAiConfig();
  aiReviewedThisSession.clear();
  syncAiSettings();
  notify('已清除本机设置。');
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
    notify(`新加 ${added} 家公司${duplicate ? `，跳过 ${duplicate} 条重复` : ''}。请逐个核对。`);
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
    profile = next;
    let imported = 0;
    if (!facts.length) {
      const incoming = factsFromResume(profile);
      facts.push(...incoming);
      imported = incoming.length;
    }
    await persist(); renderProfile(); renderFacts(); showTab('profile');
    notify(`解析完成：${profile.internships.length} 段实习、${profile.projects.length} 个项目。字段已放进「我的资料」，请确认。`);
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
      profile = next;
      if (!facts.length) facts.push(...factsFromResume(profile));
      await persist(); renderProfile(); renderFacts(); showTab('profile');
      notify('简历已导入，字段已放进「我的资料」。');
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
  aiConfig = await loadAiConfig();
  syncAiSettings();
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
