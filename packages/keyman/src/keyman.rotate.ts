/**
 * Key rotation, in two halves that are deliberately not one operation.
 *
 * `rotateKey` only ever *adds*: a replacement key generated under the next name in
 * the series and encrypted alongside the key it replaces. `retireKey` is what
 * finally deletes the old one, once the user says the replacement is deployed.
 *
 * Rotating in place — overwriting the key, or deleting it in the same breath —
 * locks you out of the host you were rotating for: the replacement is not on it
 * yet, and the only copy of the key that is has gone. The gap between the two
 * operations is where you add the new public key and check that it works.
 */

import fs from 'node:fs';
import path from 'node:path';
import inquirer from 'inquirer';
import { createKeyPair, promptKeyOptions } from './keyman.generate.js';
import { scanPrivateKeys } from './keyman.keys.js';
import { listVaultKeys, storeInVault } from './keyman.vault.js';

interface Series {
  base: string;
  version: number;
}

/** `prod-2` → base `prod`, version 2. An unsuffixed name is version 1. */
function series(key: string): Series {
  const match = /^(.+)-(\d+)$/.exec(key);
  return match ? { base: match[1], version: Number(match[2]) } : { base: key, version: 1 };
}

/**
 * The name for the replacement of `key`: same series, next version up.
 *
 * The name has to change. The vault layout derives the directory from it, so a
 * replacement also called `prod` *is* the `prod` entry — and holding both at once
 * is the whole point of rotating this way.
 *
 * @param taken every name already in use, in the vault or as a plaintext key, so
 *   the suffix skips a version that was made by hand
 */
export function nextRotationName(key: string, taken: string[]): string {
  const { base, version } = series(key);
  let next = version + 1;

  for (const name of taken) {
    const other = series(name);
    if (other.base === base && other.version >= next) {
      next = other.version + 1;
    }
  }

  return `${base}-${next}`;
}

/** The latest key in the vault that comes after `key` in its series, if any. */
export function supersededBy(key: string, vaultKeys: string[]): string | null {
  const { base, version } = series(key);
  let successor: string | null = null;
  let highest = version;

  for (const name of vaultKeys) {
    const other = series(name);
    if (other.base === base && other.version > highest) {
      successor = name;
      highest = other.version;
    }
  }

  return successor;
}

/** The bare names of the plaintext keys in `dir`, matching the vault's naming. */
function plaintextNames(dir: string): string[] {
  return scanPrivateKeys(dir).keys.map((file) => file.replace(/^id_/, ''));
}

/** The comment on a stored public key, so a rotation can carry it over. */
function storedComment(publicKeyFile: string): string | undefined {
  if (!fs.existsSync(publicKeyFile)) {
    return undefined;
  }

  // `<type> <base64> <comment...>`: the comment is optional and may hold spaces.
  const comment = fs.readFileSync(publicKeyFile, 'utf-8').trim().split(/\s+/).slice(2).join(' ');
  return comment || undefined;
}

/** Prints a public key for copying, or says why it cannot. */
function showPublicKey(label: string, file: string): void {
  console.log(`\n   ${label}`);
  if (fs.existsSync(file)) {
    console.log(`   ${fs.readFileSync(file, 'utf-8').trim()}`);
  } else {
    console.log(`   (none stored at ${file})`);
  }
}

function isFile(file: string): boolean {
  return fs.statSync(file, { throwIfNoEntry: false })?.isFile() ?? false;
}

/**
 * Generates a replacement for a vault key and stores it beside the original.
 *
 * Nothing is deleted or overwritten; `retireKey` is the other half.
 */
