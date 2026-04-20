/**
 * On-disk LLM response cache — keyed by sha256 of the serialized payload.
 *
 * Goal: make fixture iteration in the Local Lab free after the first warm-up.
 * Vision calls against the same fixture + same prompt are deterministic enough
 * for this to be safe — the model cost dominates, not call-to-call drift.
 *
 * NOT enabled by default in production writes. `runLocalPipeline` opts in
 * (it's the safe context: local HTML fixtures, no CXone revisions at stake).
 * `fixPage` / `runPipeline` do NOT opt in — we don't want yesterday's alt
 * text silently landing on today's live page.
 *
 * Cache entry format (one JSON file per key):
 *   { ts, model, provider, response, usage? }
 *
 * The key IS the filename (hex sha256). No directory sharding yet — at our
 * scale (~100 fixtures × ~5 strategies) the flat layout is fine.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface CacheEntry {
  ts: string;
  model: string;
  provider: string;
  response: string;
  inputTokens?: number;
  outputTokens?: number;
}

/** Stable hash of the outgoing OpenAI-style payload. */
export function hashPayload(payload: unknown): string {
  // JSON.stringify with a sort-keyed replacer so field-order quirks don't
  // bust the cache on otherwise-identical requests.
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

export class LlmCache {
  readonly dir: string;
  private hits = 0;
  private misses = 0;

  constructor(dir: string) {
    this.dir = dir;
  }

  get stats() {
    return { hits: this.hits, misses: this.misses };
  }

  private keyPath(key: string): string {
    return join(this.dir, `${key}.json`);
  }

  async get(key: string): Promise<CacheEntry | null> {
    const path = this.keyPath(key);
    if (!existsSync(path)) {
      this.misses++;
      return null;
    }
    try {
      const raw = await readFile(path, 'utf8');
      const entry = JSON.parse(raw) as CacheEntry;
      this.hits++;
      return entry;
    } catch {
      // Corrupt cache file — treat as a miss, don't poison the stats counter
      // any further. Caller will overwrite on network success.
      this.misses++;
      return null;
    }
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.keyPath(key), JSON.stringify(entry, null, 2), 'utf8');
  }
}

/**
 * Resolve the cache dir from explicit opt or env. Returns undefined when
 * caching should be disabled (default).
 */
export function resolveCacheDir(
  explicit: string | undefined,
  env: NodeJS.ProcessEnv,
): string | undefined {
  if (explicit) return explicit;
  if (env.REMEDY_LLM_CACHE_DIR) return env.REMEDY_LLM_CACHE_DIR;
  if (env.REMEDY_LLM_CACHE === '1') return '.remedy/cache';
  return undefined;
}
