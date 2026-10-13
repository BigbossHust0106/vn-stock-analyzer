import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import worker from '../worker/src/index';
const root = resolve('web/out');
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const assets = {
  async fetch(input: RequestInfo | URL): Promise<Response> {
    const req = input instanceof Request ? input : new Request(input);
    let path = decodeURIComponent(new URL(req.url).pathname);
    if (path === '/') path = '/index.html';
    let file = resolve(root, '.' + path);
    if (!file.startsWith(root + '/'))
      return new Response('Not found', { status: 404 });
    try {
      if (!(await stat(file)).isFile()) throw new Error('Not file');
    } catch {
      file += '.html';
    }
    try {
      const data = await readFile(file);
      return new Response(new Uint8Array(data), {
        headers: {
          'Content-Type': types[extname(file)] ?? 'application/octet-stream',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  },
};
const server = createServer(async (req, res) => {
  try {
    const response = await worker.fetch(
      new Request('http://127.0.0.1:8878' + req.url, {
        method: req.method ?? 'GET',
      }),
      {
        SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
        SUPABASE_PUBLISHABLE_KEY:
          process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
        ASSETS: assets,
      },
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500);
    res.end('Local server error');
  }
});
server.listen(8878, '127.0.0.1', () =>
  console.log(
    'LOCAL MARKET: port 8878, real Worker handler + Supabase/provider, no fixture fallback',
  ),
);
process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
