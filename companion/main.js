const { InstanceBase, InstanceStatus, runEntrypoint } = require('@companion-module/base')
const WebSocket = require('ws')

const RECONNECT_INTERVAL = 5000

class LTCastInstance extends InstanceBase {
  /** @type {WebSocket | null} */
  ws = null
  /** @type {ReturnType<typeof setTimeout> | null} */
  reconnectTimer = null
  authenticated = false
  /** Cached state from LTCast */
  state = {
    timecode: '--:--:--:--',
    status: 'stopped',
    song: '',
    fps: 0,
    signalOk: false
  }

  async init(config) {
    this.config = config
    this.updateActions()
    this.updateFeedbacks()
    this.updateVariableDefinitions()
    this.setVariableValues({
      timecode: this.state.timecode,
      status: this.state.status,
      song: this.state.song,
      fps: String(this.state.fps),
      signal_ok: 'No'
    })

    if (config.host && config.pin) {
      this.connect()
    } else {
      this.updateStatus(InstanceStatus.BadConfig, 'Missing host or PIN')
    }
  }

  async destroy() {
    this.disconnect()
  }

  async configUpdated(config) {
    this.config = config
    this.disconnect()
    if (config.host && config.pin) {
      this.connect()
    } else {
      this.updateStatus(InstanceStatus.BadConfig, 'Missing host or PIN')
    }
  }

  getConfigFields() {
    return [
      {
        type: 'textinput',
        id: 'host',
        label: 'LTCast IP Address',
        default: '127.0.0.1',
        width: 8
      },
      {
        type: 'number',
        id: 'port',
        label: 'WebSocket Port',
        default: 3100,
        min: 1,
        max: 65535,
        width: 4
      },
      {
        type: 'textinput',
        id: 'pin',
        label: 'PIN (shown in LTCast status bar)',
        default: '',
        width: 4
      }
    ]
  }

  // ── WebSocket Connection ────────────────────────────────────

