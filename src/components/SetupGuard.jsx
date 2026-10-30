import React, { useState, useEffect } from 'react'
import { isSetupComplete } from '../storage/account.js'
import { navigate } from '../utils/nav.js'

export default function SetupGuard({ children }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    isSetupComplete().then(complete => {
      if (!complete) {
        navigate('onboarding', {}, { replace: true })
      } else {
        setReady(true)
      }
    })
  }, [])

  if (!ready) return null

  return children
}
