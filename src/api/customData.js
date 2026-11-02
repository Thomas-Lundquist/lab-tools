import { canvasGet, canvasPut, canvasDelete } from './request.js'
import { NotFoundError } from './errors.js'

// Canvas custom data: a per-user JSON store inside Canvas itself, used to sync
// this app's settings and grading drafts across the teacher's devices (see
// storage/sync.js). It lives on the teacher's own Canvas user, under our own
// namespace, so nothing leaves the district-approved system.
//
// Each synced document is stored as a JSON *string* at its own path
// (`setup`, `labGrading/<labId>`). Strings round-trip exactly; nested JSON
// sent as request params can come back with numbers, booleans, empty arrays,
// and nulls changed by Canvas's parameter parsing.

export const NAMESPACE = 'org.labtools'
const ROOT = '/api/v1/users/self/custom_data'

const docUrl = docPath => `${ROOT}/${docPath.split('/').map(encodeURIComponent).join('/')}`

// Every document in the namespace, as { docPath: jsonString }. An empty
// namespace is a 404 in Canvas; that's just "nothing synced yet".
export async function getAllDocs() {
  try {
    const res = await canvasGet(ROOT, { ns: NAMESPACE })
    return flattenDocs(res?.data)
  } catch (err) {
    if (err instanceof NotFoundError) return {}
    throw err
  }
}

// One document's JSON string, or undefined if it isn't there.
export async function getDoc(docPath) {
  try {
    const res = await canvasGet(docUrl(docPath), { ns: NAMESPACE })
    return typeof res?.data === 'string' ? res.data : undefined
  } catch (err) {
    if (err instanceof NotFoundError) return undefined
    throw err
  }
}

export async function putDoc(docPath, jsonString) {
  await canvasPut(docUrl(docPath), { ns: NAMESPACE, data: jsonString })
}

// Deletes the whole namespace — every synced document.
export async function deleteAllDocs() {
  try {
    await canvasDelete(`${ROOT}?ns=${NAMESPACE}`)
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err
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
