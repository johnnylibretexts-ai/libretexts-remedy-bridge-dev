import { afterEach, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { imageSourceFromUrl } from '../llm-client.js';
afterEach(() => vi.unstubAllGlobals());
it('normalizes static GIF to PNG for vision inference', async () => {
  const gif = await sharp({ create: { width: 10, height: 20, channels: 3, background: '#f00' } }).gif().toBuffer();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(gif, { headers: { 'content-type': 'image/gif' } })));
  const image = await imageSourceFromUrl('https://bio.libretexts.org/diagram.gif');
  expect(image.kind).toBe('bytes');
  if (image.kind !== 'bytes') throw Error('Expected bytes');
  expect(image.mimeType).toBe('image/png');
  const metadata = await sharp(image.bytes).metadata();
  expect(metadata.width).toBe(10); expect(metadata.height).toBe(20);
});
it('rejects animated GIF instead of silently describing one frame', async () => {
  const gif = await sharp({ create: { width: 10, height: 20, channels: 3, background: '#f00' } }).gif().toBuffer();
  // Two-frame fixture assembled by repeating the image descriptor + pixels.
  const start = gif.indexOf(0x2c);
  const animated = Buffer.concat([gif.subarray(0, gif.length - 1), gif.subarray(start, gif.length - 1), Buffer.from([0x3b])]);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(animated, { headers: { 'content-type': 'image/gif' } })));
  await expect(imageSourceFromUrl('https://bio.libretexts.org/diagram.gif')).rejects.toThrow('manual review');
});
