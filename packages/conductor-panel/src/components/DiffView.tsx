export function DiffView({ diff }: { diff: string }) {
  if (!diff.trim()) {
    return <div className="muted">no diff — preview produced no change.</div>;
  }
  const lines = diff.split('\n');
  return (
    <pre className="diff">
      {lines.map((line, i) => {
        let cls = '';
        if (line.startsWith('+') && !line.startsWith('+++')) cls = 'add';
        else if (line.startsWith('-') && !line.startsWith('---')) cls = 'del';
        else if (line.startsWith('@@') || line.startsWith('Index:') || line.startsWith('===') || line.startsWith('+++') || line.startsWith('---')) cls = 'meta';
        return <span key={i} className={cls}>{line}{'\n'}</span>;
      })}
    </pre>
  );
}
