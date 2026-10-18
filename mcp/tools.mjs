// MCP 工具实现：只做本地计算，不读取浏览器存储、不访问网络。
// 客户端通过参数传入 entry/facts/blocks；输出为 JSON 可序列化结果。

import { parseCompanies } from '../extension/company-parser.js';
import { buildFieldCard } from '../extension/field-cards.js';
import { buildFillPlan } from '../extension/fill-plan.js';
import { buildReviewSheet } from '../extension/review-sheet.js';
import { buildQaReport } from '../extension/qa-report.js';

const clone = value => JSON.parse(JSON.stringify(value ?? null));

export const tools = [
  {
    name: 'parse_companies_text',
    description: '把粘贴的公司/内推文本解析为结构化草稿（公司、链接、内推候选、渠道、批次）。不写入任何存储。',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: '原始粘贴文本' } },
      required: ['text'],
    },
    run: ({ text = '' }) => clone(parseCompanies(String(text))),
  },
  {
    name: 'build_field_card',
    description: '根据行业与已知资料生成信息卡（已确认可复用／已识别待确认／待补充／需核实）。',
    inputSchema: {
      type: 'object',
      properties: {
        industry: { type: 'string', description: 'bank | auto | manufacturing | internet | fmcg | other' },
        facts: { type: 'array', items: { type: 'object' }, description: '资料库字段列表' },
        blocks: { type: 'array', items: { type: 'object' }, description: '段落库条目（approved 表示已确认）' },
      },
      required: ['industry'],
    },
    run: ({ industry = 'other', facts = [], blocks = [] }) => clone(buildFieldCard(industry, { facts, blocks })),
  },
  {
    name: 'build_fill_plan',
    description: '生成逐项复制用的填写计划（只含已确认字段/段落与本人回答，待确认项会标注）。',
    inputSchema: {
      type: 'object',
      properties: {
        entry: { type: 'object', description: '公司条目（含 answers、referral、links、applicationRef 等）' },
        facts: { type: 'array', items: { type: 'object' } },
        blocks: { type: 'array', items: { type: 'object' } },
      },
      required: ['entry'],
    },
    run: ({ entry = {}, facts = [], blocks = [] }) => clone(buildFillPlan(entry, { facts, blocks })),
  },
  {
    name: 'build_review_sheet',
    description: '生成送审单 Markdown（公司信息、内推选择、逐项回答、已确认复用、需核实项、提交前检查）。',
    inputSchema: {
      type: 'object',
      properties: {
        entry: { type: 'object' },
        facts: { type: 'array', items: { type: 'object' } },
        blocks: { type: 'array', items: { type: 'object' } },
      },
      required: ['entry'],
    },
    run: ({ entry = {}, facts = [], blocks = [] }) => buildReviewSheet(entry, { facts, blocks }),
  },
  {
    name: 'qa_report',
    description: '按规则检查公司条目：缺项、冲突、未确认、未生成送审单等，只报告问题，不修改内容。',
    inputSchema: {
      type: 'object',
      properties: {
        entry: { type: 'object' },
        facts: { type: 'array', items: { type: 'object' } },
        unanswered: { type: 'integer', minimum: 0 },
      },
      required: ['entry'],
    },
    run: ({ entry = {}, facts = [], unanswered = 0 }) => clone(buildQaReport(entry, { facts, unanswered })),
  },
];

export const toolByName = name => tools.find(tool => tool.name === name);
