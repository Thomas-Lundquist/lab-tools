// Participation records: what each class did on each rotated day. Ported from
// ../kitchen-rotator/js/history.js. One synced document per class
// (`rotationHistory/<blockId>`, storage/rotation.js) so a rotation only ever
// rewrites its own class's records, and a capped size keeps each document small.
//
// Record shape, kept terse because there are hundreds:
//   { b: batchId, d: 'YYYY-MM-DD', cn: className, t: job titles in force,
//     k: [ { i: kitchen idx, s: student ids in display order, du: duty,
//            cs: 1 if center sink, ab: ids that were absent } ] }
// The titles ride on each record (not an index into a shared dictionary, as
// the standalone did) so two devices' records never disagree about what an
// index meant. Ids, not names: names are resolved from the roster at display.
import { staffedKitchenIdxs, seatOrder, isAbsent } from './model.js'
import { blockDisplay } from './duties.js'

export const HISTORY_CAP = 90 // rotations kept per class

export function emptyHistory() { return { records: [] } }

export function normalizeHistory(parsed) {
  const recs = Array.isArray(parsed?.records) ? parsed.records : []
  return { records: recs.filter(r => r && typeof r === 'object' && Array.isArray(r.k) && typeof r.d === 'string').slice(-HISTORY_CAP) }
}

export function newBatchId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

// Snapshot of what a block JUST FINISHED, before it advances. Null for a class
// with nobody in, so prep periods and all-absent days never reach the records.
export function buildRotationRecord(state, blockId, { batchId, today }) {
  const block = state.blocks[blockId]
  if (!block) return null
  const staffed = staffedKitchenIdxs(block)
  if (staffed.length === 0) return null
  const { duties, sinks } = blockDisplay(state, blockId)
  return {
    _id: blockId,
    b: batchId,
    d: today,
    cn: block.className,
    t: state.jobTitles.slice(),
    // Display order: present students take the top jobs, so the job a student
    // actually held is the display row's title, not their stored seat's.
    k: staffed.map(ki => ({
      i: ki,
      s: seatOrder(block, ki),
      du: duties[ki] || '',
      cs: sinks[ki] ? 1 : 0,
      ab: block.kitchens[ki].students.filter(id => isAbsent(block, id)),
    })),
  }
}

export function appendRecords(history, records) {
  const next = records.map(({ _id, ...r }) => r) // eslint-disable-line no-unused-vars
  return { records: [...history.records, ...next].slice(-HISTORY_CAP) }
}

export function removeBatch(history, batchId) {
  return { records: history.records.filter(r => r.b !== batchId) }
}

export function rotatedOn(history, day) {
  const last = history.records[history.records.length - 1]
  return !!last && last.d === day
}

// --- participation CSV ---

export function participationRows(entries, nameOf) {
  const rows = [['Date', 'Day', 'Block', 'Class', 'Kitchen', 'Job Title', 'Student', 'Status', 'Extra Duty', 'Center Sink']]
  for (const { label, day, records } of entries) {
    for (const rec of records) {
      for (const kr of rec.k) {
        const absent = new Set(kr.ab || [])
        kr.s.forEach((id, row) => {
          rows.push([rec.d, day, label, rec.cn, `K${kr.i + 1}`,
            rec.t?.[row] || `Seat ${row + 1}`, nameOf(id),
            absent.has(id) ? 'Absent' : 'Present', kr.du || '', kr.cs ? 'Yes' : 'No'])
        })
      }
    }
  }
  return rows
}

function csvField(v) {
  const s = String(v ?? '')
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// CRLF and a UTF-8 BOM, or Excel on Windows mangles accented names.
export function toCSV(rows) {
  return '﻿' + rows.map(r => r.map(csvField).join(',')).join('\r\n') + '\r\n'
}
