import { useState, useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import api, { SESSION_EXPIRED_EVENT } from './api'
import Layout from './components/Layout'

// Login and Setup stay eager: one of them is the first thing an unauthenticated
// visitor sees, so deferring them would only add a spinner before the spinner.
import Login from './pages/Login'
import Setup from './pages/Setup'

// Every other page loads on demand. Importing them all up front meant the login
// screen downloaded the netplan editor, the xterm terminal and the drag-and-drop
// dashboard before it could render a password field.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Pools = lazy(() => import('./pages/Pools'))
const Datasets = lazy(() => import('./pages/Datasets'))
const Snapshots = lazy(() => import('./pages/Snapshots'))
const Shares = lazy(() => import('./pages/Shares'))
const NFS = lazy(() => import('./pages/NFS'))
const CloudSync = lazy(() => import('./pages/CloudSync'))
const Tasks = lazy(() => import('./pages/Tasks'))
const CronJobs = lazy(() => import('./pages/CronJobs'))
const InitShutdown = lazy(() => import('./pages/InitShutdown'))
const RsyncTasks = lazy(() => import('./pages/RsyncTasks'))
const SmartTests = lazy(() => import('./pages/SmartTests'))
const SnapshotTasks = lazy(() => import('./pages/SnapshotTasks'))
const ResilverPriority = lazy(() => import('./pages/ResilverPriority'))
const AppUsers = lazy(() => import('./pages/AppUsers'))
const SystemUsers = lazy(() => import('./pages/SystemUsers'))
const Services = lazy(() => import('./pages/Services'))
const Disks = lazy(() => import('./pages/Disks'))
const Settings = lazy(() => import('./pages/Settings'))
const Enclosures = lazy(() => import('./pages/Enclosures'))
const Updates = lazy(() => import('./pages/Updates'))
const NetworkSummary = lazy(() => import('./pages/NetworkSummary'))
const GlobalConfig = lazy(() => import('./pages/GlobalConfig'))
const NetworkInterfaces = lazy(() => import('./pages/NetworkInterfaces'))
const StaticRoutes = lazy(() => import('./pages/StaticRoutes'))
const IPMI = lazy(() => import('./pages/IPMI'))
const Replication = lazy(() => import('./pages/Replication'))
const Logs = lazy(() => import('./pages/Logs'))
const Alerts = lazy(() => import('./pages/Alerts'))
const Jobs = lazy(() => import('./pages/Jobs'))
const DynamicDNS = lazy(() => import('./pages/DynamicDNS'))
const FTPConfig = lazy(() => import('./pages/FTPConfig'))
const UPSConfig = lazy(() => import('./pages/UPSConfig'))
const OpenVPNConfig = lazy(() => import('./pages/OpenVPNConfig'))
const SNMPConfig = lazy(() => import('./pages/SNMPConfig'))
const Shell = lazy(() => import('./pages/Shell'))
const SmbUsers = lazy(() => import('./pages/SmbUsers'))
const CloudCredentials = lazy(() => import('./pages/CloudCredentials'))

function PageLoading() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="text-gray-500 dark:text-gray-400 text-sm">Loading...</div>
    </div>
  )
}

