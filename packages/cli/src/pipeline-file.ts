import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, resolve, extname } from 'node:path';
import { runLocalPipeline, type LocalPipelineOptions } from '@libretexts/remedy-core';
import kleur from 'kleur';

export interface PipelineFileCliOpts {
  out?: string;
  only?: string;
  maxLlm?: string;
  json?: boolean;
}

export async function pipelineFile(file: string, opts: PipelineFileCliOpts): Promise<number> {
  const inputPath = resolve(file);
  const html = await readFile(inputPath, 'utf8');

  const name = basename(file, extname(file));
  const outDir = resolve(opts.out ?? `.remedy/local/${name}`);

  const pipelineOpts: LocalPipelineOptions = {
    maxLlmCalls: opts.maxLlm !== undefined ? Number(opts.maxLlm) : undefined,
    onlyRuleIds: opts.only ? opts.only.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
  };

  const result = await runLocalPipeline(html, pipelineOpts);

  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeFile(`${outDir}/before.html`, result.beforeHtml, 'utf8'),
    writeFile(`${outDir}/after.html`, result.afterHtml, 'utf8'),
    writeFile(`${outDir}/diff.txt`, result.diff, 'utf8'),
    writeFile(`${outDir}/findings-before.json`, JSON.stringify(result.findingsBefore, null, 2), 'utf8'),
    writeFile(`${outDir}/findings-after.json`, JSON.stringify(result.findingsAfter, null, 2), 'utf8'),
    writeFile(
      `${outDir}/report.json`,
      JSON.stringify(
        {
          strategyReports: result.strategyReports,
          bytePreserved: result.bytePreserved,
          fallbackReason: result.fallbackReason,
          splicesApplied: result.splicesApplied,
          elapsedMs: result.elapsedMs,
        },
        null,
        2,
      ),
      'utf8',
    ),
  ]);

  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        {
          outDir,
          findingsBefore: result.findingsBefore.length,
          findingsAfter: result.findingsAfter.length,
          bytePreserved: result.bytePreserved,
          fallbackReason: result.fallbackReason,
          splicesApplied: result.splicesApplied,
          elapsedMs: result.elapsedMs,
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    console.log(kleur.cyan(`→ ${outDir}`));
    console.log(`  findings: ${result.findingsBefore.length} → ${result.findingsAfter.length}`);
    console.log(
      `  bytePreserved: ${result.bytePreserved}${result.fallbackReason ? ` (fallback: ${result.fallbackReason})` : ''}`,
    );
    if (result.splicesApplied !== undefined) console.log(`  splices: ${result.splicesApplied}`);
    console.log(`  elapsed: ${result.elapsedMs}ms`);
  }

  // Always return 0 — local pipeline is informational, not a gate.
  return 0;
}
