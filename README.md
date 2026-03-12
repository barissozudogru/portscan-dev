<h1 align="center">portscan-dev</h1>

<p align="center">
  See what is running on your development ports and kill it with one command.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js >= 18">
  <img src="https://img.shields.io/badge/License-MIT-blue?style=flat" alt="MIT License">
  <img src="https://img.shields.io/badge/Zero_Dependencies-brightgreen?style=flat" alt="Zero Dependencies">
</p>

---

## What It Does

`portscan-dev` scans your system for processes listening on development ports and gives you a clean, readable table showing the port, PID, process name, uptime, and full command. When something is occupying a port you need, kill it in one command — no manual `lsof` piping required.

- Scans ports 3000–9999 and common database ports by default
- Kills one or many ports at once, with configurable signal
- Outputs JSON for scripting and CI use
- Filters to any custom port range
- Works on macOS and Linux with automatic tool detection
- Zero runtime dependencies

---

## Quick Start

```bash
npm install -g @barissozudogru/portscan-dev
```

```bash
# See everything running on your dev ports
portscan-dev

# Kill whatever is on port 3000
portscan-dev --kill 3000
```

---

## Usage

```bash
# Scan all active development ports
portscan-dev

# Kill a process on a specific port
portscan-dev --kill 3000

# Kill multiple ports at once
portscan-dev --kill 3000,8080,4000

# Kill with a specific signal
portscan-dev --kill 3000 --signal SIGKILL

# Filter scan to a specific port range
portscan-dev --port-range 3000-5000

# Output results as JSON
portscan-dev --json

# Show version
portscan-dev --version

# Show help
portscan-dev --help
```

---

## Options

| Flag | Alias | Description | Default |
|---|---|---|---|
| `--kill <ports>` | `-k` | Comma-separated list of ports to kill | — |
| `--signal <signal>` | `-s` | Signal to send when killing (e.g. `SIGTERM`, `SIGKILL`) | `SIGTERM` |
| `--port-range <start-end>` | — | Filter scan to a port range, e.g. `3000-9000` | — |
| `--json` | `-j` | Output results as JSON | — |
| `--version` | `-v` | Print version and exit | — |
| `--help` | `-h` | Show help | — |

---

## Example Output

```
PORT      PID       PROCESS               UPTIME            COMMAND

3000      28471     node                  00:12:04          node server.js
3001      28512     node                  00:11:58          npx react-scripts start
4200      29104     ng                    00:08:31          ng serve --port 4200
5173      31002     vite                  00:02:17          vite --host
8080      22891     python3               01:04:42          python3 -m http.server 8080
5432      1084      postgres              14:22:10          postgres -D /usr/local/var/postgresql@14/data
6379      1091      redis-server          14:22:08          redis-server *:6379
```

---

## Default Scanned Ports

| Range / Port | Description |
|---|---|
| `3000–9999` | General development range |
| `5432` | PostgreSQL |
| `6379` | Redis |
| `27017` | MongoDB |

Use `--port-range <start-end>` to override with a custom range.

---

## Platform Support

| Platform | Detection tool | Notes |
|---|---|---|
| macOS | `lsof` | Available by default on all macOS versions |
| Linux | `ss` | Available in `iproute2`, standard on modern distros |
| Linux (fallback) | `lsof` | Used when `ss` is unavailable |

Process uptime and full command are resolved via `ps` on both platforms.

---

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | Success — scan completed or all ports killed successfully |
| `1` | One or more ports could not be killed |

---

## License

MIT — see [LICENSE](./LICENSE).
