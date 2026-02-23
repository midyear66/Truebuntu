import { useState, useEffect } from 'react'
import api from '../api'
import ConfirmDialog from '../components/ConfirmDialog'

export default function Snapshots() {
  const [snapshots, setSnapshots] = useState([])
  const [policies, setPolicies] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('snapshots')
  const [showCreate, setShowCreate] = useState(false)
  const [dataset, setDataset] = useState('')
  const [snapName, setSnapName] = useState('')
  const [recursive, setRecursive] = useState(false)
  const [confirmAction, setConfirmAction] = useState(null)
  const [error, setError] = useState('')

  // Policy form
  const [showPolicyForm, setShowPolicyForm] = useState(false)
  const [policyForm, setPolicyForm] = useState({
    name: '', dataset: '', schedule: '0 * * * *', retention_count: 10,
    retention_unit: 'count', naming_schema: 'auto-%Y-%m-%d_%H-%M', recursive: false, enabled: true,
  })

  const load = async () => {
    try {
      const [snapRes, polRes] = await Promise.all([
        api.get('/snapshots'),
        api.get('/snapshot-policies'),
      ])
      setSnapshots(snapRes.data)
      setPolicies(polRes.data)
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
      await api.post(`/snapshots/${name}/rollback`)
      setConfirmAction(null)
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Rollback failed')
    }
  }

  const createPolicy = async (e) => {
    e.preventDefault()
    try {
      await api.post('/snapshot-policies', policyForm)
      setShowPolicyForm(false)
      setPolicyForm({ name: '', dataset: '', schedule: '0 * * * *', retention_count: 10, retention_unit: 'count', naming_schema: 'auto-%Y-%m-%d_%H-%M', recursive: false, enabled: true })
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Create policy failed')
    }
  }

  const deletePolicy = async (id) => {
    try {
      await api.delete(`/snapshot-policies/${id}`)
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Delete policy failed')
    }
  }

  useEffect(() => { load() }, [])

  if (loading) return <div className="text-gray-500">Loading...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Snapshots</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setTab('snapshots')}
            className={`px-3 py-1 text-sm rounded ${tab === 'snapshots' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            Snapshots ({snapshots.length})
          </button>
          <button
            onClick={() => setTab('policies')}
            className={`px-3 py-1 text-sm rounded ${tab === 'policies' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            Policies ({policies.length})
          </button>
        </div>
      </div>
      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded">{error}</div>}

      {tab === 'snapshots' && (
        <>
          <div className="mb-4">
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Create Snapshot
            </button>
          </div>

          {showCreate && (
            <form onSubmit={createSnapshot} className="bg-white rounded-lg shadow p-5 mb-6">
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

          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Used</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Refer</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Created</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map(snap => (
                  <tr key={snap.name} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs">{snap.name}</td>
                    <td className="px-4 py-3">{snap.used}</td>
                    <td className="px-4 py-3">{snap.refer}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{snap.creation}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setConfirmAction({ type: 'rollback', name: snap.name })} className="text-yellow-600 hover:text-yellow-800 text-xs mr-3">Rollback</button>
                      <button onClick={() => setConfirmAction({ type: 'delete', name: snap.name })} className="text-red-600 hover:text-red-800 text-xs">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'policies' && (
        <>
          <div className="mb-4">
            <button onClick={() => setShowPolicyForm(!showPolicyForm)} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
              Create Policy
            </button>
          </div>

          {showPolicyForm && (
            <form onSubmit={createPolicy} className="bg-white rounded-lg shadow p-5 mb-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <input type="text" value={policyForm.name} onChange={e => setPolicyForm({...policyForm, name: e.target.value})} placeholder="Policy name" className="border rounded px-3 py-2 text-sm" required />
                <input type="text" value={policyForm.dataset} onChange={e => setPolicyForm({...policyForm, dataset: e.target.value})} placeholder="Dataset" className="border rounded px-3 py-2 text-sm" required />
                <input type="text" value={policyForm.schedule} onChange={e => setPolicyForm({...policyForm, schedule: e.target.value})} placeholder="Cron schedule" className="border rounded px-3 py-2 text-sm" required />
                <input type="number" value={policyForm.retention_count} onChange={e => setPolicyForm({...policyForm, retention_count: parseInt(e.target.value)})} placeholder="Retention count" className="border rounded px-3 py-2 text-sm" />
              </div>
              <button type="submit" className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700">Create Policy</button>
            </form>
          )}

          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Dataset</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Schedule</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Retention</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {policies.map(p => (
                  <tr key={p.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-3">{p.name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{p.dataset}</td>
                    <td className="px-4 py-3 font-mono text-xs">{p.schedule}</td>
                    <td className="px-4 py-3">{p.retention_count}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${p.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                        {p.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => deletePolicy(p.id)} className="text-red-600 hover:text-red-800 text-xs">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

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
