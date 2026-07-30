import fs from 'node:fs';
import path from 'node:path';
import inquirer from 'inquirer';
import { runTool } from './keyman.utils.js';

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

export async function encryptKeys(
  sshDir: string,
  vaultDir: string,
  tmpDir: string,
  pubkey: string
) {
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

  for (const key of selectedKeys) {
    const keyPath = path.join(tmpKeys.includes(key) ? tmpDir : sshDir, key);
    const vaultPath = path.join(vaultDir, 'keys', key.replace('id_', ''));
    fs.mkdirSync(vaultPath, { recursive: true, mode: 0o700 });

    // Encrypt key using `age`
    await runTool('age', ['-r', pubkey, '-o', path.join(vaultPath, `${key}.age`), keyPath]);

    // Copy public key and create README
    fs.copyFileSync(`${keyPath}.pub`, path.join(vaultPath, `${key}.pub`));

    console.log(`🔒 Encrypted and stored: ${vaultPath}/${key}`);
  }
}
