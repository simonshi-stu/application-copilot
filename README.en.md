# OpenChamber Application HUD

A standalone Windows HUD and OpenChamber extension bridge for the local Application Copilot queue. **The standalone Windows HUD is the primary UI; OpenChamber provides session interaction and message delivery.**

[中文](README.md) · [English](README.en.md)

## Project identity

- **Windows HUD:** uses `mshta.exe` and a service bound only to `127.0.0.1` to show queue progress, the active company, start/pause/resume controls, and priority changes. OpenChamber can stay minimized.
- **OpenChamber extension:** provides the task-pool panel and a closable HUD dialog. Messages from the standalone HUD enter a private project inbox and are forwarded by the extension HUD to an explicitly targeted existing session.
- **Session interaction:** the extension uses the OpenChamber SDK's `host.openSession()` and `host.prompt({ send: true })`. It opens and sends to existing sessions only; it never creates a session.
- **Workflow core:** Application Copilot supplies the local state machine, sequential company queue, role records, issue queue, and verbatim reuse of confirmed text.

The native host for this project is **OpenChamber**, not a native OpenCode plugin or a generic Harness plugin. OpenCode and other clients can reuse only the limited preparation tools exposed through an explicitly configured local MCP server or adapter.

## Non-goals

- No delegated login, CAPTCHA handling, or final submission.
- No promise of a complete unattended flow for arbitrary job sites; real sites and model providers require separate verification.
- The standalone HUD cannot call OpenChamber's `host` bridge directly. To deliver a message into a session, keep the OpenChamber plugin HUD open; if it is closed, messages wait in the private inbox without being lost.

## Entry points

| Entry point | Purpose |
|---|---|
| Standalone Windows HUD | Primary UI for independent queue monitoring and control |
| OpenChamber extension | Task pool, session HUD, target-session switching, and message relay |
| Original web workspace | Resume preparation, paragraph confirmation, and manual copying; not the full HUD |
| Local MCP | Stateless preparation functions for OpenCode or other MCP clients |

## Quick start

### 1. Standalone Windows HUD

Requires Node.js 22+. From the repository root:

```powershell
npm ci
npm run standalone:hud
```

You can also double-click `start-standalone-hud.cmd`. Bind a project and an OpenChamber target session explicitly:

```powershell
npm run standalone:hud -- --project E:\path\to\project --session ses_...
```

`--session` binds the message target; it does not create a session. Closing the window stops the local helper service.

### 2. Install the OpenChamber extension

The extension targets OpenChamber **2.3.2 or newer**:

1. Run `npm run package:openchamber`, or download the ZIP from the [Latest Release](https://github.com/simonshi-stu/openchamber-application-hud/releases/latest).
2. In OpenChamber, open **Settings → Extensions** and add the ZIP or the repository root.
3. Review and approve the `prompt`, `sessions`, and local-service permissions.
4. Open **投递任务池 / Application queue**. To use the session HUD, choose **投递 HUD** from **Session actions** in the current session header.

The `sessions` grant is used only to open an existing explicitly targeted session for standalone-HUD delivery; it never creates a session. Closing the HUD does not close the session.

### 3. Build from source

```powershell
npm ci
npm test
npm run package:openchamber
npm run check:publication
```

The ZIP is published as a GitHub Release asset; `private/`, `artifacts/`, and runtime data are not committed to the repository.

## Current status

| Capability | Status |
|---|---|
| Standalone Windows HUD | Implemented: queue progress, active company, start/pause/resume, priorities, and message inbox |
| OpenChamber interaction | Implemented: SDK 2.3.2 panel, service, session HUD, target-session switching, and message relay |
| Local workflow and queue | Implemented: fixed state machine, pause/resume, sequential progression, and persistent records |
| Real job-site flow | No complete real-site loop has been verified; login, CAPTCHA, and final submission remain manual |

Recent fictional integration testing verified that a standalone-HUD message reaches the explicitly targeted OpenChamber session, receives a reply, and is acknowledged in the inbox after delivery. Fictional testing does not prove a real job-application flow.

## Data and privacy boundary

- Session IDs, API keys, names, resumes, family information, project text, attachments, application records, screenshots, logs, and browser caches are not uploaded to GitHub.
- Official records and runtime state belong in explicit `private/` subdirectories of the current project; they are ignored by Git and must still be audited before publication.
- Tests use fictional data and `example.invalid` addresses; publication also checks staged filenames, staged content, package allowlists, and sensitive patterns.
- Cloud-model disclosure and GitHub publication are separate permissions. Keeping data out of GitHub does not mean that authorized necessary data is never sent to a model provider.

## Documentation

- [OpenChamber usage](docs/OPENCHAMBER.md)
- [Architecture and integration boundaries](docs/ARCHITECTURE.md)
- [Deployment and web preview](docs/DEPLOY.md)
- [Usage statement](docs/USAGE.md)
- [Optional MCP](docs/MCP.md)

Original static web workspace: [online preview](https://simonshi-stu.github.io/openchamber-application-hud/). It does not include the OpenChamber panel, local service, or job-site automation.

## License

MIT
