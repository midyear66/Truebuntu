import { useState, useEffect } from 'react'
import api from '../api'
import StatusBadge from '../components/StatusBadge'
import ConfirmDialog from '../components/ConfirmDialog'
import PoolCreateWizard from '../components/PoolCreateWizard'

function DiskStateBadge({ state }) {
  const styles = {
    ONLINE: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    DEGRADED: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    FAULTED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    OFFLINE: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
    UNAVAIL: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    REMOVED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    AVAIL: 'bg-blue-100 text-blue-800',
  }
  const style = styles[state] || 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${style}`}>{state}</span>
}

function ErrorCount({ read, write, cksum }) {
  const r = parseInt(read) || 0
  const w = parseInt(write) || 0
  const c = parseInt(cksum) || 0
  if (r === 0 && w === 0 && c === 0) return <span className="text-xs text-gray-400 dark:text-gray-500">0/0/0</span>
  return (
    <span className="text-xs font-mono">
      <span className={r > 0 ? 'text-red-600 font-bold' : ''}>{r}</span>/
      <span className={w > 0 ? 'text-red-600 font-bold' : ''}>{w}</span>/
      <span className={c > 0 ? 'text-red-600 font-bold' : ''}>{c}</span>
    </span>
  )
}

function VdevNode({ node, depth, pool, onAction, inSpares = false, inSpareVdev = false }) {
  const indent = depth * 20
  const isFailed = ['FAULTED', 'UNAVAIL', 'REMOVED', 'OFFLINE'].includes(node.state)
  const isDisk = node.type === 'disk'
  const isSection = node.type === 'section'
  const isSpareVdev = node.type === 'vdev' && /^spare-?\d*$/.test(node.name)
  const isSpare = inSpares || isSpareVdev || inSpareVdev || node.state === 'AVAIL' || node.state === 'INUSE'
  const isSpareSection = isSection && node.name === 'spares'

  return (
    <>
      <tr className={`border-t dark:border-gray-700 ${isFailed && isDisk ? 'bg-red-50 dark:bg-red-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
        <td className="px-4 py-2" style={{ paddingLeft: `${16 + indent}px` }}>
          <span className={`${isDisk ? 'font-mono text-xs' : 'font-medium text-sm'} ${isSection ? 'uppercase text-gray-500 dark:text-gray-400 text-xs tracking-wide' : ''}`}>
            {node.name}
          </span>
        </td>
        <td className="px-4 py-2">
          {node.state && <DiskStateBadge state={node.state} />}
        </td>
        <td className="px-4 py-2">
          {!isSection && <ErrorCount read={node.read} write={node.write} cksum={node.cksum} />}
        </td>
        <td className="px-4 py-2 text-right space-x-1">
          {isDisk && !isSpare && (
            <>
              {node.state === 'ONLINE' && (
                <button onClick={() => onAction('offline', node.name)} className="text-yellow-600 hover:text-yellow-800 text-xs">Offline</button>
              )}
              {node.state === 'OFFLINE' && (
                <button onClick={() => onAction('online', node.name)} className="text-green-600 hover:text-green-800 text-xs">Online</button>
              )}
              {isFailed && (
                <button onClick={() => onAction('replace', node.name)} className="text-blue-600 hover:text-blue-800 text-xs font-medium">Replace</button>
              )}
              <button onClick={() => onAction('detach', node.name)} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xs">Detach</button>
            </>
          )}
          {isDisk && !isSpare && node.state === 'ONLINE' && (
            <>
              <button onClick={() => onAction('attach', node.name)} className="text-green-600 hover:text-green-800 text-xs">Attach</button>
              <button onClick={() => onAction('replace', node.name)} className="text-blue-600 hover:text-blue-800 text-xs">Replace</button>
            </>
          )}
          {isDisk && isSpare && inSpareVdev && (
            <button onClick={() => onAction('detach', node.name)} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xs">Detach</button>
          )}
          {isDisk && inSpares && !inSpareVdev && node.state === 'AVAIL' && (
            <button onClick={() => onAction('remove_spare', node.name)} className="text-red-500 hover:text-red-700 text-xs">Remove</button>
          )}
        </td>
      </tr>
      {node.children && node.children.map(child => (
        <VdevNode key={child.name} node={child} depth={depth + 1} pool={pool} onAction={onAction} inSpares={inSpares || isSpareSection} inSpareVdev={inSpareVdev || isSpareVdev} />
      ))}
    </>
  )
}

