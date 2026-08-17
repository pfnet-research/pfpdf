/** Loopback HTTP server for renderer input and local resources. */
import fs from 'node:fs';
import http from 'node:http';
import type { Socket } from 'node:net';
import path from 'node:path';
import { RuntimeError } from './errors.js';
import type { ResourceManifest } from './resources.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.ttc': 'font/collection',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
};

export class AssetServer {
  private server: http.Server | null = null;
  private port = 0;
  private readonly sockets = new Set<Socket>();
  private readinessResult: { ok: boolean; message?: string } | null = null;
  private readonly readinessWaiters: Array<(result: { ok: boolean; message?: string }) => void> = [];
  private readonly gateResponses = new Set<{ request: http.IncomingMessage; response: http.ServerResponse }>();

  constructor(
    private readonly manifest: ResourceManifest,
    /** In-memory generated files: logical path -> content. */
    private readonly generated: Map<string, Buffer>,
  ) {}

  get documentUrl(): string {
    return `http://127.0.0.1:${this.port}/document.html`;
  }

  async waitUntilReady(deadline: number): Promise<void> {
    const result = this.readinessResult ?? await new Promise<{ ok: boolean; message?: string }>((resolve) => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        const expired = { ok: false, message: 'render deadline exceeded while waiting for document readiness' };
        this.completeReadiness(expired);
        resolve(expired);
        return;
      }
      const timer = setTimeout(() => {
        this.completeReadiness({ ok: false, message: 'render deadline exceeded while waiting for document readiness' });
      }, remaining);
      this.readinessWaiters.push((value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
    if (!result.ok) throw new RuntimeError(result.message ?? 'document readiness failed');
  }

  async start(): Promise<void> {
    if (this.server !== null) throw new RuntimeError('asset server is already running');
    const server = http.createServer(
      (req, res) => {
        this.handle(req, res);
      },
    );
    server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        resolve();
      });
    });
    const addr = server.address();
    if (addr === null || typeof addr === 'string') throw new RuntimeError('asset server failed to bind');
    this.port = addr.port;
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const responseHeaders: Record<string, string> = {
      'Cache-Control': 'no-store',
    };
    const fail = (code: number): void => {
      res.writeHead(code, responseHeaders);
      res.end();
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      fail(405);
      return;
    }
    const url = req.url ?? '';
    const qIdx = url.search(/[?#]/);
    const rawPath = qIdx >= 0 ? url.slice(0, qIdx) : url;
    let logical: string;
    try {
      logical = decodeURIComponent(rawPath.replace(/^\//, ''));
    } catch {
      fail(400);
      return;
    }
    const headers: Record<string, string> = { ...responseHeaders };
    if (logical === 'generated/readiness') {
      const params = new URL(url, 'http://127.0.0.1').searchParams;
      const ok = params.get('ok') === '1';
      const detail = params.get('message');
      this.completeReadiness(ok ? { ok } : {
        ok,
        message: detail === null || detail === '' ? 'document readiness failed' : `document readiness failed: ${detail}`,
      });
      res.writeHead(204, headers);
      res.end();
      return;
    }
    if (logical === 'generated/readiness-gate.svg') {
      this.serveReadinessGate(req, res, headers);
      return;
    }
    const gen = this.generated.get(logical);
    if (gen !== undefined) {
      const ext = path.extname(logical).toLowerCase();
      headers['Content-Type'] = MIME[ext] ?? 'application/octet-stream';
      headers['Content-Length'] = String(gen.length);
      res.writeHead(200, headers);
      if (req.method === 'HEAD') { res.end(); return; }
      res.end(gen);
      return;
    }
    const encodedLogical = logical.split('/').map((segment) => encodeURIComponent(segment)).join('/');
    const filePath = this.manifest.get(logical) ?? this.manifest.get(encodedLogical);
    if (filePath === undefined) {
      fail(404);
      return;
    }
    let st: fs.Stats;
    try {
      st = fs.statSync(filePath);
    } catch {
      fail(404);
      return;
    }
    if (!st.isFile()) {
      fail(403);
      return;
    }
    // Docker bind targets intentionally omit extensions; the renderer-visible
    // logical URL is the common MIME contract for local and Docker modes.
    const ext = path.extname(logical).toLowerCase();
    headers['Content-Type'] = MIME[ext] ?? 'application/octet-stream';

    const range = req.headers.range;
    let start = 0;
    let end = st.size - 1;
    let status = 200;
    if (typeof range === 'string') {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m || (m[1] === '' && m[2] === '')) {
        headers['Content-Range'] = `bytes */${st.size}`;
        res.writeHead(416, headers);
        res.end();
        return;
      }
      if (m[1] === '') {
        start = Math.max(0, st.size - Number(m[2]));
      } else {
        start = Number(m[1]);
        if (m[2] !== '') end = Math.min(end, Number(m[2]));
      }
      if (start > end || start >= st.size) {
        headers['Content-Range'] = `bytes */${st.size}`;
        res.writeHead(416, headers);
        res.end();
        return;
      }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    }
    headers['Content-Length'] = String(end - start + 1);
    headers['Accept-Ranges'] = 'bytes';
    res.writeHead(status, headers);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    if (st.size === 0) {
      res.end();
      return;
    }
    const stream = fs.createReadStream(filePath, { start, end });
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    if (this.readinessResult === null) {
      this.completeReadiness({ ok: false, message: 'asset server stopped before document readiness completed' });
    }
    this.server = null;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        for (const s of this.sockets) s.destroy();
        resolve();
      }, 2000).unref();
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private completeReadiness(result: { ok: boolean; message?: string }): void {
    if (this.readinessResult !== null) return;
    this.readinessResult = result;
    for (const resolve of this.readinessWaiters.splice(0)) resolve(result);
    for (const gate of this.gateResponses) {
      if (gate.response.destroyed) continue;
      const body = result.ok
        ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>')
        : Buffer.alloc(0);
      gate.response.writeHead(result.ok ? 200 : 500, {
        'Cache-Control': 'no-store',
        'Content-Type': 'image/svg+xml',
        'Content-Length': String(body.length),
      });
      if (gate.request.method === 'HEAD') gate.response.end();
      else gate.response.end(body);
    }
    this.gateResponses.clear();
  }

  private serveReadinessGate(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    headers: Record<string, string>,
  ): void {
    if (this.readinessResult !== null) {
      const body = this.readinessResult.ok
        ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>')
        : Buffer.alloc(0);
      response.writeHead(this.readinessResult.ok ? 200 : 500, {
        ...headers,
        'Content-Type': 'image/svg+xml',
        'Content-Length': String(body.length),
      });
      if (request.method === 'HEAD') response.end();
      else response.end(body);
      return;
    }
    const gate = { request, response };
    this.gateResponses.add(gate);
    response.once('close', () => this.gateResponses.delete(gate));
  }
}
