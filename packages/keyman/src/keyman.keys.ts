import fs from 'node:fs';
import path from 'node:path';

/** Present in the first line of every private key format ssh-keygen writes. */
const PRIVATE_KEY_MARKER = 'PRIVATE KEY-----';

/** Enough for `-----BEGIN OPENSSH PRIVATE KEY-----`, and no more of a key than needed. */
const HEADER_BYTES = 64;

/**
 * Whether a file opens with a private key header.
 *
 * A bounded read of the first line, not the file: classifying a key is no reason
 * to pull one into memory.
 */
function looksLikePrivateKey(file: string): boolean {
  let handle: number | undefined;
  try {
    handle = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(HEADER_BYTES);
    const read = fs.readSync(handle, buffer, 0, HEADER_BYTES, 0);
    return buffer.subarray(0, read).toString('latin1').includes(PRIVATE_KEY_MARKER);
  } catch {
    // A directory, a socket, a file with no read permission — none of them a key.
    return false;
  } finally {
    if (handle !== undefined) {
      fs.closeSync(handle);
    }
  }
}

export interface PrivateKeyScan {
  /** Keys keyman can manage: named `id_*`, which is what the vault layout assumes. */
  keys: string[];
  /** Private keys it found and cannot manage, because they are named otherwise. */
  skipped: string[];
}

/**
 * The private keys in a directory that may not exist.
 *
 * A first run has neither `~/.ssh` nor the tmp directory, and an unguarded readdir
 * there threw before the "nothing to encrypt" message could be reached.
 *
 * `skipped` exists because the `id_*` filter is silent: a key named
 * `deploy_ed25519` was simply absent from every menu, and pre-existing keys are
 * the population a key manager gets adopted to take over. Reporting them is not
 * managing them — see `reportSkippedKeys`.
 */
export function scanPrivateKeys(dir: string): PrivateKeyScan {
  if (!fs.existsSync(dir)) {
    return { keys: [], skipped: [] };
  }

  const keys: string[] = [];
  const skipped: string[] = [];

  // Sorted, because readdir order is the filesystem's business and a menu's order
  // should not depend on it.
  for (const file of fs.readdirSync(dir).sort()) {
    if (file.endsWith('.pub')) {
      continue;
    }
    if (file.startsWith('id_')) {
      // Not content-checked: what the menus offered has not changed.
      keys.push(file);
    } else if (looksLikePrivateKey(path.join(dir, file))) {
      skipped.push(file);
    }
  }

  return { keys, skipped };
}

/**
 * Says which private keys were found and left alone, and why.
 *
 * The vault stores a key as `<name minus id_>/id_<name>.age` and `decrypt`
 * reconstructs the filename from the directory, so the prefix is baked into the
 * on-disk layout — which is why this is a report and not a fix.
 */
export function reportSkippedKeys(skipped: string[], dir: string): void {
  if (skipped.length === 0) {
    return;
  }

  const plural = skipped.length === 1 ? 'key' : 'keys';
  console.log(
    `ℹ️  Skipped ${skipped.length} private ${plural} in ${dir} not named id_*: ${skipped.join(', ')}`
  );
  console.log('   The vault layout requires the id_ prefix; rename to manage them here.');
}
