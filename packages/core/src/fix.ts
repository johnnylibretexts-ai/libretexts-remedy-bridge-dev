import { JSDOM } from 'jsdom';
import { createPatch } from 'diff';
import type Expert from '@libretexts/cxone-expert-node';
import { createExpertClient, normalizePageInput, resolvePageRef } from './client.js';
import { defaultRules } from './rules/index.js';
import { fetchPageHtml, scanHtml } from './scan.js';
import { isNoiseOnlyChange } from './serialize.js';
import { bytePreservePatch } from './patch/index.js';
import {
  appendAudit,
  assertWriteAllowed,
  extractRevisionId,
  hashContent,
  operatorFromEnv,
  saveSnapshot,
} from './guardrails.js';
import type { Finding, FixMode, FixResult, PageRef, Rule } from './types.js';

export interface FixPageOptions {
  expert?: Expert;
  rules?: Rule[];
  env?: NodeJS.ProcessEnv;
  mode?: FixMode;
  onlyRuleIds?: string[];
  findingIds?: string[];
  revisionSummary?: string;
}

/**
 * Scan a page and apply fixes for findings whose rule has a fix() implementation.
 * By default runs in preview mode — no HTTP write. `mode: 'apply'` issues a
 * postPageContents call after passing guardrails and caller confirmation.
 */
export async function fixPage(
  pageInput: string | number,
  opts: FixPageOptions = {},
): Promise<FixResult & { findings: Finding[] }> {
  const env = opts.env ?? process.env;
  const expert = opts.expert ?? createExpertClient(env);
  const rules = opts.rules ?? defaultRules;
  const mode: FixMode = opts.mode ?? 'preview';

  const page: PageRef = await resolvePageRef(expert, pageInput, env);
  const before = await fetchPageHtml(expert, pageInput);
  const findings = scanHtml(before, rules);

  const dom = new JSDOM(`<!doctype html><html><body>${before}</body></html>`);
  const doc = dom.window.document;
  const attempted: string[] = [];
  const applied: string[] = [];

  const wanted = filterWanted(findings, rules, opts);
  const ruleById = new Map(rules.map((r) => [r.id, r]));

  for (const f of wanted) {
    const rule = ruleById.get(f.ruleId);
    if (!rule?.fix) continue;
    attempted.push(f.ruleId);
    try {
      const ok = await rule.fix(doc, f, { page, env });
      if (ok) applied.push(f.ruleId);
    } catch (err) {
      if (env.DEBUG) console.error(`Fix ${f.ruleId} threw:`, err);
    }
  }

  const after = doc.body.innerHTML;
  const diff = createPatch(
    page.path || `page-${page.id}`,
    before,
    after,
    'before',
    'after',
    { context: 3 },
  );

  let written = false;
  let revisionSummary = opts.revisionSummary;
  if (mode === 'apply' && before !== after && !isNoiseOnlyChange(before, after)) {
    assertWriteAllowed(page.path, env);
    revisionSummary =
      revisionSummary ?? `remedy-v0: fix ${unique(applied).join(',') || '(no-op)'}`;
    // Pre-write snapshot — always save before-state so we can revert.
    const snapshot = await saveSnapshot(before, {
      pageId: page.id,
      pagePath: page.path,
      hostname: page.hostname,
      operator: operatorFromEnv(env),
      rules: unique(applied),
      revisionSummary,
      source: 'fix',
    }, env);
    const patch = bytePreservePatch(before, after);
    const bytesToWrite = patch.bytes ?? after;
    const postResponse = await expert.pages.postPageContents(
      normalizePageInput(pageInput) as number,
      bytesToWrite,
      {
        edittime: 'now',
        comment: revisionSummary,
      } as unknown as Parameters<typeof expert.pages.postPageContents>[2],
    );
    written = true;
    await appendAudit({
      ts: new Date().toISOString(),
      page: { id: page.id, path: page.path, hostname: page.hostname },
      rules: unique(applied),
      mode,
      beforeHash: hashContent(before),
      afterHash: hashContent(after),
      operator: operatorFromEnv(env),
      revisionSummary,
      snapshotPath: snapshot.metaPath,
      cxoneRevisionId: extractRevisionId(postResponse),
      bytePreserved: patch.ok,
      fallbackReason: patch.ok ? undefined : patch.reason,
      splicesApplied: patch.ok ? patch.splices.length : undefined,
    });
  }

  return {
    page,
    mode,
    attempted: unique(attempted),
    applied: unique(applied),
    before,
    after,
    diff,
    written,
    revisionSummary,
    findings,
  };
}

function filterWanted(findings: Finding[], rules: Rule[], opts: FixPageOptions): Finding[] {
  const fixableIds = new Set(rules.filter((r) => typeof r.fix === 'function').map((r) => r.id));
  let f = findings.filter((x) => fixableIds.has(x.ruleId));
  if (opts.onlyRuleIds?.length) {
    const set = new Set(opts.onlyRuleIds);
    f = f.filter((x) => set.has(x.ruleId));
  }
  if (opts.findingIds?.length) {
    // We don't persist stable finding ids yet; provide a stable index-based id.
    // Caller passes e.g. "img-alt#0".
    const set = new Set(opts.findingIds);
    f = f.filter((x, i) => set.has(`${x.ruleId}#${i}`));
  }
  return f;
}

function unique<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}
