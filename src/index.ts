import { execSync } from "child_process";
import { PortProcess, ScanOptions, KillOptions, KillResult } from "./types.js";

const EXEC_TIMEOUT = 5000;

// Delivering a signal only proves the OS accepted it. A process with a handler
// for the signal can keep the port bound indefinitely, so a kill counts as
// successful only once nothing is listening anymore. These control how long we
// wait for that to happen before reporting the kill as failed.
const KILL_GRACE_MS = 2000;
const KILL_POLL_MS = 100;

const DEV_PORT_RANGES: Array<[number, number]> = [[3000, 9999]];
// Well-known service ports outside the 3000-9999 dev range. Without these a
// scan silently omits a running service, which reads as "nothing is on that
// port" rather than "not scanned".
const EXTRA_PORTS: number[] = [
  1433,  // SQL Server
  1521,  // Oracle
  2375,  // Docker daemon (plain)
  2376,  // Docker daemon (TLS)
  5432,  // PostgreSQL
  5672,  // RabbitMQ
  6379,  // Redis
  11211, // Memcached
  11434, // Ollama
  15672, // RabbitMQ management UI
  27017, // MongoDB
];

function isDevPort(port: number): boolean {
  if (EXTRA_PORTS.includes(port)) return true;
  return DEV_PORT_RANGES.some(([min, max]) => port >= min && port <= max);
}

function getProcessInfo(pid: number): { uptime: string; command: string } {
  try {
    const raw = execSync(`ps -o etime=,args= -p ${pid} 2>/dev/null`, {
      encoding: "utf8",
      timeout: EXEC_TIMEOUT,
    }).trim();

    if (!raw) return { uptime: "unknown", command: "unknown" };

    // etime is a fixed-width column; first whitespace-delimited token is etime,
    // the rest is the full args string.
    const spaceIdx = raw.search(/\s/);
    if (spaceIdx === -1) return { uptime: raw, command: "unknown" };

    const uptime = raw.slice(0, spaceIdx).trim();
    const command = raw.slice(spaceIdx).trim();
    return { uptime: uptime || "unknown", command: command || "unknown" };
  } catch {
    return { uptime: "unknown", command: "unknown" };
  }
}

function scanWithLsof(): string | null {
  try {
    return execSync("lsof -iTCP -sTCP:LISTEN -n -P", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: EXEC_TIMEOUT,
    });
  } catch (err: unknown) {
    const error = err as { stdout?: string; status?: number; code?: string };
    // A 127 exit status is the shell reporting the command was not found, and
    // ENOENT means it never ran at all. The empty stdout that comes with them
    // is not an empty result set, so the error must surface instead of being
    // read as zero ports.
    if (error.status === 127 || error.code === "ENOENT") throw err;
    // lsof exits non-zero when no results on some systems; check if we got output
    if (typeof error.stdout === 'string') return error.stdout;
    return null;
  }
}

function scanWithSs(): string | null {
  try {
    return execSync("ss -tlnp", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: EXEC_TIMEOUT,
    });
  } catch {
    return null;
  }
}

function parseLsofOutput(output: string, filterFn: (port: number) => boolean): PortProcess[] {
  const lines = output.split("\n").slice(1); // skip header
  // A port can be held by several processes at once (cluster workers, IPv4 and
  // IPv6 sockets), so a listener is identified by port and pid together.
  const seen = new Set<string>();
  const results: PortProcess[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    // COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
    const parts = line.split(/\s+/);
    if (parts.length < 9) continue;

    const processName = parts[0];
    const pid = parseInt(parts[1], 10);

    // NAME column may contain state like "(LISTEN)"
    const nameToken = parts[parts.length - 1].startsWith("(")
      ? parts[parts.length - 2]
      : parts[parts.length - 1];

    if (isNaN(pid) || !nameToken) continue;

    const portMatch = nameToken.match(/:(\d+)$/);
    if (!portMatch) continue;

    const port = parseInt(portMatch[1], 10);
    if (isNaN(port) || !filterFn(port)) continue;

    const key = `${port}:${pid}`;
    if (seen.has(key)) continue;

    seen.add(key);
    const { uptime, command } = getProcessInfo(pid);
    results.push({ port, pid, process: processName, command, uptime });
  }

  return results;
}

function parseSsOutput(output: string, filterFn: (port: number) => boolean): PortProcess[] {
  // ss -tlnp output format:
  // State  Recv-Q  Send-Q  Local Address:Port  Peer Address:Port  Process
  // LISTEN 0       128     0.0.0.0:3000         0.0.0.0:*         users:(("node",pid=1234,fd=20))
  const lines = output.split("\n").slice(1); // skip header
  // Several processes can share one listening socket; ss lists every pid in a
  // single users:(...) column, so a listener is identified by port and pid.
  const seen = new Set<string>();
  const results: PortProcess[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 5) continue;

    const localAddr = parts[3];
    const portMatch = localAddr.match(/:(\d+)$/);
    if (!portMatch) continue;

    const port = parseInt(portMatch[1], 10);
    if (isNaN(port) || !filterFn(port)) continue;

    const userCol = parts.slice(5).join(" ");
    const nameMatch = userCol.match(/\("([^"]+)"/);
    const processName = nameMatch ? nameMatch[1] : "unknown";

    for (const pidMatch of userCol.matchAll(/pid=(\d+)/g)) {
      const pid = parseInt(pidMatch[1], 10);

      const key = `${port}:${pid}`;
      if (seen.has(key)) continue;

      seen.add(key);
      const { uptime, command } = getProcessInfo(pid);
      results.push({ port, pid, process: processName, command, uptime });
    }
  }

  return results;
}

