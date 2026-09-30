const test = require('node:test'); const assert = require('node:assert/strict')
const http = require('node:http'); const path = require('path')
const { fetchWithSiteCredentials } = require(path.join(process.env.WT, 'src/lib/connectors/wordpress.ts'))

// A local "site": each path answers with a redirect or a final 200, recording what it received.
function site(routes) {
  const seen = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      seen.push({ method: req.method, path: req.url, auth: req.headers.authorization ?? null, body })
      const r = routes[req.url]
      if (r && r.to) { res.writeHead(r.status ?? 301, { Location: r.to(server.address().port) }); return res.end() }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}')
    })
  })
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok({ server, seen, base: `http://127.0.0.1:${server.address().port}` })))
}

test('follows a same-site chain, re-sending the same POST with its credentials', async () => {
  const s = await site({ '/a': { status: 307, to: p => `http://127.0.0.1:${p}/b` }, '/b': { status: 308, to: () => '/c' } })
  try {
    const res = await fetchWithSiteCredentials(`${s.base}/a`, { method: 'POST', headers: { Authorization: 'Basic x' }, body: 'pw' })
    assert.equal(res.status, 200)
    assert.deepEqual(s.seen.map(r => [r.method, r.path, r.auth, r.body]), [['POST', '/a', 'Basic x', 'pw'], ['POST', '/b', 'Basic x', 'pw'], ['POST', '/c', 'Basic x', 'pw']])
  } finally { s.server.close() }
})
test('refuses a hop to another host and never sends it the credentials', async () => {
  const other = await site({})
  const s = await site({ '/a': { status: 307, to: () => `http://localhost:${other.server.address().port}/steal` } })
  try {
    await assert.rejects(fetchWithSiteCredentials(`${s.base}/a`, { method: 'POST', headers: { Authorization: 'Basic x' }, body: 'pw' }))
    assert.equal(other.seen.length, 0)
  } finally { s.server.close(); other.server.close() }
})
test('gives up after the hop limit', async () => {
  const s = await site({ '/a': { to: () => '/b' }, '/b': { to: () => '/c' }, '/c': { to: () => '/d' }, '/d': { to: () => '/e' } })
  try {
    await assert.rejects(fetchWithSiteCredentials(`${s.base}/a`, { headers: { Authorization: 'Basic x' } }), /more than 3/)
  } finally { s.server.close() }
})
test('a 303 answer to a POST is not re-sent (the site may have processed it)', async () => {
  const s = await site({ '/a': { status: 303, to: () => '/done' } })
  try {
    await assert.rejects(fetchWithSiteCredentials(`${s.base}/a`, { method: 'POST', headers: { Authorization: 'Basic x' }, body: 'post' }), /not re-sent/)
    assert.deepEqual(s.seen.map(r => r.path), ['/a'])
  } finally { s.server.close() }
})
test('a 302 answer to a GET is still followed on the same site', async () => {
  const s = await site({ '/a': { status: 302, to: () => '/b' } })
  try {
    const res = await fetchWithSiteCredentials(`${s.base}/a`, { headers: { Authorization: 'Basic x' } })
    assert.equal(res.status, 200)
  } finally { s.server.close() }
})
