import { Link, useLocation, useNavigate } from 'react-router-dom'
import api from '../api'

const NAV_ITEMS = [
  { path: '/dashboard', label: 'Dashboard', icon: '⊞' },
  { path: '/pools', label: 'Pools', icon: '⊡' },
  { path: '/datasets', label: 'Datasets', icon: '⊟' },
  { path: '/snapshots', label: 'Snapshots', icon: '⊙' },
  { path: '/shares', label: 'SMB Shares', icon: '⊞' },
  { path: '/nfs', label: 'NFS Exports', icon: '⊠' },
  { path: '/cloud-sync', label: 'Cloud Sync', icon: '⇧' },
  { path: '/tasks', label: 'Tasks', icon: '⊘' },
  { path: '/users', label: 'Users', icon: '⊕' },
  { path: '/services', label: 'Services', icon: '⊛' },
  { path: '/disks', label: 'Disks', icon: '⊚' },
]

export default function Layout({ children, user }) {
  const location = useLocation()
  const navigate = useNavigate()

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
          <h1 className="text-lg font-bold text-white">NAS Web UI</h1>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {NAV_ITEMS.map(item => (
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
          ))}
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
