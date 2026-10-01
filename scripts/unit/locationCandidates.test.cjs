const test = require('node:test'); const assert = require('node:assert/strict')
const path = require('path')
const { locationCandidates } = require(path.join(process.env.WT, 'src/lib/content/researchSeeds.ts'))

// Real clients' service areas. The first candidate is the market research will try first.
test('prose with joiners is read as a sentence: the city keeps its state', () => {
  assert.equal(locationCandidates('Los Angeles and Tri-County area, Southern California')[0], 'Los Angeles')
  assert.deepEqual(locationCandidates('Melbourne, FL and Brevard County').slice(0, 2), ['Melbourne, FL', 'Brevard County'])
  assert.equal(locationCandidates('Brevard County, FL (Rockledge and Melbourne)')[0], 'Brevard County, FL')
})

test('a plain list is tried entry by entry, as typed, then without area words', () => {
  assert.deepEqual(locationCandidates('Melbourne, FL, Washington, DC, New York, NY'), ['Melbourne, FL', 'Washington, DC', 'New York, NY'])
  assert.deepEqual(locationCandidates('Greater Orlando area, Kissimmee').slice(0, 2), ['Greater Orlando area', 'Greater Orlando'])
})

test('a national business gets no local market', () => {
  assert.deepEqual(locationCandidates('Nationwide'), [])
  assert.deepEqual(locationCandidates('All of Canada (coast to coast)'), [])
})
