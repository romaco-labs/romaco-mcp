import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve('src');
const IMPORT_RE = /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(full);
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });
}

function layerOf(file: string): string | null {
  const rel = path.relative(SRC, file).split(path.sep).join('/');
  if (rel.startsWith('compression/')) return 'compression';
  if (rel.startsWith('domain/')) return 'domain';
  if (rel.startsWith('application/')) return 'application';
  if (rel.startsWith('adapters/inbound/')) return 'inbound';
  if (rel.startsWith('adapters/outbound/')) return 'outbound';
  if (rel.startsWith('bootstrap/')) return 'bootstrap';
  return null;
}

function importedLayer(file: string, specifier: string): string | 'external' | 'legacy' {
  if (!specifier.startsWith('.')) return 'external';
  const target = path.resolve(path.dirname(file), specifier);
  return layerOf(target) ?? 'legacy';
}

const ALLOWED: Record<string, ReadonlySet<string>> = {
  compression: new Set(['compression']),
  domain: new Set(['domain', 'compression']),
  application: new Set(['application', 'domain', 'compression']),
  inbound: new Set(['inbound', 'application', 'domain', 'compression', 'external']),
  outbound: new Set(['outbound', 'application', 'domain', 'compression', 'external']),
  bootstrap: new Set(['bootstrap', 'inbound', 'outbound', 'application', 'domain', 'compression', 'external', 'legacy']),
};

describe('hexagonal dependency rules', () => {
  it('keeps new layers and compression dependencies pointing inward', () => {
    const violations: string[] = [];

    for (const file of tsFiles(SRC)) {
      const sourceLayer = layerOf(file);
      if (!sourceLayer) continue; // Legacy shim: guarded after its migration.

      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(IMPORT_RE)) {
        const specifier = match[1];
        const targetLayer = importedLayer(file, specifier);
        if (!ALLOWED[sourceLayer].has(targetLayer)) {
          violations.push(
            `${path.relative(SRC, file)} (${sourceLayer}) -> ${specifier} (${targetLayer})`,
          );
        }
      }
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });
});
