import fs from 'node:fs';
import path from 'node:path';
import { reportSkippedKeys, scanPrivateKeys } from './keyman.keys.js';

interface KeyInfo {
  name: string;
  inSsh: boolean;
  hasSshPub: boolean;
  inVault: boolean;
  inTmp: boolean;
  hasTmpPub: boolean;
}

export async function listKeys(sshDir: string, vaultDir: string, tmpDir: string) {
  console.log('\n📂 Checking keys in:');
  console.log(`   SSH:   ${sshDir}`);
  console.log(`   Vault: ${vaultDir}`);
  console.log(`   Tmp:   ${tmpDir}\n`);

  const keyMap = new Map<string, KeyInfo>();

  // Scan SSH directory
  if (fs.existsSync(sshDir)) {
    const sshFiles = fs.readdirSync(sshDir).filter((file) => file.startsWith('id_'));

    for (const file of sshFiles) {
      const keyName = file.replace(/\.pub$/, '');
      const isPub = file.endsWith('.pub');

      if (!keyMap.has(keyName)) {
        keyMap.set(keyName, {
          name: keyName,
          inSsh: !isPub,
          hasSshPub: isPub,
          inVault: false,
          inTmp: false,
          hasTmpPub: false,
        });
      } else {
        const key = keyMap.get(keyName)!;
        if (isPub) {
          key.hasSshPub = true;
        } else {
          key.inSsh = true;
        }
      }
    }
  }

  // Scan tmp directory
  if (fs.existsSync(tmpDir)) {
    const tmpFiles = fs.readdirSync(tmpDir).filter((file) => file.startsWith('id_'));

    for (const file of tmpFiles) {
      const keyName = file.replace(/\.pub$/, '');
      const isPub = file.endsWith('.pub');

      if (!keyMap.has(keyName)) {
        keyMap.set(keyName, {
          name: keyName,
          inSsh: false,
          hasSshPub: false,
          inVault: false,
          inTmp: !isPub,
          hasTmpPub: isPub,
        });
      } else {
        const key = keyMap.get(keyName)!;
        if (isPub) {
          key.hasTmpPub = true;
        } else {
          key.inTmp = true;
        }
      }
    }
  }

  // Scan vault directory
  if (fs.existsSync(vaultDir)) {
    // throwIfNoEntry keeps a dangling symlink from aborting the whole listing;
    // the stat still follows a symlink to a real directory, which withFileTypes
    // would have reported as a link and skipped.
    const vaultDirs = fs.readdirSync(vaultDir).filter((dir) => {
      const stat = fs.statSync(path.join(vaultDir, dir), { throwIfNoEntry: false });
      return stat?.isDirectory() ?? false;
    });

    for (const dir of vaultDirs) {
      const keyName = `id_${dir}`;
      const encryptedPath = path.join(vaultDir, dir, `${keyName}.age`);

      if (fs.existsSync(encryptedPath)) {
        if (!keyMap.has(keyName)) {
          keyMap.set(keyName, {
            name: keyName,
            inSsh: false,
            hasSshPub: false,
            inVault: true,
            inTmp: false,
            hasTmpPub: false,
          });
        } else {
          keyMap.get(keyName)!.inVault = true;
        }
      }
    }
  }

  // A listing that omits keys without saying so is the worst place for the id_
  // assumption to be invisible: this is the screen a user checks it against.
  for (const dir of [sshDir, tmpDir]) {
    reportSkippedKeys(scanPrivateKeys(dir).skipped, dir);
  }

  // Display results
  if (keyMap.size === 0) {
    console.log('⚠️  No SSH keys found.\n');
    return;
  }

  console.log('🔑 SSH Keys:\n');
  console.log('  Key Name                      [Vault] [Tmp] [.ssh]');
  console.log(`  ${'─'.repeat(58)}`);

  const sortedKeys = Array.from(keyMap.values()).sort((a, b) => a.name.localeCompare(b.name));

  for (const key of sortedKeys) {
    const vaultMark = key.inVault ? '✓' : ' ';
    const tmpMark = key.inTmp ? '✓' : ' ';
    const sshMark = key.inSsh ? '✓' : ' ';

    // Show (.pub) if present in any location
    const hasPub = key.hasSshPub || key.hasTmpPub;
    const pubIndicator = hasPub ? ' (.pub)' : '';

    // Determine status
    const status =
      key.inVault && key.inSsh ? '✅' : key.inVault && key.inTmp ? '🔓' : key.inVault ? '🔒' : '⚠️ ';

    const namePart = `${key.name}${pubIndicator}`.padEnd(32);
    console.log(`  ${status} ${namePart} [${vaultMark}]   [${tmpMark}]  [${sshMark}]`);
  }

  console.log('\n  Legend:');
  console.log('  ✅ = Managed (encrypted in vault + active in .ssh)');
  console.log('  🔓 = Decrypted (in vault + decrypted to tmp)');
  console.log('  🔒 = Encrypted only (in vault, not decrypted)');
  console.log('  ⚠️  = Unmanaged (in .ssh or tmp, not encrypted in vault)\n');
}
