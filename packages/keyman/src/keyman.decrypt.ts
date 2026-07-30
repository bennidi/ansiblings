import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import inquirer from 'inquirer';
import { runTool } from './keyman.utils.js';

export async function decryptKeys(sshDir: string, vaultDir: string, ageKey: string) {
  const keyDir = path.join(vaultDir, 'keys');
  // Guarded: nothing creates the keys directory until the first encrypt, so on a
  // fresh vault this readdir threw instead of reporting an empty vault.
  const vaultKeys = fs.existsSync(keyDir)
    ? fs.readdirSync(keyDir).filter((key) => fs.existsSync(path.join(keyDir, key, `id_${key}.age`)))
    : [];

  if (vaultKeys.length === 0) {
    console.log('⚠️ No encrypted keys found.');
    return;
  }

  const { selectedKeys, decryptMode } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedKeys',
      message: 'Select keys to decrypt:',
      choices: vaultKeys,
    },
    {
      type: 'list',
      name: 'decryptMode',
      message: 'Choose decryption location:',
      choices: ['Local (vault/tmp)', 'SSH (~/.ssh)'],
    },
  ]);

  for (const key of selectedKeys) {
    const encryptedKey = path.join(keyDir, key, `id_${key}.age`);
    const publicKey = path.join(keyDir, key, `id_${key}.pub`);
    const privateKeyOut =
      decryptMode === 'Local (vault/tmp)'
        ? path.join(vaultDir, 'tmp', `id_${key}`)
        : path.join(sshDir, `id_${key}`);
    const publicKeyOut =
      decryptMode === 'Local (vault/tmp)'
        ? path.join(vaultDir, 'tmp', `id_${key}.pub`)
        : path.join(sshDir, `id_${key}.pub`);

    // Decrypt key
    await runTool('age', ['-d', '-i', ageKey, '-o', privateKeyOut, encryptedKey]);

    await execa('cp', [publicKey, publicKeyOut]);
    await execa('chmod', ['600', privateKeyOut]);
    console.log(`✅ Decrypted: ${privateKeyOut}`);
  }
}