function App() {
  const [user, setUser] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [checking, setChecking] = useState(true)
  const [sessionNotice, setSessionNotice] = useState('')

  // Any API call that comes back 401 means the session is gone — expired, or
  // revoked by a logout or password change elsewhere. Drop to the login form
  // and say why, instead of leaving each page to render its own error string.
  useEffect(() => {
    const onExpired = () => {
      setUser(null)
      setIsAdmin(false)
      setSessionNotice('Your session ended. Please sign in again.')
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [])

  useEffect(() => {
    const check = async () => {
      try {
        const setupRes = await api.get('/auth/setup-required')
        if (setupRes.data.setup_required) {
          setNeedsSetup(true)
          setChecking(false)
          return
        }
        const meRes = await api.get('/auth/me')
        setUser(meRes.data.username)
        setIsAdmin(meRes.data.is_admin)
      } catch (err) {
        // Not logged in
      } finally {
        setChecking(false)
      }
    }
    check()
  }, [])

  if (checking) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-gray-500 dark:text-gray-400">Loading...</div>
      </div>
    )
  }

  if (needsSetup) {
    return (
      <BrowserRouter>
        <Setup onSetup={(u) => { setUser(u); setIsAdmin(true); setNeedsSetup(false) }} />
      </BrowserRouter>
    )
  }

  if (!user) {
    return (
      <BrowserRouter>
        <Login
          notice={sessionNotice}
          onLogin={(username, admin) => {
            setSessionNotice('')
            setUser(username)
            setIsAdmin(!!admin)
          }}
        />
      </BrowserRouter>
    )
  }

  const adminOnly = (el) => isAdmin ? el : <Navigate to="/dashboard" replace />

  return (
    <BrowserRouter>
      <Layout user={user} isAdmin={isAdmin}>
        <Suspense fallback={<PageLoading />}>
          <Routes>
            {/* Read-only for all authenticated users */}
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/pools" element={<Pools />} />
            <Route path="/datasets" element={<Datasets />} />
            <Route path="/snapshots" element={<Snapshots />} />
            <Route path="/shares" element={<Shares />} />
            <Route path="/nfs" element={<NFS />} />
            <Route path="/disks" element={<Disks />} />
            <Route path="/replication" element={<Replication />} />
            <Route path="/services" element={<Services />} />
            <Route path="/jobs" element={<Jobs />} />
            {/* Admin-only sections */}
            <Route path="/cloud-sync" element={adminOnly(<CloudSync />)} />
            <Route path="/tasks" element={<Navigate to="/cron-jobs" replace />} />
            <Route path="/cron-jobs" element={adminOnly(<CronJobs />)} />
            <Route path="/init-shutdown" element={adminOnly(<InitShutdown />)} />
            <Route path="/rsync-tasks" element={adminOnly(<RsyncTasks />)} />
            <Route path="/smart-tests" element={adminOnly(<SmartTests />)} />
            <Route path="/snapshot-tasks" element={adminOnly(<SnapshotTasks />)} />
            <Route path="/resilver" element={adminOnly(<ResilverPriority />)} />
            <Route path="/app-users" element={adminOnly(<AppUsers isAdmin={isAdmin} currentUser={user} />)} />
            <Route path="/system-users" element={adminOnly(<SystemUsers />)} />
            <Route path="/users" element={<Navigate to="/app-users" replace />} />
            <Route path="/smb-users" element={adminOnly(<SmbUsers />)} />
            <Route path="/cloud-credentials" element={adminOnly(<CloudCredentials />)} />
            <Route path="/services/ddns" element={adminOnly(<DynamicDNS />)} />
            <Route path="/services/ftp" element={adminOnly(<FTPConfig />)} />
            <Route path="/services/ups" element={adminOnly(<UPSConfig />)} />
            <Route path="/services/openvpn" element={adminOnly(<OpenVPNConfig />)} />
            <Route path="/services/snmp" element={adminOnly(<SNMPConfig />)} />
            <Route path="/shell" element={adminOnly(<Shell />)} />
            <Route path="/settings" element={adminOnly(<Settings />)} />
            <Route path="/enclosures" element={adminOnly(<Enclosures />)} />
            <Route path="/updates" element={adminOnly(<Updates />)} />
            <Route path="/network" element={adminOnly(<NetworkSummary />)} />
            <Route path="/network/global" element={adminOnly(<GlobalConfig />)} />
            <Route path="/network/interfaces" element={adminOnly(<NetworkInterfaces />)} />
            <Route path="/network/static-routes" element={adminOnly(<StaticRoutes />)} />
            <Route path="/network/ipmi" element={adminOnly(<IPMI />)} />
            <Route path="/logs" element={adminOnly(<Logs />)} />
            <Route path="/alerts" element={adminOnly(<Alerts />)} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </Layout>
    </BrowserRouter>
  )
}

export default App
