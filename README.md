# OpenChamber Application HUD

Windows 独立 HUD 与 OpenChamber 扩展桥接器，用于控制 Application Copilot 的本地申请队列。**独立 Windows HUD 是主界面；OpenChamber 负责会话交互和消息转发。**

[中文](README.md) · [English](README.en.md)

## 项目定位

- **Windows HUD**：使用 `mshta.exe` 和仅监听 `127.0.0.1` 的本地服务，显示队列进度、当前公司，并支持开始、暂停、恢复和优先级调整。OpenChamber 可以保持最小化。
- **OpenChamber 扩展**：提供任务池面板和可关闭的 HUD 对话窗口。独立 HUD 的消息进入项目私有队列后，由扩展 HUD 转发到明确指定的既有会话。
- **会话交互**：扩展使用 OpenChamber SDK 的 `host.openSession()` 和 `host.prompt({ send: true })`，只打开和发送到已有会话，不创建新会话。
- **底层工作流**：本地状态机、公司顺序队列、岗位记录、问题队列和已确认原文复用由 Application Copilot 提供。

本项目的原生宿主是 **OpenChamber**，不是原生 OpenCode 插件，也不是通用 Harness 插件。OpenCode 等客户端只能通过明确配置的本地 MCP 或适配器复用有限的资料整理工具。

## 不做什么

- 不代登录、不代填验证码、不代点击最终提交。
- 不承诺任意招聘网站的完整自动投递；真实网站和真实模型供应商仍需单独验证。
- 独立 HUD 不能直接访问 OpenChamber 的 `host` 桥接。要把消息送入会话，必须保持 OpenChamber 的插件 HUD 打开；HUD 关闭时消息只会排队，不会丢失。

## 入口

| 入口 | 用途 |
|---|---|
| Windows 独立 HUD | 主界面：独立查看和控制本地队列 |
| OpenChamber 扩展 | 任务池、会话 HUD、目标会话切换和消息桥接 |
| 原有网页工作台 | 简历资料整理、段落确认和手动复制；不是完整 HUD |
| 本地 MCP | 向 OpenCode 或其他 MCP 客户端提供无状态资料整理函数 |

## 快速开始

### 1. Windows 独立 HUD

要求 Node.js 22+。在仓库根目录运行：

```powershell
npm ci
npm run standalone:hud
```

也可以双击 `start-standalone-hud.cmd`。指定项目和目标 OpenChamber 会话：

```powershell
npm run standalone:hud -- --project E:\path\to\project --session ses_...
```

`--session` 只绑定消息目标，不创建会话。窗口关闭后本地辅助服务停止。

### 2. 安装 OpenChamber 扩展

插件面向 OpenChamber **2.3.2 或更新版本**：

1. 运行 `npm run package:openchamber`，或下载 [Latest Release](https://github.com/simonshi-stu/openchamber-application-hud/releases/latest) 中的 ZIP。
2. 在 OpenChamber 的“设置 → Extensions”添加 ZIP 或仓库根目录。
3. 审核并批准 `prompt`、`sessions` 和本地服务权限。
4. 打开“投递任务池”。需要会话 HUD 时，在当前会话的“会话操作”菜单中选择“投递 HUD”。

`sessions` 权限只用于独立 HUD 指定目标会话时打开该既有会话；不会创建新会话。关闭 HUD 不会关闭会话。

### 3. 从源码构建

```powershell
npm ci
npm test
npm run package:openchamber
npm run check:publication
```

ZIP 只作为 GitHub Release 附件发布，不把 `private/`、`artifacts/` 或运行数据提交到仓库。

## 当前状态

| 能力 | 状态 |
|---|---|
| 独立 Windows HUD | 已实现：队列进度、当前公司、开始／暂停／恢复、优先级和消息队列 |
| OpenChamber 交互 | 已实现：SDK 2.3.2 面板、服务、会话 HUD、目标会话切换和消息转发 |
| 本地状态与队列 | 已实现：固定状态机、暂停恢复、顺序推进和持久化记录 |
| 真实招聘网站 | 未完成完整闭环；登录、验证码和最终提交始终由本人操作 |

最近的虚构联调已验证：独立 HUD 消息可投递到指定 OpenChamber 会话、目标会话收到回复、桥接 inbox 在成功发送后确认消费。虚构测试不代表真实求职网站流程通过。

## 数据与隐私边界

- 会话 ID、API Key、姓名、简历、家庭信息、项目正文、附件、投递记录、截图、日志和浏览器缓存不上传 GitHub。
- 正式资料和运行记录放在当前项目的 `private/` 明确子目录；这些内容被 Git 忽略并不等于可以发布。
- 测试只使用虚构资料和 `example.invalid` 地址；发布前还会检查暂存文件名、暂存内容、包白名单和敏感模式。
- 云模型外发与 GitHub 发布是两项独立授权；不上传 GitHub 不等于不会向已授权的模型提供商发送必要资料。

## 其他文档

- [OpenChamber 使用方式](docs/OPENCHAMBER.md)
- [架构与集成边界](docs/ARCHITECTURE.md)
- [部署与在线演示](docs/DEPLOY.md)
- [使用声明](docs/USAGE.md)
- [可选 MCP](docs/MCP.md)

原有静态网页工作台：[在线预览](https://simonshi-stu.github.io/openchamber-application-hud/)。它不包含 OpenChamber 面板、本地服务或招聘网站自动化能力。

## License

MIT
