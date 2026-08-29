import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cleanDist } from '../scripts/clean-dist.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('release artifact integrity', () => {
  it('cleans only exact dist output and wires clean verification into build + pack', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'romaco-mcp-clean-'));
    const sentinelJavaScript = resolve(fixtureRoot, 'dist/__deleted_source_sentinel__.js');
    const sentinelDeclaration = resolve(fixtureRoot, 'dist/__deleted_source_sentinel__.d.ts');
    try {
      await mkdir(resolve(fixtureRoot, 'dist'), { recursive: true });
      await writeFile(sentinelJavaScript, 'throw new Error("stale artifact");\n');
      await writeFile(sentinelDeclaration, 'export declare const stale: true;\n');

      await cleanDist(fixtureRoot);
      expect(await exists(sentinelJavaScript)).toBe(false);
      expect(await exists(sentinelDeclaration)).toBe(false);

      const manifest = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      };
      expect(manifest.scripts.build).toContain('npm run clean');
      expect(manifest.scripts.prepack).toContain('npm run build');
      expect(manifest.scripts.prepack).toContain('npm run verify:artifacts');
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});
