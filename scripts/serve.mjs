import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Serve only the public extension UI, never local resume data or repository files.
const root = fileURLToPath(new URL('../extension/', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1:4173');
    const requested = decodeURIComponent(url.pathname).replace(/^\/extension\//, '/');
    const path = resolve(root, `.${requested === '/' ? '/editor.html' : requested}`);
    const rel = relative(root, path);
    if (rel.startsWith('..') || isAbsolute(rel) || !mime[extname(path)]) {
      res.writeHead(404); res.end('Not found'); return;
    }
    const content = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(content);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(4173, '127.0.0.1', () => console.log('Editor: http://127.0.0.1:4173/extension/editor.html'));
