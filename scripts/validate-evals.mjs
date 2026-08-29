import { validateEvalManifest } from '../evals/manifest.mjs';

try {
  const summary = validateEvalManifest();
  process.stdout.write(`${JSON.stringify({ valid: true, ...summary }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
