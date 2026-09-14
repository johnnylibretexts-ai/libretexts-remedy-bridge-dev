import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { captureResourceResponse } from './resource-evidence.mjs';

test('redirected browser assets retain final evidence without false failures',
  { skip: process.env.RUN_BROWSER_TESTS !== '1' }, async () => {
    const server = createServer((req, res) => {
      if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); return res.end('<img src="/redirect-image"><script src="/redirect-script"></script><img src="/redirect-missing">'); }
      const targets = { '/redirect-image': '/image.svg', '/redirect-script': '/script.js', '/redirect-missing': '/missing.svg' };
      if (targets[req.url]) { res.writeHead(302, { Location: targets[req.url] }); return res.end(); }
      if (req.url === '/image.svg') { res.setHeader('Content-Type', 'image/svg+xml'); return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'); }
      if (req.url === '/script.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end('window.redirectScriptLoaded = true;'); }
      res.writeHead(404); res.end('Missing');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
      browser = await chromium.launch({ chromiumSandbox: true });
      const page = await browser.newPage(), assets = new Map(), failed = new Set(), pending = [];
      page.on('response', response => pending.push(captureResourceResponse(response, assets, failed)));
      const base = `http://127.0.0.1:${server.address().port}`;
      await page.goto(base, { waitUntil: 'load' });
      await Promise.all(pending);
      assert.equal(await page.locator('img').first().evaluate(img => img.naturalWidth), 10);
      assert.equal(await page.evaluate(() => window.redirectScriptLoaded), true);
      assert.ok(assets.has(base + '/image.svg'));
      assert.ok(assets.has(base + '/script.js'));
      assert.ok(failed.has(base + '/missing.svg'), 'Final HTTP failure remains reported');
      assert.equal(failed.has(base + '/redirect-image'), false, 'Successful image redirect is not a failure');
      assert.equal(failed.has(base + '/redirect-script'), false, 'Successful script redirect is not a failure');
    } finally {
      await browser?.close();
      await new Promise(resolve => server.close(resolve));
    }
  });
