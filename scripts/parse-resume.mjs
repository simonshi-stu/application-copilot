import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve, basename, dirname } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { extractDocx } from '../extension/docx.js';
import { parseResume, validateResume } from '../extension/resume-parser.js';

const [input, output = 'private/resume-parsed.json'] = process.argv.slice(2);
if (!input) {
  console.error('Usage: node scripts/parse-resume.mjs <local.docx|text.txt|text.md> [private/output.json]');
  process.exitCode = 1;
} else {
  try {
    const extension = extname(input).toLowerCase();
    if (!['.docx', '.txt', '.md'].includes(extension)) throw new Error('支持本地 DOCX／TXT／MD。PDF 请提供已提取的文本，不直接解析 PDF 二进制。');
    const bytes = await readFile(input);
    const text = extension === '.docx'
      ? await extractDocx(bytes, { inflate: (packed, size) => inflateRawSync(packed, { maxOutputLength: Math.max(size, 1) }) })
      : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const profile = validateResume(parseResume(text, { sourceName: basename(input) }));
    const destination = resolve(output);
    await mkdir(dirname(destination), { recursive: true });
    // Refuse to overwrite an existing user profile.
    await writeFile(destination, JSON.stringify(profile, null, 2), { flag: 'wx', encoding: 'utf8' });
    console.log(`Saved locally: ${destination}`);
    console.log(`Education: ${profile.education.length}; internships: ${profile.internships.length}; projects: ${profile.projects.length}. All unconfirmed.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
