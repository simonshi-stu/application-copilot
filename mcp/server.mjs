#!/usr/bin/env node
// Application Copilot MCP server（stdio）。无第三方依赖，直接运行：
//   node mcp/server.mjs
// 仅做本地计算：通过参数接收数据，不读取浏览器存储、不访问网络、不提交申请。

import { tools, toolByName } from './tools.mjs';

const SERVER_INFO = { name: 'application-copilot', version: '0.1.0' };
const PROTOCOL_VERSION = '2024-11-05';

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function error(id, code, message) {
  send({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
}

async function handle(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return error(null, -32700, 'Parse error');
  }
  const { id, method, params } = message ?? {};
  if (method === 'notifications/initialized') return undefined;
  try {
    if (method === 'initialize') {
      return send({
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      });
    }
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') {
      return send({
        jsonrpc: '2.0', id,
        result: {
          tools: tools.map(tool => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        },
      });
    }
    if (method === 'tools/call') {
      const tool = toolByName(params?.name);
      if (!tool) return error(id, -32602, `Unknown tool: ${params?.name}`);
      const result = await tool.run(params?.arguments ?? {});
      return send({
        jsonrpc: '2.0', id,
        result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] },
      });
    }
    return error(id, -32601, `Method not found: ${method}`);
  } catch (cause) {
    return error(id, -32603, cause?.message || 'Internal error');
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) void handle(line);
  }
});
process.stdin.on('end', () => process.exit(0));
