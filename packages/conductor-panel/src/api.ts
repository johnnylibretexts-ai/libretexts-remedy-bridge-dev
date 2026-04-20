import type { Finding, PageRef } from '@libretexts/remedy-core';

export interface ScanResponse {
  page: PageRef;
  findings: Finding[];
  stats: { bySeverity: { error: number; warning: number; info: number } };
  scannedAt: string;
}

export interface PreviewResponse {
  pageId: number;
  pagePath: string;
  hostname: string;
  tiersRun: Array<{ tier: number; before: number; after: number; elapsedMs: number }>;
  finalFindingsCount: number;
  diff: string;
  beforeHtml: string;
  finalHtml: string;
  noiseOnlyChange: boolean;
}

export interface ApplyResponse {
  applied: boolean;
  applyError?: string;
  snapshotPath?: string;
  revisionSummary?: string;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status} ${msg}`);
  }
  return res.json();
}

export const api = {
  scan:    (page: string): Promise<ScanResponse>    => post('/api/scan',    { page }),
  preview: (page: string, tier: 1 | 2 | 3): Promise<PreviewResponse> => post('/api/preview', { page, tier }),
  apply:   (page: string, tier: 1 | 2 | 3): Promise<ApplyResponse>   => post('/api/apply',   { page, tier }),
};
