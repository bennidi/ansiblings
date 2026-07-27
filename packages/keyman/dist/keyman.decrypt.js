import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import inquirer from 'inquirer';
export async function decryptKeys(sshDir, vaultDir, ageKey) {
    const keyDir = path.join(vaultDir, 'keys');
    const vaultKeys = fs.readdirSync(keyDir).filter((key) => {
        const keyfile = path.join(keyDir, key, `id_${key}.age`);
        console.log(keyfile);
        return fs.existsSync(keyfile);
    });
    if (vaultKeys.length === 0) {
        console.log('⚠️ No encrypted keys found.');
        return;
    }
    const { selectedKeys, decryptMode } = await inquirer.prompt([
        {
            type: 'checkbox',
            name: 'selectedKeys',
            message: 'Select keys to decrypt:',
            choices: vaultKeys,
        },
        {
            type: 'list',
            name: 'decryptMode',
            message: 'Choose decryption location:',
            choices: ['Local (vault/tmp)', 'SSH (~/.ssh)'],
        },
    ]);
    for (const key of selectedKeys) {
        const encryptedKey = path.join(keyDir, key, `id_${key}.age`);
        const publicKey = path.join(keyDir, key, `id_${key}.pub`);
        const privateKeyOut = decryptMode === 'Local (vault/tmp)'
            ? path.join(vaultDir, 'tmp', `id_${key}`)
            : path.join(sshDir, `id_${key}`);
        const publicKeyOut = decryptMode === 'Local (vault/tmp)'
            ? path.join(vaultDir, 'tmp', `id_${key}.pub`)
            : path.join(sshDir, `id_${key}.pub`);
        // Decrypt key
        await execa('age', ['-d', '-i', ageKey, '-o', privateKeyOut, encryptedKey]);
        await execa('cp', [publicKey, publicKeyOut]);
        await execa('chmod', ['600', privateKeyOut]);
        console.log(`✅ Decrypted: ${privateKeyOut}`);
    }
}
