import { Resvg } from '@resvg/resvg-js';
import { LLMClient, type ImageSource } from './llm-client.js';

const LATEX_PROMPT = `You are an accessibility editor writing a spoken-form description of a math expression for a screen reader.

Rules:
- Read the math the way a teacher would say it out loud.
- Do NOT read the LaTeX/MathML syntax literally (no backslashes, no "frac").
- Keep it under 200 characters.
- Don't include quotes or markdown — output plain text only.

Examples:
- \\frac{a}{b}  →  a over b
- x^2 + y^2 = r^2  →  x squared plus y squared equals r squared
- \\int_0^1 f(x)\\,dx  →  the integral from zero to one of f of x, dx

Expression:
{EXPR}

Output only the spoken form.`;

const MATHML_PROMPT = `Same rules as above but the input is presentation MathML.

MathML:
{EXPR}`;

const SVG_PROMPT = `You are describing a rendered math expression for a screen reader.

Rules:
- Output the spoken form a teacher would say aloud.
- Keep it under 200 characters.
- Do not say "image", "picture", or "equation shown".
- Do not include quotes or markdown.
- Plain text only.`;

const REPAIR_PROMPT = `Rewrite this math screen-reader description so it is concise and under {MAX} characters.

Rules:
- Preserve the meaning.
- Use the spoken form a teacher would say aloud.
- Do not include quotes or markdown.
- Output plain text only.

Candidate:
{CANDIDATE}`;

export interface MathDescribeOptions {
  client?: LLMClient;
  maxLength?: number;
  consumeLlmCall?: () => boolean;
}

export class MathDescriber {
  private client: LLMClient;
  private maxLength: number;
  private consumeLlmCall?: () => boolean;

  constructor(opts: MathDescribeOptions = {}) {
    this.client = opts.client ?? new LLMClient();
    this.maxLength = opts.maxLength ?? 200;
    this.consumeLlmCall = opts.consumeLlmCall;
  }

  async fromLatex(latex: string): Promise<string> {
    const prompt = LATEX_PROMPT.replace('{EXPR}', latex.trim().slice(0, 1200));
    const raw = await this.chat({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 256,
      temperature: 0.1,
    });
    return this.cleanOrRepair(raw);
  }

  async fromMathML(mathml: string): Promise<string> {
    const prompt = MATHML_PROMPT.replace('{EXPR}', mathml.trim().slice(0, 4000));
    const raw = await this.chat({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 256,
      temperature: 0.1,
    });
    return this.cleanOrRepair(raw);
  }

  async fromImage(imageUrl: string): Promise<string> {
    const { imageSourceFromUrl } = await import('./llm-client.js');
    const image = await imageSourceFromUrl(imageUrl);
    const raw = await this.vision(image);
    return this.cleanOrRepair(raw);
  }

  async fromSvg(svg: string): Promise<string> {
    const normalized = normalizeSvg(svg);
    const png = rasterizeSvg(normalized);
    const image: ImageSource = {
      kind: 'bytes',
      bytes: png,
      mimeType: 'image/png',
    };
    const raw = await this.vision(image);
    return this.cleanOrRepair(raw);
  }

  private async chat(req: Parameters<LLMClient['chat']>[0]): Promise<string> {
    if (this.consumeLlmCall && !this.consumeLlmCall()) {
      throw new Error('LLM budget exhausted.');
    }
    return this.client.chat(req);
  }

  private async vision(image: ImageSource): Promise<string> {
    if (this.consumeLlmCall && !this.consumeLlmCall()) {
      throw new Error('LLM budget exhausted.');
    }
    return this.client.vision({
      image,
      prompt: SVG_PROMPT,
      maxTokens: 256,
      temperature: 0.1,
    });
  }

  private async cleanOrRepair(raw: string): Promise<string> {
    try {
      return clean(raw, this.maxLength);
    } catch (err) {
      if (!isOverlongDescriptionError(err)) throw err;
      const repaired = await this.chat({
        messages: [{
          role: 'user',
          content: REPAIR_PROMPT
            .replace('{MAX}', String(this.maxLength))
            .replace('{CANDIDATE}', raw.trim().slice(0, 2000)),
        }],
        maxTokens: 128,
        temperature: 0.1,
      });
      return clean(repaired, this.maxLength);
    }
  }
}

function clean(s: string, max: number): string {
  const c = s.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, ' ');
  if (!c) throw new Error('LLM returned empty math description.');
  if (c.length > max) throw new Error(`LLM math description exceeded ${max} characters.`);
  return c;
}

function isOverlongDescriptionError(err: unknown): boolean {
  return err instanceof Error && /exceeded \d+ characters/.test(err.message);
}

function normalizeSvg(svg: string): string {
  let trimmed = svg.trim();
  if (!trimmed) throw new Error('Rendered math SVG is empty.');
  trimmed = trimmed.replace(/\sviewbox=/i, ' viewBox=');
  if (!/\sxmlns=/.test(trimmed)) {
    trimmed = trimmed.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (!/\scolor=/.test(trimmed)) {
    trimmed = trimmed.replace('<svg', '<svg color="black"');
  }
  return trimmed;
}

function rasterizeSvg(svg: string): Buffer {
  const viewBox = parseViewBox(svg);
  const height = viewBox
    ? Math.min(256, Math.max(96, Math.round(viewBox.height * 3)))
    : 128;
  const renderer = new Resvg(svg, {
    fitTo: { mode: 'height', value: height },
    background: 'white',
    logLevel: 'off',
  });
  const image = renderer.render();
  return image.asPng();
}

function parseViewBox(svg: string): { width: number; height: number } | undefined {
  const raw = svg.match(/\sviewBox=(["'])([^"']+)\1/)?.[2];
  if (!raw) return undefined;
  const parts = raw.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return undefined;
  const [, , width, height] = parts;
  if (width <= 0 || height <= 0) return undefined;
  return { width, height };
}
