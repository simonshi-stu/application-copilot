import { connectHost } from '@openchamber/sdk';
import { applyHostReady, mountTabs, mountTextField } from '@openchamber/sdk/ui';
import {
  COMMAND,
  COMPANY_FILTER_META,
  COMPANY_FILTERS,
  MODEL_ROLES,
  PROFILE_SECTIONS,
  applicationMeta,
  buildCapabilitiesRequest,
  buildCommandRequest,
  buildStateRequest,
  countUnresolvedIssues,
  companyApplicationCategory,
  companyApplicationCategoryMeta,
  describeCompanyApplication,
  issueSeverityMeta,
  issueStatusMeta,
  isSafeHttpUrl,
  jobStatusMeta,
  parseCapabilitiesResponse,
  parseCommandResponse,
  parseStateResponse,
  profileSectionMeta,
  queueStateMeta,
  searchMeta,
  statusMeta,
} from '../contract.js';

const boot = document.querySelector('#boot');
const app = document.querySelector('#app');
const bootMessage = document.querySelector('#boot-message');
const bootHint = document.querySelector('.boot-hint');

if (window.parent === window) {
  bootMessage.textContent = '请在 OpenChamber 扩展中打开';
  bootHint.textContent = '独立浏览器不会运行模拟任务，也不会使用 localStorage 伪造任务数据。';
} else {
  start();
}

