# 部署与在线演示

本项目的界面是**纯静态文件**（`extension/`），没有后端、没有构建步骤，也不需要环境变量。部署后所有数据仍保存在访问者自己的浏览器里（`localStorage`；作为扩展运行时使用 `chrome.storage.local`），不会上传服务器。

## 方式一：GitHub Pages（需要公开仓库或付费计划）

实测：本仓库当前为私有，账户计划不支持私有仓库 Pages（GitHub API 返回 422 “Your current plan does not support GitHub Pages for this repository”）。公开仓库免费可用 Pages。

步骤：

1. 若接受仓库公开：Settings → General → 底部 “Change visibility” → Public。
2. 新建 `.github/workflows/pages.yml`，把 `extension/` 作为静态站点发布：

```yaml
name: pages
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: extension
      - id: deployment
        uses: actions/deploy-pages@v4
```

3. Settings → Pages → Build and deployment → Source 选择 **GitHub Actions**，然后推送触发部署。
4. 访问 `https://<用户名>.github.io/application-copilot/`（`index.html` 会跳转到 `editor.html`）。

## 方式二：Vercel / Netlify / Cloudflare Pages（可保持仓库私有）

这些平台可以连接**私有** GitHub 仓库并发布静态站点。需要由你本人登录授权（账号与授权由你操作）。

- 构建命令：留空（无构建）
- 输出目录 / Publish directory：`extension`
- Framework preset：None / Other

部署后的站点仍是纯静态页面，访问者数据只存在其浏览器。

## 方式三：本地运行

```text
npm run serve
```

打开 `http://127.0.0.1:4173/extension/editor.html`。也可以把 `extension/` 作为未打包扩展加载到 Chrome / Edge。

## 作为浏览器扩展分发

1. 打包 `extension/` 为 zip（包含 `manifest.json`）。
2. Chrome Web Store / Edge Add-ons 开发者后台提交，需要图标、截图、隐私说明与权限理由。
3. 当前权限只有 `storage` 与 `clipboardWrite`，不访问任何招聘网站；若后续增加站点适配器，应作为独立可选权限并单独说明。

## 发布前检查

- `npm test` 全部通过。
- 仓库内没有真实简历、个人信息、内推链接/码、截图或日志（`private/`、`artifacts/` 已被忽略）。
- 选择并添加 LICENSE（如 MIT），确保分发条款明确。
- 更新 README 的在线演示链接与版本号。
