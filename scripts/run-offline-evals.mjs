import { OfflineEvalRunner } from '../evals/harness/offline-runner.mjs';

const args = new Set(process.argv.slice(2));
const splitArg = process.argv.find((arg) => arg.startsWith('--split='));
const split = splitArg?.slice('--split='.length);

try {
  const runner = new OfflineEvalRunner();
  const report = await runner.run({ split, requireAll: args.has('--require-all') });
  process.stdout.write(`${JSON.stringify({
    manifestValid: report.manifestValid,
    selectedTasks: report.selectedTasks,
    executed: report.executed,
    planned: report.planned,
    taskSuccessRate: report.taskSuccessRate,
    note: 'No task success claimed until workflows and graders become runnable.',
  }, null, 2)}\n`);
} catch (error) {
  const report = error && typeof error === 'object' ? error.report : undefined;
  if (report) {
    process.stderr.write(`${JSON.stringify({
      manifestValid: report.manifestValid,
      selectedTasks: report.selectedTasks,
      executed: report.executed,
      planned: report.planned,
      taskSuccessRate: null,
      error: error.message,
    }, null, 2)}\n`);
  } else {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  }
  process.exitCode = 1;
}
