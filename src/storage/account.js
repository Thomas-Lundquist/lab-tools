import { kvGet, kvSet } from './kv.js'

// There's no stored Canvas account any more — the app rides the teacher's
// live Canvas session (see api/request.js). All that's left is whether
// onboarding (PIN choice) has been done on this browser.

export async function isSetupComplete() {
  const meta = await kvGet('meta')
  return meta?.setupComplete === true
}

export async function markSetupComplete() {
  const meta = { ...((await kvGet('meta')) ?? {}), setupComplete: true, version: '2.0.0' }
  await kvSet('meta', meta)
}
