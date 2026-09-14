// Local-only platform — the address the app thinks is Supabase.
//
// supabase-js talks to one base URL and puts the service behind a path prefix: /rest/v1 for the
// database, /storage/v1 for files. This forwards /rest/v1 to PostgREST and handles the two storage
// operations the app uses — upload, and reading a public URL — against a folder on disk.

import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { join, dirname, normalize, extname, sep } from 'node:path'
import { LOCAL } from './db.mjs'
import { PORTS } from './config.mjs'

const STORAGE_DIR = join(LOCAL, 'storage')

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

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(PORTS.gateway, '127.0.0.1', () => resolve(server))
  })
}
