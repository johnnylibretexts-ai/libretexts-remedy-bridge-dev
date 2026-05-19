import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type Expert from '@libretexts/cxone-expert-node';
import { writePageRevision } from '../write-page.js';

describe('writePageRevision', () => {
  it('writes through shared guardrails and records snapshot/audit metadata', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'remedy-write-page-'));
    const calls: unknown[] = [];
    const expert = {
      pages: {
        postPageContents: async (...args: unknown[]) => {
          calls.push(args);
          return { page: { '@revision': '42' } };
        },
      },
    } as unknown as Expert;

    try {
      const result = await writePageRevision({
        expert,
        pageInput: 123,
        page: {
          id: 123,
          path: 'Sandboxes/Test/Page',
          hostname: 'dev.libretexts.org',
        },
        beforeHtml: '<p>Before</p>',
        afterHtml: '<p>After</p>',
        rules: ['img-alt'],
        revisionSummary: 'Remedy test write',
        source: 'pipeline',
        env: {
          REMEDY_WRITE_ALLOWLIST: '^Sandboxes/',
          REMEDY_SNAPSHOT_DIR: join(dir, 'snapshots'),
          REMEDY_AUDIT_LOG: join(dir, 'audit.log'),
          USER: 'tester',
        },
      });

      expect(result.written).toBe(true);
      expect(result.snapshotPath).toMatch(/\.json$/);
      expect(result.cxoneRevisionId).toBe('42');
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual([
        123,
        '<p>After</p>',
        expect.objectContaining({ comment: 'Remedy test write' }),
      ]);

      const audit = JSON.parse((await readFile(join(dir, 'audit.log'), 'utf8')).trim());
      expect(audit).toMatchObject({
        rules: ['img-alt'],
        mode: 'apply',
        revisionSummary: 'Remedy test write',
        snapshotPath: result.snapshotPath,
        cxoneRevisionId: '42',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not write when the preview has no content changes', async () => {
    const expert = {
      pages: {
        postPageContents: async () => {
          throw new Error('should not write');
        },
      },
    } as unknown as Expert;

    const result = await writePageRevision({
      expert,
      pageInput: 123,
      page: {
        id: 123,
        path: 'Sandboxes/Test/Page',
        hostname: 'dev.libretexts.org',
      },
      beforeHtml: '<p>No change</p>',
      afterHtml: '<p>No change</p>',
      rules: [],
      revisionSummary: 'No-op',
      source: 'fix',
    });

    expect(result).toEqual({ written: false, revisionSummary: 'No-op' });
  });
});
