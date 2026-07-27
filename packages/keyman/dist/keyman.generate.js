import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import inquirer from 'inquirer';
export async function generateKey(tmpDir, keysDir, pubkey) {
    const { algorithm } = await inquirer.prompt([
        {
            type: 'list',
            name: 'algorithm',
            message: 'Select algorithm:',
            choices: ['ed25519', 'rsa'],
            default: 'ed25519',
        },
    ]);
    const { keyName } = await inquirer.prompt([
        {
            type: 'input',
            name: 'keyName',
            message: 'Enter key name:',
            validate: (input) => (input.trim() !== '' ? true : 'Key name cannot be empty'),
        },
    ]);
    const { password } = await inquirer.prompt([
        {
            type: 'password',
            name: 'password',
            message: 'Enter passphrase (leave empty for no passphrase):',
            mask: '*',
        },
    ]);
    const { identity } = await inquirer.prompt([
        {
            type: 'input',
            name: 'identity',
            message: 'Enter key identity (comment):',
        },
    ]);
    const fileName = keyName.startsWith('id_') ? keyName : `id_${keyName}`;
    const keyPath = path.join(tmpDir, fileName);
    if (fs.existsSync(keyPath)) {
        console.error(`❌ Error: Key file ${fileName} already exists in ${tmpDir}`);
        return;
    }
    try {
        console.log(`Generating ${algorithm} key pair...`);
        const args = ['-t', algorithm, '-f', keyPath, '-N', password, '-C', identity];
        if (algorithm === 'rsa') {
            args.push('-b', '4096');
        }
        await execa('ssh-keygen', args);
        console.log(`✅ Key generated: ${keyPath}`);
        // Encrypt the key
        const folderName = fileName.replace('id_', '');
        const vaultPath = path.join(keysDir, folderName);
        fs.mkdirSync(vaultPath, { recursive: true });
        // Encrypt key using `age`
        await execa('age', ['-r', pubkey, '-o', path.join(vaultPath, `${fileName}.age`), keyPath]);
        // Copy public key
        fs.copyFileSync(`${keyPath}.pub`, path.join(vaultPath, `${fileName}.pub`));
        console.log(`🔒 Encrypted and stored: ${vaultPath}`);
    }
    catch (error) {
        console.error(`❌ Error generating/encrypting key: ${error}`);
    }
}
