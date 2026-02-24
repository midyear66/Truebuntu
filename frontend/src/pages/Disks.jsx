import { useState, useEffect } from 'react'
import api from '../api'
import ConfirmDialog from '../components/ConfirmDialog'

export default function Disks() {
  const [disks, setDisks] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedDisk, setSelectedDisk] = useState(null)
  const [smartData, setSmartData] = useState(null)
  const [testing, setTesting] = useState(null)
  const [error, setError] = useState('')
  const [prepareDialog, setPrepareDialog] = useState(null) // { disk, identify data }
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

  const viewSmart = async (disk) => {
    setSelectedDisk(disk)
    setPrepareSuccess('')
    try {
      const res = await api.get(`/disks/${disk}/smart`)
      setSmartData(res.data)
    } catch (err) {
      setSmartData({ error: 'Failed to load SMART data' })
    }
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
            {disks.map(d => (
              <div
                key={d.name}
                onClick={() => viewSmart(d.name)}
                className={`p-4 border-b dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 ${selectedDisk === d.name ? 'bg-blue-50 dark:bg-blue-900/30 border-l-4 border-l-blue-500' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{d.name}</span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">{d.size}</span>
                </div>
                <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">{d.model || 'Unknown model'}</div>
              </div>
            ))}
            {disks.length === 0 && <div className="p-4 text-sm text-gray-400 dark:text-gray-500">No disks found</div>}
          </div>
        </div>

        <div className="lg:col-span-2">
          {smartData && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">{selectedDisk}</h3>
                <div className="flex gap-2">
                  <button onClick={() => runTest(selectedDisk, 'short')} disabled={testing === selectedDisk} className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                    Short Test
                  </button>
                  <button onClick={() => runTest(selectedDisk, 'long')} disabled={testing === selectedDisk} className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                    Long Test
                  </button>
                  <button onClick={() => startPrepare(selectedDisk)} disabled={preparing} className="px-3 py-1 text-sm bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50">
                    Prepare Disk
                  </button>
                </div>
              </div>

              {smartData.error ? (
                <div className="text-sm text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded">{smartData.error}: {smartData.detail || 'SMART may not be supported on this device'}</div>
              ) : smartData.raw ? (
                <pre className="text-xs bg-gray-50 dark:bg-gray-700 p-3 rounded overflow-x-auto whitespace-pre-wrap">{smartData.raw}</pre>
              ) : (
                <div className="space-y-4">
                  {smartData.model_name && (
                    <div className="grid grid-cols-2 gap-4">
                      <div><span className="text-xs text-gray-500 dark:text-gray-400">Model</span><div className="text-sm">{smartData.model_name}</div></div>
                      <div><span className="text-xs text-gray-500 dark:text-gray-400">Serial</span><div className="text-sm font-mono">{smartData.serial_number}</div></div>
                      <div><span className="text-xs text-gray-500 dark:text-gray-400">Temperature</span><div className="text-sm">{smartData.temperature?.current ?? 'N/A'}°C</div></div>
                      <div><span className="text-xs text-gray-500 dark:text-gray-400">Power On Hours</span><div className="text-sm">{smartData.power_on_time?.hours ?? 'N/A'}</div></div>
                    </div>
                  )}
                  {smartData.ata_smart_attributes?.table && (
                    <div>
                      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">SMART Attributes</h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                              <th className="pb-1 pr-3">ID</th>
                              <th className="pb-1 pr-3">Attribute</th>
                              <th className="pb-1 pr-3">Value</th>
                              <th className="pb-1 pr-3">Worst</th>
                              <th className="pb-1 pr-3">Thresh</th>
                              <th className="pb-1">Raw</th>
                            </tr>
                          </thead>
                          <tbody>
                            {smartData.ata_smart_attributes.table.map(attr => (
                              <tr key={attr.id} className="border-b dark:border-gray-700 last:border-0">
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
              )}
            </div>
          )}
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
