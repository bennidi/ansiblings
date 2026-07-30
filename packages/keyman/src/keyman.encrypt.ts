import path from 'node:path';
import inquirer from 'inquirer';
import { reportSkippedKeys, scanPrivateKeys } from './keyman.keys.js';
import { ToolNotFoundError } from './keyman.utils.js';
import { storeInVault } from './keyman.vault.js';

export async function encryptKeys(sshDir: string, keysDir: string, tmpDir: string, pubkey: string) {
  const ssh = scanPrivateKeys(sshDir);
  const tmp = scanPrivateKeys(tmpDir);
  const sshKeys = ssh.keys;
  const tmpKeys = tmp.keys;
  const keys = [...new Set([...sshKeys, ...tmpKeys])];

  reportSkippedKeys(ssh.skipped, sshDir);
  reportSkippedKeys(tmp.skipped, tmpDir);

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
