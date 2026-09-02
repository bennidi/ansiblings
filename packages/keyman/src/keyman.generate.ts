import fs from 'node:fs';
import path from 'node:path';
import inquirer from 'inquirer';
import { runTool } from './keyman.utils.js';
import { storeInVault } from './keyman.vault.js';

export interface KeyOptions {
  algorithm: string;
  identity: string;
}

/**
 * How a new key pair should be made: the algorithm and the comment.
 *
 * Shared with rotation, which asks the same two questions about a key whose name
 * it works out for itself.
 *
 * @param defaultIdentity offered as the answer — the comment of the key being
 *   replaced, when there is one
 */
export async function promptKeyOptions(defaultIdentity?: string): Promise<KeyOptions> {
  const { algorithm } = await inquirer.prompt<{ algorithm: string }>([
    {
      type: 'select',
      name: 'algorithm',
      message: 'Select algorithm:',
      choices: ['ed25519', 'rsa'],
      default: 'ed25519',
    },
  ]);

  const { identity } = await inquirer.prompt<{ identity: string }>([
    {
      type: 'input',
      name: 'identity',
      message: 'Enter key identity (comment):',
      default: defaultIdentity,
    },
  ]);

  return { algorithm, identity };
}

/**
 * Generates one key pair at `keyPath`, reporting a failure rather than throwing.
 *
 * @returns whether the key pair was written
 */
export async function createKeyPair(
  keyPath: string,
  algorithm: string,
  identity: string
): Promise<boolean> {
  const fileName = path.basename(keyPath);

  if (fs.existsSync(keyPath)) {
    console.error(`❌ Error: Key file ${fileName} already exists in ${path.dirname(keyPath)}`);
    return false;
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
    return true;
  } catch (error) {
    console.error(`❌ Error generating key: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

export async function generateKey(tmpDir: string, keysDir: string, pubkey: string) {
  const { keyName } = await inquirer.prompt<{ keyName: string }>([
    {
      type: 'input',
      name: 'keyName',
      message: 'Enter key name:',
      validate: (input) => (input.trim() !== '' ? true : 'Key name cannot be empty'),
    },
  ]);

  const { algorithm, identity } = await promptKeyOptions();

  const fileName = keyName.startsWith('id_') ? keyName : `id_${keyName}`;
  const keyPath = path.join(tmpDir, fileName);

  if (!(await createKeyPair(keyPath, algorithm, identity))) {
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
