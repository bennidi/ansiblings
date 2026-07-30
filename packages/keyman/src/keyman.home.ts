import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The answer the USER prompt defaults to: whoever is running keyman. */
export const CURRENT_USER = '@current';

/**
 * The home directory of the current user.
 *
 * `HOME` first, because a user who set it meant it, and `os.userInfo()` after,
 * which reads the passwd database and so still answers when `HOME` is unset — a
 * cron job, a `su` without `-l`, a container entrypoint. `process.env.HOME || ''`
 * treated all of those as a fatal error.
 */
function currentHome(): string | null {
  if (process.env.HOME) {
    return process.env.HOME;
  }
  try {
    return os.userInfo().homedir || null;
  } catch {
    // uv_os_get_passwd can fail outright when there is no passwd entry for the uid.
    return null;
  }
}

/**
 * Where another user's home directory is, without asking the system.
 *
 * The sibling of the current user's home comes first because it is right wherever
 * homes live together, whatever that directory is called — `/Users` on macOS,
 * `/home` on Linux, `/export/home` on the odd installation. keyman previously
 * hardcoded `/home/<user>`, which is wrong on the one platform it was written on.
 *
 * The candidates are checked for existence rather than guessed at, so a wrong one
 * produces an error naming what was tried instead of an empty `readdir`.
 */
function candidateHomes(user: string): string[] {
  const home = currentHome();
  const siblings = home ? [path.join(path.dirname(home), user)] : [];

  return [...new Set([...siblings, path.join('/home', user), path.join('/Users', user)])];
}

/**
 * Resolves the home directory for an answer to the USER prompt.
 *
 * @returns the directory, or null with the reason already reported
 */
export function resolveHomeDir(user: string): string | null {
  if (user === CURRENT_USER) {
    const home = currentHome();
    if (!home) {
      console.error('❌ Unable to determine HOME directory for the current user.');
      return null;
    }
    return home;
  }

  const candidates = candidateHomes(user);
  const found = candidates.find((candidate) => fs.existsSync(candidate));

  if (!found) {
    console.error(`❌ No home directory found for ${user}. Tried: ${candidates.join(', ')}`);
    return null;
  }

  return found;
}
