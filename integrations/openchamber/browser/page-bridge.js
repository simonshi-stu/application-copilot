// 固定的页面侧桥接函数。它只会通过 Runtime.evaluate 以 JSON 参数调用，
// 不接受 selector、脚本、点击或提交动作。页面侧只做观察、原生值写入和只读岗位文本提取。
// 注意：函数会被 .toString() 注入页面，所有常量必须定义在函数内部。

function acopilotPageBridge(payload) {
  'use strict';
  const MAX_PAGE_TEXT = 12000;
  const MAX_OPTION_COUNT = 200;
  const MAX_CONTROLS = 200;
  const MAX_ISSUES = 50;
  const TEXT_INPUT_TYPES = new Set([
    'text', 'email', 'tel', 'url', 'search', 'number',
    'date', 'month', 'week', 'time', 'datetime-local',
  ]);
  const IGNORED_INPUT_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
  const UNSUPPORTED_CHOICE_TYPES = new Set(['checkbox', 'radio', 'range', 'color']);
  const SIGNATURE_KEYS = [
    'tag', 'type', 'name', 'id', 'autocomplete', 'label', 'labelSource',
    'regionType', 'regionLabel', 'regionEntityId', 'regionAmbiguous',
    'maxLength', 'minLength', 'pattern', 'required', 'disabled', 'readOnly',
    'value', 'optionCount', 'options',
  ];
  const REGION_RULES = [
    ['credential', /(密码|验证码|校验码|动态码|短信码|短信验证|一次性密码|登录|登陆|注册|安全验证|账号密码|password|passcode|captcha|otp|verification\s*code|one[-\s]?time|sign\s*in|log\s*in)/i],
    ['education', /(教育经历|教育背景|教育信息|学历信息|学校信息|education|academic\s+background)/i],
    ['internship', /(实习经历|实习经验|实习信息|实习情况|internship)/i],
    ['work', /(工作经历|工作经验|职业经历|任职经历|work\s*experience|employment)/i],
    ['project', /(项目经历|项目经验|项目信息|科研经历|project\s*experience|research\s*experience)/i],
    ['basic', /(基本信息|个人信息|基础信息|联系方式|个人资料|basic\s*info|personal\s*info|contact\s*info)/i],
  ];
  const CREDENTIAL_HINT = /(密码|验证码|校验码|动态码|短信码|短信验证|一次性密码|登录|登陆|注册|安全验证|password|passcode|captcha|otp|verification\s*code|one[-\s]?time|sign\s*in|log\s*in)/i;
  const input = payload && typeof payload === 'object' ? payload : {};
  const op = String(input.op || '');
  const issues = [];
  const issueKeys = new Set();

  function addIssue(code, message, extra) {
    if (issues.length >= MAX_ISSUES) return;
    const key = `${code}|${message}`;
    if (issueKeys.has(key)) return;
    issueKeys.add(key);
    const entry = { code, message, severity: 'warning' };
    if (extra && typeof extra === 'object') {
      for (const [name, value] of Object.entries(extra)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
          entry[name] = value;
        }
      }
    }
    issues.push(entry);
  }

  function normText(value, max) {
    const text = String(value == null ? '' : value).replace(/[\s\u3000]+/g, ' ').trim();
    return max ? text.slice(0, max) : text;
  }

  function rawText(node, max) {
    if (!node) return '';
    return normText(node.innerText || node.textContent || '', max || 500);
  }

  function isElement(node) {
    return !!node && node.nodeType === 1;
  }

  function visible(el) {
    if (!isElement(el) || !el.isConnected) return false;
    if (el.closest('[hidden]')) return false;
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
    let style;
    try {
      style = getComputedStyle(el);
    } catch {
      return false;
    }
    if (!style) return false;
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (Number(style.opacity) === 0) return false;
    if (typeof el.getClientRects === 'function') {
      const rects = el.getClientRects();
      for (let i = 0; i < rects.length; i += 1) {
        if (rects[i].width > 0 && rects[i].height > 0) return true;
      }
      return false;
    }
    return true;
  }

  function fnv1a(value) {
    let hash = 0x811c9dc5;
    const text = String(value == null ? '' : value);
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  function classKey(el) {
    if (!isElement(el)) return '';
    const className = typeof el.className === 'string' ? el.className : '';
    return `${el.tagName}|${className}|${el.getAttribute('role') || ''}`;
  }

  function countControls(node) {
    if (!node || typeof node.querySelectorAll !== 'function') return 0;
    return node.querySelectorAll('input:not([type="hidden"]), textarea, select').length;
  }

  function headingText(node) {
    if (!node || typeof node.querySelector !== 'function') return '';
    const candidates = node.querySelectorAll('h1,h2,h3,h4,h5,h6,legend,[class*="title"],[class*="header"],[class*="name"]');
    for (const candidate of candidates) {
      if (candidate.tagName === 'LABEL') continue;
      const text = rawText(candidate, 80);
      if (text) return text;
    }
    return '';
  }

  function labelInfo(el) {
    const pieces = [];
    let source = 'none';
    const aria = el.getAttribute('aria-label');
    if (aria) {
      pieces.push(aria);
      source = 'aria-label';
    }
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const ids = labelledby.split(/\s+/).slice(0, 5);
      for (const id of ids) {
        const node = document.getElementById(id);
        if (node) {
          pieces.push(rawText(node, 200));
          source = 'aria-labelledby';
        }
      }
    }
    if (el.labels && el.labels.length) {
      for (const label of Array.from(el.labels).slice(0, 3)) pieces.push(rawText(label, 200));
      if (source === 'none') source = 'label';
    }
    if (!pieces.length && el.id) {
      const escaped = typeof CSS !== 'undefined' && CSS.escape
        ? CSS.escape(el.id)
        : el.id.replace(/["\\]/g, '\\$&');
      const label = document.querySelector(`label[for="${escaped}"]`);
      if (label) {
        pieces.push(rawText(label, 200));
        source = 'label';
      }
    }
    if (!pieces.length) {
      const placeholder = el.getAttribute('placeholder');
      if (placeholder) {
        pieces.push(placeholder);
        source = 'placeholder';
      }
    }
    if (!pieces.length) {
      const name = el.getAttribute('name') || el.id || '';
      if (name) {
        pieces.push(name);
        source = 'name';
      }
    }
    const text = normText(pieces.filter(Boolean).join(' '), 200);
    return { text, source: text ? source : 'none' };
  }

  function credentialPasswordInside(node) {
    if (!node || typeof node.querySelector !== 'function') return false;
    const password = node.querySelector('input[type="password"],input[autocomplete="current-password"],input[autocomplete="new-password"]');
    if (!password) return false;
    return countControls(node) <= 12;
  }

  function hasRepeatedCards(node) {
    if (!node || typeof node.children === 'undefined') return false;
    const limit = { scanned: 0 };
    function scan(parent, depth) {
      if (!parent || depth > 3 || limit.scanned > 200) return false;
      const children = Array.from(parent.children || []);
      const groups = new Map();
      for (const child of children) {
        const key = classKey(child);
        groups.set(key, (groups.get(key) || 0) + 1);
      }
      for (const child of children) {
        limit.scanned += 1;
        if (countControls(child) >= 2 && (groups.get(classKey(child)) || 0) >= 2) return true;
        if (scan(child, depth + 1)) return true;
      }
      return false;
    }
    return scan(node, 0);
  }

  function hasMultipleItemHeadings(node) {
    if (!node || typeof node.querySelectorAll !== 'function') return false;
    const groups = new Map();
    const headings = node.querySelectorAll('h3,h4,h5,h6,legend,[role="heading"]');
    for (const heading of headings) {
      if (heading.closest('label')) continue;
      const text = rawText(heading, 80);
      if (!text) continue;
      const key = heading.tagName;
      if (!groups.has(key)) groups.set(key, new Set());
      groups.get(key).add(text);
    }
    for (const values of groups.values()) {
      if (values.size >= 2) return true;
    }
    return false;
  }

  function entityInfo(el, regionNode, type) {
    if (!['education', 'internship', 'work', 'project'].includes(type)) {
      return { entityId: null, ambiguous: false, anchor: '' };
    }
    const regionParent = regionNode ? regionNode.parentElement : null;
    let node = el.parentElement;
    let depth = 0;
    while (node && depth < 9 && node !== regionParent && node !== document.body) {
      const parent = node.parentElement;
      if (parent) {
        const key = classKey(node);
        const siblings = Array.from(parent.children).filter((sibling) => classKey(sibling) === key);
        if (siblings.length >= 2 && countControls(node) >= 2) {
          const index = siblings.indexOf(node);
          const anchor = headingText(node);
          const hash = fnv1a(`${anchor}|${index}`);
          return {
            entityId: `${type}:${index}:${hash.toString(16).padStart(8, '0')}`,
            ambiguous: false,
            anchor,
          };
        }
      }
      node = node.parentElement;
      depth += 1;
    }
    if (hasRepeatedCards(regionNode) || hasMultipleItemHeadings(regionNode)) {
      return { entityId: null, ambiguous: true, anchor: '' };
    }
    return { entityId: null, ambiguous: false, anchor: '' };
  }

  function regionInfo(el) {
    let node = el.parentElement;
    let depth = 0;
    while (node && depth < 12 && node !== document.body && node !== document.documentElement) {
      const attributes = `${typeof node.className === 'string' ? node.className : ''} ${node.id || ''}`.slice(0, 300);
      const headings = [];
      if (typeof node.querySelectorAll === 'function') {
        const nodes = node.querySelectorAll('h1,h2,h3,h4,h5,h6,legend,[role="heading"],[class*="title"],[class*="header"]');
        for (const candidate of nodes) {
          if (headings.length >= 4) break;
          if (candidate.tagName === 'LABEL') continue;
          if (candidate.contains(el)) continue;
          const text = rawText(candidate, 80);
          if (text) headings.push(text);
        }
      }
      const haystack = `${headings.join(' ')} ${attributes}`.slice(0, 600);
      let type = 'unknown';
      for (const [name, pattern] of REGION_RULES) {
        if (pattern.test(haystack)) {
          type = name;
          break;
        }
      }
      if (type === 'credential') {
        return { type, label: headings[0] || '登录/凭据区域', entityId: null, ambiguous: false, credential: true };
      }
      if (type !== 'unknown') {
        if (credentialPasswordInside(node)) {
          return { type: 'credential', label: headings[0] || '登录/凭据区域', entityId: null, ambiguous: false, credential: true };
        }
        const entity = entityInfo(el, node, type);
        return {
          type,
          label: headings[0] || '',
          entityId: entity.entityId,
          ambiguous: entity.ambiguous,
          credential: false,
        };
      }
      node = node.parentElement;
      depth += 1;
    }

    if (el.form && credentialPasswordInside(el.form)) {
      return { type: 'credential', label: '登录/凭据区域', entityId: null, ambiguous: false, credential: true };
    }
    return { type: 'unknown', label: '', entityId: null, ambiguous: false, credential: false };
  }

  function optionList(el) {
    if (!el.options) return { options: null, optionCount: 0 };
    const all = Array.from(el.options);
    const options = all.slice(0, MAX_OPTION_COUNT).map((option) => ({
      value: String(option.value == null ? '' : option.value),
      label: normText(option.text, 200),
      disabled: !!option.disabled,
      selected: !!option.selected,
    }));
    return { options, optionCount: all.length };
  }

  function numberOrNull(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : null;
  }

  function signatureFor(el, label, region) {
    const tag = el.tagName.toLowerCase();
    const type = tag === 'textarea'
      ? 'textarea'
      : tag === 'select'
        ? 'select'
        : String(el.type || 'text').toLowerCase();
    const { options, optionCount } = optionList(el);
    return {
      tag,
      type,
      name: String(el.getAttribute('name') || '').slice(0, 200),
      id: String(el.id || '').slice(0, 200),
      autocomplete: String(el.getAttribute('autocomplete') || '').slice(0, 100),
      label: label.text,
      labelSource: label.source,
      regionType: region.type,
      regionLabel: region.label,
      regionEntityId: region.entityId,
      regionAmbiguous: !!region.ambiguous,
      maxLength: numberOrNull(el.maxLength),
      minLength: numberOrNull(el.minLength),
      pattern: String(el.getAttribute('pattern') || '').slice(0, 300),
      required: !!el.required,
      disabled: !!el.disabled,
      readOnly: !!el.readOnly,
      value: String(el.value == null ? '' : el.value).slice(0, 20000),
      optionCount,
      options,
    };
  }

  function inspectControl(el, index, refPrefix) {
    const tag = el.tagName.toLowerCase();
    const type = tag === 'select'
      ? 'select'
      : tag === 'textarea'
        ? 'textarea'
        : String(el.getAttribute('type') || 'text').toLowerCase();

    if (tag === 'input') {
      if (IGNORED_INPUT_TYPES.has(type)) return null;
      if (type === 'password') {
        addIssue('CREDENTIAL_FIELD_BLOCKED', '密码字段不读取、不填写。');
        return null;
      }
      if (type === 'file') {
        addIssue('UNSUPPORTED_UPLOAD', '文件上传控件未由本层填写，请在网站人工上传并核验。');
        return null;
      }
      if (UNSUPPORTED_CHOICE_TYPES.has(type)) {
        addIssue('UNSUPPORTED_CHOICE_INPUT', '复选框、单选框等选择控件未由本层填写。');
        return null;
      }
      if (!TEXT_INPUT_TYPES.has(type)) {
        addIssue('UNSUPPORTED_INPUT_TYPE', '该原生输入类型未由本层填写。');
        return null;
      }
    }
    if (tag === 'select' && el.multiple) {
      addIssue('UNSUPPORTED_MULTIPLE_SELECT', '多选下拉未由本层填写。');
      return null;
    }

    const label = labelInfo(el);
    const region = regionInfo(el);
    const identityText = [
      label.text,
      el.getAttribute('name'),
      el.id,
      el.getAttribute('placeholder'),
      el.getAttribute('autocomplete'),
    ].filter(Boolean).join(' ');
    if (region.credential || CREDENTIAL_HINT.test(identityText)) {
      addIssue('CREDENTIAL_FIELD_BLOCKED', '登录、验证码或凭据相关字段不读取、不填写。');
      return null;
    }

    const ref = `${refPrefix}-${index}`;
    el.setAttribute('data-acopilot-control', ref);
    const { options, optionCount } = tag === 'select'
      ? optionList(el)
      : { options: null, optionCount: 0 };
    const value = String(el.value == null ? '' : el.value);
    let writable = true;
    let writableReason = null;
    if (region.ambiguous) {
      writable = false;
      writableReason = 'AMBIGUOUS_REGION';
      addIssue('AMBIGUOUS_EXPERIENCE_REGION', '重复经历区域无法稳定分组，相关字段仅展示，不自动填写。', { regionType: region.type });
    } else if (tag === 'select' && optionCount > MAX_OPTION_COUNT) {
      writable = false;
      writableReason = 'SELECT_TOO_MANY_OPTIONS';
      addIssue('SELECT_TOO_MANY_OPTIONS', '下拉选项过多，本层不支持自动选择。');
    } else if (el.disabled) {
      writable = false;
      writableReason = 'DISABLED';
    } else if (el.readOnly) {
      writable = false;
      writableReason = 'READ_ONLY';
    }

    return {
      ref,
      tag,
      type,
      name: String(el.getAttribute('name') || '').slice(0, 200),
      id: String(el.id || '').slice(0, 200),
      autocomplete: String(el.getAttribute('autocomplete') || '').slice(0, 100),
      placeholder: String(el.getAttribute('placeholder') || '').slice(0, 200),
      label: label.text,
      labelSource: label.source,
      region: {
        type: region.type,
        label: region.label,
        entityId: region.entityId,
        ambiguous: !!region.ambiguous,
      },
      maxLength: numberOrNull(el.maxLength),
      minLength: numberOrNull(el.minLength),
      pattern: String(el.getAttribute('pattern') || '').slice(0, 300),
      required: !!el.required,
      disabled: !!el.disabled,
      readOnly: !!el.readOnly,
      hasValue: value.length > 0,
      value,
      options,
      optionCount,
      writable,
      writableReason,
      signature: signatureFor(el, label, region),
    };
  }

  function runInfo() {
    const bodyText = normText((document.body && document.body.innerText) || '', 1200);
    return {
      ok: true,
      url: String(location.href),
      title: String(document.title || ''),
      readyState: String(document.readyState || ''),
      hasPasswordField: !!document.querySelector('input[type="password"]'),
      loginHint: CREDENTIAL_HINT.test(bodyText),
    };
  }

  function runObserve() {
    const refPrefix = String(input.refPrefix || 'mc_snapshot');
    const maxControls = Math.min(Math.max(Number(input.maxControls) || MAX_CONTROLS, 1), 400);
    if (document.querySelector('input[type="file"]')) {
      addIssue('UNSUPPORTED_UPLOAD', '页面存在文件上传控件；本层不做上传或覆盖。');
    }
    if (document.querySelector('input[type="password"]')) {
      addIssue('CREDENTIAL_FIELD_BLOCKED', '页面存在密码字段；本层不读取、不填写。');
    }
    if (document.querySelector('iframe, frame')) {
      addIssue('IFRAME_UNSUPPORTED', '页面包含 iframe；本层只观察主文档，不驱动跨文档控件。');
    }
    if (document.querySelector('[class*="datepicker" i],[class*="date-picker" i],[class*="calendar" i],[class*="rich-text" i],[class*="upload" i],[class*="picker" i],[class*="select2" i],[class*="ant-select" i],[class*="el-select" i],[aria-haspopup="dialog" i],[data-picker]')) {
      addIssue('UNSUPPORTED_CUSTOM_COMPONENT', '存在日期、富文本或上传等自定义组件，需人工处理。');
    }

    const nodes = Array.from(document.querySelectorAll(
      'input,textarea,select,[contenteditable="true"],[role="combobox"]',
    ));
    const controls = [];
    let index = 0;
    for (const node of nodes) {
      if (controls.length >= maxControls) {
        addIssue('CONTROL_LIMIT_REACHED', '可见控件超过本层观察上限，剩余控件未返回。');
        break;
      }
      if (!visible(node)) continue;
      const tag = node.tagName.toLowerCase();
      const role = node.getAttribute('role');
      const editable = node.getAttribute('contenteditable');
      if (editable === 'true' || (role === 'combobox' && tag !== 'select')) {
        addIssue('UNSUPPORTED_CUSTOM_COMPONENT', '存在非原生日期、下拉或富文本组件，需人工处理。');
        continue;
      }
      if (!['input', 'textarea', 'select'].includes(tag)) continue;
      const inspected = inspectControl(node, index, refPrefix);
      if (inspected) {
        controls.push(inspected);
        index += 1;
      }
    }
    if (!controls.length) {
      addIssue('NO_WRITABLE_CONTROLS', '当前页面没有可观察的原生文本框、文本域或下拉。');
    }
    return {
      ok: true,
      url: String(location.href),
      title: String(document.title || ''),
      controls,
      issues,
      counts: { controls: controls.length },
    };
  }

  function sameValue(left, right) {
    if (left === right) return true;
    if (left === null || right === null || left === undefined || right === undefined) return false;
    if (typeof left !== 'object' && typeof right !== 'object') return false;
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }

  function fireEvents(el) {
    try {
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    } catch {
      // 页面自行阻止事件时仍继续读回，不能假装成功。
    }
    try {
      el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    } catch {
      // 同上。
    }
    try {
      el.dispatchEvent(new Event('blur'));
    } catch {
      // 同上。
    }
    try {
      if (document.activeElement === el) el.blur();
    } catch {
      // 同上。
    }
  }

  function runWrite() {
    const expectedUrl = String(input.expectedUrl || '');
    const currentUrl = String(location.href);
    if (currentUrl !== expectedUrl) {
      return { ok: false, code: 'PAGE_URL_CHANGED', url: currentUrl, message: '页面网址在写入前已变化。' };
    }
    const ref = String(input.ref || '');
    if (!/^[A-Za-z0-9_-]{4,120}$/.test(ref)) {
      return { ok: false, code: 'INVALID_CONTROL_REF', url: currentUrl, message: '控件引用格式无效。' };
    }
    const el = Array.from(document.querySelectorAll('[data-acopilot-control]'))
      .find((node) => node.getAttribute('data-acopilot-control') === ref);
    if (!el) {
      return { ok: false, code: 'CONTROL_NOT_FOUND', url: currentUrl, message: '观察时的控件已不存在。' };
    }
    if (!visible(el)) {
      return { ok: false, code: 'CONTROL_NOT_VISIBLE', url: currentUrl, message: '控件当前不可见。' };
    }

    const label = labelInfo(el);
    const region = regionInfo(el);
    const live = signatureFor(el, label, region);
    const expected = input.expected && typeof input.expected === 'object' ? input.expected : {};
    const changed = SIGNATURE_KEYS.filter((key) => !sameValue(live[key], expected[key]));
    if (changed.length) {
      return {
        ok: false,
        code: 'CHANGED_CONTROL',
        changedFields: changed,
        url: currentUrl,
        message: '控件在观察后已变化，拒绝写入。',
      };
    }
    if (live.disabled) {
      return { ok: false, code: 'CONTROL_DISABLED', url: currentUrl, message: '控件已禁用。' };
    }
    if (live.readOnly) {
      return { ok: false, code: 'CONTROL_READONLY', url: currentUrl, message: '控件只读。' };
    }
    const text = String(input.text == null ? '' : input.text);
    if (!text.length) {
      return { ok: false, code: 'EMPTY_TEXT', url: currentUrl, message: '确认文本为空。' };
    }
    if (live.maxLength !== null && text.length > live.maxLength) {
      return {
        ok: false,
        code: 'TOO_LONG',
        limit: live.maxLength,
        actualLength: text.length,
        url: currentUrl,
        message: '确认文本超过控件长度限制。',
      };
    }

    if (live.type === 'select') {
      const option = input.option && typeof input.option === 'object' ? input.option : null;
      if (!option || typeof option.value !== 'string' || typeof option.label !== 'string') {
        return { ok: false, code: 'OPTION_REQUIRED', url: currentUrl, message: '下拉字段需要精确选项值。' };
      }
      const matches = Array.from(el.options).filter((candidate) => (
        String(candidate.value) === option.value && normText(candidate.text, 200) === option.label
      ));
      if (matches.length !== 1) {
        return {
          ok: false,
          code: matches.length ? 'OPTION_AMBIGUOUS' : 'OPTION_NOT_FOUND',
          url: currentUrl,
          message: matches.length ? '下拉选项不唯一。' : '下拉选项不存在。',
        };
      }
      if (matches[0].disabled) {
        return { ok: false, code: 'OPTION_DISABLED', url: currentUrl, message: '下拉选项已禁用。' };
      }
      if (/^(请选择|请选择一项|请选择\.\.\.|--+|-|—+|select|choose|please\s*select)$/i.test(option.label)) {
        return { ok: false, code: 'OPTION_PLACEHOLDER', url: currentUrl, message: '不能把下拉占位项当作已确认值。' };
      }
      const currentOption = el.options[el.selectedIndex];
      if (live.value === option.value && currentOption && normText(currentOption.text, 200) === option.label) {
        return { ok: true, status: 'already_set', code: null, readBackMatched: true, url: currentUrl };
      }
      if (live.value.length > 0) {
        const placeholder = currentOption
          && /^(请选择|请选择一项|请选择\.\.\.|--+|-|—+|select|choose|please\s*select)$/i.test(normText(currentOption.text, 200));
        if (!placeholder) {
          return {
            ok: false,
            code: 'CONTROL_NOT_EMPTY',
            url: currentUrl,
            message: '控件已有不同值，未覆盖。请本人确认后手动清空。',
          };
        }
      }
      const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
      if (!descriptor || typeof descriptor.set !== 'function') {
        return { ok: false, code: 'UNSUPPORTED_VALUE_SETTER', url: currentUrl, message: '无法使用原生下拉值设置器。' };
      }
      descriptor.set.call(el, option.value);
      fireEvents(el);
      const selected = el.options[el.selectedIndex];
      const readBackMatched = el.isConnected
        && el.value === option.value
        && !!selected
        && normText(selected.text, 200) === option.label;
      return {
        ok: true,
        status: 'filled',
        code: null,
        readBackMatched,
        readBackValue: String(el.value),
        readBackLabel: selected ? normText(selected.text, 200) : null,
        url: currentUrl,
      };
    }

    if (live.value.length > 0) {
      if (live.value === text) {
        return { ok: true, status: 'already_set', code: null, readBackMatched: true, url: currentUrl };
      }
      return {
        ok: false,
        code: 'CONTROL_NOT_EMPTY',
        url: currentUrl,
        message: '控件已有不同值，未覆盖。请本人确认后手动清空。',
      };
    }

    const prototype = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (!descriptor || typeof descriptor.set !== 'function') {
      return { ok: false, code: 'UNSUPPORTED_VALUE_SETTER', url: currentUrl, message: '无法使用原生值设置器。' };
    }
    descriptor.set.call(el, text);
    fireEvents(el);
    const readBack = String(el.value == null ? '' : el.value);
    return {
      ok: true,
      status: 'filled',
      code: null,
      readBackMatched: el.isConnected && readBack === text,
      readBackLength: readBack.length,
      url: currentUrl,
    };
  }

  function absoluteMokaHref(href) {
    try {
      const url = new URL(href, location.href);
      if (url.protocol !== 'https:') return null;
      const hostname = url.hostname.toLowerCase();
      if (hostname !== 'mokahr.com' && !hostname.endsWith('.mokahr.com')) return null;
      if (url.username || url.password) return null;
      if (url.port !== '' && url.port !== '443') return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function runResearch() {
    const pageUrl = String(location.href);
    const title = String(document.title || '');
    const bodyText = normText((document.body && document.body.innerText) || '', MAX_PAGE_TEXT);
    const hasPassword = !!document.querySelector('input[type="password"]');
    const loginPath = /(?:^|\/)(?:login|signin|sign-in|passport|auth)(?:\/|$)/i.test(location.pathname);
    if (loginPath || (hasPassword && CREDENTIAL_HINT.test(bodyText.slice(0, 2500)))) {
      return {
        ok: true,
        status: 'blocked',
        code: 'LOGIN_REQUIRED',
        url: pageUrl,
        title,
        jobs: [],
        issues: [{ code: 'LOGIN_REQUIRED', message: '当前页面可能需要本人登录；本层不读取或代填登录凭据。', severity: 'blocked' }],
      };
    }

    const maxJobs = Math.min(Math.max(Number(input.maxJobs) || 30, 1), 50);
    const maxText = Math.min(Math.max(Number(input.maxText) || 4000, 200), 8000);
    const jobs = [];
    const seen = new Set();
    const anchors = Array.from(document.querySelectorAll('a[href]')).slice(0, 800);
    for (const anchor of anchors) {
      if (!visible(anchor)) continue;
      const href = absoluteMokaHref(anchor.getAttribute('href'));
      if (!href) continue;
      const anchorText = normText(anchor.innerText || anchor.textContent, 120);
      if (!anchorText || anchorText.length < 2 || anchorText.length > 80) continue;
      if (/^(首页|登录|注册|返回|查看更多|更多|申请|投递|立即申请|查看详情|详情|上一页|下一页)$/.test(anchorText)) continue;
      const url = new URL(href);
      const pathHint = /(job|jobs|position|positions|vacancy|career|apply|application)/i.test(`${url.pathname} ${url.search}`);
      const card = anchor.closest('[class*="job"],[class*="position"],[class*="vacancy"],[class*="career"],[class*="post"],[class*="recruit"]')
        || anchor.parentElement;
      const cardClass = card ? `${typeof card.className === 'string' ? card.className : ''} ${card.id || ''}` : '';
      if (!pathHint && !/(job|position|vacancy|career|post|recruit)/i.test(cardClass)) continue;

      const cardText = normText(card ? (card.innerText || card.textContent) : anchorText, 1200);
      let jobId = url.searchParams.get('jobId')
        || url.searchParams.get('job_id')
        || url.searchParams.get('postId')
        || url.searchParams.get('post_id')
        || url.searchParams.get('positionId')
        || url.searchParams.get('position_id')
        || '';
      if (!jobId) {
        const match = url.pathname.match(/\/(?:job|jobs|position|positions|apply)\/([A-Za-z0-9_-]{2,80})/);
        if (match) jobId = match[1];
      }
      if (!jobId) {
        jobId = `h_${fnv1a(`${href}|${anchorText}`).toString(16).padStart(8, '0')}`;
      }
      const key = `${jobId}|${href}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let city = null;
      const cityMatch = cardText.match(/(?:工作地点|工作城市|地点|城市|base|location|city)\s*[：:]\s*([^\s|，,;；/]{1,30})/i);
      if (cityMatch) city = cityMatch[1];
      if (!city && card && typeof card.querySelector === 'function') {
        const cityNode = card.querySelector('[class*="city"],[class*="location"],[data-city]');
        if (cityNode) {
          const cityText = normText(cityNode.innerText || cityNode.textContent, 30);
          if (cityText) city = cityText;
        }
      }

      jobs.push({
        jobId: String(jobId).slice(0, 120),
        title: anchorText,
        url: href,
        city,
        jd: null,
        visibleText: cardText,
        source: 'visible-list',
      });
      if (jobs.length >= maxJobs) break;
    }

    let jdText = null;
    const jdHeadings = new Set(['职位描述', '岗位描述', '工作职责', '岗位职责', '任职要求', '任职资格', '职位详情']);
    const headingNodes = document.querySelectorAll('h1,h2,h3,h4,h5,h6,div,section');
    for (const heading of headingNodes) {
      if (!visible(heading)) continue;
      const text = normText(heading.innerText || heading.textContent, 40);
      if (!jdHeadings.has(text)) continue;
      let box = heading.parentElement;
      for (let depth = 0; depth < 4 && box; depth += 1) {
        const boxText = normText(box.innerText || box.textContent, maxText);
        if (boxText.length > text.length + 30) {
          jdText = boxText;
          break;
        }
        box = box.parentElement;
      }
      if (jdText) break;
    }

    if (jdText && jobs.length === 1) {
      jobs[0].jd = jdText;
    } else if (jdText && jobs.length > 1) {
      addIssue('JD_NOT_BOUND', '页面有职位描述文本，但无法确定对应哪一个岗位卡；未把它绑定到多个岗位。');
    } else if (jdText && jobs.length === 0) {
      addIssue('JD_WITHOUT_JOB', '页面有职位描述文本，但没有可靠岗位卡。');
    }

    if (!jobs.length) {
      addIssue('NO_RELIABLE_JOB_CARDS', '未发现可确认的官方岗位卡；不能据此判断没有合适职位。');
      return {
        ok: true,
        status: 'incomplete',
        code: 'NO_RELIABLE_JOB_CARDS',
        url: pageUrl,
        title,
        jobs: [],
        issues,
      };
    }

    return { ok: true, status: 'ok', code: null, url: pageUrl, title, jobs, issues };
  }

  function runReadback() {
    const expectedUrl = String(input.expectedUrl || '');
    const currentUrl = String(location.href);
    if (!expectedUrl || currentUrl !== expectedUrl) {
      return { ok: false, code: 'PAGE_URL_CHANGED', url: currentUrl, fields: [], message: '页面网址已变化；拒绝读回。' };
    }
    const refs = Array.isArray(input.refs) ? input.refs.slice(0, 50) : [];
    if (!refs.length) {
      return { ok: false, code: 'NO_REFS', url: currentUrl, fields: [], message: '没有可读回的已注册控件。' };
    }
    const registered = new Map();
    for (const node of Array.from(document.querySelectorAll('[data-acopilot-control]'))) {
      const key = node.getAttribute('data-acopilot-control');
      if (key) registered.set(key, node);
    }
    const fields = [];
    for (const ref of refs) {
      if (typeof ref !== 'string' || !/^[A-Za-z0-9_-]{4,120}$/.test(ref)) {
        return { ok: false, code: 'INVALID_CONTROL_REF', url: currentUrl, fields: [], message: '控件引用格式无效。' };
      }
      const el = registered.get(ref);
      if (!el || !visible(el)) {
        return { ok: false, code: 'CONTROL_NOT_FOUND', url: currentUrl, fields: [], message: '已注册控件不存在或不可见；读回失败。' };
      }
      const tag = el.tagName.toLowerCase();
      if (!['input', 'textarea', 'select'].includes(tag)) {
        return { ok: false, code: 'UNSUPPORTED_READBACK_TYPE', url: currentUrl, fields: [], message: '拒绝读回非原生输入控件。' };
      }
      const type = tag === 'select'
        ? 'select'
        : tag === 'textarea'
          ? 'textarea'
          : String(el.type || 'text').toLowerCase();
      if (type === 'password') {
        return { ok: false, code: 'PASSWORD_READBACK_BLOCKED', url: currentUrl, fields: [], message: '拒绝读回密码字段。' };
      }
      if (tag === 'input' && !TEXT_INPUT_TYPES.has(type)) {
        return { ok: false, code: 'UNSUPPORTED_READBACK_TYPE', url: currentUrl, fields: [], message: '拒绝读回非文本输入类型。' };
      }
      const label = labelInfo(el);
      const region = regionInfo(el);
      if (region.credential || CREDENTIAL_HINT.test(label.text)) {
        return { ok: false, code: 'CREDENTIAL_READBACK_BLOCKED', url: currentUrl, fields: [], message: '拒绝读回登录/凭据区域。' };
      }
      if (tag === 'select') {
        const selected = el.options && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
        fields.push({
          ref,
          value: String(el.value == null ? '' : el.value),
          selectedLabel: selected ? normText(selected.text, 200) : '',
          length: String(el.value == null ? '' : el.value).length,
        });
      } else {
        const value = String(el.value == null ? '' : el.value);
        fields.push({ ref, value, selectedLabel: '', length: value.length });
      }
    }
    return { ok: true, url: currentUrl, fields };
  }

  if (op === 'info') return runInfo();
  if (op === 'observe') return runObserve();
  if (op === 'write') return runWrite();
  if (op === 'research') return runResearch();
  if (op === 'readback') return runReadback();
  return { ok: false, code: 'UNKNOWN_OPERATION', message: '不支持的页面操作。' };
}

const PAGE_BRIDGE_SOURCE = acopilotPageBridge.toString();
const MAX_EXPRESSION_LENGTH = 300000;

/**
 * 把固定桥接函数和 JSON 参数组成 Runtime.evaluate 表达式。
 * 参数只作为函数实参，不拼接到代码语句中；计划不能提供 selector / 脚本。
 */
export function buildPageExpression(payload) {
  const json = JSON.stringify(payload);
  if (typeof json !== 'string' || json.length > MAX_EXPRESSION_LENGTH) {
    throw new Error('页面参数过大，拒绝执行。');
  }
  const safeJson = json
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `/*ACOPILOT_PAGE*/;(${PAGE_BRIDGE_SOURCE})(/*ACOPILOT_PAYLOAD*/${safeJson})`;
}

export const PAGE_SCRIPT_LIMITS = Object.freeze({
  maxControls: 200,
  maxOptions: 200,
  maxPageText: 12000,
  maxIssues: 50,
  maxExpressionLength: MAX_EXPRESSION_LENGTH,
});

export const PAGE_SIGNATURE_KEYS = Object.freeze([
  'tag', 'type', 'name', 'id', 'autocomplete', 'label', 'labelSource',
  'regionType', 'regionLabel', 'regionEntityId', 'regionAmbiguous',
  'maxLength', 'minLength', 'pattern', 'required', 'disabled', 'readOnly',
  'value', 'optionCount', 'options',
]);
export const PAGE_TEXT_INPUT_TYPES = Object.freeze([
  'text', 'email', 'tel', 'url', 'search', 'number',
  'date', 'month', 'week', 'time', 'datetime-local',
]);

// 测试与服务审计用：页面桥本身不得包含提交/点击/任意脚本入口。
export const PAGE_BRIDGE_SOURCE_TEXT = PAGE_BRIDGE_SOURCE;
