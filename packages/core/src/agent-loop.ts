/**
 * Tier-3 agent loop for HTML accessibility remediation.
 *
 * Ported in spirit — not code — from project-remedy-server's
 * `vision_planner/agent_loop.py`. That loop fixes PDFs via veraPDF; this
 * one fixes HTML via our deterministic rules + axe findings.
 *
 * Contract, mirroring the Python version:
 *   - One mutating tool call per assistant turn.
 *   - Re-scan after every mutation; report delta back to the model.
 *   - Stop when findings reach zero, the budget is exhausted, or the model
 *     calls `finish`.
 *   - Never throw on LLM hiccups — we degrade gracefully and end the loop
 *     with `status: 'manual_review'`.
 *
 * Tool surface exposed to the model:
 *   - inspect_findings()       — current findings list (compact).
 *   - apply_rule_fix(ruleId)   — run that rule's fix() against current DOM.
 *   - set_attribute(selector, attr, value) — low-level DOM edit.
 *   - finish(status)           — end the loop.
 *
 * Transport: shared LLMClient tool turns, including provider fallback, timeout,
 * reasoning parameters and usage. JSON envelopes remain supported for models
 * that answer with text instead of native function calls.
 */
import { JSDOM } from 'jsdom';
import { LLMClient, type ChatMessage, type AssistantMessage } from './ai/llm-client.js';
import { defaultRules } from './rules/index.js';
import { scanHtmlFull } from './scan.js';
import type { Finding, PageRef, Rule } from './types.js';

export interface AgentLoopOptions {
  client: LLMClient;
  html: string;
  findings: Finding[];
  /** Max turns before we bail out. Default 8. */
  maxIterations?: number;
  /** Always 1 — enforced. Kept in the type for documentation. */
  maxMutationsPerTurn?: 1;
  /** Optional page context so rule.fix() can absolute-ize URLs, etc. */
  page?: PageRef;
  /** Custom rule list; defaults to the core rule set. */
  rules?: Rule[];
  env?: NodeJS.ProcessEnv;
  /** Emit debug logs to stderr. */
  debug?: boolean;
}

export interface AgentIterationRecord {
  turn: number;
  toolCalled?: string;
  appliedRule?: string;
  findingsAfter: number;
  note?: string;
}

export interface AgentLoopResult {
  finalHtml: string;
  iterations: AgentIterationRecord[];
}

const SYSTEM_PROMPT = `You are an HTML accessibility remediation agent. Your goal is to reduce the
current findings list to zero without introducing regressions.

Rules:
- Call exactly one mutating tool per turn (apply_rule_fix, set_heading_level or set_attribute).
- Read the updated findings list after each mutation before deciding the next move.
- If a mutation did not help, do not repeat it — try a different rule or a
  targeted set_attribute on the failing element's selector.
- Call finish with status="fixed" only when findings is empty.
- Call finish with status="manual_review" when you are stuck, the budget is
  exhausted, or remaining issues need human judgement.

Tools available:
- inspect_findings: Returns the current findings list (no arguments).
- apply_rule_fix(ruleId): Run that rule's fix() against the current DOM.
- set_attribute(selector, attr, value): Low-level edit on the first matching
  element. Use for narrow fixes (e.g. adding aria-label to a single <img>).
- set_heading_level(selector, level): Change an existing heading to h1–h6, preserving its content and attributes. Use for skipped heading levels.
- finish(status, reason): End the loop.

Respond with an OpenAI-format tool_calls array. If you cannot emit tool_calls
for some reason, instead respond with a single JSON object of shape:
  {"tool": "<name>", "args": {...}}
Do not mix text with tool calls — keep each turn small.`;

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'inspect_findings',
      description: 'Return the current findings list (compact).',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'apply_rule_fix',
      description:
        "Run a single rule's fix() method against the current DOM. Mutating. Re-scans automatically.",
      parameters: {
        type: 'object',
        properties: {
          ruleId: {
            type: 'string',
            description: 'ID of the rule to run, e.g. "img-alt", "heading-order".',
          },
        },
        required: ['ruleId'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'set_attribute',
      description:
        'Set an attribute on the first element matching a CSS selector. Mutating. Re-scans automatically.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector.' },
          attr: { type: 'string', description: 'Attribute name.' },
          value: { type: 'string', description: 'Attribute value.' },
        },
        required: ['selector', 'attr', 'value'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'set_heading_level',
      description: 'Change exactly one existing heading level while preserving its content and attributes. Mutating; rescans automatically.',
      parameters: {
        type: 'object',
        properties: { selector: { type: 'string' }, level: { type: 'integer', minimum: 1, maximum: 6 } },
        required: ['selector', 'level'], additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'finish',
      description: 'End the loop.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['fixed', 'manual_review'] },
          reason: { type: 'string' },
        },
        required: ['status'],
        additionalProperties: false,
      },
    },
  },
];

