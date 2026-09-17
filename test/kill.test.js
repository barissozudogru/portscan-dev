import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, fork, execSync } from "node:child_process";
import net from "node:net";
import { killPorts } from "../dist/index.js";

// Every pid currently holding a listening socket on the port, queried the same
// way the tool itself does: lsof everywhere except Linux, ss on Linux with an
// lsof fallback.
function listenerPids(port) {
  const lsof = () => {
    try {
      const out = execSync(`lsof -iTCP:${port} -sTCP:LISTEN -n -P -Fp`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return out
        .split("\n")
        .filter((line) => line.startsWith("p"))
        .map((line) => parseInt(line.slice(1), 10));
    } catch {
      return null;
    }
  };
  const ss = () => {
    try {
      const out = execSync(`ss -tlnp sport = :${port}`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return [...out.matchAll(/pid=(\d+)/g)].map((m) => parseInt(m[1], 10));
    } catch {
      return null;
    }
  };

  const probes = process.platform === "linux" ? [ss, lsof] : [lsof, ss];
  for (const probe of probes) {
    const pids = probe();
    if (pids !== null) return [...new Set(pids)];
  }
  return [];
}

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

async function waitFor(probe, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error("condition was not met before the timeout");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function killAll(pids) {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

test("a process that ignores SIGTERM is reported as a failed kill", async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ["test/fixtures/sigterm-trapper.mjs", String(port)], {
    stdio: "ignore",
  });

  try {
    await waitFor(() => listenerPids(port).includes(child.pid));

    const [result] = killPorts({ ports: [port] });

    assert.equal(result.success, false);
    assert.equal(result.pid, child.pid);
    assert.deepEqual(result.pids, [child.pid]);
    assert.match(result.error, /process \d+ still listening on port \d+ after SIGTERM/);
    assert.ok(
      listenerPids(port).includes(child.pid),
      "the trapper survived the signal, so the port must still be busy"
    );
  } finally {
    killAll([child.pid]);
  }
});

test("the CLI exits 1 when the process survives the signal", async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ["test/fixtures/sigterm-trapper.mjs", String(port)], {
    stdio: "ignore",
  });

  try {
    await waitFor(() => listenerPids(port).includes(child.pid));

    const cli = spawnSync(process.execPath, ["dist/cli.js", "--kill", String(port)], {
      encoding: "utf8",
    });

    assert.equal(cli.status, 1, `stdout: ${cli.stdout}\nstderr: ${cli.stderr}`);
    assert.match(cli.stderr, /Failed to kill port \d+: process \d+ still listening/);
  } finally {
    killAll([child.pid]);
  }
});

test("every process sharing a port is signaled before success is reported", async () => {
  const port = await freePort();
  const primary = fork("test/fixtures/shared-port-cluster.mjs", [String(port)], {
    stdio: "ignore",
  });

  try {
    const holders = await waitFor(() => {
      const pids = listenerPids(port);
      return pids.length >= 3 ? pids : false;
    });

    const [result] = killPorts({ ports: [port] });

    assert.equal(result.success, true, result.error);
    assert.deepEqual(listenerPids(port), [], "the port must be free when the kill reports success");
    assert.ok(
      result.pids.length >= 3,
      `all holders must be signaled, got ${JSON.stringify(result.pids)}`
    );
    for (const pid of holders) {
      assert.ok(result.pids.includes(pid), `holder ${pid} was not signaled`);
    }
  } finally {
    killAll([primary.pid, ...listenerPids(port)]);
  }
});

test("a cooperative process is killed and frees the port", async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ["test/fixtures/plain-listener.mjs", String(port)], {
    stdio: "ignore",
  });

  try {
    await waitFor(() => listenerPids(port).includes(child.pid));

    const [result] = killPorts({ ports: [port] });

    assert.equal(result.success, true, result.error);
    assert.deepEqual(listenerPids(port), []);
    assert.deepEqual(result.pids, [child.pid]);
  } finally {
    killAll([child.pid]);
  }
});

test("every port hosted by the same process reports a successful kill", async () => {
  const portA = await freePort();
  const portB = await freePort();
  const child = spawn(
    process.execPath,
    ["test/fixtures/two-port-listener.mjs", String(portA), String(portB)],
    { stdio: "ignore" }
  );

  try {
    await waitFor(() => listenerPids(portA).includes(child.pid));
    await waitFor(() => listenerPids(portB).includes(child.pid));

    const results = killPorts({ ports: [portA, portB] });

    assert.deepEqual(results.map((result) => result.port), [portA, portB]);
    for (const result of results) {
      assert.equal(result.success, true, result.error);
      assert.equal(result.pid, child.pid);
      assert.deepEqual(result.pids, [child.pid]);
    }
    assert.deepEqual(listenerPids(portA), [], "the first port must be free");
    assert.deepEqual(listenerPids(portB), [], "the second port must be free");
  } finally {
    killAll([child.pid]);
  }
});

test("the CLI exits 0 when one process hosts all the killed ports", async () => {
  const portA = await freePort();
  const portB = await freePort();
  const child = spawn(
    process.execPath,
    ["test/fixtures/two-port-listener.mjs", String(portA), String(portB)],
    { stdio: "ignore" }
  );

  try {
    await waitFor(() => listenerPids(portA).includes(child.pid));
    await waitFor(() => listenerPids(portB).includes(child.pid));

    const cli = spawnSync(process.execPath, ["dist/cli.js", "--kill", `${portA},${portB}`], {
      encoding: "utf8",
    });

    assert.equal(cli.status, 0, `stdout: ${cli.stdout}\nstderr: ${cli.stderr}`);
    assert.match(cli.stdout, new RegExp(`Killed process ${child.pid} on port ${portA}`));
    assert.match(cli.stdout, new RegExp(`Killed process ${child.pid} on port ${portB}`));
  } finally {
    killAll([child.pid]);
  }
});

test("killing a port with no listener reports failure", async () => {
  const port = await freePort();

  const [result] = killPorts({ ports: [port] });

  assert.equal(result.success, false);
  assert.equal(result.pid, -1);
  assert.deepEqual(result.pids, []);
  assert.match(result.error, /No process found listening on port \d+/);
});
