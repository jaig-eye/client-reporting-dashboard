const test = require('node:test'); const assert = require('node:assert/strict')
const path = require('path')
const { stripHallucinatedLinks } = require(path.join(process.env.WT, 'src/lib/content/linkUtils.ts'))
test('no allowed set: page links go, text and mailto/tel/# stay', () => {
  const html = '<p><a href="https://made-up.com/x">A</a> <a href="/services/">B</a> <a href="tel:123">C</a> <a href="#faq">D</a></p>'
  assert.equal(stripHallucinatedLinks(html, new Set()), '<p>A B <a href="tel:123">C</a> <a href="#faq">D</a></p>')
})
test('with an allowed set: allowed kept, external and invented stripped (unchanged behaviour)', () => {
  const html = '<a href="https://c.com/roof/">R</a><a href="https://other.com/">O</a><a href="https://c.com/nope/">N</a>'
  assert.equal(stripHallucinatedLinks(html, new Set(['https://c.com/roof/'])), '<a href="https://c.com/roof/">R</a>ON')
})
