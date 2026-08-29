import { readdir } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sourceRoot = resolve(projectRoot, 'src');
const outputRoot = resolve(projectRoot, 'dist');

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }));
  return files.flat();
}

function stem(root, path, suffix) {
  return relative(root, path).slice(0, -suffix.length).split(sep).join('/');
}

const sourceFiles = (await walk(sourceRoot)).filter((path) => extname(path) === '.ts');
const outputFiles = await walk(outputRoot);
const expected = new Set(sourceFiles.map((path) => stem(sourceRoot, path, '.ts')));
const emittedJavaScript = new Set(
  outputFiles.filter((path) => extname(path) === '.js').map((path) => stem(outputRoot, path, '.js')),
);
const emittedDeclarations = new Set(
  outputFiles.filter((path) => path.endsWith('.d.ts')).map((path) => stem(outputRoot, path, '.d.ts')),
);

const errors = [];
for (const name of expected) {
  if (!emittedJavaScript.has(name)) errors.push(`missing dist/${name}.js`);
  if (!emittedDeclarations.has(name)) errors.push(`missing dist/${name}.d.ts`);
}
for (const name of emittedJavaScript) {
  if (!expected.has(name)) errors.push(`stale dist/${name}.js`);
}
for (const name of emittedDeclarations) {
  if (!expected.has(name)) errors.push(`stale dist/${name}.d.ts`);
}

if (errors.length > 0) {
  throw new Error(`Build artifact verification failed:\n- ${errors.sort().join('\n- ')}`);
}

console.log(`Verified ${expected.size} source modules against clean dist output.`);
