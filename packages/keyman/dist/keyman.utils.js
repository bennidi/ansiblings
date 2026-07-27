import fs from 'node:fs';
/**
 * Extracts the public key from an age key file.
 * @param keyFilePath Path to the age key file.
 * @returns The public key as a string, or null if not found.
 */
export function extractAgePublicKey(keyFilePath) {
    if (!fs.existsSync(keyFilePath)) {
        console.error(`❌ ERROR: Age key file not found at ${keyFilePath}`);
        return null;
    }
    try {
        const fileContents = fs.readFileSync(keyFilePath, 'utf-8');
        const publicKeyMatch = fileContents.match(/^# public key:\s*(age1[^\s]+)/m);
        return publicKeyMatch ? publicKeyMatch[1] : null;
    }
    catch (error) {
        console.error(`❌ ERROR: Failed to read key file - ${error}`);
        return null;
    }
}
