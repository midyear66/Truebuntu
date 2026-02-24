import { useState, useEffect } from 'react'
import api from '../api'
import ConfirmDialog from '../components/ConfirmDialog'

const SYNC_OPTIONS = ['standard', 'always', 'disabled']
const COMPRESSION_OPTIONS = ['off', 'lz4', 'zstd', 'gzip-1', 'gzip-6', 'gzip-9', 'zle', 'lzjb']
const ATIME_OPTIONS = ['on', 'off']
const DEDUP_OPTIONS = ['off', 'on', 'verify']
const READONLY_OPTIONS = ['off', 'on']
const EXEC_OPTIONS = ['on', 'off']
const SNAPDIR_OPTIONS = ['hidden', 'visible']
const RECORDSIZE_OPTIONS = ['4K', '8K', '16K', '32K', '64K', '128K', '256K', '512K', '1M']
const ACLMODE_OPTIONS = ['discard', 'groupmask', 'passthrough', 'restricted']
const LOGBIAS_OPTIONS = ['latency', 'throughput']
const COPIES_OPTIONS = ['1', '2', '3']

const DEFAULT_FORM = {
  parent: '',
  name: '',
  sync: 'standard',
  compression: 'lz4',
  atime: 'on',
  dedup: 'off',
  readonly: 'off',
  exec: 'on',
  snapdir: 'hidden',
  recordsize: '128K',
  aclmode: 'discard',
  logbias: 'latency',
  copies: '1',
  quota: '0',
  refquota: '0',
  reservation: '0',
  refreservation: '0',
}

function parsePropertiesToForm(props) {
  return {
    parent: '',
    name: '',
    sync: props.sync || 'standard',
    compression: props.compression || 'lz4',
    atime: props.atime || 'on',
    dedup: props.dedup || 'off',
    readonly: props.readonly || 'off',
    exec: props.exec || 'on',
    snapdir: props.snapdir || 'hidden',
    recordsize: props.recordsize || '128K',
    aclmode: props.aclmode || 'discard',
    logbias: props.logbias || 'latency',
    copies: props.copies || '1',
    quota: props.quota === 'none' || props.quota === '0' ? '0' : props.quota || '0',
    refquota: props.refquota === 'none' || props.refquota === '0' ? '0' : props.refquota || '0',
    reservation: props.reservation === 'none' || props.reservation === '0' ? '0' : props.reservation || '0',
    refreservation: props.refreservation === 'none' || props.refreservation === '0' ? '0' : props.refreservation || '0',
  }
}

function buildProperties(form, isEdit) {
  const props = {}
  const fields = ['sync', 'compression', 'atime', 'dedup', 'readonly', 'exec', 'snapdir', 'recordsize', 'aclmode', 'logbias', 'copies']
  for (const f of fields) {
    props[f] = form[f]
  }
  const quotaFields = ['quota', 'refquota', 'reservation', 'refreservation']
  for (const f of quotaFields) {
    const val = form[f].trim()
    props[f] = val === '' || val === '0' ? 'none' : val
  }
  return props
}

const inputClass = 'w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded px-3 py-2 text-sm'
const selectClass = 'w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded px-3 py-2 text-sm'
const labelClass = 'block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1'
const sectionHeader = 'text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3 pb-1 border-b dark:border-gray-600'

function SelectField({ label, value, onChange, options }) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} className={selectClass}>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

