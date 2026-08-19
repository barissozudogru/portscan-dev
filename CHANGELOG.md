# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.4.0] - 2026-08-19

### Added
- SQL Server, Oracle, the Docker daemon, RabbitMQ, Memcached and Ollama ports, which fall outside the 3000-9999 range.
- Test suite.

## [0.3.0] - 2025-07-15

### Added
- Signal validation: `--signal` now rejects unknown signal names with a clear error listing all valid options
- `--kill` now works for ports outside the default dev range (e.g. port 80, 443) by querying `lsof`/`ss` directly for the target port regardless of default filters
- TTY detection: colors and formatting are suppressed when stdout is not a terminal, making piped output and CI logs clean

### Changed
- README rewritten with structured sections, options table, example output, platform support, and exit codes

### Fixed
- `--kill` on ports not in the default scan range no longer silently reports "no process found"

---

## [0.2.0] - 2025-06-28

### Added
- Linux support via `ss -tlnp` (iproute2); automatic fallback to `lsof` when `ss` is unavailable
- `--port-range <start-end>` flag to filter the scan to a custom port range (e.g. `3000-5000`)
- Full command string in output via `ps -o etime=,args=`; column now shows complete argv, not just the process name
- ANSI color output: port in cyan, process name in yellow, non-essential text dimmed

### Changed
- Output table now includes an UPTIME column using elapsed time from `ps`
- `--kill` accepts comma-separated ports (`--kill 3000,8080,4000`) for bulk termination in one command

### Fixed
- Scan output was missing processes when `lsof` exited non-zero despite returning results (common on some macOS versions)

---

## [0.1.0] - 2025-06-10

### Added
- Initial release
- Port scan using `lsof -iTCP -sTCP:LISTEN -n -P` on macOS
- Default scan range: ports 3000-9999 plus 5432 (PostgreSQL), 6379 (Redis), 27017 (MongoDB)
- `--kill <port>` flag to send `SIGTERM` (default) or a custom signal to the process on a port
- `--json` flag to output scan or kill results as newline-terminated JSON
- `--version` and `--help` flags
- TypeScript source compiled to ESM via `tsc`; zero runtime dependencies
