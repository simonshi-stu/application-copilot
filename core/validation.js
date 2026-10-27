// 无依赖的严格 schema 校验器。只支持项目实际使用的小型 JSON Schema 子集，
// 用于工具入参和私有运行文件校验；未知字段默认拒绝，避免任意 JSON 绕过流程。

export class ValidationError extends Error {
  constructor(message, path = '$') {
    super(`${path}: ${message}`);
    this.name = 'ValidationError';
    this.code = 'INVALID_INPUT';
    this.path = path;
  }
}

function typeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function describeType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

export function validateSchema(value, schema, path = '$') {
  if (!schema || typeof schema !== 'object') return value;

  if (Object.hasOwn(schema, 'const') && value !== schema.const) {
    throw new ValidationError(`必须等于 ${JSON.stringify(schema.const)}`, path);
  }

  if (Array.isArray(schema.anyOf)) {
    const errors = [];
    for (const candidate of schema.anyOf) {
      try {
        validateSchema(value, candidate, path);
        return value;
      } catch (error) {
        errors.push(error);
      }
    }
    throw new ValidationError(`不符合任一允许的结构（${errors.map(error => error.message).join('；')}）`, path);
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(type => typeMatches(value, type))) {
      throw new ValidationError(`类型应为 ${types.join('|')}，实际是 ${describeType(value)}`, path);
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.some(item => Object.is(item, value))) {
    throw new ValidationError(`值必须是 ${schema.enum.map(item => JSON.stringify(item)).join(' / ')} 之一`, path);
  }

  if (typeof value === 'string') {
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) {
      throw new ValidationError(`长度不能小于 ${schema.minLength}`, path);
    }
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) {
      throw new ValidationError(`长度不能大于 ${schema.maxLength}`, path);
    }
    if (schema.pattern && !(new RegExp(schema.pattern)).test(value)) {
      throw new ValidationError('格式不符合要求', path);
    }
    if (schema.format === 'uri' && !/^https?:\/\/[^\s]+$/i.test(value)) {
      throw new ValidationError('必须是 http(s) 地址', path);
    }
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) {
      throw new ValidationError('必须是有效日期时间', path);
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      throw new ValidationError(`不能小于 ${schema.minimum}`, path);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      throw new ValidationError(`不能大于 ${schema.maximum}`, path);
    }
  }

  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) {
      throw new ValidationError(`至少需要 ${schema.minItems} 项`, path);
    }
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) {
      throw new ValidationError(`最多允许 ${schema.maxItems} 项`, path);
    }
    if (schema.items) value.forEach((item, index) => validateSchema(item, schema.items, `${path}[${index}]`));
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties || {};
    for (const key of schema.required || []) {
      if (!Object.hasOwn(value, key)) throw new ValidationError('缺少必填字段', `${path}.${key}`);
    }
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) {
        validateSchema(item, properties[key], `${path}.${key}`);
      } else if (schema.additionalProperties === false) {
        throw new ValidationError('不允许的额外字段', `${path}.${key}`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        validateSchema(item, schema.additionalProperties, `${path}.${key}`);
      }
    }
  }

  return value;
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
