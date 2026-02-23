import { useState, useEffect } from 'react'
import api from '../api'
import StatusBadge from '../components/StatusBadge'
import ConfirmDialog from '../components/ConfirmDialog'
import PoolCreateWizard from '../components/PoolCreateWizard'

export default function Pools() {
  const [pools, setPools] = useState([])
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [scrubbing, setScrubbing] = useState(null)
  const [confirmDestroy, setConfirmDestroy] = useState(null)
  const [showWizard, setShowWizard] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const res = await api.get('/pools')
      setPools(res.data)
    } catch (err) {
      setError('Failed to load pools')
    } finally {
      setLoading(false)
    }
  }

  const loadDetail = async (name) => {
    setSelected(name)
    try {
      const res = await api.get(`/pools/${name}`)
      setDetail(res.data)
    } catch (err) {
      setDetail(null)
    }
  }

  const startScrub = async (pool) => {
    setScrubbing(pool)
    try {
      await api.post(`/pools/${pool}/scrub`)
      await loadDetail(pool)
    } catch (err) {
      setError(err.response?.data?.detail || 'Scrub failed')
    } finally {
      setScrubbing(null)
    }
  }

  const destroyPool = async (pool) => {
    try {
      await api.delete(`/pools/${pool}`, { data: { confirm: pool } })
      setConfirmDestroy(null)
      setSelected(null)
      setDetail(null)
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Destroy failed')
    }
  }

  useEffect(() => { load() }, [])

  if (loading) return <div className="text-gray-500">Loading...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Storage Pools</h2>
        {!showWizard && (
          <button
            onClick={() => setShowWizard(true)}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Create Pool
          </button>
        )}
      </div>
      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded">{error}</div>}

      {showWizard && (
        <PoolCreateWizard
          onCreated={() => { setShowWizard(false); load() }}
          onCancel={() => setShowWizard(false)}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg shadow">
            {pools.map(pool => (
              <div
                key={pool.name}
                onClick={() => loadDetail(pool.name)}
                className={`p-4 border-b cursor-pointer hover:bg-gray-50 ${
                  selected === pool.name ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{pool.name}</span>
                  <StatusBadge status={pool.health} />
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {pool.allocated} / {pool.size} ({pool.capacity})
                </div>
              </div>
            ))}
            {pools.length === 0 && (
              <div className="p-4 text-sm text-gray-400">No pools found</div>
            )}
          </div>
        </div>

        <div className="lg:col-span-2">
          {detail && (
            <div className="bg-white rounded-lg shadow p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">{selected}</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => startScrub(selected)}
                    disabled={scrubbing === selected}
                    className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    {scrubbing === selected ? 'Starting...' : 'Start Scrub'}
                  </button>
                  <button
                    onClick={() => setConfirmDestroy(selected)}
                    className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700"
                  >
                    Destroy
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <span className="text-xs text-gray-500">State</span>
                  <div><StatusBadge status={detail.state} /></div>
                </div>
                <div>
                  <span className="text-xs text-gray-500">Errors</span>
                  <div className="text-sm">{detail.errors}</div>
                </div>
              </div>
              {detail.scan && (
                <div className="mb-4">
                  <span className="text-xs text-gray-500">Scan</span>
                  <div className="text-sm whitespace-pre-wrap font-mono text-xs bg-gray-50 p-2 rounded mt-1">{detail.scan}</div>
                </div>
              )}
              <div>
                <span className="text-xs text-gray-500">Configuration</span>
                <pre className="text-xs bg-gray-50 p-3 rounded mt-1 overflow-x-auto">{detail.config}</pre>
              </div>
            </div>
          )}
        </div>
      </div>

      {confirmDestroy && (
        <ConfirmDialog
          title={`Destroy pool "${confirmDestroy}"?`}
          message="This will permanently destroy the pool and all data. This cannot be undone."
          confirmText="Destroy Pool"
          danger
          onConfirm={() => destroyPool(confirmDestroy)}
          onCancel={() => setConfirmDestroy(null)}
        />
      )}
    </div>
  )
}
