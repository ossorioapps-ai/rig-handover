import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Night } from '../src/digest/types.js';

const line = (at: string, job: string, status: string, owner: string | null = 'ana') =>
  JSON.stringify({ at, job, status, owner });

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'rig-routes-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, '2026-11-01.jsonl'),
    [
      line('2026-11-01T01:00:00+01:00', 'zeta/job', 'ok'),
      line('2026-11-01T01:01:00+01:00', 'alpha/job', 'retry'),
      line('2026-11-01T01:02:00+01:00', 'alpha/job', 'ok'),
      line('2026-11-01T01:03:00+01:00', 'mid/job', 'ok'),
    ].join('\n') + '\n',
  );
  writeFileSync(join(dir, '2026-11-02.jsonl'), '');
  writeFileSync(
    join(dir, '2026-11-03.jsonl'),
    [
      line('2026-11-03T01:00:00+01:00', 'beta/job', 'ok'),
      'this is not json',
      line('2026-11-03T01:05:00+01:00', 'alpha/job', 'ok'),
    ].join('\n') + '\n',
  );
  app = createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir: dir,
  });
});

const jobsInPage = (html: string) =>
  [...html.matchAll(/<td>([a-z]+\/job)<\/td>/g)].map((m) => m[1]);

describe('GET /digest/:night', () => {
  it('200 for a normal night', async () => {
    const res = await app.request('/digest/2026-11-01');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('digest · 2026-11-01');
    expect(html).not.toContain('could not be read');
  });

  it('404 for a night with no file', async () => {
    const res = await app.request('/digest/2026-01-01');
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('no run log for that night');
  });

  it('empty night says nothing ran', async () => {
    const res = await app.request('/digest/2026-11-02');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('bad line is counted and good rows stay', async () => {
    const res = await app.request('/digest/2026-11-03');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('1 line could not be read');
    expect(jobsInPage(html)).toEqual(['alpha/job', 'beta/job']);
  });
});

describe('GET /api/digest/:night', () => {
  it('200 for a normal night', async () => {
    const res = await app.request('/api/digest/2026-11-01');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Night;
    expect(body.night).toBe('2026-11-01');
    expect(body.badLines).toBe(0);
    expect(body.rows).toHaveLength(3);
  });

  it('404 for a night with no file', async () => {
    const res = await app.request('/api/digest/2026-01-01');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log for that night', night: '2026-01-01' });
  });

  it('empty night has rows []', async () => {
    const res = await app.request('/api/digest/2026-11-02');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ night: '2026-11-02', rows: [], badLines: 0 });
  });

  it('bad line gives badLines 1 and keeps the good rows', async () => {
    const res = await app.request('/api/digest/2026-11-03');
    const body = (await res.json()) as Night;
    expect(res.status).toBe(200);
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['alpha/job', 'beta/job']);
  });
});

describe('page and JSON agree', () => {
  it.each(['2026-11-01', '2026-11-03'])('same jobs, same order for %s', async (night) => {
    const html = await (await app.request(`/digest/${night}`)).text();
    const body = (await (await app.request(`/api/digest/${night}`)).json()) as Night;
    expect(jobsInPage(html)).toEqual(body.rows.map((r) => r.job));
    expect(body.rows.length).toBeGreaterThan(0);
  });
});