  connect() {
    if (this.ws) this.disconnect()

    const host = this.config.host || '127.0.0.1'
    const port = this.config.port || 3100
    const url = `ws://${host}:${port}`

    this.updateStatus(InstanceStatus.Connecting)
    this.log('debug', `Connecting to ${url}`)

    try {
      this.ws = new WebSocket(url)
    } catch (e) {
      this.updateStatus(InstanceStatus.ConnectionFailure, e.message)
      this.scheduleReconnect()
      return
    }

    this.ws.on('open', () => {
      this.log('debug', 'WebSocket connected, sending PIN')
      this.authenticated = false
      this.ws.send(JSON.stringify({ pin: this.config.pin }))
    })

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        this.handleMessage(msg)
      } catch (e) {
        this.log('warn', `Failed to parse message: ${e.message}`)
      }
    })

    this.ws.on('close', () => {
      this.log('debug', 'WebSocket closed')
      this.authenticated = false
      this.updateStatus(InstanceStatus.Disconnected)
      this.scheduleReconnect()
    })

    this.ws.on('error', (err) => {
      this.log('warn', `WebSocket error: ${err.message}`)
      // 'close' event will follow; reconnect handled there
    })
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.removeAllListeners()
      try { this.ws.close() } catch { /* ignore */ }
      this.ws = null
    }
    this.authenticated = false
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.config.host && this.config.pin) {
        this.connect()
      }
    }, RECONNECT_INTERVAL)
  }

  // ── Message Handler ─────────────────────────────────────────

  handleMessage(msg) {
    if (msg.type === 'auth') {
      if (msg.ok) {
        this.authenticated = true
        this.updateStatus(InstanceStatus.Ok)
        this.log('info', 'Authenticated with LTCast')
      } else {
        this.updateStatus(InstanceStatus.ConnectionFailure, 'Invalid PIN')
        this.log('error', 'Authentication failed — wrong PIN')
        this.disconnect()
      }
      return
    }

    if (msg.type === 'tc') {
      this.state.timecode = msg.value || '--:--:--:--'
      this.state.fps = msg.fps || 0
      this.state.signalOk = msg.signalOk !== false
      this.setVariableValues({
        timecode: this.state.timecode,
        fps: String(this.state.fps),
        signal_ok: this.state.signalOk ? 'Yes' : 'No'
      })
      this.checkFeedbacks('status_playing', 'status_paused', 'status_stopped', 'signal_ok')
      return
    }

    if (msg.type === 'state') {
      this.state.status = msg.status || 'stopped'
      this.state.song = msg.currentSong || ''
      this.state.fps = msg.fps || this.state.fps
      this.state.signalOk = msg.signalOk !== false
      this.setVariableValues({
        status: this.state.status,
        song: this.state.song,
        fps: String(this.state.fps),
        signal_ok: this.state.signalOk ? 'Yes' : 'No'
      })
      this.checkFeedbacks('status_playing', 'status_paused', 'status_stopped', 'signal_ok')
      return
    }
  }

  // ── Send Action to LTCast ───────────────────────────────────

  sendAction(action, params) {
    if (!this.ws || !this.authenticated) return
    try {
      this.ws.send(JSON.stringify({ action, ...params }))
    } catch (e) {
      this.log('warn', `Failed to send action: ${e.message}`)
    }
  }

  // ── Actions ─────────────────────────────────────────────────

  updateActions() {
    this.setActionDefinitions({
      play: {
        name: 'Play',
        options: [],
        callback: () => this.sendAction('play')
      },
      pause: {
        name: 'Pause',
        options: [],
        callback: () => this.sendAction('pause')
      },
      stop: {
        name: 'Stop',
        options: [],
        callback: () => this.sendAction('stop')
      },
      play_pause: {
        name: 'Play / Pause Toggle',
        options: [],
        callback: () => this.sendAction('play-pause')
      },
      next_song: {
        name: 'Next Song',
        options: [],
        callback: () => this.sendAction('next')
      },
      prev_song: {
        name: 'Previous Song',
        options: [],
        callback: () => this.sendAction('prev')
      },
      goto_song: {
        name: 'Go To Song',
        options: [
          {
            type: 'number',
            id: 'index',
            label: 'Song Number (1-based)',
            default: 1,
            min: 1,
            max: 999
          }
        ],
        callback: (action) => {
          const idx = (action.options.index || 1) - 1 // convert to 0-based
          this.sendAction('goto', { index: idx })
        }
      }
    })
  }

  // ── Feedbacks ───────────────────────────────────────────────

  updateFeedbacks() {
    this.setFeedbackDefinitions({
      status_playing: {
        type: 'boolean',
        name: 'Playing',
        description: 'True when LTCast is playing',
        defaultStyle: {
          bgcolor: 0x00aa00, // green
          color: 0xffffff
        },
        options: [],
        callback: () => this.state.status === 'playing'
      },
      status_paused: {
        type: 'boolean',
        name: 'Paused',
        description: 'True when LTCast is paused',
        defaultStyle: {
          bgcolor: 0xaaaa00, // yellow
          color: 0x000000
        },
        options: [],
        callback: () => this.state.status === 'paused'
      },
      status_stopped: {
        type: 'boolean',
        name: 'Stopped',
        description: 'True when LTCast is stopped',
        defaultStyle: {
          bgcolor: 0xaa0000, // red
          color: 0xffffff
        },
        options: [],
        callback: () => this.state.status === 'stopped'
      },
      signal_ok: {
        type: 'boolean',
        name: 'LTC Signal OK',
        description: 'True when LTC signal is present',
        defaultStyle: {
          bgcolor: 0x00aa00,
          color: 0xffffff
        },
        options: [],
        callback: () => this.state.signalOk
      }
    })
  }

  // ── Variables ───────────────────────────────────────────────

  updateVariableDefinitions() {
    this.setVariableDefinitions([
      { variableId: 'timecode', name: 'Current Timecode (HH:MM:SS:FF)' },
      { variableId: 'status', name: 'Playback Status (playing/paused/stopped)' },
      { variableId: 'song', name: 'Current Song Name' },
      { variableId: 'fps', name: 'Frame Rate' },
      { variableId: 'signal_ok', name: 'LTC Signal OK (Yes/No)' }
    ])
  }
}

runEntrypoint(LTCastInstance, [])
