import fs from 'node:fs';
import path from 'node:path';
import { runTool } from './keyman.utils.js';

/**
 * The vault entries that hold an encrypted key, sorted.
 *
 * A directory counts as an entry when it holds `id_<dir>.age` — the layout
 * `storeInVault` writes and `decrypt` reads back — which is what keeps a stray
 * file, or a directory whose encryption failed, out of every menu built from this.
 * Sorted because the order otherwise comes from the filesystem.
 */
export function listVaultKeys(keysDir: string): string[] {
  // Nothing creates the keys directory until the first encrypt, so on a fresh
  // vault this readdir threw instead of reporting an empty one.
  if (!fs.existsSync(keysDir)) {
    return [];
  }

  return fs
    .readdirSync(keysDir)
    .filter((key) => fs.existsSync(path.join(keysDir, key, `id_${key}.age`)))
    .sort();
}

/**
 * The public half of a private key, derived if the sibling file is missing.
 *
 * `encrypt` builds its selection list from private keys only, so a key whose
 * `.pub` was deleted is offered like any other. Reading the sibling blindly meant
 * finding out it was absent *after* `age` had written the encrypted key — a vault
 * entry with no public key, and an exception that killed the rest of the batch.
 *
 * @returns the public key text, or null with the reason already reported
 */
async function publicKeyFor(keyPath: string): Promise<string | null> {
  const sibling = `${keyPath}.pub`;
  if (fs.existsSync(sibling)) {
    return fs.readFileSync(sibling, 'utf-8');
  }

  const fileName = path.basename(keyPath);
  console.log(`ℹ️  ${fileName} has no .pub file — deriving it with ssh-keygen.`);

  try {
    // stdin and stderr inherited, stdout piped: verified that `ssh-keygen -y`
    // prompts for the passphrase of an encrypted key, and that it prompts on
    // *stderr*. Capturing everything would hide the prompt and then fail on the
    // passphrase nobody was asked for; inheriting everything would lose the key.
    const { stdout } = await runTool('ssh-keygen', ['-y', '-f', keyPath], {
      stdio: ['inherit', 'pipe', 'inherit'],
    });
    const derived = stdout.trim();
    if (derived) {
      return `${derived}\n`;
    }
  } catch (error) {
    console.warn(`⚠️  ${fileName}: ${error instanceof Error ? error.message : error}`);
  }

  console.warn(`⚠️  ${fileName}: no public key could be derived; storing the private key alone.`);
  return null;
}

/**
 * Encrypts one private key into `<keysDir>/<name>/`, alongside its public half.
 *
 * Shared by `encrypt` and `generate`, which were two copies of it.
 *
 * @returns the vault directory the key was stored in
 */
export async function storeInVault(
  keyPath: string,
  keysDir: string,
  pubkey: string
): Promise<string> {
  const fileName = path.basename(keyPath);
  const vaultPath = path.join(keysDir, fileName.replace(/^id_/, ''));

  // Before the directory exists, so a key that cannot be read does not leave one.
  const publicKey = await publicKeyFor(keyPath);

  fs.mkdirSync(vaultPath, { recursive: true, mode: 0o700 });
  const encryptedKey = path.join(vaultPath, `${fileName}.age`);

  try {
    await runTool('age', ['-r', pubkey, '-o', encryptedKey, keyPath]);
  } catch (error) {
    // age writes into a directory that has to exist already, so a failure here
    // leaves one behind — and possibly a truncated .age file, which `list` would
    // count as a vault entry and `decrypt` would offer. Both are ours: the file
    // because we named it, the directory only while it is empty, since one
    // holding an earlier key is not.
    fs.rmSync(encryptedKey, { force: true });
    try {
      fs.rmdirSync(vaultPath);
    } catch {
      // ENOTEMPTY — something else was already stored here.
    }
    throw error;
  }

  if (publicKey !== null) {
    fs.writeFileSync(path.join(vaultPath, `${fileName}.pub`), publicKey);
  }

  console.log(`🔒 Encrypted and stored: ${path.join(vaultPath, `${fileName}.age`)}`);
  return vaultPath;
}
