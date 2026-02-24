import { useState, useEffect, useCallback, useRef } from 'react'
import api from './api'

export default function useJobPoller() {
  const [activeJobs, setActiveJobs] = useState({})
  const intervalsRef = useRef({})

  const pollJob = useCallback(async (jobId) => {
    try {
      const res = await api.get(`/jobs/${jobId}`)
      const job = res.data
      setActiveJobs(prev => ({ ...prev, [jobId]: job }))
      if (job.status !== 'pending' && job.status !== 'running') {
        // Job finished — stop polling
        if (intervalsRef.current[jobId]) {
          clearInterval(intervalsRef.current[jobId])
          delete intervalsRef.current[jobId]
        }
      }
    } catch (err) {
      // Job not found or error — stop polling
      if (intervalsRef.current[jobId]) {
        clearInterval(intervalsRef.current[jobId])
        delete intervalsRef.current[jobId]
      }
    }
  }, [])

  const submitJob = useCallback(async (apiCall) => {
    const res = await apiCall()
    const jobId = res.data.job_id
    if (!jobId) return res
    // Immediately add as pending
    setActiveJobs(prev => ({ ...prev, [jobId]: { id: jobId, status: 'pending' } }))
    // Start polling
    pollJob(jobId)
    const interval = setInterval(() => pollJob(jobId), 2000)
    intervalsRef.current[jobId] = interval
    return res
  }, [pollJob])

  const cancelJob = useCallback(async (jobId) => {
    try {
      await api.post(`/jobs/${jobId}/cancel`)
      pollJob(jobId)
    } catch (err) {
      // ignore
    }
  }, [pollJob])

  const clearJob = useCallback((jobId) => {
    if (intervalsRef.current[jobId]) {
      clearInterval(intervalsRef.current[jobId])
      delete intervalsRef.current[jobId]
    }
    setActiveJobs(prev => {
      const next = { ...prev }
      delete next[jobId]
      return next
    })
  }, [])

  // Find active job for a given resource prefix
  const getJobForResource = useCallback((resource) => {
    return Object.values(activeJobs).find(
      j => j.resource === resource && (j.status === 'pending' || j.status === 'running')
    )
  }, [activeJobs])

  // Cleanup all intervals on unmount
  useEffect(() => {
    return () => {
      Object.values(intervalsRef.current).forEach(clearInterval)
    }
  }, [])

  return { activeJobs, submitJob, cancelJob, clearJob, getJobForResource }
}
