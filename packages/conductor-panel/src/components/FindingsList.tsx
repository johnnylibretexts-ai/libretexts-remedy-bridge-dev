import type { Finding } from '@libretexts/remedy-core';

export function FindingsList({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) {
    return <div className="status-ok">no findings — page passed all configured rules.</div>;
  }
  const byRule = new Map<string, Finding[]>();
  for (const f of findings) {
    const bucket = byRule.get(f.ruleId) ?? [];
    bucket.push(f);
    byRule.set(f.ruleId, bucket);
  }
  return (
    <div>
      {[...byRule.entries()].map(([ruleId, fs]) => (
        <div key={ruleId} className="finding">
          <span className={`sev ${fs[0]!.severity}`}>{fs[0]!.severity}</span>
          <b>{ruleId}</b>
          {fs[0]!.wcag && <span className="muted"> (WCAG {fs[0]!.wcag})</span>}
          <span className="muted"> ×{fs.length}</span>
          <ul style={{ margin: '4px 0 0 20px', padding: 0 }}>
            {fs.slice(0, 5).map((f, i) => (
              <li key={i}>
                {f.message}
                {f.selector && (<> <code>{f.selector}</code></>)}
              </li>
            ))}
            {fs.length > 5 && <li className="muted">… {fs.length - 5} more</li>}
          </ul>
        </div>
      ))}
    </div>
  );
}
