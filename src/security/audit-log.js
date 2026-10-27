import { kvGet, kvSet } from '../storage/kv.js'

const STORAGE_KEY = 'auditLog'
const MAX_ENTRIES = 50

export async function getAuditLog() {
  return (await kvGet(STORAGE_KEY)) ?? []
}

export async function logAuditEntry({ action, summary, courseId, courseName, pinVerified }) {
  const log = await getAuditLog()
  const entry = {
    id: `audit_${Date.now()}`,
    timestamp: new Date().toISOString(),
    action,
    summary,
    courseId: courseId ?? null,
    courseName: courseName ?? null,
    pinVerified,
  }
  const updated = [entry, ...log].slice(0, MAX_ENTRIES)
  await kvSet(STORAGE_KEY, updated)
}

export async function clearAuditLog() {
  await kvSet(STORAGE_KEY, [])
}

export async function exportAuditLogCsv() {
  const log = await getAuditLog()
  const header = ['Date/Time', 'Action', 'Course', 'Summary', 'PIN Verified']
  const rows = log.map(entry => [
    new Date(entry.timestamp).toLocaleString(),
    entry.action,
    entry.courseName ?? '',
    entry.summary,
    entry.pinVerified === true ? 'Yes' : 'Disabled',
  ])
  return [header, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')
}
