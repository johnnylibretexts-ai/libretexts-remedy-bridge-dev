import { useEffect, useState } from 'react';
import { localApi, type LocalFixture } from '../api.js';

export function FixtureSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (relPath: string) => void;
}) {
  const [fixtures, setFixtures] = useState<LocalFixture[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    localApi
      .listFixtures()
      .then((r) => setFixtures(r.fixtures))
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <div className="status-error mono">fixtures: {error}</div>;

  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— pick a fixture —</option>
      {fixtures.map((f) => (
        <option key={f.relPath} value={f.relPath}>
          {f.name} ({f.size}b)
        </option>
      ))}
    </select>
  );
}
