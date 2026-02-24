import { useState, useEffect, Fragment } from 'react'
import api from '../api'
import ConfirmDialog from '../components/ConfirmDialog'

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

export default function Disks() {
  const [disks, setDisks] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedRows, setExpandedRows] = useState(new Set())
  const [smartDataMap, setSmartDataMap] = useState({})
  const [loadingDisk, setLoadingDisk] = useState(null)
  const [testing, setTesting] = useState(null)
  const [error, setError] = useState('')
  const [prepareDialog, setPrepareDialog] = useState(null)
  const [preparing, setPreparing] = useState(false)
  const [prepareSuccess, setPrepareSuccess] = useState('')

  const load = async () => {
    try {
      const res = await api.get('/disks')
      setDisks(res.data)
    } catch (err) {
      setError('Failed to load disks')
    } finally {
      setLoading(false)
    }
  }

  const fetchSmart = async (diskName) => {
    setLoadingDisk(diskName)
    try {
      const res = await api.get(`/disks/${diskName}/smart`)
      setSmartDataMap(prev => ({ ...prev, [diskName]: res.data }))
    } catch (err) {
      setSmartDataMap(prev => ({ ...prev, [diskName]: { error: 'Failed to load SMART data' } }))
    } finally {
      setLoadingDisk(null)
    }
  }

  const toggleExpand = (diskName) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(diskName)) {
        next.delete(diskName)
      } else {
        next.add(diskName)
        if (!smartDataMap[diskName]) fetchSmart(diskName)
      }
      return next
    })
  }

  const runTest = async (disk, type) => {
    setTesting(disk)
    try {
      await api.post(`/disks/${disk}/test/${type}`)
      alert(`${type} test started on ${disk}`)
    } catch (err) {
      setError(err.response?.data?.detail || 'Test failed')
    } finally {
      setTesting(null)
    }
  }

  const startPrepare = async (disk) => {
    setError('')
    setPrepareSuccess('')
    try {
      const res = await api.get(`/disks/${disk}/identify`)
      setPrepareDialog(res.data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to identify disk')
    }
  }

  const confirmPrepare = async () => {
    if (!prepareDialog) return
    setPreparing(true)
    setError('')
    try {
      const res = await api.post(`/disks/${prepareDialog.disk}/prepare`)
      setPrepareSuccess(res.data.message)
      setPrepareDialog(null)
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to prepare disk')
      setPrepareDialog(null)
    } finally {
      setPreparing(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-6">Disk Health</h2>
      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}
      {prepareSuccess && <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-sm rounded">{prepareSuccess}</div>}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Disk</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Model</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Size</th>
              <th className="px-4 py-3 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {disks.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  No disks found.
                </td>
              </tr>
            ) : disks.map(d => (
              <Fragment key={d.name}>
                <tr
                  className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer"
                  onClick={() => toggleExpand(d.name)}
                >
                  <td className="px-4 py-3 font-medium">{d.name}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{d.model || 'Unknown'}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{d.size}</td>
                  <td className="px-4 py-3 text-gray-400">
                    {expandedRows.has(d.name) ? <ChevronDown /> : <ChevronRight />}
                  </td>
                </tr>
                {expandedRows.has(d.name) && (
                  <tr className="bg-gray-50 dark:bg-gray-700 border-t dark:border-gray-700">
                    <td colSpan={4} className="px-6 py-4">
                      {loadingDisk === d.name ? (
                        <div className="text-sm text-gray-500 dark:text-gray-400">Loading SMART data...</div>
                      ) : smartDataMap[d.name]?.error ? (
                        <div className="text-sm text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded">
                          {smartDataMap[d.name].error}: {smartDataMap[d.name].detail || 'SMART may not be supported on this device'}
                        </div>
                      ) : smartDataMap[d.name]?.raw ? (
                        <pre className="text-xs bg-gray-100 dark:bg-gray-600 p-3 rounded overflow-x-auto whitespace-pre-wrap">{smartDataMap[d.name].raw}</pre>
                      ) : smartDataMap[d.name] ? (
                        <div className="space-y-4">
                          {smartDataMap[d.name].model_name && (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                              <div>
                                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Model</span>
                                <p className="text-sm text-gray-800 dark:text-gray-200 mt-1">{smartDataMap[d.name].model_name}</p>
                              </div>
                              <div>
                                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Serial</span>
                                <p className="text-sm font-mono text-gray-800 dark:text-gray-200 mt-1">{smartDataMap[d.name].serial_number}</p>
                              </div>
                              <div>
                                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Temperature</span>
                                <p className="text-sm text-gray-800 dark:text-gray-200 mt-1">{smartDataMap[d.name].temperature?.current ?? 'N/A'}°C</p>
                              </div>
                              <div>
                                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Power On Hours</span>
                                <p className="text-sm text-gray-800 dark:text-gray-200 mt-1">{smartDataMap[d.name].power_on_time?.hours ?? 'N/A'}</p>
                              </div>
                            </div>
                          )}
                          {smartDataMap[d.name].ata_smart_attributes?.table && (
                            <div>
                              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">SMART Attributes</h4>
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="text-left text-gray-500 dark:text-gray-400 border-b dark:border-gray-600">
                                      <th className="pb-1 pr-3">ID</th>
                                      <th className="pb-1 pr-3">Attribute</th>
                                      <th className="pb-1 pr-3">Value</th>
                                      <th className="pb-1 pr-3">Worst</th>
                                      <th className="pb-1 pr-3">Thresh</th>
                                      <th className="pb-1">Raw</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {smartDataMap[d.name].ata_smart_attributes.table.map(attr => (
                                      <tr key={attr.id} className="border-b dark:border-gray-600 last:border-0">
                                        <td className="py-1 pr-3">{attr.id}</td>
                                        <td className="py-1 pr-3">{attr.name}</td>
                                        <td className="py-1 pr-3">{attr.value}</td>
                                        <td className="py-1 pr-3">{attr.worst}</td>
                                        <td className="py-1 pr-3">{attr.thresh}</td>
                                        <td className="py-1 font-mono">{attr.raw?.string ?? attr.raw?.value ?? ''}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : null}

                      <div className="flex gap-2 mt-4">
                        <button
                          onClick={e => { e.stopPropagation(); runTest(d.name, 'short') }}
                          disabled={testing === d.name}
                          className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                        >
                          Short Test
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); runTest(d.name, 'long') }}
                          disabled={testing === d.name}
                          className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                        >
                          Long Test
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); startPrepare(d.name) }}
                          disabled={preparing}
                          className="px-3 py-1.5 text-xs bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50"
                        >
                          Prepare Disk
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
          {disks.length} disk{disks.length !== 1 ? 's' : ''}
        </div>
      </div>

      {prepareDialog && (
        <ConfirmDialog
          title={`Prepare Disk: ${prepareDialog.disk}`}
          onConfirm={confirmPrepare}
          onCancel={() => setPrepareDialog(null)}
          confirmText={preparing ? 'Wiping...' : 'Wipe & Prepare'}
          danger
          disabled={prepareDialog.mounted || preparing}
        >
          <div className="space-y-3">
            {prepareDialog.mounted && (
              <div className="p-2 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-xs rounded border border-red-200 dark:border-red-800">
                This disk has mounted partitions and cannot be wiped. Unmount all partitions first.
              </div>
            )}

            <p>This will permanently erase all filesystem signatures and partition tables on <strong>/dev/{prepareDialog.disk}</strong>.</p>

            {prepareDialog.signatures.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Filesystem Signatures</div>
                <div className="bg-gray-50 dark:bg-gray-700 rounded p-2 text-xs space-y-1">
                  {prepareDialog.signatures.map((sig, i) => (
                    <div key={i} className="flex justify-between">
                      <span className="font-mono">{sig.device}</span>
                      <span>{sig.type}{sig.label ? ` "${sig.label}"` : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {prepareDialog.partitions.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">Partitions</div>
                <div className="bg-gray-50 dark:bg-gray-700 rounded p-2 text-xs space-y-1">
                  {prepareDialog.partitions.map((part, i) => (
                    <div key={i} className="flex justify-between">
                      <span className="font-mono">{part.name}</span>
                      <span>
                        {part.size} {part.fstype}{part.label ? ` "${part.label}"` : ''}
                        {part.mountpoint && <span className="text-red-500 ml-1">(mounted: {part.mountpoint})</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {prepareDialog.signatures.length === 0 && prepareDialog.partitions.length === 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400">No existing signatures or partitions found. The disk appears already clean.</p>
            )}
          </div>
        </ConfirmDialog>
      )}
    </div>
  )
}
