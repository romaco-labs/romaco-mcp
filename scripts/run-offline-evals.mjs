import { OfflineEvalRunner } from '../evals/harness/offline-runner.mjs';
import { DETERMINISTIC_GRADERS } from '../evals/graders/deterministic.mjs';
import { SUPPORTED_OFFLINE_TRIALS } from '../evals/trials/supported.mjs';

const args = new Set(process.argv.slice(2));
const splitArg = process.argv.find((arg) => arg.startsWith('--split='));
const split = splitArg?.slice('--split='.length);

try {
  const runner = new OfflineEvalRunner({
    trials: SUPPORTED_OFFLINE_TRIALS,
    graders: DETERMINISTIC_GRADERS,
  });
  const report = await runner.run({ split, requireAll: args.has('--require-all') });
  process.stdout.write(`${JSON.stringify({
    manifestValid: report.manifestValid,
    selectedTasks: report.selectedTasks,
    executed: report.executed,
    passed: report.passed,
    failed: report.failed,
    harnessErrors: report.harnessErrors,
    planned: report.planned,
    taskSuccessRate: report.taskSuccessRate,
    successNumerator: report.passed,
    successDenominator: report.executed,
    note: 'Success rate covers runnable tasks only; planned tasks are excluded and reported separately.',
  }, null, 2)}\n`);
} catch (error) {
  const report = error && typeof error === 'object' ? error.report : undefined;
  if (report) {
    process.stderr.write(`${JSON.stringify({
      manifestValid: report.manifestValid,
      selectedTasks: report.selectedTasks,
      executed: report.executed,
      passed: report.passed,
      failed: report.failed,
      harnessErrors: report.harnessErrors,
      planned: report.planned,
      taskSuccessRate: report.taskSuccessRate,
      successNumerator: report.passed,
      successDenominator: report.executed,
      note: 'Success rate covers runnable tasks only; planned tasks are excluded and reported separately.',
      error: error.message,
    }, null, 2)}\n`);
  } else {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  }
  process.exitCode = 1;
}
