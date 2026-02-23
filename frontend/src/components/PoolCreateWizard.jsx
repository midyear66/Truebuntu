import { useState, useEffect } from 'react'
import api from '../api'

const TOPOLOGIES = [
  {
    value: 'mirror',
    label: 'Mirror',
    desc: 'Two or more copies of data. Best balance of safety and performance.',
    minDisks: 2,
    formula: 'Size of smallest disk',
  },
  {
    value: 'raidz',
    label: 'RAIDZ1',
    desc: 'Single parity — survives one disk failure.',
    minDisks: 3,
    formula: '(N-1) x smallest disk',
  },
  {
    value: 'raidz2',
    label: 'RAIDZ2',
    desc: 'Double parity — survives two disk failures.',
    minDisks: 4,
    formula: '(N-2) x smallest disk',
  },
  {
    value: 'raidz3',
    label: 'RAIDZ3',
    desc: 'Triple parity — survives three disk failures.',
    minDisks: 5,
    formula: '(N-3) x smallest disk',
  },
  {
    value: 'stripe',
    label: 'Stripe',
    desc: 'No redundancy. Any disk failure loses the entire pool.',
    minDisks: 1,
    formula: 'Sum of all disks',
    warning: true,
  },
]

const VALID_NAME = /^[a-zA-Z][a-zA-Z0-9_.-]*$/
const RESERVED_NAMES = new Set([
  'mirror', 'raidz', 'raidz1', 'raidz2', 'raidz3',
  'spare', 'log', 'cache', 'replace', 'fault', 'online', 'offline',
])

