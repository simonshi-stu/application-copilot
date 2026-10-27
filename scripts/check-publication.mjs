import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, checkPublication } from './package-openchamber.mjs';

/**
 * Read-only publication check. This script never stages, commits, tags or
 * publishes anything; it only verifies the explicit runtime allowlist and the
 * generated panel/service artifacts.
 */
export async function runPublicationCheck({ rootDir = ROOT } = {}) {
  const report = await checkPublication({ rootDir });
  return report;
}

function printReport(report) {
  if (report.ok) {
    console.log('Publication check passed.');
    for (const file of report.files) console.log(`  allowed: ${file.path}`);
    console.log('  generated: package.json (runtime manifest)');
    return;
  }
  console.error('Publication check failed. Nothing was staged, committed or published.');
  for (const error of report.errors) console.error(`- ${error}`);
}

async function main() {
  const report = await runPublicationCheck();
  printReport(report);
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`Publication check crashed: ${error.message}`);
    process.exitCode = 1;
  });
}
