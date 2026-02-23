import { useState, useEffect } from 'react'
import api from '../api'

export default function Updates() {
  const [packages, setPackages] = useState([])
  const [lastCheck, setLastCheck] = useState(null)
  const [checking, setChecking] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyOutput, setApplyOutput] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [showConfirm, setShowConfirm] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get('/updates/available')
        setPackages(res.data.packages || [])
        setLastCheck(res.data.last_check)
      } catch (err) {
        setError(err.response?.data?.detail || 'Failed to load update status')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const checkUpdates = async () => {
    setChecking(true)
    setError('')
    setApplyOutput('')
    try {
      const res = await api.post('/updates/check')
      setPackages(res.data.packages || [])
      setLastCheck(new Date().toISOString())
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to check for updates')
    } finally {
      setChecking(false)
    }
  }

  const applyUpdates = async () => {
    setShowConfirm(false)
    setApplying(true)
    setError('')
    try {
      const res = await api.post('/updates/apply')
      setApplyOutput(res.data.output || 'Updates applied successfully.')
      setPackages([])
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to apply updates')
    } finally {
      setApplying(false)
    }
  }

  if (loading) return <div className="text-gray-500">Loading...</div>

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-6">System Updates</h2>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded">{error}</div>}

      {/* Status card */}
      <div className="bg-white rounded-lg shadow p-5 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500">
              Last check: {lastCheck ? new Date(lastCheck).toLocaleString() : 'Never'}
            </p>
            <p className="text-lg font-semibold mt-1">
              {packages.length === 0 ? 'System is up to date' : `${packages.length} update${packages.length !== 1 ? 's' : ''} available`}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={checkUpdates}
              disabled={checking || applying}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {checking ? 'Checking...' : 'Check for Updates'}
            </button>
            {packages.length > 0 && (
              <button
                onClick={() => setShowConfirm(true)}
                disabled={applying}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                {applying ? 'Applying...' : 'Apply Updates'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Confirm dialog */}
      {showConfirm && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-sm font-medium text-yellow-800 mb-3">
            Apply {packages.length} update{packages.length !== 1 ? 's' : ''}? This may take several minutes.
          </p>
          <div className="flex gap-2">
            <button onClick={applyUpdates} className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700">
              Confirm
            </button>
            <button onClick={() => setShowConfirm(false)} className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Package table */}
      {packages.length > 0 && (
        <div className="bg-white rounded-lg shadow overflow-hidden mb-6">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Package</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Current Version</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">New Version</th>
              </tr>
            </thead>
            <tbody>
              {packages.map(p => (
                <tr key={p.name} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium">{p.name}</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">{p.current_version}</td>
                  <td className="px-4 py-2 font-mono text-xs text-green-700">{p.new_version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Apply output */}
      {applyOutput && (
        <div className="bg-white rounded-lg shadow p-5">
          <h3 className="text-sm font-semibold text-gray-500 uppercase mb-2">Update Output</h3>
          <pre className="text-xs bg-gray-900 text-green-400 p-4 rounded overflow-auto max-h-96 whitespace-pre-wrap">{applyOutput}</pre>
        </div>
      )}
    </div>
  )
}
