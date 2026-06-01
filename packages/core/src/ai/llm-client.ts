/**
 * OpenAI-compatible LLM client, covers OpenRouter, Ollama Cloud/local,
 * and Gemini's OpenAI-compat endpoint with one payload shape.
 *
 * Design parallels the sibling project-remedy-server `ollama_client.py`:
 * every provider we need exposes `/chat/completions` with the standard
 * message + content-part schema. A single client avoids a per-provider
 * matrix in every rule.
 */

import { LlmCache, hashPayload, resolveCacheDir } from './llm-cache.js';

export type ProviderId = 'openrouter' | 'ollama-cloud' | 'ollama-local' | 'gemini-compat' | 'custom';

export interface ProviderConfig {
  id: ProviderId;
  baseUrl: string;
  apiKey?: string;
  defaultTextModel?: string;
  defaultVisionModel?: string;
  /**
   * Ordered fallback pools (OpenRouter only). When set, requests include a
   * `models` array so OpenRouter auto-routes to the next model on error /
   * rate-limit (429). Primary first. Sourced from REMEDY_TEXT_MODELS /
   * REMEDY_VISION_MODELS. Other providers ignore these.
   */
  textModels?: string[];
  visionModels?: string[];
}

export interface LLMClientOptions {
  provider?: ProviderId;
  baseUrl?: string;
  apiKey?: string;
  textModel?: string;
  visionModel?: string;
  /** Ordered OpenRouter fallback pools (primary first). Overrides env lists. */
  textModels?: string[];
  visionModels?: string[];
  maxRetries?: number;
  timeoutMs?: number;
  /** Max concurrent in-flight requests from this client. Default 4. */
  concurrency?: number;
  debug?: boolean;
  /**
   * When set, LLM responses are cached to disk keyed by payload hash.
   * Opt-in — do NOT enable for production CXone writes (risks landing
   * stale alt text on live pages). `runLocalPipeline` opts in by default.
   * If unset, `resolveCacheDir(undefined, process.env)` is consulted.
   */
  cacheDir?: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** Enable thinking mode when supported by the provider (Ollama Cloud `think: true`). */
  think?: boolean;
}

export interface VisionRequest {
  image: ImageSource;
  prompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type ImageSource =
  | { kind: 'url'; url: string }
  | { kind: 'bytes'; bytes: Buffer | Uint8Array; mimeType: string };

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  elapsedMs: number;
  model: string;
  provider: ProviderId;
}

export class LLMError extends Error {
  constructor(message: string, readonly status?: number, readonly body?: string) {
    super(message);
    this.name = 'LLMError';
  }
}

const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/** OpenRouter caps the `models` fallback array at 3 entries per request. */
const OPENROUTER_MAX_MODELS = 3;

const BUILT_IN_PROVIDERS: Record<Exclude<ProviderId, 'custom'>, ProviderConfig> = {
  openrouter: {
    id: 'openrouter',
    // NB: the old qwen-2.5 :free defaults were retired by OpenRouter (404).
    // Gemma 4 is current and multimodal (text+vision in one model).
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultTextModel: 'google/gemma-4-31b-it:free',
    defaultVisionModel: 'google/gemma-4-31b-it:free',
  },
  'ollama-cloud': {
    id: 'ollama-cloud',
    baseUrl: 'https://ollama.com/v1',
    defaultTextModel: 'qwen3:30b-cloud',
    defaultVisionModel: 'qwen3-vl:235b-cloud',
  },
  'ollama-local': {
    id: 'ollama-local',
    baseUrl: 'http://localhost:11434/v1',
    defaultTextModel: 'qwen2.5:7b',
    defaultVisionModel: 'qwen2.5-vl:7b',
  },
  'gemini-compat': {
    id: 'gemini-compat',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultTextModel: 'gemini-2.5-flash',
    defaultVisionModel: 'gemini-2.5-flash',
  },
};

