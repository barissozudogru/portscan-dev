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

# Output results as JSON
portscan-dev --json

# Show help
portscan-dev --help
```

## Output

```
PORT      PID       PROCESS               UPTIME

3000      12345     node                  00:03:21
5432      67890     postgres              02:14:05
6379      11111     redis-server          01:00:00
```

## Scanned Ports

- Development range: 3000-9999
- Databases: 5432 (PostgreSQL), 6379 (Redis), 27017 (MongoDB)

## Platform

macOS only. Uses `lsof` to detect listening TCP processes.

## License

MIT
