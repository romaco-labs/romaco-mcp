import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EVAL_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(EVAL_ROOT, '..');

export const EVAL_CATEGORIES = [
  'headless',
  'live',
  'state-recovery',
  'approval',
  'degraded',
];

export const EXPECTED_EVAL_COUNTS = {
  total: 28,
  splits: { dev: 20, heldout: 8 },
  categories: {
    headless: 10,
    live: 8,
    'state-recovery': 5,
    approval: 3,
    degraded: 2,
  },
};

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, relativePath), 'utf8'));
}

export function loadEvalManifest() {
  return {
    tasks: [
      ...readJson('evals/tasks/dev.json'),
      ...readJson('evals/tasks/heldout.json'),
    ],
    graders: readJson('evals/graders/catalog.json'),
    fixtures: readJson('evals/fixtures/catalog.json'),
    repoRoot: REPO_ROOT,
  };
}

function increment(record, key) {
  record[key] = (record[key] ?? 0) + 1;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

export function validateEvalManifest(data = loadEvalManifest()) {
  const errors = [];
  const graderIds = new Set();
  const fixtureIds = new Set();

  for (const grader of data.graders) {
    if (typeof grader.id !== 'string' || !grader.id) errors.push('grader id must be non-empty');
    if (graderIds.has(grader.id)) errors.push(`duplicate grader id: ${grader.id}`);
    graderIds.add(grader.id);
    if (!['planned', 'runnable'].includes(grader.status)) {
      errors.push(`grader ${grader.id} has invalid status: ${grader.status}`);
    }
    if (typeof grader.description !== 'string' || grader.description.length < 10) {
      errors.push(`grader ${grader.id} needs a useful description`);
    }
  }

  for (const fixture of data.fixtures) {
    if (typeof fixture.id !== 'string' || !fixture.id) errors.push('fixture id must be non-empty');
    if (fixtureIds.has(fixture.id)) errors.push(`duplicate fixture id: ${fixture.id}`);
    fixtureIds.add(fixture.id);
    if (typeof fixture.file !== 'string' || !fixture.file) {
      errors.push(`fixture ${fixture.id} has no file`);
    } else if (!existsSync(path.join(data.repoRoot, fixture.file))) {
      errors.push(`fixture ${fixture.id} file does not exist: ${fixture.file}`);
    }
  }

  const taskIds = new Set();
  const bySplit = {};
  const byCategory = {};
  let runnable = 0;
  let planned = 0;

  for (const task of data.tasks) {
    if (typeof task.id !== 'string' || !task.id) errors.push('task id must be non-empty');
    if (taskIds.has(task.id)) errors.push(`duplicate task id: ${task.id}`);
    taskIds.add(task.id);

    if (!['dev', 'heldout'].includes(task.split)) {
      errors.push(`task ${task.id} has invalid split: ${task.split}`);
    } else {
      increment(bySplit, task.split);
    }
    if (!EVAL_CATEGORIES.includes(task.category)) {
      errors.push(`task ${task.id} has invalid category: ${task.category}`);
    } else {
      increment(byCategory, task.category);
    }
    if (!['planned', 'runnable'].includes(task.status)) {
      errors.push(`task ${task.id} has invalid status: ${task.status}`);
    } else if (task.status === 'runnable') {
      runnable += 1;
    } else {
      planned += 1;
    }

    if (typeof task.prompt !== 'string' || task.prompt.length < 30) {
      errors.push(`task ${task.id} needs a realistic prompt`);
    }
    if (typeof task.oracleWorkflow !== 'string' || !task.oracleWorkflow) {
      errors.push(`task ${task.id} has no oracleWorkflow`);
    }
    if (!Array.isArray(task.fixtureRefs)) {
      errors.push(`task ${task.id} fixtureRefs must be an array`);
    } else {
      for (const fixtureRef of task.fixtureRefs) {
        if (!fixtureIds.has(fixtureRef)) errors.push(`task ${task.id} references unknown fixture: ${fixtureRef}`);
      }
    }
    if (!Array.isArray(task.graderRefs) || task.graderRefs.length === 0) {
      errors.push(`task ${task.id} needs graderRefs`);
    } else {
      for (const graderRef of task.graderRefs) {
        if (!graderIds.has(graderRef)) errors.push(`task ${task.id} references unknown grader: ${graderRef}`);
      }
      if (!task.graderRefs.includes('budget')) errors.push(`task ${task.id} must include budget grader`);
    }
    if (!Array.isArray(task.expectedOutcomes) || task.expectedOutcomes.length === 0) {
      errors.push(`task ${task.id} needs outcome-based assertions`);
    }
    if (!task.budget || !positiveInteger(task.budget.maxToolCalls)
      || !positiveInteger(task.budget.maxResultBytes)
      || !positiveInteger(task.budget.maxDurationMs)) {
      errors.push(`task ${task.id} has invalid budget`);
    }
  }

  if (data.tasks.length !== EXPECTED_EVAL_COUNTS.total) {
    errors.push(`expected ${EXPECTED_EVAL_COUNTS.total} tasks, got ${data.tasks.length}`);
  }
  for (const [split, count] of Object.entries(EXPECTED_EVAL_COUNTS.splits)) {
    if (bySplit[split] !== count) errors.push(`expected ${count} ${split} tasks, got ${bySplit[split] ?? 0}`);
  }
  for (const [category, count] of Object.entries(EXPECTED_EVAL_COUNTS.categories)) {
    if (byCategory[category] !== count) {
      errors.push(`expected ${count} ${category} tasks, got ${byCategory[category] ?? 0}`);
    }
  }

  if (errors.length) {
    throw new Error(`Invalid eval manifest:\n- ${errors.join('\n- ')}`);
  }

  return {
    total: data.tasks.length,
    bySplit,
    byCategory,
    runnable,
    planned,
    graderCount: graderIds.size,
    fixtureCount: fixtureIds.size,
  };
}
