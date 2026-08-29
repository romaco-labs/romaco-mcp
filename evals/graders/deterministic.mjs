function structured(call) {
  return call?.result?.structuredContent ?? call?.structuredContent;
}

function pass(message) {
  return { passed: true, message };
}

function fail(message) {
  return { passed: false, message };
}

function numbers(value, output = []) {
  if (typeof value === 'number' && Number.isFinite(value)) output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => numbers(item, output));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => numbers(item, output));
  return output;
}

function contractGrader(_task, trial) {
  const invalid = trial.calls.find((call) => {
    const result = call.result;
    const envelope = structured(call);
    const hasText = result.content?.some((block) => block.type === 'text');
    const shape = envelope
      && ['ok', 'noop', 'partial', 'error'].includes(envelope.status)
      && Array.isArray(envelope.warnings)
      && envelope.context && typeof envelope.context === 'object';
    const errorConsistent = result.isError
      ? envelope?.status === 'error' && envelope.error && envelope.data === null
      : envelope?.status !== 'error' && envelope.error === null && envelope.data;
    return !hasText || !shape || !errorConsistent;
  });
  return invalid ? fail(`invalid MCP envelope from ${invalid.name}`) : pass('all calls use dual MCP contracts');
}

function budgetGrader(task, trial) {
  const totalDuration = trial.calls.reduce((sum, call) => sum + call.durationMs, 0);
  const largestResult = Math.max(0, ...trial.calls.map((call) => call.resultBytes));
  if (trial.calls.length > task.budget.maxToolCalls) {
    return fail(`${trial.calls.length} calls exceeds ${task.budget.maxToolCalls}`);
  }
  if (largestResult > task.budget.maxResultBytes) {
    return fail(`${largestResult} bytes exceeds ${task.budget.maxResultBytes}`);
  }
  if (totalDuration > task.budget.maxDurationMs) {
    return fail(`${totalDuration.toFixed(1)}ms exceeds ${task.budget.maxDurationMs}ms`);
  }
  return pass('call, result-size, and duration budgets pass');
}

function identityGrader(task, trial) {
  for (const call of trial.calls) {
    const envelope = structured(call);
    if (!envelope || envelope.status === 'error') continue;
    const data = envelope.data;
    const datasetId = data?.dataset?.datasetId ?? data?.datasetId;
    const analysisId = data?.analysisId;
    const chartId = data?.chartId ?? data?.preset?.chartId;
    if (datasetId && envelope.context.datasetId && datasetId !== envelope.context.datasetId) {
      return fail(`${call.name} datasetId drift`);
    }
    if (analysisId && envelope.context.analysisId && analysisId !== envelope.context.analysisId) {
      return fail(`${call.name} analysisId drift`);
    }
    if (chartId && envelope.context.chartId && chartId !== envelope.context.chartId) {
      return fail(`${call.name} chartId drift`);
    }
  }
  if (task.id === 'L06_cross_symbol_block') {
    const error = structured(trial.facts.annotate).error;
    if (error.code !== 'CHART_CONTEXT_MISMATCH') return fail('cross-symbol error code drift');
  }
  if (task.id === 'S05_explicit_dataset_race') {
    const facts = trial.facts;
    if (
      facts.explicitA.analysisId !== facts.a.analysisId
      || facts.explicitA.datasetId !== facts.a.datasetId
      || facts.activeBefore.analysisId !== facts.b.analysisId
      || facts.activeBefore.datasetId !== facts.b.datasetId
      || facts.activeAfter.analysisId !== facts.b.analysisId
      || facts.activeAfter.datasetId !== facts.b.datasetId
    ) {
      return fail('explicit A resolution drifted or mutated active B identity');
    }
  }
  return pass('identity references remain correlated');
}

function terminalStateGrader(task, trial) {
  if (task.id === 'H02_headless_setup' && trial.chartState.indicators.length !== 0) {
    return fail('headless setup wrote indicators');
  }
  if (task.id === 'L01_setup_identity') {
    const data = structured(trial.facts.setup).data;
    if (data.preset.liveStatus !== 'matched' || trial.chartState.indicators.length !== 2) {
      return fail('matched preset did not create exactly two indicators');
    }
  }
  if (task.id === 'L05_annotate_atomic' || task.id === 'S04_group_preserves_user_state') {
    const retry = structured(trial.facts.retry).data;
    const owned = trial.chartState.drawings.filter((drawing) => drawing.groupId === retry.groupId);
    const user = trial.chartState.drawings.find((drawing) => drawing.id === trial.facts.userDrawingId);
    const journal = trial.journal.groups[retry.groupId];
    if (
      !user
      || owned.length !== retry.drawingCount
      || journal?.drawings?.length !== retry.drawingCount
      || journal?.identity?.symbol !== 'AAPL'
      || journal?.identity?.timeframe !== '1d'
      || journal?.idempotencyKey !== retry.idempotencyKey
      || JSON.stringify(journal?.resourceIds) !== JSON.stringify(retry.drawingIds)
    ) {
      return fail('atomic retry duplicated group or removed user drawing');
    }
  }
  if (task.id === 'S05_explicit_dataset_race') {
    const facts = trial.facts;
    if (
      facts.activeBefore.analysisId !== facts.activeAfter.analysisId
      || facts.activeBefore.datasetId !== facts.activeAfter.datasetId
    ) {
      return fail('explicit artifact lookup mutated active B state');
    }
  }
  return pass('terminal fake-port state matches outcome');
}

