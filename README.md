# portscan-dev

Scan and manage active development ports from the command line.

## Installation

```bash
npm install -g @barissozudogru/portscan-dev
```

## Usage

```bash
# Scan and display all active dev ports
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

## Options

| Flag | Alias | Description |
|---|---|---|
| `--kill <ports>` | `-k` | Comma-separated list of ports to kill |
| `--signal <signal>` | `-s` | Signal to send when killing (default: `SIGTERM`) |
| `--port-range <start-end>` | | Filter scan to a port range, e.g. `3000-9000` |
| `--json` | `-j` | Output as JSON |
| `--version` | `-v` | Print version and exit |
| `--help` | `-h` | Show help |

## Output

```
PORT      PID       PROCESS               UPTIME            COMMAND

3000      12345     node                  00:03:21          node server.js
5432      67890     postgres              02:14:05          postgres -D /usr/local/var/postgresql
6379      11111     redis-server          01:00:00          redis-server *:6379
```

## Scanned Ports

By default, the following ports are included in the scan:

- Development range: 3000-9999
- Databases: 5432 (PostgreSQL), 6379 (Redis), 27017 (MongoDB)

Use `--port-range` to override with a custom range.

## Platform

Works on macOS and Linux. Uses `lsof` on macOS and `ss` on Linux to detect listening TCP processes, with automatic fallback between tools.

## License

MIT
