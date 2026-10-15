import { normalizeNewlines } from './blocks.js';

const RANGE = /(20\d{2})[./-](\d{1,2})\s*[–—\-~至]\s*(?:(20\d{2})[./-](\d{1,2})|(现在|至今|今))/;
const SECTIONS = new Map([
  ['个人信息', 'personal'], ['基本信息', 'personal'],
  ['教育经历', 'education'], ['教育背景', 'education'],
  ['实习经历', 'internships'], ['工作经历', 'internships'], ['实习信息', 'internships'],
  ['项目经历', 'projects'], ['项目经验', 'projects'], ['项目信息', 'projects'],
  ['个人技能', 'skills'], ['专业技能', 'skills'], ['技能', 'skills'],
  ['语言能力', 'language'], ['语言', 'language'], ['语言与荣誉', 'language'],
  ['个人评价', 'evaluation'], ['自我评价', 'evaluation'], ['个人简介', 'evaluation'],
]);

function heading(line) {
  return line.trim().replace(/^#{1,6}\s*/, '').replace(/[：:]$/, '').replace(/\s/g, '');
}

function paragraphText(raw) {
  // Only reconstruct layout in unconfirmed drafts. The exact input stays in source.text.
  return raw.split('\n').map(line => line.trim().replace(/^[•●▪]\s*/, ''))
    .filter(Boolean).join('');
}

function paragraphs(lines, entryId) {
  const chunks = [];
  let current = [];
  function flush() {
    if (!current.some(line => line.trim())) { current = []; return; }
    const raw = current.join('\n');
    chunks.push({ id: `${entryId}:p${chunks.length + 1}`, raw, text: paragraphText(raw) });
    current = [];
  }
  for (const line of lines) {
    if (!line.trim()) { flush(); continue; }
    if (/^\s*[•●▪]/.test(line)) flush();
    current.push(line);
  }
  flush();
  return chunks;
}

function dateInfo(match) {
  const month = (year, value) => `${year}-${value.padStart(2, '0')}`;
  const invalid = Number(match[2]) < 1 || Number(match[2]) > 12
    || (match[4] && (Number(match[4]) < 1 || Number(match[4]) > 12));
  return {
    raw: match[0], start: invalid ? null : month(match[1], match[2]),
    end: invalid || match[5] ? null : month(match[3], match[4]),
    ongoing: Boolean(match[5]), precision: 'month', invalid: Boolean(invalid),
  };
}

function headerFields(prefix, section) {
  const pieces = prefix.split(/\t+| {2,}/).map(value => value.trim()).filter(Boolean);
  if (section === 'projects') {
    return { name: pieces[0] || prefix.trim(), role: pieces.slice(1).join(' '), location: '' };
  }
  let organization = pieces[0] || prefix.trim();
  let role = pieces.slice(1).join(' ');
  if (!role && section === 'internships') {
    const fallback = organization.match(/^(.*?)\s+([^\s]+(?:实习生|工程师|经理|研究员|负责人))$/);
    if (fallback) { organization = fallback[1]; role = fallback[2]; }
  }
  const comma = Math.max(organization.lastIndexOf('，'), organization.lastIndexOf(','));
  const location = comma >= 0 && section === 'internships' ? organization.slice(comma + 1).trim() : '';
  const name = comma >= 0 && section === 'internships' ? organization.slice(0, comma).trim() : organization;
  const academic = section === 'education' ? pieces.slice(1).join(' ').split(/[｜|]/) : [];
  return { name, role: section === 'education' ? '' : role, location,
    major: academic[0]?.trim() || '', honors: academic.slice(1).map(value => value.trim()).filter(Boolean) };
}

function personalInfo(lines) {
  const text = lines.join('\n');
  const phone = text.match(/(?:电话|手机)[：:\s]*([+\d][\d ()-]{8,20})/);
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const github = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_-]+\/?/i);
  const contactLine = lines.findIndex(line => /电话|手机|邮箱/.test(line));
  let name = '';
  if (contactLine >= 0) {
    const previous = lines.slice(0, contactLine).reverse().find(line => line.trim() && !/^#/.test(line.trim()));
    if (previous && (/^[\p{Script=Han}·]{2,8}$/u.test(previous.trim()) || /^[A-Za-z][A-Za-z .'-]{1,60}$/.test(previous.trim()))) name = previous.trim();
  }
  const intent = text.match(/求职意向[：:]([^\n]*)/);
  return {
    name, phone: phone ? phone[1].replace(/[ ()-]/g, '') : '', email: email?.[0] || '',
    github: github?.[0] || '', intent: intent?.[1].trim() || '',
  };
}

export function projectCandidates(project) {
  const all = project.paragraphs;
  if (!all.length) return null;
  const first = all[0].text;
  const sentenceEnd = first.search(/[。！？]/);
  return {
    status: 'unconfirmed', method: 'extractive_candidate',
    summary: { text: sentenceEnd >= 0 ? first.slice(0, sentenceEnd + 1) : first, sourceParagraphIds: [all[0].id] },
    responsibilities: { text: all.map(p => p.text).join('\n\n'), sourceParagraphIds: all.map(p => p.id) },
    notes: ['自动摘取的候选，不是本人贡献证明；简述和职责可能重复，请本人调整或另行提供。'],
  };
}

export function parseResume(source, { sourceName = '粘贴文本' } = {}) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('请先提供简历文本。');
  if (source.length > 2_000_000) throw new Error('简历文本过大。');
  const text = normalizeNewlines(source);
  const lines = text.split('\n');
  const profile = {
    schema: 'application-copilot.resume.v1', id: crypto.randomUUID(), status: 'unconfirmed',
    source: { name: sourceName, text, format: 'extracted_text' },
    personal: personalInfo(lines), education: [], internships: [], projects: [],
    skills: [], language: [], evaluation: [], unassigned: [], warnings: [],
  };
  let section = 'personal';
  let pending = [];
  let entry = null;
  function flushEntry() {
    if (!entry) return;
    entry.paragraphs = paragraphs(entry.body, entry.id);
    entry.content = entry.paragraphs.map(p => p.text).join('\n\n');
    delete entry.body;
    if (section === 'internships' && !entry.role) entry.warnings.push('岗位未可靠识别，请本人补充。');
    if (section === 'projects') {
      if (!entry.role) entry.warnings.push('简历未明确项目岗位；不默认独立开发或负责人。');
      entry.candidates = projectCandidates(entry);
    }
    profile[section].push(entry);
    entry = null;
  }
  function flushPending() {
    if (!pending.some(line => line.trim())) { pending = []; return; }
    if (['skills', 'language', 'evaluation'].includes(section)) {
      const list = paragraphs(pending, section);
      for (const p of list) {
        // Combined skills sections often contain one line per labelled category.
        const parts = p.raw.split('\n').filter(line => line.trim());
        if (section === 'skills') {
          for (const part of parts) {
            const target = /^\s*语言(?:与荣誉|能力)?[：:]/.test(part) ? 'language' : 'skills';
            profile[target].push(part.trim());
          }
        } else profile[section].push(p.text);
      }
    } else if (section !== 'personal') {
      profile.unassigned.push({ section, text: pending.join('\n') });
    }
    pending = [];
  }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const key = heading(line);
    if (key === 'Header' || key === '页眉') {
      flushEntry(); flushPending(); section = 'personal'; continue;
    }
    if (SECTIONS.has(key)) {
      flushEntry(); flushPending(); section = SECTIONS.get(key); continue;
    }
    if (['education', 'internships', 'projects'].includes(section)) {
      const match = line.match(RANGE);
      // Only a terminal date range is a possible entry header, not a date inside prose.
      if (match && !line.slice(match.index + match[0].length).trim() && line.length < 240
        && !/^\s*[•●▪]/.test(line) && !/[。；;]/.test(line.slice(0, match.index))) {
        let prefix = line.slice(0, match.index);
        let header = line;
        if (entry && /^\s*[,，]/.test(prefix)) {
          let last = entry.body.length - 1;
          while (last >= 0 && !entry.body[last].trim()) last--;
          const preceding = entry.body[last]?.trim();
          if (preceding && preceding.length < 100 && !/^[•●▪]|[。；;]/.test(preceding)) {
            prefix = preceding + prefix;
            header = `${entry.body[last]}\n${line}`;
            entry.body.splice(last);
          }
        }
        if (!entry && pending.some(value => value.trim())) {
          // PDF extraction can move the organization name onto a separate line.
          prefix = pending.filter(value => value.trim()).join('').trimEnd() + prefix;
          header = [...pending, line].join('\n'); pending = [];
        }
        flushEntry(); flushPending();
        const fields = headerFields(prefix, section);
        const dates = dateInfo(match);
        const id = `${section}-${profile[section].length + 1}`;
        entry = { id, ...fields, dates, rawHeader: header, body: [], warnings: [], status: 'unconfirmed' };
        if (!fields.name) entry.warnings.push('名称未识别，请本人补充。');
        if (dates.invalid) entry.warnings.push('月份无效，日期未自动采用。');
        continue;
      }
      if (entry) entry.body.push(line); else pending.push(line);
    } else pending.push(line);
  }
  flushEntry(); flushPending();
  if (!profile.internships.length) profile.warnings.push('未可靠识别实习条目，请核对栏目标题及日期格式。');
  if (!profile.projects.length) profile.warnings.push('未可靠识别项目条目，请核对栏目标题及日期格式。');
  if (!profile.evaluation.length) profile.warnings.push('简历未提供个人评价，保持为空，不自动生成。');
  if (profile.unassigned.length) profile.warnings.push('存在未归类文字，请对照完整原文检查。');
  profile.warnings.push('解析结果均未确认；PDF折行重建仅为候选，完整原文保留在 source.text。');
  return profile;
}

export function resumeBlocks(profile, { includeCandidates = false } = {}) {
  const result = [];
  const add = (entry, kind, text, metadata = {}) => {
    if (!text?.trim()) return;
    result.push({ id: crypto.randomUUID(), item: entry.name, kind, text, originalText: entry.content,
      approved: false, approvedText: null, resumeEntryId: entry.id,
      sourceName: profile.source.name, resumeProfileId: profile.id, ...metadata });
  };
  for (const entry of profile.internships) add(entry, 'internship_content', entry.content, { provenance: 'layout_reconstructed' });
  for (const entry of profile.projects) {
    add(entry, 'project_original', entry.content, { provenance: 'layout_reconstructed' });
    if (includeCandidates && entry.candidates) {
      add(entry, 'project_content', entry.candidates.summary.text, {
        provenance: entry.candidates.method, sourceParagraphIds: entry.candidates.summary.sourceParagraphIds,
      });
      add(entry, 'project_responsibilities', entry.candidates.responsibilities.text, {
        provenance: entry.candidates.method, sourceParagraphIds: entry.candidates.responsibilities.sourceParagraphIds,
      });
    }
  }
  for (const [key, kind, title] of [['language', 'language', '语言与荣誉'], ['evaluation', 'evaluation', '个人评价']]) {
    add({ name: title, content: profile[key].join('\n\n'), id: key }, kind, profile[key].join('\n\n'), { provenance: 'extracted' });
  }
  return result;
}

export function validateResume(profile) {
  const isText = value => typeof value === 'string' && value.length <= 2_000_000;
  if (!profile || profile.schema !== 'application-copilot.resume.v1' || !isText(profile.id)
    || !profile.source || !isText(profile.source.name) || !isText(profile.source.text)
    || !profile.personal || !['name', 'phone', 'email', 'github', 'intent'].every(key => isText(profile.personal[key]))) {
    throw new Error('不是有效的结构化简历文件。');
  }
  for (const key of ['skills', 'language', 'evaluation', 'warnings']) {
    if (!Array.isArray(profile[key]) || profile[key].length > 1000 || !profile[key].every(isText)) throw new Error('简历栏目格式无效。');
  }
  for (const key of ['education', 'internships', 'projects']) {
    if (!Array.isArray(profile[key]) || profile[key].length > 100) throw new Error('简历条目格式无效。');
    const ids = new Set();
    for (const entry of profile[key]) {
      if (!entry || !['id', 'name', 'role', 'location', 'content', 'rawHeader'].every(field => isText(entry[field]))
        || ids.has(entry.id) || !entry.dates || ![entry.dates.start, entry.dates.end].every(value => value === null || isText(value))
        || !Array.isArray(entry.warnings) || !entry.warnings.every(isText)
        || !Array.isArray(entry.paragraphs) || entry.paragraphs.length > 1000
        || !entry.paragraphs.every(p => p && ['id', 'raw', 'text'].every(field => isText(p[field])))) throw new Error('简历字段格式无效。');
      ids.add(entry.id);
    if (entry.candidates) {
        if (!isText(entry.candidates.method)) throw new Error('项目候选来源无效。');
        const sources = new Set(entry.paragraphs.map(p => p.id));
        for (const field of ['summary', 'responsibilities']) {
          const candidate = entry.candidates[field];
          if (!candidate || !isText(candidate.text) || !Array.isArray(candidate.sourceParagraphIds)
            || !candidate.sourceParagraphIds.length || !candidate.sourceParagraphIds.every(id => sources.has(id))) throw new Error('项目候选缺少有效原文出处。');
        }
        entry.candidates.status = 'unconfirmed';
      }
      entry.status = 'unconfirmed';
    }
  }
  profile.status = 'unconfirmed';
  return profile;
}
