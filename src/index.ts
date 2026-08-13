import { execSync } from "child_process";
import { PortProcess, ScanOptions, KillOptions, KillResult } from "./types.js";

const EXEC_TIMEOUT = 5000;

const DEV_PORT_RANGES: Array<[number, number]> = [[3000, 9999]];
const EXTRA_PORTS: number[] = [5432, 6379, 27017];

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
    const error = err as { stdout?: string };
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
  const seen = new Set<number>();
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
    if (seen.has(port)) continue;

    seen.add(port);
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
  const seen = new Set<number>();
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
    if (seen.has(port)) continue;

    // Extract pid from users column: users:(("name",pid=1234,fd=20))
    let pid = -1;
    let processName = "unknown";
    const userCol = parts.slice(5).join(" ");
    const pidMatch = userCol.match(/pid=(\d+)/);
    const nameMatch = userCol.match(/\("([^"]+)"/);
    if (pidMatch) pid = parseInt(pidMatch[1], 10);
    if (nameMatch) processName = nameMatch[1];

    if (pid === -1) continue;

    seen.add(port);
    const { uptime, command } = getProcessInfo(pid);
    results.push({ port, pid, process: processName, command, uptime });
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

  return (results ?? []).sort((a, b) => a.port - b.port);
}

function findProcessOnPort(port: number): PortProcess | null {
  const isLinux = process.platform === "linux";
  let results: PortProcess[] | null = null;
  const filterFn = (p: number) => p === port;

  if (!isLinux) {
    try {
      const output = execSync(`lsof -iTCP:${port} -sTCP:LISTEN -n -P`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: EXEC_TIMEOUT,
      });
      results = parseLsofOutput(output, filterFn);
    } catch (err: unknown) {
      const error = err as { stdout?: string };
      if (typeof error.stdout === 'string') results = parseLsofOutput(error.stdout, filterFn);
    }
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
    try {
      const output = execSync(`lsof -iTCP:${port} -sTCP:LISTEN -n -P`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: EXEC_TIMEOUT,
      });
      results = parseLsofOutput(output, filterFn);
    } catch (err: unknown) {
      const error = err as { stdout?: string };
      if (typeof error.stdout === 'string') results = parseLsofOutput(error.stdout, filterFn);
    }
  }

  return results && results.length > 0 ? results[0] : null;
}

export function killPorts(options: KillOptions): KillResult[] {
  const { ports, signal = "SIGTERM" } = options;
  const results: KillResult[] = [];

  for (const port of ports) {
    const entry = findProcessOnPort(port);

    if (!entry) {
      results.push({
        port,
        pid: -1,
        success: false,
        error: `No process found listening on port ${port}`,
      });
      continue;
    }

    try {
      process.kill(entry.pid, signal);
      results.push({ port, pid: entry.pid, success: true });
    } catch (err: unknown) {
      const error = err as Error;
      results.push({
        port,
        pid: entry.pid,
        success: false,
        error: error.message,
      });
    }
  }

  return results;
}
