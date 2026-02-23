import { useState, useEffect } from 'react'
import api from '../api'
import StatusBadge from '../components/StatusBadge'

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    try {
      const res = await api.get('/dashboard')
      setData(res.data)
    } catch (err) {
      console.error('Dashboard load error:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) return <div className="text-gray-500">Loading dashboard...</div>
  if (!data) return <div className="text-red-500">Failed to load dashboard</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Dashboard</h2>
        <div className="text-sm text-gray-500">
          {data.hostname} &middot; {data.uptime}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Pools */}
        <div className="bg-white rounded-lg shadow p-5">
          <h3 className="text-sm font-semibold text-gray-500 uppercase mb-3">Storage Pools</h3>
          {data.pools.length === 0 ? (
            <p className="text-sm text-gray-400">No pools found</p>
          ) : data.pools.map(pool => (
            <div key={pool.name} className="flex items-center justify-between py-2 border-b last:border-0">
              <div>
                <span className="font-medium text-gray-800">{pool.name}</span>
                <span className="ml-2 text-xs text-gray-500">{pool.size}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">{pool.capacity} used</span>
                <StatusBadge status={pool.health} />
              </div>
            </div>
          ))}
        </div>

        {/* Services */}
        <div className="bg-white rounded-lg shadow p-5">
          <h3 className="text-sm font-semibold text-gray-500 uppercase mb-3">Services</h3>
          {data.services.map(svc => (
            <div key={svc.name} className="flex items-center justify-between py-2 border-b last:border-0">
              <span className="text-sm text-gray-700">{svc.name}</span>
              <StatusBadge status={svc.active} />
            </div>
          ))}
        </div>

        {/* Disk Temperatures */}
        <div className="bg-white rounded-lg shadow p-5">
          <h3 className="text-sm font-semibold text-gray-500 uppercase mb-3">Disk Temperatures</h3>
          {data.disk_temps.length === 0 ? (
            <p className="text-sm text-gray-400">No disk data</p>
          ) : data.disk_temps.map(d => (
            <div key={d.disk} className="flex items-center justify-between py-2 border-b last:border-0">
              <span className="text-sm text-gray-700">{d.disk}</span>
              <span className="text-sm font-mono">
                {d.temperature != null ? `${d.temperature}°C` : 'N/A'}
              </span>
            </div>
          ))}
        </div>

        {/* Datasets */}
        <div className="bg-white rounded-lg shadow p-5 md:col-span-2">
          <h3 className="text-sm font-semibold text-gray-500 uppercase mb-3">Datasets</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Used</th>
                  <th className="pb-2">Available</th>
                  <th className="pb-2">Mountpoint</th>
                </tr>
              </thead>
              <tbody>
                {data.datasets.map(ds => (
                  <tr key={ds.name} className="border-b last:border-0">
                    <td className="py-2 font-mono text-xs">{ds.name}</td>
                    <td className="py-2">{ds.used}</td>
                    <td className="py-2">{ds.available}</td>
                    <td className="py-2 text-gray-500 font-mono text-xs">{ds.mountpoint}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Snapshots */}
        <div className="bg-white rounded-lg shadow p-5">
          <h3 className="text-sm font-semibold text-gray-500 uppercase mb-3">Recent Snapshots</h3>
          {data.recent_snapshots.length === 0 ? (
            <p className="text-sm text-gray-400">No snapshots</p>
          ) : data.recent_snapshots.map(snap => (
            <div key={snap.name} className="py-1 border-b last:border-0">
              <div className="font-mono text-xs text-gray-700 truncate">{snap.name}</div>
              <div className="text-xs text-gray-400">{snap.creation}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