export async function rotateKey(
  sshDir: string,
  keysDir: string,
  tmpDir: string,
  pubkey: string
): Promise<void> {
  const vaultKeys = listVaultKeys(keysDir);

  if (vaultKeys.length === 0) {
    console.log('⚠️  No encrypted keys to rotate — generate or encrypt one first.');
    return;
  }

  const { key } = await inquirer.prompt<{ key: string }>([
    {
      type: 'select',
      name: 'key',
      message: 'Select the key to rotate:',
      choices: vaultKeys,
    },
  ]);

  const currentPublicKey = path.join(keysDir, key, `id_${key}.pub`);
  const { algorithm, identity } = await promptKeyOptions(storedComment(currentPublicKey));

  const replacement = nextRotationName(key, [
    ...vaultKeys,
    ...plaintextNames(tmpDir),
    ...plaintextNames(sshDir),
  ]);
  const keyPath = path.join(tmpDir, `id_${replacement}`);

  console.log(`\n🔄 Rotating ${key} → ${replacement}`);
  console.log(`   ${key} is left exactly as it is, in the vault and on its hosts.\n`);

  fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  if (!(await createKeyPair(keyPath, algorithm, identity))) {
    return;
  }

  try {
    await storeInVault(keyPath, keysDir, pubkey);
  } catch (error) {
    console.error(
      `❌ Error encrypting the replacement: ${error instanceof Error ? error.message : error}`
    );
    console.error(`   ${keyPath} was generated; encrypt it once the problem is fixed.`);
    return;
  }

  showPublicKey(`Current — still valid (${key}):`, currentPublicKey);
  showPublicKey(`Replacement — deploy this (${replacement}):`, `${keyPath}.pub`);

  console.log('\n   Next:');
  console.log(`     1. Add the replacement public key wherever ${key} is authorized.`);
  console.log(`     2. Check that you can log in with ${keyPath}.`);
  console.log(`     3. Remove ${key} from those hosts, then retire it here.\n`);
}

/**
 * Deletes a vault key and its plaintext copies, after saying exactly what goes.
 *
 * The second half of a rotation, and the only operation in keyman that destroys an
 * encrypted key.
 */
export async function retireKey(sshDir: string, keysDir: string, tmpDir: string): Promise<void> {
  const vaultKeys = listVaultKeys(keysDir);

  if (vaultKeys.length === 0) {
    console.log('⚠️  No encrypted keys in the vault.');
    return;
  }

  const { key } = await inquirer.prompt<{ key: string }>([
    {
      type: 'select',
      name: 'key',
      message: 'Select the key to retire:',
      choices: vaultKeys,
    },
  ]);

  const vaultPath = path.join(keysDir, key);
  const files = [
    ...fs.readdirSync(vaultPath).map((file) => path.join(vaultPath, file)),
    path.join(tmpDir, `id_${key}`),
    path.join(tmpDir, `id_${key}.pub`),
    path.join(sshDir, `id_${key}`),
    path.join(sshDir, `id_${key}.pub`),
  ].filter(isFile);

  const successor = supersededBy(key, vaultKeys);

  console.log(`\n🗑️  Retiring ${key} deletes:`);
  for (const file of files) {
    console.log(`     ${file}`);
  }
  if (successor) {
    console.log(`\n   ${successor} is in the vault and supersedes ${key}.`);
  } else {
    console.log(`\n⚠️  Nothing in the vault supersedes ${key}: this deletes the only copy.`);
  }

  const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
    {
      type: 'confirm',
      name: 'confirmed',
      message: `Delete ${files.length} ${files.length === 1 ? 'file' : 'files'}?`,
      default: false,
    },
  ]);

  if (!confirmed) {
    console.log('   Nothing was deleted.');
    return;
  }

  // Typed out when there is no successor, because that is the deletion this tool
  // exists to prevent: an encrypted key nothing replaces is the only copy there is,
  // and a y/n is one keystroke away from an irreversible one.
  if (!successor) {
    const { typed } = await inquirer.prompt<{ typed: string }>([
      {
        type: 'input',
        name: 'typed',
        message: `Type ${key} to confirm:`,
      },
    ]);

    if (typed.trim() !== key) {
      console.log('   Name did not match — nothing was deleted.');
      return;
    }
  }

  for (const file of files) {
    fs.rmSync(file, { force: true });
    console.log(`   Removed ${file}`);
  }

  try {
    // Only while empty: anything left in there was not ours to delete.
    fs.rmdirSync(vaultPath);
  } catch {
    console.log(`   Kept ${vaultPath} — it still holds other files.`);
  }

  console.log(`✅ Retired ${key}.`);
}