function start() {
  let host;
  try {
    host = connectHost();
  } catch {
    bootMessage.textContent = '请在 OpenChamber 扩展中打开';
    bootHint.textContent = '无法连接 OpenChamber 宿主；不会启动本地模拟数据。';
    return;
  }

  const state = {
    host,
    initialized: false,
    hostReady: false,
    directoryInitialized: false,
    directory: null,
    generation: 0,
    requestSeq: 0,
    loadStatus: 'idle',
    loadError: null,
    revision: null,
    workbench: null,
    capabilities: null,
    selectedCompanyId: null,
    jobSelection: [],
    jobSelectionCompanyId: null,
    jobsDirty: false,
    jobUi: new Map(),
    selectionUi: null,
    selectionNotice: '',
    activeTab: 'pool',
    commandBusy: false,
    queueDirty: false,
    profileDirty: false,
    modelsDirty: false,
    issueDrafts: new Map(),
    answeringIssueId: null,
    issuesCompanyFilter: null,
    issuesAutoNote: '',
    seenDigests: new Set(),
    hostLocale: 'zh-CN',
    pendingSubmitCompanyId: null,
    pendingDeferCompanyId: null,
    pendingSkip: null,
    editingFact: null,
    draftStore: new Map(),
    modelHandles: new Map(),
    modelDrafts: new Map(),
    modelCapability: null,
    mokaAuthorized: false,
    mokaPollTimer: null,
    profileSection: PROFILE_SECTIONS[0].id,
    profileSectionSelect: null,
    profileSensitive: false,
    queueDrafts: {},
    profileDrafts: {},
    tabs: null,
    queueHandles: {},
    profileHandles: {},
    modelKeyStatusEls: new Map(),
    submitJobs: [],
    submitNoteDraft: '',
    historicalNoteDraft: '',
    historicalNoteHandle: null,
    pendingHistoricalCompanyId: null,
    companyFilter: 'all',
    companyQuery: '',
    deferReasonDraft: '',
    factDrafts: {},
    skipReasonDraft: '',
  };

  const el = {
    boot,
    app,
    projectLabel: document.querySelector('#project-label'),
    queuePill: document.querySelector('#queue-pill'),
    refreshButton: document.querySelector('#refresh-button'),
    tabsHost: document.querySelector('#tabs'),
    globalBanner: document.querySelector('#global-banner'),
    openIssuesButton: document.querySelector('#open-issues-button'),
    issuesCount: document.querySelector('#issues-count'),
    queueFormDetails: document.querySelector('#queue-form-details'),
    queueForm: document.querySelector('#queue-form'),
    queueFormError: document.querySelector('#queue-form-error'),
    enqueueButton: document.querySelector('#enqueue-button'),
    queueSummary: document.querySelector('#queue-summary'),
    queueCount: document.querySelector('#queue-count'),
    queueControls: document.querySelector('#queue-controls'),
    queueMessage: document.querySelector('#queue-message'),
    companyList: document.querySelector('#company-list'),
    queueEmpty: document.querySelector('#queue-empty'),
    detailEmpty: document.querySelector('#detail-empty'),
    detailContent: document.querySelector('#detail-content'),
    poolLayout: document.querySelector('.pool-layout'),
    profileForm: document.querySelector('#profile-form'),
    profileFormError: document.querySelector('#profile-form-error'),
    importFactButton: document.querySelector('#import-fact-button'),
    profileSensitiveWarning: document.querySelector('#profile-sensitive-warning'),
    factsList: document.querySelector('#facts-list'),
    factsCount: document.querySelector('#facts-count'),
    factsEmpty: document.querySelector('#facts-empty'),
    modelCards: document.querySelector('#model-cards'),
    saveModelsButton: document.querySelector('#save-models-button'),
    modelsError: document.querySelector('#models-error'),
    modelRuntimeNote: document.querySelector('#model-runtime-note'),
    modelRuntimeNoteText: document.querySelector('#model-runtime-note-text'),
    serviceInfo: document.querySelector('#service-info-body'),
    issuesDialog: document.querySelector('#issues-dialog'),
    issuesScope: document.querySelector('#issues-scope'),
    issuesList: document.querySelector('#issues-list'),
    issuesEmpty: document.querySelector('#issues-empty'),
    submitDialog: document.querySelector('#submit-dialog'),
    submitForm: document.querySelector('#submit-form'),
    submitFormError: document.querySelector('#submit-form-error'),
    submitJobField: document.querySelector('#field-submit-job'),
    submitNoteField: document.querySelector('#field-submit-note'),
    submitConfirmation: document.querySelector('#submit-confirmation'),
    reportSubmittedButton: document.querySelector('#report-submitted-button'),
    historicalDialog: document.querySelector('#historical-dialog'),
    historicalForm: document.querySelector('#historical-form'),
    historicalFormError: document.querySelector('#historical-form-error'),
    historicalNoteField: document.querySelector('#field-historical-note'),
    historicalConfirmation: document.querySelector('#historical-confirmation'),
    reportHistoricalButton: document.querySelector('#report-historical-button'),
    deferDialog: document.querySelector('#defer-dialog'),
    deferForm: document.querySelector('#defer-form'),
    deferFormError: document.querySelector('#defer-form-error'),
    deferReasonField: document.querySelector('#field-defer-reason'),
    deferCompanyButton: document.querySelector('#defer-company-button'),
    factDialog: document.querySelector('#fact-dialog'),
    factForm: document.querySelector('#fact-form'),
    factFormError: document.querySelector('#fact-form-error'),
    factLabelField: document.querySelector('#field-fact-label'),
    factRawField: document.querySelector('#field-fact-raw'),
    factEntityField: document.querySelector('#field-fact-entity'),
    factSaveButton: document.querySelector('#save-fact-button'),
    skipDialog: document.querySelector('#skip-dialog'),
    skipForm: document.querySelector('#skip-form'),
    skipDescription: document.querySelector('#skip-description'),
    skipReasonField: document.querySelector('#field-skip-reason'),
    skipConfirmation: document.querySelector('#skip-confirmation'),
    skipFormError: document.querySelector('#skip-form-error'),
    skipConfirmButton: document.querySelector('#confirm-skip-button'),
    applicationSummary: document.querySelector('#application-summary'),
    companySearch: document.querySelector('#company-search'),
    companyFilter: document.querySelector('#company-filter'),
    companyListSummary: document.querySelector('#company-list-summary'),
  };

  const hostTimer = window.setTimeout(() => {
    if (state.hostReady) return;
    bootMessage.textContent = '未收到 OpenChamber 宿主响应，请在 OpenChamber 扩展中打开';
    bootHint.textContent = '此页面不会在独立浏览器里使用模拟任务数据。';
  }, 12000);

  host.onReady((ctx) => {
    applyHostReady(ctx, document.documentElement);
    state.hostLocale = typeof ctx.locale === 'string' && ctx.locale ? ctx.locale : 'zh-CN';
    state.hostReady = true;
    window.clearTimeout(hostTimer);
    if (!state.initialized) {
      state.initialized = true;
      initUI();
    }
    updateProjectLabel();
    const nextDirectory = typeof ctx.directory === 'string' && ctx.directory ? ctx.directory : null;
    if (!state.directoryInitialized) {
      state.directoryInitialized = true;
      changeDirectory(nextDirectory);
      return;
    }
    if (nextDirectory !== state.directory) {
      changeDirectory(nextDirectory);
    }
  });

  host.onDirectory((directory) => {
    if (!state.hostReady || !state.directoryInitialized) return;
    const next = typeof directory === 'string' && directory ? directory : null;
    if (next !== state.directory) changeDirectory(next);
  });

  window.addEventListener('pagehide', () => {
    window.clearTimeout(hostTimer);
    host.dispose();
  });

  function initUI() {
    el.boot.hidden = true;
    el.app.hidden = false;

    state.tabs = mountTabs(el.tabsHost, {
      items: tabItems(),
      activeId: state.activeTab,
      onChange: (next) => {
        state.activeTab = next;
        switchTab();
      },
    });

    state.queueHandles.url = mountTextField(document.querySelector('#field-queue-url'), {
      label: '公司链接',
      value: '',
      placeholder: 'https://careers.example.invalid/jobs',
      helper: '仅接受 http(s) 链接；不自动打开、不自动登录。',
      onChange: (value) => {
        state.queueDrafts.url = value;
        markQueueDirty();
      },
    });
    state.queueHandles.code = mountTextField(document.querySelector('#field-queue-code'), {
      label: '内推码（可选）',
      value: '',
      placeholder: '可留空',
      onChange: (value) => {
        state.queueDrafts.code = value;
        markQueueDirty();
      },
    });
    state.queueHandles.company = mountTextField(document.querySelector('#field-queue-company'), {
      label: '公司名称（可选）',
      value: '',
      placeholder: '留空时由本地服务从链接识别',
      onChange: (value) => {
        state.queueDrafts.company = value;
        markQueueDirty();
      },
    });
    state.queueHandles.source = mountTextField(document.querySelector('#field-queue-source'), {
      label: '来源说明（可选）',
      value: '',
      placeholder: '例如：官网批次 / 内推人说明',
      onChange: (value) => {
        state.queueDrafts.source = value;
        markQueueDirty();
      },
    });

    initProfileSection();
    state.profileHandles.entity = mountTextField(document.querySelector('#field-profile-entity'), {
      label: '经历编号（可选）',
      value: '',
      placeholder: '同一项目的“项目内容”和“项目职责”请填同一编号',
      helper: '用于把多条资料归到同一段经历，避免多个项目同名字段混合。',
      onChange: (value) => {
        state.profileDrafts.entityId = value;
        markProfileDirty();
      },
    });
    state.profileHandles.label = mountTextField(document.querySelector('#field-profile-label'), {
      label: '字段名称',
      value: '',
      placeholder: '例如：姓名 / 学校 / 项目职责',
      onChange: (value) => {
        state.profileDrafts.label = value;
        markProfileDirty();
      },
    });
    state.profileHandles.raw = mountTextField(document.querySelector('#field-profile-raw'), {
      label: '字段原文（原样保留）',
      value: '',
      placeholder: '粘贴这一条字段的原始文本；不要在这里概括或改写。',
      multiline: true,
      rows: 6,
      onChange: (value) => {
        state.profileDrafts.rawText = value;
        markProfileDirty();
      },
    });
    state.profileHandles.source = mountTextField(document.querySelector('#field-profile-source'), {
      label: '原文来源（可选）',
      value: '',
      placeholder: '例如：简历原文 / 本人提供',
      onChange: (value) => {
        state.profileDrafts.source = value;
        markProfileDirty();
      },
    });

    state.factHandles = {
      label: mountTextField(el.factLabelField, {
        label: '字段名称',
        value: '',
        onChange: (value) => {
          state.factDrafts.label = value;
        },
      }),
      raw: mountTextField(el.factRawField, {
        label: '原文（修订后会重写并撤销确认）',
        value: '',
        multiline: true,
        rows: 6,
        onChange: (value) => {
          state.factDrafts.rawText = value;
        },
      }),
      entity: mountTextField(el.factEntityField, {
        label: '经历编号（可选）',
        value: '',
        placeholder: '留空表示不归属具体经历',
        onChange: (value) => {
          state.factDrafts.entityId = value;
        },
      }),
    };
    state.skipHandle = mountTextField(el.skipReasonField, {
      label: '真实跳过原因',
      value: '',
      placeholder: '必须由本人填写；不会写成“没有符合职位”',
      multiline: true,
      rows: 3,
      onChange: (value) => {
        state.skipReasonDraft = value;
      },
    });
    buildModelCards();
    bindStaticActions();
    updateProfileWarning();
    updateModelCapabilityUi();
    switchTab();
    renderAll();
    renderModelsFromState();
  }

  function bindStaticActions() {
    el.refreshButton.addEventListener('click', () => {
      void loadFromService();
    });

    el.companySearch.addEventListener('input', () => {
      state.companyQuery = el.companySearch.value;
      renderCompanyList();
    });
    el.companyFilter.addEventListener('change', () => {
      state.companyFilter = COMPANY_FILTERS.includes(el.companyFilter.value)
        ? el.companyFilter.value
        : 'all';
      renderApplicationSummary();
      renderCompanyList();
    });

    // OpenChamber guest pages run in a sandbox that does not grant native form
    // submission. Keep the forms for structure and keyboard semantics, but use
    // explicit buttons for actions so the browser cannot block the click before
    // the handler reaches the host service.
    el.enqueueButton.addEventListener('click', () => {
      void enqueueCompany();
    });
    el.queueForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void enqueueCompany();
    });

    el.importFactButton.addEventListener('click', () => {
      void importFact();
    });
    el.profileForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void importFact();
    });

    el.saveModelsButton.addEventListener('click', () => {
      void saveModels();
    });

    el.openIssuesButton.addEventListener('click', () => {
      openIssues();
    });

    document.querySelector('#close-issues-button').addEventListener('click', () => {
      closeDialog(el.issuesDialog);
    });
    document.querySelector('#close-submit-button').addEventListener('click', () => {
      closeDialog(el.submitDialog);
    });
    document.querySelector('#close-historical-button').addEventListener('click', () => {
      closeDialog(el.historicalDialog);
    });
    document.querySelector('#close-defer-button').addEventListener('click', () => {
      closeDialog(el.deferDialog);
    });

    el.submitConfirmation.addEventListener('change', updateSubmitButton);
    // The receipt button is intentionally type="button": Enter inside the note
    // field must not activate the default submit action. A real button click
    // (including keyboard activation while focused) is required.
    el.reportSubmittedButton.addEventListener('click', () => {
      void reportSubmitted();
    });
    el.submitForm.addEventListener('submit', (event) => {
      event.preventDefault();
      showInlineError(el.submitFormError, '请点击“记录本人已提交”按钮进行明确确认。');
    });
    el.historicalConfirmation.addEventListener('change', updateHistoricalButton);
    el.reportHistoricalButton.addEventListener('click', () => {
      void reportHistoricalSubmission();
    });
    el.historicalForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void reportHistoricalSubmission();
    });
    el.deferCompanyButton.addEventListener('click', () => {
      void deferCompany();
    });
    el.deferForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void deferCompany();
    });

    document.querySelector('#close-fact-button').addEventListener('click', () => {
      closeDialog(el.factDialog);
    });
    el.factSaveButton.addEventListener('click', () => {
      void saveFactRevision();
    });
    el.factForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void saveFactRevision();
    });

    document.querySelector('#close-skip-button').addEventListener('click', () => {
      closeDialog(el.skipDialog);
    });
    el.skipConfirmButton.addEventListener('click', () => {
      void confirmSkip();
    });
    el.skipConfirmation.addEventListener('change', updateSkipButton);
    el.skipForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void confirmSkip();
    });

    for (const dialog of [
      el.issuesDialog,
      el.submitDialog,
      el.historicalDialog,
      el.deferDialog,
      el.factDialog,
      el.skipDialog,
    ]) {
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) closeDialog(dialog);
      });
      dialog.addEventListener('close', () => {
        if (dialog === el.issuesDialog) state.answeringIssueId = null;
        if (dialog === el.factDialog) state.editingFact = null;
        if (dialog === el.skipDialog) state.pendingSkip = null;
        if (dialog === el.historicalDialog) state.pendingHistoricalCompanyId = null;
      });
    }
  }

  function tabItems() {
    const issueCount = state.workbench
      ? countUnresolvedIssues(state.workbench.issues)
      : 0;
    const factCount = state.workbench ? state.workbench.facts.length : 0;
    return [
      { id: 'pool', label: '任务池', count: issueCount || undefined },
      { id: 'profile', label: '个人资料', count: factCount || undefined },
      { id: 'models', label: '角色模型' },
    ];
  }

  function switchTab() {
    const map = {
      pool: document.querySelector('#view-pool'),
      profile: document.querySelector('#view-profile'),
      models: document.querySelector('#view-models'),
    };
    for (const [id, node] of Object.entries(map)) {
      node.hidden = id !== state.activeTab;
    }
    state.tabs?.update({ items: tabItems(), activeId: state.activeTab });
  }

  function currentQueueDraft() {
    return {
      url: state.queueDrafts.url ?? '',
      code: state.queueDrafts.code ?? '',
      company: state.queueDrafts.company ?? '',
      source: state.queueDrafts.source ?? '',
    };
  }

  function currentProfileDraft() {
    return {
      section: state.profileSection,
      entityId: state.profileDrafts.entityId ?? '',
      label: state.profileDrafts.label ?? '',
      rawText: state.profileDrafts.rawText ?? '',
      source: state.profileDrafts.source ?? '',
    };
  }

  function currentModelDraft() {
    const result = {};
    for (const role of MODEL_ROLES) {
      const draft = state.modelDrafts.get(role.id) ?? {};
      // Credentials are intentionally never copied into the per-directory
      // draft store. Only non-secret role metadata can be restored.
      result[role.id] = {
        provider: draft.provider ?? '',
        model: draft.model ?? '',
        endpoint: draft.endpoint ?? '',
      };
    }
    return result;
  }

  function captureWorkspaceDraft() {
    return {
      queue: currentQueueDraft(),
      profile: currentProfileDraft(),
      models: currentModelDraft(),
      dirty: {
        queue: state.queueDirty,
        profile: state.profileDirty,
        models: state.modelsDirty,
      },
    };
  }

  function hasKeyDraft() {
    for (const draft of state.modelDrafts.values()) {
      if (typeof draft?.apiKey === 'string' && draft.apiKey.length > 0) return true;
    }
    return false;
  }

  function setFieldValue(handle, value) {
    handle?.update({ value: value ?? '' });
  }

  function applyWorkspaceDraft(draft) {
    const queue = draft?.queue ?? { url: '', code: '', company: '', source: '' };
    setFieldValue(state.queueHandles.url, queue.url);
    setFieldValue(state.queueHandles.code, queue.code);
    setFieldValue(state.queueHandles.company, queue.company);
    setFieldValue(state.queueHandles.source, queue.source);
    state.queueDrafts = {
      url: queue.url ?? '',
      code: queue.code ?? '',
      company: queue.company ?? '',
      source: queue.source ?? '',
    };
    state.queueDirty = draft?.dirty?.queue === true;

    const profile = draft?.profile ?? {
      section: PROFILE_SECTIONS[0].id,
      entityId: '',
      label: '',
      rawText: '',
      source: '',
    };
    state.profileSection = PROFILE_SECTIONS.some((item) => item.id === profile.section)
      ? profile.section
      : PROFILE_SECTIONS[0].id;
    state.profileSectionSelect.value = state.profileSection;
    state.profileSensitive = false;
    updateProfileWarning();
    setFieldValue(state.profileHandles.entity, profile.entityId);
    setFieldValue(state.profileHandles.label, profile.label);
    setFieldValue(state.profileHandles.raw, profile.rawText);
    setFieldValue(state.profileHandles.source, profile.source);
    state.profileDrafts = {
      entityId: profile.entityId ?? '',
      label: profile.label ?? '',
      rawText: profile.rawText ?? '',
      source: profile.source ?? '',
    };
    state.profileDirty = draft?.dirty?.profile === true;

    for (const role of MODEL_ROLES) {
      const saved = draft?.models?.[role.id] ?? { provider: '', model: '', endpoint: '' };
      const handles = state.modelHandles.get(role.id);
      setFieldValue(handles?.provider, saved.provider);
      setFieldValue(handles?.model, saved.model);
      setFieldValue(handles?.endpoint, saved.endpoint);
      setFieldValue(handles?.apiKey, '');
      if (handles?.clear) handles.clear.checked = false;
      state.modelDrafts.set(role.id, {
        provider: saved.provider ?? '',
        model: saved.model ?? '',
        endpoint: saved.endpoint ?? '',
        apiKey: '',
        clearApiKey: false,
      });
    }
    state.modelsDirty = draft?.dirty?.models === true;
    updateModelCapabilityUi();
  }

  function changeDirectory(nextDirectory) {
    const hadUnsaved =
      state.queueDirty || state.profileDirty || state.modelsDirty;
    const hadKey = hasKeyDraft();
    if (state.directory) {
      state.draftStore.set(state.directory, captureWorkspaceDraft());
      if (state.workbench?.moka?.operation?.status === 'running' && state.hostReady) {
        void state.host.serviceRequest(buildCommandRequest({
          directory: state.directory,
          command: COMMAND.mokaCancel,
          input: { reason: '切换项目' },
        })).catch(() => {});
      }
    }
    state.mokaAuthorized = false;
    state.generation += 1;
    state.requestSeq += 1;
    state.commandBusy = false;
    state.directory = nextDirectory;
    state.loadError = null;
    state.workbench = null;
    state.capabilities = null;
    state.modelCapability = null;
    state.revision = null;
    state.selectedCompanyId = null;
    state.jobSelection = [];
    state.jobSelectionCompanyId = null;
    state.jobsDirty = false;
    state.jobUi.clear();
    state.selectionNotice = '';
    state.issueDrafts.clear();
    state.answeringIssueId = null;
    state.issuesCompanyFilter = null;
    state.issuesAutoNote = '';
    state.selectionUi = null;
    state.pendingSubmitCompanyId = null;
    state.pendingDeferCompanyId = null;
    state.pendingSkip = null;
    state.editingFact = null;
    state.submitJobs = [];
    state.submitNoteDraft = '';
    state.deferReasonDraft = '';
    state.skipReasonDraft = '';
    state.loadStatus = nextDirectory ? 'loading' : 'no-directory';
    showInlineError(el.queueFormError, '');
    showInlineError(el.profileFormError, '');
    showInlineError(el.modelsError, '');
    closeDialog(el.issuesDialog);
    closeDialog(el.submitDialog);
    closeDialog(el.deferDialog);
    closeDialog(el.factDialog);
    closeDialog(el.skipDialog);
    applyWorkspaceDraft(nextDirectory ? state.draftStore.get(nextDirectory) : null);
    if (nextDirectory && hadUnsaved) {
      notify('已切换到该项目自己的草稿；未提交内容不会带到其他项目。', 'info');
    }
    if (hadKey) {
      notify('未提交的接口密钥已清除，不会跨项目保留。', 'info');
    }
    updateProjectLabel();
    renderAll();
    if (nextDirectory) {
      void loadFromService();
    }
  }

  function updateProjectLabel() {
    const name = state.directory ? basename(state.directory) : '';
    el.projectLabel.textContent = name ? `项目：${name}` : '未打开项目';
    el.projectLabel.title = state.directory || '';
  }

  async function loadFromService() {
    if (!state.directory) {
      state.loadStatus = 'no-directory';
      renderAll();
      return;
    }
    const generation = state.generation;
    const directory = state.directory;
    const seq = ++state.requestSeq;
    state.loadStatus = 'loading';
    state.loadError = null;
    renderLoadState();
    try {
      const capabilitiesResult = await state.host.serviceRequest(buildCapabilitiesRequest());
      if (isStale(generation, seq, directory)) return;
      const capabilities = parseCapabilitiesResponse(capabilitiesResult);
      const stateResult = await state.host.serviceRequest(buildStateRequest(directory));
      if (isStale(generation, seq, directory)) return;
      const parsed = parseStateResponse(stateResult);
      applyCapabilities(capabilities);
      applyServiceState(parsed.revision, parsed.state);
      state.loadStatus = 'ready';
      hideBanner();
    } catch (error) {
      if (isStale(generation, seq, directory)) return;
      state.loadError = error;
      state.loadStatus = 'error';
      state.workbench = null;
      applyCapabilities(null);
      state.revision = null;
      showServiceError(error);
      renderAll();
    }
  }

  function isStale(generation, seq, directory) {
    return (
      generation !== state.generation ||
      seq !== state.requestSeq ||
      directory !== state.directory
    );
  }

  function modelKeysAllowed() {
    return Boolean(
      state.modelCapability?.secureModelCredentials === true &&
        state.modelCapability?.roleExecution === true,
    );
  }

  function applyCapabilities(capabilities) {
    const previousAllowed = modelKeysAllowed();
    state.capabilities = capabilities;
    state.modelCapability = capabilities?.flags ?? null;
    if (previousAllowed && !modelKeysAllowed()) {
      clearModelCredentials('本地服务能力已变化；未提交的接口密钥已清除。');
    }
    updateModelCapabilityUi();
  }

  function clearModelCredentials(reason) {
    let hadKey = false;
    for (const [role, handles] of state.modelHandles.entries()) {
      const draft = state.modelDrafts.get(role) ?? {};
      if (draft.apiKey) hadKey = true;
      setFieldValue(handles.apiKey, '');
      if (handles.clear) handles.clear.checked = false;
      state.modelDrafts.set(role, { ...draft, apiKey: '', clearApiKey: false });
    }
    if (hadKey && reason) notify(reason, 'info');
  }

  function updateModelCapabilityUi() {
    const flags = state.modelCapability;
    const allowed = modelKeysAllowed();
    const keyHelper = !flags
      ? '尚未读取后端安全凭据能力，暂不允许填写密钥。'
      : !flags.secureModelCredentials
        ? '当前后端不接收 API Key。'
        : !flags.roleExecution
          ? '后端尚未接入角色执行，密钥字段已停用。'
          : '密钥只保存在本宿主进程内存；不落盘、不回显、不导出，重启需重新输入。';
    const placeholder = allowed ? '留空表示不修改已保存密钥' : '当前后端不支持保存密钥';
    for (const [role, handles] of state.modelHandles.entries()) {
      const update = {
        disabled: !allowed,
        helper: keyHelper,
        placeholder,
      };
      if (!allowed) update.value = '';
      handles.apiKey.update(update);
      if (handles.clear) handles.clear.disabled = !allowed;
      if (!allowed) {
        const draft = state.modelDrafts.get(role) ?? {};
        state.modelDrafts.set(role, { ...draft, apiKey: '', clearApiKey: false });
        if (handles.clear) handles.clear.checked = false;
      }
    }
    if (el.modelRuntimeNote) {
      el.modelRuntimeNote.hidden = false;
      el.modelRuntimeNote.dataset.tone = allowed ? 'info' : 'warning';
      el.modelRuntimeNoteText.textContent = !state.capabilities
        ? '尚未读取本地服务能力。保存角色选择不代表模型已运行或 review 已完成。'
        : !flags?.secureModelCredentials && !flags?.roleExecution
          ? '当前后端只保存 provider/model 等非秘密元数据，不接收 API Key，也不执行角色模型。保存角色选择不代表模型已运行或 review 已完成。'
          : !flags?.secureModelCredentials
            ? '当前后端声明可执行角色，但不接收 API Key；保存角色选择不代表当前任务已实际运行。'
            : !flags?.roleExecution
              ? '后端只在进程内存保存密钥，但尚未接入角色执行；保存选择不代表模型已运行或 review 已完成。'
              : '后端声明支持进程内存密钥与角色执行；密钥不落盘，重启需重输，保存选择本身仍不代表任务已运行。';
    }
    for (const [role, node] of state.modelKeyStatusEls.entries()) {
      if (!flags) {
        node.textContent = '密钥：未连接';
      } else if (!flags.secureModelCredentials) {
        node.textContent = '密钥：当前后端不接收密钥';
      } else if (!flags.roleExecution) {
        node.textContent = '密钥：后端尚未接入角色执行';
      } else {
        const hasKey = state.workbench?.models?.[role]?.apiKeySet === true;
        node.textContent = hasKey
          ? '密钥：本进程内存已有（不回显）'
          : '密钥：未保存；重启需重新输入';
      }
    }
  }

  function applyServiceState(revision, workbench) {
    state.revision = revision;
    state.workbench = workbench;
    state.loadStatus = 'ready';
    state.loadError = null;
    const companies = workbench.companies;
    if (state.selectedCompanyId && !companies.some((item) => item.id === state.selectedCompanyId)) {
      state.selectedCompanyId = null;
      state.jobSelection = [];
      state.jobSelectionCompanyId = null;
      state.jobsDirty = false;
    }
    if (!state.selectedCompanyId && companies.length > 0 && window.matchMedia('(min-width: 901px)').matches) {
      state.selectedCompanyId = companies[0].id;
    }
    ensureJobSelection();
    renderAll();
    renderModelsFromState();
    if (el.issuesDialog.open) renderIssues();
    maybeAutoOpenDigest();
    scheduleMokaPoll();
  }

  function scheduleMokaPoll() {
    if (state.mokaPollTimer) window.clearTimeout(state.mokaPollTimer);
    state.mokaPollTimer = null;
    const status = state.workbench?.moka?.operation?.status;
    if (status !== 'running' || !state.directory || state.commandBusy) return;
    state.mokaPollTimer = window.setTimeout(() => {
      state.mokaPollTimer = null;
      if (state.workbench?.moka?.operation?.status === 'running' && !state.commandBusy) {
        void loadFromService();
      }
    }, 2500);
  }

  function renderAll() {
    renderHeader();
    renderBanner();
    renderQueue();
    renderCompanyList();
    renderDetail();
    renderFacts();
    renderServiceInfo();
    renderActionAvailability();
    state.tabs?.update({ items: tabItems(), activeId: state.activeTab });
  }

  function renderLoadState() {
    renderQueue();
    renderCompanyList();
    renderDetail();
    renderActionAvailability();
  }

  function renderHeader() {
    const meta = queueStateMeta(state.workbench?.queue.state ?? 'unknown');
    el.queuePill.textContent = meta.label;
    el.queuePill.dataset.tone = meta.tone;
    const issueCount = state.workbench ? countUnresolvedIssues(state.workbench.issues) : 0;
    el.issuesCount.textContent = String(issueCount);
  }

  function renderBanner() {
    if (!state.directory) {
      showBanner(
        'warning',
        '请先打开一个项目',
        '任务和资料按当前项目目录保存。请在 OpenChamber 中打开项目后再使用任务池。',
      );
      return;
    }
    if (state.loadStatus === 'error' && state.loadError) {
      const info = friendlyError(state.loadError);
      showBanner('error', info.title, info.message, {
        label: '重试',
        onClick: () => {
          void loadFromService();
        },
      });
      return;
    }
    if (state.workbench?.recoveryPending) {
      showBanner(
        'warning',
        '需要本人确认恢复观察',
        '检测到上次中断。请先观察招聘网站现场，再确认继续；不会重放上传、增加经历或提交等不确定动作。',
        {
          label: '我已观察页面',
          onClick: () => {
            void runCommand(
              COMMAND.acknowledgeRecovery,
              { confirmedByUser: true },
              { successMessage: '已确认本人观察现场；后续仍需按当前阶段逐步操作。' },
            );
          },
        },
      );
      return;
    }
    hideBanner();
  }

  function showBanner(tone, title, message, action) {
    el.globalBanner.hidden = false;
    el.globalBanner.dataset.tone = tone;
    el.globalBanner.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = `${title}：`;
    const text = document.createElement('span');
    text.textContent = message;
    el.globalBanner.append(strong, text);
    if (action) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn small outline banner-action';
      button.textContent = action.label;
      button.addEventListener('click', action.onClick);
      el.globalBanner.append(button);
    }
  }

  function hideBanner() {
    el.globalBanner.hidden = true;
    el.globalBanner.replaceChildren();
  }

  function showServiceError(error) {
    const info = friendlyError(error);
    showBanner('error', info.title, info.message, {
      label: '重试',
      onClick: () => {
        void loadFromService();
      },
    });
  }

  function renderQueue() {
    const queue = state.workbench?.queue;
    const companies = state.workbench?.companies ?? [];
    const queueMeta = queueStateMeta(queue?.state ?? 'unknown');
    el.queueCount.textContent = String(companies.length);
    if (!state.directory) {
      el.queueSummary.textContent = '未打开项目';
    } else if (state.loadStatus === 'loading' && !state.workbench) {
      el.queueSummary.textContent = '正在读取本地服务…';
    } else if (state.loadStatus === 'error') {
      el.queueSummary.textContent = '任务状态不可用';
    } else if (queue) {
      const active = companies.find((company) => company.id === queue.activeCompanyId);
      const parts = [`${companies.length} 家公司`, queueMeta.label];
      if (active) parts.push(`当前：${active.name}`);
      if (state.workbench?.generatedAt) parts.push(formatTime(state.workbench.generatedAt));
      el.queueSummary.textContent = parts.join(' · ');
    } else {
      el.queueSummary.textContent = `${companies.length} 家公司`;
    }

    renderQueueControls();
    renderApplicationSummary();
    const message = queue?.message ?? '';
    el.queueMessage.hidden = !message;
    el.queueMessage.textContent = message;

    if (companies.length > 0) {
      renderEmpty(el.queueEmpty, '', '');
    } else {
      renderEmpty(
        el.queueEmpty,
        state.directory ? '' : '请先打开项目',
        state.directory
          ? state.loadStatus === 'loading'
            ? '正在读取本地服务…'
            : state.loadStatus === 'error'
              ? '无法读取任务状态。请修复本地服务后重试。'
              : '任务池为空。粘贴公司链接入队；入队不会自动开始。'
          : '任务数据按项目目录保存，未打开项目时不会显示模拟任务。',
      );
    }
  }

  function renderApplicationSummary() {
    const companies = state.workbench?.companies ?? [];
    el.applicationSummary.replaceChildren();
    if (!state.workbench) return;

    const counts = {
      all: companies.length,
      pending: companies.filter((company) => companyApplicationCategory(company) === 'pending').length,
      submitted: companies.filter((company) => companyApplicationCategory(company) === 'submitted').length,
      no_suitable_jobs: companies.filter((company) => companyApplicationCategory(company) === 'no_suitable_jobs').length,
      skipped: companies.filter((company) => companyApplicationCategory(company) === 'skipped').length,
    };
    const reported = companies.filter((company) => company.application.kind === 'self_reported').length;
    const verified = companies.filter((company) => company.application.kind === 'verified').length;
    const needsAttention = companies.filter((company) => [
      'awaiting_user',
      'awaiting_submit',
      'search_blocked',
      'deferred',
      'failed',
    ].includes(company.status)).length;

    for (const filter of COMPANY_FILTERS) {
      const meta = COMPANY_FILTER_META[filter];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'application-summary-card';
      button.dataset.tone = meta.tone;
      button.setAttribute('aria-pressed', String(state.companyFilter === filter));
      button.addEventListener('click', () => {
        state.companyFilter = filter;
        el.companyFilter.value = filter;
        renderApplicationSummary();
        renderCompanyList();
      });
      const label = document.createElement('span');
      label.className = 'application-summary-label';
      label.textContent = meta.label;
      const count = document.createElement('strong');
      count.className = 'application-summary-count';
      count.textContent = String(counts[filter]);
      button.append(label, count);
      if (filter === 'submitted' && (reported > 0 || verified > 0)) {
        const detail = document.createElement('span');
        detail.className = 'application-summary-detail';
        detail.textContent = `本人记录 ${reported} · 官网核验 ${verified}`;
        button.append(detail);
      }
      el.applicationSummary.append(button);
    }

    if (needsAttention > 0) {
      const note = document.createElement('span');
      note.className = 'application-summary-note';
      note.textContent = `待处理 ${needsAttention} 家；“已投递（本人记录）”不会自动变成官网核验。`;
      el.applicationSummary.append(note);
    }
  }

  function renderQueueControls() {
    el.queueControls.replaceChildren();
    const queueState = state.workbench?.queue.state ?? 'unknown';
    const hasCompanies = (state.workbench?.companies ?? []).length > 0;
    const ready = isReadyForCommands();

    const start = actionButton('开始队列', 'primary', () => {
      void runCommand(COMMAND.start, {}, { successMessage: '队列已开始；登录和最终提交仍需本人完成。' });
    });
    start.disabled = !ready || !hasCompanies || !['idle', 'completed'].includes(queueState);

    const pause = actionButton('暂停', 'outline', () => {
      void runCommand(COMMAND.pause, {}, { successMessage: '已请求暂停；不会自动把任务标记为完成。' });
    });
    pause.disabled = !ready || !['running', 'blocked'].includes(queueState);

    const resume = actionButton('恢复', 'outline', () => {
      void runCommand(COMMAND.resume, {}, { successMessage: '已请求恢复；会从持久化状态继续。' });
    });
    resume.disabled = !ready || queueState !== 'paused';

    el.queueControls.append(start, pause, resume);
    const note = document.createElement('span');
    note.className = 'muted small';
    note.textContent = '会话空闲不会完成任何任务。';
    el.queueControls.append(note);
  }

  function companyRow(company, index) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'company-row';
    row.setAttribute('aria-current', company.id === state.selectedCompanyId ? 'true' : 'false');
    row.addEventListener('click', () => selectCompany(company.id));

    const indexNode = document.createElement('span');
    indexNode.className = 'company-index';
    indexNode.textContent = String(company.queuePosition ?? index + 1).padStart(2, '0');

    const main = document.createElement('span');
    main.className = 'company-main';
    const title = document.createElement('span');
    title.className = 'company-title';
    title.textContent = company.name;
    const sub = document.createElement('span');
    sub.className = 'company-sub';
    const categoryMeta = companyApplicationCategoryMeta(company);
    sub.append(badge(categoryMeta.label, categoryMeta.tone));
    const status = statusMeta(company.status);
    if (status.label !== categoryMeta.label) sub.append(badge(status.label, status.tone));
    if (company.application.kind === 'self_reported') {
      sub.append(textNode('待官网核验'));
    } else if (company.application.kind === 'verified') {
      sub.append(textNode('官网已核验'));
    }
    if (company.referralCodes.length > 0) {
      const unselected = company.referralCodes.filter((code) => !code.selected).length;
      sub.append(textNode(unselected > 0 ? `内推候选 ${company.referralCodes.length}` : '内推已选用'));
    }
    const selectedJobs = company.jobs.filter((job) => job.selected).length;
    if (selectedJobs > 0) sub.append(textNode(`已选 ${selectedJobs} 岗`));
    const issueCount = companyIssueCount(company.id);
    if (issueCount > 0) sub.append(textNode(`问题 ${issueCount}`));
    main.append(title, sub);

    const side = document.createElement('span');
    side.className = 'company-side';
    if (company.links.length > 0) side.append(textNode(`${company.links.length} 链接`));
    row.append(indexNode, main, side);
    return row;
  }

  function selectCompany(companyId) {
    if (state.selectedCompanyId !== companyId) {
      state.selectedCompanyId = companyId;
      state.jobSelectionCompanyId = null;
      state.jobsDirty = false;
      ensureJobSelection();
    }
    renderCompanyList();
    renderDetail();
  }

  function renderCompanyList() {
    const companies = state.workbench?.companies ?? [];
    const visible = companies.filter((company) => {
      const category = companyApplicationCategory(company);
      const filterMatches = state.companyFilter === 'all' || category === state.companyFilter;
      const query = state.companyQuery.trim().toLocaleLowerCase();
      const queryMatches = !query || [
        company.name,
        company.result,
        company.note,
        company.application?.note,
      ].some((value) => String(value || '').toLocaleLowerCase().includes(query));
      return filterMatches && queryMatches;
    });
    el.companyList.replaceChildren();
    visible.forEach((company, index) => {
      el.companyList.append(companyRow(company, index));
    });
    el.companyListSummary.textContent = visible.length === companies.length
      ? `显示全部 ${companies.length} 家`
      : `显示 ${visible.length} / ${companies.length} 家`;
    renderEmpty(
      el.queueEmpty,
      companies.length > 0 && visible.length === 0 ? '没有匹配的公司' : '',
      companies.length > 0 && visible.length === 0 ? '请调整搜索词或状态筛选。' : '',
    );
    el.poolLayout.classList.toggle('detail-visible', Boolean(state.selectedCompanyId));
  }

  function ensureJobSelection() {
    const company = selectedCompany();
    if (!company) {
      state.jobSelection = [];
      state.jobSelectionCompanyId = null;
      return;
    }
    if (state.jobSelectionCompanyId === company.id && state.jobsDirty) return;
    state.jobSelectionCompanyId = company.id;
    if (state.jobSelectionCompanyId === company.id && !state.jobsDirty) {
      const selected = company.jobs
        .filter((job) => job.selected && job.id)
        .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
        .map((job) => job.id);
      state.jobSelection = selected.slice(0, 3);
      if (selected.length > 3) {
        state.selectionNotice = '后端返回了超过 3 个已选岗位，这里只显示前 3 个；请核对后重新保存。';
      } else {
        state.selectionNotice = '';
      }
    }
  }

  function selectedCompany() {
    return (state.workbench?.companies ?? []).find((item) => item.id === state.selectedCompanyId) ?? null;
  }

  function companyIssueCount(companyId) {
    if (!companyId || !state.workbench) return 0;
    return state.workbench.issues.filter(
      (issue) => issue.status !== 'resolved' && issue.companyId === companyId,
    ).length;
  }

  function renderDetail() {
    const company = selectedCompany();
    el.detailContent.hidden = !company;
    if (!company) {
      el.detailContent.replaceChildren();
      renderEmpty(
        el.detailEmpty,
        state.directory ? '选择一家公司' : '未打开项目',
        state.directory
          ? '查看岗位候选、选择优先级、问题与投递结果。'
          : '打开项目后可读取本地服务中的任务。',
      );
      el.poolLayout.classList.remove('detail-visible');
      return;
    }
    renderEmpty(el.detailEmpty, '', '');
    el.detailEmpty.replaceChildren();
    const container = el.detailContent;
    container.replaceChildren();
    state.jobUi.clear();
    state.selectionUi = null;

    const head = div('detail-head');
    const titleWrap = div('detail-title');
    const back = actionButton('返回队列', 'small ghost', () => {
      state.selectedCompanyId = null;
      state.jobSelection = [];
      state.jobSelectionCompanyId = null;
      state.jobsDirty = false;
      renderCompanyList();
      renderDetail();
    });
    back.classList.add('detail-back');
    const title = document.createElement('h3');
    title.textContent = company.name;
    const status = statusMeta(company.status);
    const categoryMeta = companyApplicationCategoryMeta(company);
    const queuePosition = company.queuePosition ? `队列 ${company.queuePosition}` : '队列位置未知';
    titleWrap.append(back, title, badge(categoryMeta.label, categoryMeta.tone));
    if (status.label !== categoryMeta.label) titleWrap.append(badge(status.label, status.tone));
    if (isCurrentActiveCompany(company)) titleWrap.append(badge('当前活动公司', 'primary'));
    const meta = div('detail-meta');
    meta.append(textNode(queuePosition), textNode(`更新：${formatTime(company.updatedAt) || '未知'}`));
    const activeJob = company.jobs.find((job) => job.id === company.activePositionId);
    if (activeJob) meta.append(textNode(`当前岗位：${activeJob.title}`));
    if (company.holdReason) meta.append(textNode(`暂挂原因：${company.holdReason}`));
    if (company.skipReason) meta.append(textNode(`跳过原因：${company.skipReason}`));
    titleWrap.append(meta);
    head.append(titleWrap);

    const actions = div('detail-actions');
    const issueCount = companyIssueCount(company.id);
    if (issueCount > 0) {
      actions.append(
        actionButton(`本任务问题 ${issueCount}`, 'outline small', () => {
          openIssues(company.id);
        }),
      );
    }
    if (canResumeCompany(company)) {
      actions.append(
        actionButton('恢复暂挂公司', 'primary small', () => {
          void runCommand(
            COMMAND.resumeCompany,
            { companyId: company.id },
            { successMessage: '已恢复暂挂公司；不会同时启动另一家活动公司。' },
          );
        }),
      );
    }
    if (canDeferCompany(company)) {
      actions.append(
        actionButton('暂挂此公司', 'ghost small', () => {
          openDeferDialog(company);
        }),
      );
    }
    if (canSkipCompany(company)) {
      actions.append(
        actionButton('跳过整家公司', 'ghost small', () => {
          openSkipDialog(company, null);
        }),
      );
    }
    head.append(actions);
    container.append(head);

    const hint = stageHint(company);
    if (hint) {
      const stage = div('stage-hint');
      stage.textContent = hint;
      container.append(stage);
    }
    if (company.status === 'awaiting_login') {
      container.append(renderLoginSection(company));
    }
    container.append(renderLinksSection(company));
    container.append(renderReferralSection(company));
    container.append(renderSearchSection(company));
    container.append(renderMokaSection(company));
    container.append(renderJobsSection(company));
    container.append(renderApplicationSection(company));
    container.append(renderCompanyIssuesSection(company));

    syncJobSelectionUI();
  }

  function renderLoginSection(company) {
    const section = div('detail-section login-receipt');
    section.append(sectionTitleRow('本人登录回执', '尚未记录'));
    const text = document.createElement('p');
    text.className = 'muted small';
    text.textContent =
      '请先在招聘官网由本人完成登录。面板只记录“本人已完成登录”，不读取账号、密码、验证码或登录凭据。';
    section.append(text);
    const button = actionButton('我已登录，记录回执', 'primary small', () => {
      void runCommand(
        COMMAND.confirmLogin,
        { companyId: company.id, confirmedByUser: true },
        { successMessage: '已记录本人登录回执；不会读取账号或验证码。' },
      );
    });
    button.disabled = !canConfirmLogin(company);
    if (!canConfirmLogin(company)) {
      section.append(
        textNode(
          queueIsPaused()
            ? '队列暂停中：恢复队列后才能记录登录回执。'
            : '只能由当前活动公司的本人在待登录阶段确认。',
          'muted small',
        ),
      );
    }
    section.append(button);
    return section;
  }

  function renderLinksSection(company) {
    const section = div('detail-section');
    const row = sectionTitleRow('官方链接与来源', `${company.links.length} 个`);
    section.append(row);
    if (company.links.length === 0) {
      section.append(textNode('未记录官方链接。', 'muted small'));
      return section;
    }
    const links = div('link-row');
    company.links.forEach((link) => {
      const button = actionButton(link.label || link.url, 'btn ghost link-button', () => {
        openExternal(link.url);
      });
      button.title = link.url;
      links.append(button);
    });
    section.append(links);
    return section;
  }

  function renderReferralSection(company) {
    const section = div('detail-section');
    section.append(sectionTitleRow('内推码候选', `${company.referralCodes.length} 个`));
    if (company.referralCodes.length === 0) {
      section.append(textNode('未提供内推码。可稍后在任务中补充，不会猜测。', 'muted small'));
      return section;
    }
    const list = div('code-list');
    company.referralCodes.forEach((code) => {
      const row = div('code-row');
      const value = document.createElement('span');
      value.className = 'code-value';
      value.textContent = code.value;
      row.append(value, badge(code.selected ? '已选用' : '候选（未选用）', code.selected ? 'success' : 'neutral'));
      if (code.source) row.append(textNode(`来源：${code.source}`, 'muted small'));
      list.append(row);
    });
    section.append(list);
    if (!company.referralCodes.some((code) => code.selected)) {
      section.append(textNode('未选择前不会把第一个候选当作已选内推码。', 'muted small'));
    }
    return section;
  }

  function renderMokaSection(company) {
    const section = div('detail-section');
    section.append(sectionTitleRow('受控 Moka 执行', '独立 Chrome 窗口'));
    const moka = state.workbench?.moka;
    const op = moka?.operation;
    const running = op?.status === 'running';
    const queueReady = isActiveAndRunning(company);
    const activeJob = company.jobs.find((job) => job.id === company.activePositionId) || null;
    const plan = moka?.plan && moka.plan.companyId === company.id ? moka.plan : null;

    const note = document.createElement('p');
    note.className = 'muted small';
    note.textContent = '只使用当前公司/岗位已保存的官方来源；独立 Chrome 窗口不是嵌入页面。本人登录、验证码、最终提交仍由本人完成。';
    section.append(note);

    const driver = moka?.driver;
    const stateLine = div('inline-note');
    stateLine.textContent = [
      `窗口：${driver?.status === 'open' ? '已打开' : '未打开'}`,
      op ? `后台：${op.kind || ''} ${op.status}` : '后台：空闲',
      plan ? `计划：${plan.itemCount} 项${plan.used ? '（已执行）' : plan.confirmed ? '（已确认）' : '（待本人确认）'}` : '',
    ].filter(Boolean).join(' · ');
    section.append(stateLine);
    if (op?.message) section.append(textNode(op.message, 'muted small'));

    const authLabel = manualConfirmation('本人授权本次将必要资料发送给已配置模型；未勾选不会发起模型请求。');
    authLabel.checkbox.checked = state.mokaAuthorized;
    authLabel.checkbox.disabled = running;
    authLabel.checkbox.addEventListener('change', () => {
      state.mokaAuthorized = authLabel.checkbox.checked;
    });
    section.append(authLabel.label);

    const buttons = div('detail-actions');
    const open = actionButton('打开受控 Moka 窗口', 'outline small', () => {
      void runCommand(COMMAND.mokaOpen, { companyId: company.id }, { successMessage: '已请求打开独立受控 Chrome 窗口。' });
    });
    open.disabled = !queueReady || running;
    buttons.append(open);

    const research = actionButton('检索岗位', 'outline small', () => {
      void runCommand(COMMAND.mokaResearch, { companyId: company.id, sendAuthorized: state.mokaAuthorized }, { successMessage: '已启动受控检索。' });
    });
    research.disabled = !queueReady || running || company.status !== 'researching';
    buttons.append(research);

    const prepare = actionButton('准备填写计划', 'outline small', () => {
      void runCommand(COMMAND.mokaPrepareFill, { companyId: company.id, jobId: activeJob.id, sendAuthorized: state.mokaAuthorized }, { successMessage: '已启动填写计划准备。' });
    });
    prepare.disabled = !queueReady || running || company.status !== 'preparing' || !activeJob;
    buttons.append(prepare);

    const run = actionButton('确认并执行填写与复核', 'primary small', () => {
      void runCommand(COMMAND.mokaRunFill, {
        companyId: company.id,
        jobId: activeJob.id,
        planId: plan.planId,
        sendAuthorized: state.mokaAuthorized,
        confirmedByUser: true,
      }, { successMessage: '已按确认计划启动填写与复核；不会提交。' });
    });
    run.disabled = !queueReady || running || !plan || plan.used || !activeJob;
    buttons.append(run);

    const cancel = actionButton('停止受控操作', 'ghost small', () => {
      void runCommand(COMMAND.mokaCancel, { companyId: company.id, reason: '本人停止' }, { successMessage: '已请求停止受控操作。' });
    });
    cancel.disabled = !running && driver?.status !== 'open';
    buttons.append(cancel);
    section.append(buttons);

    if (!running && (!state.mokaAuthorized)) {
      section.append(textNode('发送授权未勾选：检索与填写计划不会调用模型。', 'muted small'));
    }
    if (moka?.review) {
      const review = div('inline-note');
      review.textContent = [
        moka.review.passed ? '独立复核：通过（仍需本人终审）' : '独立复核：未通过或未完成',
        `程序差异 ${moka.review.programDiffCount || 0}`,
        `读回字段 ${moka.review.readbackFields || 0}`,
        moka.review.reviewError ? `问题：${moka.review.reviewError}` : '',
      ].filter(Boolean).join(' · ');
      section.append(review);
    }
    if (moka?.limits?.length) section.append(textNode(moka.limits[0], 'muted small'));
    return section;
  }

  function renderSearchSection(company) {
    const section = div('detail-section');
    section.append(sectionTitleRow('检索与岗位证据', formatTime(company.search.checkedAt) || ''));
    const meta = searchMeta(company.search.state);
    const box = div('search-box');
    box.dataset.tone = meta.tone;
    const title = document.createElement('strong');
    title.textContent = meta.label;
    box.append(title);
    if (company.search.message) {
      const message = document.createElement('p');
      message.textContent = company.search.message;
      box.append(message);
    }
    if (company.search.state === 'blocked') {
      const note = document.createElement('p');
      note.textContent = '检索受阻不能当作“没有合适岗位”；登录、访问或资格不确定时请保留现场处理。';
      box.append(note);
    } else if (company.search.state === 'no_suitable_jobs') {
      const note = document.createElement('p');
      note.textContent = '只有完成可靠检索并留有来源证据时，才会显示“未投递：没有符合职位”。';
      box.append(note);
    } else if (company.search.state === 'complete' && company.jobs.length === 0) {
      const note = document.createElement('p');
      note.textContent = '检索完成，但暂无候选岗位；这还不是“没有符合职位”。';
      box.append(note);
    }
    if (company.search.resultText) {
      const result = document.createElement('p');
      result.textContent = `核查结果原文：${company.search.resultText}`;
      box.append(result);
    }
    section.append(box);
    if (company.search.evidenceUrl) {
      const evidence = actionButton('查看检索来源', 'ghost small', () => {
        openExternal(company.search.evidenceUrl);
      });
      section.append(evidence);
    }
    if (company.search.checkedBy === 'user' || company.search.source === 'user_manual_entry') {
      section.append(textNode('来源：本人手动核查与录入，不是自动检索。', 'muted small'));
    }
    if (canRecordCandidates(company)) {
      section.append(renderManualCandidateEntry(company));
    }
    if (canRecordNoPositions(company)) {
      section.append(renderNoPositionsEntry(company));
    }
    return section;
  }

  function manualField(labelText, control) {
    const label = document.createElement('label');
    label.className = 'field-label';
    label.append(textNode(labelText));
    label.append(control);
    return label;
  }

  function manualInput({ type = 'text', value = '', placeholder = '' } = {}) {
    const input = document.createElement('input');
    input.type = type;
    input.className = 'native-input';
    input.value = value;
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    return input;
  }

  function manualTextarea({ value = '', placeholder = '', rows = 3 } = {}) {
    const textarea = document.createElement('textarea');
    textarea.className = 'native-input';
    textarea.value = value;
    textarea.placeholder = placeholder;
    textarea.rows = rows;
    return textarea;
  }

  function manualConfirmation(text) {
    const label = document.createElement('label');
    label.className = 'check-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const span = document.createElement('span');
    span.textContent = text;
    label.append(checkbox, span);
    return { label, checkbox };
  }

  function renderManualCandidateEntry(company) {
    const details = document.createElement('details');
    details.className = 'advanced-entry';
    const summary = document.createElement('summary');
    summary.textContent = '高级：本人核查并补录岗位证据（不是自动检索）';
    details.append(summary);
    const form = document.createElement('form');
    form.className = 'manual-form';
    form.noValidate = true;
    const grid = div('manual-grid');
    const officialId = manualInput({ placeholder: '官方岗位 ID，例如 12345' });
    const title = manualInput({ placeholder: '岗位名称' });
    const city = manualInput({ placeholder: '城市（可选）' });
    const sourceUrl = manualInput({
      type: 'url',
      placeholder: 'https://official.example.invalid/job',
    });
    const checkedAt = manualInput({ value: new Date().toISOString() });
    const evidence = manualTextarea({
      placeholder: '本人核查的匹配依据、硬性资格、来源说明；不能编造',
      rows: 3,
    });
    grid.append(
      manualField('官方岗位 ID', officialId),
      manualField('岗位名称', title),
      manualField('城市（可选）', city),
      manualField('官方来源链接', sourceUrl),
      manualField('核查时间（ISO）', checkedAt),
      manualField('匹配与资格证据', evidence),
    );
    form.append(grid);
    const confirmation = manualConfirmation(
      '我确认这是本人核查并手动录入的官方岗位证据，不是自动检索结果，也不代表已投递。',
    );
    form.append(confirmation.label);
    const error = document.createElement('p');
    error.className = 'form-error';
    error.hidden = true;
    const submit = actionButton('记录此岗位证据', 'primary small', () => {
      void submitManualCandidate(company, {
        officialId: officialId.value,
        title: title.value,
        city: city.value,
        sourceUrl: sourceUrl.value,
        checkedAt: checkedAt.value,
        matchEvidence: evidence.value,
        confirmed: confirmation.checkbox.checked,
        error,
      });
    });
    submit.type = 'button';
    form.addEventListener('submit', (event) => event.preventDefault());
    form.append(error, submit);
    details.append(form);
    return details;
  }

  async function submitManualCandidate(company, values) {
    showInlineError(values.error, '');
    if (!values.confirmed) {
      showInlineError(values.error, '请先确认这是本人手动核查记录。');
      return;
    }
    try {
      const ok = await runCommand(
        COMMAND.recordCandidates,
        {
          companyId: company.id,
          positions: [
            {
              officialId: values.officialId,
              title: values.title,
              city: values.city,
              sourceUrl: values.sourceUrl,
              checkedAt: values.checkedAt,
              matchEvidence: values.matchEvidence,
            },
          ],
          confirmedByUser: true,
        },
        { successMessage: '已记录本人核查的岗位证据；这不是自动检索或投递。' },
      );
      if (ok) return;
    } catch (error) {
      showInlineError(values.error, error.message || '无法记录岗位证据。');
    }
  }

  function renderNoPositionsEntry(company) {
    const details = document.createElement('details');
    details.className = 'advanced-entry danger-entry';
    const summary = document.createElement('summary');
    summary.textContent = '高级：本人核查确无合适岗位（必须附来源证据）';
    details.append(summary);
    const note = document.createElement('p');
    note.className = 'muted small';
    note.textContent =
      '只有本人完成可靠核查并有来源证据时才可记录。登录失败、访问受阻、时间不足都不能当作“没有符合职位”。';
    details.append(note);
    const form = document.createElement('form');
    form.className = 'manual-form';
    form.noValidate = true;
    const grid = div('manual-grid');
    const reason = manualInput({ placeholder: '为什么没有合适岗位，例如资格或地点不符' });
    const sourceUrl = manualInput({
      type: 'url',
      placeholder: 'https://official.example.invalid/jobs',
    });
    const checkedAt = manualInput({ value: new Date().toISOString() });
    const resultText = manualTextarea({
      placeholder: '保留官方页面核查结果原文；不要只写“没有岗位”',
      rows: 3,
    });
    grid.append(
      manualField('无合适岗位原因', reason),
      manualField('官方来源链接', sourceUrl),
      manualField('核查时间（ISO）', checkedAt),
      manualField('核查结果原文', resultText),
    );
    form.append(grid);
    const confirmation = manualConfirmation(
      '我确认本人已核查官方招聘页并保留来源证据；这不是系统自动检索，也不是“检索受阻”。',
    );
    form.append(confirmation.label);
    const error = document.createElement('p');
    error.className = 'form-error';
    error.hidden = true;
    const submit = actionButton('记录本人核查的无合适岗位', 'danger small', () => {
      void submitNoPositions(company, {
        reason: reason.value,
        sourceUrl: sourceUrl.value,
        checkedAt: checkedAt.value,
        resultText: resultText.value,
        confirmed: confirmation.checkbox.checked,
        error,
      });
    });
    submit.type = 'button';
    form.append(error, submit);
    details.append(form);
    return details;
  }

  async function submitNoPositions(company, values) {
    showInlineError(values.error, '');
    if (!values.confirmed) {
      showInlineError(values.error, '请先确认这是本人核查记录并附有来源证据。');
      return;
    }
    try {
      const ok = await runCommand(
        COMMAND.recordNoPositions,
        {
          companyId: company.id,
          evidence: {
            reason: values.reason,
            sourceUrl: values.sourceUrl,
            checkedAt: values.checkedAt,
            resultText: values.resultText,
          },
          confirmedByUser: true,
        },
        { successMessage: '已记录本人核查的无合适岗位证据；不会冒充自动检索。' },
      );
      if (ok) return;
    } catch (error) {
      showInlineError(values.error, error.message || '无法记录无合适岗位证据。');
    }
  }

  function renderJobsSection(company) {
    const section = div('detail-section');
    const selectedCount = state.jobSelection.length;
    section.append(sectionTitleRow('岗位候选', `${company.jobs.length} 个 · 已选 ${selectedCount}/3`));
    section.append(
      textNode(
        '本人选择 1～3 个岗位，按顺序表示优先级。候选与推荐都不等于已投递。',
        'muted small',
      ),
    );
    if (company.jobs.length === 0) {
      const empty = div('empty-state');
      const strong = document.createElement('strong');
      strong.textContent = company.search.state === 'blocked' ? '检索受阻，暂无岗位候选' : '暂无岗位候选';
      const body = document.createElement('span');
      body.textContent =
        company.search.state === 'blocked'
          ? '这不是“没有符合职位”；等待检索恢复后重试。'
          : '等待检索完成后再选择。';
      empty.append(strong, body);
      section.append(empty);
      return section;
    }

    const jobs = div('jobs');
    company.jobs.forEach((job) => {
      const card = div('job-card');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'job-check';
      checkbox.disabled = !job.id || !canSelectJobs(company);
      checkbox.checked = state.jobSelection.includes(job.id);
      checkbox.addEventListener('change', () => {
        toggleJob(job, checkbox);
      });
      const main = div('job-main');
      const titleRow = div('job-title-row');
      const jobTitle = document.createElement('span');
      jobTitle.className = 'job-title';
      jobTitle.textContent = job.title;
      const priority = badge('未选', 'neutral');
      priority.className += ' job-priority';
      titleRow.append(jobTitle, priority);
      main.append(titleRow);

      const meta = div('job-meta');
      if (job.jobId) meta.append(textNode(`岗位 ID：${job.jobId}`));
      if (job.city) meta.append(textNode(job.city));
      const jobStatus = jobStatusMeta(job.status);
      meta.append(badge(jobStatus.label, jobStatus.tone));
      main.append(meta);

      if (job.officialUrl) {
        const link = actionButton('打开官方岗位页', 'ghost small', () => {
          openExternal(job.officialUrl);
        });
        main.append(link);
      }
      if (job.evidence) {
        const details = document.createElement('details');
        details.className = 'job-evidence';
        const summary = document.createElement('summary');
        summary.textContent = '匹配与资格证据';
        const evidence = document.createElement('p');
        evidence.textContent = job.evidence;
        details.append(summary, evidence);
        main.append(details);
      }
      if (job.skipReason) {
        main.append(textNode(`本人跳过原因：${job.skipReason}`, 'muted small'));
      }
      if (job.submission?.reportedAt) {
        main.append(
          textNode(
            `本人记录提交：${formatTime(job.submission.reportedAt)}${
              job.submission.reference ? ` · ${job.submission.reference}` : ''
            }`,
            'muted small',
          ),
        );
      }
      if (job.verification?.verifiedAt) {
        main.append(
          textNode(`官网已核验：${formatTime(job.verification.verifiedAt)}`, 'muted small'),
        );
      }
      const jobActions = div('detail-actions');
      if (canMarkReady(company, job)) {
        jobActions.append(
          actionButton('确认该岗位可送本人提交', 'outline small', () => {
            void runCommand(
              COMMAND.markReady,
              { companyId: company.id, jobId: job.id, confirmedByUser: true },
              { successMessage: '已标记为可送本人提交；不会自动提交。' },
            );
          }),
        );
      }
      if (company.activePositionId === job.id && hasBlockingIssues(company)) {
        jobActions.append(textNode('仍有阻断问题，不能送交本人提交。', 'form-error'));
      }
      if (canSkipJob(company, job)) {
        jobActions.append(
          actionButton('跳过此岗位', 'ghost small', () => {
            openSkipDialog(company, job);
          }),
        );
      }
      if (jobActions.childNodes.length > 0) main.append(jobActions);
      if (!job.id) {
        main.append(textNode('数据缺少岗位 ID，不能选择该候选。', 'form-error'));
      }
      card.append(checkbox, main);
      jobs.append(card);
      state.jobUi.set(job.id || `missing-${company.jobs.indexOf(job)}`, { checkbox, badge: priority, job });
    });
    section.append(jobs);

    const bar = div('selection-bar');
    const orderBox = document.createElement('div');
    orderBox.className = 'selection-order';
    const save = actionButton('保存所选岗位', 'primary small', () => {
      void saveJobSelection(company);
    });
    save.dataset.command = 'selectJobs';
    const dirtyNote = textNode('', 'muted small');
    const right = div('');
    right.append(save, dirtyNote);
    bar.append(orderBox, right);
    section.append(bar);
    if (!canSelectJobs(company)) {
      section.append(
        textNode(
          '当前阶段不能更改岗位选择；只有当前活动公司处于“待选岗位”时才能保存 1～3 个岗位。',
          'muted small',
        ),
      );
    }
    state.selectionUi = { orderBox, save, dirtyNote };
    syncJobSelectionUI();
    return section;
  }

  function toggleJob(job, checkbox) {
    if (!job.id || !canSelectJobs(selectedCompany())) return;
    const index = state.jobSelection.indexOf(job.id);
    if (index >= 0) {
      state.jobSelection.splice(index, 1);
      state.jobsDirty = true;
    } else {
      if (state.jobSelection.length >= 3) {
        checkbox.checked = false;
        state.selectionNotice = '最多选择 3 个岗位。';
        syncJobSelectionUI();
        return;
      }
      state.jobSelection.push(job.id);
      state.jobsDirty = true;
      state.selectionNotice = '';
    }
    syncJobSelectionUI();
  }

  function syncJobSelectionUI() {
    const company = selectedCompany();
    if (!company) return;
    const selectedSet = new Set(state.jobSelection);
    const selectable = canSelectJobs(company);
    for (const { checkbox, badge: priorityBadge, job } of state.jobUi.values()) {
      if (!job.id) continue;
      checkbox.checked = selectedSet.has(job.id);
      const index = state.jobSelection.indexOf(job.id);
      if (index >= 0) {
        priorityBadge.textContent = `优先 ${index + 1}`;
        priorityBadge.dataset.tone = 'primary';
      } else {
        priorityBadge.textContent = '未选';
        priorityBadge.dataset.tone = 'neutral';
      }
      checkbox.disabled = !selectable || (!selectedSet.has(job.id) && state.jobSelection.length >= 3);
    }
    const ui = state.selectionUi;
    if (!ui) return;
    ui.orderBox.replaceChildren();
    if (state.jobSelection.length === 0) {
      ui.orderBox.append(textNode('尚未选择岗位。勾选 1～3 个候选后按顺序保存。', 'muted small'));
    } else {
      const label = document.createElement('div');
      label.className = 'muted small';
      label.textContent = '优先顺序（可调整）：';
      ui.orderBox.append(label);
      state.jobSelection.forEach((jobId, index) => {
        const job = company.jobs.find((item) => item.id === jobId);
        const row = div('code-row');
        row.append(textNode(`${index + 1}. ${job?.title ?? jobId}`));
        const up = actionButton('↑', 'small ghost', () => {
          moveSelection(index, -1);
        });
        up.setAttribute('aria-label', `上移 ${job?.title ?? jobId}`);
        const down = actionButton('↓', 'small ghost', () => {
          moveSelection(index, 1);
        });
        down.setAttribute('aria-label', `下移 ${job?.title ?? jobId}`);
        up.disabled = !selectable || index === 0;
        down.disabled = !selectable || index === state.jobSelection.length - 1;
        row.append(up, down);
        ui.orderBox.append(row);
      });
      if (state.selectionNotice) {
        ui.orderBox.append(textNode(state.selectionNotice, 'form-error'));
      }
    }
    ui.save.disabled = !selectable || !state.jobsDirty || state.jobSelection.length < 1;
    ui.dirtyNote.textContent = !selectable
      ? '当前阶段不能保存岗位选择。'
      : state.jobsDirty
        ? '有未保存的岗位选择；未保存前不会生效。'
        : '已保存；修改后需要重新保存。';
  }

  function moveSelection(index, delta) {
    if (!canSelectJobs(selectedCompany())) return;
    const next = index + delta;
    if (next < 0 || next >= state.jobSelection.length) return;
    const [item] = state.jobSelection.splice(index, 1);
    state.jobSelection.splice(next, 0, item);
    state.jobsDirty = true;
    syncJobSelectionUI();
  }

  function renderApplicationSection(company) {
    const section = div('detail-section');
    section.append(sectionTitleRow('投递结果', '本人记录与官网核验分开'));
    const summary = describeCompanyApplication(company);
    const summaryRow = div('application-label');
    const appMeta = applicationMeta(company.application.kind);
    summaryRow.append(textNode(summary));
    if (!summary.startsWith(appMeta.label)) {
      summaryRow.append(badge(appMeta.label, appMeta.tone));
    }
    section.append(summaryRow);

    const grid = document.createElement('dl');
    grid.className = 'fact-grid';
    appendFact(grid, '提交动作', '面板没有“提交官网”按钮；最终提交只能由本人在招聘官网完成。');
    appendFact(
      grid,
      '本人记录',
      company.application.reportedAt
        ? `${formatTime(company.application.reportedAt)}${company.application.note ? ` · ${company.application.note}` : ''}`
        : '尚无本人“已提交”报告。',
    );
    appendFact(
      grid,
      '官网核验',
      company.application.verifiedAt
        ? `${formatTime(company.application.verifiedAt)} · 已由官网记录核验`
        : '未核验。本人报告不会自动变成官网核验。',
    );
    if (company.historicalSubmission) {
      appendFact(grid, '历史记录来源', '本人历史报告（公司级记录；未补写虚构岗位 ID）');
      appendFact(grid, '历史说明', company.historicalSubmission.reference || '未提供说明。');
    }
    if (company.application.kind === 'no_suitable_jobs') {
      appendFact(grid, '无岗位依据', '后端必须有可靠检索来源与时间；不能因检索受阻而跳过。');
    }
    section.append(grid);

    const actions = div('detail-actions');
    const report = actionButton('报告我已提交', 'outline small', () => {
      openSubmitDialog(company);
    });
    report.disabled = !canReportSubmitted(company);
    report.title = report.disabled
      ? '只有当前活动岗位处于“待本人提交”、无阻断问题且本人已完成官网提交时才能记录。'
      : '只记录本人报告，不会代提交或代核验。';
    actions.append(report);

    if (canReportHistorical(company)) {
      const historical = actionButton('记录历史本人已投递', 'outline small', () => {
        openHistoricalDialog(company);
      });
      historical.title = '适用于尚未启动且没有可靠岗位 ID 的历史记录；只写入本人报告，不等同官网核验。';
      actions.append(historical);
    }

    if (company.application.kind === 'self_reported') {
      actions.append(textNode('这是本人记录，仍待官网核验；不会因此重复投递。', 'muted small'));
    }
    if (company.application.kind === 'blocked' || company.search.state === 'blocked') {
      actions.append(textNode('检索受阻不能当作无岗位，请先处理登录或访问问题。', 'muted small'));
    }
    if (company.status === 'awaiting_submit') {
      actions.append(
        textNode(
          '岗位仍在待本人提交阶段；记录回执前请先在招聘官网由本人完成提交。',
          'muted small',
        ),
      );
    }
    section.append(actions);
    return section;
  }

  function renderCompanyIssuesSection(company) {
    const section = div('detail-section');
    const issues = (state.workbench?.issues ?? []).filter(
      (issue) => issue.status !== 'resolved' && issue.companyId === company.id,
    );
    section.append(sectionTitleRow('本任务问题', `${issues.length} 个未决`));
    if (issues.length === 0) {
      section.append(textNode('当前没有未决问题。关闭问题窗口也不会改变任务状态。', 'muted small'));
      return section;
    }
    const list = div('facts-list');
    issues.slice(0, 4).forEach((issue) => {
      const row = div('code-row');
      row.append(textNode(issue.title), badge(issueSeverityMeta(issue.severity).label, issueSeverityMeta(issue.severity).tone));
      list.append(row);
    });
    section.append(list);
    if (issues.length > 4) {
      section.append(textNode(`另有 ${issues.length - 4} 个问题，请在汇总窗口查看。`, 'muted small'));
    }
    section.append(
      actionButton('打开本任务问题', 'ghost small', () => {
        openIssues(company.id);
      }),
    );
    return section;
  }

  function reportableJobs(company) {
    if (
      !isActiveAndRunning(company) ||
      company.status !== 'awaiting_submit' ||
      hasBlockingIssues(company)
    ) {
      return [];
    }
    const active = company.jobs.find((job) => job.id === company.activePositionId);
    if (
      !active ||
      active.status !== 'awaiting_submit' ||
      active.status === 'verified' ||
      active.status === 'self_reported'
    ) {
      return [];
    }
    return [active];
  }

  function openSubmitDialog(company) {
    if (!isReadyForCommands()) return;
    const jobs = reportableJobs(company);
    if (jobs.length === 0) {
      showBanner(
        'warning',
        '当前不能记录提交回执',
        '只有当前活动岗位处于“待本人提交”、无阻断问题且本人已完成官网提交时才能记录。',
      );
      return;
    }
    state.pendingSubmitCompanyId = company.id;
    state.submitJobs = jobs;
    el.submitFormError.hidden = true;
    el.submitFormError.textContent = '';
    el.submitConfirmation.checked = false;
    state.submitNoteDraft = '';
    el.submitJobField.replaceChildren();
    const label = document.createElement('label');
    label.className = 'field-label';
    label.textContent = '岗位';
    const select = document.createElement('select');
    select.className = 'native-select';
    select.id = 'submit-job-select';
    select.required = true;
    for (const job of jobs) {
      const option = document.createElement('option');
      option.value = job.id;
      option.textContent = job.title;
      select.append(option);
    }
    label.append(select);
    el.submitJobField.append(label);
    state.submitNoteHandle?.update({ value: '' });
    if (!state.submitNoteHandle) {
      state.submitNoteHandle = mountTextField(el.submitNoteField, {
        label: '备注（可选）',
        value: '',
        placeholder: '例如：官网申请编号或提交时间',
        onChange: (value) => {
          state.submitNoteDraft = value;
        },
      });
    }
    updateSubmitButton();
    openDialog(el.submitDialog);
  }

  function updateSubmitButton() {
    el.reportSubmittedButton.disabled =
      !isReadyForCommands() ||
      state.submitJobs.length === 0 ||
      !el.submitConfirmation.checked;
  }

  async function reportSubmitted() {
    if (!state.pendingSubmitCompanyId) return;
    const select = document.querySelector('#submit-job-select');
    const jobId = select instanceof HTMLSelectElement ? select.value : '';
    if (!jobId) {
      showInlineError(el.submitFormError, '请选择要记录的岗位。');
      return;
    }
    if (!el.submitConfirmation.checked) {
      showInlineError(el.submitFormError, '请先由本人确认已在官网完成提交。');
      return;
    }
    showInlineError(el.submitFormError, '');
    const ok = await runCommand(
      COMMAND.reportSubmitted,
      {
        companyId: state.pendingSubmitCompanyId,
        jobId,
        confirmedByUser: true,
        note: state.submitNoteDraft,
      },
      { successMessage: '已记录本人提交；仍待官网核验，不会自动重投。' },
    );
    if (ok) {
      state.pendingSubmitCompanyId = null;
      closeDialog(el.submitDialog);
      state.submitNoteHandle?.update({ value: '' });
      state.submitNoteDraft = '';
    }
  }

  function canReportHistorical(company) {
    return Boolean(
      isReadyForCommands() &&
        company?.coreStatus === 'queued' &&
        company.application?.kind === 'none' &&
        !company.historicalSubmission,
    );
  }

  function openHistoricalDialog(company) {
    if (!canReportHistorical(company)) return;
    state.pendingHistoricalCompanyId = company.id;
    state.historicalNoteDraft = '';
    el.historicalFormError.hidden = true;
    el.historicalFormError.textContent = '';
    el.historicalConfirmation.checked = false;
    if (!state.historicalNoteHandle) {
      state.historicalNoteHandle = mountTextField(el.historicalNoteField, {
        label: '历史投递说明（必填）',
        value: '',
        placeholder: '例如：本人确认历史上已完成投递；岗位官方 ID 待补，禁止重投。',
        multiline: true,
        rows: 4,
        onChange: (value) => {
          state.historicalNoteDraft = value;
          updateHistoricalButton();
        },
      });
    } else {
      state.historicalNoteHandle.update({ value: '' });
    }
    updateHistoricalButton();
    openDialog(el.historicalDialog);
  }

  function updateHistoricalButton() {
    el.reportHistoricalButton.disabled =
      !isReadyForCommands() ||
      !state.pendingHistoricalCompanyId ||
      !el.historicalConfirmation.checked ||
      !state.historicalNoteDraft.trim();
  }

  async function reportHistoricalSubmission() {
    if (!state.pendingHistoricalCompanyId) return;
    if (!state.historicalNoteDraft.trim()) {
      showInlineError(el.historicalFormError, '请填写历史投递说明。');
      return;
    }
    if (!el.historicalConfirmation.checked) {
      showInlineError(el.historicalFormError, '请先由本人确认这条历史记录属实。');
      return;
    }
    showInlineError(el.historicalFormError, '');
    const ok = await runCommand(
      COMMAND.reportHistoricalSubmission,
      {
        companyId: state.pendingHistoricalCompanyId,
        note: state.historicalNoteDraft,
        confirmedByUser: true,
      },
      { successMessage: '已记录历史本人投递；不会自动重投，也不会变成官网核验。' },
    );
    if (ok) {
      state.pendingHistoricalCompanyId = null;
      state.historicalNoteDraft = '';
      state.historicalNoteHandle?.update({ value: '' });
      closeDialog(el.historicalDialog);
    }
  }

  function openDeferDialog(company) {
    if (!isReadyForCommands()) return;
    state.pendingDeferCompanyId = company.id;
    state.deferReasonDraft = '';
    el.deferFormError.hidden = true;
    el.deferFormError.textContent = '';
    if (!state.deferHandle) {
      state.deferHandle = mountTextField(el.deferReasonField, {
        label: '暂挂原因（可选）',
        value: '',
        placeholder: '例如：等待本人补资料 / 稍后处理登录',
        onChange: (value) => {
          state.deferReasonDraft = value;
        },
      });
    }
    state.deferHandle.update({ value: '' });
    openDialog(el.deferDialog);
  }

  async function deferCompany() {
    if (!state.pendingDeferCompanyId) return;
    showInlineError(el.deferFormError, '');
    const ok = await runCommand(
      COMMAND.deferCompany,
      {
        companyId: state.pendingDeferCompanyId,
        reason: state.deferReasonDraft,
      },
      { successMessage: '已暂挂此公司，现场已保留；不会标记完成。' },
    );
    if (ok) {
      state.pendingDeferCompanyId = null;
      closeDialog(el.deferDialog);
    }
  }

  function openSkipDialog(company, job) {
    if (!company?.id) return;
    state.pendingSkip = {
      type: job ? 'job' : 'company',
      companyId: company.id,
      jobId: job?.id ?? '',
      label: job ? `岗位“${job.title}”` : `公司“${company.name}”`,
    };
    state.skipReasonDraft = '';
    state.skipHandle.update({ value: '' });
    el.skipConfirmation.checked = false;
    el.skipDescription.textContent = job
      ? `记录跳过${state.pendingSkip.label}。必须填写本人真实原因；不会写成“没有符合职位”，也不删除已有问题。`
      : `记录跳过${state.pendingSkip.label}。必须填写本人真实原因；不会写成“没有符合职位”，也不会删除已有问题。`;
    showInlineError(el.skipFormError, '');
    updateSkipButton();
    openDialog(el.skipDialog);
  }

  function updateSkipButton() {
    el.skipConfirmButton.disabled =
      !isReadyForCommands() ||
      !state.pendingSkip ||
      !el.skipConfirmation.checked;
  }

  async function confirmSkip() {
    if (!state.pendingSkip) return;
    const reason = state.skipReasonDraft.trim();
    if (!reason) {
      showInlineError(el.skipFormError, '请填写本人跳过该岗位/公司的真实原因。');
      return;
    }
    if (!el.skipConfirmation.checked) {
      showInlineError(el.skipFormError, '请先确认这是本人主动跳过，而不是没有合适职位。');
      return;
    }
    showInlineError(el.skipFormError, '');
    const pending = state.pendingSkip;
    const isJob = pending.type === 'job';
    const ok = await runCommand(
      isJob ? COMMAND.skipJob : COMMAND.skipCompany,
      isJob
        ? {
            companyId: pending.companyId,
            jobId: pending.jobId,
            reason,
            confirmedByUser: true,
          }
        : { companyId: pending.companyId, reason, confirmedByUser: true },
      {
        successMessage: isJob
          ? '已记录本人跳过该岗位；不会自动等同于公司完成或没有职位。'
          : '已记录本人跳过整家公司；不会写成“没有符合职位”。',
      },
    );
    if (ok) {
      state.pendingSkip = null;
      closeDialog(el.skipDialog);
    }
  }

  function openIssues(companyId, options = {}) {
    if (!state.workbench) {
      showBanner('warning', '任务状态未加载', '请先恢复本地服务并刷新，然后再处理问题。');
      return;
    }
    state.issuesCompanyFilter = companyId ?? null;
    state.issuesAutoNote = options.auto ? '已完成一轮填写/复核，问题已集中到这里。' : '';
    state.answeringIssueId = null;
    renderIssues();
    openDialog(el.issuesDialog);
  }

  function renderIssues() {
    el.issuesList.replaceChildren();
    renderEmpty(el.issuesEmpty, '', '');
    el.issuesEmpty.replaceChildren();
    const company = state.issuesCompanyFilter
      ? (state.workbench?.companies ?? []).find((item) => item.id === state.issuesCompanyFilter)
      : null;
    el.issuesScope.hidden = !company;
    el.issuesScope.textContent = company
      ? `仅显示“${company.name}”的未决问题。关闭窗口不会解决它们。`
      : '';
    if (state.issuesAutoNote) {
      el.issuesScope.hidden = false;
      el.issuesScope.textContent = company
        ? `${state.issuesAutoNote} 仅显示“${company.name}”的未决问题。`
        : state.issuesAutoNote;
    }

    if (!state.workbench) {
      renderEmpty(el.issuesEmpty, '无法读取问题', '本地服务状态不可用。');
      return;
    }
    const allIssues = state.workbench.issues.filter(
      (issue) => issue.status !== 'resolved' && (!company || issue.companyId === company.id),
    );
    const bySeverity = new Map();
    for (const issue of allIssues) {
      const key = issue.severity;
      if (!bySeverity.has(key)) bySeverity.set(key, []);
      bySeverity.get(key).push(issue);
    }
    let count = 0;
    for (const severity of ['required', 'confirm', 'suggestion']) {
      const issues = bySeverity.get(severity) ?? [];
      if (issues.length === 0) continue;
      const group = div('issue-group-title');
      group.textContent = `${issueSeverityMeta(severity).label} · ${issues.length}`;
      el.issuesList.append(group);
      for (const issue of issues) {
        el.issuesList.append(issueCard(issue));
        count += 1;
      }
    }
    if (count === 0) {
      renderEmpty(
        el.issuesEmpty,
        '当前没有未决问题',
        '关闭窗口或会话空闲都不会自动完成任务；已解决的问题不会重新出现。',
      );
    }
  }

  function issueCard(issue) {
    const card = div('issue-card');
    card.dataset.severity = issue.severity;
    const top = div('issue-top');
    const titleWrap = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'issue-title';
    title.textContent = issue.title;
    const meta = div('issue-meta');
    const company = (state.workbench?.companies ?? []).find((item) => item.id === issue.companyId);
    if (company) meta.append(textNode(company.name));
    if (issue.field) meta.append(textNode(`字段：${issue.field}`));
    if (issue.jobId) {
      const job = company?.jobs.find((item) => item.id === issue.jobId);
      if (job) meta.append(textNode(`岗位：${job.title}`));
    }
    meta.append(badge(issueSeverityMeta(issue.severity).label, issueSeverityMeta(issue.severity).tone));
    meta.append(badge(issueStatusMeta(issue.status).label, issueStatusMeta(issue.status).tone));
    if (issue.blocking) meta.append(badge('阻断', 'error'));
    titleWrap.append(title, meta);
    top.append(titleWrap);
    card.append(top);

    if (issue.detail) {
      const detail = div('issue-detail');
      detail.textContent = issue.detail;
      card.append(detail);
    }
    if (issue.evidence) {
      const details = document.createElement('details');
      details.className = 'job-evidence';
      const summary = document.createElement('summary');
      summary.textContent = '依据';
      const pre = document.createElement('pre');
      pre.className = 'raw-text';
      pre.textContent = issue.evidence;
      details.append(summary, pre);
      card.append(details);
    }
    if (issue.answer) {
      const answer = div('issue-answer');
      answer.textContent = `已补充：${issue.answer}`;
      card.append(answer);
    }

    const actions = div('issue-actions');
    const isAnswering = state.answeringIssueId === issue.id;
    const canAnswer = canAnswerIssue();
    const answerButton = actionButton(
      isAnswering
        ? '收起补充'
        : issue.status === 'answered'
          ? '更新回答'
          : issue.status === 'deferred'
            ? '继续补充'
            : '补充/回答',
      'outline small',
      () => {
        state.answeringIssueId = isAnswering ? null : issue.id;
        renderIssues();
      },
    );
    answerButton.disabled = !canAnswer || !issue.id;
    actions.append(answerButton);
    if (issue.status === 'answered') {
      const resolve = actionButton('我已核对解决', 'primary small', () => {
        void resolveIssue(issue, 'resolve');
      });
      resolve.disabled = !canAnswer || !issue.id;
      actions.append(resolve);
    }
    if (issue.status !== 'deferred' && issue.status !== 'answered') {
      const defer = actionButton('稍后处理', 'ghost small', () => {
        void resolveIssue(issue, 'defer');
      });
      defer.disabled = !isReadyForCommands() || !issue.id;
      actions.append(defer);
    }
    if (!canAnswer && issue.status !== 'deferred') {
      actions.append(
        textNode('队列暂停中：恢复队列后才能补充、核对解决或改变流程状态。', 'muted small'),
      );
    }
    card.append(actions);

    if (isAnswering) {
      const compose = div('issue-compose');
      const textarea = document.createElement('textarea');
      textarea.rows = 3;
      textarea.placeholder = '按本人真实情况补充；不会自动推广为其他公司的事实。';
      textarea.value = state.issueDrafts.get(issue.id) ?? issue.answer ?? '';
      textarea.addEventListener('input', () => {
        state.issueDrafts.set(issue.id, textarea.value);
      });
      const save = actionButton('保存这条补充', 'primary small', () => {
        void resolveIssue(issue, 'answer', textarea.value);
      });
      save.disabled = !isReadyForCommands();
      compose.append(textarea, save);
      card.append(compose);
      window.setTimeout(() => textarea.focus(), 0);
    }
    return card;
  }

  async function resolveIssue(issue, action, answer = '') {
    if (!issue.id) return;
    if (action === 'answer' && answer.trim().length === 0) {
      showBanner('warning', '补充不能为空', '请填写这条问题的本人回答，或选择稍后处理。');
      return;
    }
    if (action === 'resolve' && issue.status !== 'answered') {
      showBanner('warning', '仍不能标记已解决', '只有已经补充过、状态为“已补充，待复核”的问题才能由本人核对解决。');
      return;
    }
    const input =
      action === 'answer'
        ? { issueId: issue.id, action, answer }
        : action === 'resolve'
          ? { issueId: issue.id, action, confirmedByUser: true }
          : { issueId: issue.id, action };
    const ok = await runCommand(COMMAND.resolveIssue, input, {
      successMessage:
        action === 'answer'
          ? '已保存这条补充；问题状态变为“已补充，待复核”，不会自动解决。'
          : action === 'resolve'
            ? '已由本人核对解决；没有删除历史问题记录。'
            : '已标记稍后处理；问题仍保留，不会自动解决。',
    });
    if (ok) {
      state.answeringIssueId = null;
      if (action === 'answer') state.issueDrafts.delete(issue.id);
      renderIssues();
    }
  }

  function maybeAutoOpenDigest() {
    const digest = state.workbench?.issueDigest;
    if (!digest || !digest.ready) return;
    const digestKey = `${state.directory ?? ''}\u0000${digest.id}`;
    if (state.seenDigests.has(digestKey)) return;
    if (state.workbench.issues.every((issue) => issue.status === 'resolved')) return;
    if (document.querySelector('dialog[open]')) return;
    if (state.commandBusy || !state.hostReady) return;
    if (isUserTyping()) return;
    state.seenDigests.add(digestKey);
    openIssues(null, { auto: true });
  }

  function renderFacts() {
    el.factsList.replaceChildren();
    const facts = state.workbench?.facts ?? [];
    el.factsCount.textContent = String(facts.length);
    if (facts.length === 0) {
      renderEmpty(
        el.factsEmpty,
        '尚无资料条目',
        state.directory ? '导入一条最小字段后，它会以待确认状态显示在这里。' : '请先打开项目。',
      );
      return;
    }
    renderEmpty(el.factsEmpty, '', '');
    const groups = new Map();
    for (const fact of facts) {
      const key = fact.entityId ? `entity:${fact.entityId}` : `section:${fact.section}`;
      if (!groups.has(key)) {
        groups.set(key, {
          title: fact.entityId
            ? `经历：${fact.entityId}`
            : profileSectionMeta(fact.section).label,
          entityId: fact.entityId || '',
          facts: [],
        });
      }
      groups.get(key).facts.push(fact);
    }
    for (const group of groups.values()) {
      const groupNode = document.createElement('section');
      groupNode.className = 'fact-group';
      const head = div('fact-group-head');
      const heading = document.createElement('h4');
      heading.textContent = group.title;
      head.append(heading, badge(`${group.facts.length} 条`, 'neutral'));
      groupNode.append(head);
      if (group.entityId) {
        groupNode.append(
          textNode(
            '同一经历编号下的内容与职责会归在一起，不会与其他项目的同名字段混合。',
            'muted small',
          ),
        );
      }
      for (const fact of group.facts) {
        groupNode.append(factCard(fact, group.entityId));
      }
      el.factsList.append(groupNode);
    }
  }

  function factCard(fact, groupEntityId) {
    const card = div('fact-card');
    const head = div('fact-head');
    const titleWrap = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'fact-title';
    title.textContent = fact.label;
    const sub = div('fact-sub');
    const section = profileSectionMeta(fact.section);
    sub.append(textNode(section.label));
    if (fact.entityId && !groupEntityId) sub.append(textNode(`经历：${fact.entityId}`));
    if (fact.source) sub.append(textNode(`来源：${fact.source}`));
    if (fact.updatedAt) sub.append(textNode(`更新：${formatTime(fact.updatedAt)}`));
    titleWrap.append(title, sub);
    const status = fact.confirmed
      ? badge('已确认', 'success')
      : badge('已识别待确认', 'warning');
    head.append(titleWrap, status);
    card.append(head);

    if (fact.sensitive) {
      card.append(textNode('敏感资料：不用于岗位检索。', 'warning-note'));
    }
    const rawLabel = document.createElement('div');
    rawLabel.className = 'fact-original-label';
    rawLabel.textContent = '原文（原样保留）';
    const raw = document.createElement('pre');
    raw.className = 'raw-text';
    raw.textContent = fact.rawText || '（空）';
    card.append(rawLabel, raw);

    if (fact.confirmed && fact.confirmedText && fact.confirmedText !== fact.rawText) {
      const confirmedLabel = document.createElement('div');
      confirmedLabel.className = 'fact-original-label';
      confirmedLabel.textContent = '已确认文本';
      const confirmedText = document.createElement('pre');
      confirmedText.className = 'raw-text';
      confirmedText.textContent = fact.confirmedText;
      card.append(confirmedLabel, confirmedText);
    }

    const actions = div('detail-actions');
    const revise = actionButton('修订这条资料', 'ghost small', () => {
      openFactDialog(fact);
    });
    revise.disabled = !isReadyForCommands() || !fact.id || fact.version === undefined;
    actions.append(revise);
    if (!fact.confirmed) {
      const confirm = actionButton('确认这条资料', 'outline small', () => {
        void confirmFact(fact);
      });
      confirm.disabled = !isReadyForCommands() || !fact.id;
      actions.append(confirm);
    }
    if (!fact.id) actions.append(textNode('缺少资料 ID。', 'form-error'));
    card.append(actions);
    return card;
  }

  function openFactDialog(fact) {
    if (!fact?.id || fact.version === undefined) return;
    state.editingFact = fact;
    state.factDrafts = {
      label: fact.label,
      rawText: fact.rawText,
      entityId: fact.entityId || '',
    };
    state.factHandles.label.update({ value: fact.label });
    state.factHandles.raw.update({ value: fact.rawText });
    state.factHandles.entity.update({ value: fact.entityId || '' });
    showInlineError(el.factFormError, '');
    openDialog(el.factDialog);
  }

  async function saveFactRevision() {
    const fact = state.editingFact;
    if (!fact) return;
    const label = state.factDrafts.label ?? '';
    const rawText = state.factDrafts.rawText ?? '';
    const entityId = (state.factDrafts.entityId ?? '').trim();
    const patch = {};
    if (label !== fact.label) patch.label = label;
    if (rawText !== fact.rawText) patch.rawText = rawText;
    if (entityId !== (fact.entityId || '')) patch.entityId = entityId || null;
    if (Object.keys(patch).length === 0) {
      showInlineError(el.factFormError, '没有修改任何字段。');
      return;
    }
    showInlineError(el.factFormError, '');
    const ok = await runCommand(
      COMMAND.reviseFact,
      {
        factId: fact.id,
        expectedVersion: fact.version,
        patch,
      },
      { successMessage: '资料已修订；原确认已失效，请核对后重新确认。' },
    );
    if (ok) {
      state.editingFact = null;
      closeDialog(el.factDialog);
      renderFacts();
    }
  }

  async function enqueueCompany() {
    showInlineError(el.queueFormError, '');
    try {
      const payload = {
        url: state.queueDrafts.url ?? '',
        referralCode: state.queueDrafts.code ?? '',
        companyName: state.queueDrafts.company ?? '',
        source: state.queueDrafts.source ?? '',
      };
      const ok = await runCommand(COMMAND.enqueue, payload, {
        successMessage: '公司已进入任务池；不会自动开始、登录或提交。',
      });
      if (!ok) return;
      state.queueDrafts = {};
      state.queueDirty = false;
      state.queueHandles.url.update({ value: '' });
      state.queueHandles.code.update({ value: '' });
      state.queueHandles.company.update({ value: '' });
      state.queueHandles.source.update({ value: '' });
      el.queueFormDetails.open = false;
    } catch (error) {
      showInlineError(el.queueFormError, error.message || '无法加入任务池。');
    }
  }

  async function importFact() {
    showInlineError(el.profileFormError, '');
    const meta = profileSectionMeta(state.profileSection);
    if (meta.sensitive && !state.profileSensitive) {
      showInlineError(el.profileFormError, '导入家庭等敏感资料前，需要你明确勾选授权。');
      return;
    }
    try {
      const ok = await runCommand(
        COMMAND.importFacts,
        {
          section: state.profileSection,
          entityId: state.profileDrafts.entityId ?? '',
          label: state.profileDrafts.label ?? '',
          rawText: state.profileDrafts.rawText ?? '',
          source: state.profileDrafts.source ?? '',
          sensitive: meta.sensitive === true,
        },
        { successMessage: '字段已导入为待确认条目；原文已保留，确认后才会用于填写。' },
      );
      if (!ok) return;
      state.profileHandles.label.update({ value: '' });
      state.profileHandles.raw.update({ value: '' });
      state.profileHandles.source.update({ value: '' });
      state.profileDrafts.label = '';
      state.profileDrafts.rawText = '';
      state.profileDrafts.source = '';
      state.profileDirty = false;
    } catch (error) {
      showInlineError(el.profileFormError, error.message || '无法导入资料。');
    }
  }

  async function confirmFact(fact) {
    try {
      const input = { factId: fact.id, confirmedByUser: true };
      if (fact.version !== undefined && fact.version !== null) input.expectedVersion = fact.version;
      const ok = await runCommand(COMMAND.confirmFact, input, {
        successMessage: '这条资料已由本人确认。',
      });
      if (ok) renderFacts();
    } catch (error) {
      showBanner('error', '无法确认资料', error.message || '请重试。');
    }
  }

  async function saveJobSelection(company) {
    if (!company.id) return;
    if (!canSelectJobs(company)) {
      showBanner('warning', '当前阶段不能保存岗位选择', '只有当前活动公司处于“待选岗位”时才能保存。');
      return;
    }
    if (state.jobSelection.length < 1 || state.jobSelection.length > 3) {
      showBanner('warning', '岗位选择无效', '请选择 1～3 个岗位。');
      return;
    }
    const ok = await runCommand(
      COMMAND.selectJobs,
      { companyId: company.id, jobIds: [...state.jobSelection] },
      { successMessage: '已保存岗位选择与优先级。' },
    );
    if (ok) {
      state.jobsDirty = false;
      renderDetail();
    }
  }

  function buildModelCards() {
    state.modelHandles.clear();
    state.modelDrafts.clear();
    state.modelKeyStatusEls.clear();
    el.modelCards.replaceChildren();
    for (const role of MODEL_ROLES) {
      const card = document.createElement('section');
      card.className = 'card model-card';
      const title = document.createElement('h3');
      title.textContent = role.label;
      const desc = document.createElement('p');
      desc.className = 'role-desc';
      desc.textContent = role.description;
      card.append(title, desc);

      const providerHost = document.createElement('div');
      const modelHost = document.createElement('div');
      const endpointHost = document.createElement('div');
      const keyHost = document.createElement('div');
      const provider = mountTextField(providerHost, {
        label: '提供商',
        value: '',
        placeholder: '例如：deepseek / openai',
        onChange: (value) => {
          state.modelDrafts.set(role.id, {
            ...(state.modelDrafts.get(role.id) ?? {}),
            provider: value,
          });
          markModelsDirty();
        },
      });
      const model = mountTextField(modelHost, {
        label: '精确模型 ID',
        value: '',
        placeholder: '由本人填写，不猜测',
        onChange: (value) => {
          state.modelDrafts.set(role.id, {
            ...(state.modelDrafts.get(role.id) ?? {}),
            model: value,
          });
          markModelsDirty();
        },
      });
      const endpoint = mountTextField(endpointHost, {
        label: '接口地址（可选）',
        value: '',
        placeholder: 'https://api.example.invalid/v1',
        onChange: (value) => {
          state.modelDrafts.set(role.id, {
            ...(state.modelDrafts.get(role.id) ?? {}),
            endpoint: value,
          });
          markModelsDirty();
        },
      });
      const apiKey = mountTextField(keyHost, {
        label: '接口密钥（可选）',
        value: '',
        placeholder: '留空表示不修改已保存密钥',
        password: true,
        helper: '密钥不会回显、不会导出；仅通过本地服务保存。',
        onChange: (value) => {
          state.modelDrafts.set(role.id, {
            ...(state.modelDrafts.get(role.id) ?? {}),
            apiKey: value,
          });
          markModelsDirty();
        },
      });
      const keyInput = keyHost.querySelector('input');
      if (keyInput instanceof HTMLInputElement) {
        keyInput.autocomplete = 'new-password';
        keyInput.spellcheck = false;
        keyInput.disabled = true;
      }
      card.append(providerHost, modelHost, endpointHost, keyHost);

      const keyState = document.createElement('p');
      keyState.className = 'key-state';
      keyState.textContent = '密钥：未保存';
      state.modelKeyStatusEls.set(role.id, keyState);
      card.append(keyState);

      const clearRow = document.createElement('label');
      clearRow.className = 'check-row';
      const clear = document.createElement('input');
      clear.type = 'checkbox';
      clear.disabled = true;
      clear.addEventListener('change', () => {
        state.modelDrafts.set(role.id, {
          ...(state.modelDrafts.get(role.id) ?? {}),
          clearApiKey: clear.checked,
        });
        markModelsDirty();
      });
      const clearText = document.createElement('span');
      clearText.textContent = '清除该角色已保存的密钥';
      clearRow.append(clear, clearText);
      card.append(clearRow);

      state.modelHandles.set(role.id, { provider, model, endpoint, apiKey, clear, keyInput });
      el.modelCards.append(card);
    }
  }

  function markModelsDirty() {
    state.modelsDirty = true;
    el.modelsError.hidden = true;
  }

  function markQueueDirty() {
    state.queueDirty = true;
  }

  function markProfileDirty() {
    state.profileDirty = true;
  }

  function renderModelsFromState() {
    if (!state.workbench) return;
    const models = state.workbench.models;
    for (const role of MODEL_ROLES) {
      const config = models[role.id];
      const handles = state.modelHandles.get(role.id);
      if (!handles) continue;
      const status = state.modelKeyStatusEls.get(role.id);
      if (status) {
        const flags = state.modelCapability;
        if (!flags) {
          status.textContent = '密钥：未连接';
        } else if (!flags.secureModelCredentials) {
          status.textContent = '密钥：当前后端不接收密钥';
        } else if (!flags.roleExecution) {
          status.textContent = '密钥：后端尚未接入角色执行';
        } else {
          status.textContent = config.apiKeySet
            ? `密钥：本进程内存已有（不回显）${config.provider ? ` · ${config.provider}/${config.model || '未填模型'}` : ''}`
            : '密钥：未保存；重启需重新输入';
        }
      }
      if (!state.modelsDirty) {
        handles.provider.update({ value: config.provider });
        handles.model.update({ value: config.model });
        handles.endpoint.update({ value: config.endpoint });
        handles.clear.checked = false;
        state.modelDrafts.set(role.id, {
          provider: config.provider,
          model: config.model,
          endpoint: config.endpoint,
          apiKey: '',
          clearApiKey: false,
        });
      }
    }
    updateModelCapabilityUi();
  }

  function collectModelRoles() {
    const roles = {};
    const keysAllowed = modelKeysAllowed();
    for (const role of MODEL_ROLES) {
      const draft = state.modelDrafts.get(role.id) ?? {};
      const provider = (draft.provider ?? '').trim();
      const model = (draft.model ?? '').trim();
      const endpoint = (draft.endpoint ?? '').trim();
      const apiKey = keysAllowed ? draft.apiKey ?? '' : '';
      const clear = keysAllowed && draft.clearApiKey === true;
      if (!provider && !model && !endpoint && !apiKey && !clear) continue;
      if (!provider || !model) {
        throw new Error(`请填写“${role.label}”的提供商和精确模型 ID。`);
      }
      if (clear && apiKey) {
        throw new Error(`“${role.label}”不能同时输入新密钥和勾选清除密钥。`);
      }
      const config = { provider, model };
      if (endpoint) config.endpoint = endpoint;
      if (clear) config.clearApiKey = true;
      else if (apiKey) config.apiKey = apiKey;
      roles[role.id] = config;
    }
    if (Object.keys(roles).length === 0) {
      throw new Error('至少配置一个角色后再保存。');
    }
    return roles;
  }

  async function saveModels() {
    el.modelsError.hidden = true;
    el.modelsError.textContent = '';
    let roles;
    try {
      roles = collectModelRoles();
    } catch (error) {
      showInlineError(el.modelsError, error.message);
      return;
    }
    const ok = await runCommand(COMMAND.saveModels, { roles }, {
      successMessage: '角色选择已保存为本地配置；这不代表模型已运行或 review 已完成。',
    });
    if (!ok) return;
    state.modelsDirty = false;
    for (const handles of state.modelHandles.values()) {
      handles.apiKey.update({ value: '' });
      handles.clear.checked = false;
    }
    for (const role of MODEL_ROLES) {
      const draft = state.modelDrafts.get(role.id) ?? {};
      state.modelDrafts.set(role.id, {
        ...draft,
        apiKey: '',
        clearApiKey: false,
      });
    }
    renderModelsFromState();
    updateModelCapabilityUi();
  }

  function initProfileSection() {
    const host = document.querySelector('#field-profile-section');
    host.replaceChildren();
    const label = document.createElement('label');
    label.className = 'field-label';
    label.textContent = '资料分区';
    label.htmlFor = 'profile-section-select';
    const select = document.createElement('select');
    select.id = 'profile-section-select';
    select.className = 'native-select';
    for (const section of PROFILE_SECTIONS) {
      const option = document.createElement('option');
      option.value = section.id;
      option.textContent = section.label;
      select.append(option);
    }
    select.value = state.profileSection;
    select.addEventListener('change', () => {
      state.profileSection = select.value;
      state.profileSensitive = false;
      updateProfileWarning();
      markProfileDirty();
    });
    label.append(select);
    host.append(label);
    state.profileSectionSelect = select;
  }

  function updateProfileWarning() {
    const meta = profileSectionMeta(state.profileSection);
    el.profileSensitiveWarning.replaceChildren();
    el.profileSensitiveWarning.hidden = !meta.sensitive;
    if (!meta.sensitive) return;
    const text = document.createElement('p');
    text.textContent = meta.warning || '只能导入当前用途所需的最小字段，不用于岗位检索。';
    const label = document.createElement('label');
    label.className = 'check-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'profile-sensitive-confirm';
    checkbox.checked = state.profileSensitive;
    checkbox.addEventListener('change', () => {
      state.profileSensitive = checkbox.checked;
    });
    const span = document.createElement('span');
    span.textContent = '我明确授权导入这条家庭敏感资料，仅按实际表单需要使用。';
    label.append(checkbox, span);
    el.profileSensitiveWarning.append(text, label);
  }

  function renderServiceInfo() {
    el.serviceInfo.replaceChildren();
    if (!state.capabilities) {
      el.serviceInfo.textContent = state.loadStatus === 'loading'
        ? '正在连接本地服务…'
        : '本地服务不可用或尚未接入。面板不会用模拟数据代替。';
      return;
    }
    const badges = div('service-meta');
    badges.append(
      badge(`契约 v${state.capabilities.apiVersion}`, 'info'),
      badge(state.capabilities.backend, 'neutral'),
    );
    if (state.capabilities.version) badges.append(badge(`v${state.capabilities.version}`, 'neutral'));
    badges.append(
      badge(
        state.capabilities.flags.secureModelCredentials ? '密钥保存：支持' : '密钥保存：不支持',
        state.capabilities.flags.secureModelCredentials ? 'success' : 'warning',
      ),
      badge(
        state.capabilities.flags.roleExecution ? '角色执行：声明支持' : '角色执行：未接入',
        state.capabilities.flags.roleExecution ? 'success' : 'warning',
      ),
    );
    el.serviceInfo.append(badges);
    const commands = document.createElement('p');
    commands.textContent =
      state.capabilities.commands.length > 0
        ? `已声明命令：${state.capabilities.commands.join('、')}`
        : '服务未声明命令列表；面板仍只发送契约中的 user.* 命令。';
    el.serviceInfo.append(commands);
    if (state.capabilities.limitations.length > 0) {
      const list = document.createElement('ul');
      list.className = 'service-limitations';
      for (const limitation of state.capabilities.limitations) {
        const item = document.createElement('li');
        item.textContent = limitation;
        list.append(item);
      }
      el.serviceInfo.append(list);
    }
    const note = document.createElement('p');
    note.textContent =
      '角色路由如果由后端启用，由本地服务执行；本面板不使用宿主当前会话模型或 host.generate 冒充多角色模型。保存角色选择本身不代表模型已运行或 review 已完成。';
    el.serviceInfo.append(note);
  }

  function renderActionAvailability() {
    const ready = isReadyForCommands();
    el.enqueueButton.disabled = !ready;
    el.importFactButton.disabled = !ready;
    el.saveModelsButton.disabled = !ready;
    el.openIssuesButton.disabled = !state.workbench;
    el.refreshButton.disabled = !state.directory || state.loadStatus === 'loading';
    el.refreshButton.textContent = state.loadStatus === 'loading' ? '读取中…' : '刷新';
    if (state.selectionUi?.save) {
      const company = selectedCompany();
      state.selectionUi.save.disabled =
        !ready ||
        !state.jobsDirty ||
        state.jobSelection.length < 1 ||
        !canSelectJobs(company);
    }
    updateSubmitButton();
    updateHistoricalButton();
    updateSkipButton();
  }

  function isReadyForCommands() {
    return Boolean(
      state.directory &&
        state.hostReady &&
        state.loadStatus === 'ready' &&
        state.workbench &&
        !state.commandBusy,
    );
  }

  function queueIsRunning() {
    return state.workbench?.queue.state === 'running';
  }

  function queueIsPaused() {
    return state.workbench?.queue.state === 'paused';
  }

  function isCurrentActiveCompany(company) {
    return Boolean(
      company?.id &&
        state.workbench?.queue.activeCompanyId === company.id,
    );
  }

  function isActiveAndRunning(company) {
    return isReadyForCommands() && queueIsRunning() && isCurrentActiveCompany(company);
  }

  function hasBlockingIssues(company) {
    if (!company?.id || !state.workbench) return false;
    return state.workbench.issues.some(
      (issue) =>
        issue.companyId === company.id &&
        issue.blocking === true &&
        issue.status !== 'resolved',
    );
  }

  function canConfirmLogin(company) {
    return isActiveAndRunning(company) && company.status === 'awaiting_login';
  }

  function canRecordCandidates(company) {
    return (
      isActiveAndRunning(company) &&
      (company.status === 'searching' ||
        (company.status === 'awaiting_job_selection' &&
          company.selectedPositionIds.length === 0))
    );
  }

  function canRecordNoPositions(company) {
    return isActiveAndRunning(company) && company.status === 'searching';
  }

  function canSelectJobs(company) {
    return isActiveAndRunning(company) && company.status === 'awaiting_job_selection';
  }

  function canMarkReady(company, job) {
    return (
      isActiveAndRunning(company) &&
      company.activePositionId === job.id &&
      ['filling', 'awaiting_user'].includes(company.status) &&
      job.status === 'filling' &&
      !hasBlockingIssues(company)
    );
  }

  function canReportSubmitted(company) {
    return reportableJobs(company).length > 0;
  }

  function canDeferCompany(company) {
    return (
      isActiveAndRunning(company) &&
      !['completed', 'no_suitable_jobs', 'skipped', 'deferred'].includes(company.status)
    );
  }

  function canResumeCompany(company) {
    if (!isReadyForCommands() || company.status !== 'deferred' || queueIsPaused()) return false;
    const currentId = state.workbench?.queue.activeCompanyId;
    if (!currentId || currentId === company.id) return true;
    const current = (state.workbench?.companies ?? []).find((item) => item.id === currentId);
    return !current || ['completed', 'no_suitable_jobs', 'skipped'].includes(current.status);
  }

  function canSkipJob(company, job) {
    return (
      isActiveAndRunning(company) &&
      ['selected', 'filling', 'awaiting_submit'].includes(job.status) &&
      !['skipped', 'verified', 'self_reported'].includes(job.status)
    );
  }

  function canSkipCompany(company) {
    if (!isActiveAndRunning(company)) return false;
    if (['completed', 'no_suitable_jobs', 'skipped'].includes(company.status)) return false;
    const hasSubmission = company.jobs.some(
      (job) =>
        job.status === 'self_reported' ||
        job.status === 'verified' ||
        Boolean(job.submission) ||
        Boolean(job.verification),
    );
    return !hasSubmission;
  }

  function canAnswerIssue() {
    return isReadyForCommands() && queueIsRunning();
  }

  function stageHint(company) {
    if (!company) return '';
    if (queueIsPaused()) {
      return '队列当前暂停：恢复队列后才能记录登录、岗位证据、岗位选择、送审或本人提交回执。';
    }
    const activeId = state.workbench?.queue.activeCompanyId;
    if (
      activeId &&
      activeId !== company.id &&
      !['completed', 'no_suitable_jobs', 'skipped'].includes(company.status)
    ) {
      return '另一家公司是当前活动公司；完成或明确暂挂后再恢复本公司。';
    }
    const hints = {
      queued: '任务已入队，等待本人开始队列。',
      awaiting_login: '下一步：本人在招聘官网完成登录后，记录“我已登录”回执。',
      searching: '下一步：本人核查官方招聘页后，录入 1～3 个岗位证据；确无合适岗位必须填写来源证据。',
      awaiting_job_selection: '下一步：本人选择 1～3 个岗位并保存优先顺序。',
      filling: '下一步：完成可安全填写的内容；无阻断问题时可标记当前岗位为“可送本人提交”。',
      awaiting_user: '有阻断问题待处理；逐条补充并核对解决后，才能继续送审。',
      awaiting_submit: '已在待提交阶段：请本人在招聘官网完成最终提交，再记录本人回执。',
      deferred: '公司已暂挂，现场保留；恢复或填写真实原因后跳过。',
      search_blocked: '检索受阻，不能当作没有合适岗位；请先处理登录、访问或资格问题。',
      completed: '本公司本轮已完成。',
      no_suitable_jobs: '已由本人核查证据记录为“没有符合职位”；不会自动重投。',
      skipped: '公司已由本人跳过；不会写成“没有符合职位”。',
      failed: '任务失败，请查看本地服务状态。',
    };
    return hints[company.status] ?? '';
  }

  async function runCommand(command, input, { successMessage = '' } = {}) {
    if (!isReadyForCommands()) {
      if (!state.commandBusy) {
        showBanner('warning', '暂时不能执行', '本地服务尚未就绪或状态未加载；请先刷新。');
      }
      return false;
    }
    if (
      state.capabilities?.commands?.length > 0 &&
      !state.capabilities.commands.includes(command)
    ) {
      showBanner('error', '本地服务未声明该命令', `请更新本地服务后再使用：${command}`);
      return false;
    }
    const generation = state.generation;
    const directory = state.directory;
    const seq = ++state.requestSeq;
    state.commandBusy = true;
    renderActionAvailability();
    try {
      const request = buildCommandRequest({
        directory,
        command,
        input,
        expectedRevision: state.revision ?? undefined,
      });
      const result = await state.host.serviceRequest(request);
      if (isStale(generation, seq, directory)) return false;
      const parsed = parseCommandResponse(result);
      if (parsed.state) {
        applyServiceState(parsed.revision, parsed.state);
      } else {
        state.revision = parsed.revision;
        await reloadAfterCommand(generation, directory);
      }
      if (successMessage) notify(successMessage, 'success');
      return true;
    } catch (error) {
      if (isStale(generation, seq, directory) && error.code !== 'REVISION_CONFLICT') {
        return false;
      }
      const info = friendlyError(error);
      showBanner('error', info.title, info.message, {
        label: '刷新核对',
        onClick: () => {
          void loadFromService();
        },
      });
      notify(`${info.title}：${info.message}`, 'error');
      if (error.code === 'REVISION_CONFLICT' || error.code === 'REQUEST_FAILED') {
        try {
          await reloadAfterCommand(generation, directory);
        } catch {
          // The banner already tells the user to refresh; never retry the action automatically.
        }
      }
      return false;
    } finally {
      if (generation === state.generation) {
        state.commandBusy = false;
        renderActionAvailability();
        renderQueueControls();
        renderDetail();
        if (el.issuesDialog.open) renderIssues();
      }
    }
  }

  async function reloadAfterCommand(generation, directory) {
    const seq = ++state.requestSeq;
    try {
      const capabilitiesResult = await state.host.serviceRequest(buildCapabilitiesRequest());
      if (isStale(generation, seq, directory)) return;
      const capabilities = parseCapabilitiesResponse(capabilitiesResult);
      const stateResult = await state.host.serviceRequest(buildStateRequest(directory));
      if (isStale(generation, seq, directory)) return;
      const parsed = parseStateResponse(stateResult);
      state.capabilities = capabilities;
      applyServiceState(parsed.revision, parsed.state);
      state.loadStatus = 'ready';
    } catch (error) {
      if (isStale(generation, seq, directory)) return;
      state.loadStatus = 'error';
      state.loadError = error;
      state.workbench = null;
      state.capabilities = null;
      state.revision = null;
      showServiceError(error);
      renderAll();
      throw error;
    }
  }

  function notify(message, kind = 'info') {
    if (!state.hostReady) return;
    state.host.toast({ kind, message }).catch(() => {});
  }

  function openExternal(url) {
    if (!isSafeHttpUrl(url)) {
      notify('链接无效，未打开。', 'error');
      return;
    }
    state.host.openUrl(url).catch(() => {
      notify('宿主未能打开该链接。', 'error');
    });
  }

  function friendlyError(error) {
    const code = typeof error?.code === 'string' ? error.code : '';
    const backendMessage = typeof error?.message === 'string' ? error.message : '';
    const byCode = {
      HOST_UNAVAILABLE: [
        '宿主不可用',
        '请回到 OpenChamber 扩展中打开；独立浏览器不会显示模拟数据。',
      ],
      HOST_TIMEOUT: [
        '宿主响应超时',
        'OpenChamber 没有及时响应。请重试；不会自动重复已发送的操作。',
      ],
      HOST_REJECTED: ['宿主拒绝了请求', backendMessage || '请检查扩展权限和安装状态。'],
      NO_SERVICE: [
        '本地服务未启动',
        '扩展的本地服务尚未启动或未获批准。面板不会用 localStorage 伪造任务。',
      ],
      SERVICE_FAILED: [
        '本地服务启动失败',
        '请确认 service/main.js 已实现并能通过宿主健康检查，然后重试。',
      ],
      REQUEST_FAILED: [
        '本地服务请求中断',
        '操作可能已在服务端执行。请先刷新核对，不要重复记录本人提交。',
      ],
      REVISION_CONFLICT: [
        '任务状态已在别处更新',
        '本次操作没有被确认。请核对最新状态后重新操作。',
      ],
      RECOVERY_OBSERVATION_REQUIRED: [
        '需要本人观察恢复现场',
        '上次中断后不能直接继续写入；请先观察招聘网站，再使用恢复观察确认。',
      ],
      QUEUE_NOT_RUNNING: [
        '队列未运行',
        '当前阶段操作需要队列运行；请先恢复队列。',
      ],
      NOT_AWAITING_LOGIN: [
        '当前不在待登录阶段',
        '登录回执只能记录当前活动公司的待登录阶段。',
      ],
      NOT_ACTIVE_COMPANY: [
        '该任务不是当前活动公司',
        '请先处理当前活动公司；不能同时推进另一家公司。',
      ],
      WRONG_COMPANY_STAGE: [
        '公司当前阶段不允许该操作',
        '请按页面上的阶段提示操作，不要跳过登录、选择、送审或提交回执。',
      ],
      NOT_AWAITING_SELECTION: [
        '当前不在待选岗位阶段',
        '只有公司处于待选岗位阶段时才能保存 1～3 个岗位。',
      ],
      NOT_HELD: [
        '公司未处于暂挂状态',
        '只有暂挂公司可以恢复。',
      ],
      QUEUE_BUSY: [
        '另一家公司仍在处理中',
        '当前活动公司结束后才能恢复暂挂公司。',
      ],
      NOT_READY_FOR_SUBMIT: [
        '尚未到本人提交阶段',
        '请先标记当前岗位可送本人提交，并由本人在官网完成提交。',
      ],
      BLOCKING_ISSUES: [
        '仍有阻断问题',
        '请先逐条补充并由本人核对解决，才能继续送审或记录提交。',
      ],
      RESPONSE_TOO_LARGE: [
        '本地服务响应过大',
        '请让服务返回更小的状态分页；面板没有显示不完整结果。',
      ],
      NO_DIRECTORY: ['未打开项目', '请先在 OpenChamber 中打开项目。'],
    };
    if (byCode[code]) {
      return { title: byCode[code][0], message: byCode[code][1] };
    }
    if (code === 'HTTP_404' || code === 'NOT_FOUND') {
      return {
        title: '本地服务尚未提供该接口',
        message: '请确认后端已按 contract.js 接入 /api/capabilities 与 /api/state。',
      };
    }
    const inputErrors = new Set([
      'INVALID_FIELD',
      'INVALID_URL',
      'INVALID_JOB_SELECTION',
      'CONFIRMATION_REQUIRED',
      'INVALID_ISSUE_ACTION',
      'INVALID_MODELS',
      'INVALID_MODEL_ROLE',
      'INVALID_PROFILE_SECTION',
      'INVALID_RAW_TEXT',
      'INVALID_VERSION',
      'INVALID_POSITION',
      'INVALID_EVIDENCE',
      'INVALID_PATCH',
      'FIELD_PROTECTED',
      'REASON_REQUIRED',
      'ANSWER_REQUIRED',
    ]);
    if (inputErrors.has(code)) {
      return { title: '请检查输入', message: backendMessage };
    }
    if (code.startsWith('INVALID_') || code === 'UNSUPPORTED_CONTRACT_VERSION') {
      return {
        title: '本地服务数据不兼容',
        message: backendMessage || '请更新前后端契约版本后重试。',
      };
    }
    return {
      title: '本地服务请求失败',
      message: backendMessage || '请查看本地服务状态后重试。',
    };
  }

  function openDialog(dialog) {
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function closeDialog(dialog) {
    if (typeof dialog.close === 'function') {
      if (dialog.open) dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }

  function isUserTyping() {
    const active = document.activeElement;
    if (!active) return false;
    return (
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLSelectElement ||
      active.isContentEditable
    );
  }

  function formatTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    try {
      return new Intl.DateTimeFormat(state.hostLocale || 'zh-CN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date);
    } catch {
      return date.toLocaleString();
    }
  }

  function basename(path) {
    if (!path) return '';
    const parts = String(path).split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || path;
  }

  function renderEmpty(host, title, body) {
    host.replaceChildren();
    if (!title && !body) return;
    const empty = div('empty-state');
    if (title) {
      const strong = document.createElement('strong');
      strong.textContent = title;
      empty.append(strong);
    }
    if (body) {
      const span = document.createElement('span');
      span.textContent = body;
      empty.append(span);
    }
    host.append(empty);
  }

  function sectionTitleRow(title, meta) {
    const row = div('section-title-row');
    const heading = document.createElement('h4');
    heading.textContent = title;
    row.append(heading);
    if (meta) row.append(textNode(meta, 'muted small'));
    return row;
  }

  function appendFact(grid, label, value) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    grid.append(dt, dd);
  }

  function textNode(text, className = '') {
    const node = document.createElement('span');
    if (className) node.className = className;
    node.textContent = text;
    return node;
  }

  function div(className) {
    const node = document.createElement('div');
    if (className) node.className = className;
    return node;
  }

  function badge(label, tone = 'neutral') {
    const node = document.createElement('span');
    node.className = 'badge';
    node.dataset.tone = tone;
    node.textContent = label;
    return node;
  }

  function actionButton(label, variant, onClick) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = `btn ${variant || ''}`.trim();
    node.textContent = label;
    node.addEventListener('click', onClick);
    return node;
  }

  function showInlineError(node, message) {
    node.hidden = message.length === 0;
    node.textContent = message;
  }
}
