import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { AssetServer } from '../assetserver.js';
import { ResourceManifest } from '../resources.js';
import { RuntimeError } from '../errors.js';

interface Response {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function request(url: string, options: http.RequestOptions = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test('asset server serves exact files and ranges', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfpdf-server-'));
  const file = path.join(dir, 'asset.bin');
  fs.writeFileSync(file, Buffer.from('abcdef'));
  const empty = path.join(dir, 'empty.bin');
  fs.writeFileSync(empty, Buffer.alloc(0));
  const manifest = new ResourceManifest();
  const logical = manifest.add(file);
  const emptyLogical = manifest.add(empty);
  const dockerStyleLogical = manifest.addExplicit('assets/image.svg', file);
  const server = new AssetServer(manifest, new Map([['document.html', Buffer.from('<p>ok</p>')]]));
  await server.start();
  try {
    const document = await request(server.documentUrl);
    assert.equal(document.status, 200);
    assert.equal(document.body.toString(), '<p>ok</p>');
    assert.equal(document.headers['cache-control'], 'no-store');

    const ranged = await request(new URL(logical, server.documentUrl).href, { headers: { Range: 'bytes=1-3' } });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.body.toString(), 'bcd');
    assert.equal(ranged.headers['content-range'], 'bytes 1-3/6');

    const dockerStyle = await request(new URL(dockerStyleLogical, server.documentUrl).href);
    assert.equal(dockerStyle.headers['content-type'], 'image/svg+xml');

    const emptyResponse = await request(new URL(emptyLogical, server.documentUrl).href);
    assert.equal(emptyResponse.status, 200);
    assert.equal(emptyResponse.body.length, 0);

  } finally {
    await server.stop();
  }
});

test('readiness signal releases the renderer gate', async () => {
  const server = new AssetServer(new ResourceManifest(), new Map([['document.html', Buffer.from('ok')]]));
  await server.start();
  try {
    const documentUrl = new URL(server.documentUrl);
    const tokenBase = new URL('./', documentUrl);
    const ready = server.waitUntilReady(Date.now() + 2000);
    const gate = request(new URL('generated/readiness-gate.svg', tokenBase).href);
    const signal = await request(new URL('generated/readiness?ok=1', tokenBase).href);
    assert.equal(signal.status, 204);
    await ready;
    const gateResponse = await gate;
    assert.equal(gateResponse.status, 200);
    assert.equal(gateResponse.headers['content-type'], 'image/svg+xml');
  } finally {
    await server.stop();
  }
});

test('readiness failure and timeout reject and release the gate', async () => {
  for (const signal of ['generated/readiness?ok=0', null]) {
    const server = new AssetServer(new ResourceManifest(), new Map([['document.html', Buffer.from('ok')]]));
    await server.start();
    try {
      const root = new URL('./', server.documentUrl);
      const gate = request(new URL('generated/readiness-gate.svg', root).href);
      const ready = server.waitUntilReady(Date.now() + (signal === null ? 30 : 2000));
      const rejected = assert.rejects(ready, RuntimeError);
      if (signal !== null) await request(new URL(signal, root).href);
      await rejected;
      assert.equal((await gate).status, 500);
    } finally {
      await server.stop();
    }
  }
});
