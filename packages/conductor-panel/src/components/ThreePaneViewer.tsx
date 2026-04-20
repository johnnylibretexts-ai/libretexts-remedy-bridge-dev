import { useState } from 'react';
import { FindingsList } from './FindingsList.js';
import type { LocalRunResponse } from '../api.js';

type ViewMode = 'rendered' | 'source';

export function ThreePaneViewer({ result }: { result: LocalRunResponse }) {
  const [beforeMode, setBeforeMode] = useState<ViewMode>('rendered');
  const [afterMode, setAfterMode] = useState<ViewMode>('rendered');

  return (
    <div className="three-pane">
      <div className="pane findings-pane">
        <h3>Findings</h3>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          Before: <b>{result.findingsBefore.length}</b> · After:{' '}
          <b>{result.findingsAfter.length}</b>
        </div>
        <FindingsList findings={result.findingsBefore} />
      </div>

      <div className="pane preview-pane">
        <div className="pane-header">
          <h3>Before</h3>
          <ModeToggle value={beforeMode} onChange={setBeforeMode} />
        </div>
        {beforeMode === 'rendered' ? (
          <iframe
            srcDoc={wrapForIframe(result.beforeHtml)}
            sandbox="allow-same-origin"
            title="before"
          />
        ) : (
          <pre className="mono source">{result.beforeHtml}</pre>
        )}
      </div>

      <div className="pane preview-pane">
        <div className="pane-header">
          <h3>
            After{' '}
            {result.bytePreserved ? (
              <span className="status-ok" style={{ fontSize: 11, marginLeft: 6 }}>
                ✓ byte-preserved
                {result.splicesApplied !== undefined ? ` (${result.splicesApplied})` : ''}
              </span>
            ) : (
              <span className="status-warn" style={{ fontSize: 11, marginLeft: 6 }}>
                ⚠ re-serialized
                {result.fallbackReason ? ` (${result.fallbackReason})` : ''}
              </span>
            )}
          </h3>
          <ModeToggle value={afterMode} onChange={setAfterMode} />
        </div>
        {afterMode === 'rendered' ? (
          <iframe
            srcDoc={wrapForIframe(result.afterHtml)}
            sandbox="allow-same-origin"
            title="after"
          />
        ) : (
          <pre className="mono source">{result.afterHtml}</pre>
        )}
      </div>
    </div>
  );
}

function ModeToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (m: ViewMode) => void;
}) {
  return (
    <div className="mode-toggle">
      <button
        className={value === 'rendered' ? 'active' : ''}
        onClick={() => onChange('rendered')}
      >
        Rendered
      </button>
      <button
        className={value === 'source' ? 'active' : ''}
        onClick={() => onChange('source')}
      >
        Source
      </button>
    </div>
  );
}

function wrapForIframe(html: string): string {
  // Minimal readability CSS — no LibreTexts theme replication (out of scope
  // for Level A). Keeps the iframe legible without pretending it's production.
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font: 14px/1.5 -apple-system, system-ui, sans-serif; max-width: 40rem; margin: 1rem auto; padding: 0 1rem; color: #222; }
    img { max-width: 100%; height: auto; background: #f4f4f4; border: 1px dashed #ccc; }
    figure { margin: 1rem 0; border: 1px solid #ddd; padding: 0.5rem; border-radius: 3px; }
    figcaption { font-size: 12px; color: #555; margin-top: 0.25rem; }
    h1, h2, h3, h4 { margin-top: 1.25rem; }
    ul, ol { padding-left: 1.5rem; }
    pre { background: #f6f6f6; padding: 0.5rem; border-radius: 3px; overflow-x: auto; }
  </style></head><body>${html}</body></html>`;
}