function StepIndicator({ step }) {
  const steps = ['Name & Topology', 'Select Disks', 'Review & Create']
  return (
    <div className="flex items-center justify-center mb-8">
      {steps.map((label, i) => (
        <div key={i} className="flex items-center">
          <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold
            ${i < step ? 'bg-blue-600 text-white' : i === step ? 'bg-blue-600 text-white ring-4 ring-blue-200 dark:ring-blue-800' : 'bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-400'}`}>
            {i < step ? '\u2713' : i + 1}
          </div>
          <span className={`ml-2 text-sm ${i === step ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}`}>{label}</span>
          {i < steps.length - 1 && <div className={`w-12 h-0.5 mx-3 ${i < step ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'}`} />}
        </div>
      ))}
    </div>
  )
}

function estimateUsable(topology, dataDisks) {
  if (!dataDisks.length) return null
  const sizes = dataDisks.map(d => d.size_bytes || 0).filter(s => s > 0)
  if (!sizes.length) return null
  const smallest = Math.min(...sizes)
  const n = sizes.length
  let bytes = 0
  if (topology === 'mirror') bytes = smallest
  else if (topology === 'raidz') bytes = (n - 1) * smallest
  else if (topology === 'raidz2') bytes = (n - 2) * smallest
  else if (topology === 'raidz3') bytes = (n - 3) * smallest
  else bytes = sizes.reduce((a, b) => a + b, 0)
  return formatBytes(bytes)
}

function formatBytes(b) {
  if (!b) return ''
  for (const unit of ['B', 'KB', 'MB', 'GB', 'TB', 'PB']) {
    if (Math.abs(b) < 1024) return `${b.toFixed(1)} ${unit}`
    b /= 1024
  }
  return `${b.toFixed(1)} EB`
}

export default function PoolCreateWizard({ onCreated, onCancel }) {
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [topology, setTopology] = useState('')
  const [disks, setDisks] = useState([])
  const [diskRoles, setDiskRoles] = useState({})
  const [force, setForce] = useState(false)
  const [loading, setLoading] = useState(false)
  const [diskLoading, setDiskLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (step === 1 && disks.length === 0) {
      setDiskLoading(true)
      api.get('/disks/available')
        .then(res => setDisks(res.data))
        .catch(() => setError('Failed to load available disks'))
        .finally(() => setDiskLoading(false))
    }
  }, [step])

  const nameError = name && (!VALID_NAME.test(name) ? 'Must start with a letter, then letters/numbers/._-' :
    RESERVED_NAMES.has(name.toLowerCase()) ? 'Reserved name' : '')

  const topoInfo = TOPOLOGIES.find(t => t.value === topology)
  const minDisks = topoInfo?.minDisks || 1

  const dataDisks = disks.filter(d => diskRoles[d.name] === 'data')
  const spareDisks = disks.filter(d => diskRoles[d.name] === 'spare')

  const canAdvanceStep0 = name && !nameError && topology
  const canAdvanceStep1 = dataDisks.length >= minDisks

  const cycleDiskRole = (diskName) => {
    setDiskRoles(prev => {
      const current = prev[diskName]
      const next = !current ? 'data' : current === 'data' ? 'spare' : undefined
      const updated = { ...prev }
      if (next) updated[diskName] = next
      else delete updated[diskName]
      return updated
    })
  }

  const buildCommand = () => {
    const parts = ['zpool', 'create']
    if (force) parts.push('-f')
    parts.push(name)
    if (topology !== 'stripe') parts.push(topology)
    parts.push(...dataDisks.map(d => d.path))
    if (spareDisks.length) {
      parts.push('spare')
      parts.push(...spareDisks.map(d => d.path))
    }
    return parts.join(' ')
  }

  const handleCreate = async () => {
    setLoading(true)
    setError('')
    try {
      await api.post('/pools', {
        name,
        topology,
        disks: dataDisks.map(d => d.path),
        spares: spareDisks.map(d => d.path),
        force,
      })
      onCreated()
    } catch (err) {
      setError(err.response?.data?.detail || 'Pool creation failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Create Pool</h3>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none">&times;</button>
      </div>

      <StepIndicator step={step} />

      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}

      {/* Step 0: Name & Topology */}
      {step === 0 && (
        <div>
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Pool Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. tank, data, backup"
              className={`w-full max-w-xs px-3 py-2 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                nameError ? 'border-red-300' : 'border-gray-300 dark:border-gray-600'
              }`}
            />
            {nameError && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{nameError}</p>}
          </div>

          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-3">Topology</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {TOPOLOGIES.map(topo => (
              <div
                key={topo.value}
                onClick={() => setTopology(topo.value)}
                className={`p-4 border-2 rounded-lg cursor-pointer transition-colors ${
                  topology === topo.value
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                }`}
              >
                <div className="font-semibold text-sm dark:text-gray-100">{topo.label}</div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{topo.desc}</p>
                <div className="text-xs text-gray-400 dark:text-gray-500 mt-2">Min disks: {topo.minDisks} &middot; Usable: {topo.formula}</div>
                {topo.warning && (
                  <div className="mt-2 text-xs text-red-600 dark:text-red-400 font-medium bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded">No redundancy!</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Step 1: Disk Selection */}
      {step === 1 && (
        <div>
          <div className="flex flex-wrap items-center gap-4 mb-4 text-sm">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-blue-500 inline-block"></span> Data ({dataDisks.length})
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-amber-500 inline-block"></span> Spare ({spareDisks.length})
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded bg-gray-200 dark:bg-gray-600 inline-block"></span> Unselected
            </span>
            <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">Click to cycle: unselected &rarr; data &rarr; spare &rarr; unselected</span>
          </div>

          {dataDisks.length < minDisks && (
            <div className="mb-4 p-2 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 text-sm rounded">
              Select at least {minDisks} data disk{minDisks > 1 ? 's' : ''} for {topoInfo?.label}
            </div>
          )}

          {diskLoading ? (
            <div className="text-gray-500 dark:text-gray-400 text-sm py-8 text-center">Loading available disks...</div>
          ) : disks.length === 0 ? (
            <div className="text-gray-400 dark:text-gray-500 text-sm py-8 text-center">No available disks found. All disks may be in use by existing pools.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {disks.map(disk => {
                const role = diskRoles[disk.name]
                const borderColor = role === 'data' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : role === 'spare' ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20'
                  : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                return (
                  <div
                    key={disk.name}
                    onClick={() => cycleDiskRole(disk.name)}
                    className={`p-3 border-2 rounded-lg cursor-pointer transition-colors ${borderColor}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-semibold text-sm dark:text-gray-100">{disk.name}</span>
                      <span className="text-sm font-medium dark:text-gray-200">{disk.size}</span>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">{disk.model || 'Unknown model'}</div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-gray-400 dark:text-gray-500">
                      <span>{disk.rota ? 'HDD' : 'SSD'}</span>
                      {disk.tran && <span className="uppercase">{disk.tran}</span>}
                      {disk.serial && <span className="truncate" title={disk.serial}>{disk.serial}</span>}
                    </div>
                    {role && (
                      <div className={`mt-2 text-xs font-medium px-2 py-0.5 rounded inline-block ${
                        role === 'data' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                      }`}>
                        {role.toUpperCase()}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Step 2: Review & Create */}
      {step === 2 && (
        <div>
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div>
              <span className="text-xs text-gray-500 dark:text-gray-400">Pool Name</span>
              <div className="font-semibold dark:text-gray-100">{name}</div>
            </div>
            <div>
              <span className="text-xs text-gray-500 dark:text-gray-400">Topology</span>
              <div className="font-semibold dark:text-gray-100">{topoInfo?.label}</div>
            </div>
            <div>
              <span className="text-xs text-gray-500 dark:text-gray-400">Data Disks ({dataDisks.length})</span>
              <div className="text-sm font-mono dark:text-gray-200">{dataDisks.map(d => d.name).join(', ')}</div>
            </div>
            <div>
              <span className="text-xs text-gray-500 dark:text-gray-400">Spare Disks ({spareDisks.length})</span>
              <div className="text-sm font-mono dark:text-gray-200">{spareDisks.length > 0 ? spareDisks.map(d => d.name).join(', ') : 'None'}</div>
            </div>
            {estimateUsable(topology, dataDisks) && (
              <div>
                <span className="text-xs text-gray-500 dark:text-gray-400">Estimated Usable</span>
                <div className="font-semibold dark:text-gray-100">{estimateUsable(topology, dataDisks)}</div>
              </div>
            )}
          </div>

          <div className="mb-4">
            <span className="text-xs text-gray-500 dark:text-gray-400">Command Preview</span>
            <pre className="mt-1 p-3 bg-gray-900 text-green-400 text-xs rounded overflow-x-auto">{buildCommand()}</pre>
          </div>

          <div className="flex items-center gap-4 mb-4">
            <label className="flex items-center gap-2 text-sm dark:text-gray-200">
              <input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} className="rounded" />
              Force create (use if disks have existing partitions)
            </label>
          </div>

          {topology === 'stripe' && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm rounded">
              <strong>Warning:</strong> Stripe has no redundancy. Any disk failure will result in total data loss.
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between mt-6 pt-4 border-t dark:border-gray-700">
        <div>
          {step > 0 && (
            <button onClick={() => { setStep(step - 1); setError('') }}
              className="px-4 py-2 text-sm text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600">
              Back
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600">
            Cancel
          </button>
          {step < 2 ? (
            <button
              onClick={() => { setStep(step + 1); setError('') }}
              disabled={step === 0 ? !canAdvanceStep0 : !canAdvanceStep1}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleCreate}
              disabled={loading}
              className="px-4 py-2 text-sm text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Pool'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
