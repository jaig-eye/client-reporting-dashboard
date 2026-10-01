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

// ── SEO-field writers and read-back ─────────────────────────────────────────────────────────────
const { decodeHtmlEntities, verifyPostMeta } = require(path.join(process.env.WT, 'src/lib/connectors/wordpress.ts'))
const { rankMathUpdateMeta } = require(path.join(process.env.WT, 'src/lib/connectors/rankMathApi.ts'))
const { xmlrpcSetPostMeta } = require(path.join(process.env.WT, 'src/lib/connectors/wordpressXmlrpc.ts'))
const { hasLinkTaskFor } = require(path.join(process.env.WT, 'src/lib/content/siloLinkTasks.ts'))

const AUTH = { username: 'u', app_password: 'p' }

// A local "site" whose every request gets the same answer, recording what it received.
function answering(status, body, contentType = 'application/json') {
  const seen = []
  const server = http.createServer((req, res) => {
    let data = ''
    req.on('data', c => { data += c })
    req.on('end', () => {
      seen.push({ method: req.method, path: req.url, ua: req.headers['user-agent'] ?? '', body: data })
      res.writeHead(status, { 'content-type': contentType }); res.end(body)
    })
  })
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok({ server, seen, base: `http://127.0.0.1:${server.address().port}` })))
}

test('decodeHtmlEntities: the entities WordPress sanitizers write, nothing else', () => {
  assert.equal(decodeHtmlEntities('Brake &amp; Rotor &lt;Repair&gt; &quot;x&quot; &#039;y&#39; &#x26;'), `Brake & Rotor <Repair> "x" 'y' &`)
  assert.equal(decodeHtmlEntities('&bogus; &amp'), '&bogus; &amp')
})

test('Rank Math updateMeta: body shape and the same User-Agent as other WordPress calls', async () => {
  const s = await answering(200, '{"slug":true,"schemas":[]}')
  try {
    assert.equal(await rankMathUpdateMeta(s.base, AUTH, 42, { rank_math_title: 'T', rank_math_description: '' }), 'stored')
    assert.equal(s.seen[0].path, '/wp-json/rankmath/v1/updateMeta')
    // Empty values never go: updateMeta deletes a key sent empty.
    assert.deepEqual(JSON.parse(s.seen[0].body), { objectType: 'post', objectID: 42, meta: { rank_math_title: 'T' } })
    assert.match(s.seen[0].ua, /GoLaunchLocal/)
  } finally { s.server.close() }
})
test('Rank Math updateMeta: rest_no_route means Rank Math is absent; any other 404 is a failure', async () => {
  const absent = await answering(404, '{"code":"rest_no_route","message":"No route was found","data":{"status":404}}')
  const other  = await answering(404, '<html>Not Found</html>', 'text/html')
  try {
    assert.equal(await rankMathUpdateMeta(absent.base, AUTH, 1, { rank_math_title: 'T' }), 'absent')
    assert.equal(await rankMathUpdateMeta(other.base, AUTH, 1, { rank_math_title: 'T' }), 'failed')
  } finally { absent.server.close(); other.server.close() }
})
test('XML-RPC sends the same User-Agent and soft-fails on a fault', async () => {
  const s = await answering(200, '<?xml version="1.0"?><methodResponse><fault><value><struct><member><name>faultString</name><value><string>nope</string></value></member></struct></value></fault></methodResponse>', 'text/xml')
  try {
    assert.equal(await xmlrpcSetPostMeta(s.base, AUTH, 1, { rank_math_title: 'A & B' }), false)
    assert.equal(s.seen[0].path, '/xmlrpc.php')
    assert.match(s.seen[0].ua, /GoLaunchLocal/)
  } finally { s.server.close() }
})
test('verifyPostMeta: an entity-encoded copy of what was sent is not a miss; a different value is', async () => {
  const s = await answering(200, JSON.stringify({ id: 1, meta: { rank_math_title: 'Brake &amp; Rotor  Repair', rank_math_description: 'old' } }))
  try {
    const wrong = await verifyPostMeta(s.base, AUTH, 1, { rank_math_title: 'Brake & Rotor Repair', rank_math_description: 'new', rank_math_focus_keyword: 'kw' })
    assert.deepEqual(wrong.map(w => [w.key, w.readable]), [['rank_math_description', true], ['rank_math_focus_keyword', false]])
  } finally { s.server.close() }
})

test('hasLinkTaskFor: by post id, or by address for entries that predate post ids; done ones count', () => {
  const links = [{ url: 'https://www.site.com/a/', title: 'A', added_at: 't' }, { kind: 'hub', post_id: 'p2', url: 'https://site.com/b', done_at: 'x' }]
  assert.equal(hasLinkTaskFor(links, 'p1', 'http://site.com/a'), true)
  assert.equal(hasLinkTaskFor(links, 'p2', 'https://site.com/other'), true)
  assert.equal(hasLinkTaskFor(links, 'p3', 'https://site.com/c'), false)
  assert.equal(hasLinkTaskFor(null, 'p1', 'https://site.com/a'), false)
})
