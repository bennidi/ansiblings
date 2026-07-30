import fs from 'node:fs';
import path from 'node:path';
import inquirer from 'inquirer';
import { ToolNotFoundError } from './keyman.utils.js';
import { storeInVault } from './keyman.vault.js';

/**
 * Private keys in a directory that may not exist.
 *
 * A first run has neither `~/.ssh` nor the tmp directory, and an unguarded
 * readdir there threw before the "nothing to encrypt" message could be reached.
 */
function privateKeysIn(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir).filter((key) => key.startsWith('id_') && !key.endsWith('.pub'));
}

export async function encryptKeys(sshDir: string, keysDir: string, tmpDir: string, pubkey: string) {
  const sshKeys = privateKeysIn(sshDir);
  const tmpKeys = privateKeysIn(tmpDir);
  const keys = [...new Set([...sshKeys, ...tmpKeys])];

  if (keys.length === 0) {
    console.log('⚠️ No private SSH keys found to encrypt.');
    return;
  }

  const { selectedKeys } = await inquirer.prompt<{ selectedKeys: string[] }>([
    {
      type: 'checkbox',
      name: 'selectedKeys',
      message: 'Select SSH keys to encrypt:',
      choices: keys,
    },
  ]);

  const failed: string[] = [];

  for (const key of selectedKeys) {
    const keyPath = path.join(tmpKeys.includes(key) ? tmpDir : sshDir, key);

    try {
      await storeInVault(keyPath, keysDir, pubkey);
    } catch (error) {
      // One bad key costs one key. Selecting ten and losing the last nine to an
      // unreadable first one was the old behaviour, and nothing afterwards said
      // which of the ten had made it into the vault.
      if (error instanceof ToolNotFoundError) {
        // Not a per-key problem: age is missing for all of them, so nine more
        // identical failures would tell the user nothing new.
        throw error;
      }
      failed.push(key);
      console.error(`❌ ${key}: ${error instanceof Error ? error.message : error}`);
    }
  }

  if (failed.length > 0) {
    console.log(
      `\n⚠️  ${failed.length} of ${selectedKeys.length} selected keys were not stored: ${failed.join(', ')}`
    );
  }
}
