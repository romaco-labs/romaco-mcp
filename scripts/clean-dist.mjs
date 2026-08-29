import { rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

export async function cleanDist(root = projectRoot) {
  const normalizedRoot = resolve(root);
  const outputDirectory = resolve(normalizedRoot, 'dist');
  if (dirname(outputDirectory) !== normalizedRoot || basename(outputDirectory) !== 'dist') {
    throw new Error(`Refusing to clean unexpected build output: ${outputDirectory}`);
  }
  await rm(outputDirectory, { recursive: true, force: true, maxRetries: 3 });
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) await cleanDist();
