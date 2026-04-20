import { useState } from 'react';
import { localApi, type LocalRunResponse } from '../api.js';
import { FixtureSelector } from '../components/FixtureSelector.js';
import { ThreePaneViewer } from '../components/ThreePaneViewer.js';

export function LocalLab() {
  const [relPath, setRelPath] = useState('');
  const [maxLlm, setMaxLlm] = useState<number | ''>('');
  const [result, setResult] = useState<LocalRunResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onRun() {
    if (!relPath) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await localApi.runFixture(relPath, maxLlm === '' ? undefined : maxLlm);
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="card">
        <div className="row">
          <FixtureSelector value={relPath} onChange={setRelPath} />
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
            max LLM:
            <input
              type="number"
              min={0}
              value={maxLlm}
              onChange={(e) => setMaxLlm(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="20"
              style={{ width: 60, padding: '6px 8px' }}
            />
          </label>
          <button onClick={onRun} disabled={!relPath || busy}>
            Run
          </button>
          <span className="muted" style={{ fontSize: 12 }}>
            local only · no CXone writes possible
          </span>
        </div>
        {error && <div className="status-error mono">✖ {error}</div>}
        {busy && <div className="muted">running pipeline…</div>}
      </div>

      {result && (
        <>
          <div className="card">
            <ThreePaneViewer result={result} />
          </div>
          <div className="card">
            <h2>Strategy reports · diff · {result.elapsedMs}ms</h2>
            <details>
              <summary style={{ cursor: 'pointer' }}>strategy reports</summary>
              <pre className="mono" style={{ fontSize: 12, maxHeight: 300, overflow: 'auto', marginTop: 8 }}>
{JSON.stringify(result.strategyReports, null, 2)}
              </pre>
            </details>
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer' }}>unified diff</summary>
              <pre className="mono" style={{ fontSize: 12, maxHeight: 400, overflow: 'auto', marginTop: 8 }}>
{result.diff}
              </pre>
            </details>
          </div>
        </>
      )}
    </div>
  );
}
