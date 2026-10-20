// Dev server (Node built-ins only): serves src/ at / and dev/ at /dev/.
// Injects the mock messenger into every served HTML page; shipped files never reference dev/.
// Usage: node scripts/serve.mjs [--port 5173]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const srcDir = join(root, 'src');
const devDir = join(root, 'dev');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/** @param {string} dir @param {string} relative */
function within(dir, relative) {
  const path = normalize(join(dir, relative));
  return path === dir || path.startsWith(dir + sep) ? path : null;
}

/** @param {string} pathname */
function resolvePath(pathname) {
  if (pathname.startsWith('/dev/')) return within(devDir, pathname.slice('/dev/'.length));
  return within(srcDir, pathname.slice(1));
}

/** @param {string} html */
async function injectMock(html) {
  const messages = await readFile(join(srcDir, '_locales', 'en', 'messages.json'), 'utf8');
  const json = JSON.stringify(JSON.parse(messages)).replaceAll('<', '\\u003c');
  const tags =
    `<script type="application/json" id="tt-dev-messages">${json}</script>\n` +
    `    <script type="module" src="/dev/mock-messenger.js"></script>\n`;
  // Right after <meta charset> (or <head>), before the page's own scripts, so the mock
  // module executes first: deferred module scripts run in document order.
  const anchor = /<meta charset=[^>]*>\s*/i.test(html) ? /<meta charset=[^>]*>\s*/i : /<head>\s*/i;
  return html.replace(anchor, (match) => `${match}${tags}    `);
}

export function createDevServer() {
  return createServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname === '/') {
      res.writeHead(302, { location: '/ui/tracker.html' });
      res.end();
      return;
    }
    const path = resolvePath(decodeURIComponent(pathname));
    try {
      if (!path || !(await stat(path)).isFile()) throw new Error('not found');
      const type =
        TYPES[/** @type {keyof typeof TYPES} */ (extname(path))] ?? 'application/octet-stream';
      let body = await readFile(path);
      if (extname(path) === '.html') body = Buffer.from(await injectMock(body.toString('utf8')));
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end(`404 ${pathname}`);
    }
  });
}

/**
 * @param {number} port
 * @returns {Promise<import('node:http').Server>}
 */
export function listen(port) {
  const server = createDevServer();
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolveListen(server));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg > 0 ? Number(process.argv[portArg + 1]) : Number(process.env.PORT ?? 5173);
  await listen(port);
  console.log(`Dev harness: http://localhost:${port}/ (tracker) · /ui/popup.html`);
  console.log(
    'Query options: ?seed=<n> for other fixtures, ?fixtures=empty for an empty state, ?fixtures=none for no background.',
  );
}
