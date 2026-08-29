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
      if (task.status !== 'runnable') {
        results.push({
          taskId: task.id,
          status: 'planned',
          reason: 'task-not-runnable',
        });
        continue;
      }
      if (!trial || !gradersReady) {
        results.push({
          taskId: task.id,
          status: 'harness_error',
          reason: !trial ? 'workflow-not-implemented' : 'graders-not-runnable',
          grades: [],
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
      harnessErrors: results.filter((result) => result.status === 'harness_error').length,
      planned: results.filter((result) => result.status === 'planned').length,
      results,
    };
    report.taskSuccessRate = report.executed > 0 ? report.passed / report.executed : null;

    if (report.failed > 0 || report.harnessErrors > 0 || (requireAll && report.planned > 0)) {
      const error = new Error(
        `${report.failed} runnable eval task(s) failed; ${report.harnessErrors} harness error(s); ` +
        `${report.planned} task(s) remain planned.`,
      );
      error.report = report;
      throw error;
    }
    return report;
  }
}
