import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("help links to the source repository", () => {
  const result = spawnSync(process.execPath, ["dist/cli.js", "--help"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /https:\/\/github\.com\/barissozudogru\/portscan-dev/);
});

test("signal requires a kill target instead of being ignored", () => {
  const result = spawnSync(process.execPath, ["dist/cli.js", "--signal", "SIGKILL"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(result.status, 1, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.match(result.stderr, /--signal requires --kill/);
});

test("repeated port ranges are rejected instead of silently replacing the first range", () => {
  const result = spawnSync(
    process.execPath,
    ["dist/cli.js", "--port-range", "1-1", "--port-range", "2-2", "--help"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    }
  );

  assert.equal(result.status, 1, `stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.match(result.stderr, /--port-range may only be provided once/);
});
