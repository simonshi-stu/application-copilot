// 严格白名单工具入口。模型只获得 agent 工具；本人操作工具只暴露给 operator 入口。
// 没有“写入任意状态 JSON”的工具，完成条件只能由服务层状态机校验。

import { validateSchema } from './validation.js';
import { FACT_SECTIONS, SENSITIVITY_LEVELS, SOURCE_TYPES } from './profile-store.js';

export class ToolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
  }
}

const id = { type: 'string', minLength: 1, maxLength: 200 };
const iso = { type: 'string', minLength: 1, format: 'date-time' };
const uri = { type: 'string', minLength: 1, format: 'uri' };
const reason = { type: 'string', minLength: 2, maxLength: 500 };
const confirmedBy = { const: 'user' };
const noArgs = { type: 'object', additionalProperties: false, properties: {} };
const scopeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['type'],
  properties: {
    type: { enum: ['global', 'company', 'position'] },
    companyId: { type: ['string', 'null'] },
    positionId: { type: ['string', 'null'] },
  },
};
const factSourceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['type'],
  properties: {
    type: { enum: SOURCE_TYPES },
    ref: { type: 'string', maxLength: 1000 },
  },
};
const factPatchSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    entityId: { type: ['string', 'null'], maxLength: 200 },
    label: { type: 'string', minLength: 1, maxLength: 200 },
    value: { type: 'string', minLength: 1, maxLength: 20000 },
    section: { enum: FACT_SECTIONS },
    scope: scopeSchema,
    sensitivity: { enum: SENSITIVITY_LEVELS },
    allowedPurposes: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 100 }, maxItems: 30 },
  },
};
const positionCandidateSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['officialId', 'title', 'sourceUrl', 'checkedAt', 'matchEvidence'],
  properties: {
    officialId: { type: 'string', minLength: 1, maxLength: 200 },
    title: { type: 'string', minLength: 1, maxLength: 300 },
    city: { type: 'string', maxLength: 100 },
    sourceUrl: uri,
    checkedAt: iso,
    matchEvidence: { type: 'string', minLength: 1, maxLength: 2000 },
  },
};
const noPositionsEvidenceInput = {
  type: 'object',
  additionalProperties: false,
  required: ['reason', 'sourceUrl', 'checkedAt', 'checkedBy', 'resultText'],
  properties: {
    reason: { type: 'string', minLength: 2, maxLength: 500 },
    sourceUrl: uri,
    checkedAt: iso,
    checkedBy: { enum: ['user', 'agent'] },
    resultText: { type: 'string', minLength: 2, maxLength: 2000 },
  },
};

