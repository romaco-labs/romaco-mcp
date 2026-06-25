import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { TradingTerminal, McpBridge, type TradingTerminalRef } from 'romaco-charts/react';
import type { CandleData } from 'romaco-charts';
import { loadYahooCandles } from './utils/yahoo';
import { computeVolStats, type VolStats } from './utils/vol';

// The wildest tape on the market. These names gap, squeeze and reverse hard —
// exactly the regime where ATR-filtered pattern detection earns its keep.
const SYMBOLS = ['MSTR', 'TSLA', 'COIN', 'NVDA', 'SMCI', 'MARA', 'PLTR', 'GME'];

const SCAN_PROMPT =
  'run thesis_batch on MSTR and TSLA — scan harmonics, gaps, and M/W reversals on the winner';

function symbolFromUrl(): string {
  const s = new URLSearchParams(window.location.search).get('symbol');
  return s ? s.toUpperCase() : 'MSTR';
}

export default function App() {
  const [symbol, setSymbol] = useState(symbolFromUrl);
  const [data, setData] = useState<CandleData[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const terminalRef = useRef<TradingTerminalRef | null>(null);
  const [connected, setConnected] = useState(false);
  // True while the agent is injecting drawings — drives the blur + glow
  // "operating room" treatment (see style.css .chart-stage.processing).
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setLoadError(null);
    loadYahooCandles(symbol)
      .then((candles) => { if (!cancelled) setData(candles); })
      .catch((err) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [symbol]);

  const vol: VolStats | null = useMemo(
    () => (data && data.length > 20 ? computeVolStats(data) : null),
    [data],
  );

  const switchSymbol = useCallback((s: string) => {
    setSymbol(s);
    const url = new URL(window.location.href);
    url.searchParams.set('symbol', s);
    window.history.replaceState(null, '', url);
  }, []);

  // Stable callbacks. The McpBridge effect re-runs whenever these change, so
  // inline arrows would tear down + re-open the WebSocket on every render.
  const onConnect = useCallback(() => setConnected(true), []);
  const onDisconnect = useCallback(() => setConnected(false), []);
  const onProcessingChange = useCallback((p: boolean) => setProcessing(p), []);

  return (
    <div style={shell}>
      <header style={headerStyle}>
        <span style={brandStyle}>
          ROMACO <span style={{ color: '#ff5c38' }}>·</span> PRO VOLATILITY SCANNER
        </span>
        <span style={tagStyle}>XABCD · GAPS · M/W · ATR-FILTERED</span>
        <span style={bridgePillStyle(connected)}>
          {connected ? '● MCP BRIDGE LIVE' : '○ MCP BRIDGE WAITING'}
        </span>
      </header>

      <div style={body}>
        <aside style={rail}>
          <div style={railHead}>WATCHLIST</div>
          {SYMBOLS.map((s) => (
            <button key={s} onClick={() => switchSymbol(s)} style={railRow(s === symbol)}>
              <span style={{ fontWeight: 600 }}>{s}</span>
              <span style={{ color: '#ff5c38', fontSize: 9, letterSpacing: 1 }}>HIVOL</span>
            </button>
          ))}
          <div style={{ ...railHead, marginTop: 18 }}>LIVE METRICS</div>
          <Metric label="LAST" value={vol ? fmt(vol.last) : '—'} />
          <Metric
            label="DAY Δ"
            value={vol ? `${vol.dayChangePct >= 0 ? '+' : ''}${vol.dayChangePct.toFixed(2)}%` : '—'}
            tone={vol ? (vol.dayChangePct >= 0 ? 'up' : 'down') : undefined}
          />
          <Metric label="ATR(14)" value={vol ? fmt(vol.atr) : '—'} />
          <Metric label="ATR %" value={vol ? `${vol.atrPct.toFixed(2)}%` : '—'} tone="hot" />
          <Metric label="RV 20d ann." value={vol ? `${vol.realizedVol.toFixed(0)}%` : '—'} tone="hot" />
        </aside>

        <div className={`chart-stage${processing ? ' processing' : ''}`} style={{ flex: 1, minWidth: 0 }}>
          <div className="chart-blur-layer">
            {data && <TradingTerminal ref={terminalRef} data={data} symbol={symbol} />}
            {!data && !loadError && <div style={centerNote}>loading {symbol} daily candles…</div>}
            {loadError && <div style={{ ...centerNote, color: '#f87171' }}>{loadError}</div>}
          </div>
          <div className="chart-glow" aria-hidden />
          <div className="chart-working-chip" aria-hidden>
            <span className="dot" />PATTERN ENGINE v2 — INJECTING LAYERS
          </div>
          <div className="chart-scanline" aria-hidden />
          <McpBridge
            chartRef={terminalRef}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            onProcessingChange={onProcessingChange}
          />
        </div>
      </div>

      <footer style={footerStyle}>
        <span style={{ color: '#6b6b6b' }}>SCAN&nbsp;</span>
        <span style={{ color: '#ff5c38' }}>›</span>&nbsp;{SCAN_PROMPT}
        <span style={{ marginLeft: 'auto', color: '#6b6b6b' }}>
          ⚠ Not investment advice — educational purposes only
        </span>
      </footer>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' | 'hot' }) {
  const color =
    tone === 'up' ? '#22c55e' : tone === 'down' ? '#f87171' : tone === 'hot' ? '#ff5c38' : '#e8e4d8';
  return (
    <div style={metricRow}>
      <span style={{ color: '#6b6b6b', fontSize: 10, letterSpacing: 1 }}>{label}</span>
      <span style={{ color, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

function fmt(n: number): string {
  return n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : n.toFixed(2);
}

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const shell: CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  background: '#050505',
};

const body: CSSProperties = { flex: 1, minHeight: 0, display: 'flex' };

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '10px 16px',
  borderBottom: '1px solid #1d1d1d',
  background: '#0a0a0a',
  fontFamily: MONO,
  zIndex: 10,
};

const brandStyle: CSSProperties = {
  fontSize: 13,
  letterSpacing: 3,
  color: '#e8e4d8',
  whiteSpace: 'nowrap',
};

const tagStyle: CSSProperties = {
  fontFamily: MONO,
  fontSize: 10,
  letterSpacing: 2,
  color: '#6b6b6b',
  whiteSpace: 'nowrap',
};

const rail: CSSProperties = {
  width: 180,
  flexShrink: 0,
  borderRight: '1px solid #1d1d1d',
  background: '#080808',
  padding: '12px 10px',
  fontFamily: MONO,
  overflowY: 'auto',
};

const railHead: CSSProperties = {
  fontSize: 9,
  letterSpacing: 2,
  color: '#6b6b6b',
  marginBottom: 8,
};

function railRow(active: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: '7px 10px',
    marginBottom: 4,
    fontFamily: MONO,
    fontSize: 12,
    cursor: 'pointer',
    color: active ? '#0a0a0a' : '#c9c9c9',
    background: active ? '#ff5c38' : 'transparent',
    border: `1px solid ${active ? '#ff5c38' : '#1d1d1d'}`,
    borderRadius: 2,
  };
}

const metricRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '5px 10px',
  fontFamily: MONO,
};

const bridgePillStyle = (connected: boolean): CSSProperties => ({
  fontFamily: MONO,
  fontSize: 10,
  letterSpacing: 1.5,
  whiteSpace: 'nowrap',
  padding: '5px 10px',
  borderRadius: 2,
  color: connected ? '#22c55e' : '#6b6b6b',
  border: `1px solid ${connected ? 'rgba(34,197,94,0.45)' : '#2a2a2a'}`,
  background: connected ? 'rgba(34,197,94,0.1)' : 'transparent',
});

const footerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '8px 16px',
  borderTop: '1px solid #1d1d1d',
  background: '#0a0a0a',
  fontFamily: MONO,
  fontSize: 11,
  color: '#e8e4d8',
  zIndex: 10,
};

const centerNote: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: MONO,
  fontSize: 12,
  color: '#6b6b6b',
};
