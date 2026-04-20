import { LLMClient } from './llm-client.js';

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

const SVG_PROMPT = `You are describing a rendered math image for a screen reader. Output a concise spoken form of the expression under 200 characters. Plain text only.`;

export interface MathDescribeOptions {
  client?: LLMClient;
  maxLength?: number;
}

export class MathDescriber {
  private client: LLMClient;
  private maxLength: number;

  constructor(opts: MathDescribeOptions = {}) {
    this.client = opts.client ?? new LLMClient();
    this.maxLength = opts.maxLength ?? 200;
  }

  async fromLatex(latex: string): Promise<string> {
    const prompt = LATEX_PROMPT.replace('{EXPR}', latex.trim().slice(0, 1200));
    const raw = await this.client.chat({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 256,
      temperature: 0.1,
    });
    return clean(raw, this.maxLength);
  }

  async fromMathML(mathml: string): Promise<string> {
    const prompt = MATHML_PROMPT.replace('{EXPR}', mathml.trim().slice(0, 4000));
    const raw = await this.client.chat({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 256,
      temperature: 0.1,
    });
    return clean(raw, this.maxLength);
  }

  async fromImage(imageUrl: string): Promise<string> {
    const { imageSourceFromUrl } = await import('./llm-client.js');
    const image = await imageSourceFromUrl(imageUrl);
    const raw = await this.client.vision({
      image,
      prompt: SVG_PROMPT,
      maxTokens: 256,
      temperature: 0.1,
    });
    return clean(raw, this.maxLength);
  }
}

function clean(s: string, max: number): string {
  const c = s.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, ' ');
  return c.length > max ? c.slice(0, max - 1).trimEnd() + '…' : c;
}
