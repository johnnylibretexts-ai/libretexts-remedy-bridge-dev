import { useState } from 'react';
import { ProductionTab } from './tabs/Production.js';
import { LocalLab } from './tabs/LocalLab.js';

type Tab = 'local' | 'production';

export function App() {
  // Default to Local Lab — safer (no accidental CXone writes).
  const [tab, setTab] = useState<Tab>('local');

  return (
    <div className="panel">
      <h1>Remedy · Conductor <span>staff preview</span></h1>
      <div className="tab-bar">
        <button
          className={tab === 'local' ? 'active' : ''}
          onClick={() => setTab('local')}
        >
          Local Lab
        </button>
        <button
          className={tab === 'production' ? 'active' : ''}
          onClick={() => setTab('production')}
        >
          Production (dev.libretexts.org)
        </button>
      </div>
      {tab === 'local' ? <LocalLab /> : <ProductionTab />}
    </div>
  );
}