export function resolveProvider(opts: LLMClientOptions = {}, env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  const providerId = (opts.provider ?? env.REMEDY_LLM_PROVIDER ?? 'openrouter') as ProviderId;
  const base =
    providerId === 'custom'
      ? { id: 'custom' as const, baseUrl: opts.baseUrl ?? env.REMEDY_LLM_BASE_URL ?? '' }
      : BUILT_IN_PROVIDERS[providerId];
  if (!base.baseUrl) {
    throw new LLMError(`No baseUrl configured for provider "${providerId}".`);
  }
  const textModels = opts.textModels ?? parseModelList(env.REMEDY_TEXT_MODELS);
  const visionModels = opts.visionModels ?? parseModelList(env.REMEDY_VISION_MODELS);
  return {
    ...base,
    baseUrl: (opts.baseUrl ?? env.REMEDY_LLM_BASE_URL ?? base.baseUrl).replace(/\/+$/, ''),
    apiKey: opts.apiKey ?? env.REMEDY_LLM_API_KEY ?? providerKey(providerId, env),
    // Single default tracks the fallback list's primary when a list is set.
    defaultTextModel:
      opts.textModel ?? env.REMEDY_TEXT_MODEL ?? textModels?.[0] ?? base.defaultTextModel,
    defaultVisionModel:
      opts.visionModel ?? env.REMEDY_VISION_MODEL ?? visionModels?.[0] ?? base.defaultVisionModel,
    textModels,
    visionModels,
  };
}

/** Parse a comma/newline-separated model list into a trimmed, de-duped array. */
function parseModelList(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const list = [...new Set(raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))];
  return list.length ? list : undefined;
}

/**
 * Build the OpenRouter `models` fallback array: the actually-chosen model
 * first, then the configured pool (de-duped). Returns undefined when there's
 * nothing to fall back to, so single-model requests stay unchanged.
 */
function buildModelsArray(primary: string, pool: string[] | undefined): string[] | undefined {
  if (!pool || pool.length === 0) return undefined;
  const merged = [...new Set([primary, ...pool])];
  return merged.length > 1 ? merged : undefined;
}

function providerKey(id: ProviderId, env: NodeJS.ProcessEnv): string | undefined {
  switch (id) {
    case 'openrouter':
      return env.OPENROUTER_API_KEY;
    case 'ollama-cloud':
      return env.OLLAMA_API_KEY;
    case 'gemini-compat':
      return env.GEMINI_API_KEY;
    case 'ollama-local':
      return env.OLLAMA_LOCAL_KEY ?? 'ollama';
    default:
      return undefined;
  }
}

export class LLMClient {
  readonly provider: ProviderConfig;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly concurrency: number;
  private readonly inflight: Array<() => void> = [];
  private active = 0;
  private readonly debug: boolean;
  private readonly cache: LlmCache | null;
  readonly usage: Usage[] = [];

  constructor(opts: LLMClientOptions = {}) {
    this.provider = resolveProvider(opts);
    this.maxRetries = opts.maxRetries ?? 3;
    this.timeoutMs = opts.timeoutMs ?? 120_000;
    const envConcurrency = Number(process.env.REMEDY_LLM_CONCURRENCY);
    const defaultConcurrency = this.provider.id === 'openrouter' ? 2 : 4;
    this.concurrency = Math.max(
      1,
      opts.concurrency ?? (Number.isFinite(envConcurrency) && envConcurrency > 0 ? envConcurrency : defaultConcurrency),
    );
    this.debug = opts.debug ?? Boolean(process.env.DEBUG);
    const cacheDir = resolveCacheDir(opts.cacheDir, process.env);
    this.cache = cacheDir ? new LlmCache(cacheDir) : null;
  }

  /** Cache stats for the lifetime of this client. `null` when caching is disabled. */
  get cacheStats(): { hits: number; misses: number } | null {
    return this.cache ? this.cache.stats : null;
  }

