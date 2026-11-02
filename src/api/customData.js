import { canvasGet, canvasPut, canvasDelete } from './request.js'
import { NotFoundError, ApiError } from './errors.js'

// Canvas custom data: a per-user JSON store inside Canvas itself, used to sync
// this app's settings and grading drafts across the teacher's devices (see
// storage/sync.js). It lives on the teacher's own Canvas user, under our own
// namespace, so nothing leaves the district-approved system.
//
// Each synced document is stored as a JSON *string* at its own path
// (`setup`, `labGrading/<labId>`). Strings round-trip exactly; nested JSON
// sent as request params can come back with numbers, booleans, empty arrays,
// and nulls changed by Canvas's parameter parsing.
//
// "Nothing there" has two answers in Canvas: 404 when the namespace has never
// been written, and 400 ("no data for scope") when the namespace exists but
// that path doesn't. Reads treat both as missing. Sync never deletes local data
// because of a missing document (it re-uploads instead), and a 400 that means
// something else resurfaces on the upload that follows.

export const NAMESPACE = 'org.labtools'
const ROOT = '/api/v1/users/self/custom_data'

const docUrl = docPath => `${ROOT}/${docPath.split('/').map(encodeURIComponent).join('/')}`

export const isMissing = err =>
  err instanceof NotFoundError || (err instanceof ApiError && err.statusCode === 400)

// Every document in the namespace, as { docPath: jsonString }.
export async function getAllDocs() {
  try {
    const res = await canvasGet(ROOT, { ns: NAMESPACE })
    return flattenDocs(res?.data)
  } catch (err) {
    if (isMissing(err)) return {}
    throw err
  }
}

// One document's JSON string, or undefined if it isn't there.
export async function getDoc(docPath) {
  try {
    const res = await canvasGet(docUrl(docPath), { ns: NAMESPACE })
    return typeof res?.data === 'string' ? res.data : undefined
  } catch (err) {
    if (isMissing(err)) return undefined
    throw err
  }
}

// ns rides in the query string as well as the body, matching the
// proof-of-concept request that worked on the iPad.
export async function putDoc(docPath, jsonString) {
  await canvasPut(`${docUrl(docPath)}?ns=${NAMESPACE}`, { ns: NAMESPACE, data: jsonString })
}

// Deletes the whole namespace — every synced document.
export async function deleteAllDocs() {
  try {
    await canvasDelete(`${ROOT}?ns=${NAMESPACE}`)
  } catch (err) {
    if (!isMissing(err)) throw err
  }
}

// Canvas returns the namespace as a tree; documents are its string leaves.
export function flattenDocs(tree, prefix = '', out = {}) {
  if (tree === null || typeof tree !== 'object') return out
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix ? `${prefix}/${k}` : k
    if (typeof v === 'string') out[path] = v
    else flattenDocs(v, path, out)
  }
  return out
}
