import fs from 'node:fs';
import { execa, type Options } from 'execa';

/** A binary keyman needs is not installed — recoverable, unlike a tool refusing */
export class ToolNotFoundError extends Error {
  constructor(readonly binary: string) {
    super(`\`${binary}\` was not found on PATH. Install it and try again.`);
    this.name = 'ToolNotFoundError';
  }
}

/**
 * Runs one of the external binaries keyman depends on.
 *
 * Two failures are worth telling apart, and an execa error tells a reader
 * neither: the binary not being installed (`ENOENT`, whose message is
 * `spawn <name> ENOENT`) and the binary refusing (whose reason is on stderr and
 * nowhere in the thrown message). `age` is a hard requirement, so its absence
 * has to read as an instruction.
 *
 * Returns only `stdout` — annotated rather than inferred because execa's result
 * type cannot be named from here (TS2883), and it is all any caller wants. Empty
 * when the output went somewhere else, as with `stdio: 'inherit'`.
 */
export async function runTool(
  binary: string,
  args: string[],
  options?: Options
): Promise<{ stdout: string }> {
  try {
    // Called without the third argument when there are no options, so a test
    // asserting on the spawn sees the call it wrote.
    const result = options ? await execa(binary, args, options) : await execa(binary, args);
    return { stdout: typeof result.stdout === 'string' ? result.stdout : '' };
  } catch (error) {
    const failure = error as { code?: string; stderr?: string; shortMessage?: string };
    if (failure.code === 'ENOENT') {
      throw new ToolNotFoundError(binary);
    }
    throw new Error(`\`${binary}\` failed: ${failure.stderr?.trim() || failure.shortMessage}`);
  }
}

/**
 * The age recipient a vault encrypts to, derived from its identity file.
 *
 * `age-keygen -y` derives the public key from the secret key, so it cannot
 * disagree with it. The `# public key:` comment can: it is ordinary text that
 * nothing re-checks, and a wrong one encrypts the vault to a recipient nobody
 * holds the private half of. Verified — rewriting the comment does not change
 * what `-y` reports.
 *
 * The comment stays as a fallback for a machine with no `age-keygen`, behind a
 * warning that it is unverified. It is *not* a fallback for `age-keygen`
 * refusing the file: that means age cannot read the identity, and trusting the
 * comment then would encrypt to a recipient the vault could never decrypt with.
 *
 * @returns the recipient, or null with the reason already reported
 */
export async function extractAgePublicKey(keyFilePath: string): Promise<string | null> {
  if (!fs.existsSync(keyFilePath)) {
    console.error(`❌ ERROR: Age key file not found at ${keyFilePath}`);
    return null;
  }

  try {
    const { stdout } = await runTool('age-keygen', ['-y', keyFilePath]);
    const derived = stdout.trim();
    if (derived.startsWith('age1')) {
      return derived;
    }
    console.error(`❌ ERROR: age-keygen derived no public key from ${keyFilePath}`);
    return null;
  } catch (error) {
    if (!(error instanceof ToolNotFoundError)) {
      console.error(`❌ ERROR: ${error instanceof Error ? error.message : error}`);
      return null;
    }
    console.warn(
      `⚠️  age-keygen is not installed — reading the public key from the comment in ${keyFilePath}, unverified against the secret key.`
    );
  }

  return publicKeyFromComment(keyFilePath);
}

/** The `# public key:` line: a claim about the key rather than a derivation from it */
function publicKeyFromComment(keyFilePath: string): string | null {
  try {
    const fileContents = fs.readFileSync(keyFilePath, 'utf-8');
    const publicKeyMatch = fileContents.match(/^# public key:\s*(age1[^\s]+)/m);

    return publicKeyMatch ? publicKeyMatch[1] : null;
  } catch (error) {
    console.error(`❌ ERROR: Failed to read key file - ${error}`);
    return null;
  }
}
