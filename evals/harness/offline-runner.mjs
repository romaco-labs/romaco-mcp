import { loadEvalManifest, validateEvalManifest } from '../manifest.mjs';

/**
 * Trial functions are intentionally separate from task manifests. A task is
 * runnable only after its workflow and every referenced grader exist.
 */
export class OfflineEvalRunner {
  constructor({ trials = new Map() } = {}) {
    this.trials = trials;
  }

  async run({ split, requireAll = false } = {}) {
    const manifest = loadEvalManifest();
    const validation = validateEvalManifest(manifest);
    const tasks = split ? manifest.tasks.filter((task) => task.split === split) : manifest.tasks;
    const results = [];

    for (const task of tasks) {
      const trial = this.trials.get(task.oracleWorkflow);
      const gradersReady = task.graderRefs.every(
        (id) => manifest.graders.find((grader) => grader.id === id)?.status === 'runnable',
      );
      if (task.status !== 'runnable' || !trial || !gradersReady) {
        results.push({
          taskId: task.id,
          status: 'planned',
          reason: task.status !== 'runnable'
            ? 'task-not-runnable'
            : !trial
              ? 'workflow-not-implemented'
              : 'graders-not-runnable',
        });
        continue;
      }

      // Phase A has no runnable trials. Future trials may execute here, but
      // runner still reports them as ungraded until grader results are supplied.
      const trialResult = await trial({ task, manifest });
      results.push({ taskId: task.id, status: 'executed-ungraded', trialResult });
    }

    const report = {
      manifestValid: true,
      manifest: validation,
      selectedTasks: tasks.length,
      executed: results.filter((result) => result.status === 'executed-ungraded').length,
      planned: results.filter((result) => result.status === 'planned').length,
      taskSuccessRate: null,
      results,
    };

    if (requireAll && report.planned > 0) {
      const error = new Error(`${report.planned} eval task(s) are still planned.`);
      error.report = report;
      throw error;
    }
    return report;
  }
}
