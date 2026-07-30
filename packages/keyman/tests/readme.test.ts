/**
 * The README is the only document that ships (`package.json` files: dist,
 * README.md, LICENSE), so a reader on the registry sees it and nothing else. It
 * had drifted to describing four of the menu's entries and none of the command
 * line; these assertions are the parts that can drift again silently.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { helpText } from '../src/keyman.args.js';

const README = fs.readFileSync(path.join(import.meta.dirname, '..', 'README.md'), 'utf-8');

describe('README', () => {
  it('quotes --help verbatim', () => {
    // Copied rather than described, and checked rather than trusted: a flag added
    // to helpText() now fails here instead of shipping undocumented.
    expect(README).toContain(helpText().trim());
  });

  it('documents every menu operation', () => {
    const main = fs.readFileSync(
      path.join(import.meta.dirname, '..', 'src', 'keyman.main.ts'),
      'utf-8'
    );
    const labels = [...main.matchAll(/\{ name: '([^']+)', value: '[a-z]+' \}/g)].map((m) => m[1]);

    // The labels themselves, emoji included, so a renamed entry is caught too —
    // but with runs of whitespace collapsed, because some of them carry a second
    // space to align a variation-selector emoji in a terminal, and prose should
    // not have to reproduce that.
    const collapse = (text: string) => text.replace(/\s+/g, ' ');
    const readme = collapse(README);

    expect(labels.length).toBe(9);
    for (const label of labels) {
      expect(readme, label).toContain(collapse(label));
    }
  });

  it('documents every configuration key', () => {
    for (const key of ['vaultRoot', 'keysDir', 'tmpDir', 'ageKeyFile']) {
      expect(README, key).toContain(key);
    }
  });
});
