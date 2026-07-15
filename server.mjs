/**
 * Servidor maphaj (demo-mapa): ficheiros estáticos + proxy de tiles.
 *
 * Cliente (browser/Flutter) pede tiles a ESTE servidor;
 * o servidor faz fetch ao OpenFreeMap (ou outro upstream) e devolve.
 *
 * Uso:
 *   node server.mjs
 *   # http://localhost:5173
 *
 * Rotas de tiles:
 *   GET /tiles/ofm/planet              → TileJSON (tiles reescritas para este host)
 *   GET /tiles/ofm/*                   → proxy → https://tiles.openfreemap.org/*
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5173);
const UPSTREAM = 'https://tiles.openfreemap.org';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pbf': 'application/x-protobuf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

/** @type {object|null} */
let planetTileJsonCache = null;

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    ...headers,
  });
  res.end(body);
}

async function proxyUpstream(pathname, res) {
  const url = `${UPSTREAM}${pathname}`;
  const upstream = await fetch(url, {
    headers: { 'User-Agent': 'maphaj-tile-proxy/1.0' },
  });
  const buf = Buffer.from(await upstream.arrayBuffer());
  const ctype =
    upstream.headers.get('content-type') ||
    (pathname.endsWith('.pbf')
      ? 'application/vnd.mapbox-vector-tile'
      : 'application/octet-stream');
  send(res, upstream.status, buf, {
    'Content-Type': ctype,
    'Cache-Control': upstream.headers.get('cache-control') || 'public, max-age=3600',
  });
}

async function planetTileJson(req, res) {
  if (!planetTileJsonCache) {
    const r = await fetch(`${UPSTREAM}/planet`, {
      headers: { 'User-Agent': 'maphaj-tile-proxy/1.0' },
    });
    if (!r.ok) {
      send(res, r.status, `upstream TileJSON ${r.status}`);
      return;
    }
    planetTileJsonCache = await r.json();
  }

  const host = req.headers.host || `localhost:${PORT}`;
  const xfProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const proto = xfProto === 'https' || xfProto === 'http' ? xfProto : 'http';
  const origin = `${proto}://${host}`;
  const out = {
    ...planetTileJsonCache,
    tiles: (planetTileJsonCache.tiles || []).map((t) => {
      // Não usar `new URL(t)` — encodeia `{z}/{x}/{y}` para %7B…
      const path = String(t).replace(/^https?:\/\/tiles\.openfreemap\.org/i, '');
      return `${origin}/tiles/ofm${path}`;
    }),
  };
  send(res, 200, JSON.stringify(out), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=300',
  });
}

function serveStatic(reqPath, res) {
  let rel = decodeURIComponent(reqPath.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const filePath = path.normalize(path.join(__dirname, rel));
  if (!filePath.startsWith(__dirname)) {
    send(res, 403, 'Forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    send(res, 404, 'Not found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const body = fs.readFileSync(filePath);
  send(res, 200, body, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      send(res, 204, '');
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const p = url.pathname;

    if (p === '/tiles/ofm/planet' || p === '/tiles/ofm/planet/') {
      await planetTileJson(req, res);
      return;
    }

    if (p.startsWith('/tiles/ofm/')) {
      const upstreamPath = p.slice('/tiles/ofm'.length) || '/';
      await proxyUpstream(upstreamPath, res);
      return;
    }

    serveStatic(p, res);
  } catch (err) {
    console.error('[maphaj]', err);
    send(res, 502, `Proxy error: ${err?.message || err}`);
  }
});

const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`[maphaj] http://${HOST}:${PORT}`);
  console.log(`[maphaj] tiles via /tiles/ofm/* → ${UPSTREAM}`);
});
