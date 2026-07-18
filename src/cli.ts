#!/usr/bin/env node

import { createRequire } from "module";
import { scanPorts, killPorts } from "./index.js";
import { PortProcess, KillResult, ScanOptions } from "./types.js";

// Load version from package.json without bundling issues
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

// TTY-aware color helpers
const isTTY = process.stdout.isTTY === true;

const colors = {
  reset: isTTY ? "\x1b[0m" : "",
  bold: isTTY ? "\x1b[1m" : "",
  dim: isTTY ? "\x1b[2m" : "",
  green: isTTY ? "\x1b[32m" : "",
  red: isTTY ? "\x1b[31m" : "",
  yellow: isTTY ? "\x1b[33m" : "",
  cyan: isTTY ? "\x1b[36m" : "",
};

function c(color: keyof typeof colors, text: string): string {
  return `${colors[color]}${text}${colors.reset}`;
}

function padEnd(str: string, len: number): string {
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}

function printTable(ports: PortProcess[]): void {
  if (ports.length === 0) {
    console.log("No active development ports found.");
    return;
  }

  const headers = ["PORT", "PID", "PROCESS", "UPTIME", "COMMAND"];
  const colWidths = [8, 8, 20, 16, 60];

  const divider = colWidths.map((w) => "-".repeat(w)).join("  ");
  const header = headers.map((h, i) => padEnd(h, colWidths[i])).join("  ");

  console.log("\n" + c("bold", header));
  console.log(c("dim", divider));

  for (const entry of ports) {
    const row = [
      c("cyan", padEnd(String(entry.port), colWidths[0])),
      padEnd(String(entry.pid), colWidths[1]),
      c("yellow", padEnd(entry.process.slice(0, colWidths[2] - 1), colWidths[2])),
      padEnd(entry.uptime, colWidths[3]),
      c("dim", entry.command.slice(0, colWidths[4] - 1)),
    ].join("  ");
    console.log(row);
  }

  console.log("");
}

function printKillResults(results: KillResult[]): void {
  for (const r of results) {
    if (r.success) {
      console.log(c("green", `Killed process ${r.pid} on port ${r.port}`));
    } else {
      console.error(c("red", `Failed to kill port ${r.port}: ${r.error}`));
    }
  }
}

interface ParsedArgs {
  kill: number[];
  json: boolean;
  help: boolean;
  version: boolean;
  signal: NodeJS.Signals;
  portRange: [number, number] | null;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const result: ParsedArgs = {
    kill: [],
    json: false,
    help: false,
    version: false,
    signal: "SIGTERM",
    portRange: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--version" || arg === "-v") {
      result.version = true;
    } else if (arg === "--json" || arg === "-j") {
      result.json = true;
    } else if (arg === "--kill" || arg === "-k") {
      const next = args[i + 1];
      if (!next || next.startsWith("-")) {
        console.error("--kill requires one or more port numbers, e.g. --kill 3000 or --kill 3000,4000");
        process.exit(1);
      }
      result.kill = next
        .split(",")
        .map((p) => parseInt(p.trim(), 10))
        .filter((p) => !isNaN(p));
      i++;
    } else if (arg === "--signal" || arg === "-s") {
      const next = args[i + 1];
      if (!next || next.startsWith("-")) {
        console.error("--signal requires a signal name, e.g. --signal SIGKILL");
        process.exit(1);
      }
      const VALID_SIGNALS: readonly string[] = [
        "SIGTERM", "SIGKILL", "SIGINT", "SIGHUP", "SIGQUIT",
        "SIGUSR1", "SIGUSR2", "SIGPIPE", "SIGALRM", "SIGCHLD",
        "SIGCONT", "SIGSTOP", "SIGTSTP", "SIGTTIN", "SIGTTOU",
        "SIGBUS", "SIGFPE", "SIGILL", "SIGSEGV", "SIGSYS",
        "SIGTRAP", "SIGURG", "SIGVTALRM", "SIGXCPU", "SIGXFSZ",
        "SIGWINCH",
      ];
      if (!VALID_SIGNALS.includes(next)) {
        console.error(`Unknown signal: ${next}. Valid signals: ${VALID_SIGNALS.join(", ")}`);
        process.exit(1);
      }
      result.signal = next as NodeJS.Signals;
      i++;
    } else if (arg === "--port-range") {
      const next = args[i + 1];
      if (!next || next.startsWith("-")) {
        console.error("--port-range requires a range, e.g. --port-range 3000-9000");
        process.exit(1);
      }
      const rangeMatch = next.match(/^(\d+)-(\d+)$/);
      if (!rangeMatch) {
        console.error(`Invalid port range: ${next}. Use format start-end, e.g. 3000-9000`);
        process.exit(1);
      }
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      if (start > end) {
        console.error(`Invalid port range: start (${start}) must be <= end (${end})`);
        process.exit(1);
      }
      result.portRange = [start, end];
      i++;
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
portscan-dev - scan and manage active development ports

Usage:
  portscan-dev                          Scan and display all active dev ports
  portscan-dev --kill <port>            Kill process on <port>
  portscan-dev --kill <p1>,<p2>         Kill multiple ports
  portscan-dev --kill <port> --signal <SIG>  Kill with specific signal
  portscan-dev --port-range <start-end> Filter ports to a specific range
  portscan-dev --json                   Output as JSON
  portscan-dev --version                Show version
  portscan-dev --help                   Show this help

Options:
  -k, --kill <ports>       Comma-separated list of ports to kill
  -s, --signal <signal>    Signal to send (default: SIGTERM)
      --port-range <range> Port range filter, e.g. 3000-9000
  -j, --json               Output as JSON
  -v, --version            Print version and exit
  -h, --help               Show this help

Examples:
  portscan-dev
  portscan-dev --kill 3000
  portscan-dev --kill 3000,8080
  portscan-dev --kill 3000 --signal SIGKILL
  portscan-dev --port-range 3000-5000
  portscan-dev --json
`);
}

function main(): void {
  const { kill, json, help, version, signal, portRange } = parseArgs(process.argv);

  if (version) {
    console.log(pkg.version);
    process.exit(0);
  }

  if (help) {
    printHelp();
    process.exit(0);
  }

  if (kill.length > 0) {
    const results = killPorts({ ports: kill, signal });

    if (json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      printKillResults(results);
    }

    const anyFailed = results.some((r) => !r.success);
    process.exit(anyFailed ? 1 : 0);
  }

  const scanOptions: ScanOptions = {};
  if (portRange) scanOptions.portRange = portRange;

  const ports = scanPorts(scanOptions);

  if (json) {
    console.log(JSON.stringify(ports, null, 2));
  } else {
    printTable(ports);
  }
}

main();
