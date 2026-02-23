import { useState, useEffect, useRef, useMemo } from 'react'
import api from '../api'
import StatusBadge from '../components/StatusBadge'
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const formatKB = (kb) => {
  if (kb >= 1048576) return `${(kb / 1048576).toFixed(1)} GiB`
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MiB`
  return `${kb} KiB`
}

const formatRate = (bytesPerSec) => {
  if (bytesPerSec >= 1073741824) return `${(bytesPerSec / 1073741824).toFixed(1)} GB/s`
  if (bytesPerSec >= 1048576) return `${(bytesPerSec / 1048576).toFixed(1)} MB/s`
  if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`
  return `${Math.round(bytesPerSec)} B/s`
}

// --- SVG watermark icons ---
const iconClass = "absolute bottom-2 right-2 w-24 h-24 opacity-[0.04] dark:opacity-[0.06] text-gray-900 dark:text-gray-100 pointer-events-none"

function IconServer() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="6" rx="1" />
      <rect x="2" y="10" width="20" height="6" rx="1" />
      <line x1="6" y1="5" x2="6" y2="5" /><line x1="6" y1="13" x2="6" y2="13" />
      <line x1="2" y1="20" x2="6" y2="16" /><line x1="22" y1="20" x2="18" y2="16" />
    </svg>
  )
}

function IconCpu() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <line x1="9" y1="1" x2="9" y2="5" /><line x1="15" y1="1" x2="15" y2="5" />
      <line x1="9" y1="19" x2="9" y2="23" /><line x1="15" y1="19" x2="15" y2="23" />
      <line x1="1" y1="9" x2="5" y2="9" /><line x1="1" y1="15" x2="5" y2="15" />
      <line x1="19" y1="9" x2="23" y2="9" /><line x1="19" y1="15" x2="23" y2="15" />
    </svg>
  )
}

function IconMemory() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="18" height="12" rx="1" />
      <path d="M7 6V4h2v2M11 6V4h2v2M15 6V4h2v2" />
      <rect x="5" y="9" width="3" height="4" rx="0.5" /><rect x="10" y="9" width="3" height="4" rx="0.5" /><rect x="15" y="9" width="3" height="4" rx="0.5" />
    </svg>
  )
}

function IconPool() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
      <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6" />
    </svg>
  )
}

function IconNetwork() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="16" rx="2" />
      <line x1="8" y1="18" x2="8" y2="22" /><line x1="12" y1="18" x2="12" y2="22" /><line x1="16" y1="18" x2="16" y2="22" />
      <line x1="8" y1="6" x2="8" y2="6.01" /><line x1="12" y1="6" x2="12" y2="6.01" /><line x1="16" y1="6" x2="16" y2="6.01" />
      <line x1="8" y1="10" x2="8" y2="10.01" /><line x1="12" y1="10" x2="12" y2="10.01" /><line x1="16" y1="10" x2="16" y2="10.01" />
    </svg>
  )
}

function IconGear() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  )
}

function IconThermometer() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 14.76V3.5a2.5 2.5 0 00-5 0v11.26a4.5 4.5 0 105 0z" />
      <line x1="11.5" y1="8" x2="11.5" y2="15" />
      <circle cx="11.5" cy="17.5" r="1.5" />
    </svg>
  )
}

function IconCamera() {
  return (
    <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  )
}

