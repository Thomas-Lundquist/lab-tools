import { useState } from 'react'
import QRCode from 'qrcode'
import Card from './Card.jsx'
import Button from './Button.jsx'
import FieldLabel from './FieldLabel.jsx'
import TextField from './TextField.jsx'
import { buildTransferCode } from '../storage/deviceLink.js'

// Source device: turn this device's Canvas login (and setup, if it fits) into a
// passphrase-encrypted QR for another device to scan. Nothing is uploaded — the
// QR is the whole transfer, and the passphrase never leaves either device.
export default function DeviceLinkExport() {
  const [passphrase, setPassphrase] = useState('')
  const [qr, setQr]                 = useState(null)   // data URL
  const [includedSetup, setIncludedSetup] = useState(true)
  const [busy, setBusy]             = useState(false)
  const [error, setError]           = useState(null)

  async function generate() {
    setBusy(true); setError(null)
    try {
      const { text, includedSetup: didSetup } = await buildTransferCode(passphrase)
      const dataUrl = await QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 2, scale: 6 })
      setQr(dataUrl); setIncludedSetup(didSetup)
    } catch (err) {
      setError(err.message); setQr(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-[var(--color-text-body)]">Transfer to another device</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Move your Canvas login to a phone or tablet. Choose a passphrase, show the QR, then scan it on the other
          device and type the same passphrase there. Nothing is uploaded to any server.
        </p>
      </div>

      {!qr ? (
        <div className="space-y-3 max-w-sm">
          <div>
            <FieldLabel htmlFor="xfer-pass">Transfer passphrase</FieldLabel>
            <TextField id="xfer-pass" type="password" value={passphrase} onChange={setPassphrase} placeholder="At least 6 characters" />
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">Use a strong passphrase. It is the only thing protecting the QR.</p>
          </div>
          {error && <p className="text-sm text-[var(--color-error)]">{error}</p>}
          <Button onClick={generate} disabled={busy || passphrase.length < 6}>{busy ? 'Preparing…' : 'Show QR code'}</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* The QR PNG bakes in its own white quiet zone, so it scans on any
              page background without a white wrapper (which the token guard rejects). */}
          <div className="inline-block rounded-[var(--radius-card)] border border-[var(--color-border)] overflow-hidden">
            <img src={qr} alt="Device transfer QR code" width={224} height={224} className="block" />
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">
            {includedSetup
              ? 'This code includes your Canvas login and your course/lab setup.'
              : 'Your setup was too large for a QR, so this code includes your Canvas login only. Set up courses on the other device.'}
          </p>
          <ol className="text-sm text-[var(--color-text-secondary)] list-decimal list-inside space-y-1">
            <li>On the other device, open the app and choose &ldquo;Set up from another device.&rdquo;</li>
            <li>Scan this QR with its camera.</li>
            <li>Type your transfer passphrase.</li>
          </ol>
          <Button variant="secondary" size="sm" onClick={() => { setQr(null); setPassphrase('') }}>Done</Button>
        </div>
      )}
    </Card>
  )
}
