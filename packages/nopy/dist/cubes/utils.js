/**
 * Utility functions for cubes
 * @module cubes/utils
 */
/**
 * Generates a random string of the specified length using the current nanotime as a seed.
 *
 * Uses a simple Linear Congruential Generator (LCG) seeded with high-resolution time.
 * Suitable for generating unique identifiers, not for cryptographic purposes.
 *
 * @param length - The desired length of the random string (default: 5)
 * @returns A random alphanumeric string of the specified length
 *
 * @example
 * ```typescript
 * const id = uniqid();     // e.g., "Kx7Pm"
 * const longId = uniqid(10); // e.g., "Kx7PmQr2Yw"
 * ```
 */
export function uniqid(length = 5) {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charsetLength = charset.length;
    // Use process.hrtime.bigint() for high-resolution time in nanoseconds
    let seed = Number(process.hrtime.bigint() % BigInt(Number.MAX_SAFE_INTEGER));
    const randomString = [];
    for (let i = 0; i < length; i++) {
        // Simple linear congruential generator (LCG) for pseudo-randomness
        seed = (seed * 48271) % 2147483647;
        const index = seed % charsetLength;
        randomString.push(charset[index]);
    }
    return randomString.join('');
}
