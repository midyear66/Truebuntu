import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

export default function Shell() {
  const containerRef = useRef(null)
  const termRef = useRef(null)
  const wsRef = useRef(null)
  const fitRef = useRef(null)
  const resizeCleanupRef = useRef(null)
  const [disconnected, setDisconnected] = useState(false)

  const connect = useCallback(() => {
    if (termRef.current) {
      termRef.current.dispose()
      termRef.current = null
    }
    if (resizeCleanupRef.current) {
      window.removeEventListener('resize', resizeCleanupRef.current)
      resizeCleanupRef.current = null
    }

    setDisconnected(false)

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1a1b26',
        foreground: '#c0caf5',
        cursor: '#c0caf5',
        selectionBackground: '#33467c',
        black: '#15161e',
        red: '#f7768e',
        green: '#9ece6a',
        yellow: '#e0af68',
        blue: '#7aa2f7',
        magenta: '#bb9af7',
        cyan: '#7dcfff',
        white: '#a9b1d6',
        brightBlack: '#414868',
        brightRed: '#f7768e',
        brightGreen: '#9ece6a',
        brightYellow: '#e0af68',
        brightBlue: '#7aa2f7',
        brightMagenta: '#bb9af7',
        brightCyan: '#7dcfff',
        brightWhite: '#c0caf5',
      },
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)

    termRef.current = term
    fitRef.current = fit

    // Delay fit() so the container has been painted with actual dimensions
    requestAnimationFrame(() => {
      fit.fit()
      term.focus()

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(`${proto}//${window.location.host}/api/shell/ws`)
      wsRef.current = ws

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }

      ws.onmessage = (e) => {
        term.write(e.data)
      }

      ws.onclose = () => {
        setDisconnected(true)
        term.write('\r\n\x1b[31mSession disconnected.\x1b[0m\r\n')
      }

      ws.onerror = () => {
        setDisconnected(true)
      }

      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data)
        }
      })

      term.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols, rows }))
        }
      })
    })

    const handleResize = () => {
      if (fitRef.current) fitRef.current.fit()
    }
    window.addEventListener('resize', handleResize)
    resizeCleanupRef.current = handleResize
  }, [])

  useEffect(() => {
    connect()

    return () => {
      if (resizeCleanupRef.current) {
        window.removeEventListener('resize', resizeCleanupRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
      }
      if (termRef.current) {
        termRef.current.dispose()
      }
    }
  }, [connect])

  return (
    <div style={{ height: 'calc(100vh - 57px)', margin: '-24px', display: 'flex', flexDirection: 'column' }}>
      {disconnected && (
        <div className="flex items-center gap-3 px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm shrink-0">
          <span>Session disconnected.</span>
          <button
            onClick={connect}
            className="px-3 py-1 text-xs bg-red-100 dark:bg-red-900/40 rounded hover:bg-red-200 dark:hover:bg-red-900/60"
          >
            Reconnect
          </button>
        </div>
      )}
      <div ref={containerRef} style={{ flex: 1, overflow: 'hidden' }} />
    </div>
  )
}