const MUTATING_TOOLS = new Set(['apply_rule_fix', 'set_attribute', 'set_heading_level']);

export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const maxIterations = opts.maxIterations ?? 8;
  const rules = opts.rules ?? defaultRules;
  const env = opts.env ?? process.env;
  const ruleById = new Map(rules.map((r) => [r.id, r]));

  let dom = new JSDOM(`<!doctype html><html><body>${opts.html}</body></html>`);
  let currentHtml = opts.html;
  let currentFindings: Finding[] = [...opts.findings];
  const iterations: AgentIterationRecord[] = [];
  const recentMessages: ChatMessage[] = [];
  let noProgressStreak = 0;
  let lastMutationSignature: string | null = null;


  for (let turn = 1; turn <= maxIterations; turn++) {
    if (currentFindings.length === 0) {
      iterations.push({ turn, findingsAfter: 0, note: 'findings-empty' });
      break;
    }
    if (noProgressStreak >= 2) {
      iterations.push({ turn, findingsAfter: currentFindings.length, note: 'no-progress-streak' });
      break;
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildTurnPrompt({
          turn,
          findings: currentFindings,
          html: currentHtml,
          iterations,
        }),
      },
      ...recentMessages,
    ];

    let assistant: AssistantMessage;
    try {
      assistant = await opts.client.chatTools({ messages, tools: TOOLS, maxTokens: 1024, temperature: 0.1 });
    } catch (err) {
      iterations.push({
        turn,
        findingsAfter: currentFindings.length,
        note: `llm-error: ${errorMessage(err)}`,
      });
      break;
    }

    const toolCalls = extractToolCalls(assistant);
    if (toolCalls.length === 0) {
      // Model emitted plain text with no tool call. Gently remind and
      // give it one more turn.
      iterations.push({
        turn,
        findingsAfter: currentFindings.length,
        note: 'no-tool-call',
      });
      recentMessages.push({
        role: 'assistant',
        content: typeof assistant.content === 'string' ? assistant.content : '',
      });
      recentMessages.push({
        role: 'user',
        content:
          'You must respond with a tool_call (or the JSON fallback). Do not reply with plain text.',
      });
      noProgressStreak += 1;
      continue;
    }

    // Enforce at most one mutation per turn.
    let mutatingSeen = false;
    let finishRequested: { status: string; reason?: string } | null = null;
    recentMessages.push(assistantMessageRecord(assistant, toolCalls));

    for (const call of toolCalls) {
      const { name, args } = call;

      if (name === 'finish') {
        finishRequested = {
          status: String(args?.status ?? 'manual_review'),
          reason: typeof args?.reason === 'string' ? args.reason : undefined,
        };
        iterations.push({
          turn,
          toolCalled: name,
          findingsAfter: currentFindings.length,
          note: `finish:${finishRequested.status}${finishRequested.reason ? ` (${finishRequested.reason})` : ''}`,
        });
        recentMessages.push(toolResponse(call.id, { ok: true, finishing: true }));
        break;
      }

      if (name === 'inspect_findings') {
        recentMessages.push(
          toolResponse(call.id, {
            ok: true,
            findings: compactFindings(currentFindings),
            count: currentFindings.length,
          }),
        );
        iterations.push({ turn, toolCalled: name, findingsAfter: currentFindings.length });
        continue;
      }

      if (MUTATING_TOOLS.has(name)) {
        if (mutatingSeen) {
          recentMessages.push(
            toolResponse(call.id, {
              ok: false,
              error: 'Only one mutating tool call allowed per turn.',
            }),
          );
          continue;
        }
        mutatingSeen = true;
        const signature = JSON.stringify({ name, args });
        if (signature === lastMutationSignature) {
          recentMessages.push(
            toolResponse(call.id, {
              ok: false,
              error: 'You already tried this exact mutation last turn and it did not help.',
            }),
          );
          noProgressStreak += 1;
          iterations.push({
            turn,
            toolCalled: name,
            findingsAfter: currentFindings.length,
            note: 'repeated-mutation-blocked',
          });
          continue;
        }
        lastMutationSignature = signature;

        const before = currentFindings.length;
        let mutationResult: { ok: boolean; note: string; appliedRule?: string };

        if (name === 'apply_rule_fix') {
          mutationResult = await runApplyRuleFix({
            ruleId: String(args?.ruleId ?? ''),
            doc: dom.window.document,
            findings: currentFindings,
            ruleById,
            page: opts.page,
            env,
          });
        } else if (name === 'set_heading_level') {
          mutationResult = runSetHeadingLevel(dom.window.document, String(args?.selector ?? ''), args?.level);
        } else {
          // set_attribute
          mutationResult = runSetAttribute({
            doc: dom.window.document,
            selector: String(args?.selector ?? ''),
            attr: String(args?.attr ?? ''),
            value: String(args?.value ?? ''),
          });
        }

        // Re-scan the DOM after the mutation.
        currentHtml = dom.window.document.body.innerHTML;
        currentFindings = await scanHtmlFull(currentHtml, { rules });
        const after = currentFindings.length;
        const improved = after < before;

        if (improved) noProgressStreak = 0;
        else noProgressStreak += 1;

        iterations.push({
          turn,
          toolCalled: name,
          appliedRule: mutationResult.appliedRule,
          findingsAfter: after,
          note: `${mutationResult.note}; delta ${before}→${after}`,
        });

        recentMessages.push(
          toolResponse(call.id, {
            ok: mutationResult.ok,
            note: mutationResult.note,
            before,
            after,
            delta: before - after,
            improved,
            findings: compactFindings(currentFindings),
          }),
        );

        // Rebuild JSDOM from the fresh HTML so further mutations see any
        // scan-induced normalization. Cheap for typical CXone page sizes.
        dom = new JSDOM(`<!doctype html><html><body>${currentHtml}</body></html>`);
        continue;
      }

      // Unknown tool.
      recentMessages.push(
        toolResponse(call.id, { ok: false, error: `Unknown tool '${name}'.` }),
      );
    }

    if (finishRequested) break;
    if (currentFindings.length === 0) {
      iterations.push({
        turn,
        findingsAfter: 0,
        note: 'findings-empty-after-mutation',
      });
      break;
    }

    // Trim recentMessages to keep context bounded.
    while (recentMessages.length > 16) {
      recentMessages.shift();
      while (recentMessages[0]?.role === 'tool') recentMessages.shift();
    }
  }

  return { finalHtml: currentHtml, iterations };
}

