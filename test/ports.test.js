import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import { isDevPortForTest as isDevPort, killPorts, scanPorts } from "../dist/index.js";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForListener(port) {
  for (;;) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.createConnection({ port, host: "127.0.0.1" });
        socket.once("connect", () => {
          socket.destroy();
          resolve();
        });
        socket.once("error", reject);
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

test("the 3000-9999 dev range is covered", () => {
  assert.equal(isDevPort(3000), true);
  assert.equal(isDevPort(5173), true);
  assert.equal(isDevPort(9999), true);
  assert.equal(isDevPort(2999), false);
  assert.equal(isDevPort(10000), false);
});

test("invalid fractional ports are not classified as development ports", () => {
  assert.equal(isDevPort(3000.5), false);
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

test("CLI accepts every signal exposed by Node", () => {
  for (const signal of Object.keys(os.constants.signals)) {
    const result = spawnSync(process.execPath, ["dist/cli.js", "--signal", signal, "--kill", "0"], {
      encoding: "utf8",
    });

    assert.equal(result.status, 1, `${signal}: stdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.match(result.stderr, /Invalid port number\(s\): 0/);
    assert.doesNotMatch(result.stderr, /Unknown signal/);
  }
});

test("repeated kill options are rejected instead of dropping the first target", () => {
  const result = spawnSync(process.execPath, ["dist/cli.js", "--kill", "3000", "--kill", "4000"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 1, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.match(result.stderr, /--kill may only be provided once/);
});

test("port ranges are rejected with kill targets instead of being ignored", () => {
  const result = spawnSync(process.execPath, ["dist/cli.js", "--kill", "3000", "--port-range", "1-1"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 1, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.match(result.stderr, /--port-range cannot be used with --kill/);
});

test("kill rejects invalid port numbers before scanning", () => {
  for (const port of [0, 65536, 3000.5, NaN]) {
    assert.throws(
      () => killPorts({ ports: [port] }),
      {
        name: "RangeError",
        message: new RegExp(`Invalid port number: ${String(port).replace(".", "\\.")}`),
      }
    );
  }
});

test("kill rejects invalid signals before scanning", () => {
  assert.throws(
    () => killPorts({ ports: [3000], signal: "NOT_A_SIGNAL" }),
    { name: "RangeError", message: "Invalid signal: NOT_A_SIGNAL" }
  );
});

test("scan rejects invalid explicit port numbers", () => {
  for (const port of [0, 65536, 3000.5, NaN]) {
    assert.throws(
      () => scanPorts({ ports: [port] }),
      {
        name: "RangeError",
        message: new RegExp(`Invalid port number: ${String(port).replace(".", "\\.")}`),
      }
    );
  }
});

test("scan with an explicit empty port list returns no ports", () => {
  assert.deepEqual(scanPorts({ ports: [] }), []);
});

test("scan rejects explicit ports combined with a port range", () => {
  assert.throws(
    () => scanPorts({ ports: [3000], portRange: [3000, 4000] }),
    { name: "RangeError", message: "ports and portRange cannot be used together" }
  );
});

test("kill reports each duplicate port request once", async (t) => {
  let port;
  try {
    port = await freePort();
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("the test environment does not permit local listeners");
      return;
    }
    throw error;
  }
  const child = spawn(process.execPath, ["test/fixtures/plain-listener.mjs", String(port)], {
    stdio: "ignore",
  });

  try {
    await waitForListener(port);
    const results = killPorts({ ports: [port, port] });

    assert.deepEqual(results.map((result) => result.port), [port]);
    assert.equal(results[0].success, true, results[0].error);
  } finally {
    try {
      process.kill(child.pid, "SIGKILL");
    } catch {
      // The regression may have already stopped the owned child.
    }
  }
});

test("scan rejects invalid port range endpoints and ordering", () => {
  for (const range of [[0, 1], [1, 0], [65536, 65535], [65535, 65536]]) {
    assert.throws(
      () => scanPorts({ portRange: range }),
      { name: "RangeError" },
      `${range.join("-")} should be rejected`
    );
  }
});

test("scanning multiple ports queries process info in a single ps batch", async (t) => {
  let portA, portB;
  try {
    portA = await freePort();
    do {
      portB = await freePort();
    } while (portB === portA);
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("the test environment does not permit local listeners");
      return;
    }
    throw error;
  }

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

  const childA = spawn(
    process.execPath,
    ["test/fixtures/plain-listener.mjs", String(portA)],
    { stdio: "ignore" }
  );
  const childB = spawn(
    process.execPath,
    ["test/fixtures/plain-listener.mjs", String(portB)],
    { stdio: "ignore" }
  );

  const originalPath = process.env.PATH;
  try {
    await waitForListener(portA);
    await waitForListener(portB);

    process.env.PATH = `${tmpDir}:${originalPath}`;
    const results = scanPorts({ ports: [portA, portB] });

    const logged = fs.existsSync(logFile)
      ? fs.readFileSync(logFile, "utf8").trim().split("\n")
      : [];

    assert.equal(
      logged.length,
      1,
      `ps should be invoked once in a batch query, got: ${JSON.stringify(logged)}`
    );
    assert.match(logged[0], /-o pid=,etime=,args= -p /);
    assert.ok(
      logged[0].includes(String(childA.pid)),
      `ps invocation should include pid ${childA.pid}`
    );
    assert.ok(
      logged[0].includes(String(childB.pid)),
      `ps invocation should include pid ${childB.pid}`
    );

    assert.equal(results.length, 2);

    const entryA = results.find((r) => r.port === portA);
    const entryB = results.find((r) => r.port === portB);

    assert.ok(entryA, `expected port ${portA} in results`);
    assert.ok(entryB, `expected port ${portB} in results`);

    assert.equal(entryA.pid, childA.pid);
    assert.notEqual(entryA.command, "unknown");
    assert.notEqual(entryA.uptime, "unknown");

    assert.equal(entryB.pid, childB.pid);
    assert.notEqual(entryB.command, "unknown");
    assert.notEqual(entryB.uptime, "unknown");
  } finally {
    process.env.PATH = originalPath;
    if (childA?.pid) {
      try {
        process.kill(childA.pid, "SIGKILL");
      } catch {}
    }
    if (childB?.pid) {
      try {
        process.kill(childB.pid, "SIGKILL");
      } catch {}
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
