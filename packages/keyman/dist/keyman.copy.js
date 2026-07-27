import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import inquirer from 'inquirer';
export async function copyKey(sshDir, tmpDir) {
    const getKeys = (dir) => {
        if (!fs.existsSync(dir))
            return [];
        return fs.readdirSync(dir).filter((key) => key.startsWith('id_') && !key.endsWith('.pub'));
    };
    const sshKeys = getKeys(sshDir);
    const tmpKeys = getKeys(tmpDir);
    const keys = [...new Set([...sshKeys, ...tmpKeys])];
    if (keys.length === 0) {
        console.log('⚠️ No SSH keys found.');
        return;
    }
    const { selectedKey } = await inquirer.prompt([
        {
            type: 'list',
            name: 'selectedKey',
            message: 'Select key to copy public key from:',
            choices: keys,
        },
    ]);
    // Determine location of the public key
    // Prefer tmpDir if it exists there, otherwise sshDir
    let pubKeyPath = path.join(tmpDir, `${selectedKey}.pub`);
    if (!fs.existsSync(pubKeyPath)) {
        pubKeyPath = path.join(sshDir, `${selectedKey}.pub`);
    }
    if (!fs.existsSync(pubKeyPath)) {
        console.error(`❌ Public key not found for ${selectedKey}`);
        return;
    }
    try {
        const pubKeyContent = fs.readFileSync(pubKeyPath, 'utf-8').trim();
        // Detect OS and use appropriate clipboard command
        // Since the environment is Darwin, we prioritize pbcopy, but we can add others for completeness or use a simple check.
        // For this specific request on Darwin:
        const proc = execa('pbcopy');
        proc.stdin?.write(pubKeyContent);
        proc.stdin?.end();
        await proc;
        console.log(`✅ Public key for ${selectedKey} copied to clipboard!`);
    }
    catch (error) {
        console.error(`❌ Failed to copy to clipboard: ${error}`);
    }
}