// --- Card wrapper ---
function Card({ children, icon, noMinH = false }) {
  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow p-5 relative overflow-hidden ${!noMinH ? 'min-h-[16rem]' : ''} flex flex-col`}>
      <div className="flex-1 relative z-10">{children}</div>
      {icon}
    </div>
  )
}

function CardTitle({ children }) {
  return <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-3">{children}</h3>
}

// --- useCardOrder hook ---
function useCardOrder(currentCardIds) {
  const currentKey = currentCardIds.join(',')

  const [order, setOrder] = useState(() => {
    try {
      const saved = localStorage.getItem('dashboard-card-order')
      if (saved) return JSON.parse(saved)
    } catch {}
    return currentCardIds
  })

  // Reconcile when currentCardIds changes (pools/interfaces added/removed)
  useEffect(() => {
    setOrder(prev => {
      const currentSet = new Set(currentCardIds)
      const prevSet = new Set(prev)
      // Prune stale IDs
      const pruned = prev.filter(id => currentSet.has(id))
      // Append new IDs at the end
      const added = currentCardIds.filter(id => !prevSet.has(id))
      const next = [...pruned, ...added]
      localStorage.setItem('dashboard-card-order', JSON.stringify(next))
      return next
    })
  }, [currentKey])

  const reorder = (activeId, overId) => {
    if (!overId || activeId === overId) return
    setOrder(prev => {
      const oldIndex = prev.indexOf(activeId)
      const newIndex = prev.indexOf(overId)
      if (oldIndex === -1 || newIndex === -1) return prev
      const next = arrayMove(prev, oldIndex, newIndex)
      localStorage.setItem('dashboard-card-order', JSON.stringify(next))
      return next
    })
  }

  return [order, reorder]
}

// --- SortableCard wrapper ---
function SortableCard({ id, editMode, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !editMode })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="relative">
      {editMode && (
        <>
          <div className="absolute inset-0 ring-2 ring-blue-400/40 ring-dashed rounded-lg pointer-events-none z-10" />
          <button
            {...attributes}
            {...listeners}
            className="absolute top-2 right-2 z-20 p-1 rounded bg-white/80 dark:bg-gray-700/80 shadow cursor-grab active:cursor-grabbing"
            aria-label="Drag to reorder"
          >
            <svg className="w-5 h-5 text-gray-500 dark:text-gray-300" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="9" cy="5" r="1.5" />
              <circle cx="15" cy="5" r="1.5" />
              <circle cx="9" cy="12" r="1.5" />
              <circle cx="15" cy="12" r="1.5" />
              <circle cx="9" cy="19" r="1.5" />
              <circle cx="15" cy="19" r="1.5" />
            </svg>
          </button>
        </>
      )}
      {children}
    </div>
  )
}

// --- System Information Card ---
function SystemInfoCard({ system }) {
  if (!system) return null
  const rows = [
    ['Hostname', system.hostname],
    ['Version', system.version],
    ['Kernel', system.kernel],
    ['Uptime', system.uptime],
  ]
  return (
    <Card icon={<IconServer />}>
      <CardTitle>System Information</CardTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between py-1 border-b dark:border-gray-700 last:border-0">
            <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
            <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{value || 'unknown'}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

// --- CPU Card ---
function CpuCard({ cpu }) {
  if (!cpu) return null
  const usageColor = cpu.avg_usage > 80 ? 'text-red-500' : cpu.avg_usage > 50 ? 'text-yellow-500' : 'text-green-500'
  const hottest = cpu.temperatures.length > 0 ? Math.max(...cpu.temperatures) : null
  return (
    <Card icon={<IconCpu />}>
      <CardTitle>CPU</CardTitle>
      <p className="text-xs text-gray-500 dark:text-gray-400 truncate mb-2" title={cpu.model}>{cpu.model}</p>
      <div className={`text-2xl font-bold ${usageColor} mb-2`}>{cpu.avg_usage}%</div>
      <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
        <div className="flex justify-between">
          <span>Cores / Threads</span>
          <span className="font-medium text-gray-700 dark:text-gray-200">{cpu.cores} / {cpu.threads}</span>
        </div>
        {hottest !== null && (
          <div className="flex justify-between">
            <span>Hottest</span>
            <span className={`font-medium ${hottest > 80 ? 'text-red-500' : hottest > 60 ? 'text-yellow-500' : 'text-gray-700 dark:text-gray-200'}`}>
              {hottest}&deg;C
            </span>
          </div>
        )}
      </div>
    </Card>
  )
}

// --- Memory Card ---
function MemoryCard({ memory }) {
  if (!memory || !memory.total_kb) return null
  const total = memory.total_kb
  const arc = memory.arc_size_kb || 0
  const services = memory.services_kb || 0
  const free = memory.available_kb || 0
  const arcPct = total > 0 ? (arc / total) * 100 : 0
  const svcPct = total > 0 ? (services / total) * 100 : 0
  const freePct = total > 0 ? (free / total) * 100 : 0

  return (
    <Card icon={<IconMemory />}>
      <CardTitle>Memory</CardTitle>
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">{formatKB(total)} total</p>
      <div className="w-full h-5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden flex">
        {svcPct > 0 && (
          <div className="h-full bg-purple-500" style={{ width: `${svcPct}%` }} title={`Services: ${formatKB(services)}`} />
        )}
        {arcPct > 0 && (
          <div className="h-full bg-blue-500" style={{ width: `${arcPct}%` }} title={`ZFS ARC: ${formatKB(arc)}`} />
        )}
        {freePct > 0 && (
          <div className="h-full bg-gray-300 dark:bg-gray-500" style={{ width: `${freePct}%` }} title={`Free: ${formatKB(free)}`} />
        )}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-xs text-gray-500 dark:text-gray-400">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded bg-purple-500" /> Services: {formatKB(services)}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded bg-blue-500" /> ZFS Cache: {formatKB(arc)}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded bg-gray-300 dark:bg-gray-500" /> Free: {formatKB(free)}
        </span>
        <span className="ml-auto font-medium text-gray-700 dark:text-gray-200">{memory.percent}% used</span>
      </div>
    </Card>
  )
}

// --- Pool Card ---
function PoolCard({ pool }) {
  const capacityNum = parseInt(pool.capacity) || 0
  const barColor = capacityNum > 85 ? 'bg-red-500' : capacityNum > 70 ? 'bg-yellow-500' : 'bg-blue-500'
  return (
    <Card icon={<IconPool />}>
      <div className="flex items-center justify-between mb-3">
        <CardTitle>Pool: {pool.name}</CardTitle>
        <StatusBadge status={pool.health} />
      </div>
      {/* Used bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
          <span>{pool.allocated} used of {pool.size}</span>
          <span>{pool.capacity}</span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-3">
          <div className={`h-3 rounded-full ${barColor}`} style={{ width: `${Math.min(capacityNum, 100)}%` }} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        <div className="flex justify-between">
          <span>Available</span>
          <span className="text-gray-700 dark:text-gray-200">{pool.free}</span>
        </div>
        <div className="flex justify-between">
          <span>Fragmentation</span>
          <span className="text-gray-700 dark:text-gray-200">{pool.fragmentation}</span>
        </div>
        <div className="flex justify-between">
          <span>Total Disks</span>
          <span className="text-gray-700 dark:text-gray-200">{pool.total_disks}</span>
        </div>
        <div className="flex justify-between">
          <span>Disk Errors</span>
          <span className={pool.disks_with_errors > 0 ? 'text-red-500 font-medium' : 'text-green-600 dark:text-green-400'}>
            {pool.disks_with_errors > 0 ? pool.disks_with_errors : 'None'}
          </span>
        </div>
        {pool.path && (
          <div className="flex justify-between col-span-2">
            <span>Mount Path</span>
            <span className="text-gray-700 dark:text-gray-200 font-mono">{pool.path}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Data VDevs</span>
          <span className="text-gray-700 dark:text-gray-200">{pool.data_vdevs}</span>
        </div>
        <div className="flex justify-between">
          <span>Cache</span>
          <span className="text-gray-700 dark:text-gray-200">{pool.cache_count}</span>
        </div>
        <div className="flex justify-between">
          <span>Spares</span>
          <span className="text-gray-700 dark:text-gray-200">{pool.spare_count}</span>
        </div>
        <div className="flex justify-between">
          <span>Logs</span>
          <span className="text-gray-700 dark:text-gray-200">{pool.log_count}</span>
        </div>
      </div>
    </Card>
  )
}

// --- Interface Card ---
function InterfaceCard({ iface, rate }) {
  const isUp = iface.state === 'up'
  const stateBadgeClass = isUp
    ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'

  return (
    <Card icon={<IconNetwork />}>
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-sm text-gray-800 dark:text-gray-100">{iface.name}</span>
        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${stateBadgeClass}`}>
          {isUp ? 'LINK UP' : 'LINK DOWN'}
        </span>
      </div>
      {isUp && rate ? (
        <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400 mb-2">
          <div>In: <span className="text-gray-700 dark:text-gray-200 font-medium">{formatRate(rate.rx)}</span></div>
          <div>Out: <span className="text-gray-700 dark:text-gray-200 font-medium">{formatRate(rate.tx)}</span></div>
        </div>
      ) : !isUp ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">No Traffic</p>
      ) : (
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">Measuring...</p>
      )}
      <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
        {iface.speed && <div>Speed: <span className="text-gray-700 dark:text-gray-200">{iface.speed}</span></div>}
        {iface.addresses.length > 0 ? (
          <div>IP: <span className="text-gray-700 dark:text-gray-200">{iface.addresses.join(', ')}</span></div>
        ) : (
          <div>IPs: <span className="text-gray-400">none</span></div>
        )}
        {iface.mac && <div>MAC: <span className="text-gray-700 dark:text-gray-200 font-mono">{iface.mac}</span></div>}
      </div>
    </Card>
  )
}