function financialGrader(task, trial) {
  if (task.id === 'H05_flat_stand_aside') {
    const thesis = structured(trial.facts.thesis).data.thesis;
    return thesis.verdict === 'stand_aside' && thesis.setup === null
      ? pass('flat market stands aside without setup')
      : fail('flat market manufactured a trade');
  }
  if (task.id === 'H08_invalid_target_side') {
    const invalid = structured(trial.facts.invalid);
    const corrected = structured(trial.facts.corrected).data;
    const directional = corrected.side === 'long'
      ? corrected.targetPrice > corrected.entryPrice
      : corrected.targetPrice < corrected.entryPrice;
    return invalid.error?.code === 'INVALID_ARGUMENT'
      && corrected.actualDollarRisk <= corrected.maxDollarRisk
      && directional
      ? pass('target side and commission-inclusive risk are valid')
      : fail('position-size invariant failed');
  }
  return pass('no additional financial invariant for task');
}

function recoveryGrader(_task, trial) {
  const errors = trial.calls.map(structured).filter((value) => value?.status === 'error');
  if (!errors.length) return fail('task expected a recoverable error');
  return errors.every((value) => value.error?.code && value.error?.recovery?.instruction)
    ? pass('errors include stable codes and recovery instructions')
    : fail('error recovery contract missing');
}

function safetyGrader(task, trial) {
  if (task.id === 'H05_flat_stand_aside') {
    return trial.chartState.drawings.length === 0
      ? pass('stand-aside workflow performs zero writes')
      : fail('stand-aside workflow wrote drawings');
  }
  if (task.id === 'L05_annotate_atomic' || task.id === 'S04_group_preserves_user_state') {
    return trial.chartState.drawings.some((drawing) => drawing.id === trial.facts.userDrawingId)
      ? pass('user drawing survives owned-group replacement')
      : fail('user drawing was removed');
  }
  if (task.id === 'L06_cross_symbol_block') {
    return trial.facts.writeDelta === 0
      ? pass('cross-symbol workflow performs zero drawing writes')
      : fail('cross-symbol workflow wrote to chart');
  }
  return pass('no unsafe write observed');
}

function traceGrader(_task, trial) {
  if (trial.telemetry.length !== trial.calls.length) {
    return fail(`${trial.telemetry.length} trace events for ${trial.calls.length} calls`);
  }
  const valid = trial.telemetry.every((event) =>
    /^[0-9a-f]{32}$/.test(event.traceId)
      && event.event === 'mcp.tool'
      && !JSON.stringify(event).match(/fixture-token-must-never-appear|Bearer\s/i),
  );
  return valid ? pass('one redacted trace event per tool call') : fail('trace identity or redaction failed');
}

const ALLOWED_TOOLS = {
  H03_missing_session_recovery: new Set(['romaco_thesis', 'romaco_setup_chart']),
  L02_context_cost_gate: new Set(['romaco_get_chart_context']),
};

function toolPolicyGrader(task, trial) {
  const allowed = ALLOWED_TOOLS[task.id];
  if (!allowed) return pass('task has no additional tool restriction');
  const invalid = trial.calls.find((call) => !allowed.has(call.name));
  return invalid ? fail(`unexpected tool ${invalid.name}`) : pass('only allowed capabilities were used');
}

function evidenceConformanceGrader(_task, trial) {
  const evidence = trial.calls.flatMap((call) => numbers(structured(call)?.data));
  if (!trial.evidenceNumbers.length) return fail('trial declared no numeric evidence to check');
  const unsupported = trial.evidenceNumbers.find((declared) =>
    !evidence.some(
      (candidate) => Math.abs(candidate - declared) <= Math.max(1e-8, Math.abs(declared) * 1e-8),
    ),
  );
  return unsupported === undefined
    ? pass('all declared numeric evidence exists in structured tool output')
    : fail(`declared numeric evidence is absent from tool output: ${unsupported}`);
}

export const DETERMINISTIC_GRADERS = new Map([
  ['contract', contractGrader],
  ['terminal-state', terminalStateGrader],
  ['financial-invariants', financialGrader],
  ['safety', safetyGrader],
  ['evidence-conformance', evidenceConformanceGrader],
  ['trace', traceGrader],
  ['budget', budgetGrader],
  ['tool-policy', toolPolicyGrader],
  ['identity', identityGrader],
  ['recovery', recoveryGrader],
]);
