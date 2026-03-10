import { useState, useEffect } from 'react'

const PRESETS = [
  { label: 'Hourly', value: '0 * * * *' },
  { label: 'Daily (midnight)', value: '0 0 * * *' },
  { label: 'Daily (noon)', value: '0 12 * * *' },
  { label: 'Weekly (Sun)', value: '0 0 * * 0' },
  { label: 'Monthly', value: '0 0 1 * *' },
]

const MINUTES = Array.from({ length: 60 }, (_, i) => i)
const HOURS = Array.from({ length: 24 }, (_, i) => i)
const DOMS = Array.from({ length: 31 }, (_, i) => i + 1)
const MONTHS = [
  { value: 1, label: 'Jan' }, { value: 2, label: 'Feb' }, { value: 3, label: 'Mar' },
  { value: 4, label: 'Apr' }, { value: 5, label: 'May' }, { value: 6, label: 'Jun' },
  { value: 7, label: 'Jul' }, { value: 8, label: 'Aug' }, { value: 9, label: 'Sep' },
  { value: 10, label: 'Oct' }, { value: 11, label: 'Nov' }, { value: 12, label: 'Dec' },
]
const DOWS = [
  { value: 0, label: 'Sun' }, { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
]

function describeCron(cron) {
  const preset = PRESETS.find(p => p.value === cron)
  if (preset) return preset.label
  const parts = (cron || '').split(/\s+/)
  if (parts.length !== 5) return ''
  const [min, hour, dom, mon, dow] = parts
  let desc = []
  if (min !== '*' && hour !== '*') desc.push(`at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`)
  else if (min !== '*') desc.push(`at minute ${min}`)
  if (dom !== '*') desc.push(`on day ${dom}`)
  if (mon !== '*') {
    const m = MONTHS.find(m => String(m.value) === mon)
    desc.push(`in ${m ? m.label : `month ${mon}`}`)
  }
  if (dow !== '*') {
    const d = DOWS.find(d => String(d.value) === dow)
    desc.push(`on ${d ? d.label : `day ${dow}`}`)
  }
  return desc.join(' ') || 'Every minute'
}

const selectClass = 'border dark:border-gray-600 rounded px-2 py-1 text-xs dark:bg-gray-700 dark:text-gray-100'

export default function CronPicker({ value, onChange }) {
  const [custom, setCustom] = useState(false)
  const parts = (value || '* * * * *').split(/\s+/)
  const [min, hour, dom, mon, dow] = parts.length === 5 ? parts : ['*', '*', '*', '*', '*']

  const isPreset = PRESETS.some(p => p.value === value)

  useEffect(() => {
    if (!isPreset && value) setCustom(true)
  }, [])

  const setPart = (idx, val) => {
    const p = [min, hour, dom, mon, dow]
    p[idx] = val
    onChange(p.join(' '))
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        {PRESETS.map(p => (
          <button
            key={p.value}
            type="button"
            onClick={() => { setCustom(false); onChange(p.value) }}
            className={`px-2.5 py-1 text-xs rounded border ${value === p.value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600'}`}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCustom(!custom)}
          className={`px-2.5 py-1 text-xs rounded border ${custom && !isPreset ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600'}`}
        >
          Custom
        </button>
      </div>

      {custom && (
        <div className="flex flex-wrap gap-2 mb-2">
          <div>
            <label className="block text-[10px] text-gray-400 mb-0.5">Minute</label>
            <select value={min} onChange={e => setPart(0, e.target.value)} className={selectClass}>
              <option value="*">Every (*)</option>
              {MINUTES.map(m => <option key={m} value={String(m)}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-gray-400 mb-0.5">Hour</label>
            <select value={hour} onChange={e => setPart(1, e.target.value)} className={selectClass}>
              <option value="*">Every (*)</option>
              {HOURS.map(h => <option key={h} value={String(h)}>{String(h).padStart(2, '0')}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-gray-400 mb-0.5">Day</label>
            <select value={dom} onChange={e => setPart(2, e.target.value)} className={selectClass}>
              <option value="*">Every (*)</option>
              {DOMS.map(d => <option key={d} value={String(d)}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-gray-400 mb-0.5">Month</label>
            <select value={mon} onChange={e => setPart(3, e.target.value)} className={selectClass}>
              <option value="*">Every (*)</option>
              {MONTHS.map(m => <option key={m.value} value={String(m.value)}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-gray-400 mb-0.5">Weekday</label>
            <select value={dow} onChange={e => setPart(4, e.target.value)} className={selectClass}>
              <option value="*">Every (*)</option>
              {DOWS.map(d => <option key={d.value} value={String(d.value)}>{d.label}</option>)}
            </select>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <code className="text-xs font-mono text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">{value || '* * * * *'}</code>
        {describeCron(value) && <span className="text-xs text-gray-400 dark:text-gray-500">{describeCron(value)}</span>}
      </div>
    </div>
  )
}
