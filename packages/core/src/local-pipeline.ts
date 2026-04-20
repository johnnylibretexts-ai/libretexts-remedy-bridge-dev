/**
 * Local pipeline — pure HTML→HTML remediation, no CXone client, no writes.
 *
 * This is the Local Lab primitive. It reuses StrategyRunner + bytePreservePatch
 * but constructs no Expert client, so a Local-Lab-only build has no way to
 * reach CXone. If you find yourself adding an `Expert` import here, STOP —
 * the whole point of this module is that it cannot write remotely.
 */
import { createPatch } from 'diff';
import { bytePreservePatch } from './patch/index.js';
import { scanHtmlFull } from './scan.js';
import { StrategyRunner } from './strategies/runner.js';
import { buildTierClient } from './tiers.js';
import type { StrategyReport } from './strategies/types.js';
import type { FallbackReason } from './patch/types.js';
import type { Finding, Rule } from './types.js';

export interface LocalPipelineOptions {
  /** Restrict reported findings to these rule ids. */
  onlyRuleIds?: string[];
  /** Override rule set (defaults to defaultRules via scanHtmlFull). */
  rules?: Rule[];
  /** Merge axe-core findings. Default: true. */
  axe?: boolean;
  /** Cap strategy-layer LLM calls. Default: 20. 0 disables LLM-dependent handlers. */
  maxLlmCalls?: number;
  /** Strategies build absolute URLs off this; default 'local.fixture'. */
  hostname?: string;
  /** Env override for LLM client; defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

export interface LocalPipelineResult {
  beforeHtml: string;
  afterHtml: string;
  diff: string;
  findingsBefore: Finding[];
  findingsAfter: Finding[];
  strategyReports: StrategyReport[];
  bytePreserved: boolean;
  fallbackReason?: FallbackReason;
  splicesApplied?: number;
  elapsedMs: number;
}

export async function runLocalPipeline(
  html: string,
  opts: LocalPipelineOptions = {},
): Promise<LocalPipelineResult> {
  const t0 = Date.now();
  const env = opts.env ?? process.env;
  const axe = opts.axe ?? true;
  const rules = opts.rules;

  const findingsBeforeAll = await scanHtmlFull(html, { rules, axe });
  const findingsBefore = opts.onlyRuleIds
    ? findingsBeforeAll.filter((f) => opts.onlyRuleIds!.includes(f.ruleId))
    : findingsBeforeAll;

  // Build a tier-1 LLM client from env. Strategies that need it will call it;
  // strategies that don't (decorative-mark, headings, deterministic paths)
  // ignore it. Budget=0 short-circuits all LLM work cleanly.
  const llm = buildTierClient({ tier: 1 }, env);

  const runner = new StrategyRunner();
  const { html: afterHtmlRaw, reports } = await runner.run(html, {
    hostname: opts.hostname ?? 'local.fixture',
    maxLlmCalls: opts.maxLlmCalls ?? 20,
    llm,
  });

  // Byte-preserve: try to splice the minimal diff, fall back to the re-serialized
  // mutated HTML if structural equivalence fails.
  const patch = bytePreservePatch(html, afterHtmlRaw);
  const finalHtml: string = patch.ok && patch.bytes !== undefined ? patch.bytes : afterHtmlRaw;

  const findingsAfterAll = await scanHtmlFull(finalHtml, { rules, axe });
  const findingsAfter = opts.onlyRuleIds
    ? findingsAfterAll.filter((f) => opts.onlyRuleIds!.includes(f.ruleId))
    : findingsAfterAll;

  const diff = createPatch('fixture', html, finalHtml, 'before', 'after', { context: 3 });

  return {
    beforeHtml: html,
    afterHtml: finalHtml,
    diff,
    findingsBefore,
    findingsAfter,
    strategyReports: reports,
    bytePreserved: patch.ok,
    fallbackReason: patch.ok ? undefined : patch.reason,
    splicesApplied: patch.ok ? patch.splices.length : undefined,
    elapsedMs: Date.now() - t0,
  };
}
