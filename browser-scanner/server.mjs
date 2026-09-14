import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { chromium } from 'playwright';
import axe from 'axe-core';
import { pageURL, allowedRequest, publicIPv4 } from './policy.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const hosts = new Set((process.env.RENDER_ALLOWED_HOSTS || 'dev.libretexts.org,cdn.libretexts.net,cdn.jsdelivr.net,cdnjs.cloudflare.com,fonts.googleapis.com,fonts.gstatic.com,use.fontawesome.com').split(',').map(s=>s.trim()));
const token = process.env.RENDER_SCANNER_TOKEN;
if (!token) throw Error('RENDER_SCANNER_TOKEN required');
let busy = false;
export async function scan(raw) {
  const url = pageURL(raw);
  // Pin approved public DNS answers for the lifetime of this browser; no private-network access.
  const rules = [];
  for (const host of hosts) {
    const addresses = await lookup(host, { all: true, family: 4 });
    if (!addresses.length || addresses.some(a => !publicIPv4(a.address))) throw Error('Non-public resource host.');
    rules.push(`MAP ${host} ${addresses[0].address}`);
  }
  const browser = await chromium.launch({ chromiumSandbox: true, args: [`--host-resolver-rules=${rules.join(',')},MAP * ~NOTFOUND`] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', acceptDownloads: false });
  const blocked = new Set(), failed = new Set(), assets = new Map(), pending = [];
  await context.route('**/*', route => {
    const req = route.request();
    if (!allowedRequest(req.url(), hosts, req.method())) { blocked.add(req.url().split('?')[0]); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('requestfailed', req => { if (['document','script','stylesheet','font','image'].includes(req.resourceType())) failed.add(req.url().split('?')[0]); });
  page.on('response', response => {
    const type = response.request().resourceType();
    if (['script','stylesheet'].includes(type)) pending.push(response.body().then(b=>assets.set(response.url(),hash(b))).catch(()=>failed.add(response.url())));
    if (response.status() >= 400 && ['document','script','stylesheet','font','image'].includes(type)) failed.add(response.url().split('?')[0]);
  });
  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    if (!response?.ok() || decodeURIComponent(new URL(pageURL(page.url())).pathname) !== decodeURIComponent(new URL(url).pathname)) throw Error('Reader page unavailable or redirected.');
    const content = page.locator('#mt-content-container');
    if (!await content.count() || (await content.innerText()).trim().length < 20 || await page.locator('input[type=password]').count()) throw Error('Reader content not available without authentication.');
    // MathJax v2 queue and v3/v4 startup promise. Timeout is an incomplete scan, never a pass.
    const math = await Promise.race([page.evaluate(async () => {
      const m = window.MathJax;
      if (m?.Hub?.Queue) await new Promise(resolve => m.Hub.Queue(resolve));
      else if (m?.startup?.promise) await m.startup.promise;
      await document.fonts.ready;
      const raw = document.querySelectorAll('script[type^="math/tex"], .lt-math');
      const rendered = document.querySelectorAll('math, mjx-container, .MathJax');
      if (raw.length && !rendered.length) throw Error('MathJax did not render math.');
      if (document.querySelector('.MathJax_Error, mjx-merror, [data-mjx-error]')) throw Error('MathJax reported a rendering error.');
      return { version: m?.version || null, mathCount: rendered.length,
        mathSamples: [...document.querySelectorAll('math')].slice(0,10).map(x=>x.outerHTML.slice(0,3000)) };
    }), new Promise((_,reject)=>setTimeout(()=>reject(Error('MathJax readiness timeout.')),30000))]);
    await page.addScriptTag({ content: axe.source });
    const results = await page.evaluate(async () => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa'] } }));
    await Promise.allSettled(pending);
    const renderedHash = hash(await content.innerHTML());
    const platformHash = hash(JSON.stringify([...assets.entries()].sort()));
    const compact = r => ({ id:r.id, impact:r.impact, description:r.description, helpUrl:r.helpUrl, tags:r.tags,
      nodes:r.nodes.map(n=>({ target:n.target, html:n.html, failureSummary:n.failureSummary,
        checks:[...n.any,...n.all,...n.none].map(c=>({id:c.id,message:c.message})) })) });
    return { state: blocked.size || failed.size ? 'incomplete' : 'complete', scannedAt:new Date().toISOString(),
      url, scope:'full-reader-page', viewport:{width:1280,height:900}, browser:browser.version(), axeVersion:axe.version,
      renderedHash, platformHash, math, blockedResources:[...blocked], failedResources:[...failed],
      violations:results.violations.map(compact), incomplete:results.incomplete.map(compact),
      passedRules:results.passes.map(r=>r.id), inapplicableRules:results.inapplicable.map(r=>r.id),
      humanChecksRequired:['Mathematical meaning and navigation with screen reader','No duplicate math announcements','Keyboard and complete processes','Reflow, zoom and text spacing','Visual and linguistic review'] };
  } finally { await context.close(); await browser.close(); }
}
createServer(async (req,res) => {
  res.setHeader('Content-Type','application/json');
  if (req.url === '/healthz' && req.method === 'GET') return res.end(JSON.stringify({ok:true,busy}));
  const received = Buffer.from(req.headers.authorization || ''), expected = Buffer.from(`Bearer ${token}`);
  if (received.length !== expected.length || !timingSafeEqual(received,expected)) { res.statusCode=401; return res.end('{}'); }
  if (req.url !== '/scan' || req.method !== 'POST') { res.statusCode=404; return res.end('{}'); }
  if (busy) { res.statusCode=429; return res.end(JSON.stringify({error:'Scanner busy. Retry shortly.'})); }
  busy=true;
  try {
    let body=''; for await (const chunk of req) { body+=chunk; if(body.length>4096) throw Error('Request too large.'); }
    res.end(JSON.stringify(await scan(JSON.parse(body).url)));
  } catch(e) { res.statusCode=422; res.end(JSON.stringify({state:'error',error:e.message})); }
  finally { busy=false; }
}).listen(5180,'0.0.0.0');
