import { afterEach, expect, it, vi } from 'vitest';
import { LLMClient } from '../ai/llm-client.js';
import { runAgentLoop } from '../agent-loop.js';

afterEach(() => vi.unstubAllGlobals());
it('Tier 3 uses shared fallback, native tools, reasoning parameters and usage', async () => {
  const tool = { id: 'call_finish', type: 'function', function: { name: 'finish', arguments: '{"status":"manual_review","reason":"Human judgment needed"}' } };
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('down', { status: 503 })).mockResolvedValueOnce(new Response(JSON.stringify({ model: 'fallback-model', status: 'completed', output: [{ type: 'function_call', call_id: tool.id, ...tool.function }], usage: { input_tokens: 10, output_tokens: 25 } })));
  vi.stubGlobal('fetch', fetcher);
  const client = new LLMClient({ provider: 'ollama-cloud', apiKey: 'test', textModel: 'primary', maxRetries: 1, fallback: { provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'fallback', textModel: 'fallback-model', reasoningEffort: 'high', reasoningTokenBudget: 8192, maxRetries: 1 } });
  const result = await runAgentLoop({ client, html: '<p>Read this</p>', findings: [{ ruleId: 'test', message: 'Manual review', severity: 'warning', selector: 'p', fixable: false }] as any, maxIterations: 2 });
  expect(result.finalHtml).toBe('<p>Read this</p>');
  expect(result.iterations[0].toolCalled).toBe('finish');
  expect(fetcher).toHaveBeenCalledTimes(2);
  const payload = JSON.parse(fetcher.mock.calls[1][1].body);
  expect(payload.tools).toHaveLength(4); expect(payload.reasoning.effort).toBe('high');
  expect(fetcher.mock.calls[1][0]).toBe('https://api.openai.com/v1/responses');
  expect(payload.store).toBe(false);
  expect(payload.max_output_tokens).toBe(9216); expect(payload.temperature).toBeUndefined();
  expect(client.usage[0].provider).toBe('openai');
});
it('tool refusals do not fall back and tool replies remain intact', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { refusal: 'Declined' } }] })));
  vi.stubGlobal('fetch', fetcher);
  const client = new LLMClient({ provider: 'ollama-cloud', maxRetries: 1, fallback: { provider: 'openai', apiKey: 'test' } });
  await expect(client.chatTools({ messages: [{ role: 'tool', tool_call_id: 'call1', content: '{"ok":true}' }], tools: [] })).rejects.toThrow('declined');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetcher.mock.calls[0][1].body).messages[0].tool_call_id).toBe('call1');
});
it('Responses replays encrypted reasoning and tool results without leaking Responses items to Ollama', async () => {
  const items = [{ type: 'reasoning', id: 'rs_test', summary: [], encrypted_content: 'opaque-encrypted' }, { type: 'function_call', call_id: 'call_inspect', name: 'inspect_findings', arguments: '{}' }];
  const response = () => new Response(JSON.stringify({ status: 'completed', model: 'fallback', output: items }));
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('down', { status: 503 })).mockResolvedValueOnce(response())
    .mockResolvedValueOnce(new Response('down', { status: 503 })).mockResolvedValueOnce(response());
  vi.stubGlobal('fetch', fetcher);
  const client = new LLMClient({ provider: 'ollama-cloud', maxRetries: 1, fallback: { provider: 'openai', apiKey: 'test', maxRetries: 1 } });
  const first = await client.chatTools({ messages: [{ role: 'user', content: 'Inspect' }], tools: [] });
  await client.chatTools({ messages: [{ role: 'assistant', content: '', tool_calls: first.tool_calls, responseItems: first.responseItems }, { role: 'tool', tool_call_id: 'call_inspect', content: '{"findings":[]}' }], tools: [] });
  expect(JSON.parse(fetcher.mock.calls[2][1].body).messages[0].responseItems).toBeUndefined();
  expect(JSON.parse(fetcher.mock.calls[3][1].body).input).toEqual([...items, { type: 'function_call_output', call_id: 'call_inspect', output: '{"findings":[]}' }]);
});
