// Local-only platform — the address the app thinks is Supabase.
//
// supabase-js talks to one base URL and puts each service behind a path prefix. This handles the
// three the app uses:
//   /rest/v1      forwarded to PostgREST
//   /storage/v1   upload and public read, against a folder on disk
//   /realtime/v1  a WebSocket that accepts subscriptions and never pushes an event

import http from 'node:http'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { join, dirname, normalize, extname, sep } from 'node:path'
import { LOCAL } from './db.mjs'
import { PORTS } from './config.mjs'

const STORAGE_DIR = join(LOCAL, 'storage')
const requireTool = createRequire(join(LOCAL, 'tools', 'package.json'))

const CONTENT_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, apikey, content-type, prefer, range, x-client-info, x-upsert, accept-profile, content-profile, cache-control')
  res.setHeader('Access-Control-Expose-Headers', 'content-range, x-total-count')
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

// ── Database ──────────────────────────────────────────────────────────────────────

function proxyToPostgrest(req, res, url) {
  const headers = { ...req.headers, host: `127.0.0.1:${PORTS.postgrest}` }
  // Supabase's own gateway turns the apikey header into the bearer token when there isn't one.
  if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`

  const path = (url.pathname.slice('/rest/v1'.length) || '/') + url.search
  const upstream = http.request(
    { host: '127.0.0.1', port: PORTS.postgrest, method: req.method, path, headers },
    up => { res.writeHead(up.statusCode ?? 502, up.headers); up.pipe(res) },
  )
  upstream.on('error', e => json(res, 502, { message: `Local API is not running: ${e.message}` }))
  req.pipe(upstream)
}

// ── Storage ───────────────────────────────────────────────────────────────────────

/** A path inside STORAGE_DIR for bucket/key — or null if the key tries to climb out of it. */
function resolveObject(bucket, key) {
  const root = normalize(STORAGE_DIR) + sep
  const full = normalize(join(STORAGE_DIR, bucket, key))
  return full.startsWith(root) ? full : null
}

function splitObjectPath(rest) {
  const parts = rest.split('/').filter(Boolean).map(decodeURIComponent)
  return { bucket: parts[0], key: parts.slice(1).join('/') }
}

function serveObject(req, res, bucket, key) {
  const file = resolveObject(bucket, key)
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    return json(res, 404, { statusCode: '404', error: 'not_found', message: 'Object not found' })
  }
  res.writeHead(200, {
    'content-type':   CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': statSync(file).size,
    'cache-control':  'no-cache',
  })
  if (req.method === 'HEAD') return res.end()
  createReadStream(file).pipe(res)
}

function storeObject(req, res, bucket, key) {
  const file = resolveObject(bucket, key)
  if (!file || !key) return json(res, 400, { statusCode: '400', error: 'invalid_key', message: 'Invalid object key' })

  const upsert = String(req.headers['x-upsert']) === 'true' || req.method === 'PUT'
  if (existsSync(file) && !upsert) {
    return json(res, 400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' })
  }

  mkdirSync(dirname(file), { recursive: true })
  const out = createWriteStream(file)
  req.pipe(out)
  out.on('finish', () => json(res, 200, { Id: randomUUID(), Key: `${bucket}/${key}` }))
  out.on('error', e => json(res, 500, { statusCode: '500', error: 'write_failed', message: e.message }))
}

// ── Realtime ──────────────────────────────────────────────────────────────────────
//
// Only PaymentNotifier subscribes (postgres_changes on new payment rows). Without something on the
// other end the browser logs a failed WebSocket on every admin page — noise that would make every
// screenshot run look broken. This answers the Phoenix protocol the client speaks: it replies to
// channel joins, heartbeats and leaves, and never sends an event, because nothing changes underneath
// a local preview unless you change it yourself.

function handleRealtime(ws) {
  ws.on('message', raw => {
    let msg
    try { msg = JSON.parse(String(raw)) } catch { return }   // binary broadcast frames need no reply

    // Protocol 2.0.0 (realtime-js default) sends [join_ref, ref, topic, event, payload];
    // 1.0.0 sends an object with the same fields.
    const asArray = Array.isArray(msg)
    const [joinRef, ref, topic, event, payload] = asArray
      ? msg
      : [msg.join_ref, msg.ref, msg.topic, msg.event, msg.payload]

    let response
    if (event === 'phx_join') {
      // The client checks that each postgres_changes binding it asked for comes back, in order,
      // with a server id — a missing or mismatched list is reported as CHANNEL_ERROR.
      const bindings = payload?.config?.postgres_changes ?? []
      response = { postgres_changes: bindings.map((b, i) => ({ ...b, id: i + 1 })) }
    } else if (event === 'heartbeat' || event === 'phx_leave' || event === 'access_token') {
      response = {}
    } else {
      return
    }

    const reply = { status: 'ok', response }
    ws.send(JSON.stringify(asArray
      ? [joinRef ?? null, ref ?? null, topic, 'phx_reply', reply]
      : { join_ref: joinRef, ref, topic, event: 'phx_reply', payload: reply }))
  })
}

// ── Server ────────────────────────────────────────────────────────────────────────

export function startGateway() {
  mkdirSync(STORAGE_DIR, { recursive: true })

  const server = http.createServer((req, res) => {
    cors(res)
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }

    const url = new URL(req.url, 'http://127.0.0.1')

    if (url.pathname.startsWith('/rest/v1')) return proxyToPostgrest(req, res, url)

    if (url.pathname.startsWith('/storage/v1/object/public/')) {
      const { bucket, key } = splitObjectPath(url.pathname.slice('/storage/v1/object/public/'.length))
      return serveObject(req, res, bucket, key)
    }

    if (url.pathname.startsWith('/storage/v1/object/')) {
      const { bucket, key } = splitObjectPath(url.pathname.slice('/storage/v1/object/'.length))
      if (req.method === 'POST' || req.method === 'PUT') return storeObject(req, res, bucket, key)
      if (req.method === 'GET' || req.method === 'HEAD') return serveObject(req, res, bucket, key)
    }

    if (url.pathname === '/' || url.pathname === '/health') return json(res, 200, { ok: true, service: 'local-platform-gateway' })

    json(res, 404, { message: `The local platform does not emulate ${req.method} ${url.pathname}` })
  })

  const { WebSocketServer } = requireTool('ws')
  const realtime = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://127.0.0.1')
    if (pathname !== '/realtime/v1/websocket') { socket.destroy(); return }
    realtime.handleUpgrade(req, socket, head, ws => handleRealtime(ws))
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(PORTS.gateway, '127.0.0.1', () => resolve(server))
  })
}
