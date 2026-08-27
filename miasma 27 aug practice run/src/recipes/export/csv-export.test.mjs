// node --test csv-export.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toCsv } from './csv-export.js'

test('empty array produces just a BOM, not an error', () => {
  const { data, error } = toCsv([])
  assert.equal(error, null)
  assert.equal(data, '﻿')
})

test('emits a UTF-8 BOM before the header', () => {
  const { data } = toCsv([{ name: 'x' }])
  assert.equal(data[0], '﻿')
  assert.match(data, /^﻿name\r\n/)
})

test('simple rows, header from object keys', () => {
  const { data, error } = toCsv([
    { name: 'Karim', qty: 3 },
    { name: 'Rahim', qty: 5 },
  ])
  assert.equal(error, null)
  assert.equal(data, '﻿name,qty\r\nKarim,3\r\nRahim,5\r\n')
})

test('a value containing a comma is quoted', () => {
  const { data } = toCsv([{ note: 'Dhaka, Bangladesh' }])
  assert.equal(data, '﻿note\r\n"Dhaka, Bangladesh"\r\n')
})

test('a value containing a double quote is quoted and the quote is doubled', () => {
  const { data } = toCsv([{ note: 'She said "hi"' }])
  assert.equal(data, '﻿note\r\n"She said ""hi"""\r\n')
})

test('a value containing a newline is quoted, newline kept literal inside the quotes', () => {
  const { data } = toCsv([{ note: 'line one\nline two' }])
  assert.equal(data, '﻿note\r\n"line one\nline two"\r\n')
})

test('a value containing a carriage return is quoted', () => {
  const { data } = toCsv([{ note: 'a\rb' }])
  assert.equal(data, '﻿note\r\n"a\rb"\r\n')
})

test('a value combining comma, quote, and newline all at once', () => {
  const { data } = toCsv([{ note: 'x, "y"\nz' }])
  assert.equal(data, '﻿note\r\n"x, ""y""\nz"\r\n')
})

test('null and undefined become an empty cell, not the literal word', () => {
  const { data } = toCsv([{ a: null, b: undefined, c: 1 }])
  assert.equal(data, '﻿a,b,c\r\n,,1\r\n')
})

test('rows with differing keys: header is the union, missing cells are empty', () => {
  const { data } = toCsv([
    { name: 'Karim', qty: 3 },
    { name: 'Rahim', price: 50 },
  ])
  assert.equal(data, '﻿name,qty,price\r\nKarim,3,\r\nRahim,,50\r\n')
})

test('column order follows first-seen order across all rows', () => {
  const { data } = toCsv([{ b: 1 }, { a: 1, b: 2 }, { c: 1 }])
  const header = data.replace('﻿', '').split('\r\n')[0]
  assert.equal(header, 'b,a,c')
})

test('a Date value is written as an ISO string', () => {
  const d = new Date('2026-08-14T00:00:00.000Z')
  const { data } = toCsv([{ when: d }])
  assert.match(data, /2026-08-14T00:00:00\.000Z/)
})

test('an invalid Date becomes an empty cell rather than "Invalid Date"', () => {
  const { data } = toCsv([{ when: new Date('not a date') }])
  assert.equal(data, '﻿when\r\n\r\n')
})

test('numbers and booleans are written as their plain text form', () => {
  const { data } = toCsv([{ n: 42, ok: true, off: false, z: 0 }])
  assert.equal(data, '﻿n,ok,off,z\r\n42,true,false,0\r\n')
})

test('Bangla (non-ASCII) text passes through untouched', () => {
  const { data } = toCsv([{ name: 'করিম', city: 'ঢাকা' }])
  assert.equal(data, '﻿name,city\r\nকরিম,ঢাকা\r\n')
})

test('a nested object is JSON-stringified rather than becoming "[object Object]"', () => {
  const { data } = toCsv([{ meta: { a: 1 } }])
  assert.match(data, /"\{""a"":1\}"/)
})

test('never throws on non-array input, and reports an error instead', () => {
  assert.doesNotThrow(() => toCsv(null))
  assert.doesNotThrow(() => toCsv(undefined))
  assert.doesNotThrow(() => toCsv('not an array'))
  assert.doesNotThrow(() => toCsv(42))
  const { data, error } = toCsv(null)
  assert.equal(data, null)
  assert.ok(error && typeof error.message === 'string')
})

test('never throws on a row that is null or not an object', () => {
  assert.doesNotThrow(() => toCsv([null, { a: 1 }, 'x', 42]))
  const { data, error } = toCsv([null, { a: 1 }, 'x', 42])
  assert.equal(error, null)
  assert.equal(data, '﻿a\r\n\r\n1\r\n\r\n\r\n')
})

test('a value that is already a quoted-looking string is still escaped correctly', () => {
  const { data } = toCsv([{ v: '"already quoted"' }])
  assert.equal(data, '﻿v\r\n"""already quoted"""\r\n')
})

test('an all-empty-string row still produces the right number of commas', () => {
  const { data } = toCsv([{ a: '', b: '', c: '' }])
  assert.equal(data, '﻿a,b,c\r\n,,\r\n')
})
