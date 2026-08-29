import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
  name: string;
  version: string;
  mcpName?: string;
  repository?: { url?: string };
}

interface RegistryManifest {
  name: string;
  description: string;
  version: string;
  repository?: { url?: string; source?: string };
  packages?: Array<{
    registryType?: string;
    identifier?: string;
    version?: string;
    runtimeHint?: string;
    transport?: { type?: string };
  }>;
}

const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')) as T;

describe('release metadata', () => {
  it('keeps npm and MCP Registry identities synchronized', () => {
    const pkg = readJson<PackageManifest>('package.json');
    const registry = readJson<RegistryManifest>('server.json');
    const npmPackage = registry.packages?.[0];

    expect(pkg.mcpName).toBe(registry.name);
    expect(registry.version).toBe(pkg.version);
    expect(npmPackage?.identifier).toBe(pkg.name);
    expect(npmPackage?.version).toBe(pkg.version);
    expect(npmPackage?.registryType).toBe('npm');
    expect(npmPackage?.runtimeHint).toBe('npx');
    expect(npmPackage?.transport?.type).toBe('stdio');
  });

  it('keeps registry discovery metadata valid and inspectable', () => {
    const pkg = readJson<PackageManifest>('package.json');
    const registry = readJson<RegistryManifest>('server.json');

    expect(registry.name).toMatch(/^io\.github\.romaco-labs\/[a-zA-Z0-9._-]+$/);
    expect(registry.description.length).toBeGreaterThan(0);
    expect(registry.description.length).toBeLessThanOrEqual(100);
    expect(registry.repository?.source).toBe('github');
    expect(registry.repository?.url).toBe(pkg.repository?.url);
  });
});
