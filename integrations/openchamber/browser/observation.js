// 观察结果的 Node 侧清洗与二次防线：即使页面桥返回了密码、文件、提交按钮或
// 凭据区域，本层也不会把它们放进可填写控件列表。

import { PAGE_TEXT_INPUT_TYPES } from './page-bridge.js';

export const OBSERVATION_SCHEMA_VERSION = 'application-copilot.moka-observation.v1';
export const OBSERVATION_MAX_CONTROLS = 200;
export const OBSERVATION_MAX_OPTIONS = 200;
const MAX_ISSUES = 50;
const CONTROL_REF_RE = /^[A-Za-z0-9_-]{4,120}$/;
const CREDENTIAL_RE = /(密码|验证码|校验码|动态码|短信码|短信验证|一次性密码|登录|登陆|注册|安全验证|password|passcode|captcha|otp|verification\s*code|sign\s*in|log\s*in)/i;
const ALLOWED_REGION_TYPES = new Set(['basic', 'education', 'internship', 'work', 'project', 'unknown', 'credential']);
const ALLOWED_LABEL_SOURCES = new Set(['aria-label', 'aria-labelledby', 'label', 'placeholder', 'name', 'none']);
const ALLOWED_TYPES = new Set([...PAGE_TEXT_INPUT_TYPES, 'textarea', 'select']);

const PAGE_ISSUE_MESSAGES = Object.freeze({
  UNSUPPORTED_UPLOAD: '页面存在文件上传控件；本层不做上传或覆盖。',
  CREDENTIAL_FIELD_BLOCKED: '登录、验证码或凭据相关字段不读取、不填写。',
  UNSUPPORTED_CHOICE_INPUT: '复选框、单选框等选择控件未由本层填写。',
  UNSUPPORTED_INPUT_TYPE: '该原生输入类型未由本层填写。',
  UNSUPPORTED_MULTIPLE_SELECT: '多选下拉未由本层填写。',
  UNSUPPORTED_CUSTOM_COMPONENT: '存在非原生日期、下拉或富文本组件，需人工处理。',
  AMBIGUOUS_EXPERIENCE_REGION: '重复经历区域无法稳定分组，相关字段仅展示，不自动填写。',
  SELECT_TOO_MANY_OPTIONS: '下拉选项过多，本层不支持自动选择。',
  IFRAME_UNSUPPORTED: '页面包含 iframe；本层只观察主文档，不驱动跨文档控件。',
  NO_WRITABLE_CONTROLS: '当前页面没有可观察的原生文本框、文本域或下拉。',
  CONTROL_LIMIT_REACHED: '可见控件超过本层观察上限，剩余控件未返回。',
  INVALID_OBSERVED_CONTROL: '部分观察控件结构无效，已丢弃。',
});

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringOrEmpty(value, max = 200) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function intOrNull(value, max = 100000) {
  return Number.isInteger(value) && value >= 0 && value <= max ? value : null;
}

function makeIssue(code, message, extra) {
  return {
    code,
    message: message || PAGE_ISSUE_MESSAGES[code] || '观察发现问题。',
    severity: 'warning',
    ...extra,
  };
}

function sanitizeOptions(rawOptions, rawCount) {
  if (!Array.isArray(rawOptions)) return { options: null, optionCount: 0, valid: false };
  if (rawOptions.length > OBSERVATION_MAX_OPTIONS) {
    return { options: null, optionCount: 0, valid: false };
  }
  const options = [];
  for (const raw of rawOptions) {
    if (!isPlainObject(raw)) return { options: null, optionCount: 0, valid: false };
    if (typeof raw.value !== 'string' || typeof raw.label !== 'string') {
      return { options: null, optionCount: 0, valid: false };
    }
    options.push({
      value: raw.value.slice(0, 200),
      label: raw.label.slice(0, 200),
      disabled: raw.disabled === true,
      selected: raw.selected === true,
    });
  }
  const optionCount = Number.isInteger(rawCount) && rawCount >= 0
    ? rawCount
    : options.length;
  if (optionCount < options.length) {
    return { options: null, optionCount: 0, valid: false };
  }
  return { options, optionCount, valid: true };
}

