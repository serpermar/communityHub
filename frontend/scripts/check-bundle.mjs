#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const ASSETS_DIR = fileURLToPath(new URL('../dist/assets/', import.meta.url))
const KB = 1024
const BUDGETS = { 'vendor-charts': 130, 'vendor-react': 85, 'vendor-forms': 30, index: 55 }
const DEFAULT_BUDGET = 40

function budgetFor(name) {
  for (const [prefix, limit] of Object.entries(BUDGETS)) {
    if (name.startsWith(prefix)) return limit
  }
  return DEFAULT_BUDGET
}

let failed = false
const rows = []
for (const file of readdirSync(ASSETS_DIR)) {
  if (!file.endsWith('.js')) continue
  const path = join(ASSETS_DIR, file)
  const raw = readFileSync(path)
  const gzipKb = gzipSync(raw).length / KB
  const budget = budgetFor(file)
  const ok = gzipKb <= budget
  if (!ok) failed = true
  rows.push({ file, gzipKb, budget, ok })
}

rows.sort((a, b) => b.gzipKb - a.gzipKb)
console.log('Chunk'.padEnd(42), 'gzip'.padStart(8), 'budget'.padStart(8), '  ')
for (const row of rows) {
  const mark = row.ok ? 'ok' : 'EXCEDE'
  console.log(
    row.file.padEnd(42),
    `${row.gzipKb.toFixed(1).padStart(6)}K`,
    `${String(row.budget).padStart(6)}K`,
    ` ${mark}`,
  )
}
if (failed) {
  console.error('\nPresupuesto de bundle incumplido. Revisa `npm run analyze`.')
  process.exit(1)
}
console.log('\nPresupuesto de bundle OK.')
