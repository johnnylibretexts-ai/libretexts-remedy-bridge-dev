import kleur from 'kleur';
import type { Finding, ScanResult, Severity } from '@libretexts/remedy-core';

const SEV_COLOR: Record<Severity, (s: string) => string> = {
  error: (s) => kleur.red().bold(s),
  warning: (s) => kleur.yellow(s),
  info: (s) => kleur.blue(s),
};

export function formatScanHuman(result: ScanResult): string {
  const lines: string[] = [];
  lines.push(kleur.bold(`Page ${result.page.id}  ${result.page.title ?? ''}`));
  lines.push(kleur.dim(`  path: ${result.page.path}`));
  lines.push(kleur.dim(`  host: ${result.page.hostname}`));
  lines.push(kleur.dim(`  scanned: ${result.scannedAt}`));
  lines.push('');
  lines.push(
    `Findings: ${kleur.red(String(result.stats.bySeverity.error))} error(s), ` +
    `${kleur.yellow(String(result.stats.bySeverity.warning))} warning(s), ` +
    `${kleur.blue(String(result.stats.bySeverity.info))} info`,
  );
  lines.push('');

  if (result.findings.length === 0) {
    lines.push(kleur.green('  no findings — page passed all configured rules.'));
    return lines.join('\n');
  }

  const byRule = new Map<string, Finding[]>();
  for (const f of result.findings) {
    const bucket = byRule.get(f.ruleId) ?? [];
    bucket.push(f);
    byRule.set(f.ruleId, bucket);
  }

  for (const [ruleId, findings] of byRule) {
    const first = findings[0]!;
    lines.push(
      `${SEV_COLOR[first.severity](`[${first.severity}]`)} ${kleur.bold(ruleId)}` +
      (first.wcag ? kleur.dim(` (WCAG ${first.wcag})`) : '') +
      kleur.dim(`  ×${findings.length}`),
    );
    for (const f of findings.slice(0, 5)) {
      lines.push(`  • ${f.message}`);
      if (f.selector) lines.push(kleur.dim(`    at ${f.selector}`));
    }
    if (findings.length > 5) {
      lines.push(kleur.dim(`  … ${findings.length - 5} more`));
    }
    lines.push('');
  }

  return lines.join('\n');
}
