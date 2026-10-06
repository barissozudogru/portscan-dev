import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { isDevPortForTest as isDevPort } from "../dist/index.js";

test("the 3000-9999 dev range is covered", () => {
  assert.equal(isDevPort(3000), true);
  assert.equal(isDevPort(5173), true);
  assert.equal(isDevPort(9999), true);
  assert.equal(isDevPort(2999), false);
  assert.equal(isDevPort(10000), false);
});

test("well-known service ports outside the range are covered", () => {
  for (const p of [1433, 1521, 2375, 2376, 5672, 11211, 11434, 15672, 27017]) {
    assert.equal(isDevPort(p), true, `port ${p} should be scanned`);
  }
});

test("ephemeral ports are still filtered out", () => {
  // These are the noise the dev-port filter exists to suppress.
  for (const p of [49152, 53963, 57621, 61000]) {
    assert.equal(isDevPort(p), false, `port ${p} should not be reported`);
  }
});

test("a missing scanner binary fails the scan instead of reporting zero ports", () => {
  // A PATH without lsof or ss reproduces a machine where the scanner binary
  // is not installed: the shell exits 127 with empty stdout, which must not
  // be read as an empty result set.
  const result = spawnSync(process.execPath, ["dist/cli.js"], {
    encoding: "utf8",
    env: { PATH: "/nonexistent-portscan-dev-test" },
  });

  assert.notEqual(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.match(result.stderr, /(?:command )?not found/);
});

test("port ranges reject every endpoint outside the TCP port range", () => {
  for (const range of ["0-1", "1-0", "65536-65535", "65535-65536", "0-65536"]) {
    const result = spawnSync(process.execPath, ["dist/cli.js", "--port-range", range], {
      encoding: "utf8",
    });

    assert.equal(result.status, 1, `${range}: stdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.match(result.stderr, /Ports must be between 1 and 65535/);
  }
});

test("unknown options are rejected instead of being ignored", () => {
  const result = spawnSync(process.execPath, ["dist/cli.js", "--version", "--unknown"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 1, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.match(result.stderr, /Unknown option: --unknown/);
});

test("scanning multiple ports queries process info in a single ps batch", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");
  const net = await import("node:net");
  const { spawn } = await import("node:child_process");

  const freePort = () =>
    new Promise((resolve, reject) => {
      const server = net.createServer();
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address();
        server.close(() => resolve(port));
      });
    });

  const waitForPort = (port, timeoutMs = 10000) =>
    new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const attempt = () => {
        const socket = net.connect({ port }, () => {
          socket.destroy();
          resolve();
        });
        socket.on("error", () => {
          if (Date.now() >= deadline) {
            reject(new Error(`timed out waiting for port ${port}`));
          } else {
            setTimeout(attempt, 50);
          }
        });
      };
      attempt();
    });

  const portA = await freePort();
  const portB = await freePort();
  const minPort = Math.min(portA, portB);
  const maxPort = Math.max(portA, portB);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "portscan-ps-"));
  const logFile = path.join(tmpDir, "ps.log");
  const psScript = path.join(tmpDir, "ps");
  const systemPs = fs.existsSync("/bin/ps") ? "/bin/ps" : "/usr/bin/ps";

  // Intercept ps executions to verify batching.
  fs.writeFileSync(
    psScript,
    `#!/bin/sh\necho "$@" >> "${logFile}"\nexec ${systemPs} "$@"\n`,
    { mode: 0o755 }
  );

  const child = spawn(
    process.execPath,
    ["test/fixtures/two-port-listener.mjs", String(portA), String(portB)],
    { stdio: "ignore" }
  );

  try {
    await waitForPort(portA);
    await waitForPort(portB);

    const result = spawnSync(
      process.execPath,
      ["dist/cli.js", "--port-range", `${minPort}-${maxPort}`, "--json"],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: `${tmpDir}:${process.env.PATH}` },
      }
    );

    assert.equal(result.status, 0, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);

    const logged = fs.existsSync(logFile)
      ? fs.readFileSync(logFile, "utf8").trim().split("\n")
      : [];

    assert.equal(
      logged.length,
      1,
      `ps should be invoked once in a batch query, got: ${JSON.stringify(logged)}`
    );
    assert.match(logged[0], /-o pid=,etime=,args= -p /);

    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.length, 2);
    for (const entry of parsed) {
      assert.equal(entry.pid, child.pid);
      assert.notEqual(entry.command, "unknown");
      assert.notEqual(entry.uptime, "unknown");
    }
  } finally {
    child.kill("SIGKILL");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

