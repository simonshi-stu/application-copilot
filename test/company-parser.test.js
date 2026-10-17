import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCompanies, detectPlatform, cleanCompanyName, companyKey } from '../extension/company-parser.js';

// 全部为虚构示例，仅验证解析形状。

test('编号条目与【】标题拆分，忽略纯说明文字', () => {
  const { entries, skipped } = parseCompanies([
    '开得晚的秋招合集',
    '1️⃣【示例银行 2027校园招聘】10月11日截止',
    'https://app.mokahr.com/m/campus_apply/example-bank/12345?recommendCode=TESTCODE99#/jobs',
    '内推码:TESTCODE99',
    '2️⃣【示例汽车 秋招】选校园大使推荐',
    'https://example.jobs.feishu.cn/s/abc123',
    '内推码:TESTCODE01',
  ].join('\n'));
  assert.equal(skipped, 1);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].company, '示例银行');
  assert.equal(entries[1].company, '示例汽车');
});

test('内推码去重与冲突检测：同值合并、异值保留双候选', () => {
  const single = parseCompanies('【示例公司】https://x.example.com/apply?recommendCode=CODEAAA\n内推码:CODEAAA');
  assert.equal(single.entries[0].referral.code, 'CODEAAA');
  assert.equal(single.entries[0].referral.conflict, false);
  const conflict = parseCompanies('【冲突公司】https://x.example.com/apply?recommendCode=CODEAAA\n内推码:CODEBBB');
  assert.deepEqual(conflict.entries[0].referral.candidates, ['CODEAAA', 'CODEBBB']);
  assert.equal(conflict.entries[0].referral.conflict, true);
});

test('平台识别、渠道提示、批次与截止日期', () => {
  const moka = parseCompanies('【示例公司】https://app.mokahr.com/m/campus_apply/x/1?recommendCode=AAAA\n链接自带').entries[0];
  assert.equal(moka.platform, 'moka');
  assert.equal(moka.channelHint, '链接自带');
  const feishu = parseCompanies('【示例汽车 秋招】https://example.jobs.feishu.cn/s/abc123\n选校园大使推荐').entries[0];
  assert.equal(feishu.platform, 'feishu');
  assert.equal(feishu.channelHint, '大使推荐');
  assert.equal(feishu.batch, '秋招');
  const beisen = parseCompanies('【南京示例银行】10月11日截止\nhttps://example.zhiye.com/campus/jobs').entries[0];
  assert.equal(beisen.platform, 'beisen');
  assert.match(beisen.deadline, /10月11日截止/);
});

test('无链接条目保留并警告，空输入安全返回', () => {
  const only = parseCompanies('【示例公司 秋招】');
  assert.equal(only.entries.length, 1);
  assert.deepEqual(only.entries[0].links, []);
  assert.equal(only.entries[0].platform, 'none');
  assert.match(only.entries[0].warnings.join(' '), /未识别链接/);
  assert.deepEqual(parseCompanies('').entries, []);
  assert.deepEqual(parseCompanies('随便一句说明').entries, []);
});

test('纯公司名列表各自建档，不静默丢弃', () => {
  const { entries, skipped } = parseCompanies('示例甲公司\n示例乙公司\n示例丙公司');
  assert.equal(skipped, 0);
  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map(entry => entry.company), ['示例甲公司', '示例乙公司', '示例丙公司']);
  assert.ok(entries.every(entry => entry.warnings.some(warning => warning.includes('未识别链接'))));
});

test('多行无编号链接各自建档；公司名加链接保持同一条', () => {
  const bare = parseCompanies('https://alpha.example.invalid/jobs\nhttps://beta.example.invalid/campus');
  assert.equal(bare.entries.length, 2);
  assert.ok(bare.entries.every(entry => entry.links.length === 1));
  const pair = parseCompanies('示例甲公司\nhttps://alpha.example.invalid/jobs');
  assert.equal(pair.entries.length, 1);
  assert.equal(pair.entries[0].company, '示例甲公司');
  assert.equal(pair.entries[0].links.length, 1);
  const titled = parseCompanies('【示例公司】\nhttps://alpha.example.invalid/jobs\nhttps://alpha.example.invalid/notice');
  assert.equal(titled.entries.length, 1);
  assert.equal(titled.entries[0].links.length, 2);
});

test('空行分隔的混合列表各自建档，码归属相邻链接条目', () => {
  const mixed = parseCompanies('示例甲公司\n\nhttps://alpha.example.invalid/jobs\n\n内推码:TESTCODE01');
  assert.equal(mixed.entries.length, 2);
  assert.equal(mixed.entries[0].company, '示例甲公司');
  assert.equal(mixed.entries[1].company, '');
  assert.equal(mixed.entries[1].links.length, 1);
  assert.equal(mixed.entries[1].referral.candidates[0], 'TESTCODE01');
});

test('公司名清理与去重键', () => {
  assert.equal(cleanCompanyName('新增外企示例宝可梦2027届校园招聘3D设计师岗位投递链接：'), '外企示例宝可梦');
  assert.equal(cleanCompanyName('示例公司 秋招'), '示例公司');
  const entry = parseCompanies('【示例公司】https://x.example.com/apply').entries[0];
  assert.equal(companyKey(entry), '示例公司|https://x.example.com/apply');
});
