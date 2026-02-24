import { useState, useEffect, useRef } from 'react'
import api from '../api'

const STATUS_STYLES = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  running: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
}

function duration(start, end) {
  if (!start) return '-'
  const s = new Date(start + 'Z')
  const e = end ? new Date(end + 'Z') : new Date()
  const secs = Math.max(0, Math.floor((e - s) / 1000))
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`
}

export default function Jobs() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState('')
  const hasRunning = useRef(false)

  const load = async () => {
    try {
      const params = {}
      if (filter) params.status = filter
      const res = await api.get('/jobs', { params })
      setJobs(res.data)
      hasRunning.current = res.data.some(j => j.status === 'pending' || j.status === 'running')
    } catch (err) {
      setError('Failed to load jobs')
    } finally {
      setLoading(false)
    }
  }

  const loadDetail = async (id) => {
    setSelected(id)
    try {
      const res = await api.get(`/jobs/${id}`)
      setDetail(res.data)
    } catch (err) {
      setDetail(null)
    }
  }

  const cancelJob = async (id) => {
    try {
      await api.post(`/jobs/${id}/cancel`)
      load()
      if (selected === id) loadDetail(id)
    } catch (err) {
      setError(err.response?.data?.detail || 'Cancel failed')
    }
  }

  useEffect(() => { load() }, [filter])

  // Auto-refresh when jobs are running
  useEffect(() => {
    const interval = setInterval(() => {
      if (hasRunning.current) {
        load()
        if (selected && detail && (detail.status === 'pending' || detail.status === 'running')) {
          loadDetail(selected)
        }
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [selected, detail?.status])

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Background Jobs</h2>
        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100"
        >
          <option value="">All statuses</option>
          <option value="running">Running</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>
      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">ID</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Description</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Started</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Duration</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(j => (
                  <tr
                    key={j.id}
                    onClick={() => loadDetail(j.id)}
                    className={`border-t dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 ${
                      selected === j.id ? 'bg-blue-50 dark:bg-blue-900/30' : ''
                    }`}
                  >
                    <td className="px-4 py-3 font-mono text-xs">{j.id}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">{j.job_type}</span>
                    </td>
                    <td className="px-4 py-3 text-xs max-w-xs truncate">{j.description}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${STATUS_STYLES[j.status] || ''}`}>{j.status}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{j.started_at || j.created_at || '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{duration(j.started_at, j.finished_at)}</td>
                    <td className="px-4 py-3 text-right">
                      {(j.status === 'pending' || j.status === 'running') && (
                        <button
                          onClick={(e) => { e.stopPropagation(); cancelJob(j.id) }}
                          className="text-red-600 hover:text-red-800 text-xs"
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {jobs.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">No jobs found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="lg:col-span-1">
          {detail && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Job #{detail.id}</h3>
                <span className={`text-xs px-2 py-0.5 rounded ${STATUS_STYLES[detail.status] || ''}`}>{detail.status}</span>
              </div>
              <div className="space-y-2 text-xs">
                <div><span className="text-gray-500 dark:text-gray-400">Type:</span> <span className="font-medium">{detail.job_type}</span></div>
                <div><span className="text-gray-500 dark:text-gray-400">Description:</span> {detail.description}</div>
                <div><span className="text-gray-500 dark:text-gray-400">Resource:</span> <span className="font-mono">{detail.resource}</span></div>
                <div><span className="text-gray-500 dark:text-gray-400">Started by:</span> {detail.started_by}</div>
                <div><span className="text-gray-500 dark:text-gray-400">Created:</span> {detail.created_at}</div>
                {detail.started_at && <div><span className="text-gray-500 dark:text-gray-400">Started:</span> {detail.started_at}</div>}
                {detail.finished_at && <div><span className="text-gray-500 dark:text-gray-400">Finished:</span> {detail.finished_at}</div>}
                {detail.returncode !== null && detail.returncode !== undefined && (
                  <div><span className="text-gray-500 dark:text-gray-400">Exit code:</span> <span className="font-mono">{detail.returncode}</span></div>
                )}
                {detail.error && (
                  <div className="p-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded">
                    {detail.error}
                  </div>
                )}
              </div>
              {detail.stdout && (
                <div className="mt-3">
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">stdout</div>
                  <pre className="text-xs bg-gray-50 dark:bg-gray-700 p-2 rounded overflow-x-auto max-h-48 overflow-y-auto font-mono">{detail.stdout}</pre>
                </div>
              )}
              {detail.stderr && (
                <div className="mt-3">
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">stderr</div>
                  <pre className="text-xs bg-red-50 dark:bg-red-900/10 p-2 rounded overflow-x-auto max-h-48 overflow-y-auto font-mono text-red-700 dark:text-red-400">{detail.stderr}</pre>
                </div>
              )}
              {(detail.status === 'pending' || detail.status === 'running') && (
                <button
                  onClick={() => cancelJob(detail.id)}
                  className="mt-3 px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 w-full"
                >
                  Cancel Job
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
