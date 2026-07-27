import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import inquirer from 'inquirer';
import { loadConfig, resolveConfigPaths } from './keyman.config.js';
import { copyKey } from './keyman.copy.js';
import { decryptKeys } from './keyman.decrypt.js';
import { encryptKeys } from './keyman.encrypt.js';
import { generateKey } from './keyman.generate.js';
import { listKeys } from './keyman.list.js';
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
      message: 'Specify USER (default: @current):',
      default: '@current',
    },
  ]);

  const homeDir = user === '@current' ? process.env.HOME || '' : `/home/${user}`;
  if (!homeDir) {
    console.error('Error: Unable to determine HOME directory.');
    process.exit(1);
  }

  const sshDir = path.join(homeDir, '.ssh');
  fs.mkdirSync(paths.vaultRoot, { recursive: true });
  fs.mkdirSync(paths.tmpDir, { recursive: true });

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
      case 'generate':
        await generateKey(paths.tmpDir, paths.keysDir, extractAgePublicKey(paths.keyPath)!);
        break;
      case 'encrypt':
        await encryptKeys(
          sshDir,
          paths.vaultRoot,
          paths.tmpDir,
          extractAgePublicKey(paths.keyPath)!
        );
        break;
      case 'decrypt':
        await decryptKeys(sshDir, paths.vaultRoot, paths.keyPath);
        break;
      case 'quit':
        console.log('\n👋 Goodbye!\n');
        running = false;
        break;
    }
  }
}
