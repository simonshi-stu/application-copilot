# Application Copilot

OpenChamber 里的求职工作插件：把公司链接放进队列，整理资料、选择岗位、集中处理问题，不再靠聊天记住投递进度。

[中文](README.md) · [English](README.en.md)

**当前为插件开发版。** 原有[网页资料工作台](https://simonshi-stu.github.io/application-copilot/)仍可使用，但它不是完整投递插件，也不会自动操作招聘网站。

**插件定位：** 本项目的原生扩展宿主是 **OpenChamber**，基于 OpenChamber SDK 2.3.2 构建；它不是原生 OpenCode 插件，也不是通用 Harness 插件。项目同时提供可选的本地 MCP 服务，供 OpenCode 和其他支持 MCP 的客户端调用资料整理工具。

## 0. 引用与致谢

- 插件使用 [OpenChamber SDK](https://docs.openchamber.dev/sdk/)；感谢 OpenChamber 与 OpenCode 社区提供的扩展和模型工具。
- 原有工作台的布局思路参考了 [Tabler](https://github.com/tabler/tabler)、[shadcn-admin](https://github.com/satnaing/shadcn-admin) 和 [Job Tracker](https://github.com/Muatasim-Aswad/job-tracker)，没有复制它们的品牌或素材。
- 本项目使用 [MIT 许可证](LICENSE)，所用 SDK 与构建工具的版权和许可证见 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES)。

## 1. 这是做什么的？

投几家公司之后，很容易记不清：哪家填到哪一步、投了什么岗位、还有哪些问题没处理。网站重新解析简历，还可能把项目内容和本人职责混在一起。

Application Copilot 想把这些事收进一个工作台：公司排队、资料分开保存、岗位由你选择，普通问题先汇总，不每填一个字段就打断你。已确认的文字按原文使用，不让模型临时润色。

**流程由程序控制，进度写入本地记录，不靠长对话维持。** 工具辅助准备和填写，但不代登录、验证码或最终提交。

## 2. 使用场景和流程

适合应届生、实习生，以及需要重复填写网申的人。

目标流程是：

1. 准备并确认自己的资料，把公司链接和可选内推码放进任务池。
2. 你登录官网，助手查找合适岗位；你选择岗位并排好顺序。
3. 在已支持的范围内填写、读回和复核，普通疑问集中弹窗。
4. 你补充缺项、审核并在官网提交，再记录结果。
5. 本公司所选岗位处理完后，自动进入下一家公司；确实没有合适岗位就记录原因并跳过。

“已投递：某岗位”“本人记录、待官网核验”“未投递：没有符合职位”分开保存。**填完了不等于提交了，检索失败也不等于没有岗位。** 目前支持到哪一步见下表。

## 3. 现在做到哪一步了？

| 能力 | 当前情况 |
|---|---|
| 原有网页资料整理 | DOCX／文字解析、段落确认、原文复制、公司清单和本地检查可用 |
| 固定流程与私有资料 | 已有程序状态机、确认版本、按需查询、公司／岗位台账与问题队列 |
| 公司顺序队列 | 已有完成条件、暂停恢复、防重复推进；本人提交记录与官网核验分开 |
| OpenChamber 交互 | 已用 SDK 2.3.2 构建面板和服务；实际 OpenChamber 2.3.2 已验证安装、权限批准、虚构公司入队和关闭重开持久化 |
| 模型分工 | 检索、执行、review 可分别配置；保存选择不代表已经运行这些模型 |
| 招聘网站填写 | 优先适配 Moka，尚未验证真实网站完整投递闭环；不承诺任意网站通用 |

当前不是无人值守海投工具。没有真实页面读回和有效复核结果，就不能说“自动检查通过”。

## 4. 在线 Demo 与预览

### 在线查看：网页资料工作台

打开[在线资料工作台](https://simonshi-stu.github.io/application-copilot/)即可查看资料整理、段落确认和手动复制流程。它是静态网页 Demo，不包含 OpenChamber 面板、本地服务或招聘网站自动化能力。

### 完整插件预览：本地 OpenChamber

完整的“投递任务池”面板必须安装到 OpenChamber 2.3.2+，因为它依赖宿主的扩展面板和本地服务桥接。安装方法见下一节；仓库不能把依赖本机权限的 OpenChamber 面板直接部署成 GitHub Pages 网页。

## 5. 怎么用？

### 推荐：安装到 OpenChamber

插件面向 OpenChamber **2.3.2 或更新版本**，采用对应 SDK 的已核实接口。在“设置 → Extensions”中添加插件 ZIP 或本项目根目录，阅读并批准所需本地服务权限，再打开“投递任务池”。不要选择旧的 `extension/` 子目录。

从源码准备插件需要 Node.js 22+：

```text
npm ci
npm run build:openchamber
npm run package:openchamber
```

打包产物为 `artifacts/application-copilot-openchamber-v0.5.0.zip`。解包后的服务已通过认证健康检查，实际 OpenChamber 2.3.2 也已完成安装、授权和虚构入队持久化验证；这不等于真实招聘网站流程已经通过。构建或安全检查失败时不要安装残缺包；仓库 URL 安装也要求该版本已包含完整预构建文件。公开发布时应把 ZIP 作为 GitHub Release 附件，不要把 `private/` 或 `artifacts/` 目录提交进仓库。日常使用由 OpenChamber 启动插件服务，**不需要你手工打开 localhost**。

最新插件 ZIP：<https://github.com/simonshi-stu/application-copilot/releases/latest>

### 也可以用原有网页／Chrome 扩展

直接打开[网页工作台](https://simonshi-stu.github.io/application-copilot/)，或在 Chrome／Edge 的扩展管理页加载 `extension/` 文件夹。它们适合资料整理和手动复制，不会因此获得新版插件的网站执行能力。

### 资料与模型提醒

- 插件的资料与运行记录放在当前项目私有目录；旧网页数据仍在浏览器中，不会自动迁移。换设备前先备份。
- 姓名、简历、父母／家庭、项目内容、附件、日志和密钥不进入 GitHub 或插件分发包。家庭字段只在实际需要且你授权时使用。
- 云模型会收到经授权的必要资料。“不上传 GitHub”不等于“不发给模型”；不要把 Key 粘贴到聊天中。
- 宿主本地服务有当前用户的系统权限；远程 OpenChamber 的数据可能在远程机器，不等于你的本机。

更多说明：[OpenChamber 使用方式](docs/OPENCHAMBER.md) · [使用声明](docs/USAGE.md) · [部署](docs/DEPLOY.md) · [可选 MCP](docs/MCP.md)。

## License

MIT
