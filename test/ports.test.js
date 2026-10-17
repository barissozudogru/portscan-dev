import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { isDevPortForTest as isDevPort, killPorts, scanPorts } from "../dist/index.js";

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

test("scan rejects invalid port range endpoints and ordering", () => {
  for (const range of [[0, 1], [1, 0], [65536, 65535], [65535, 65536]]) {
    assert.throws(
      () => scanPorts({ portRange: range }),
      { name: "RangeError" },
      `${range.join("-")} should be rejected`
    );
  }
});
