# LTCast — Bitfocus Companion Module

Control [LTCast](https://ltcast.app) timecode player from Bitfocus Companion.

## Requirements

- LTCast v0.5.0+
- Bitfocus Companion 3.x
- Remote Display must be enabled in LTCast (status bar toggle)

## Installation

1. Copy the `companion/` folder into your Companion modules directory:
   - **Windows**: `%APPDATA%\companion-module-ltcast\`
   - **macOS**: `~/Library/Application Support/companion-module-ltcast/`
2. Restart Companion
3. Add a new connection: search for **LTCast**

## Configuration

| Field | Description | Default |
|-------|-------------|---------|
| IP Address | LTCast machine IP (or `127.0.0.1` if same machine) | `127.0.0.1` |
| Port | WebSocket port (shown in LTCast status bar) | `3100` |
| PIN | 4-digit PIN (shown in LTCast status bar when Remote is active) | — |

## Actions

| Action | Description |
|--------|-------------|
| **Play / Pause Toggle** | Toggle between play and pause |
| **Play** | Start playback (same as Play/Pause when stopped) |
| **Pause** | Pause playback |
| **Stop** | Stop and return to beginning |
| **Next Song** | Load next song in setlist |
| **Previous Song** | Load previous song in setlist |
| **Go To Song** | Jump to a specific song by number (1-based) |

## Feedbacks

| Feedback | Description |
|----------|-------------|
| **Playing** | Button lights up when LTCast is playing |
| **Paused** | Button lights up when paused |
| **Stopped** | Button lights up when stopped |
| **LTC Signal OK** | Button lights up when LTC signal is present |

## Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `$(ltcast:timecode)` | Current timecode | `01:23:45:12` |
| `$(ltcast:status)` | Playback status | `playing` |
| `$(ltcast:song)` | Current song name | `Intro.wav` |
| `$(ltcast:fps)` | Frame rate | `25` |
| `$(ltcast:signal_ok)` | LTC signal status | `Yes` / `No` |

## Troubleshooting

- **Connection failed**: Make sure Remote Display is enabled in LTCast and the PIN matches
- **Invalid PIN**: The PIN changes each time Remote Display is restarted — check the LTCast status bar
- **Auto-reconnect**: The module automatically reconnects every 5 seconds if the connection drops
