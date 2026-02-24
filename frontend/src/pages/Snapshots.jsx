import { useState, useEffect, Fragment } from 'react'
import api from '../api'
import ConfirmDialog from '../components/ConfirmDialog'
import useJobPoller from '../useJobPoller'

const inputCls = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm dark:bg-gray-700 dark:text-gray-100'
const labelCls = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'
const helpCls = 'text-xs text-gray-500 dark:text-gray-400 mt-1'

const ChevronRight = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
)

const ChevronDown = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
)

export default function Snapshots() {
  const [snapshots, setSnapshots] = useState([])
  const [datasets, setDatasets] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [dataset, setDataset] = useState('')
  const [snapName, setSnapName] = useState('')
  const [recursive, setRecursive] = useState(false)
  const [filter, setFilter] = useState('')
  const [expandedRows, setExpandedRows] = useState(new Set())
  const [selectedRows, setSelectedRows] = useState(new Set())
  const [confirmAction, setConfirmAction] = useState(null)
  const [rollbackConfirmed, setRollbackConfirmed] = useState(false)
  const [cloneDialog, setCloneDialog] = useState(null)
  const [cloneTarget, setCloneTarget] = useState('')
  const [error, setError] = useState('')
  const { submitJob } = useJobPoller()

  const load = async () => {
    try {
      const [snapRes, dsRes] = await Promise.all([
        api.get('/snapshots'),
        api.get('/datasets'),
      ])
      setSnapshots(snapRes.data)
      setDatasets(Array.isArray(dsRes.data) ? dsRes.data : [])
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
      setRecursive(false)
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Create failed')
    }
  }

  const deleteSnapshot = async (name) => {
    try {
      await api.delete(`/snapshots/${encodeURIComponent(name)}`)
      setConfirmAction(null)
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Delete failed')
    }
  }

  const batchDelete = async () => {
    try {
      await Promise.all(
        [...selectedRows].map(name => api.delete(`/snapshots/${encodeURIComponent(name)}`))
      )
      setConfirmAction(null)
      setSelectedRows(new Set())
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Batch delete failed')
    }
  }

  const rollbackSnapshot = async (name) => {
    try {
      await submitJob(() => api.post(`/snapshots/${encodeURIComponent(name)}/rollback`))
      setConfirmAction(null)
      setRollbackConfirmed(false)
      load()
    } catch (err) {
      if (err.response?.status === 409) {
        setError('A rollback is already in progress for this dataset')
      } else {
        setError(err.response?.data?.detail || 'Rollback failed')
      }
    }
  }

  const cloneSnapshot = async (name, target) => {
    try {
      await api.post(`/snapshots/${encodeURIComponent(name)}/clone?target=${encodeURIComponent(target)}`)
      setCloneDialog(null)
      setCloneTarget('')
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Clone failed')
    }
  }

  useEffect(() => { load() }, [])

  const datasetNames = datasets.map(d => d.name || d.id || d)

  const filtered = filter
    ? snapshots.filter(s => s.name.toLowerCase().includes(filter.toLowerCase()))
    : snapshots

  const toggleExpand = (name) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  const toggleSelect = (name) => {
    setSelectedRows(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedRows.size === filtered.length && filtered.length > 0) {
      setSelectedRows(new Set())
    } else {
      setSelectedRows(new Set(filtered.map(s => s.name)))
    }
  }

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Snapshots</h2>
      </div>
      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-500 hover:text-red-700 ml-4">&times;</button>
        </div>
      )}

      {/* Filter bar + Add button */}
      <div className="flex items-center gap-3 mb-4">
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter snapshots..."
          className={inputCls + ' flex-1'}
        />
        {selectedRows.size > 0 && (
          <button
            onClick={() => setConfirmAction({ type: 'batch-delete' })}
            className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 whitespace-nowrap"
          >
            Delete Selected ({selectedRows.size})
          </button>
        )}
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 whitespace-nowrap"
        >
          {showCreate ? 'Cancel' : 'Add'}
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <form onSubmit={createSnapshot} className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className={labelCls}>Dataset</label>
              <select value={dataset} onChange={e => setDataset(e.target.value)} className={inputCls} required>
                <option value="">Select a dataset...</option>
                {datasetNames.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              <p className={helpCls}>The ZFS dataset to snapshot</p>
            </div>
            <div>
              <label className={labelCls}>Snapshot Name</label>
              <input
                type="text"
                value={snapName}
                onChange={e => setSnapName(e.target.value)}
                placeholder="auto-2026-02-24_14-30"
                className={inputCls + ' font-mono'}
              />
              <p className={helpCls}>Leave blank for auto-generated name</p>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" checked={recursive} onChange={e => setRecursive(e.target.checked)} className="rounded" />
              Recursive
              <span className={helpCls + ' ml-1'}>Include all child datasets</span>
            </label>
            <button type="submit" className="px-5 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 font-medium">
              Create Snapshot
            </button>
          </div>
        </form>
      )}

      {/* Snapshot table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="px-4 py-3 w-8">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selectedRows.size === filtered.length}
                  onChange={toggleSelectAll}
                  className="rounded"
                />
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Dataset</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Snapshot</th>
              <th className="px-4 py-3 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  {filter
                    ? 'No snapshots match the current filter.'
                    : 'No snapshots found. Click Add to create one.'}
                </td>
              </tr>
            ) : filtered.map(snap => (
              <Fragment key={snap.name}>
                <tr
                  className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                  onClick={() => toggleExpand(snap.name)}
                >
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedRows.has(snap.name)}
                      onChange={() => toggleSelect(snap.name)}
                      className="rounded"
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{snap.dataset}</td>
                  <td className="px-4 py-3 font-mono text-xs">{snap.snapshot}</td>
                  <td className="px-4 py-3 text-gray-400">
                    {expandedRows.has(snap.name) ? <ChevronDown /> : <ChevronRight />}
                  </td>
                </tr>
                {expandedRows.has(snap.name) && (
                  <tr className="bg-gray-50 dark:bg-gray-700 border-t dark:border-gray-700">
                    <td colSpan={4} className="px-6 py-4">
                      <div className="grid grid-cols-3 gap-4 mb-4">
                        <div>
                          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Date Created</span>
                          <p className="text-sm text-gray-800 dark:text-gray-200 mt-1">{snap.creation}</p>
                        </div>
                        <div>
                          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Used</span>
                          <p className="text-sm text-gray-800 dark:text-gray-200 mt-1">{snap.used}</p>
                        </div>
                        <div>
                          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Referenced</span>
                          <p className="text-sm text-gray-800 dark:text-gray-200 mt-1">{snap.refer}</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={e => { e.stopPropagation(); setConfirmAction({ type: 'delete', name: snap.name }) }}
                          className="px-3 py-1.5 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                        >
                          Delete
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); setCloneDialog(snap.name); setCloneTarget('') }}
                          className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                        >
                          Clone to New Dataset
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); setRollbackConfirmed(false); setConfirmAction({ type: 'rollback', name: snap.name }) }}
                          className="px-3 py-1.5 text-xs bg-amber-600 text-white rounded hover:bg-amber-700"
                        >
                          Rollback
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {/* Row count footer */}
        <div className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
          {filter
            ? `${filtered.length} of ${snapshots.length} snapshot${snapshots.length !== 1 ? 's' : ''}`
            : `${snapshots.length} snapshot${snapshots.length !== 1 ? 's' : ''}`}
        </div>
      </div>

      {/* Delete / Rollback / Batch-delete confirm dialogs */}
      {confirmAction?.type === 'delete' && (
        <ConfirmDialog
          title="Delete Snapshot"
          message={`Permanently delete "${confirmAction.name}"?`}
          confirmText="Delete"
          danger
          onConfirm={() => deleteSnapshot(confirmAction.name)}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {confirmAction?.type === 'batch-delete' && (
        <ConfirmDialog
          title="Delete Selected Snapshots"
          confirmText="Delete All"
          danger
          onConfirm={batchDelete}
          onCancel={() => setConfirmAction(null)}
        >
          <p>Permanently delete {selectedRows.size} selected snapshot{selectedRows.size !== 1 ? 's' : ''}?</p>
          <ul className="mt-2 max-h-40 overflow-y-auto text-xs font-mono space-y-1">
            {[...selectedRows].map(n => <li key={n}>{n}</li>)}
          </ul>
        </ConfirmDialog>
      )}

      {confirmAction?.type === 'rollback' && (
        <ConfirmDialog
          title="Dataset Rollback From Snapshot"
          confirmText="Rollback"
          danger
          disabled={!rollbackConfirmed}
          onConfirm={() => rollbackSnapshot(confirmAction.name)}
          onCancel={() => { setConfirmAction(null); setRollbackConfirmed(false) }}
        >
          <p className="mb-2">
            Rolling back dataset <strong>{confirmAction.name.split('@')[0]}</strong> to snapshot <strong className="font-mono">{confirmAction.name}</strong>.
          </p>
          <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded text-amber-800 dark:text-amber-300 text-xs mb-3">
            <strong>Warning:</strong> This will destroy all snapshots taken after this point and revert the dataset to the state at the time of this snapshot. This action cannot be undone.
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={rollbackConfirmed}
              onChange={e => setRollbackConfirmed(e.target.checked)}
              className="rounded"
            />
            I understand this will permanently destroy data
          </label>
        </ConfirmDialog>
      )}

      {/* Clone dialog */}
      {cloneDialog && (
        <ConfirmDialog
          title="Clone to New Dataset"
          confirmText="Clone"
          disabled={!cloneTarget.trim()}
          onConfirm={() => cloneSnapshot(cloneDialog, cloneTarget.trim())}
          onCancel={() => { setCloneDialog(null); setCloneTarget('') }}
        >
          <p className="mb-3">
            Clone snapshot <strong className="font-mono">{cloneDialog}</strong> to a new dataset.
          </p>
          <label className={labelCls}>Target Dataset Name</label>
          <input
            type="text"
            value={cloneTarget}
            onChange={e => setCloneTarget(e.target.value)}
            placeholder="pool/cloned-dataset"
            className={inputCls + ' font-mono'}
          />
          <p className={helpCls}>Full path for the new cloned dataset (e.g. pool/cloned-data)</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