  private async acquire(): Promise<() => void> {
    if (this.active < this.concurrency) {
      this.active++;
      return () => this.release();
    }
    return new Promise<() => void>((resolve) => {
      this.inflight.push(() => {
        this.active++;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.active--;
    const next = this.inflight.shift();
    if (next) next();
  }

  async chat(req: ChatRequest): Promise<string> {
    const model = req.model ?? this.provider.defaultTextModel;
    if (!model) throw new LLMError('No text model configured (REMEDY_TEXT_MODEL or opts.textModel).');
    const payload: Record<string, unknown> = {
      model,
      messages: req.messages,
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.2,
      stream: false,
    };
    if (req.think) payload.think = true;
    return this.completion(payload, model, this.fallbackWindows(model, this.provider.textModels));
  }

  async vision(req: VisionRequest): Promise<string> {
    const model = req.model ?? this.provider.defaultVisionModel;
    if (!model) throw new LLMError('No vision model configured (REMEDY_VISION_MODEL or opts.visionModel).');
    const imagePart: ContentPart = {
      type: 'image_url',
      image_url: { url: await encodeImage(req.image) },
    };
    const payload = {
      model,
      messages: [
        {
          role: 'user' as const,
          content: [imagePart, { type: 'text' as const, text: req.prompt }],
        },
      ],
      max_tokens: req.maxTokens ?? 1024,
      temperature: req.temperature ?? 0.2,
      stream: false,
    } as Record<string, unknown>;
    return this.completion(payload, model, this.fallbackWindows(model, this.provider.visionModels));
  }

  /**
   * Compute OpenRouter `models` fallback windows for a request. The full pool
   * is `[chosenModel, ...configuredPool]` (de-duped, primary first); we slice
   * it into windows of ≤3 because OpenRouter caps the `models` array at 3.
   * The completion loop advances one window per retry, so a 5-model pool tries
   * `[m0,m1,m2]` then `[m3,m4]` — every model gets used. Returns undefined for
   * non-OpenRouter providers or when there's nothing to fall back to.
   */
  private fallbackWindows(primary: string, pool?: string[]): string[][] | undefined {
    if (this.provider.id !== 'openrouter') return undefined;
    const full = buildModelsArray(primary, pool);
    if (!full) return undefined;
    const windows: string[][] = [];
    for (let i = 0; i < full.length; i += OPENROUTER_MAX_MODELS) {
      windows.push(full.slice(i, i + OPENROUTER_MAX_MODELS));
    }
    if (this.debug) console.error(`[llm] openrouter fallback chain: ${full.join(' → ')} (${windows.length} window(s) of ≤${OPENROUTER_MAX_MODELS})`);
    return windows;
  }

  private async completion(
    payload: Record<string, unknown>,
    model: string,
    windows?: string[][],
  ): Promise<string> {
    // Cache check — keyed by stable hash of {payload, provider}. Same
    // payload on a different provider rightly misses (different model family).
    // Keyed on the primary `model` only (computed before any window rotation
    // mutates the payload), so the key is content-stable regardless of which
    // fallback actually served the response.
    const cacheKey = this.cache
      ? hashPayload({ provider: this.provider.id, payload })
      : '';
    // With fallback windows, run enough attempts to cover every window at least
    // once (each attempt = one OpenRouter `models` request that tries ≤3 models
    // server-side before erroring through to us).
    const maxAttempts = windows && windows.length > this.maxRetries ? windows.length : this.maxRetries;
    if (this.cache) {
      const hit = await this.cache.get(cacheKey);
      if (hit) {
        if (this.debug) {
          console.error(`[llm] cache hit ${cacheKey.slice(0, 12)} (${model})`);
        }
        this.usage.push({
          inputTokens: hit.inputTokens ?? 0,
          outputTokens: hit.outputTokens ?? 0,
          elapsedMs: 0,
          model,
          provider: this.provider.id,
        });
        return hit.response;
      }
    }

    const url = `${this.provider.baseUrl}/chat/completions`;
    const release = await this.acquire();
    let lastErr: unknown;
    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // Rotate to this attempt's fallback window (OpenRouter only). Lead the
        // payload's `model` with the window head to keep the two consistent.
        if (windows && windows.length) {
          const win = windows[(attempt - 1) % windows.length];
          payload.models = win;
          payload.model = win[0];
        }
        const started = Date.now();
        const controller = new AbortController();
        const abortTimer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
          if (!res.ok) {
            const body = await safeBody(res);
            if (RETRYABLE_STATUSES.has(res.status) && attempt < maxAttempts) {
              const wait = parseRetryAfter(res.headers.get('retry-after')) ?? backoff(attempt);
              if (this.debug) {
                console.error(
                  `[llm] ${this.provider.id} ${res.status} — retrying in ${wait}ms (attempt ${attempt}/${maxAttempts})`,
                );
              }
              await delay(wait);
              continue;
            }
            throw new LLMError(
              `LLM ${this.provider.id} returned ${res.status}: ${body.slice(0, 400)}`,
              res.status,
              body,
            );
          }
          const data = (await res.json()) as ChatCompletionResponse;
          const elapsed = Date.now() - started;
          const usage = data.usage ?? ({} as Partial<NonNullable<ChatCompletionResponse['usage']>>);
          // With a `models` fallback array, OpenRouter may serve a different
          // model than the primary — record what actually ran.
          const servedModel = data.model ?? model;
          this.usage.push({
            inputTokens: usage.prompt_tokens ?? 0,
            outputTokens: usage.completion_tokens ?? 0,
            elapsedMs: elapsed,
            model: servedModel,
            provider: this.provider.id,
          });
          const text = extractText(data);
          if (this.cache) {
            await this.cache.set(cacheKey, {
              ts: new Date().toISOString(),
              model: servedModel,
              provider: this.provider.id,
              response: text,
              inputTokens: usage.prompt_tokens,
              outputTokens: usage.completion_tokens,
            });
          }
          return text;
        } catch (err) {
          lastErr = err;
          if (err instanceof LLMError && err.status && !RETRYABLE_STATUSES.has(err.status)) throw err;
          if (attempt < maxAttempts) {
            await delay(backoff(attempt));
            continue;
          }
        } finally {
          clearTimeout(abortTimer);
        }
      }
      throw new LLMError(
        `LLM ${this.provider.id} failed after ${maxAttempts} attempts: ${String(lastErr)}`,
      );
    } finally {
      release();
    }
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.provider.apiKey) h['Authorization'] = `Bearer ${this.provider.apiKey}`;
    if (this.provider.id === 'openrouter') {
      // OpenRouter recommends these; harmless elsewhere.
      h['HTTP-Referer'] = process.env.REMEDY_OPENROUTER_REFERER ?? 'https://github.com/libretexts';
      h['X-Title'] = process.env.REMEDY_OPENROUTER_APP ?? 'libretexts-remedy';
    }
    return h;
  }
}

