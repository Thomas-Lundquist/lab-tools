import React, { useState, useEffect } from 'react'
import { isSetupComplete } from '../storage/account.js'
import { pageUrl } from '../utils/nav.js'

export default function SetupGuard({ children }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    isSetupComplete().then(complete => {
      if (!complete) {
        window.location.href = pageUrl('src/pages/onboarding/index.html')
      } else {
        setReady(true)
      }
    })
  }, [])

  if (!ready) return null

  return children
}
