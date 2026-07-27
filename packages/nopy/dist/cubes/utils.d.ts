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
export declare function uniqid(length?: number): string;
