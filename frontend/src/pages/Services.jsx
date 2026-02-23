import { useState, useEffect } from 'react'
import api from '../api'
import StatusBadge from '../components/StatusBadge'

export default function Services() {
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(null)
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const res = await api.get('/services')
      setServices(res.data)
    } catch (err) {
      setError('Failed to load services')
    } finally {
      setLoading(false)
    }
  }

  const performAction = async (name, action) => {
    setActing(`${name}-${action}`)
    try {
      await api.post(`/services/${name}/${action}`)
      load()
    } catch (err) {
      setError(err.response?.data?.detail || `${action} failed`)
    } finally {
      setActing(null)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) return <div className="text-gray-500">Loading...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Services</h2>
        <button onClick={load} className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300">
          Refresh
        </button>
      </div>
      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded">{error}</div>}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Service</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Active</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Enabled</th>
              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {services.map(svc => (
              <tr key={svc.name} className="border-t hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{svc.name}</td>
                <td className="px-4 py-3"><StatusBadge status={svc.active} /></td>
                <td className="px-4 py-3"><StatusBadge status={svc.enabled} /></td>
                <td className="px-4 py-3 text-right space-x-1">
                  {svc.active === 'active' ? (
                    <>
                      <button onClick={() => performAction(svc.name, 'restart')} disabled={!!acting} className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200 disabled:opacity-50">
                        Restart
                      </button>
                      <button onClick={() => performAction(svc.name, 'stop')} disabled={!!acting} className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded hover:bg-red-200 disabled:opacity-50">
                        Stop
                      </button>
                    </>
                  ) : (
                    <button onClick={() => performAction(svc.name, 'start')} disabled={!!acting} className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded hover:bg-green-200 disabled:opacity-50">
                      Start
                    </button>
                  )}
                  {svc.enabled === 'enabled' ? (
                    <button onClick={() => performAction(svc.name, 'disable')} disabled={!!acting} className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50">
                      Disable
                    </button>
                  ) : (
                    <button onClick={() => performAction(svc.name, 'enable')} disabled={!!acting} className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded hover:bg-blue-200 disabled:opacity-50">
                      Enable
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
