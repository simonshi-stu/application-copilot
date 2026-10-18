# MCP 服务与浏览器自动化

`mcp/server.mjs` 是本项目的本地 MCP（Model Context Protocol）服务，通过 stdio 通信，不联网、无状态。它把项目里的纯函数工具暴露给支持 MCP 的客户端。

## 启动

```text
node mcp/server.mjs
```

或 `npm run mcp`。无第三方依赖，Node.js 22+。

## 工具列表

| 工具 | 作用 |
|---|---|
| `parse_companies_text` | 解析粘贴的公司/内推文本为草稿（公司、链接、内推候选、渠道、批次） |
| `build_field_card` | 生成信息卡（已确认可复用／待识别／待补充／需核实） |
| `build_fill_plan` | 生成逐项复制用填写计划（仅已确认字段/段落） |
| `build_review_sheet` | 生成送审单 Markdown |
| `qa_report` | 规则自检：缺项、冲突、未确认、未生成送审单等 |

所有工具都通过参数接收 `entry`、`facts`、`blocks` 等数据，不读取浏览器存储，也不访问招聘网站。

## 客户端配置示例（OpenCode）

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "application-copilot": {
        "type": "local",
        "command": ["node", "E:/Projects/简历投递流程化/mcp/server.mjs"]
      }
    }
  }
}
```

Claude Desktop 等客户端使用同样的 `command` 配置，格式以对应客户端文档为准。

## 与填写计划配合

1. 在网页里把资料/公司导出为 JSON（或直接提供数据）。
2. 让支持 MCP 的客户端调用 `build_fill_plan` / `build_review_sheet` / `qa_report`。
3. 由本人在官网逐项填写并最终提交。

## 浏览器自动化（可选，需自行配置）

以下服务**不由本项目捆绑**，仅作为可选接入说明。使用前请阅读 [使用声明](USAGE.md)。

- **Playwright MCP**（Microsoft）：官方包 `@playwright/mcp`，示例：

```jsonc
{
  "mcp": {
    "servers": {
      "playwright": {
        "type": "local",
        "command": ["npx", "-y", "@playwright/mcp@latest"]
      }
    }
  }
}
```

- **Chrome DevTools MCP**（Google）：官方包 `chrome-devtools-mcp`，示例：

```jsonc
{
  "mcp": {
    "servers": {
      "chrome-devtools": {
        "type": "local",
        "command": ["npx", "-y", "chrome-devtools-mcp@latest"]
      }
    }
  }
}
```

使用原则：

- 首次使用需在客户端中完成授权/登录；登录、验证码和最终提交仍由本人操作。
- 自动化仅用于读取页面结构、辅助定位字段、填入已确认文本；不得代提交或绕过风控。
- 网站条款、频率限制与账号风险由使用者自行承担。
- 页面结构变化时需要更新字段定位，不能承诺任意网站长期可用。

## 批量填写策略

遇到无法判断或与以往不同的字段时，先记录问题、继续完成其余部分，最后集中暂停由本人决定；不要为单个字段反复中断整个流程。模型只报告问题与建议，不自动修改确认内容。
