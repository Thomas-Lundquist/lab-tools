// Device-link transfer: move the Canvas login (and, if it fits, the course/lab
// setup) to another device through a QR code, with no server involved.
//
// Security model (see DECISIONS.md): the payload is encrypted in the browser
// with a key derived from a passphrase the teacher types (PBKDF2 -> AES-GCM).
// The passphrase is never shown, transmitted, or stored, so a photo of the QR is
// useless without it. The device's own at-rest key (encryption.js) is untouched;
// on import the token is re-encrypted under the receiving device's own key.
//
// Envelope bytes:  [1: flags (bit0 = gzip)] [16: salt] [12: iv] [ct...]
// QR text:         "CCT1:" + base64(envelope)

import { kvGet, kvSet } from './kv.js'
import { getDecryptedToken } from './encryption.js'
import { getAccount, saveAccount, markSetupComplete } from './account.js'
import { getSetup } from './setup.js'

const PREFIX = 'CCT1:'
const PAYLOAD_VERSION = 1
const PBKDF2_ITERATIONS = 210000
// Keep the QR scannable from a laptop screen with a phone camera. Login-only is
// a few hundred bytes; setup is included only when the whole thing stays under
// this envelope size, otherwise it is dropped so the QR does not get too dense.
const MAX_ENVELOPE_BYTES = 1100

// ---- base64 (chunked, safe for larger byte arrays) ----

function bytesToBase64(bytes) {
  const u = new Uint8Array(bytes)
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < u.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, u.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function base64ToBytes(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// ---- gzip via the native stream API (no dependency); no-ops if unavailable ----

async function maybeGzip(bytes) {
  if (typeof CompressionStream === 'undefined') return { data: bytes, gzipped: false }
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))
    const buf = await new Response(stream).arrayBuffer()
    return { data: new Uint8Array(buf), gzipped: true }
  } catch {
    return { data: bytes, gzipped: false }
  }
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
}

// ---- passphrase key derivation ----

async function deriveKey(passphrase, salt) {
  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function encryptPayload(jsonString, passphrase) {
  const { data, gzipped } = await maybeGzip(new TextEncoder().encode(jsonString))
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(passphrase, salt)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data))
  const env = new Uint8Array(1 + 16 + 12 + ct.length)
  env[0] = gzipped ? 1 : 0
  env.set(salt, 1)
  env.set(iv, 17)
  env.set(ct, 29)
  return env
}

// ---- public API ----

// Build the QR text for the current device. Returns { text, includedSetup }.
export async function buildTransferCode(passphrase) {
  if (!passphrase || passphrase.length < 6) throw new Error('Choose a passphrase of at least 6 characters.')
  const account = await getAccount()
  const token = await getDecryptedToken()
  if (!account?.canvasUrl || !token) throw new Error('No Canvas login to transfer — finish onboarding on this device first.')

  const base = { v: PAYLOAD_VERSION, account: { canvasUrl: account.canvasUrl, token, userName: account.userName ?? null } }

  // Try login + setup first; fall back to login-only if the QR would be too dense.
  const withSetup = { ...base, setup: await getSetup() }
  let env = await encryptPayload(JSON.stringify(withSetup), passphrase)
  let includedSetup = true
  if (env.length > MAX_ENVELOPE_BYTES) {
    env = await encryptPayload(JSON.stringify(base), passphrase)
    includedSetup = false
  }
  return { text: PREFIX + bytesToBase64(env), includedSetup }
}

export function isTransferCode(text) {
  return typeof text === 'string' && text.startsWith(PREFIX)
}

// Decrypt a scanned code and write the login (+ setup) onto THIS device. Returns
// { includedSetup }. Throws a friendly error on a wrong passphrase or bad code.
export async function applyTransferCode(text, passphrase) {
  if (!isTransferCode(text)) throw new Error('That QR is not a device-transfer code.')
  const env = base64ToBytes(text.slice(PREFIX.length))
  const gzipped = (env[0] & 1) === 1
  const salt = env.slice(1, 17)
  const iv = env.slice(17, 29)
  const ct = env.slice(29)
  const key = await deriveKey(passphrase, salt)

  let plain
  try {
    plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct))
  } catch {
    throw new Error('Wrong passphrase, or the code is damaged. Try again.')
  }
  if (gzipped) plain = await gunzip(plain)

  const payload = JSON.parse(new TextDecoder().decode(plain))
  if (payload.v !== PAYLOAD_VERSION) throw new Error('This transfer code is from a newer version of the app.')

  await saveAccount({
    canvasUrl: payload.account.canvasUrl,
    token: payload.account.token,
    userName: payload.account.userName ?? undefined,
  })
  if (payload.setup) await kvSet('setup', payload.setup)
  await markSetupComplete()
  return { includedSetup: !!payload.setup }
}
