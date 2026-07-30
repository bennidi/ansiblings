import fs from 'node:fs';
import { execa, type Options } from 'execa';

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
      throw new Error(`\`${binary}\` was not found on PATH. Install it and try again.`);
    }
    throw new Error(`\`${binary}\` failed: ${failure.stderr?.trim() || failure.shortMessage}`);
  }
}

/**
 * Extracts the public key from an age key file.
 * @param keyFilePath Path to the age key file.
 * @returns The public key as a string, or null if not found.
 */
export function extractAgePublicKey(keyFilePath: string): string | null {
  if (!fs.existsSync(keyFilePath)) {
    console.error(`❌ ERROR: Age key file not found at ${keyFilePath}`);
    return null;
  }

  try {
    const fileContents = fs.readFileSync(keyFilePath, 'utf-8');
    const publicKeyMatch = fileContents.match(/^# public key:\s*(age1[^\s]+)/m);

    return publicKeyMatch ? publicKeyMatch[1] : null;
  } catch (error) {
    console.error(`❌ ERROR: Failed to read key file - ${error}`);
    return null;
  }
}
