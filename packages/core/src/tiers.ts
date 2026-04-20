/**
 * Tier escalation helpers for the remediation pipeline.
 *
 * The pipeline runs deterministic fixes first, then LLM-assisted strategies
 * under a "tier" regime borrowed from project-remedy-server's CLAUDE.md §4:
 *
 *   Tier 1 — cheap/default model. Fixes most pages.
 *   Tier 2 — stronger model. Tried when Tier 1 didn't move the needle.
 *   Tier 3 — agentic loop (see agent-loop.ts). Last resort on stubborn cases.
 *
 * Tier switching is implemented by building a fresh LLMClient with a
 * different `textModel` / `visionModel` for each tier; everything else
 * (provider, auth, retry logic) is reused. See llm-client.ts.
 */
import { LLMClient, type LLMClientOptions } from './ai/llm-client.js';

export interface TierConfig {
  tier: 1 | 2 | 3;
  textModel?: string;
  visionModel?: string;
  /** Directory for LLM response cache (opt-in). Passed to LLMClient. */
  cacheDir?: string;
}

/**
 * Build an LLMClient appropriate for the given tier. The provider, base
 * URL, API key, and retry policy come from env; only the model names are
 * swapped per tier.
 *
 * Tier 1 uses REMEDY_TEXT_MODEL / REMEDY_VISION_MODEL (the provider's
 * default if unset).
 * Tier 2 swaps in REMEDY_TIER2_TEXT_MODEL / REMEDY_TIER2_VISION_MODEL when
 * the caller did not pass explicit overrides.
 * Tier 3 defaults to the Tier 2 model (agent loop needs reasoning quality).
 */
export function buildTierClient(
  cfg: TierConfig,
  baseEnv: NodeJS.ProcessEnv = process.env,
): LLMClient {
  const opts: LLMClientOptions = {};

  const tierEnvText = tierEnvTextModel(cfg.tier, baseEnv);
  const tierEnvVision = tierEnvVisionModel(cfg.tier, baseEnv);

  if (cfg.textModel) opts.textModel = cfg.textModel;
  else if (tierEnvText) opts.textModel = tierEnvText;

  if (cfg.visionModel) opts.visionModel = cfg.visionModel;
  else if (tierEnvVision) opts.visionModel = tierEnvVision;

  if (cfg.cacheDir !== undefined) opts.cacheDir = cfg.cacheDir;

  return new LLMClient(opts);
}

function tierEnvTextModel(tier: 1 | 2 | 3, env: NodeJS.ProcessEnv): string | undefined {
  switch (tier) {
    case 1:
      return env.REMEDY_TEXT_MODEL;
    case 2:
      return env.REMEDY_TIER2_TEXT_MODEL ?? env.REMEDY_TEXT_MODEL;
    case 3:
      return (
        env.REMEDY_TIER3_TEXT_MODEL ??
        env.REMEDY_TIER2_TEXT_MODEL ??
        env.REMEDY_TEXT_MODEL
      );
  }
}

function tierEnvVisionModel(tier: 1 | 2 | 3, env: NodeJS.ProcessEnv): string | undefined {
  switch (tier) {
    case 1:
      return env.REMEDY_VISION_MODEL;
    case 2:
      return env.REMEDY_TIER2_VISION_MODEL ?? env.REMEDY_VISION_MODEL;
    case 3:
      return (
        env.REMEDY_TIER3_VISION_MODEL ??
        env.REMEDY_TIER2_VISION_MODEL ??
        env.REMEDY_VISION_MODEL
      );
  }
}

/**
 * Did a tier make enough progress that we should stop there, or should we
 * escalate to the next tier?
 *
 * Returns true when findings were NOT reduced by at least `threshold`
 * (fraction in [0,1]) — i.e. "we should escalate because this tier stalled".
 *
 * Examples (threshold=0.5):
 *   before=10, after=4  → delta=0.6 → false (stop; tier made progress)
 *   before=10, after=6  → delta=0.4 → true  (escalate; not enough progress)
 *   before=10, after=10 → delta=0.0 → true  (escalate)
 *   before=10, after=0  → delta=1.0 → false (done)
 *   before=0            → false (nothing to escalate for)
 */
export function shouldEscalate(before: number, after: number, threshold: number): boolean {
  if (before <= 0) return false;
  if (after <= 0) return false;
  const delta = (before - after) / before;
  return delta < threshold;
}