function ScanProgressBar({ progress }) {
  if (!progress) return null
  const isScrub = progress.operation === 'scrub'
  const bgColor = isScrub ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800' : 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'
  const barColor = isScrub ? 'bg-blue-500' : 'bg-orange-500'
  const textColor = isScrub ? 'text-blue-700 dark:text-blue-300' : 'text-orange-700 dark:text-orange-300'

  return (
    <div className={`rounded-lg border p-3 mb-3 ${bgColor}`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-sm font-semibold ${textColor} capitalize`}>{progress.operation} in progress</span>
        <span className={`text-sm font-bold ${textColor}`}>{progress.percent.toFixed(1)}%</span>
      </div>
      <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-3 mb-2">
        <div
          className={`h-3 rounded-full ${barColor} transition-all duration-500`}
          style={{ width: `${Math.min(progress.percent, 100)}%` }}
        />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
        {progress.speed && <span>Speed: <span className="font-medium text-gray-800 dark:text-gray-200">{progress.speed}</span></span>}
        {progress.scanned && progress.total && (
          <span>Scanned: <span className="font-medium text-gray-800 dark:text-gray-200">{progress.scanned} / {progress.total}</span></span>
        )}
        {progress.repaired && <span>Repaired: <span className="font-medium text-red-600 dark:text-red-400">{progress.repaired}</span></span>}
        {progress.eta && <span>ETA: <span className="font-medium text-gray-800 dark:text-gray-200">{progress.eta}</span></span>}
      </div>
    </div>
  )
}

export default function Pools() {
  const [pools, setPools] = useState([])
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [scrubbing, setScrubbing] = useState(null)
  const [confirmDestroy, setConfirmDestroy] = useState(null)
  const [confirmAction, setConfirmAction] = useState(null)
  const [showWizard, setShowWizard] = useState(false)
  const [showReplace, setShowReplace] = useState(null)
  const [availableDisks, setAvailableDisks] = useState([])
  const [replaceDisk, setReplaceDisk] = useState('')
  const [forceReplace, setForceReplace] = useState(false)
  const [error, setError] = useState('')
  const [showAddSpare, setShowAddSpare] = useState(false)
  const [spareDisk, setSpareDisk] = useState('')
  const [spareError, setSpareError] = useState('')
  const [showAttach, setShowAttach] = useState(null)
  const [attachDisk, setAttachDisk] = useState('')
  const [forceAttach, setForceAttach] = useState(false)
  const [attachError, setAttachError] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importablePools, setImportablePools] = useState([])
  const [importLoading, setImportLoading] = useState(false)
  const [importName, setImportName] = useState('')
  const [forceImport, setForceImport] = useState(false)
  const [importError, setImportError] = useState('')

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

  const stopScrub = async (pool) => {
    try {
      await api.post(`/pools/${pool}/scrub/stop`)
      await loadDetail(pool)
    } catch (err) {
      setError(err.response?.data?.detail || 'Stop scrub failed')
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

  const handleDiskAction = async (action, diskName) => {
    if (action === 'remove_spare') {
      setConfirmAction({ action: 'remove_spare', disk: diskName, title: `Remove spare ${diskName}?`, message: `This will remove ${diskName} as a hot spare from the pool.` })
      return
    }

    if (action === 'attach') {
      try {
        const res = await api.get('/disks/available')
        setAvailableDisks(res.data)
      } catch (err) {
        setAvailableDisks([])
      }
      setShowAttach(diskName)
      setAttachDisk('')
      setForceAttach(false)
      setAttachError('')
      return
    }

    if (action === 'replace') {
      try {
        const res = await api.get('/disks/available')
        setAvailableDisks(res.data)
      } catch (err) {
        setAvailableDisks([])
      }
      setShowReplace(diskName)
      setReplaceDisk('')
      setForceReplace(false)
      setReplaceError('')
      return
    }

    if (action === 'detach') {
      setConfirmAction({ action: 'detach', disk: diskName, title: `Detach disk ${diskName}?`, message: `This will remove ${diskName} from the pool. The pool must have redundancy to survive this.` })
      return
    }

    if (action === 'offline') {
      setConfirmAction({ action: 'offline', disk: diskName, title: `Take ${diskName} offline?`, message: `This will mark ${diskName} as offline. The pool must have redundancy to remain healthy.` })
      return
    }

    if (action === 'online') {
      try {
        await api.post(`/pools/${selected}/disk/${diskName}/online`)
        await loadDetail(selected)
      } catch (err) {
        setError(err.response?.data?.detail || 'Failed to bring disk online')
      }
    }
  }

  const executeConfirmedAction = async () => {
    if (!confirmAction) return
    const { action, disk } = confirmAction
    try {
      if (action === 'remove_spare') {
        await api.delete(`/pools/${selected}/spare/${disk}`)
      } else {
        await api.post(`/pools/${selected}/disk/${disk}/${action}`)
      }
      setConfirmAction(null)
      await loadDetail(selected)
    } catch (err) {
      setError(err.response?.data?.detail || `Failed to ${action} disk`)
      setConfirmAction(null)
    }
  }

  const [replaceError, setReplaceError] = useState('')

  const executeReplace = async () => {
    if (!showReplace || !replaceDisk) return
    setReplaceError('')
    try {
      await api.post(`/pools/${selected}/replace`, {
        old_disk: showReplace,
        new_disk: replaceDisk,
        force: forceReplace,
      })
      setShowReplace(null)
      await loadDetail(selected)
    } catch (err) {
      setReplaceError(err.response?.data?.detail || 'Replace failed')
    }
  }

  const openAddSpare = async () => {
    try {
      const res = await api.get('/disks/available')
      setAvailableDisks(res.data)
    } catch (err) {
      setAvailableDisks([])
    }
    setSpareDisk('')
    setSpareError('')
    setShowAddSpare(true)
  }

  const executeAddSpare = async () => {
    if (!spareDisk) return
    setSpareError('')
    try {
      await api.post(`/pools/${selected}/spare?disk=${spareDisk}`)
      setShowAddSpare(false)
      await loadDetail(selected)
    } catch (err) {
      setSpareError(err.response?.data?.detail || 'Failed to add spare')
    }
  }

  const executeAttach = async () => {
    if (!showAttach || !attachDisk) return
    setAttachError('')
    try {
      await api.post(`/pools/${selected}/attach`, {
        existing_disk: showAttach,
        new_disk: attachDisk,
        force: forceAttach,
      })
      setShowAttach(null)
      await loadDetail(selected)
    } catch (err) {
      setAttachError(err.response?.data?.detail || 'Attach failed')
    }
  }

  const openImportDialog = async () => {
    setImportError('')
    setImportName('')
    setForceImport(false)
    setImportLoading(true)
    setShowImport(true)
    try {
      const res = await api.get('/pools/importable')
      setImportablePools(res.data)
    } catch (err) {
      setImportablePools([])
      setImportError(err.response?.data?.detail || 'Failed to scan for importable pools')
    } finally {
      setImportLoading(false)
    }
  }

  const executeImport = async () => {
    if (!importName) return
    setImportError('')
    try {
      await api.post('/pools/import', { name: importName, force: forceImport })
      setShowImport(false)
      load()
    } catch (err) {
      setImportError(err.response?.data?.detail || 'Import failed')
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!selected || !detail?.scan_progress) return
    const interval = setInterval(() => loadDetail(selected), 5000)
    return () => clearInterval(interval)
  }, [selected, detail?.scan_progress?.operation])

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Storage Pools</h2>
        {!showWizard && (
          <div className="flex gap-2">
            <button
              onClick={openImportDialog}
              className="px-4 py-2 text-sm border border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20"
            >
              Import Pool
            </button>
            <button
              onClick={() => setShowWizard(true)}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Create Pool
            </button>
          </div>
        )}
      </div>
      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}

      {showWizard && (
        <PoolCreateWizard
          onCreated={() => { setShowWizard(false); load() }}
          onCancel={() => setShowWizard(false)}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
            {pools.map(pool => (
              <div
                key={pool.name}
                onClick={() => loadDetail(pool.name)}
                className={`p-4 border-b dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 ${
                  selected === pool.name ? 'bg-blue-50 dark:bg-blue-900/30 border-l-4 border-l-blue-500' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{pool.name}</span>
                  <StatusBadge status={pool.health} />
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {pool.allocated} / {pool.size} ({pool.capacity})
                </div>
              </div>
            ))}
            {pools.length === 0 && (
              <div className="p-4 text-sm text-gray-400 dark:text-gray-500">No pools found</div>
            )}
          </div>
        </div>

        <div className="lg:col-span-2">
          {detail && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">{selected}</h3>
                <div className="flex gap-2">
                  {detail?.scan_progress?.operation === 'scrub' ? (
                    <button
                      onClick={() => stopScrub(selected)}
                      className="px-3 py-1 text-sm bg-yellow-500 text-white rounded hover:bg-yellow-600"
                    >
                      Stop Scrub
                    </button>
                  ) : (
                    <button
                      onClick={() => startScrub(selected)}
                      disabled={scrubbing === selected}
                      className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                    >
                      {scrubbing === selected ? 'Starting...' : 'Start Scrub'}
                    </button>
                  )}
                  <button
                    onClick={openAddSpare}
                    className="px-3 py-1 text-sm border border-green-600 text-green-600 dark:text-green-400 dark:border-green-400 rounded hover:bg-green-50 dark:hover:bg-green-900/20"
                  >
                    Add Spare
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
                  <span className="text-xs text-gray-500 dark:text-gray-400">State</span>
                  <div><StatusBadge status={detail.state} /></div>
                </div>
                <div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">Errors</span>
                  <div className="text-sm">{detail.errors}</div>
                </div>
              </div>
              {(detail.scan_progress || detail.scan) && (
                <div className="mb-4">
                  <span className="text-xs text-gray-500 dark:text-gray-400">Scan</span>
                  <ScanProgressBar progress={detail.scan_progress} />
                  {detail.scan && (
                    <div className="text-sm whitespace-pre-wrap font-mono text-xs bg-gray-50 dark:bg-gray-700 p-2 rounded mt-1">{detail.scan}</div>
                  )}
                </div>
              )}

              {/* Vdev Tree */}
              <div className="mb-4">
                <span className="text-xs text-gray-500 dark:text-gray-400">Configuration</span>
                {detail.vdevs && detail.vdevs.length > 0 ? (
                  <div className="mt-1 bg-gray-50 dark:bg-gray-700 rounded overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                          <th className="px-4 py-2">Name</th>
                          <th className="px-4 py-2">State</th>
                          <th className="px-4 py-2">R/W/C Errors</th>
                          <th className="px-4 py-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.vdevs.map(vdev => (
                          <VdevNode key={vdev.name} node={vdev} depth={0} pool={selected} onAction={handleDiskAction} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <pre className="text-xs bg-gray-50 dark:bg-gray-700 p-3 rounded mt-1 overflow-x-auto">{detail.config}</pre>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Spare Dialog */}
      {showAddSpare && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-2">Add Hot Spare</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              Add a hot spare to pool <span className="font-medium">{selected}</span>. It will automatically replace a failed drive.
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Disk</label>
              {availableDisks.length > 0 ? (
                <select
                  value={spareDisk}
                  onChange={e => setSpareDisk(e.target.value)}
                  className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-2 text-sm"
                >
                  <option value="">Select a disk...</option>
                  {availableDisks.map(d => (
                    <option key={d.name} value={d.name}>
                      {d.name} — {d.size} {d.model ? `(${d.model})` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="text-sm text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded">
                  No available disks found. Insert a disk and try again.
                </div>
              )}
            </div>
            {spareError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{spareError}</div>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAddSpare(false)} className="px-4 py-2 text-sm border dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700">
                Cancel
              </button>
              <button
                onClick={executeAddSpare}
                disabled={!spareDisk}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                Add Spare
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Attach Disk Dialog */}
      {showAttach && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-2">Attach Disk</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              Attach a new disk to <span className="font-mono font-medium">{showAttach}</span> in pool <span className="font-medium">{selected}</span> to create a mirror.
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">New Disk</label>
              {availableDisks.length > 0 ? (
                <select
                  value={attachDisk}
                  onChange={e => setAttachDisk(e.target.value)}
                  className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-2 text-sm"
                >
                  <option value="">Select a disk...</option>
                  {availableDisks.map(d => (
                    <option key={d.name} value={d.name}>
                      {d.name} — {d.size} {d.model ? `(${d.model})` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="text-sm text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded">
                  No available disks found. Insert a disk and try again.
                </div>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm mb-4">
              <input type="checkbox" checked={forceAttach} onChange={e => setForceAttach(e.target.checked)} />
              Force attach (skip some safety checks)
            </label>
            {attachError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{attachError}</div>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAttach(null)} className="px-4 py-2 text-sm border dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700">
                Cancel
              </button>
              <button
                onClick={executeAttach}
                disabled={!attachDisk}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                Attach
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Pool Dialog */}
      {showImport && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-2">Import Pool</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              Import an existing ZFS pool found on attached disks.
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Pool</label>
              {importLoading ? (
                <div className="text-sm text-gray-500 dark:text-gray-400 py-2">Scanning for importable pools...</div>
              ) : importablePools.length > 0 ? (
                <select
                  value={importName}
                  onChange={e => setImportName(e.target.value)}
                  className="w-full border dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-2 text-sm"
                >
                  <option value="">Select a pool...</option>
                  {importablePools.map(p => (
                    <option key={p.id} value={p.name}>
                      {p.name} — {p.state}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="text-sm text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded">
                  No importable pools found. Ensure disks with existing pools are attached.
                </div>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm mb-4">
              <input type="checkbox" checked={forceImport} onChange={e => setForceImport(e.target.checked)} />
              Force import (use if pool was last used by another system)
            </label>
            {importError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{importError}</div>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowImport(false)} className="px-4 py-2 text-sm border dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700">
                Cancel
              </button>
              <button
                onClick={executeImport}
                disabled={!importName}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Replace Disk Dialog */}
      {showReplace && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-2">Replace Disk</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              Replace <span className="font-mono font-medium">{showReplace}</span> in pool <span className="font-medium">{selected}</span>
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">New Disk</label>
              {availableDisks.length > 0 ? (
                <select
                  value={replaceDisk}
                  onChange={e => setReplaceDisk(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  <option value="">Select a disk...</option>
                  {availableDisks.map(d => (
                    <option key={d.name} value={d.name}>
                      {d.name} — {d.size} {d.model ? `(${d.model})` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="text-sm text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded">
                  No available disks found. Insert a replacement disk and try again.
                </div>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm mb-4">
              <input type="checkbox" checked={forceReplace} onChange={e => setForceReplace(e.target.checked)} />
              Force replace (skip some safety checks)
            </label>
            {replaceError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{replaceError}</div>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowReplace(null)} className="px-4 py-2 text-sm border dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700">
                Cancel
              </button>
              <button
                onClick={executeReplace}
                disabled={!replaceDisk}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                Replace
              </button>
            </div>
          </div>
        </div>
      )}

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

      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.title}
          message={confirmAction.message}
          confirmText={confirmAction.action === 'detach' ? 'Detach' : confirmAction.action === 'offline' ? 'Take Offline' : confirmAction.action === 'remove_spare' ? 'Remove Spare' : 'Confirm'}
          danger={confirmAction.action === 'detach' || confirmAction.action === 'remove_spare'}
          onConfirm={executeConfirmedAction}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  )
}
