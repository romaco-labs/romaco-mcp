import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function assertReleaseVersion(tag, packageManifest, registryManifest) {
  const expectedTag = `v${packageManifest.version}`;
  const npmPackage = registryManifest.packages?.find(
    (entry) => entry.registryType === 'npm' && entry.identifier === packageManifest.name,
  );
  const errors = [];

  if (tag !== expectedTag) {
    errors.push(`git tag must be ${expectedTag}; received ${tag || '(empty)'}`);
  }
  if (registryManifest.version !== packageManifest.version) {
    errors.push(
      `server.json version ${registryManifest.version} does not match package.json ${packageManifest.version}`,
    );
  }
  if (!npmPackage) {
    errors.push(`server.json has no npm package entry for ${packageManifest.name}`);
  } else if (npmPackage.version !== packageManifest.version) {
    errors.push(
      `server.json npm package version ${npmPackage.version} does not match package.json ${packageManifest.version}`,
    );
  }

  if (errors.length > 0) {
    throw new Error(`Release version verification failed:\n- ${errors.join('\n- ')}`);
  }
}

export function verifyCurrentRelease(tag) {
  const packageManifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  const registryManifest = JSON.parse(
    readFileSync(new URL('../server.json', import.meta.url), 'utf8'),
  );
  assertReleaseVersion(tag, packageManifest, registryManifest);
  return packageManifest.version;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  try {
    const version = verifyCurrentRelease(process.argv[2] ?? process.env.GITHUB_REF_NAME ?? '');
    console.log(`Release metadata verified for v${version}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
