(function () {
  'use strict';

  var boot = document.getElementById('boot');
  var app = document.getElementById('app');
  var bootMessage = document.getElementById('boot-message');
  var accessToken = readQuery('access');
  var config = null;
  var state = {
    directory: null,
    generation: 0,
    loadStatus: 'idle',
    loadError: null,
    revision: null,
    workbench: null,
    commandBusy: false,
    messageBusy: false,
    priorityCompanyId: '',
    priorityOptionsCount: 0,
    targetSessionId: '',
    pollTimer: null,
    messageNote: '需保持 OpenChamber HUD 打开，桥接器才会发送到当前会话。'
  };

  var el = {
    projectLabel: document.getElementById('project-label'),
    queuePill: document.getElementById('queue-pill'),
    refreshButton: document.getElementById('refresh-button'),
    closeButton: document.getElementById('close-button'),
    globalBanner: document.getElementById('global-banner'),
    progressSummary: document.getElementById('progress-summary'),
    progressPercent: document.getElementById('progress-percent'),
    progressTrack: document.getElementById('progress-track'),
    progressFill: document.getElementById('progress-fill'),
    progressCount: document.getElementById('progress-count'),
    issueCount: document.getElementById('issue-count'),
    totalCount: document.getElementById('total-count'),
    doneCount: document.getElementById('done-count'),
    attentionCount: document.getElementById('attention-count'),
    currentStatus: document.getElementById('current-status'),
    currentCompany: document.getElementById('current-company'),
    currentDetail: document.getElementById('current-detail'),
    startButton: document.getElementById('start-button'),
    pauseButton: document.getElementById('pause-button'),
    resumeButton: document.getElementById('resume-button'),
    refreshInlineButton: document.getElementById('refresh-inline-button'),
    closeInlineButton: document.getElementById('close-inline-button'),
    priorityStatus: document.getElementById('priority-status'),
    priorityNote: document.getElementById('priority-note'),
    priorityPicker: document.getElementById('priority-picker'),
    priorityPickerButton: document.getElementById('priority-picker-button'),
    priorityPickerMenu: document.getElementById('priority-picker-menu'),
    prioritizeButton: document.getElementById('prioritize-button'),
    sessionStatus: document.getElementById('session-status'),
    sessionTitle: document.getElementById('session-title'),
    targetSessionId: document.getElementById('target-session-id'),
    sessionMessageForm: document.getElementById('session-message-form'),
    sessionMessage: document.getElementById('session-message'),
    sendMessageButton: document.getElementById('send-message-button'),
    messageNote: document.getElementById('message-note')
  };

  el.refreshButton.onclick = function () {
    loadState();
  };
  el.closeButton.onclick = function () {
    clearPollTimer();
    window.close();
  };
  el.refreshInlineButton.onclick = function () {
    loadState();
  };
  el.closeInlineButton.onclick = function () {
    clearPollTimer();
    window.close();
  };
  el.priorityPickerButton.onclick = function (event) {
    if (event && event.stopPropagation) event.stopPropagation();
    if (el.priorityPickerButton.disabled) return;
    var open = el.priorityPickerMenu.hidden;
    el.priorityPickerMenu.hidden = !open;
    el.priorityPickerButton.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  el.priorityPickerButton.onkeydown = function (event) {
    var keyCode = event && (event.keyCode || event.which);
    if (keyCode === 27) closePriorityPicker();
  };
  el.priorityPickerMenu.onclick = function (event) {
    var target = event && (event.target || event.srcElement);
    while (target && target !== el.priorityPickerMenu
      && (!target.getAttribute || !target.getAttribute('data-company-id'))) {
      target = target.parentNode;
    }
    if (!target || target === el.priorityPickerMenu) return;
    state.priorityCompanyId = target.getAttribute('data-company-id') || '';
    closePriorityPicker();
    renderPriority();
  };
  document.onclick = function (event) {
    var target = event && (event.target || event.srcElement);
    if (!el.priorityPicker || (target !== el.priorityPicker && !el.priorityPicker.contains(target))) {
      closePriorityPicker();
    }
  };
  el.targetSessionId.onchange = function () {
    state.targetSessionId = String(el.targetSessionId.value || '').replace(/^\s+|\s+$/g, '');
    renderSession();
  };
  el.prioritizeButton.onclick = function () {
    if (!state.priorityCompanyId) return;
    runCommand('user.prioritizeCompany', { companyId: state.priorityCompanyId }, '已调整下一家优先企业；当前活动公司不会被中断。');
  };
  el.startButton.onclick = function () {
    runCommand('user.start', {}, '队列已开始。');
  };
  el.pauseButton.onclick = function () {
    runCommand('user.pause', {}, '队列已请求暂停。');
  };
  el.resumeButton.onclick = function () {
    runCommand('user.resume', {}, '队列已恢复；请按当前公司阶段继续。');
  };
  el.sessionMessageForm.onsubmit = function (event) {
    if (event && event.preventDefault) event.preventDefault();
    sendSessionMessage();
    return false;
  };

  window.onbeforeunload = function () {
    clearPollTimer();
  };

  start();

  function start() {
    try {
      window.resizeTo(520, 900);
    } catch (error) {
      // The host may deny window resizing; the HUD remains usable at its default size.
    }
    if (!accessToken) {
      failBoot('缺少独立窗口访问凭据。');
      return;
    }
    request('/api/config?access=' + encodeURIComponent(accessToken), 'GET', null, function (error, body) {
      if (error) {
        failBoot(friendlyError(error));
        return;
      }
      if (!body || body.ok !== true || !body.directory) {
        failBoot('独立窗口配置无效。');
        return;
      }
      config = body;
      state.directory = body.directory;
      state.targetSessionId = body.targetSessionId || '';
      el.targetSessionId.value = state.targetSessionId;
      boot.hidden = true;
      app.hidden = false;
      el.sessionMessage.disabled = true;
      el.sendMessageButton.disabled = true;
      updateProjectLabel();
      render();
      loadState();
    });
  }

  function loadState() {
    if (!state.directory || state.commandBusy) return;
    clearPollTimer();
    state.generation += 1;
    var generation = state.generation;
    state.loadStatus = 'loading';
    state.loadError = null;
    render();
    request('/api/state?directory=' + encodeURIComponent(state.directory), 'GET', null, function (error, body) {
      if (generation !== state.generation) return;
      if (error) {
        state.loadStatus = 'error';
        state.loadError = error;
        state.workbench = null;
        render();
        schedulePoll(5000);
        return;
      }
      if (!body || body.ok !== true || !body.state) {
        state.loadStatus = 'error';
        state.loadError = { code: 'INVALID_STATE_RESPONSE', message: '本地任务服务返回了无效状态。' };
        state.workbench = null;
        render();
        schedulePoll(5000);
        return;
      }
      state.revision = body.revision;
      state.workbench = body.state;
      if (!findCompany(state.workbench.companies, state.priorityCompanyId)) state.priorityCompanyId = '';
      state.loadStatus = 'ready';
      state.loadError = null;
      render();
      schedulePoll(3000);
    });
  }

  function runCommand(command, input, successMessage) {
    if (!state.directory || !state.workbench || state.loadStatus !== 'ready' || state.loadError) {
      showBanner('warning', '任务状态尚未就绪，请先刷新。');
      return;
    }
    if (state.commandBusy) {
      showBanner('info', '上一个队列操作仍在处理，请稍候。');
      return;
    }
    var generation = state.generation;
    state.commandBusy = true;
    clearPollTimer();
    renderControls();
    request('/api/command', 'POST', {
      directory: state.directory,
      command: command,
      input: input,
      expectedRevision: state.revision
    }, function (error, body) {
      if (generation !== state.generation) return;
      if (error) {
        state.commandBusy = false;
        state.loadError = error;
        showError(error);
        render();
        if (command === 'user.prioritizeCompany') el.priorityNote.textContent = '调整失败：' + friendlyError(error);
        schedulePoll(5000);
        return;
      }
      state.commandBusy = false;
      state.revision = body.revision;
      if (body.state) {
        state.workbench = body.state;
        state.loadStatus = 'ready';
        state.loadError = null;
        render();
        showBanner('success', successMessage);
        if (command === 'user.prioritizeCompany') el.priorityNote.textContent = successMessage;
        schedulePoll(3000);
        return;
      }
      loadState();
      showBanner('success', successMessage);
    });
  }

  function sendSessionMessage() {
    var text = el.sessionMessage.value;
    if (!text || !text.trim() || state.messageBusy) return;
    state.messageBusy = true;
    state.messageNote = '正在写入会话桥接队列…';
    renderSession();
    var payload = { text: text };
    if (state.targetSessionId) payload.targetSessionId = state.targetSessionId;
    request('/api/session-message', 'POST', payload, function (error) {
      state.messageBusy = false;
      if (error) {
        state.messageNote = friendlyError(error);
        renderSession();
        return;
      }
      el.sessionMessage.value = '';
      state.messageNote = '已进入桥接队列；请保持 OpenChamber HUD 打开以发送到当前会话。';
      renderSession();
    });
  }

  function request(path, method, body, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, path, true);
    xhr.setRequestHeader('X-Application-Copilot-Standalone', accessToken);
    if (body !== null && body !== undefined) xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      var payload = null;
      if (xhr.responseText) {
        try {
          payload = JSON.parse(xhr.responseText);
        } catch (error) {
          payload = null;
        }
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        callback(null, payload);
        return;
      }
      var serviceError = payload && payload.error ? payload.error : null;
      callback({
        code: serviceError && serviceError.code ? serviceError.code : 'STANDALONE_REQUEST_FAILED',
        message: serviceError && serviceError.message ? serviceError.message : '独立窗口请求失败。'
      }, null);
    };
    xhr.onerror = function () {
      callback({ code: 'STANDALONE_REQUEST_FAILED', message: '独立窗口无法连接本地任务服务。' }, null);
    };
    try {
      xhr.send(body === null || body === undefined ? null : JSON.stringify(body));
    } catch (error) {
      callback({ code: 'STANDALONE_REQUEST_FAILED', message: '独立窗口无法发送本地请求。' }, null);
    }
  }

  function render() {
    updateProjectLabel();
    renderQueue();
    renderProgress();
    renderPriority();
    renderCurrentCompany();
    renderControls();
    renderSession();
    renderBanner();
  }

  function renderQueue() {
    var queue = state.workbench && state.workbench.queue;
    var meta = queueMeta(queueState(queue));
    setPill(el.queuePill, meta.label, meta.tone);
  }

  function renderProgress() {
    var workbench = state.workbench;
    var companies = workbench && isArray(workbench.companies) ? workbench.companies : [];
    var done = 0;
    var attention = 0;
    var index;
    for (index = 0; index < companies.length; index += 1) {
      if (isCompletedCompany(companies[index])) done += 1;
      if (isAttentionCompany(companies[index])) attention += 1;
    }
    var percent = companies.length ? Math.round((done / companies.length) * 100) : 0;
    var queue = workbench && workbench.queue;
    var summary = queue && queue.message ? queue.message :
      state.loadStatus === 'loading' ? '正在读取本地服务…' :
        state.loadStatus === 'error' ? '任务状态不可用' :
          state.directory ? companies.length + ' 家公司' : '未打开项目';
    el.progressSummary.textContent = summary;
    el.progressPercent.textContent = percent + '%';
    el.progressTrack.setAttribute('aria-valuenow', String(percent));
    el.progressFill.style.width = percent + '%';
    el.progressCount.textContent = done + ' / ' + companies.length + ' 家公司';
    el.issueCount.textContent = '待处理问题 ' + unresolvedIssues(workbench && workbench.issues);
    el.totalCount.textContent = String(companies.length);
    el.doneCount.textContent = String(done);
    el.attentionCount.textContent = String(attention);
  }

  function renderCurrentCompany() {
    var workbench = state.workbench;
    var queue = workbench && workbench.queue;
    var activeId = queue && queue.activeCompanyId ? queue.activeCompanyId : workbench && workbench.currentCompanyId;
    var company = findCompany(workbench && workbench.companies, activeId);
    if (!company) {
      setPill(el.currentStatus, '暂无', 'neutral');
      el.currentCompany.textContent = '暂无活动公司';
      el.currentDetail.textContent = queue && queue.message ? queue.message : state.directory ? '队列尚未开始。' : '本地项目未加载。';
      return;
    }
    var meta = statusMeta(companyStatus(company));
    setPill(el.currentStatus, meta.label, meta.tone);
    el.currentCompany.textContent = company.name || '未命名任务';
    var activeJob = findJob(company.jobs, company.activePositionId);
    var parts = [meta.label];
    if (activeJob && activeJob.title) parts.push(activeJob.title);
    if (queue && queue.state === 'paused') {
      parts.push('队列已暂停，请点击“恢复队列”继续。');
    } else if (queue && queue.state === 'running' && companyStatus(company) === 'awaiting_login') {
      parts.push('队列已运行，请本人登录后在任务池中记录“我已登录”。');
    } else if (queue && queue.message) {
      parts.push(queue.message);
    }
    el.currentDetail.textContent = parts.join(' · ');
  }

  function renderPriority() {
    var companies = state.workbench && isArray(state.workbench.companies) ? state.workbench.companies : [];
    var queued = [];
    var index;
    for (index = 0; index < companies.length; index += 1) {
      if (companyStatus(companies[index]) === 'queued') queued.push(companies[index]);
    }
    queued.sort(function (left, right) {
      return (left.queuePosition || 999999) - (right.queuePosition || 999999);
    });
    while (el.priorityPickerMenu.firstChild) el.priorityPickerMenu.removeChild(el.priorityPickerMenu.firstChild);
    state.priorityOptionsCount = queued.length;
    if (!queued.length) {
      state.priorityCompanyId = '';
      el.priorityPickerButton.textContent = '暂无可调整企业';
      el.priorityNote.textContent = '当前没有尚未开始的企业可调整。';
      setPill(el.priorityStatus, '无可调整', 'neutral');
      renderPriorityControls();
      return;
    }
    var selectedCompany = null;
    for (index = 0; index < queued.length; index += 1) {
      var option = document.createElement('button');
      option.type = 'button';
      option.className = 'priority-option';
      option.setAttribute('role', 'option');
      option.setAttribute('data-company-id', queued[index].id);
      option.setAttribute('aria-selected', queued[index].id === state.priorityCompanyId ? 'true' : 'false');
      option.textContent = (queued[index].queuePosition || index + 1) + '. ' + (queued[index].name || '未命名任务');
      el.priorityPickerMenu.appendChild(option);
      if (queued[index].id === state.priorityCompanyId) selectedCompany = queued[index];
    }
    if (!selectedCompany) state.priorityCompanyId = '';
    el.priorityPickerButton.textContent = selectedCompany
      ? (selectedCompany.queuePosition || 1) + '. ' + (selectedCompany.name || '未命名任务')
      : '选择企业…';
    el.priorityNote.textContent = '仅调整尚未开始的企业；不会中断当前公司，队列运行中需要先暂停。';
    setPill(el.priorityStatus, state.priorityCompanyId ? '已选择' : '未选择', state.priorityCompanyId ? 'info' : 'neutral');
    renderPriorityControls();
  }

  function renderPriorityControls() {
    var queueStateValue = queueState(state.workbench && state.workbench.queue);
    var canChange = state.loadStatus === 'ready' && !state.loadError && !state.commandBusy
      && state.priorityCompanyId && (queueStateValue === 'idle' || queueStateValue === 'paused');
    el.priorityPickerButton.disabled = state.loadStatus !== 'ready' || state.commandBusy || state.priorityOptionsCount === 0;
    el.prioritizeButton.disabled = !canChange;
  }

  function closePriorityPicker() {
    el.priorityPickerMenu.hidden = true;
    el.priorityPickerButton.setAttribute('aria-expanded', 'false');
  }

  function renderControls() {
    var currentQueueState = queueState(state.workbench && state.workbench.queue);
    var companies = state.workbench && isArray(state.workbench.companies) ? state.workbench.companies : [];
    var ready = Boolean(state.workbench && state.loadStatus === 'ready' && !state.loadError);
    var busy = state.commandBusy;
    var paused = currentQueueState === 'paused';
    var activeId = state.workbench && state.workbench.queue && state.workbench.queue.activeCompanyId
      ? state.workbench.queue.activeCompanyId
      : state.workbench && state.workbench.currentCompanyId;
    var activeCompany = findCompany(state.workbench && state.workbench.companies, activeId);
    var awaitingLogin = currentQueueState === 'running'
      && activeCompany && companyStatus(activeCompany) === 'awaiting_login';
    el.refreshButton.disabled = state.loadStatus === 'loading' || busy;
    el.startButton.disabled = !ready || busy || companies.length === 0 || (currentQueueState !== 'idle' && currentQueueState !== 'completed');
    el.pauseButton.disabled = !ready || busy || (currentQueueState !== 'running' && currentQueueState !== 'blocked');
    el.resumeButton.disabled = !ready || busy || currentQueueState !== 'paused';
    el.startButton.textContent = paused ? '已暂停' : awaitingLogin ? '队列已运行' : '开始队列';
    el.startButton.title = paused
      ? '队列已暂停，请点击“恢复队列”继续。'
      : awaitingLogin
        ? '队列已经运行，请本人登录后在任务池中记录“我已登录”。'
        : '';
    el.resumeButton.textContent = paused ? '恢复队列' : '恢复';
    toggleClass(el.resumeButton, 'primary', paused);
    toggleClass(el.resumeButton, 'outline', !paused);
    renderPriorityControls();
  }

  function toggleClass(element, className, enabled) {
    if (!element || !element.classList) return;
    if (enabled) element.classList.add(className);
    else element.classList.remove(className);
  }

  function renderSession() {
    setPill(el.sessionStatus, '桥接队列', 'info');
    el.sessionTitle.textContent = state.targetSessionId
      ? '消息将绑定到指定会话，由 OpenChamber HUD 转发'
      : '消息先进入本地队列，再由 OpenChamber HUD 发送';
    el.messageNote.textContent = state.messageNote;
    el.sessionMessage.disabled = state.messageBusy;
    el.sendMessageButton.disabled = state.messageBusy;
    el.sendMessageButton.textContent = state.messageBusy ? '发送中…' : '发送';
  }

  function renderBanner() {
    if (!state.directory) {
      showBanner('warning', '未加载项目：本地任务状态不可用。');
      return;
    }
    if (state.loadStatus === 'error' && state.loadError) {
      showBanner('error', friendlyError(state.loadError));
      return;
    }
    if (state.workbench && state.workbench.recoveryPending) {
      showBanner('warning', '检测到中断恢复现场；请在任务池面板中先完成本人观察确认。');
      return;
    }
    if (!state.workbench && state.loadStatus === 'loading') {
      showBanner('info', '正在读取当前项目的任务状态…');
      return;
    }
    el.globalBanner.hidden = true;
    el.globalBanner.textContent = '';
  }

  function showBanner(tone, message) {
    el.globalBanner.hidden = false;
    el.globalBanner.setAttribute('data-tone', tone);
    el.globalBanner.textContent = message;
  }

  function showError(error) {
    showBanner('error', friendlyError(error));
  }

  function updateProjectLabel() {
    var name = config && config.projectName ? config.projectName : basename(state.directory);
    el.projectLabel.textContent = name ? '项目：' + name : '项目未加载';
    el.projectLabel.title = state.directory || '';
  }

  function schedulePoll(delay) {
    clearPollTimer();
    if (!state.directory) return;
    state.pollTimer = window.setTimeout(function () {
      state.pollTimer = null;
      if (state.commandBusy) {
        schedulePoll(1000);
        return;
      }
      loadState();
    }, delay || 3000);
  }

  function clearPollTimer() {
    if (state.pollTimer) window.clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }

  function failBoot(message) {
    bootMessage.textContent = message;
  }

  function queueState(queue) {
    if (!queue) return 'unknown';
    return queue.state || queue.panelState || queue.status || queue.coreState || 'unknown';
  }

  function queueMeta(value) {
    var map = {
      idle: { label: '未开始', tone: 'neutral' },
      running: { label: '运行中', tone: 'success' },
      paused: { label: '已暂停', tone: 'warning' },
      blocked: { label: '待处理', tone: 'warning' },
      completed: { label: '本轮已完成', tone: 'neutral' },
      unknown: { label: '状态未知', tone: 'neutral' }
    };
    return map[value] || map.unknown;
  }

  function statusMeta(value) {
    var map = {
      queued: { label: '待开始', tone: 'neutral' },
      awaiting_login: { label: '待登录', tone: 'info' },
      searching: { label: '检索中', tone: 'info' },
      awaiting_job_selection: { label: '待选岗位', tone: 'warning' },
      filling: { label: '填写中', tone: 'info' },
      reviewing: { label: '复核中', tone: 'info' },
      awaiting_user: { label: '待你处理', tone: 'warning' },
      awaiting_submit: { label: '待你提交', tone: 'warning' },
      awaiting_verification: { label: '待核验', tone: 'info' },
      deferred: { label: '已暂挂', tone: 'neutral' },
      paused: { label: '已暂停', tone: 'neutral' },
      failed: { label: '失败', tone: 'error' },
      completed: { label: '已完成', tone: 'success' },
      no_suitable_jobs: { label: '未投递：没有符合职位', tone: 'neutral' },
      search_blocked: { label: '检索受阻：待处理', tone: 'warning' },
      submitted_self_reported: { label: '已投递（本人记录）', tone: 'info' },
      submitted_verified: { label: '已投递（官网已核验）', tone: 'success' },
      skipped: { label: '未投递：本人跳过', tone: 'neutral' },
      unknown: { label: '状态未知', tone: 'neutral' }
    };
    return map[value] || map.unknown;
  }

  function isCompletedCompany(company) {
    var status = companyStatus(company);
    var application = company && company.application ? company.application.kind : '';
    return contains(['completed', 'submitted_self_reported', 'submitted_verified', 'no_suitable_jobs', 'skipped'], status)
      || contains(['self_reported', 'verified', 'no_suitable_jobs', 'skipped'], application);
  }

  function isAttentionCompany(company) {
    return contains(['awaiting_user', 'awaiting_submit', 'search_blocked', 'deferred', 'failed'], companyStatus(company));
  }

  function statusCompanyName(company) {
    return company && (company.status || company.panelStatus) ? (company.status || company.panelStatus) : 'unknown';
  }

  function companyStatus(company) {
    return statusCompanyName(company);
  }

  function findCompany(companies, id) {
    if (!isArray(companies) || !id) return null;
    var index;
    for (index = 0; index < companies.length; index += 1) {
      if (companies[index] && companies[index].id === id) return companies[index];
    }
    return null;
  }

  function findJob(jobs, id) {
    if (!isArray(jobs) || !id) return null;
    var index;
    for (index = 0; index < jobs.length; index += 1) {
      if (jobs[index] && jobs[index].id === id) return jobs[index];
    }
    return null;
  }

  function unresolvedIssues(issues) {
    if (!isArray(issues)) return 0;
    var count = 0;
    var index;
    for (index = 0; index < issues.length; index += 1) {
      if (issues[index] && issues[index].status !== 'resolved') count += 1;
    }
    return count;
  }

  function setPill(element, label, tone) {
    element.textContent = label;
    element.setAttribute('data-tone', tone);
  }

  function isArray(value) {
    return Object.prototype.toString.call(value) === '[object Array]';
  }

  function contains(values, value) {
    var index;
    for (index = 0; index < values.length; index += 1) {
      if (values[index] === value) return true;
    }
    return false;
  }

  function basename(value) {
    if (!value) return '';
    var parts = String(value).split(/[\\/]/);
    var filtered = [];
    var index;
    for (index = 0; index < parts.length; index += 1) {
      if (parts[index]) filtered.push(parts[index]);
    }
    return filtered.length ? filtered[filtered.length - 1] : String(value);
  }

  function readQuery(name) {
    var query = window.location.search ? window.location.search.substring(1).split('&') : [];
    var index;
    for (index = 0; index < query.length; index += 1) {
      var pair = query[index].split('=');
      if (decodeURIComponent(pair[0] || '') === name) return decodeURIComponent(pair.slice(1).join('=') || '');
    }
    return '';
  }

  function friendlyError(error) {
    var code = error && error.code ? error.code : '';
    var messages = {
      INVALID_DIRECTORY: '项目目录无效。',
      NO_SERVICE: '本地任务服务未启动。',
      REVISION_CONFLICT: '任务状态已在别处更新，请刷新后再操作。',
      QUEUE_BUSY: '另一家公司仍在处理中。',
      QUEUE_NOT_RUNNING: '队列当前未运行。',
      QUEUE_PAUSED: '队列已暂停，请点击“恢复队列”。',
      QUEUE_NOT_PAUSED: '队列当前不是暂停状态。',
      QUEUE_NOT_REORDERABLE: '只有未开始或已暂停的队列可以调整企业优先级。',
      COMPANY_NOT_QUEUED: '只有尚未开始的企业可以调整优先级。',
      SESSION_INBOX_FULL: '会话桥接队列已满，请先打开 OpenChamber HUD。',
      SESSION_INBOX_BUSY: '会话桥接队列正由另一个窗口更新，请稍后重试。',
      INVALID_SESSION_MESSAGE: '会话消息不能为空且不能超过 16000 个字符。',
      INVALID_SESSION_ID: '目标会话 ID 无效，请检查 ses_… 标识。',
      STANDALONE_REQUEST_FAILED: '独立窗口无法连接本地任务服务。'
    };
    return messages[code] || (error && error.message ? error.message : '操作失败，请刷新后重试。');
  }
}());
