import { useState, useRef, useEffect } from 'react'
import jsQR from 'jsqr'
import Card from './Card.jsx'
import Button from './Button.jsx'
import FieldLabel from './FieldLabel.jsx'
import TextField from './TextField.jsx'
import Callout from './Callout.jsx'
import { applyTransferCode, isTransferCode } from '../storage/deviceLink.js'

// Receiving device: open the camera, read the transfer QR, then decrypt it with
// the passphrase and write the login (+ setup) onto this device. onDone is called
// with { includedSetup } after a successful restore.
export default function DeviceLinkScanner({ onDone, onCancel }) {
  const videoRef  = useRef(null)
  const rafRef    = useRef(null)
  const streamRef = useRef(null)

  const [scanned, setScanned]       = useState(null)  // decoded QR text
  const [passphrase, setPassphrase] = useState('')
  const [applying, setApplying]     = useState(false)
  const [error, setError]           = useState(null)
  const [camError, setCamError]     = useState(null)

  function stopCamera() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }

  useEffect(() => {
    if (scanned) return  // once a code is captured, stop scanning
    let cancelled = false
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        const video = videoRef.current
        video.srcObject = stream
        await video.play()
        const tick = () => {
          if (cancelled) return
          if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth) {
            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
            const frame = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const code = jsQR(frame.data, frame.width, frame.height)
            if (code && isTransferCode(code.data)) {
              stopCamera()
              setScanned(code.data)
              return
            }
          }
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
      } catch (err) {
        setCamError(err?.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow the camera, then try again.'
          : 'Could not open the camera on this device.')
      }
    }
    start()
    return () => { cancelled = true; stopCamera() }
  }, [scanned])

  async function apply() {
    setApplying(true); setError(null)
    try {
      const { includedSetup } = await applyTransferCode(scanned, passphrase)
      onDone?.(includedSetup)
    } catch (err) {
      setError(err.message)
    } finally {
      setApplying(false)
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-[var(--color-text-body)]">Set up from another device</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          On your other device, open Settings &rarr; &ldquo;Transfer to another device&rdquo; and show its QR. Scan it here.
        </p>
      </div>

      {!scanned ? (
        camError ? (
          <Callout tone="error" title="Camera unavailable">{camError}</Callout>
        ) : (
          <video
            ref={videoRef}
            muted
            playsInline
            className="w-full max-w-sm rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-hover)]"
          />
        )
      ) : (
        <div className="space-y-3 max-w-sm">
          <p className="text-sm text-[var(--color-success)]">Code found. Now type the transfer passphrase.</p>
          <div>
            <FieldLabel htmlFor="scan-pass">Transfer passphrase</FieldLabel>
            <TextField id="scan-pass" type="password" value={passphrase} onChange={setPassphrase} placeholder="From the other device" />
          </div>
          {error && <p className="text-sm text-[var(--color-error)]">{error}</p>}
          <Button onClick={apply} disabled={applying || passphrase.length < 6}>{applying ? 'Restoring…' : 'Restore to this device'}</Button>
        </div>
      )}

      <Button variant="ghost" size="sm" onClick={() => { stopCamera(); onCancel?.() }}>Cancel</Button>
    </Card>
  )
}
