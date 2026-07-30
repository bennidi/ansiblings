import fs from 'node:fs';
import path from 'node:path';
import inquirer from 'inquirer';
import { clearDecryptedKeys, writeVaultGitignore } from './keyman.clear.js';
import { loadConfig, resolveConfigPaths } from './keyman.config.js';
import { copyKey } from './keyman.copy.js';
import { decryptKeys } from './keyman.decrypt.js';
import { encryptKeys } from './keyman.encrypt.js';
import { generateKey } from './keyman.generate.js';
import { CURRENT_USER, resolveHomeDir } from './keyman.home.js';
import { listKeys } from './keyman.list.js';
import { retireKey, rotateKey } from './keyman.rotate.js';
import { extractAgePublicKey } from './keyman.utils.js';

// 🔹 Main function to resolve paths and manage flow
export async function keyman() {
  // Load configuration from .keymanrc.json or use defaults
  const config = loadConfig();
  const paths = resolveConfigPaths(config);

  console.log(`\n📁 Vault Root: ${paths.vaultRoot}`);
  console.log(`🔑 Keys Directory: ${paths.keysDir}`);
  console.log(`📂 Temp Directory: ${paths.tmpDir}`);
  console.log(`🔐 Age Key: ${paths.keyPath}\n`);

  // Get USER input
  const { user } = await inquirer.prompt<{ user: string }>([
    {
      type: 'input',
      name: 'user',
      message: `Specify USER (default: ${CURRENT_USER}):`,
      default: CURRENT_USER,
    },
  ]);

  const homeDir = resolveHomeDir(user);
  if (!homeDir) {
    process.exit(1);
  }

  const sshDir = path.join(homeDir, '.ssh');
  // 0700 because the vault holds the age identity and, in tmp, plaintext private
  // keys. keysDir is created here too: decrypt used to read it before anything
  // created it.
  for (const dir of [paths.vaultRoot, paths.keysDir, paths.tmpDir]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  writeVaultGitignore(paths.vaultRoot, paths.tmpDir, paths.keyPath);

  // Resolved on demand, because only generate and encrypt need a recipient, and
  // remembered once it succeeds. Retried while it has not: creating the identity
  // mid-session should not mean restarting.
  let recipient: string | null = null;
  const ageRecipient = async () => {
    recipient ??= await extractAgePublicKey(paths.keyPath);
    if (!recipient) {
      console.error(`   Create one with: age-keygen -o ${paths.keyPath}`);
    }
    return recipient;
  };

  // Main loop - keep showing menu until user quits
  let running = true;
  while (running) {
    console.log(`\n${'='.repeat(50)}`);

    // 🔹 Show category selection
    const { category } = await inquirer.prompt<{ category: string }>([
      {
        type: 'list',
        name: 'category',
        message: 'Select operation:',
        choices: [
          { name: '📋 List keys', value: 'list' },
          { name: '📝 Copy public key', value: 'copy' },
          { name: '🆕 Generate key', value: 'generate' },
          { name: '🔒 Encrypt keys', value: 'encrypt' },
          { name: '🔓 Decrypt keys', value: 'decrypt' },
          { name: '🔄 Rotate key', value: 'rotate' },
          { name: '🗑️  Retire key', value: 'retire' },
          { name: '🧹 Clear decrypted keys', value: 'clear' },
          { name: '❌ Quit', value: 'quit' },
        ],
      },
    ]);

    switch (category) {
      case 'list':
        await listKeys(sshDir, paths.keysDir, paths.tmpDir);
        break;
      case 'copy':
        await copyKey(sshDir, paths.tmpDir);
        break;
      case 'generate': {
        const pubkey = await ageRecipient();
        if (pubkey) {
          await generateKey(paths.tmpDir, paths.keysDir, pubkey);
        }
        break;
      }
      case 'encrypt': {
        const pubkey = await ageRecipient();
        if (pubkey) {
          await encryptKeys(sshDir, paths.keysDir, paths.tmpDir, pubkey);
        }
        break;
      }
      case 'decrypt':
        await decryptKeys(sshDir, paths.keysDir, paths.tmpDir, paths.keyPath);
        break;
      case 'rotate': {
        const pubkey = await ageRecipient();
        if (pubkey) {
          await rotateKey(sshDir, paths.keysDir, paths.tmpDir, pubkey);
        }
        break;
      }
      case 'retire':
        await retireKey(sshDir, paths.keysDir, paths.tmpDir);
        break;
      case 'clear':
        await clearDecryptedKeys(paths.tmpDir);
        break;
      case 'quit':
        console.log('\n👋 Goodbye!\n');
        running = false;
        break;
    }
  }
}
