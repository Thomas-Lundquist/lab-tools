import React from 'react'
import App from './App.jsx'
import { useRoute } from '../../utils/nav.js'

export default function LabsPage() {
  const { params } = useRoute()
  return <App initialCourseId={params.courseId ?? null} />
}
