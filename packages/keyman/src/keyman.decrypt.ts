import fs from 'node:fs';
import path from 'node:path';
import inquirer from 'inquirer';
import { runTool } from './keyman.utils.js';
import { listVaultKeys } from './keyman.vault.js';

/** The two decryption targets. Values, so the label can name the real directory. */
const LOCAL_MODE = 'local';

interface DecryptPlan {
  key: string;
  encryptedKey: string;
  publicKey: string;
  privateKeyOut: string;
  publicKeyOut: string;
}

export async function decryptKeys(sshDir: string, keysDir: string, tmpDir: string, ageKey: string) {
  const vaultKeys = listVaultKeys(keysDir);

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
      type: 'select',
      name: 'decryptMode',
      message: 'Choose decryption location:',
      // Named after the directories actually in use, which are configurable.
      choices: [
        { name: `Local (${tmpDir})`, value: LOCAL_MODE },
        { name: `SSH (${sshDir})`, value: 'ssh' },
      ],
    },
  ]);

  const outDir = decryptMode === LOCAL_MODE ? tmpDir : sshDir;

  const plans: DecryptPlan[] = selectedKeys.map((key: string) => ({
    key,
    encryptedKey: path.join(keysDir, key, `id_${key}.age`),
    publicKey: path.join(keysDir, key, `id_${key}.pub`),
    privateKeyOut: path.join(outDir, `id_${key}`),
    publicKeyOut: path.join(outDir, `id_${key}.pub`),
  }));

  // Every collision is settled before anything is written. `age -d -o` and the
  // old `cp` both overwrote silently, so decrypting a vault key on top of a
  // newer working key destroyed it with no prompt and no copy — and the user is
  // answering these questions about files that still exist.
  const approved: DecryptPlan[] = [];
  for (const plan of plans) {
    const existing = [plan.privateKeyOut, plan.publicKeyOut].filter((file) => fs.existsSync(file));

    if (existing.length === 0) {
      approved.push(plan);
      continue;
    }

    const { overwrite } = await inquirer.prompt<{ overwrite: boolean }>([
      {
        type: 'confirm',
        name: 'overwrite',
        message: `${existing.join(', ')} already present. Overwrite?`,
        default: false,
      },
    ]);

    if (overwrite) {
      approved.push(plan);
    } else {
      console.log(`⏭️  Skipped ${plan.key} — kept what was already there.`);
    }
  }

  if (approved.length === 0) {
    return;
  }

  // 0700: ~/.ssh may not exist yet, and it is about to hold a private key.
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });

  for (const plan of approved) {
    await runTool('age', ['-d', '-i', ageKey, '-o', plan.privateKeyOut, plan.encryptedKey]);
    // Immediately, and in-process: age creates its output 0644 regardless of
    // umask, so this used to be a world-readable private key for the length of
    // two process spawns — and stayed 0644 whenever the chmod itself failed.
    fs.chmodSync(plan.privateKeyOut, 0o600);

    if (fs.existsSync(plan.publicKey)) {
      fs.copyFileSync(plan.publicKey, plan.publicKeyOut);
    } else {
      console.log(
        `⚠️  ${plan.key} has no public key in the vault; only the private key was written.`
      );
    }

    console.log(`✅ Decrypted: ${plan.privateKeyOut}`);
  }
}
