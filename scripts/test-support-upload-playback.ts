import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function main() {
  const root = await mkdtemp(path.join(tmpdir(), 'botadmin-support-playback-'));
  process.env.UPLOADS_ROOT = root;
  try {
    await mkdir(path.join(root, 'support'));
    await writeFile(path.join(root, 'support', 'fixture.m4a'), Buffer.from('0123456789'));
    const { GET, HEAD } = await import('../app/uploads/[...path]/route');
    const context = { params: Promise.resolve({ path: ['support', 'fixture.m4a'] }) };
    const url = 'http://localhost/uploads/support/fixture.m4a';
    const full = await GET(new Request(url), context);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('content-type'), 'audio/mp4');
    assert.equal(await full.text(), '0123456789');
    for (const [range, expected, contentRange] of [
      ['bytes=2-5', '2345', 'bytes 2-5/10'],
      ['bytes=7-', '789', 'bytes 7-9/10'],
      ['bytes=-3', '789', 'bytes 7-9/10'],
    ]) {
      const result = await GET(new Request(url, { headers: { range } }), context);
      assert.equal(result.status, 206);
      assert.equal(result.headers.get('content-range'), contentRange);
      assert.equal(result.headers.get('content-length'), String(expected.length));
      assert.equal(await result.text(), expected);
    }
    const invalid = await GET(new Request(url, { headers: { range: 'bytes=99-' } }), context);
    assert.equal(invalid.status, 416);
    const head = await HEAD(new Request(url, { method: 'HEAD' }), context);
    assert.equal(head.headers.get('accept-ranges'), 'bytes');
    assert.equal(head.headers.get('content-type'), 'audio/mp4');
    console.log('Support audio MIME, full body, HEAD, ranges and 416: passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
