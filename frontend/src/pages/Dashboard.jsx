import { useState, useEffect, useRef } from 'react'
import api from '../api'
import StatusBadge from '../components/StatusBadge'

const formatKB = (kb) => {
  if (kb >= 1048576) return `${(kb / 1048576).toFixed(1)} GB`
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`
  return `${kb} KB`
}

const formatBytes = (bytes) => {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB/s`
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB/s`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB/s`
  return `${Math.round(bytes)} B/s`
}

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [netRates, setNetRates] = useState({})
  const prevNet = useRef(null)
  const prevTime = useRef(null)

  const load = async () => {
    try {
      const res = await api.get('/dashboard')
      setData(res.data)

      // Compute network throughput deltas
      const now = Date.now()
      if (prevNet.current && prevTime.current && res.data.network) {
        const elapsed = (now - prevTime.current) / 1000
        if (elapsed > 0) {
          const rates = {}
          for (const iface of res.data.network) {
            const prev = prevNet.current.find(p => p.interface === iface.interface)
            if (prev) {
              rates[iface.interface] = {
                rx: Math.max(0, (iface.rx_bytes - prev.rx_bytes) / elapsed),
                tx: Math.max(0, (iface.tx_bytes - prev.tx_bytes) / elapsed),
              }
            }
          }
          setNetRates(rates)
        }
      }
      prevNet.current = res.data.network || []
      prevTime.current = now
    } catch (err) {
      console.error('Dashboard load error:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [])

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading dashboard...</div>
  if (!data) return <div className="text-red-500">Failed to load dashboard</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Dashboard</h2>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {data.hostname} &middot; {data.uptime}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Pools */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5">
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3">Storage Pools</h3>
          {data.pools.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">No pools found</p>
          ) : data.pools.map(pool => (
            <div key={pool.name} className="flex items-center justify-between py-2 border-b dark:border-gray-700 last:border-0">
              <div>
                <span className="font-medium text-gray-800 dark:text-gray-100">{pool.name}</span>
                <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">{pool.size}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">{pool.capacity} used</span>
                <StatusBadge status={pool.health} />
              </div>
            </div>
          ))}
        </div>

        {/* Services */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5">
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3">Services</h3>
          {data.services.map(svc => (
            <div key={svc.name} className="flex items-center justify-between py-2 border-b dark:border-gray-700 last:border-0">
              <span className="text-sm text-gray-700 dark:text-gray-200">{svc.name}</span>
              <StatusBadge status={svc.active} />
            </div>
          ))}
        </div>

        {/* Disk Temperatures */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5">
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3">Disk Temperatures</h3>
          {data.disk_temps.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">No disk data</p>
          ) : data.disk_temps.map(d => (
            <div key={d.disk} className="flex items-center justify-between py-2 border-b dark:border-gray-700 last:border-0">
              <span className="text-sm text-gray-700 dark:text-gray-200">{d.disk}</span>
              <span className="text-sm font-mono">
                {d.temperature != null ? `${d.temperature}°C` : 'N/A'}
              </span>
            </div>
          ))}
        </div>

        {/* Datasets */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5 md:col-span-2">
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3">Datasets</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Used</th>
                  <th className="pb-2">Available</th>
                  <th className="pb-2">Mountpoint</th>
                </tr>
              </thead>
              <tbody>
                {data.datasets.map(ds => (
                  <tr key={ds.name} className="border-b dark:border-gray-700 last:border-0">
                    <td className="py-2 font-mono text-xs">{ds.name}</td>
                    <td className="py-2">{ds.used}</td>
                    <td className="py-2">{ds.available}</td>
                    <td className="py-2 text-gray-500 dark:text-gray-400 font-mono text-xs">{ds.mountpoint}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Load Average */}
        {data.load_average && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5">
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3">Load Average</h3>
            {['load1', 'load5', 'load15'].map((key, i) => {
              const val = data.load_average[key] || 0
              const label = ['1 min', '5 min', '15 min'][i]
              const color = val > 4 ? 'text-red-600' : val > 2 ? 'text-yellow-600' : 'text-green-600'
              return (
                <div key={key} className="flex items-center justify-between py-2 border-b dark:border-gray-700 last:border-0">
                  <span className="text-sm text-gray-700 dark:text-gray-200">{label}</span>
                  <span className={`text-sm font-mono font-medium ${color}`}>{val.toFixed(2)}</span>
                </div>
              )
            })}
          </div>
        )}

        {/* Memory */}
        {data.memory && data.memory.total_kb > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5">
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3">Memory</h3>
            <div className="mb-3">
              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                <span>{formatKB(data.memory.used_kb)} used</span>
                <span>{data.memory.percent}%</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-3">
                <div
                  className={`h-3 rounded-full ${data.memory.percent > 90 ? 'bg-red-500' : data.memory.percent > 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                  style={{ width: `${Math.min(data.memory.percent, 100)}%` }}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400">
              <div>Total: {formatKB(data.memory.total_kb)}</div>
              <div>Available: {formatKB(data.memory.available_kb)}</div>
              <div>Buffers: {formatKB(data.memory.buffers_kb)}</div>
              <div>Cached: {formatKB(data.memory.cached_kb)}</div>
            </div>
          </div>
        )}

        {/* Network */}
        {data.network && data.network.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5">
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3">Network</h3>
            {data.network.map(iface => (
              <div key={iface.interface} className="py-2 border-b dark:border-gray-700 last:border-0">
                <div className="font-medium text-sm text-gray-800 dark:text-gray-100 mb-1">{iface.interface}</div>
                {netRates[iface.interface] ? (
                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <div>RX: {formatBytes(netRates[iface.interface].rx)}</div>
                    <div>TX: {formatBytes(netRates[iface.interface].tx)}</div>
                  </div>
                ) : (
                  <div className="text-xs text-gray-400 dark:text-gray-500">Measuring...</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Recent Snapshots */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-5">
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3">Recent Snapshots</h3>
          {data.recent_snapshots.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">No snapshots</p>
          ) : data.recent_snapshots.map(snap => (
            <div key={snap.name} className="py-1 border-b dark:border-gray-700 last:border-0">
              <div className="font-mono text-xs text-gray-700 dark:text-gray-200 truncate">{snap.name}</div>
              <div className="text-xs text-gray-400 dark:text-gray-500">{snap.creation}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
