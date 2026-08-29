import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertReleaseVersion, verifyCurrentRelease } from '../scripts/verify-release-version.mjs';

const workflow = readFileSync(
  new URL('../.github/workflows/publish.yml', import.meta.url),
  'utf8',
);

describe('release version gate', () => {
  it('accepts only the tag matching package.json and server.json', () => {
    expect(verifyCurrentRelease('v0.0.4')).toBe('0.0.4');
    expect(() => verifyCurrentRelease('v0.0.5')).toThrow(/git tag must be v0\.0\.4/);
  });

  it('reports every metadata mismatch before publish', () => {
    expect(() =>
      assertReleaseVersion(
        'v1.2.4',
        { name: '@romaco/mcp', version: '1.2.3' },
        {
          version: '1.2.2',
          packages: [
            { registryType: 'npm', identifier: '@romaco/mcp', version: '1.2.1' },
          ],
        },
      ),
    ).toThrow(/git tag must be v1\.2\.3[\s\S]*server\.json version 1\.2\.2[\s\S]*npm package version 1\.2\.1/);
  });
});

describe('publish workflow security contract', () => {
  it('uses GitHub OIDC with a compatible pinned release runtime', () => {
    expect(workflow).toMatch(/id-token:\s*write/);
    expect(workflow).toMatch(/node-version:\s*['"]24['"]/);
    expect(workflow).toContain('npm install --global npm@11.18.0');
    expect(workflow).toContain('npm publish --access public');
  });

  it('contains no token fallback or manual publish trigger', () => {
    expect(workflow).not.toMatch(/NODE_AUTH_TOKEN|NPM_TOKEN|secrets\./);
    expect(workflow).not.toContain('workflow_dispatch');
  });

  it('verifies release identity before the publish command', () => {
    const verifyIndex = workflow.indexOf('npm run verify:release-version');
    const publishIndex = workflow.indexOf('npm publish --access public');
    expect(verifyIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(verifyIndex);
  });
});