// --- Services Card ---
function ServicesCard({ services }) {
  return (
    <Card icon={<IconGear />}>
      <CardTitle>Services</CardTitle>
      {services.map(svc => (
        <div key={svc.name} className="flex items-center justify-between py-1.5 border-b dark:border-gray-700 last:border-0">
          <span className="text-sm text-gray-700 dark:text-gray-200">{svc.name}</span>
          <StatusBadge status={svc.active} />
        </div>
      ))}
    </Card>
  )
}

// --- Disk Temperatures Card ---
function DiskTempsCard({ temps }) {
  return (
    <Card icon={<IconThermometer />}>
      <CardTitle>Disk Temperatures</CardTitle>
      {temps.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">No disk data</p>
      ) : temps.map(d => (
        <div key={d.disk} className="flex items-center justify-between py-1.5 border-b dark:border-gray-700 last:border-0">
          <span className="text-sm text-gray-700 dark:text-gray-200">{d.disk}</span>
          <span className={`text-sm font-mono ${
            d.temperature != null && d.temperature > 50 ? 'text-red-500' :
            d.temperature != null && d.temperature > 40 ? 'text-yellow-500' :
            'text-gray-700 dark:text-gray-200'
          }`}>
            {d.temperature != null ? `${d.temperature}\u00b0C` : 'N/A'}
          </span>
        </div>
      ))}
    </Card>
  )
}

