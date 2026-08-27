// node --test parse.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCsv } from './parse.js'

test('empty file: no rows, no errors', () => {
  const { rows, errors } = parseCsv('')
  assert.deepEqual(rows, [])
  assert.deepEqual(errors, [])
})

test('header-only file, with trailing newline', () => {
  const { rows, errors } = parseCsv('name,qty\n')
  assert.deepEqual(rows, [['name', 'qty']])
  assert.deepEqual(errors, [])
})

test('header-only file, no trailing newline', () => {
  const { rows, errors } = parseCsv('name,qty')
  assert.deepEqual(rows, [['name', 'qty']])
  assert.deepEqual(errors, [])
})

test('quoted field containing a comma', () => {
  const { rows, errors } = parseCsv('name,note\n"Doe, John",ok\n')
  assert.deepEqual(rows, [
    ['name', 'note'],
    ['Doe, John', 'ok'],
  ])
  assert.deepEqual(errors, [])
})

test('quoted field containing a newline', () => {
  const { rows, errors } = parseCsv('name,note\n"line one\nline two",ok\n')
  assert.deepEqual(rows, [
    ['name', 'note'],
    ['line one\nline two', 'ok'],
  ])
  assert.deepEqual(errors, [])
})

test('escaped double quotes ("") inside a quoted field', () => {
  const { rows, errors } = parseCsv('name,quote\nA,"She said ""hi"" back"\n')
  assert.deepEqual(rows, [
    ['name', 'quote'],
    ['A', 'She said "hi" back'],
  ])
  assert.deepEqual(errors, [])
})

test('a quoted field can combine a comma, a newline, and an escaped quote', () => {
  const { rows } = parseCsv('a,b\n"x, y\nz says ""hi""",tail\n')
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['x, y\nz says "hi"', 'tail'],
  ])
})

test('CRLF line endings', () => {
  const { rows, errors } = parseCsv('a,b\r\n1,2\r\n3,4\r\n')
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['1', '2'],
    ['3', '4'],
  ])
  assert.deepEqual(errors, [])
})

test('LF line endings', () => {
  const { rows, errors } = parseCsv('a,b\n1,2\n3,4\n')
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['1', '2'],
    ['3', '4'],
  ])
  assert.deepEqual(errors, [])
})

test('mixed CRLF and LF in the same file', () => {
  const { rows } = parseCsv('a,b\r\n1,2\n3,4\r\n')
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['1', '2'],
    ['3', '4'],
  ])
})

test('trailing newline does not create a phantom empty row', () => {
  const { rows } = parseCsv('a,b\n1,2\n')
  assert.equal(rows.length, 2)
})

test('missing trailing newline still captures the last row', () => {
  const { rows } = parseCsv('a,b\n1,2')
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['1', '2'],
  ])
})

test('BOM at the start of the file is stripped from the first field', () => {
  const { rows } = parseCsv('﻿a,b\n1,2\n')
  assert.equal(rows[0][0], 'a')
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['1', '2'],
  ])
})

test('unterminated quoted field is reported as an error, not thrown', () => {
  assert.doesNotThrow(() => parseCsv('a,b\n"open,field\n'))
  const { errors } = parseCsv('a,b\n"open,field\n')
  assert.equal(errors.length, 1)
  assert.equal(typeof errors[0].line, 'number')
  assert.match(errors[0].message, /unterminated/i)
})

test('never throws on non-string input', () => {
  assert.doesNotThrow(() => parseCsv(null))
  assert.doesNotThrow(() => parseCsv(undefined))
  assert.doesNotThrow(() => parseCsv(12345))
  assert.deepEqual(parseCsv(null).rows, [])
})

test('a blank line yields a single empty-string field, not a skipped row', () => {
  const { rows } = parseCsv('a,b\n\n1,2\n')
  assert.deepEqual(rows, [['a', 'b'], [''], ['1', '2']])
})
