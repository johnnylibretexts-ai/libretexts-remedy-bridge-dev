import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LlmCache, hashPayload, resolveCacheDir } from '../llm-cache.js';

describe('hashPayload', () => {
  it('produces a stable hex string', () => {
    const h = hashPayload({ model: 'x', messages: [{ role: 'user', content: 'hi' }] });
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is field-order independent', () => {
    const a = hashPayload({ model: 'x', temperature: 0.2, max_tokens: 100 });
    const b = hashPayload({ max_tokens: 100, temperature: 0.2, model: 'x' });
    expect(a).toBe(b);
  });

  it('distinguishes different payloads', () => {
    const a = hashPayload({ model: 'x', prompt: 'hi' });
    const b = hashPayload({ model: 'x', prompt: 'bye' });
    expect(a).not.toBe(b);
  });

  it('handles nested objects + arrays', () => {
    const payload = {
      messages: [
        { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:x' } }] },
      ],
    };
    expect(hashPayload(payload)).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('LlmCache', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'llm-cache-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns null on miss and records a miss', async () => {
    const cache = new LlmCache(dir);
    const hit = await cache.get('nonexistent-key');
    expect(hit).toBeNull();
    expect(cache.stats).toEqual({ hits: 0, misses: 1 });
  });

  it('round-trips a value', async () => {
    const cache = new LlmCache(dir);
    const entry = {
      ts: '2026-04-20T12:00:00Z',
      model: 'test-model',
      provider: 'ollama-cloud',
      response: 'cached response',
      inputTokens: 42,
      outputTokens: 7,
    };
    await cache.set('some-key', entry);
    const hit = await cache.get('some-key');
    expect(hit).toEqual(entry);
    expect(cache.stats).toEqual({ hits: 1, misses: 0 });
  });

  it('writes one file per key into the configured dir', async () => {
    const cache = new LlmCache(dir);
    await cache.set('aaa', {
      ts: '2026-04-20T12:00:00Z',
      model: 'm',
      provider: 'p',
      response: 'r1',
    });
    await cache.set('bbb', {
      ts: '2026-04-20T12:00:00Z',
      model: 'm',
      provider: 'p',
      response: 'r2',
    });
    const files = await readdir(dir);
    expect(files.sort()).toEqual(['aaa.json', 'bbb.json']);
  });
});

describe('resolveCacheDir', () => {
  it('returns explicit opt when provided', () => {
    expect(resolveCacheDir('/my/dir', {})).toBe('/my/dir');
  });

  it('falls back to REMEDY_LLM_CACHE_DIR env', () => {
    expect(resolveCacheDir(undefined, { REMEDY_LLM_CACHE_DIR: '/env/dir' })).toBe('/env/dir');
  });

  it('returns default .remedy/cache when REMEDY_LLM_CACHE=1', () => {
    expect(resolveCacheDir(undefined, { REMEDY_LLM_CACHE: '1' })).toBe('.remedy/cache');
  });

  it('returns undefined when nothing is set', () => {
    expect(resolveCacheDir(undefined, {})).toBeUndefined();
  });

  it('REMEDY_LLM_CACHE_DIR wins over REMEDY_LLM_CACHE=1', () => {
    expect(
      resolveCacheDir(undefined, { REMEDY_LLM_CACHE_DIR: '/specific', REMEDY_LLM_CACHE: '1' }),
    ).toBe('/specific');
  });
});