// --- Recent Snapshots Card ---
function SnapshotsCard({ snapshots }) {
  return (
    <Card icon={<IconCamera />}>
      <CardTitle>Recent Snapshots</CardTitle>
      {snapshots.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">No snapshots</p>
      ) : snapshots.map(snap => (
        <div key={snap.name} className="py-1 border-b dark:border-gray-700 last:border-0">
          <div className="font-mono text-xs text-gray-700 dark:text-gray-200 truncate">{snap.name}</div>
          <div className="text-xs text-gray-400 dark:text-gray-500">{snap.creation}</div>
        </div>
      ))}
    </Card>
  )
}


// --- Main Dashboard ---

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [ifaceRates, setIfaceRates] = useState({})
  const [editMode, setEditMode] = useState(false)
  const [activeId, setActiveId] = useState(null)
  const prevIfaces = useRef(null)
  const prevTime = useRef(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  )

  const load = async () => {
    try {
      const res = await api.get('/dashboard')
      setData(res.data)

      // Compute interface throughput deltas
      const now = Date.now()
      const ifaces = res.data.interfaces || []
      if (prevIfaces.current && prevTime.current) {
        const elapsed = (now - prevTime.current) / 1000
        if (elapsed > 0) {
          const rates = {}
          for (const iface of ifaces) {
            const prev = prevIfaces.current.find(p => p.name === iface.name)
            if (prev) {
              rates[iface.name] = {
                rx: Math.max(0, (iface.rx_bytes - prev.rx_bytes) / elapsed),
                tx: Math.max(0, (iface.tx_bytes - prev.tx_bytes) / elapsed),
              }
            }
          }
          setIfaceRates(rates)
        }
      }
      prevIfaces.current = ifaces
      prevTime.current = now
    } catch (err) {
      console.error('Dashboard load error:', err)
    } finally {
      setLoading(false)
    }
  }

  const interfaces = useMemo(() =>
    (data?.interfaces || []).filter(i => i.type === 'physical' || i.type === 'bond'),
    [data]
  )

  const currentCardIds = useMemo(() => {
    if (!data) return []
    return [
      'system-info', 'cpu', 'memory',
      ...data.pools.map(p => `pool-${p.name}`),
      ...interfaces.map(i => `iface-${i.name}`),
      'services', 'disk-temps', 'snapshots',
    ]
  }, [data, interfaces])

  const [order, reorder] = useCardOrder(currentCardIds)

  useEffect(() => {
    if (activeId) return // Don't poll mid-drag
    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [activeId])

  if (loading) return <div className="text-gray-500 dark:text-gray-400">Loading dashboard...</div>
  if (!data) return <div className="text-red-500">Failed to load dashboard</div>

  const cardRegistry = {
    'system-info': <SystemInfoCard system={data.system} />,
    'cpu': <CpuCard cpu={data.cpu} />,
    'memory': <MemoryCard memory={data.memory} />,
    'services': <ServicesCard services={data.services} />,
    'disk-temps': <DiskTempsCard temps={data.disk_temps} />,
    'snapshots': <SnapshotsCard snapshots={data.recent_snapshots} />,
  }
  data.pools.forEach(p => { cardRegistry[`pool-${p.name}`] = <PoolCard pool={p} /> })
  interfaces.forEach(i => { cardRegistry[`iface-${i.name}`] = <InterfaceCard iface={i} rate={ifaceRates[i.name]} /> })

  const handleDragStart = (event) => {
    setActiveId(event.active.id)
  }

  const handleDragEnd = (event) => {
    const { active, over } = event
    if (over) reorder(active.id, over.id)
    setActiveId(null)
  }

  const handleDragCancel = () => {
    setActiveId(null)
  }

  return (
    <div>
      {/* Header with edit toggle */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Dashboard</h2>
        <button
          onClick={() => setEditMode(e => !e)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            editMode
              ? 'bg-blue-500 text-white hover:bg-blue-600'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          {editMode ? (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
          ) : (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 014-4.83" />
            </svg>
          )}
          {editMode ? 'Done' : 'Customize'}
        </button>
      </div>

      {/* Single flat grid with DnD */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext items={order} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {order.map(id => cardRegistry[id] ? (
              <SortableCard key={id} id={id} editMode={editMode}>
                {cardRegistry[id]}
              </SortableCard>
            ) : null)}
          </div>
        </SortableContext>
        <DragOverlay>
          {activeId && cardRegistry[activeId] ? (
            <div className="opacity-80 shadow-2xl rounded-lg">
              {cardRegistry[activeId]}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
