import fs from 'node:fs';
import path from 'node:path';
import inquirer from 'inquirer';
import { copyToClipboard } from './keyman.clipboard.js';
import { reportSkippedKeys, scanPrivateKeys } from './keyman.keys.js';

export async function copyKey(sshDir: string, tmpDir: string) {
  const ssh = scanPrivateKeys(sshDir);
  const tmp = scanPrivateKeys(tmpDir);

  const keys = [...new Set([...ssh.keys, ...tmp.keys])];

  // Before the empty check: "no SSH keys found" next to four unmanageable ones is
  // the case the report exists for.
  reportSkippedKeys(ssh.skipped, sshDir);
  reportSkippedKeys(tmp.skipped, tmpDir);

  if (keys.length === 0) {
    console.log('⚠️ No SSH keys found.');
    return;
  }

  const { selectedKey } = await inquirer.prompt<{ selectedKey: string }>([
    {
      type: 'list',
      name: 'selectedKey',
      message: 'Select key to copy public key from:',
      choices: keys,
    },
  ]);

  // Determine location of the public key
  // Prefer tmpDir if it exists there, otherwise sshDir
  let pubKeyPath = path.join(tmpDir, `${selectedKey}.pub`);
  if (!fs.existsSync(pubKeyPath)) {
    pubKeyPath = path.join(sshDir, `${selectedKey}.pub`);
  }

  if (!fs.existsSync(pubKeyPath)) {
    console.error(`❌ Public key not found for ${selectedKey}`);
    return;
  }

  const pubKeyContent = fs.readFileSync(pubKeyPath, 'utf-8').trim();

  try {
    const tool = await copyToClipboard(pubKeyContent);

    if (tool) {
      console.log(`✅ Public key for ${selectedKey} copied to clipboard via ${tool}!`);
      return;
    }
    console.warn('⚠️  No clipboard command found.');
  } catch (error) {
    console.error(
      `❌ Failed to copy to clipboard: ${error instanceof Error ? error.message : error}`
    );
  }

  // Printing it is the point of the operation; the clipboard was only the
  // convenient way to deliver it. A public key is not a secret.
  console.log(`\n${pubKeyContent}\n`);
}
