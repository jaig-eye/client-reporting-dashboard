// The research relevance rule, on a real client's services (Lumiere Lifestyle, lighting installer,
// Los Angeles) and keywords its research actually returned.
const test = require('node:test'); const assert = require('node:assert/strict')
const path = require('path')
const { buildSeedMatcher } = require(path.join(process.env.WT, 'src/lib/content/clientResearch.ts'))

const services = [
  'Permanent outdoor lighting installation', 'landscape lighting installation', 'outdoor security lighting',
  'permanent Christmas lights', 'commercial and residential lighting design',
]
const m = buildSeedMatcher(services, 'Los Angeles Tri-County area Southern California')

test('each keyword is filed under the one service it is about', () => {
  assert.equal(m.serviceOf('permanent outdoor lighting cost'), 'Permanent outdoor lighting installation')
  assert.equal(m.serviceOf('landscape lighting contractor'), 'landscape lighting installation')
  assert.equal(m.serviceOf('security lights for outdoor'), 'outdoor security lighting')
  assert.equal(m.serviceOf('permanent christmas lights cost'), 'permanent Christmas lights')
  assert.equal(m.serviceOf('lighting designer los angeles'), 'commercial and residential lighting design')
  assert.equal(m.serviceOf('christmas lights in los angeles'), 'permanent Christmas lights')
})
test('words borrowed from two different services no longer pass', () => {
  // "outdoor" (service 1/3) + "christmas" (service 4): about neither service on its own.
  assert.equal(m.isRelevant('outdoor christmas inflatables'), false)
  assert.equal(m.isRelevant('residential christmas'), false)
})
test('unrelated searches still fail', () => {
  assert.equal(m.isRelevant('humidifier for coughs'), false)
  assert.equal(m.isRelevant('govee'), false)
})
test('a one-word service needs only its word', () => {
  const r = buildSeedMatcher(['roofing', 'gutters'], 'Tampa')
  assert.equal(r.serviceOf('roofing contractors'), 'roofing')
  assert.equal(r.serviceOf('gutters cleaning cost'), 'gutters')
})
test('word forms count as the same word', () => {
  assert.equal(m.serviceOf('landscaping lights installation near me'), 'landscape lighting installation')
  assert.equal(m.serviceOf('outdoor security lights'), 'outdoor security lighting')
  assert.equal(m.serviceOf('christmas home lighting ideas'), 'permanent Christmas lights')
})
