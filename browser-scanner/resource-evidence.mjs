import { createHash } from 'node:crypto';

export async function captureResourceResponse(response, assets, failed) {
  // Chromium exposes no body for redirects. The destination response is collected
  // separately, and a failed destination still enters the failure set.
  if ([301, 302, 303, 307, 308].includes(response.status()) && response.headers().location) return;
  const type = response.request().resourceType();
  if (response.status() >= 400 && ['GET', 'HEAD'].includes(response.request().method()) &&
      ['document', 'script', 'stylesheet', 'font', 'image', 'xhr', 'fetch'].includes(type)) {
    failed.add(response.url().split('?')[0]);
  }
  if (['script', 'stylesheet', 'image', 'font'].includes(type)) {
    try {
      const bytes = await response.body();
      assets.set(response.url(), createHash('sha256').update(bytes).digest('hex'));
    } catch {
      failed.add(response.url());
    }
  }
}
