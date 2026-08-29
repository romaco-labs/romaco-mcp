import { describe, expect, it } from 'vitest';
import {
  EXPECTED_EVAL_COUNTS,
  loadEvalManifest,
  validateEvalManifest,
} from '../../evals/manifest.mjs';

describe('agent eval manifest', () => {
  it('defines exactly 28 valid tasks across required splits and categories', () => {
    const summary = validateEvalManifest();
    expect(summary).toMatchObject({
      total: 28,
      bySplit: { dev: 20, heldout: 8 },
      byCategory: {
        headless: 10,
        live: 8,
        'state-recovery': 5,
        approval: 3,
        degraded: 2,
      },
      runnable: 14,
      planned: 14,
      graderCount: 11,
      fixtureCount: 14,
    });
    expect(EXPECTED_EVAL_COUNTS.total).toBe(28);
  });

  it('keeps all task IDs and oracle workflow IDs unique', () => {
    const { tasks } = loadEvalManifest();
    expect(new Set(tasks.map((task) => task.id)).size).toBe(28);
    expect(new Set(tasks.map((task) => task.oracleWorkflow)).size).toBe(28);
  });

  it('rejects duplicate tasks instead of silently skewing metrics', () => {
    const manifest = loadEvalManifest();
    manifest.tasks[1] = { ...manifest.tasks[1], id: manifest.tasks[0].id };
    expect(() => validateEvalManifest(manifest)).toThrow(/duplicate task id/);
  });

  it('rejects missing grader and fixture references', () => {
    const manifest = loadEvalManifest();
    manifest.tasks[0] = {
      ...manifest.tasks[0],
      fixtureRefs: ['missing-fixture'],
      graderRefs: ['missing-grader', 'budget'],
    };
    expect(() => validateEvalManifest(manifest)).toThrow(/unknown fixture/);
    expect(() => validateEvalManifest(manifest)).toThrow(/unknown grader/);
  });

  it('rejects runnable tasks backed by planned graders', () => {
    const manifest = loadEvalManifest();
    manifest.tasks[0] = { ...manifest.tasks[0], graderRefs: ['claims', 'budget'] };
    expect(() => validateEvalManifest(manifest)).toThrow(/references non-runnable grader: claims/);
  });

  it('requires precise blockers only on planned tasks', () => {
    const missing = loadEvalManifest();
    const plannedIndex = missing.tasks.findIndex((task) => task.status === 'planned');
    missing.tasks[plannedIndex] = { ...missing.tasks[plannedIndex], plannedReason: '' };
    expect(() => validateEvalManifest(missing)).toThrow(/needs a precise plannedReason/);

    const runnable = loadEvalManifest();
    const runnableIndex = runnable.tasks.findIndex((task) => task.status === 'runnable');
    runnable.tasks[runnableIndex] = { ...runnable.tasks[runnableIndex], plannedReason: 'not allowed here' };
    expect(() => validateEvalManifest(runnable)).toThrow(/must not declare plannedReason/);
  });
});