export function scanPorts(options?: ScanOptions): PortProcess[] {
  const portRange = options?.portRange;
  const explicitPorts = options?.ports;

  function filterFn(port: number): boolean {
    if (explicitPorts && explicitPorts.length > 0) {
      return explicitPorts.includes(port);
    }
    if (portRange) {
      return port >= portRange[0] && port <= portRange[1];
    }
    return isDevPort(port);
  }

  const isLinux = process.platform === "linux";
  let results: PortProcess[] | null = null;

  if (!isLinux) {
    const lsofOutput = scanWithLsof();
    if (lsofOutput !== null) {
      results = parseLsofOutput(lsofOutput, filterFn);
    }
  }

  if (results === null) {
    // Fallback to ss on Linux or when lsof is unavailable
    const ssOutput = scanWithSs();
    if (ssOutput !== null) {
      results = parseSsOutput(ssOutput, filterFn);
    }
  }

  if (results === null) {
    // Last resort: try lsof even on Linux
    const lsofOutput = scanWithLsof();
    if (lsofOutput !== null) {
      results = parseLsofOutput(lsofOutput, filterFn);
    }
  }

  // The parsers keep every listener on a port; the scan table shows one row
  // per port, with the first listener found. The sort above is stable, so
  // this preserves the parser order within a port.
  const sorted = (results ?? []).sort((a, b) => a.port - b.port);
  const seenPorts = new Set<number>();
  const onePerPort: PortProcess[] = [];
  for (const entry of sorted) {
    if (seenPorts.has(entry.port)) continue;
    seenPorts.add(entry.port);
    onePerPort.push(entry);
  }
  return onePerPort;
}

function probeLsofPort(port: number): PortProcess[] | null {
  const filterFn = (p: number) => p === port;
  try {
    const output = execSync(`lsof -iTCP:${port} -sTCP:LISTEN -n -P`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: EXEC_TIMEOUT,
    });
    return parseLsofOutput(output, filterFn);
  } catch (err: unknown) {
    const error = err as { stdout?: string };
    if (typeof error.stdout === 'string') return parseLsofOutput(error.stdout, filterFn);
    return null;
  }
}

// Returns every process holding a listening socket on the port. A port can be
// shared (cluster workers, SO_REUSEPORT), and a kill only frees it when all of
// them are gone.
function findProcessesOnPort(port: number): PortProcess[] {
  const isLinux = process.platform === "linux";
  let results: PortProcess[] | null = null;
  const filterFn = (p: number) => p === port;

  if (!isLinux) {
    results = probeLsofPort(port);
  }

  if (results === null) {
    try {
      const output = execSync(`ss -tlnp sport = :${port}`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: EXEC_TIMEOUT,
      });
      results = parseSsOutput(output, filterFn);
    } catch {
      // ignore
    }
  }

  if (results === null) {
    results = probeLsofPort(port);
  }

  return results ?? [];
}

function sleepMs(ms: number): void {
  // Everything here is synchronous execSync-style work; block the thread
  // without spinning the CPU.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Waits out the grace period for the listener to close. Returns false when the
// port is still bound, which is the outcome the caller must report as a
// failed kill no matter that the signal was delivered.
function waitForPortFree(port: number): boolean {
  const deadline = Date.now() + KILL_GRACE_MS;
  for (;;) {
    if (findProcessesOnPort(port).length === 0) return true;
    if (Date.now() >= deadline) return false;
    sleepMs(Math.min(KILL_POLL_MS, deadline - Date.now()));
  }
}

export function killPorts(options: KillOptions): KillResult[] {
  const { ports, signal = "SIGTERM" } = options;

  // Resolve every port before signaling anything. One process often hosts
  // several of the requested ports, and probing a port after its process was
  // killed for an earlier port finds a dead process, which reads as a failed
  // kill even though the port is free.
  const portPids: Array<[number, number[]]> = ports.map((port) => [
    port,
    findProcessesOnPort(port).map((entry) => entry.pid),
  ]);

  // Signal each unique pid exactly once. A pid hosting several of the
  // requested ports must not be signaled again while it is already dying.
  const allPids = new Set<number>();
  for (const [, pids] of portPids) {
    for (const pid of pids) allPids.add(pid);
  }

  const signalErrors = new Map<number, string>();
  for (const pid of allPids) {
    try {
      process.kill(pid, signal);
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      // ESRCH means the process is already gone; whether that frees the
      // port is settled by the wait below. Anything else is a real failure.
      if (error.code !== "ESRCH") {
        signalErrors.set(pid, `pid ${pid}: ${error.message}`);
      }
    }
  }

  const results: KillResult[] = [];
  for (const [port, pids] of portPids) {
    if (pids.length === 0) {
      results.push({
        port,
        pid: -1,
        pids: [],
        success: false,
        error: `No process found listening on port ${port}`,
      });
      continue;
    }

    const errors = pids
      .map((pid) => signalErrors.get(pid))
      .filter((message): message is string => message !== undefined);
    if (errors.length > 0) {
      results.push({
        port,
        pid: pids[0],
        pids,
        success: false,
        error: errors.join("; "),
      });
      continue;
    }

    if (waitForPortFree(port)) {
      results.push({ port, pid: pids[0], pids, success: true });
    } else {
      const survivors = findProcessesOnPort(port).map((entry) => entry.pid);
      const noun = survivors.length === 1 ? "process" : "processes";
      results.push({
        port,
        pid: pids[0],
        pids,
        success: false,
        error: `${noun} ${survivors.join(", ")} still listening on port ${port} after ${signal}`,
      });
    }
  }

  return results;
}

// Exported for tests.
export const isDevPortForTest = isDevPort;
