# Application Copilot

A job-application workspace for OpenChamber: queue company links, organize your information, choose roles, and handle questions in one place without relying on a long chat history.

[中文](README.md) · [English](README.en.md)

**The extension is a development build.** The existing [web preparation workspace](https://simonshi-stu.github.io/application-copilot/) remains available, but it is not the full extension and does not operate job sites automatically.

**Extension identity:** the native host for this project is **OpenChamber**, built with OpenChamber SDK 2.3.2. It is not a native OpenCode plugin or a generic Harness plugin. The repository also provides an optional local MCP server for preparation tools in OpenCode and other MCP-compatible clients.

## 0. Credits

- The extension uses the [OpenChamber SDK](https://docs.openchamber.dev/sdk/). Thanks to the OpenChamber and OpenCode communities for their extension and model tooling.
- The original workspace took layout ideas from [Tabler](https://github.com/tabler/tabler), [shadcn-admin](https://github.com/satnaing/shadcn-admin), and [Job Tracker](https://github.com/Muatasim-Aswad/job-tracker), without copying their branding or assets.
- This project is [MIT licensed](LICENSE). SDK and build-tool copyrights and licenses are included in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).

## 1. What is it for?

After a few applications, it is easy to forget which roles you applied for, where you stopped, and what still needs an answer. Resume parsers can also mix a project's description with your own responsibilities.

Application Copilot brings those tasks together: companies in a queue, structured personal records, roles chosen by you, and ordinary questions collected rather than interrupting every field. Confirmed text is used verbatim, not rewritten during filling.

**Code controls the workflow, and progress lives in local records—not chat history.** The tool helps with preparation and supported filling, but login, CAPTCHA, and final submission remain yours.

## 2. When and how to use it

For students and interns applying to many roles, or anyone filling the same long forms repeatedly.

The intended flow:

1. Prepare and confirm your records, then queue company links and optional referral codes.
2. Log in yourself. The assistant finds suitable roles; you choose them and set priorities.
3. Use supported filling, readback, and review. Ordinary questions appear together.
4. Answer missing items, review, submit on the official site yourself, and record the result.
5. Move to the next company once all selected roles are handled, or record a supported reason for skipping it.

Submitted roles, self-reported submissions awaiting official verification, and companies with no suitable roles are separate records. **Filled is not submitted; a failed search is not proof that no roles exist.** Current support is listed below.

## 3. Current status

| Capability | Current status |
|---|---|
| Original web workspace | DOCX/text parsing, paragraph confirmation, verbatim copy, company lists, and local checks are available |
| Fixed workflow and private records | Code-based state machine, confirmation versions, scoped queries, company/role ledger, and issue queue |
| Sequential company queue | Completion guards, pause/resume, and duplicate-advance protection; user receipts and official verification stay separate |
| OpenChamber interface | Panel and service built with SDK 2.3.2; OpenChamber 2.3.2 installation, permission approval, fictional enqueue, and close/reopen persistence have been verified |
| Role models | Separate search, execution, and review settings; saving a selection does not mean a model has run |
| Job-site filling | Moka is the first target; no complete real-site application flow has been verified, and arbitrary-site support is not promised |

This is not an unattended mass-application service. Without real page readback and a valid review result, it must not report that a website check passed.

## 4. Demo and preview

### Online preview: web preparation workspace

Open the [online preparation workspace](https://simonshi-stu.github.io/application-copilot/) to see record organization, paragraph confirmation, and manual-copy flows. This is a static web demo; it does not include the OpenChamber panel, local service, or job-site automation.

### Full extension preview: local OpenChamber

The full “投递任务池” panel must be installed in OpenChamber 2.3.2+ because it depends on the host extension panel and local-service bridge. See the next section for installation. The OpenChamber panel cannot be represented as a GitHub Pages page because it requires local host permissions.

## 5. How to use it

### Recommended: install in OpenChamber

The extension targets OpenChamber **2.3.2 or newer**, using verified interfaces from the matching SDK. In **Settings → Extensions**, add the extension ZIP or this repository's root folder, review its local-service permissions, and open **投递任务池 / Application queue**. Do not select the old `extension/` subfolder.

Preparing it from source requires Node.js 22+:

```text
npm ci
npm run build:openchamber
npm run package:openchamber
```

The package is `artifacts/application-copilot-openchamber-v0.5.0.zip`. Its unpacked service passed authenticated health checks, and OpenChamber 2.3.2 installation, authorization, and fictional enqueue persistence have also been verified; this does not verify a real job-site flow. Do not install an incomplete package after a failed build or safety check. Git-URL installation also requires a version with complete prebuilt files. For public distribution, attach the ZIP to a GitHub Release rather than committing `private/` or `artifacts/`. OpenChamber starts the service when needed; **you do not need to launch a localhost preview yourself**.

Latest extension ZIP: <https://github.com/simonshi-stu/application-copilot/releases/latest>

### Use the original web or Chrome extension

Open the [web workspace](https://simonshi-stu.github.io/application-copilot/), or load the `extension/` folder from Chrome/Edge's extension manager. These are for preparation and manual copying; they do not gain the new extension's site-execution abilities merely by being opened.

### Data and models

- Extension records belong in the current project's private directory. Existing web data stays in browser storage and is not migrated automatically. Back it up before changing devices.
- Personal and family information, resume/project text, attachments, logs, and keys must not enter GitHub or distributed packages. Family fields are used only when actually required and authorized.
- Cloud models receive authorized, necessary information. Keeping data out of GitHub is not the same as keeping it out of a model provider. Do not paste keys into chat.
- The host-managed service runs with your system-user privileges. A remote OpenChamber instance may store data on the remote machine, not your computer.

More: [OpenChamber usage](docs/OPENCHAMBER.md) · [Usage statement](docs/USAGE.md) · [Deployment](docs/DEPLOY.md) · [Optional MCP](docs/MCP.md). Supporting documents are currently in Chinese.

## License

MIT
