import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import api from './api'
import Layout from './components/Layout'
import Login from './pages/Login'
import Setup from './pages/Setup'
import Dashboard from './pages/Dashboard'
import Pools from './pages/Pools'
import Datasets from './pages/Datasets'
import Snapshots from './pages/Snapshots'
import Shares from './pages/Shares'
import NFS from './pages/NFS'
import CloudSync from './pages/CloudSync'
import Tasks from './pages/Tasks'
import CronJobs from './pages/CronJobs'
import InitShutdown from './pages/InitShutdown'
import RsyncTasks from './pages/RsyncTasks'
import SmartTests from './pages/SmartTests'
import SnapshotTasks from './pages/SnapshotTasks'
import ResilverPriority from './pages/ResilverPriority'
import AppUsers from './pages/AppUsers'
import SystemUsers from './pages/SystemUsers'
import Services from './pages/Services'
import Disks from './pages/Disks'
import Settings from './pages/Settings'
import Enclosures from './pages/Enclosures'
import Updates from './pages/Updates'
import NetworkSummary from './pages/NetworkSummary'
import GlobalConfig from './pages/GlobalConfig'
import NetworkInterfaces from './pages/NetworkInterfaces'
import StaticRoutes from './pages/StaticRoutes'
import IPMI from './pages/IPMI'
import Replication from './pages/Replication'
import Logs from './pages/Logs'
import Alerts from './pages/Alerts'
import Jobs from './pages/Jobs'
import DynamicDNS from './pages/DynamicDNS'
import FTPConfig from './pages/FTPConfig'
import UPSConfig from './pages/UPSConfig'
import OpenVPNConfig from './pages/OpenVPNConfig'
import SNMPConfig from './pages/SNMPConfig'
import Shell from './pages/Shell'
import SmbUsers from './pages/SmbUsers'
import CloudCredentials from './pages/CloudCredentials'

function App() {
  const [user, setUser] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [checking, setChecking] = useState(true)

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
        <Login onLogin={(username, admin) => { setUser(username); setIsAdmin(!!admin) }} />
      </BrowserRouter>
    )
  }

  const adminOnly = (el) => isAdmin ? el : <Navigate to="/dashboard" replace />

  return (
    <BrowserRouter>
      <Layout user={user} isAdmin={isAdmin}>
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
      </Layout>
    </BrowserRouter>
  )
}

export default App
