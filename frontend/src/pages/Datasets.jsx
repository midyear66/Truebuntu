import { useState, useEffect } from 'react'
import api from '../api'

export default function Datasets() {
  const [datasets, setDatasets] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const res = await api.get('/datasets')
      setDatasets(res.data)
    } catch (err) {
      setError('Failed to load datasets')
    } finally {
      setLoading(false)
    }
  }

  const createDataset = async (e) => {
    e.preventDefault()
    try {
      await api.post('/datasets', { name: newName })
      setNewName('')
      setShowCreate(false)
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Create failed')
    }
  }

  const deleteDataset = async (name) => {
    if (!confirm(`Delete dataset "${name}"?`)) return
    try {
      await api.delete(`/datasets/${name}`)
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Delete failed')
    }
  }

  useEffect(() => { load() }, [])

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Datasets</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Create Dataset
        </button>
      </div>
      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}

      {showCreate && (
        <form onSubmit={createDataset} className="bg-white dark:bg-gray-800 rounded-lg shadow p-5 mb-6">
          <div className="flex gap-3">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="pool/dataset-name"
              className="flex-1 border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm"
              required
            />
            <button type="submit" className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700">
              Create
            </button>
          </div>
        </form>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Used</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Available</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Refer</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Mountpoint</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {datasets.map(ds => (
              <tr key={ds.name} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                <td className="px-4 py-3 font-mono text-xs">{ds.name}</td>
                <td className="px-4 py-3">{ds.used}</td>
                <td className="px-4 py-3">{ds.available}</td>
                <td className="px-4 py-3">{ds.refer}</td>
                <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">{ds.mountpoint}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => deleteDataset(ds.name)}
                    className="text-red-600 hover:text-red-800 text-xs"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
