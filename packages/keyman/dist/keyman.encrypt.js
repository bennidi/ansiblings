import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import inquirer from 'inquirer';
export async function encryptKeys(sshDir, vaultDir, tmpDir, pubkey) {
    const sshKeys = fs
        .readdirSync(sshDir)
        .filter((key) => key.startsWith('id_') && !key.endsWith('.pub'));
    const tmpKeys = fs
        .readdirSync(tmpDir)
        .filter((key) => key.startsWith('id_') && !key.endsWith('.pub'));
    console.log(tmpKeys);
    console.log(sshKeys);
    const keys = [...new Set([...sshKeys, ...tmpKeys])];
    if (keys.length === 0) {
        console.log('⚠️ No private SSH keys found to encrypt.');
        return;
    }
    const { selectedKeys } = await inquirer.prompt([
        {
            type: 'checkbox',
            name: 'selectedKeys',
            message: 'Select SSH keys to encrypt:',
            choices: keys,
        },
    ]);
    for (const key of selectedKeys) {
        const keyPath = path.join(tmpKeys.includes(key) ? tmpDir : sshDir, key);
        const vaultPath = path.join(vaultDir, 'keys', key.replace('id_', ''));
        fs.mkdirSync(vaultPath, { recursive: true });
        // Encrypt key using `age`
        await execa('age', ['-r', pubkey, '-o', path.join(vaultPath, `${key}.age`), keyPath]);
        // Copy public key and create README
        fs.copyFileSync(`${keyPath}.pub`, path.join(vaultPath, `${key}.pub`));
        console.log(`🔒 Encrypted and stored: ${vaultPath}/${key}`);
    }
}