export const TOOL_DEFINITIONS = Object.freeze([
  {
    name: 'get_workbench_summary',
    access: 'agent',
    description: '读取队列、当前公司、岗位和问题汇总；不修改状态。',
    inputSchema: noArgs,
    run: service => service.summary(),
  },
  {
    name: 'recover_workbench',
    access: 'agent',
    description: '从持久化状态恢复现场摘要；不会重放填写、上传或提交动作。',
    inputSchema: noArgs,
    run: service => service.recover(),
  },
  {
    name: 'list_companies',
    access: 'agent',
    description: '列出公司任务、队列顺序和确定性结果文案。',
    inputSchema: noArgs,
    run: (service, input, context) => service.listCompanies(context),
  },
  {
    name: 'get_company',
    access: 'agent',
    description: '读取一家公司的岗位、问题和当前结果；不修改。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['companyId'],
      properties: { companyId: id },
    },
    run: (service, input, context) => service.getCompany(input, context),
  },
  {
    name: 'list_issues',
    access: 'agent',
    description: '按公司或状态读取持久化问题；关闭弹窗不会调用本工具改变状态。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        companyId: id,
        status: { enum: ['all', 'open', 'answered', 'resolved'] },
      },
    },
    run: (service, input, context) => service.listIssues(input, context),
  },
  {
    name: 'query_profile_facts',
    access: 'agent',
    description: '精确查询已确认且非敏感的资料字段；不返回未确认或家庭/敏感字段。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        section: { enum: FACT_SECTIONS },
        entityId: { type: 'string', minLength: 1, maxLength: 200 },
        label: { type: 'string', minLength: 1, maxLength: 200 },
        companyId: id,
        positionId: id,
      },
    },
    run: (service, input, context) => service.queryProfileFacts({
      section: input.section,
      entityId: input.entityId,
      label: input.label,
      companyId: input.companyId || null,
      positionId: input.positionId || null,
    }, context),
  },
  {
    name: 'get_profile_fact_for_fill',
    access: 'agent',
    description: '按字段 ID 取当前用途所需的一个确切值；敏感字段需本人已授权的用途。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['factId'],
      properties: {
        factId: id,
        companyId: id,
        positionId: id,
        purpose: { type: 'string', minLength: 1, maxLength: 100 },
      },
    },
    run: (service, input, context) => service.getProfileFactForFill(input, context),
  },
  {
    name: 'record_position_candidates',
    access: 'agent',
    description: '记录有官方来源和查询时间的 1～3 个岗位候选；不代本人选择。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['companyId', 'eventId', 'positions'],
      properties: {
        companyId: id,
        eventId: id,
        positions: { type: 'array', items: positionCandidateSchema, minItems: 1, maxItems: 3 },
      },
    },
    run: (service, input, context) => service.recordPositionCandidates(input, context),
  },
  {
    name: 'record_no_positions',
    access: 'agent',
    description: '只有带官网来源、查询时间和检索结果证据时，记录“没有符合职位”。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['companyId', 'eventId', 'evidence'],
      properties: { companyId: id, eventId: id, evidence: noPositionsEvidenceInput },
    },
    run: (service, input, context) => service.recordNoPositions(input, context),
  },
  {
    name: 'add_issue',
    access: 'agent',
    description: '记录缺项、冲突或未知字段；同字段同类型会合并，不关闭弹窗即解决。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['companyId', 'fieldKey', 'type', 'message'],
      properties: {
        companyId: id,
        positionId: id,
        fieldKey: { type: 'string', minLength: 1, maxLength: 160 },
        type: { enum: ['missing', 'conflict', 'overlong', 'unknown', 'blocking', 'safety', 'review'] },
        severity: { enum: ['error', 'warn', 'info'] },
        blocking: { type: 'boolean' },
        message: { type: 'string', minLength: 1, maxLength: 1000 },
        evidence: { type: 'string', maxLength: 2000 },
        dependencies: { type: 'array', items: { type: 'string', maxLength: 160 }, maxItems: 20 },
      },
    },
    run: (service, input, context) => service.addIssue(input, context),
  },
  {
    name: 'add_company',
    access: 'operator',
    description: '本人把公司链接和可选内推候选加入任务池；导入不等于开始投递。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 200 },
        batch: { type: 'string', maxLength: 100 },
        links: {
          type: 'array',
          maxItems: 30,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['url'],
            properties: {
              url: uri,
              kind: { enum: ['apply', 'job', 'referral', 'other'] },
              source: { type: 'string', maxLength: 1000 },
            },
          },
        },
        referralCandidates: {
          type: 'array',
          maxItems: 30,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['value'],
            properties: {
              value: { type: 'string', minLength: 1, maxLength: 200 },
              source: { type: 'string', maxLength: 1000 },
            },
          },
        },
      },
    },
    run: (service, input, context) => service.addCompany(input, context),
  },
  {
    name: 'start_queue',
    access: 'operator',
    description: '本人启动顺序队列；程序只把第一家置为待登录。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['eventId', 'confirmedBy'],
      properties: { eventId: id, confirmedBy },
    },
    run: (service, input, context) => service.startQueue(input, context),
  },
  {
    name: 'pause_queue',
    access: 'operator',
    description: '本人暂停队列；完成事件不会在暂停时自动启动下一家。',
    inputSchema: noArgs,
    run: (service, input, context) => service.pauseQueue(context),
  },
  {
    name: 'resume_queue',
    access: 'operator',
    description: '本人恢复队列；只补一次后续调度，不重放危险动作。',
    inputSchema: noArgs,
    run: (service, input, context) => service.resumeQueue(context),
  },
  {
    name: 'hold_company',
    access: 'operator',
    description: '本人明确暂挂当前公司并继续下一家；暂挂不等于完成。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['companyId', 'reason'],
      properties: { companyId: id, reason },
    },
    run: (service, input, context) => service.holdCompany(input, context),
  },
  {
    name: 'resume_held_company',
    access: 'operator',
    description: '本人恢复暂挂公司；有另一家活动公司时拒绝同时恢复。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['companyId'],
      properties: { companyId: id },
    },
    run: (service, input, context) => service.resumeHeldCompany(input, context),
  },
  {
    name: 'select_positions',
    access: 'operator',
    description: '本人选择并排序岗位；模型不能代选或代排序。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['companyId', 'positionIds'],
      properties: {
        companyId: id,
        positionIds: { type: 'array', items: id, minItems: 1, maxItems: 30 },
      },
    },
    run: (service, input, context) => service.selectPositions(input, context),
  },
  {
    name: 'record_human_login',
    access: 'operator',
    description: '本人完成登录后记录；程序不读取凭据、不绕过验证码。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['companyId', 'eventId', 'confirmedBy'],
      properties: { companyId: id, eventId: id, confirmedBy },
    },
    run: (service, input, context) => service.recordHumanLogin(input, context),
  },
  {
    name: 'mark_position_ready',
    access: 'operator',
    description: '本人确认某岗位已完成填写和复核，允许进入待提交；仍不会自动提交。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['companyId', 'positionId', 'confirmedBy'],
      properties: { companyId: id, positionId: id, confirmedBy },
    },
    run: (service, input, context) => service.markPositionReadyForSubmit(input, context),
  },
  {
    name: 'record_human_submission',
    access: 'operator',
    description: '记录本人提交回执；不是官网核验，且与官网核验都禁止重投。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['companyId', 'positionId', 'eventId', 'reportedAt', 'confirmedBy'],
      properties: {
        companyId: id,
        positionId: id,
        eventId: id,
        reportedAt: iso,
        reference: { type: 'string', maxLength: 500 },
        confirmedBy,
      },
    },
    run: (service, input, context) => service.recordHumanSubmission(input, context),
  },
  {
    name: 'record_historical_submission',
    access: 'operator',
    description: '记录本人对尚未启动队列项的历史投递报告；没有岗位 ID 时保留公司级来源，不等同官网核验。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['companyId', 'eventId', 'reportedAt', 'reference', 'confirmedBy'],
      properties: {
        companyId: id,
        eventId: id,
        reportedAt: iso,
        reference: { type: 'string', minLength: 1, maxLength: 1000 },
        confirmedBy,
      },
    },
    run: (service, input, context) => service.recordHistoricalSubmission(input, context),
  },
  {
    name: 'record_official_verification',
    access: 'operator',
    description: '记录本人从官网只读核验到的提交证据；与本人提交回执分开保存。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['companyId', 'positionId', 'eventId', 'verifiedAt', 'sourceUrl', 'evidenceText', 'confirmedBy'],
      properties: {
        companyId: id,
        positionId: id,
        eventId: id,
        verifiedAt: iso,
        sourceUrl: uri,
        evidenceText: { type: 'string', minLength: 1, maxLength: 2000 },
        confirmedBy,
      },
    },
    run: (service, input, context) => service.recordOfficialVerification(input, context),
  },
  {
    name: 'skip_position',
    access: 'operator',
    description: '本人明确跳过某个已选岗位并记录原因；默认只限当前公司，历史范围需本人确认。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['companyId', 'positionId', 'reason'],
      properties: {
        companyId: id,
        positionId: id,
        reason,
        scope: { enum: ['current', 'history'] },
        confirmedBy,
      },
    },
    run: (service, input, context) => service.skipPosition(input, context),
  },
  {
    name: 'skip_company',
    access: 'operator',
    description: '本人明确跳过整家公司并记录原因；默认只限当前公司，已有提交记录时拒绝。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['companyId', 'reason'],
      properties: {
        companyId: id,
        reason,
        scope: { enum: ['current', 'history'] },
        confirmedBy,
      },
    },
    run: (service, input, context) => service.skipCompany(input, context),
  },
  {
    name: 'acknowledge_recovery',
    access: 'operator',
    description: '服务重启后由本人确认已重新观察现场；清除本次进程的恢复观察门槛。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['confirmedBy'],
      properties: {
        observedAt: iso,
        confirmedBy,
      },
    },
    run: (service, input, context) => service.acknowledgeRecovery(input, context),
  },
  {
    name: 'answer_issue',
    access: 'operator',
    description: '本人回答问题；状态变为已回答，不等于问题已解决。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['issueId', 'answer'],
      properties: { issueId: id, answer: { type: 'string', minLength: 1, maxLength: 4000 } },
    },
    run: (service, input, context) => service.answerIssue(input, context),
  },
  {
    name: 'resolve_issue',
    access: 'operator',
    description: '本人确认问题已解决；关闭界面弹窗不会调用本工具。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['issueId'],
      properties: { issueId: id },
    },
    run: (service, input, context) => service.resolveIssue(input, context),
  },
  {
    name: 'list_profile_facts_for_local_edit',
    access: 'operator',
    description: '仅本人资料管理读取全部字段（含家庭/敏感字段）；不得用于填写或外发。',
    inputSchema: noArgs,
    run: (service, input, context) => service.listProfileFactsForLocalEdit(context),
  },
  {
    name: 'create_profile_fact',
    access: 'operator',
    description: '新增一条未确认资料，必须保留来源、作用域和敏感用途。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['label', 'value', 'source'],
      properties: {
        section: { enum: FACT_SECTIONS },
        entityId: { type: 'string', minLength: 1, maxLength: 200 },
        label: { type: 'string', minLength: 1, maxLength: 200 },
        value: { type: 'string', minLength: 1, maxLength: 20000 },
        source: factSourceSchema,
        scope: scopeSchema,
        sensitivity: { enum: SENSITIVITY_LEVELS },
        allowedPurposes: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 100 }, maxItems: 30 },
      },
    },
    run: (service, input, context) => service.createProfileFact(input, context),
  },
  {
    name: 'revise_profile_fact',
    access: 'operator',
    description: '按旧版本修改资料；修改后旧确认自动失效并保留历史。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['factId', 'expectedVersion', 'patch'],
      properties: {
        factId: id,
        expectedVersion: { type: 'integer', minimum: 1 },
        patch: factPatchSchema,
      },
    },
    run: (service, input, context) => service.reviseProfileFact(input, context),
  },
  {
    name: 'confirm_profile_fact',
    access: 'operator',
    description: '本人确认当前版本字段；修改内容后该确认失效。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['factId', 'expectedVersion', 'confirmedBy'],
      properties: {
        factId: id,
        expectedVersion: { type: 'integer', minimum: 1 },
        confirmedBy,
      },
    },
    run: (service, input, context) => service.confirmProfileFact(input, context),
  },
  {
    name: 'grant_sensitive_fact_use',
    access: 'operator',
    description: '本人授权家庭/敏感字段用于明确公司或岗位的当前用途。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['factIds', 'purpose', 'scope', 'confirmedBy'],
      properties: {
        factIds: { type: 'array', items: id, minItems: 1, maxItems: 30 },
        purpose: { type: 'string', minLength: 1, maxLength: 100 },
        scope: scopeSchema,
        confirmedBy,
      },
    },
    run: (service, input, context) => service.grantSensitiveFactUse(input, context),
  },
]);

function metadata(tool) {
  return {
    name: tool.name,
    access: tool.access,
    description: tool.description,
    inputSchema: tool.inputSchema,
  };
}

export function toolByName(name, access = 'agent') {
  const tool = TOOL_DEFINITIONS.find(item => item.name === name);
  if (!tool) throw new ToolError('TOOL_NOT_FOUND', `未知工具：${name}`);
  if (tool.access === 'operator' && access !== 'operator') {
    throw new ToolError('TOOL_FORBIDDEN', `工具 ${name} 仅供本人操作入口，模型不能调用。`);
  }
  return tool;
}

export function createToolRegistry(service, { access = 'agent' } = {}) {
  if (!['agent', 'operator'].includes(access)) throw new ToolError('INVALID_ACCESS', '工具入口只能是 agent 或 operator。');
  const visible = TOOL_DEFINITIONS.filter(tool => tool.access === 'agent' || access === 'operator');
  return {
    access,
    list: () => visible.map(metadata),
    async invoke(name, input = {}) {
      const tool = toolByName(name, access);
      validateSchema(input, tool.inputSchema);
      return tool.run(service, input, { actor: access });
    },
  };
}
