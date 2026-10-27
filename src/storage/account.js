import { encryptToken } from './encryption.js'
import { kvGet, kvSet } from './kv.js'

export async function getAccount() {
  return (await kvGet('account')) ?? null
}

export async function getCanvasUrl() {
  const account = await getAccount()
  if (!account?.canvasUrl) throw new Error('Canvas URL not configured. Please complete setup.')
  return account.canvasUrl.replace(/\/$/, '')
}

export async function saveAccount({ canvasUrl, token, userName }) {
  const encryptedToken = await encryptToken(token)
  const account = {
    canvasUrl: canvasUrl.replace(/\/$/, ''),
    apiToken: encryptedToken,
    lastVerified: new Date().toISOString(),
    verificationStatus: 'valid',
    userName,
  }
  await kvSet('account', account)
  return account
}

export async function updateVerificationStatus(status) {
  const account = await getAccount()
  if (!account) return
  const updated = { ...account, verificationStatus: status, lastVerified: new Date().toISOString() }
  await kvSet('account', updated)
}

export async function isSetupComplete() {
  const meta = await kvGet('meta')
  return meta?.setupComplete === true
}

export async function markSetupComplete() {
  const meta = { ...((await kvGet('meta')) ?? {}), setupComplete: true, version: '1.0.0' }
  await kvSet('meta', meta)
}
