import { createHash } from 'node:crypto';

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
  if (task.id === 'H09_batch_partial_failure') {
    const data = structured(trial.facts.batch).data;
    if (
      data.items.length !== 2
      || data.failures.length !== 1
      || data.failures[0].symbol !== 'MISSING'
      || data.sessionDatasetId !== data.top.datasetId
      || trial.facts.activeDatasetId !== data.top.datasetId
      || trial.facts.activeAnalysisId !== data.top.analysisId
      || trial.facts.projectedDatasetId !== data.top.datasetId
    ) {
      return fail('batch top identity or partial-success correlation drifted');
    }
  }
  if (task.id === 'S01_reconnect_symbol_scope') {
    const desired = trial.facts.desiredAfter;
    const entries = [...desired.drawings, ...desired.alerts];
    if (
      entries.length !== 2
      || entries.some((entry) =>
        entry.identity.chartId !== 'chart_aapl'
        || entry.identity.symbol !== 'AAPL'
        || entry.identity.timeframe !== '1d'
      )
      || trial.facts.reconcile.skippedIdentity !== 2
    ) {
      return fail('cross-symbol reconnect lost exact AAPL attribution');
    }
  }
  if (task.id === 'S02_removed_indicator_stays_removed') {
    const refreshed = trial.facts.desiredAfterRefresh.indicators[0];
    const removed = structured(trial.facts.removed).data;
    if (
      refreshed?.resourceIds?.[0] !== trial.facts.refreshedId
      || trial.facts.refreshedId === trial.facts.originalId
      || removed.indicatorId !== trial.facts.refreshedId
      || removed.type !== 'RSI'
    ) {
      return fail('indicator reconnect did not refresh or remove exact host ID');
    }
  }
  if (task.id === 'S03_removed_alert_stays_removed') {
    const refreshed = trial.facts.desiredAfterRefresh.alerts[0];
    const removed = structured(trial.facts.removed).data;
    if (
      refreshed?.resourceIds?.[0] !== trial.facts.refreshedId
      || trial.facts.refreshedId === trial.facts.originalId
      || removed.alertId !== trial.facts.refreshedId
      || removed.direction !== 'above'
    ) {
      return fail('alert reconnect did not refresh or remove exact host ID');
    }
  }
  if (task.id === 'L07_pattern_replace') {
    const replacements = trial.chartCalls.filter((call) => call.operation === 'replaceDrawingGroup');
    const invalid = replacements.find((call) =>
      call.operation === 'replaceDrawingGroup'
      && (
        call.command.expectedIdentity?.chartId !== 'chart_aapl'
        || call.command.expectedIdentity?.symbol !== 'AAPL'
        || call.command.expectedIdentity?.timeframe !== '1h'
      )
    );
    if (invalid || replacements.length !== 2) return fail('pattern replacement lost exact chart identity');
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
  if (task.id === 'L03_indicator_id_chain') {
    const added = structured(trial.facts.added).data.indicator;
    const values = structured(trial.facts.values).data;
    const read = trial.chartCalls.find(
      (call) => call.operation === 'execute' && call.command.action === 'getIndicatorValues',
    );
    const journal = trial.journal.indicators;
    if (
      trial.chartState.indicators.length !== 1
      || trial.chartState.indicators[0].id !== added.indicatorId
      || values.indicatorId !== added.indicatorId
      || read?.command.indicatorId !== added.indicatorId
      || journal.length !== 1
      || journal[0].resourceId !== added.indicatorId
    ) {
      return fail('indicator add/read chain drifted from returned host ID');
    }
  }
  if (task.id === 'L04_drawing_validation') {
    const invalid = structured(trial.facts.invalid);
    const valid = structured(trial.facts.valid).data;
    const hostDrawing = trial.chartState.drawings.find((drawing) => drawing.id === valid.drawingId);
    const journal = trial.journal.drawings;
    if (
      invalid.error?.code !== 'INVALID_ARGUMENT'
      || trial.facts.writesAfterInvalid !== 0
      || trial.facts.writesAfterValid !== 1
      || valid.drawing.type !== 'fibRetracement'
      || valid.drawing.pointCount !== 2
      || !valid.drawingId
      || !hostDrawing
      || journal.length !== 1
      || journal[0].resourceId !== valid.drawingId
    ) {
      return fail('drawing validation wrote malformed input or lost valid drawing identity');
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
  if (task.id === 'A01_annotate_approval') {
    const approved = structured(trial.facts.approved).data;
    const owned = trial.chartState.drawings.filter((drawing) => drawing.groupId === approved.groupId);
    if (owned.length !== approved.drawingCount) {
      return fail('approved annotation terminal state does not match structured result');
    }
  }
  if (task.id === 'A02_clear_preview_apply') {
    const preview = structured(trial.facts.preview);
    const applied = structured(trial.facts.applied).data;
    const replay = structured(trial.facts.replay);
    const user = trial.chartState.drawings.find((drawing) => drawing.id === trial.facts.userDrawingId);
    const owned = trial.chartState.drawings.filter((drawing) => drawing.groupId === trial.facts.groupId);
    if (
      preview.error?.code !== 'APPROVAL_REQUIRED'
      || applied.removedCount !== trial.facts.expectedRemovedCount
      || JSON.stringify(applied.groupIds) !== JSON.stringify([trial.facts.groupId])
      || replay.error?.code !== 'APPROVAL_INVALID'
      || !user
      || owned.length !== 0
      || trial.journal.groups[trial.facts.groupId] !== undefined
    ) {
      return fail('clear preview/apply/replay terminal state drifted');
    }
  }
  if (task.id === 'A03_paper_idempotency') {
    const opened = structured(trial.facts.opened).data;
    const replay = structured(trial.facts.replay).data;
    const changed = structured(trial.facts.changed);
    if (
      opened.replayed !== false
      || replay.replayed !== true
      || opened.idempotencyKey !== replay.idempotencyKey
      || JSON.stringify(opened.position) !== JSON.stringify(replay.position)
      || changed.error?.code !== 'IDEMPOTENCY_CONFLICT'
      || trial.chartState.paperPositions.length !== 1
      || trial.chartState.paperPositions[0].id !== opened.position.hostPositionId
    ) {
      return fail('paper receipt replay, conflict, or terminal position state drifted');
    }
  }
  if (task.id === 'S01_reconnect_symbol_scope') {
    if (
      trial.facts.reconcile.status !== 'reconciled'
      || trial.facts.reconcile.applied !== 0
      || trial.chartState.drawings.length !== 0
      || trial.chartState.alerts.length !== 0
      || JSON.stringify(trial.facts.desiredAfter) !== JSON.stringify(trial.facts.desiredBefore)
    ) {
      return fail('cross-symbol reconnect mutated host or desired state');
    }
  }
  if (task.id === 'S02_removed_indicator_stays_removed') {
    if (
      trial.facts.refreshed.applied !== 1
      || trial.facts.writesAfterRefresh !== trial.facts.writesBeforeRefresh + 1
      || trial.facts.writesAfterRemove !== trial.facts.writesBeforeRefresh + 2
      || trial.facts.finalReconnect.status !== 'empty'
      || trial.facts.writesAfterFinalReconnect !== trial.facts.writesAfterRemove
      || trial.facts.finalDesired.indicators.length !== 0
      || trial.chartState.indicators.length !== 0
    ) {
      return fail('removed indicator returned or caused reconnect write');
    }
  }
  if (task.id === 'S03_removed_alert_stays_removed') {
    if (
      trial.facts.refreshed.applied !== 1
      || trial.facts.writesAfterRefresh !== trial.facts.writesBeforeRefresh + 1
      || trial.facts.writesAfterRemove !== trial.facts.writesBeforeRefresh + 2
      || trial.facts.finalReconnect.status !== 'empty'
      || trial.facts.writesAfterFinalReconnect !== trial.facts.writesAfterRemove
      || trial.facts.finalDesired.alerts.length !== 0
      || trial.chartState.alerts.length !== 0
    ) {
      return fail('removed alert returned or caused reconnect write');
    }
  }
  if (task.id === 'L07_pattern_replace') {
    const owned = trial.chartState.drawings.filter(
      (drawing) => drawing.groupId === trial.facts.expectedGroupId,
    );
    const user = trial.chartState.drawings.find(
      (drawing) => drawing.id === trial.facts.userDrawingId,
    );
    if (!user || owned.length === 0) {
      return fail('pattern replacement removed user state or produced no owned geometry');
    }
    const groupIds = new Set(owned.map((drawing) => drawing.groupId));
    if (groupIds.size !== 1) return fail('pattern geometry escaped its owned family group');
  }
  if (task.id === 'D02_atomic_disconnect') {
    const failed = structured(trial.facts.failed);
    const recovered = structured(trial.facts.recovered).data;
    const partialOwned = trial.facts.stateAfterFailure.drawings.filter(
      (drawing) => drawing.groupId === 'romaco-mcp/thesis',
    );
    const finalOwned = trial.chartState.drawings.filter(
      (drawing) => drawing.groupId === recovered.groupId,
    );
    const journal = trial.journal.groups[recovered.groupId];
    if (
      failed.error?.code !== 'CHART_NOT_CONNECTED'
      || partialOwned.length !== 0
      || Object.keys(trial.facts.journalAfterFailure).length !== 0
      || finalOwned.length !== recovered.drawingCount
      || journal?.drawings?.length !== recovered.drawingCount
      || JSON.stringify(journal?.resourceIds) !== JSON.stringify(recovered.drawingIds)
    ) {
      return fail('disconnect left partial state, false journal state, or duplicate recovery state');
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
  if (task.id === 'H09_batch_partial_failure') {
    const items = structured(trial.facts.batch).data.items;
    const ordered = items.every((item, index) => index === 0 || items[index - 1].score >= item.score);
    const valid = items.every((item) => {
      if (!item.setup) return item.score === 0;
      const directional = item.verdict === 'long'
        ? item.setup.stop < item.setup.entry && item.setup.target > item.setup.entry
        : item.setup.stop > item.setup.entry && item.setup.target < item.setup.entry;
      const rr = Math.abs(item.setup.target - item.setup.entry) / Math.abs(item.setup.entry - item.setup.stop);
      return directional
        && Math.abs(rr - item.setup.rr) <= 0.01
        && Math.abs(item.score - item.setup.rr * item.confidence) <= 1e-8;
    });
    return ordered && valid
      ? pass('batch ranking and setup geometry recompute')
      : fail('batch ranking or financial geometry is invalid');
  }
  if (task.id === 'A03_paper_idempotency') {
    const position = structured(trial.facts.opened).data.position;
    return position.mode === 'paper'
      && position.quantity > 0
      && position.stopLoss > 0
      && position.takeProfit > position.stopLoss
      ? pass('paper-only position payload remains positive and directional')
      : fail('paper position financial fields are invalid');
  }
  if (task.id === 'S01_reconnect_symbol_scope') {
    return trial.facts.writesAfterReconnect === trial.facts.writesBeforeReconnect
      && trial.facts.reconcile.applied === 0
      ? pass('TSLA reconnect performs zero AAPL drawing or alert writes')
      : fail('cross-symbol reconnect wrote AAPL overlay state');
  }
  return pass('no additional financial invariant for task');
}

function recoveryGrader(_task, trial) {
  if (_task.id === 'H09_batch_partial_failure') {
    const failures = structured(trial.facts.batch).data.failures;
    return failures.length === 1
      && failures.every((failure) => failure.code && failure.recovery?.instruction)
      ? pass('partial batch failure is structured and recoverable')
      : fail('partial batch failure contract missing');
  }
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
    return trial.facts.writeDelta === 0 && trial.facts.challengeWriteDelta === 0
      ? pass('cross-symbol workflow performs zero drawing writes')
      : fail('cross-symbol workflow wrote to chart');
  }
  if (task.id === 'A01_annotate_approval') {
    const facts = trial.facts;
    const challengeCode = structured(facts.challenge).error?.code;
    const replayCode = structured(facts.replay).error?.code;
    return challengeCode === 'APPROVAL_REQUIRED'
      && replayCode === 'APPROVAL_INVALID'
      && facts.afterChallenge === facts.beforeWrites
      && facts.afterApproved === facts.beforeWrites + 1
      && facts.afterReplay === facts.afterApproved
      ? pass('approval is required, scoped, and single-use')
      : fail('approval challenge, apply, or replay invariant failed');
  }
  if (task.id === 'A02_clear_preview_apply') {
    const replayCode = structured(trial.facts.replay).error?.code;
    return trial.facts.afterPreview === trial.facts.beforeWrites
      && trial.facts.afterApply === trial.facts.beforeWrites + 1
      && trial.facts.afterReplay === trial.facts.afterApply
      && replayCode === 'APPROVAL_INVALID'
      && trial.chartState.drawings.some((drawing) => drawing.id === trial.facts.userDrawingId)
      ? pass('clear requires approval, applies once, and preserves user drawings')
      : fail('clear approval or user-scope invariant failed');
  }
  if (task.id === 'A03_paper_idempotency') {
    const challengeCode = structured(trial.facts.challenge).error?.code;
    const conflictCode = structured(trial.facts.changed).error?.code;
    return challengeCode === 'APPROVAL_REQUIRED'
      && conflictCode === 'IDEMPOTENCY_CONFLICT'
      && trial.facts.afterChallenge === trial.facts.beforeWrites
      && trial.facts.afterOpened === trial.facts.beforeWrites + 1
      && trial.facts.afterReplay === trial.facts.afterOpened
      && trial.facts.afterChanged === trial.facts.afterOpened
      ? pass('paper approval and idempotency permit exactly one host write')
      : fail('paper approval/idempotency write invariant failed');
  }
  if (task.id === 'L07_pattern_replace') {
    return trial.chartState.drawings.some((drawing) => drawing.id === trial.facts.userDrawingId)
      ? pass('owned pattern replacement preserves user drawing')
      : fail('owned pattern replacement removed user drawing');
  }
  if (task.id === 'D02_atomic_disconnect') {
    const userAfterFailure = trial.facts.stateAfterFailure.drawings.some(
      (drawing) => drawing.id === trial.facts.userDrawingId,
    );
    const userFinal = trial.chartState.drawings.some(
      (drawing) => drawing.id === trial.facts.userDrawingId,
    );
    return userAfterFailure && userFinal
      ? pass('disconnect and retry preserve user-owned drawing')
      : fail('disconnect recovery removed user-owned drawing');
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
  H04_pattern_cost_gate: new Set(['romaco_setup_chart', 'romaco_detect_patterns']),
  L02_context_cost_gate: new Set(['romaco_get_chart_context']),
  L08_snapshot_gate: new Set(['romaco_capture_snapshot']),
};

function toolPolicyGrader(task, trial) {
  const allowed = ALLOWED_TOOLS[task.id];
  if (!allowed) return pass('task has no additional tool restriction');
  const invalid = trial.calls.find((call) => !allowed.has(call.name));
  if (invalid) return fail(`unexpected tool ${invalid.name}`);
  if (task.id === 'H04_pattern_cost_gate') {
    const concise = structured(trial.facts.concise).data;
    const full = structured(trial.facts.full).data;
    const conciseLeaksPoints = concise.patterns.some((pattern) => 'points' in pattern);
    const fullHasAnchors = full.patterns.length > 0
      && full.patterns.every((pattern) => Array.isArray(pattern.points) && pattern.points.length > 0);
    if (
      concise.format !== 'concise'
      || full.format !== 'full'
      || concise.count !== full.count
      || concise.analysisId !== full.analysisId
      || concise.datasetId !== full.datasetId
      || conciseLeaksPoints
      || !fullHasAnchors
    ) {
      return fail('pattern cost gate leaked anchors or changed artifact identity');
    }
  }
  if (task.id === 'L08_snapshot_gate') {
    const gate = structured(trial.facts.gated);
    const captured = trial.facts.captured;
    const data = captured.structuredContent.data;
    const images = captured.content.filter((block) => block.type === 'image');
    const texts = captured.content.filter((block) => block.type === 'text');
    const bytes = images.length === 1 ? Buffer.from(images[0].data, 'base64') : Buffer.alloc(0);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const leaked = texts.some((block) => block.text?.includes(images[0]?.data ?? '__missing__'))
      || JSON.stringify(captured.structuredContent).includes(images[0]?.data ?? '__missing__');
    if (
      gate.error?.code !== 'ACK_REQUIRED'
      || trial.facts.afterGate !== trial.facts.beforeCaptures
      || trial.facts.afterCapture !== trial.facts.beforeCaptures + 1
      || images.length !== 1
      || data.format !== 'jpeg'
      || data.mimeType !== 'image/jpeg'
      || data.byteLength !== bytes.byteLength
      || data.sha256 !== digest
      || leaked
    ) {
      return fail('snapshot gate, image integrity, or compact output invariant failed');
    }
  }
  return pass('only allowed capabilities and payload gates were used');
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
