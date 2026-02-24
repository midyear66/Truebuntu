import { useState, useEffect } from 'react'
import api from '../api'
import ConfirmDialog from '../components/ConfirmDialog'
import useJobPoller from '../useJobPoller'

export default function Snapshots() {
  const [snapshots, setSnapshots] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [dataset, setDataset] = useState('')
  const [snapName, setSnapName] = useState('')
  const [recursive, setRecursive] = useState(false)
  const [confirmAction, setConfirmAction] = useState(null)
  const [error, setError] = useState('')
  const { submitJob } = useJobPoller()

  const load = async () => {
    try {
      const res = await api.get('/snapshots')
      setSnapshots(res.data)
    } catch (err) {
      setError('Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  const createSnapshot = async (e) => {
    e.preventDefault()
    try {
      await api.post('/snapshots', { dataset, name: snapName || undefined, recursive })
      setShowCreate(false)
      setDataset('')
      setSnapName('')
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Create failed')
    }
  }

  const deleteSnapshot = async (name) => {
    try {
      await api.delete(`/snapshots/${name}`)
      setConfirmAction(null)
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Delete failed')
    }
  }

  const rollbackSnapshot = async (name) => {
    try {
      await submitJob(() => api.post(`/snapshots/${name}/rollback`))
      setConfirmAction(null)
      load()
    } catch (err) {
      if (err.response?.status === 409) {
        setError('A rollback is already in progress for this dataset')
      } else {
        setError(err.response?.data?.detail || 'Rollback failed')
      }
    }
  }

  useEffect(() => { load() }, [])

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Snapshots</h2>
      </div>
      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}

      <div className="mb-4">
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Create Snapshot
        </button>
      </div>

      {showCreate && (
        <form onSubmit={createSnapshot} className="bg-white dark:bg-gray-800 rounded-lg shadow p-5 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input type="text" value={dataset} onChange={e => setDataset(e.target.value)} placeholder="Dataset (e.g. testpool/data)" className="border rounded px-3 py-2 text-sm" required />
            <input type="text" value={snapName} onChange={e => setSnapName(e.target.value)} placeholder="Name (optional)" className="border rounded px-3 py-2 text-sm" />
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" checked={recursive} onChange={e => setRecursive(e.target.checked)} />
                Recursive
              </label>
              <button type="submit" className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700">Create</button>
            </div>
          </div>
        </form>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Used</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Refer</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Created</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {snapshots.map(snap => (
              <tr key={snap.name} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                <td className="px-4 py-3 font-mono text-xs">{snap.name}</td>
                <td className="px-4 py-3">{snap.used}</td>
                <td className="px-4 py-3">{snap.refer}</td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{snap.creation}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => setConfirmAction({ type: 'rollback', name: snap.name })} className="text-yellow-600 hover:text-yellow-800 text-xs mr-3">Rollback</button>
                  <button onClick={() => setConfirmAction({ type: 'delete', name: snap.name })} className="text-red-600 hover:text-red-800 text-xs">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.type === 'rollback' ? 'Rollback to snapshot?' : 'Delete snapshot?'}
          message={confirmAction.type === 'rollback'
            ? `This will rollback to "${confirmAction.name}". Later snapshots will be destroyed.`
            : `Permanently delete "${confirmAction.name}"?`}
          confirmText={confirmAction.type === 'rollback' ? 'Rollback' : 'Delete'}
          danger
          onConfirm={() => confirmAction.type === 'rollback' ? rollbackSnapshot(confirmAction.name) : deleteSnapshot(confirmAction.name)}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  )
}
