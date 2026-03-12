import { execSync } from "child_process";
import { PortProcess, KillOptions, KillResult } from "./types.js";

const DEV_PORT_RANGES: Array<[number, number]> = [[3000, 9999]];
const EXTRA_PORTS: number[] = [5432, 6379, 27017];

function isDevPort(port: number): boolean {
  if (EXTRA_PORTS.includes(port)) return true;
  return DEV_PORT_RANGES.some(([min, max]) => port >= min && port <= max);
}

function getProcessUptime(pid: number): string {
  try {
    const raw = execSync(`ps -o etime= -p ${pid} 2>/dev/null`, {
      encoding: "utf8",
    }).trim();
    return raw || "unknown";
  } catch {
    return "unknown";
  }
}

export function scanPorts(): PortProcess[] {
  let output: string;
  try {
    output = execSync("lsof -iTCP -sTCP:LISTEN -n -P", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err: unknown) {
    // lsof exits non-zero when no results on some systems; check if we got output
    const error = err as { stdout?: string; status?: number };
    if (error.stdout) {
      output = error.stdout;
    } else {
      return [];
    }
  }

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
    const name = parts[parts.length - 1]; // e.g. *:3000 or 127.0.0.1:3000

    if (isNaN(pid)) continue;

    const portMatch = name.match(/:(\d+)$/);
    if (!portMatch) continue;

    const port = parseInt(portMatch[1], 10);
    if (isNaN(port) || !isDevPort(port)) continue;
    if (seen.has(port)) continue;

    seen.add(port);
    results.push({
      port,
      pid,
      process: processName,
      uptime: getProcessUptime(pid),
    });
  }

  return results.sort((a, b) => a.port - b.port);
}

export function killPorts(options: KillOptions): KillResult[] {
  const { ports, signal = "SIGTERM" } = options;
  const active = scanPorts();
  const results: KillResult[] = [];

  for (const port of ports) {
    const entry = active.find((p) => p.port === port);

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
