import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// SDK 1.7.0 omits the charset on page-content POSTs. CXone's documented
// text/plain contract requires UTF-8 for non-ASCII descriptions and math.
// Keep this compatibility patch narrow and fail closed on SDK layout changes.
const require = createRequire(import.meta.url);
const dist = dirname(require.resolve('@libretexts/cxone-expert-node'));
const metadata = JSON.parse(await readFile(join(dist, '..', 'package.json'), 'utf8'));
if (metadata.version !== '1.7.0') throw new Error('Review the CXone UTF-8 compatibility patch before changing SDK versions.');
for (const file of ['index.mjs', 'index.cjs']) {
  const path = join(dist, file), source = await readFile(path, 'utf8');
  const start = source.indexOf('async postPageContents('), end = source.indexOf('async putPageUnorder(', start);
  if (start < 0 || end < start) throw new Error('Unexpected CXone page writer layout.');
  const method = source.slice(start, end);
  if (method.includes('text/plain; charset=utf-8')) continue;
  const matches = [...method.matchAll(/(["`])text\/plain\1/g)];
  if (matches.length !== 1) throw new Error('Unexpected CXone page writer content type.');
  const patched = method.replace(/(["`])text\/plain\1/, '$1text/plain; charset=utf-8$1');
  await writeFile(path, source.slice(0, start) + patched + source.slice(end));
}
