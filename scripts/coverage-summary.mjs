#!/usr/bin/env node

/**
 * Renders the per-package vitest `json-summary` reports as one Markdown table.
 *
 * Appends to $GITHUB_STEP_SUMMARY when running under Actions so the numbers are
 * visible on the run page without opening the log, and prints to stdout
 * otherwise. Never fails the build: the hard gate is vitest's own
 * `coverage.thresholds`, this is only a report.
 */

import fs from 'node:fs';
import path from 'node:path';

const PACKAGES_DIR = 'packages';
const METRICS = ['statements', 'branches', 'functions', 'lines'];

const reports = fs
  .readdirSync(PACKAGES_DIR)
  .map((name) => ({
    name,
    file: path.join(PACKAGES_DIR, name, 'coverage', 'coverage-summary.json'),
  }))
  .filter(({ file }) => fs.existsSync(file));

if (reports.length === 0) {
  console.error('No coverage reports found under packages/*/coverage — nothing to summarise.');
  process.exit(0);
}

const heading = (metric) => metric[0].toUpperCase() + metric.slice(1);

const rows = reports.map(({ name, file }) => {
  const { total } = JSON.parse(fs.readFileSync(file, 'utf-8'));
  return `| \`${name}\` | ${METRICS.map((metric) => `${total[metric].pct}%`).join(' | ')} |`;
});

const table = [
  '### Coverage',
  '',
  `| Package | ${METRICS.map(heading).join(' | ')} |`,
  `| --- ${'| --- '.repeat(METRICS.length)}|`,
  ...rows,
  '',
].join('\n');

const summaryFile = process.env.GITHUB_STEP_SUMMARY;
if (summaryFile) {
  fs.appendFileSync(summaryFile, `${table}\n`);
} else {
  console.log(table);
}
