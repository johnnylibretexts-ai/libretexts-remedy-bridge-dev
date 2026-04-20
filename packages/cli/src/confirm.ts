import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export async function confirm(question: string, def: 'y' | 'n' = 'n'): Promise<boolean> {
  const hint = def === 'y' ? '[Y/n]' : '[y/N]';
  const rl = readline.createInterface({ input, output });
  try {
    const answer = (await rl.question(`${question} ${hint} `)).trim().toLowerCase();
    if (!answer) return def === 'y';
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}
