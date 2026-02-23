import { useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import api from '../api'

const NAV_ITEMS = [
  { path: '/dashboard', label: 'Dashboard', icon: '⊞' },
  { label: 'Accounts', icon: '⊕', children: [
    { path: '/users', label: 'Users' },
  ]},
  { label: 'System', icon: '⊜', children: [
    { path: '/settings', label: 'Settings' },
    { path: '/enclosures', label: 'Enclosures' },
    { path: '/updates', label: 'Updates' },
  ]},
  { label: 'Tasks', icon: '⊘', children: [
    { path: '/cron-jobs', label: 'Cron Jobs' },
    { path: '/init-shutdown', label: 'Init/Shutdown Scripts' },
    { path: '/rsync-tasks', label: 'Rsync Tasks' },
    { path: '/smart-tests', label: 'S.M.A.R.T. Tests' },
    { path: '/snapshot-tasks', label: 'Periodic Snapshot Tasks' },
    { path: '/resilver', label: 'Resilver Priority' },
    { path: '/cloud-sync', label: 'Cloud Sync Tasks' },
  ]},
  { label: 'Storage', icon: '⊡', children: [
    { path: '/pools', label: 'Pools' },
    { path: '/datasets', label: 'Datasets' },
    { path: '/snapshots', label: 'Snapshots' },
    { path: '/disks', label: 'Disks' },
  ]},
  { label: 'Sharing', icon: '⊞', children: [
    { path: '/shares', label: 'SMB Shares' },
    { path: '/nfs', label: 'NFS Exports' },
  ]},
  { path: '/services', label: 'Services', icon: '⊛' },
]

function findGroupForPath(pathname) {
  for (const item of NAV_ITEMS) {
    if (item.children) {
      for (const child of item.children) {
        if (child.path === pathname) return item.label
      }
    }
  }
  return null
}

export default function Layout({ children, user }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(() => {
    const group = findGroupForPath(location.pathname)
    return group ? new Set([group]) : new Set()
  })

  useEffect(() => {
    const group = findGroupForPath(location.pathname)
    if (group && !expanded.has(group)) {
      setExpanded(prev => new Set(prev).add(group))
    }
  }, [location.pathname])

  const toggleGroup = (label) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout')
    } catch (e) {}
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <aside className="w-56 bg-gray-900 text-gray-300 flex flex-col">
        <div className="p-4 border-b border-gray-700">
          <h1 className="text-lg font-bold text-white">Truebuntu</h1>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {NAV_ITEMS.map(item =>
            item.children ? (
              <div key={item.label}>
                <button
                  onClick={() => toggleGroup(item.label)}
                  className={`w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-gray-800 hover:text-white transition-colors ${
                    item.children.some(c => c.path === location.pathname) ? 'text-white' : ''
                  }`}
                >
                  <span className="flex items-center">
                    <span className="mr-3 text-base">{item.icon}</span>
                    <span className="font-medium uppercase text-xs tracking-wide">{item.label}</span>
                  </span>
                  <span className="text-xs">{expanded.has(item.label) ? '▾' : '▸'}</span>
                </button>
                {expanded.has(item.label) && (
                  <div>
                    {item.children.map(child => (
                      <Link
                        key={child.path}
                        to={child.path}
                        className={`flex items-center pl-10 pr-4 py-2 text-sm hover:bg-gray-800 hover:text-white transition-colors ${
                          location.pathname === child.path ? 'bg-gray-800 text-white border-r-2 border-blue-500' : ''
                        }`}
                      >
                        {child.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center px-4 py-2 text-sm hover:bg-gray-800 hover:text-white transition-colors ${
                  location.pathname === item.path ? 'bg-gray-800 text-white border-r-2 border-blue-500' : ''
                }`}
              >
                <span className="mr-3 text-base">{item.icon}</span>
                {item.label}
              </Link>
            )
          )}
        </nav>
        <div className="p-4 border-t border-gray-700 text-xs text-gray-500">
          v0.1.0
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white shadow-sm border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <div className="text-sm text-gray-600" id="header-info"></div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-700">{user}</span>
            <button
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Logout
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