function buildSignature(control) {
  return {
    tag: control.tag,
    type: control.type,
    name: control.name,
    id: control.id,
    autocomplete: control.autocomplete,
    label: control.label,
    labelSource: control.labelSource,
    regionType: control.region.type,
    regionLabel: control.region.label,
    regionEntityId: control.region.entityId,
    regionAmbiguous: control.region.ambiguous,
    maxLength: control.maxLength,
    minLength: control.minLength,
    pattern: control.pattern,
    required: control.required,
    disabled: control.disabled,
    readOnly: control.readOnly,
    value: control.__value.slice(0, 20000),
    optionCount: control.optionCount,
    options: control.options
      ? control.options.map((option) => ({
        value: option.value,
        label: option.label,
        disabled: option.disabled,
        selected: option.selected,
      }))
      : null,
  };
}

/**
 * @returns {{ok: boolean, controls: Array, issues: Array, counts: object, code?: string}}
 */
export function sanitizeObservation(raw, { maxControls = OBSERVATION_MAX_CONTROLS } = {}) {
  const issues = [];
  const issueKeys = new Set();
  const addIssue = (code, extra) => {
    if (issues.length >= MAX_ISSUES) return;
    const key = code;
    if (issueKeys.has(key)) return;
    issueKeys.add(key);
    issues.push(makeIssue(code, PAGE_ISSUE_MESSAGES[code], extra));
  };

  if (!isPlainObject(raw) || raw.ok !== true || !Array.isArray(raw.controls)) {
    return {
      ok: false,
      code: 'INVALID_OBSERVATION',
      controls: [],
      issues: [makeIssue('INVALID_OBSERVATION', '观察结果结构无效。')],
      counts: { controls: 0, blocked: 0 },
    };
  }

  if (Array.isArray(raw.issues)) {
    for (const rawIssue of raw.issues) {
      if (!isPlainObject(rawIssue) || typeof rawIssue.code !== 'string') continue;
      if (!Object.prototype.hasOwnProperty.call(PAGE_ISSUE_MESSAGES, rawIssue.code)) continue;
      addIssue(rawIssue.code, rawIssue.regionType ? { regionType: stringOrEmpty(rawIssue.regionType, 40) } : undefined);
    }
  }

  const seenRefs = new Set();
  const controls = [];
  let blocked = 0;
  const limit = Number.isInteger(maxControls)
    ? Math.min(Math.max(maxControls, 1), OBSERVATION_MAX_CONTROLS)
    : OBSERVATION_MAX_CONTROLS;

  for (const rawControl of raw.controls) {
    if (controls.length >= limit) {
      addIssue('CONTROL_LIMIT_REACHED');
      break;
    }
    if (!isPlainObject(rawControl)) {
      addIssue('INVALID_OBSERVED_CONTROL');
      blocked += 1;
      continue;
    }
    const ref = rawControl.ref;
    if (typeof ref !== 'string' || !CONTROL_REF_RE.test(ref) || seenRefs.has(ref)) {
      addIssue('INVALID_OBSERVED_CONTROL');
      blocked += 1;
      continue;
    }
    seenRefs.add(ref);

    const tag = rawControl.tag;
    const type = typeof rawControl.type === 'string' ? rawControl.type.toLowerCase() : '';
    if (!['input', 'textarea', 'select'].includes(tag)) {
      addIssue('UNSUPPORTED_INPUT_TYPE');
      blocked += 1;
      continue;
    }
    if (tag === 'input') {
      if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) {
        addIssue('UNSUPPORTED_INPUT_TYPE');
        blocked += 1;
        continue;
      }
      if (type === 'password') {
        addIssue('CREDENTIAL_FIELD_BLOCKED');
        blocked += 1;
        continue;
      }
      if (type === 'file') {
        addIssue('UNSUPPORTED_UPLOAD');
        blocked += 1;
        continue;
      }
      if (['checkbox', 'radio', 'range', 'color'].includes(type)) {
        addIssue('UNSUPPORTED_CHOICE_INPUT');
        blocked += 1;
        continue;
      }
    }
    if (!ALLOWED_TYPES.has(type)) {
      addIssue('UNSUPPORTED_INPUT_TYPE');
      blocked += 1;
      continue;
    }
    if (tag === 'textarea' && type !== 'textarea') {
      addIssue('INVALID_OBSERVED_CONTROL');
      blocked += 1;
      continue;
    }
    if (tag === 'select' && type !== 'select') {
      addIssue('INVALID_OBSERVED_CONTROL');
      blocked += 1;
      continue;
    }
    if (tag === 'input' && (type === 'textarea' || type === 'select')) {
      addIssue('INVALID_OBSERVED_CONTROL');
      blocked += 1;
      continue;
    }

    const regionRaw = isPlainObject(rawControl.region) ? rawControl.region : {};
    const regionType = ALLOWED_REGION_TYPES.has(regionRaw.type) ? regionRaw.type : 'unknown';
    if (regionType === 'credential') {
      addIssue('CREDENTIAL_FIELD_BLOCKED');
      blocked += 1;
      continue;
    }
    const label = stringOrEmpty(rawControl.label, 200);
    const identityText = [
      label,
      stringOrEmpty(rawControl.name, 200),
      stringOrEmpty(rawControl.id, 200),
      stringOrEmpty(rawControl.placeholder, 200),
    ].join(' ');
    if (CREDENTIAL_RE.test(identityText)) {
      addIssue('CREDENTIAL_FIELD_BLOCKED');
      blocked += 1;
      continue;
    }

    const labelSource = ALLOWED_LABEL_SOURCES.has(rawControl.labelSource) ? rawControl.labelSource : 'none';
    const entityId = regionType === 'unknown' || regionType === 'basic'
      ? null
      : (typeof regionRaw.entityId === 'string' && regionRaw.entityId.length <= 200 ? regionRaw.entityId : null);
    const region = {
      type: regionType,
      label: stringOrEmpty(regionRaw.label, 200),
      entityId,
      ambiguous: regionRaw.ambiguous === true,
    };

    let options = null;
    let optionCount = 0;
    if (tag === 'select') {
      const sanitized = sanitizeOptions(rawControl.options, rawControl.optionCount);
      if (!sanitized.valid) {
        addIssue('INVALID_OBSERVED_CONTROL');
        blocked += 1;
        continue;
      }
      options = sanitized.options;
      optionCount = sanitized.optionCount;
    }

    const value = typeof rawControl.value === 'string' ? rawControl.value : '';
    const control = {
      ref,
      tag,
      type,
      name: stringOrEmpty(rawControl.name, 200),
      id: stringOrEmpty(rawControl.id, 200),
      autocomplete: stringOrEmpty(rawControl.autocomplete, 100),
      placeholder: stringOrEmpty(rawControl.placeholder, 200),
      label,
      labelSource,
      region,
      maxLength: intOrNull(rawControl.maxLength),
      minLength: intOrNull(rawControl.minLength),
      pattern: stringOrEmpty(rawControl.pattern, 300),
      required: rawControl.required === true,
      disabled: rawControl.disabled === true,
      readOnly: rawControl.readOnly === true,
      options,
      optionCount,
      hasValue: value.length > 0,
      writable: rawControl.writable !== false,
      writableReason: null,
      __value: value,
    };

    if (region.ambiguous) {
      control.writable = false;
      control.writableReason = 'AMBIGUOUS_REGION';
    } else if (tag === 'select' && optionCount > OBSERVATION_MAX_OPTIONS) {
      control.writable = false;
      control.writableReason = 'SELECT_TOO_MANY_OPTIONS';
    } else if (control.disabled) {
      control.writable = false;
      control.writableReason = 'DISABLED';
    } else if (control.readOnly) {
      control.writable = false;
      control.writableReason = 'READ_ONLY';
    }
    control.signature = buildSignature(control);
    controls.push(control);
  }

  if (!controls.length) addIssue('NO_WRITABLE_CONTROLS');

  return {
    ok: true,
    controls,
    issues,
    counts: { controls: controls.length, blocked },
  };
}

/** 返回可交给上层的公开快照控件（不含内部观察值和签名）。 */
export function publicControl(control) {
  return {
    ref: control.ref,
    tag: control.tag,
    type: control.type,
    name: control.name,
    id: control.id,
    autocomplete: control.autocomplete,
    placeholder: control.placeholder,
    label: control.label,
    labelSource: control.labelSource,
    region: { ...control.region },
    maxLength: control.maxLength,
    minLength: control.minLength,
    pattern: control.pattern,
    required: control.required,
    disabled: control.disabled,
    readOnly: control.readOnly,
    hasValue: control.hasValue,
    options: control.options ? control.options.map((option) => ({ ...option })) : null,
    optionCount: control.optionCount,
    writable: control.writable,
    writableReason: control.writableReason,
  };
}