interface ChatCompletionResponse {
  /** The model OpenRouter actually served (may differ from primary on fallback). */
  model?: string;
  choices?: Array<{
    message?: { content?: string | ContentPart[]; reasoning_content?: string };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function extractText(data: ChatCompletionResponse): string {
  const msg = data.choices?.[0]?.message;
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content.trim();
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((p) => (p.type === 'text' ? p.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  if (typeof msg.reasoning_content === 'string') return msg.reasoning_content.trim();
  return '';
}

async function encodeImage(src: ImageSource): Promise<string> {
  if (src.kind === 'url') {
    if (/^https?:\/\//.test(src.url)) {
      // Providers like OpenRouter and Ollama accept URLs directly.
      return src.url;
    }
    // Already a data: URL.
    return src.url;
  }
  const b64 = Buffer.from(src.bytes).toString('base64');
  return `data:${src.mimeType};base64,${b64}`;
}

async function fetchImageAsBytes(url: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new LLMError(`Fetch image ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mime =
    res.headers.get('content-type')?.split(';')[0]?.trim() ||
    guessMimeTypeFromUrl(url) ||
    'image/png';
  return { bytes: buf, mimeType: mime };
}

export async function imageSourceFromUrl(url: string): Promise<ImageSource> {
  // Some providers (e.g. gemini-compat, ollama-local) do better with inline bytes.
  // Fetch once and embed; URL providers don't lose anything.
  const { bytes, mimeType } = await fetchImageAsBytes(url);
  return { kind: 'bytes', bytes, mimeType };
}

function guessMimeTypeFromUrl(url: string): string | undefined {
  const ext = url.match(/\.(png|jpe?g|gif|webp|svg|bmp|tiff?)(?:\?|$)/i)?.[1]?.toLowerCase();
  if (!ext) return undefined;
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'tif' || ext === 'tiff') return 'image/tiff';
  return `image/${ext}`;
}

async function safeBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function backoff(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 8000) + Math.floor(Math.random() * 200);
}

/**
 * Parse `Retry-After` per RFC 7231 — either a delta-seconds integer or an
 * HTTP-date string. Returns milliseconds or null when the header is absent
 * or malformed. Capped at 60s so a server-set Retry-After can't stall a
 * whole run indefinitely — escalate up the caller's retry budget instead.
 */
function parseRetryAfter(raw: string | null): number | null {
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 60_000);
  const when = Date.parse(raw);
  if (!Number.isNaN(when)) {
    const delta = when - Date.now();
    return delta > 0 ? Math.min(delta, 60_000) : 0;
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
