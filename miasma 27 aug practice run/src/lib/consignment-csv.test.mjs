// Run with: node --test src/lib/consignment-csv.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseConsignmentsCsv } from './consignment-csv.js'

const HEADER = 'ngo_name,item,quantity,unit,eta_hours'

test('happy path: all valid rows parse with no errors', () => {
  const text = `${HEADER}\nBRAC,rice,500,kg,6\nBDRCS,water,1000,L,4\n`
  const { valid, errors } = parseConsignmentsCsv(text)
  assert.deepEqual(errors, [])
  assert.equal(valid.length, 2)
  assert.deepEqual(valid[0], { ngo: 'BRAC', item: 'rice', qty: 500, unit: 'kg', etaHours: 6 })
  assert.deepEqual(valid[1], { ngo: 'BDRCS', item: 'water', qty: 1000, unit: 'L', etaHours: 4 })
})

test('header is case-insensitive and trimmed', () => {
  const text = ' NGO_Name , Item , Quantity , Unit , ETA_Hours \nCaritas,tarp,10,pcs,5\n'
  const { valid, errors } = parseConsignmentsCsv(text)
  assert.deepEqual(errors, [])
  assert.equal(valid.length, 1)
  assert.equal(valid[0].ngo, 'Caritas')
})

test('quoted field with embedded commas', () => {
  const text = `${HEADER}\n"Save the Children, Bangladesh",rice,200,kg,8\n`
  const { valid, errors } = parseConsignmentsCsv(text)
  assert.deepEqual(errors, [])
  assert.equal(valid.length, 1)
  assert.equal(valid[0].ngo, 'Save the Children, Bangladesh')
})

test('CRLF line endings parse the same as LF', () => {
  const text = `${HEADER}\r\nBRAC,rice,500,kg,6\r\nBDRCS,water,1000,L,4\r\n`
  const { valid, errors } = parseConsignmentsCsv(text)
  assert.deepEqual(errors, [])
  assert.equal(valid.length, 2)
})

test('missing header column is a single whole-file error, not a per-row error', () => {
  const text = 'ngo_name,item,quantity,eta_hours\nBRAC,rice,500,6\n'
  const { valid, errors } = parseConsignmentsCsv(text)
  assert.deepEqual(valid, [])
  assert.equal(errors.length, 1)
  assert.equal(errors[0].row, null)
  assert.match(errors[0].message, /missing required column/i)
  assert.match(errors[0].message, /unit/)
})

test('unknown item is rejected with a precise message', () => {
  const text = `${HEADER}\nCaritas,tents,50,pcs,10\n`
  const { valid, errors } = parseConsignmentsCsv(text)
  assert.deepEqual(valid, [])
  assert.equal(errors.length, 1)
  assert.equal(errors[0].row, 1)
  assert.match(errors[0].message, /unknown item/i)
  assert.match(errors[0].message, /tents/)
})

test('negative quantity is rejected', () => {
  const text = `${HEADER}\nBRAC,rice,-5,kg,6\n`
  const { valid, errors } = parseConsignmentsCsv(text)
  assert.deepEqual(valid, [])
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /positive whole number/i)
})

test('zero quantity is rejected (must be positive, not just non-negative)', () => {
  const text = `${HEADER}\nBRAC,rice,0,kg,6\n`
  const { valid, errors } = parseConsignmentsCsv(text)
  assert.deepEqual(valid, [])
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /positive whole number/i)
})

test('non-numeric quantity is rejected', () => {
  const text = `${HEADER}\nMuslim Aid,dryfood,many,packs,8\n`
  const { valid, errors } = parseConsignmentsCsv(text)
  assert.deepEqual(valid, [])
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /positive whole number/i)
  assert.match(errors[0].message, /"many"/)
})

test('missing ngo_name is rejected', () => {
  const text = `${HEADER}\n,blanket,100,pcs,20\n`
  const { valid, errors } = parseConsignmentsCsv(text)
  assert.deepEqual(valid, [])
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /ngo_name is required/i)
})

test('negative eta_hours is rejected (must be >= 0)', () => {
  const text = `${HEADER}\nBRAC,rice,10,kg,-1\n`
  const { valid, errors } = parseConsignmentsCsv(text)
  assert.deepEqual(valid, [])
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /eta_hours must be a whole number/i)
})

test('eta_hours of exactly 0 is accepted', () => {
  const text = `${HEADER}\nBRAC,rice,10,kg,0\n`
  const { valid, errors } = parseConsignmentsCsv(text)
  assert.deepEqual(errors, [])
  assert.equal(valid[0].etaHours, 0)
})

test('blank lines are skipped, not reported as errors', () => {
  const text = `${HEADER}\nBRAC,rice,500,kg,6\n\nBDRCS,water,1000,L,4\n`
  const { valid, errors } = parseConsignmentsCsv(text)
  assert.deepEqual(errors, [])
  assert.equal(valid.length, 2)
})

test('mixed valid and invalid rows: both lists are correct', () => {
  const text = [
    HEADER,
    'BRAC,rice,300,kg,6',
    'Caritas,tents,50,pcs,10', // unknown item
    'Ahsania Mission,water,500,L,5',
    'Muslim Aid,dryfood,many,packs,8', // bad quantity
    'CARE Bangladesh,ors,200,sachets,12',
    ',blanket,100,pcs,20', // missing ngo_name
  ].join('\n')
  const { valid, errors } = parseConsignmentsCsv(text + '\n')
  assert.equal(valid.length, 3)
  assert.equal(errors.length, 3)
  assert.deepEqual(
    valid.map((v) => v.ngo),
    ['BRAC', 'Ahsania Mission', 'CARE Bangladesh']
  )
})

test('1-based line numbers are correct, including after a blank line', () => {
  const text = `${HEADER}\nBRAC,rice,500,kg,6\n\nCaritas,tents,50,pcs,10\n`
  const { errors } = parseConsignmentsCsv(text)
  // header = line 1, BRAC row = line 2, blank = line 3 (skipped), tents row = line 4
  assert.equal(errors.length, 1)
  assert.equal(errors[0].line, 4)
  assert.equal(errors[0].row, 2) // data-row ordinal excludes header AND the skipped blank line
})

test('wrong column count on a data row is a precise per-row error', () => {
  const text = `${HEADER}\nBRAC,rice,500,kg\n`
  const { valid, errors } = parseConsignmentsCsv(text)
  assert.deepEqual(valid, [])
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /expected 5 columns, found 4/i)
})

test('empty file produces a whole-file error, never throws', () => {
  assert.doesNotThrow(() => parseConsignmentsCsv(''))
  const { valid, errors } = parseConsignmentsCsv('')
  assert.deepEqual(valid, [])
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /empty/i)
})

test('never throws on non-string input', () => {
  assert.doesNotThrow(() => parseConsignmentsCsv(null))
  assert.doesNotThrow(() => parseConsignmentsCsv(undefined))
  assert.equal(parseConsignmentsCsv(undefined).valid.length, 0)
})
