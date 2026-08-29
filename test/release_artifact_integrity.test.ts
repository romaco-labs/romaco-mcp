import { access, mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sentinelJavaScript = resolve(projectRoot, 'dist/__deleted_source_sentinel__.js');
const sentinelDeclaration = resolve(projectRoot, 'dist/__deleted_source_sentinel__.d.ts');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('release artifact integrity', () => {
  it('removes deleted-source sentinels before every build and verifies exact output parity', async () => {
    await mkdir(resolve(projectRoot, 'dist'), { recursive: true });
    await writeFile(sentinelJavaScript, 'throw new Error("stale artifact");\n');
    await writeFile(sentinelDeclaration, 'export declare const stale: true;\n');

    await execFileAsync(npmCommand, ['run', 'build', '--silent'], { cwd: projectRoot });
    expect(await exists(sentinelJavaScript)).toBe(false);
    expect(await exists(sentinelDeclaration)).toBe(false);

    await execFileAsync(process.execPath, ['scripts/verify-build-artifacts.mjs'], { cwd: projectRoot });
  });
});
