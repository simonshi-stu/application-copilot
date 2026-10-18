# Application Copilot

A local-first helper for job applications: turn your resume and company list into copy-ready checklists, so you repeat less and fill fewer fields wrong.

[中文](README.md) · [English](README.en.md)

**Live demo:** <https://simonshi-stu.github.io/application-copilot/> (data stays in your browser)

## 0. Credits

- Layout and interaction ideas were inspired by [Tabler](https://github.com/tabler/tabler) (MIT), [shadcn-admin](https://github.com/satnaing/shadcn-admin) (MIT) and [Job Tracker](https://github.com/Muatasim-Aswad/job-tracker) (MIT). No code or assets were copied.
- Thanks to these open-source projects and their communities. This project is under the [MIT License](LICENSE).

## 1. What is it for?

Applying to many companies means typing the same information over and over:

- Sites often parse resumes badly, losing numbers or turning your work into a project description;
- Every site orders fields differently, and it is easy to lose track of what you already filled;
- After a few days you forget which companies you applied to, what stage you are at, and whether a referral code was actually bound.

This tool does not apply for you. It does three things:

1. Splits your resume into facts and paragraphs, which only count after you confirm them;
2. Turns a company list, referral codes, links and company questions into cards;
3. Builds a "copy and fill" checklist from confirmed content, and checks for missing items before you submit.

All data stays in your own browser. Nothing is uploaded to a server.

## 2. When and how to use it

For students and interns applying to many roles, or anyone filling the same long forms repeatedly.

1. Import a resume (DOCX or pasted text). It is split into education, internships, projects and so on.
2. Confirm each field under "我的资料 / My facts" (unconfirmed items never enter the fill checklist).
3. Paste a company list or referral information. A messy block copied from a group chat works too.
4. Open a company: check the details, choose a referral code, answer questions specific to that company.
5. Open "照着填 / Copy & fill": copy each item into the official form and tick it off.
6. Run "检查一遍 / Check" (optionally let a model review it), then copy or download the checklist.
7. Submit yourself, then update the stage (to prepare → reviewing → ready → submitted → verified).

Login, CAPTCHA and the final submission are always done by you.

## 3. Current status

Working today:

- **Resume:** local DOCX/text import, section parsing, block-by-block confirmation, verbatim copy;
- **Facts:** source labels (manual/resume), per-item confirmation, export;
- **Companies:** paste parsing (numbered, titled, plain-name lists, links), industry suggestions, referral candidates, per-company questions;
- **Filling:** copy-and-fill checklist, stage and timeline, notes and job ID, local checks, checklist copy/download, optional AI check;
- **MCP:** a local tool server (parsing, field cards, fill plans, checks).

Not built yet:

- Automatic form filling on job sites (needs site permissions and real-page testing);
- Application quota tracking and application-level deduplication;
- A deeper visual/brand pass.

## 4. How to use it

### Try it online

<https://simonshi-stu.github.io/application-copilot/>

### Run locally

Requires Node.js 22+:

```text
npm run serve
```

Open <http://127.0.0.1:4173/extension/editor.html>.

### Use as a browser extension

In Chrome or Edge, open `chrome://extensions`, enable Developer mode, choose "Load unpacked", and select the `extension` folder.

### Optional: MCP

Run `npm run mcp`. Client configuration is in [docs/MCP.md](docs/MCP.md).

### Notes

- Data lives in browser storage. Export before switching computers or clearing site data.
- AI checks use your own model key, stored locally only. Hosted pages may hit CORS limits.
- No login, CAPTCHA or final submission on your behalf. Read the [usage statement](docs/USAGE.md) first.
- Deployment options: [docs/DEPLOY.md](docs/DEPLOY.md).

## License

MIT
