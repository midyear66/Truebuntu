import { useState, useEffect } from 'react'
import api from '../api'

export default function NetworkSummary() {
  const [interfaces, setInterfaces] = useState([])
  const [routes, setRoutes] = useState([])
  const [dns, setDns] = useState({ servers: [], search: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        const [ifRes, routeRes, dnsRes] = await Promise.all([
          api.get('/network/interfaces'),
          api.get('/network/routes'),
          api.get('/network/dns'),
        ])
        setInterfaces(ifRes.data)
        setRoutes(routeRes.data)
        setDns(dnsRes.data)
      } catch (err) {
        setError(err.response?.data?.detail || 'Failed to load network summary')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading...</div>

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-6">Network Summary</h2>

      {error && <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded">{error}</div>}

      <div className="space-y-6">
        {/* Interfaces */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 uppercase">Interfaces</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">IPv4 Address</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">IPv6 Address</th>
              </tr>
            </thead>
            <tbody>
              {interfaces.map(iface => {
                const ipv4 = iface.addresses.filter(a => !a.includes(':')).join(', ') || '-'
                const ipv6 = iface.addresses.filter(a => a.includes(':')).join(', ') || '-'
                return (
                  <tr key={iface.name} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-4 py-2 font-medium">{iface.name}</td>
                    <td className="px-4 py-2 font-mono text-xs">{ipv4}</td>
                    <td className="px-4 py-2 font-mono text-xs">{ipv6}</td>
                  </tr>
                )
              })}
              {interfaces.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">No interfaces found</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Default Routes */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 uppercase">Default Routes</h3>
          </div>
          <div className="p-4">
            {routes.filter(r => r.destination === 'default').length > 0 ? (
              <ul className="space-y-1">
                {routes.filter(r => r.destination === 'default').map((r, i) => (
                  <li key={i} className="font-mono text-sm">
                    {r.gateway} via {r.interface}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-400 dark:text-gray-500">No default routes configured</p>
            )}
          </div>
        </div>

        {/* Nameservers */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 uppercase">Nameservers</h3>
          </div>
          <div className="p-4">
            {dns.servers.length > 0 ? (
              <ul className="space-y-1">
                {dns.servers.map((s, i) => (
                  <li key={i} className="font-mono text-sm">{s}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-400 dark:text-gray-500">No nameservers found</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
