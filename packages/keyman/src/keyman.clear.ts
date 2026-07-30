import fs from 'node:fs';
import path from 'node:path';
import inquirer from 'inquirer';
import { scanPrivateKeys } from './keyman.keys.js';

/**
 * Writes a `.gitignore` beside the vault, once.
 *
 * The README told the user to do this by hand. A vault holds the age identity and,
 * whenever anything has been decrypted, plaintext private keys — committing it is
 * the exact failure the tool exists to prevent, and it is one file to prevent it.
 *
 * Never overwritten: an existing file may say more than this one does.
 */
export function writeVaultGitignore(vaultRoot: string, tmpDir: string, keyPath: string) {
  const gitignore = path.join(vaultRoot, '.gitignore');
  if (fs.existsSync(gitignore)) {
    return;
  }

  // Both are configurable and may be absolute, so either can sit outside the vault.
  // A .gitignore cannot speak about a path above itself, and claiming to would be
  // worse than saying nothing.
  const inside = (target: string) => {
    const relative = path.relative(vaultRoot, target);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : null;
  };

  const tmp = inside(tmpDir);
  const key = inside(keyPath);

  const lines = [
    '# Written by keyman. The encrypted keys under the keys directory are safe to',
    '# commit; nothing else here is.',
    ...(key ? [key, `${key}.pub`] : []),
    ...(tmp ? [`${tmp}/`] : []),
    '',
  ];

  fs.writeFileSync(gitignore, lines.join('\n'), { mode: 0o600 });
}

/**
 * Deletes the decrypted keys in the vault's tmp directory.
 *
 * The counterpart to `decrypt`, which had none: a plaintext private key stayed
 * there until someone remembered it, and "someone remembered" is not a security
 * control. Only the key pairs are removed — anything else in the directory is not
 * keyman's to delete.
 */
export async function clearDecryptedKeys(tmpDir: string) {
  const { keys } = scanPrivateKeys(tmpDir);

  if (keys.length === 0) {
    console.log(`✅ Nothing decrypted in ${tmpDir}.`);
    return;
  }

  console.log(`\n🔓 Decrypted keys in ${tmpDir}:`);
  for (const key of keys) {
    console.log(`   ${key}`);
  }

  const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
    {
      type: 'confirm',
      name: 'confirmed',
      message: `Delete ${keys.length === 1 ? 'this key' : `these ${keys.length} keys`}?`,
      // A key that exists only here — generated and not yet deployed — is gone for
      // good, so this is not a question to answer by pressing return.
      default: false,
    },
  ]);

  if (!confirmed) {
    console.log('⏭️  Nothing was deleted.');
    return;
  }

  for (const key of keys) {
    for (const file of [key, `${key}.pub`]) {
      fs.rmSync(path.join(tmpDir, file), { force: true });
    }
    console.log(`🧹 Removed ${key}`);
  }
}
