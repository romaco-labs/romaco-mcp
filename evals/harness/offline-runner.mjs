import { loadEvalManifest, validateEvalManifest } from '../manifest.mjs';

/**
 * Trial functions are intentionally separate from task manifests. A task is
 * runnable only after its workflow and every referenced grader exist.
 */
export class OfflineEvalRunner {
  constructor({ trials = new Map(), graders = new Map() } = {}) {
    this.trials = trials;
    this.graders = graders;
  }

  async run({ split, requireAll = false } = {}) {
    const manifest = loadEvalManifest();
    const validation = validateEvalManifest(manifest);
    const tasks = split ? manifest.tasks.filter((task) => task.split === split) : manifest.tasks;
    const results = [];

    for (const task of tasks) {
      const trial = this.trials.get(task.oracleWorkflow);
      const gradersReady = task.graderRefs.every(
        (id) => manifest.graders.find((grader) => grader.id === id)?.status === 'runnable'
          && this.graders.has(id),
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

      const trialResult = await trial({ task, manifest });
      const grades = await Promise.all(task.graderRefs.map(async (graderId) => {
        const grade = await this.graders.get(graderId)(task, trialResult);
        return { graderId, ...grade };
      }));
      const passed = grades.every((grade) => grade.passed);
      results.push({
        taskId: task.id,
        status: passed ? 'passed' : 'failed',
        grades,
      });
    }

    const report = {
      manifestValid: true,
      manifest: validation,
      selectedTasks: tasks.length,
      executed: results.filter((result) => result.status === 'passed' || result.status === 'failed').length,
      passed: results.filter((result) => result.status === 'passed').length,
      failed: results.filter((result) => result.status === 'failed').length,
      planned: results.filter((result) => result.status === 'planned').length,
      results,
    };
    report.taskSuccessRate = report.executed > 0 ? report.passed / report.executed : null;

    if (requireAll && (report.planned > 0 || report.failed > 0)) {
      const error = new Error(
        `${report.planned} eval task(s) are still planned; ${report.failed} runnable task(s) failed.`,
      );
      error.report = report;
      throw error;
    }
    return report;
  }
}
