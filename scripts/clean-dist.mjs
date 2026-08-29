import { rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outputDirectory = resolve(projectRoot, 'dist');

if (dirname(outputDirectory) !== projectRoot || basename(outputDirectory) !== 'dist') {
  throw new Error(`Refusing to clean unexpected build output: ${outputDirectory}`);
}

await rm(outputDirectory, { recursive: true, force: true, maxRetries: 3 });
