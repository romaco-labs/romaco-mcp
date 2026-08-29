function copy(value) {
  return structuredClone(value);
}

function identityMatches(actual, expected) {
  if (!expected) return true;
  return ['chartId', 'symbol', 'timeframe', 'datasetId'].every(
    (key) => expected[key] === undefined || actual[key] === expected[key],
  );
}

/** In-memory implementation of current MarketDataPort runtime contract. */
export class FixtureMarketDataPort {
  constructor(fixtures = new Map()) {
    this.fixtures = fixtures;
    this.calls = [];
  }

  key(request) {
    return `${request.source}:${request.symbol}:${request.timeframe}`;
  }

  async load(request) {
    this.calls.push(copy(request));
    if (request.source === 'raw' && Array.isArray(request.rawCandles)) {
      return {
        source: 'raw',
        symbol: request.symbol,
        timeframe: request.timeframe,
        candles: copy(request.rawCandles),
        fetchedAt: 0,
      };
    }
    const fixture = this.fixtures.get(this.key(request));
    if (!fixture) throw new Error(`No market-data fixture for ${this.key(request)}`);
    if (fixture.error) throw fixture.error;
    return copy(fixture);
  }
}

/** In-memory implementation of current AnalysisGatewayPort runtime contract. */
export class FakeAnalysisGatewayPort {
  constructor({ enabled = false, response = null, error = null } = {}) {
    this.isEnabled = enabled;
    this.response = response;
    this.error = error;
    this.calls = [];
  }

  enabled() {
    return this.isEnabled;
  }

  async analyze(dataset) {
    this.calls.push(copy(dataset));
    if (this.error) throw this.error;
    if (!this.response) throw new Error('No fake gateway response configured.');
    return copy(this.response);
  }
}

/**
 * Stateful ChartPort fake. Supports current command algebra and atomic drawing
 * replacement. It does not emulate rendering, policy, or indicator math.
 */
export class FakeChartPort {
  constructor({
    identity,
    connected = true,
    visibleCandles = [],
    drawings = [],
    indicators = [],
    alerts = [],
    snapshotDataUrl = 'data:image/png;base64,ZmFrZQ==',
    fault = null,
    rawContext = {},
  }) {
    this.identity = copy(identity);
    this.connected = connected;
    this.visibleCandles = copy(visibleCandles);
    this.drawings = copy(drawings);
    this.indicators = copy(indicators);
    this.alerts = copy(alerts);
    this.paperPositions = [];
    this.snapshotDataUrl = snapshotDataUrl;
    this.fault = fault;
    this.rawContext = copy(rawContext);
    this.calls = [];
    this.counter = 0;
    this.idempotency = new Map();
  }

  nextId(prefix) {
    this.counter += 1;
    return `${prefix}_${this.counter}`;
  }

  isConnected() {
    return this.connected;
  }

  async getIdentity() {
    return copy(this.identity);
  }

  async getContext({ includeCandles = false } = {}) {
    this.calls.push({ operation: 'getContext', includeCandles });
    return {
      identity: copy(this.identity),
      ...(includeCandles ? { visibleCandles: copy(this.visibleCandles) } : {}),
      raw: {
        ...copy(this.rawContext),
        existingIndicators: copy(this.indicators),
        existingDrawings: copy(this.drawings),
        alerts: copy(this.alerts),
        paperPositions: copy(this.paperPositions),
      },
    };
  }

