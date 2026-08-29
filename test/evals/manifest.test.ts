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
      runnable: 9,
      planned: 19,
      graderCount: 10,
      fixtureCount: 13,
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
});