function InputField({ label, value, onChange, placeholder, hint, disabled }) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={`${inputClass} ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
      />
      {hint && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{hint}</p>}
    </div>
  )
}

export default function Datasets() {
  const [datasets, setDatasets] = useState([])
  const [pools, setPools] = useState([])
  const [poolFilter, setPoolFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [editingDataset, setEditingDataset] = useState(null)
  const [form, setForm] = useState({ ...DEFAULT_FORM })
  const [modalError, setModalError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Delete state
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleteRecursive, setDeleteRecursive] = useState(false)

  const load = async () => {
    try {
      const url = poolFilter ? `/datasets?pool=${encodeURIComponent(poolFilter)}` : '/datasets'
      const res = await api.get(url)
      setDatasets(res.data)

      // Extract unique pool names (root-level names before first /)
      const poolNames = [...new Set(res.data.map(ds => ds.name.split('/')[0]))]
      if (!poolFilter) setPools(poolNames)
    } catch (err) {
      setError('Failed to load datasets')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [poolFilter])

  const updateForm = (field, value) => setForm(prev => ({ ...prev, [field]: value }))

  const openCreate = () => {
    setEditingDataset(null)
    setForm({ ...DEFAULT_FORM, parent: datasets.length > 0 ? datasets[0].name : '' })
    setModalError('')
    setModalOpen(true)
  }

  const openEdit = async (ds) => {
    setModalError('')
    try {
      const res = await api.get(`/datasets/${encodeURIComponent(ds.name)}/properties`)
      const formData = parsePropertiesToForm(res.data)
      setEditingDataset(ds.name)
      setForm(formData)
      setModalOpen(true)
    } catch (err) {
      setError(`Failed to load properties for ${ds.name}`)
    }
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditingDataset(null)
    setModalError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setModalError('')

    try {
      if (editingDataset) {
        const props = buildProperties(form, true)
        await api.put(`/datasets/${encodeURIComponent(editingDataset)}`, { properties: props })
      } else {
        if (!form.parent || !form.name) {
          setModalError('Parent dataset and name are required')
          setSubmitting(false)
          return
        }
        const fullName = `${form.parent}/${form.name}`
        const props = buildProperties(form, false)
        await api.post('/datasets', { name: fullName, properties: props })
      }
      closeModal()
      load()
    } catch (err) {
      setModalError(err.response?.data?.detail || 'Operation failed')
    } finally {
      setSubmitting(false)
    }
  }

  const deleteDataset = async (name) => {
    try {
      await api.delete(`/datasets/${encodeURIComponent(name)}${deleteRecursive ? '?recursive=true' : ''}`)
      setConfirmDelete(null)
      setDeleteRecursive(false)
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Delete failed')
      setConfirmDelete(null)
      setDeleteRecursive(false)
    }
  }

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Datasets</h2>
        <button
          onClick={openCreate}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Add Dataset
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded flex justify-between items-center">
          {error}
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 ml-4">&times;</button>
        </div>
      )}

      {/* Pool filter */}
      {pools.length > 1 && (
        <div className="mb-4">
          <select
            value={poolFilter}
            onChange={e => setPoolFilter(e.target.value)}
            className="border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded px-3 py-2 text-sm"
          >
            <option value="">All Pools</option>
            {pools.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Used</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Available</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Compression</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Quota</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Mountpoint</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {datasets.map(ds => (
              <tr key={ds.name} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <td className="px-4 py-3 font-mono text-xs">{ds.name}</td>
                <td className="px-4 py-3">{ds.used}</td>
                <td className="px-4 py-3">{ds.available}</td>
                <td className="px-4 py-3">{ds.compression || '-'}</td>
                <td className="px-4 py-3">{ds.quota && ds.quota !== 'none' && ds.quota !== '0' ? ds.quota : 'none'}</td>
                <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">{ds.mountpoint}</td>
                <td className="px-4 py-3 text-right space-x-3">
                  <button
                    onClick={() => openEdit(ds)}
                    className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-xs"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => { setDeleteRecursive(false); setConfirmDelete(ds.name) }}
                    className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-xs"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {datasets.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">No datasets found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              {editingDataset ? 'Edit Dataset' : 'Add Dataset'}
            </h3>

            {modalError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">
                {modalError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Name and Options */}
              <div>
                <h4 className={sectionHeader}>Name and Options</h4>
                {editingDataset ? (
                  <div className="mb-3">
                    <label className={labelClass}>Dataset</label>
                    <div className="text-sm font-mono text-gray-800 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 rounded px-3 py-2">
                      {editingDataset}
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className={labelClass}>Parent Dataset</label>
                      <select
                        value={form.parent}
                        onChange={e => updateForm('parent', e.target.value)}
                        className={selectClass}
                        required
                      >
                        <option value="">Select parent...</option>
                        {datasets.map(ds => (
                          <option key={ds.name} value={ds.name}>{ds.name}</option>
                        ))}
                      </select>
                    </div>
                    <InputField
                      label="Name"
                      value={form.name}
                      onChange={v => updateForm('name', v)}
                      placeholder="dataset-name"
                    />
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <SelectField label="Sync" value={form.sync} onChange={v => updateForm('sync', v)} options={SYNC_OPTIONS} />
                  <SelectField label="Compression" value={form.compression} onChange={v => updateForm('compression', v)} options={COMPRESSION_OPTIONS} />
                  <SelectField label="Atime" value={form.atime} onChange={v => updateForm('atime', v)} options={ATIME_OPTIONS} />
                </div>
              </div>

              {/* Other Options */}
              <div>
                <h4 className={sectionHeader}>Other Options</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <SelectField label="Dedup" value={form.dedup} onChange={v => updateForm('dedup', v)} options={DEDUP_OPTIONS} />
                  <SelectField label="Read Only" value={form.readonly} onChange={v => updateForm('readonly', v)} options={READONLY_OPTIONS} />
                  <SelectField label="Exec" value={form.exec} onChange={v => updateForm('exec', v)} options={EXEC_OPTIONS} />
                  <SelectField label="Snap Directory" value={form.snapdir} onChange={v => updateForm('snapdir', v)} options={SNAPDIR_OPTIONS} />
                  <SelectField label="Record Size" value={form.recordsize} onChange={v => updateForm('recordsize', v)} options={RECORDSIZE_OPTIONS} />
                  <SelectField label="ACL Mode" value={form.aclmode} onChange={v => updateForm('aclmode', v)} options={ACLMODE_OPTIONS} />
                  <SelectField label="Log Bias" value={form.logbias} onChange={v => updateForm('logbias', v)} options={LOGBIAS_OPTIONS} />
                  <SelectField label="Copies" value={form.copies} onChange={v => updateForm('copies', v)} options={COPIES_OPTIONS} />
                </div>
              </div>

              {/* Quotas */}
              <div>
                <h4 className={sectionHeader}>Quotas</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <InputField label="Quota" value={form.quota} onChange={v => updateForm('quota', v)} placeholder="0" hint="e.g. 10G, 500M, or 0 for none" />
                  <InputField label="Ref Quota" value={form.refquota} onChange={v => updateForm('refquota', v)} placeholder="0" hint="e.g. 10G, 500M, or 0 for none" />
                  <InputField label="Reservation" value={form.reservation} onChange={v => updateForm('reservation', v)} placeholder="0" hint="e.g. 10G, 500M, or 0 for none" />
                  <InputField label="Ref Reservation" value={form.refreservation} onChange={v => updateForm('refreservation', v)} placeholder="0" hint="e.g. 10G, 500M, or 0 for none" />
                </div>
              </div>

              {/* Buttons */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 text-sm text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Saving...' : editingDataset ? 'Update Dataset' : 'Create Dataset'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete Dataset"
          confirmText="Delete Dataset"
          danger
          onConfirm={() => deleteDataset(confirmDelete)}
          onCancel={() => { setConfirmDelete(null); setDeleteRecursive(false) }}
        >
          <p className="mb-3">
            Are you sure you want to delete <span className="font-mono font-semibold">{confirmDelete}</span>?
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={deleteRecursive}
              onChange={e => setDeleteRecursive(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600"
            />
            <span>Recursive — destroy all child datasets and snapshots</span>
          </label>
        </ConfirmDialog>
      )}
    </div>
  )
}
