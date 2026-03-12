#!/usr/bin/env node

import { scanPorts, killPorts } from "./index.js";
import { PortProcess, KillResult } from "./types.js";

function padEnd(str: string, len: number): string {
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}

function printTable(ports: PortProcess[]): void {
  if (ports.length === 0) {
    console.log("No active development ports found.");
    return;
  }

  const headers = ["PORT", "PID", "PROCESS", "UPTIME"];
  const colWidths = [8, 8, 20, 16];

  const divider = colWidths.map((w) => "-".repeat(w)).join("  ");
  const header = headers.map((h, i) => padEnd(h, colWidths[i])).join("  ");

  console.log("\n" + header);
  console.log(divider);

  for (const entry of ports) {
    const row = [
      padEnd(String(entry.port), colWidths[0]),
      padEnd(String(entry.pid), colWidths[1]),
      padEnd(entry.process.slice(0, colWidths[2] - 1), colWidths[2]),
      padEnd(entry.uptime, colWidths[3]),
    ].join("  ");
    console.log(row);
  }

  console.log("");
}

function printKillResults(results: KillResult[]): void {
  for (const r of results) {
    if (r.success) {
      console.log(`Killed process ${r.pid} on port ${r.port}`);
    } else {
      console.error(`Failed to kill port ${r.port}: ${r.error}`);
    }
  }
}

function parseArgs(argv: string[]): {
  kill: number[];
  json: boolean;
  help: boolean;
} {
  const args = argv.slice(2);
  const result = { kill: [] as number[], json: false, help: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--json") {
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
    }
  }

  return result;
}

function printHelp(): void {
  console.log(`
portscan-dev - scan and manage active development ports

Usage:
  portscan-dev                     Scan and display all active dev ports
  portscan-dev --kill <port>       Kill process on <port>
  portscan-dev --kill <p1>,<p2>    Kill multiple ports
  portscan-dev --json              Output as JSON
  portscan-dev --help              Show this help

Examples:
  portscan-dev
  portscan-dev --kill 3000
  portscan-dev --kill 3000,8080
  portscan-dev --json
`);
}

function main(): void {
  const { kill, json, help } = parseArgs(process.argv);

  if (help) {
    printHelp();
    process.exit(0);
  }

  if (kill.length > 0) {
    const results = killPorts({ ports: kill });

    if (json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      printKillResults(results);
    }

    const anyFailed = results.some((r) => !r.success);
    process.exit(anyFailed ? 1 : 0);
  }

  const ports = scanPorts();

  if (json) {
    console.log(JSON.stringify(ports, null, 2));
  } else {
    printTable(ports);
  }
}

main();
