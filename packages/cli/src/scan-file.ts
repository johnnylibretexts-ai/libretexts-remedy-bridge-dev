import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, basename } from 'node:path';
import kleur from 'kleur';
import { scanHtmlFull, buildStats, type ScanResult } from '@libretexts/remedy-core';
import { formatScanHuman } from './format.js';

export interface ScanFileOpts {
  out?: string;
  json?: boolean;
}

export async function scanFile(filePath: string, opts: ScanFileOpts): Promise<number> {
  const absolutePath = resolve(filePath);
  const html = await readFile(absolutePath, 'utf8');
  const findings = await scanHtmlFull(html);
  const result: ScanResult = {
    page: {
      id: 0,
      path: absolutePath,
      title: basename(absolutePath),
      hostname: 'local-file',
    },
    scannedAt: new Date().toISOString(),
    findings,
    stats: buildStats(findings),
  };

  if (opts.out) {
    const outPath = resolve(opts.out);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, JSON.stringify(result, null, 2), 'utf8');
    console.error(kleur.dim(`wrote findings → ${outPath}`));
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    console.log(formatScanHuman(result));
  }

  return result.stats.bySeverity.error > 0 ? 1 : 0;
}
