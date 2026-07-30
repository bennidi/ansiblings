import fs from 'node:fs';
import path from 'node:path';
import inquirer from 'inquirer';
import { runTool } from './keyman.utils.js';
import { storeInVault } from './keyman.vault.js';

export async function generateKey(tmpDir: string, keysDir: string, pubkey: string) {
  const { algorithm } = await inquirer.prompt<{ algorithm: string }>([
    {
      type: 'list',
      name: 'algorithm',
      message: 'Select algorithm:',
      choices: ['ed25519', 'rsa'],
      default: 'ed25519',
    },
  ]);

  const { keyName } = await inquirer.prompt<{ keyName: string }>([
    {
      type: 'input',
      name: 'keyName',
      message: 'Enter key name:',
      validate: (input) => (input.trim() !== '' ? true : 'Key name cannot be empty'),
    },
  ]);

  const { identity } = await inquirer.prompt<{ identity: string }>([
    {
      type: 'input',
      name: 'identity',
      message: 'Enter key identity (comment):',
    },
  ]);

  const fileName = keyName.startsWith('id_') ? keyName : `id_${keyName}`;
  const keyPath = path.join(tmpDir, fileName);

  if (fs.existsSync(keyPath)) {
    console.error(`❌ Error: Key file ${fileName} already exists in ${tmpDir}`);
    return;
  }

  const args = ['-t', algorithm, '-f', keyPath, '-C', identity];
  if (algorithm === 'rsa') {
    args.push('-b', '4096');
  }

  try {
    console.log(`Generating ${algorithm} key pair...`);
    // No `-N`, and stdio inherited: ssh-keygen asks for the passphrase itself and
    // confirms it. keyman used to prompt for it and pass it as `-N <value>`,
    // which put the passphrase in this process's argv — readable by any user on
    // the box via `ps` for as long as the spawn lived, and in keyman's memory
    // before that. A passphrase keyman never learns cannot be leaked by keyman.
    await runTool('ssh-keygen', args, { stdio: 'inherit' });
    console.log(`✅ Key generated: ${keyPath}`);
  } catch (error) {
    console.error(`❌ Error generating key: ${error instanceof Error ? error.message : error}`);
    return;
  }

  try {
    await storeInVault(keyPath, keysDir, pubkey);
  } catch (error) {
    // The private key is still in tmpDir, so this is recoverable by encrypting it
    // — which is why it does not read as having lost the key.
    console.error(`❌ Error encrypting key: ${error instanceof Error ? error.message : error}`);
    console.error(`   ${keyPath} was generated; encrypt it once the problem is fixed.`);
  }
}
