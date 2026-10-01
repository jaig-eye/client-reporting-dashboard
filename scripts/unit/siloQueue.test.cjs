const test = require('node:test'); const assert = require('node:assert/strict')
const path = require('path')
const Q = require(path.join(process.env.WT, 'src/lib/content/siloQueue.ts'))

test('typed keywords: one line, no quotes, de-duplicated in order', () => {
  assert.deepEqual(
    Q.cleanQueueKeywords(['  Commercial  landscaping ', 'commercial landscaping', 'HOA "mowing"\nschedule', '', null, 'a' + String.fromCharCode(92) + 'b']),
    ['Commercial landscaping', 'HOA mowing schedule', 'a b'],
  )
  assert.equal(Q.cleanQueueKeyword('x'.repeat(300)).length, 200)
})

test('notes keep their line breaks and lose control characters', () => {
  assert.equal(Q.cleanSiloNotes('Aim at HOA managers.\r\nMention plans.\u0007'), 'Aim at HOA managers. \nMention plans.')
  assert.equal(Q.cleanSiloNotes('   '), null)
  assert.equal(Q.cleanSiloNotes('y'.repeat(2000)).length, 1000)
})

const kw = (keyword, i) => ({ id: `k${i}`, keyword, keyword_type: 'supporting', intent: null, sort_order: i, used_at: null })

test('queue prompt says what to do when fewer keywords are left than topics wanted', () => {
  const short = Q.buildKeywordQueueBlock('Commercial landscaping', null, [kw('hoa landscaping contracts', 0)], '', true, 3)
  assert.match(short, /needs 3 topics and only 1 keyword is left/)
  assert.match(short, /the other 2 must stay on the subject of "Commercial landscaping"/)
  const exact = Q.buildKeywordQueueBlock('Commercial landscaping', null, [kw('a', 0), kw('b', 1)], '', true, 2)
  assert.doesNotMatch(exact, /needs \d+ topics/)
})