// ---------- helpers ----------

interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

function extractToolCalls(assistant: AssistantMessage): ToolCall[] {
  if (assistant.tool_calls && assistant.tool_calls.length > 0) {
    return assistant.tool_calls.map((tc, i) => ({
      id: tc.id ?? `call_${i}`,
      name: tc.function.name,
      args: parseJsonArgs(tc.function.arguments),
    }));
  }
  // Fallback: model emitted plain JSON {"tool": ..., "args": ...}.
  const content = assistant.content?.trim();
  if (!content) return [];
  const parsed = tryParseJson(content);
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    const name = typeof obj.tool === 'string' ? obj.tool : undefined;
    if (name) {
      return [
        {
          id: 'call_fallback',
          name,
          args: (obj.args as Record<string, unknown>) ?? {},
        },
      ];
    }
  }
  return [];
}

function parseJsonArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function tryParseJson(raw: string): unknown {
  // Accept bare JSON or ```json``` fenced blocks.
  const stripped = raw
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    return JSON.parse(stripped);
  } catch {
    // Try to find a JSON object substring.
    const m = stripped.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

function buildTurnPrompt(args: {
  turn: number;
  findings: Finding[];
  html: string;
  iterations: AgentIterationRecord[];
}): string {
  const compact = compactFindings(args.findings);
  const history = args.iterations.slice(-4).map((it) => ({
    turn: it.turn,
    tool: it.toolCalled ?? null,
    rule: it.appliedRule ?? null,
    findingsAfter: it.findingsAfter,
    note: it.note ?? null,
  }));
  const preview = args.html.length > 2000 ? args.html.slice(0, 2000) + '…' : args.html;
  const payload = {
    turn: args.turn,
    findings_count: args.findings.length,
    findings_sample: compact.slice(0, 25),
    recent_turns: history,
    html_preview: preview,
    instructions: [
      'Pick the highest-severity remaining finding.',
      'Prefer apply_rule_fix(ruleId) when the rule has a fix().',
      'Use set_attribute for surgical edits when rule-level fixes stall.',
      'Call finish when findings is empty or you are stuck.',
    ],
  };
  return JSON.stringify(payload, null, 2);
}

function compactFindings(findings: Finding[]): Array<Record<string, unknown>> {
  return findings.slice(0, 50).map((f) => ({
    ruleId: f.ruleId,
    severity: f.severity,
    message: f.message.slice(0, 160),
    selector: f.selector,
    fixable: f.fixable,
  }));
}

async function runApplyRuleFix({
  ruleId,
  doc,
  findings,
  ruleById,
  page,
  env,
}: {
  ruleId: string;
  doc: Document;
  findings: Finding[];
  ruleById: Map<string, Rule>;
  page?: PageRef;
  env: NodeJS.ProcessEnv;
}): Promise<{ ok: boolean; note: string; appliedRule?: string }> {
  const rule = ruleById.get(ruleId);
  if (!rule) return { ok: false, note: `unknown rule '${ruleId}'` };
  if (typeof rule.fix !== 'function') {
    return { ok: false, note: `rule '${ruleId}' has no fix()` };
  }
  const targets = findings.filter((f) => f.ruleId === ruleId);
  if (targets.length === 0) {
    return { ok: false, note: `no current findings for '${ruleId}'` };
  }
  const pageRef: PageRef = page ?? {
    id: 0,
    path: '',
    hostname: env.SERVER_DOMAIN ?? 'unknown',
  };
  let applied = 0;
  for (const f of targets) {
    try {
      const ok = await rule.fix(doc, f, { page: pageRef, env });
      if (ok) applied += 1;
    } catch (err) {
      if (env.DEBUG) console.error(`agent-loop apply_rule_fix ${ruleId} threw:`, err);
    }
  }
  return {
    ok: applied > 0,
    note: `applied ${applied}/${targets.length} ${ruleId} fix(es)`,
    appliedRule: ruleId,
  };
}

function runSetHeadingLevel(doc: Document, selector: string, level: unknown): { ok: boolean; note: string } {
  if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 6) return { ok: false, note: 'Heading level must be an integer from 1 to 6.' };
  let matches: NodeListOf<Element>;
  try { matches = doc.querySelectorAll(selector); } catch { return { ok: false, note: 'Invalid heading selector.' }; }
  if (matches.length !== 1 || !/^H[1-6]$/.test(matches[0].tagName)) return { ok: false, note: 'Select exactly one existing heading.' };
  const old = matches[0];
  const heading = doc.createElement(`h${level}`);
  for (const attribute of Array.from(old.attributes)) heading.setAttribute(attribute.name, attribute.value);
  while (old.firstChild) heading.appendChild(old.firstChild);
  old.replaceWith(heading);
  return { ok: true, note: `Changed ${selector} to h${level}, preserving content and attributes.` };
}