  async execute(command, options = {}) {
    this.calls.push({ operation: 'execute', command: copy(command), options: copy(options) });
    if (!this.connected) return { success: false, error: 'CHART_NOT_CONNECTED' };
    if (!identityMatches(this.identity, options.expectedIdentity)) {
      return { success: false, error: 'CHART_CONTEXT_MISMATCH' };
    }

    switch (command.action) {
      case 'addIndicator': {
        const id = this.nextId('indicator');
        this.indicators.push({ id, type: command.indicatorType, params: command.params ?? [] });
        return { success: true, data: { id }, resourceIds: [id] };
      }
      case 'removeIndicator': {
        const before = this.indicators.length;
        this.indicators = this.indicators.filter((item) => item.id !== command.indicatorId);
        return { success: true, data: { removed: before !== this.indicators.length } };
      }
      case 'addDrawing': {
        const id = this.nextId('drawing');
        this.drawings.push({ id, owner: 'romaco', ...copy(command) });
        return { success: true, data: { id }, resourceIds: [id] };
      }
      case 'removeDrawingsByGroup': {
        const before = this.drawings.length;
        this.drawings = this.drawings.filter((item) => item.groupId !== command.groupId);
        return { success: true, data: { removedCount: before - this.drawings.length } };
      }
      case 'clearDrawings': {
        const removedCount = this.drawings.length;
        this.drawings = [];
        return { success: true, data: { removedCount } };
      }
      case 'addAlert': {
        const id = this.nextId('alert');
        this.alerts.push({ id, ...copy(command) });
        return { success: true, data: { id }, resourceIds: [id] };
      }
      case 'removeAlert': {
        const before = this.alerts.length;
        this.alerts = this.alerts.filter((item) => item.id !== command.alertId);
        return { success: true, data: { removed: before !== this.alerts.length } };
      }
      case 'clearAlerts': {
        const removedCount = this.alerts.length;
        this.alerts = [];
        return { success: true, data: { removedCount } };
      }
      case 'openPaperLong':
      case 'openPaperShort': {
        const id = this.nextId('paper');
        this.paperPositions.push({ id, ...copy(command) });
        return { success: true, data: { id }, resourceIds: [id] };
      }
      case 'listPanes':
        return { success: true, data: [{ id: 'main', alias: 'main', indicators: copy(this.indicators) }] };
      case 'getIndicatorValues':
        return { success: true, data: { indicatorId: command.indicatorId, series: [] } };
      default:
        return { success: true, data: {} };
    }
  }

  async replaceDrawingGroup(command) {
    this.calls.push({ operation: 'replaceDrawingGroup', command: copy(command) });
    if (!this.connected) return { success: false, error: 'CHART_NOT_CONNECTED' };
    if (!identityMatches(this.identity, command.expectedIdentity)) {
      return { success: false, error: 'CHART_CONTEXT_MISMATCH' };
    }

    const canonical = JSON.stringify(command);
    const prior = this.idempotency.get(command.idempotencyKey);
    if (prior) {
      if (prior.canonical !== canonical) return { success: false, error: 'IDEMPOTENCY_CONFLICT' };
      return copy(prior.result);
    }
    if (this.fault?.operation === 'replaceDrawingGroup') {
      return { success: false, error: this.fault.errorCode ?? 'BRIDGE_DISCONNECTED' };
    }

    const retained = this.drawings.filter((item) => item.groupId !== command.groupId);
    const added = command.drawings.map((drawing) => ({
      id: this.nextId('drawing'),
      owner: 'romaco',
      ...copy(drawing),
      groupId: command.groupId,
    }));
    this.drawings = [...retained, ...added];
    const result = { success: true, resourceIds: added.map((item) => item.id) };
    this.idempotency.set(command.idempotencyKey, { canonical, result: copy(result) });
    return result;
  }

  async captureSnapshot(format) {
    this.calls.push({ operation: 'captureSnapshot', format });
    if (!this.connected) throw new Error('CHART_NOT_CONNECTED');
    return { format, dataUrl: this.snapshotDataUrl.replace('image/png', `image/${format}`) };
  }

  state() {
    return copy({
      identity: this.identity,
      drawings: this.drawings,
      indicators: this.indicators,
      alerts: this.alerts,
      paperPositions: this.paperPositions,
    });
  }
}

export class MemoryTelemetrySink {
  constructor() {
    this.events = [];
  }

  record(event) {
    this.events.push(copy(event));
  }
}
