import '../styles/global.css'
import { CANVAS_ORIGIN, LAUNCH_PATH, buildBookmarklet, buildUserscript } from './launchers.js'

// Fills the install page (root index.html) with launchers pointing at this
// deployment's launch.js. Built from location so preview deployments hand
// out launchers for themselves.
const launchUrl = new URL('launch.js', window.location.href).href
const bookmarklet = buildBookmarklet(launchUrl)
const userscript = buildUserscript(launchUrl)

document.getElementById('bookmarklet').setAttribute('href', bookmarklet)
document.getElementById('userscript').textContent = userscript
document.getElementById('canvas-host-1').textContent = new URL(CANVAS_ORIGIN).host
document.getElementById('launch-url').textContent = CANVAS_ORIGIN + LAUNCH_PATH

async function copy(text, label) {
  const status = document.getElementById('copied')
  try {
    await navigator.clipboard.writeText(text)
    status.textContent = `${label} copied.`
  } catch {
    status.textContent = `Couldn't copy — select the text and copy it by hand.`
  }
}

document.getElementById('copy-userscript').addEventListener('click', () => copy(userscript, 'Script'))

// The iPad can't easily edit a script file, so hand it over as a download.
// Built here from this page's own location, like the other launchers, so it
// works on any deployment; the static labtools.user.js (emitted at build time
// — see vite.config.js) is the one-tap install route.
document.getElementById('download-userscript').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([userscript], { type: 'text/javascript' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: 'labtools.user.js' })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
})
document.getElementById('copy-bookmarklet').addEventListener('click', () => copy(bookmarklet, 'Bookmarklet'))