function runSetAttribute({
  doc,
  selector,
  attr,
  value,
}: {
  doc: Document;
  selector: string;
  attr: string;
  value: string;
}): { ok: boolean; note: string } {
  if (!selector || !attr) return { ok: false, note: 'missing selector or attr' };
  const lname = attr.toLowerCase();
  // Refuse obviously dangerous attributes: event handlers, srcdoc, and inline
  // style (which carries url()/expression() injection vectors).
  if (/^on/i.test(attr) || lname === 'srcdoc' || lname === 'style') {
    return { ok: false, note: `refused to set suspicious attribute '${attr}'` };
  }
  // For URL-bearing attributes, reject script/data-URI schemes so a (possibly
  // prompt-injected) model cannot persist javascript:/vbscript:/data: payloads
  // to the live page. Accessibility fixes never need these schemes.
  const URL_ATTRS = new Set([
    'href', 'src', 'formaction', 'action', 'xlink:href', 'poster', 'background', 'data', 'cite', 'longdesc',
  ]);
  if (URL_ATTRS.has(lname) || /-(href|src)$/.test(lname)) {
    const scheme = value.replace(/[\s\u0000-\u001f]/g, '').toLowerCase();
    if (
      scheme.startsWith('javascript:') ||
      scheme.startsWith('vbscript:') ||
      (scheme.startsWith('data:') && !scheme.startsWith('data:image/'))
    ) {
      return { ok: false, note: `refused dangerous URL value for attribute '${attr}'` };
    }
  }
  let el: Element | null;
  try {
    el = doc.querySelector(selector);
  } catch (err) {
    return { ok: false, note: `invalid selector: ${errorMessage(err)}` };
  }
  if (!el) return { ok: false, note: `no element matches '${selector}'` };
  el.setAttribute(attr, value);
  return { ok: true, note: `set ${attr}="${truncate(value, 60)}" on ${selector}` };
}

function assistantMessageRecord(msg: AssistantMessage, toolCalls: ToolCall[]): ChatMessage {
  // Preserve tool_calls on the assistant message so the transcript is valid
  // per OpenAI's function-calling contract (the provider needs to see both
  // the assistant tool call and the matching tool response).
  const record: ChatMessage = {
    role: 'assistant',
    content: typeof msg.content === 'string' ? msg.content : '',
    ...(msg.responseItems ? { responseItems: msg.responseItems } : {}),
  };
  if (msg.tool_calls && msg.tool_calls.length > 0) {
    record.tool_calls = msg.tool_calls;
  } else if (toolCalls.length > 0) {
    // Synthesize tool_calls for the JSON fallback so the next turn can
    // reference our tool response by id.
    record.tool_calls = toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: JSON.stringify(tc.args) },
    }));
  }
  return record;
}

function toolResponse(toolCallId: string, payload: unknown): ChatMessage {
  return {
    role: 'tool',
    tool_call_id: toolCallId,
    content: JSON.stringify(payload),
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
