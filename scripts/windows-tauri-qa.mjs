#!/usr/bin/env node

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { buildStorageSuite } from "./windows-tauri-storage-suite.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(
  root,
  "windows-tauri",
  "src-tauri",
  "Cargo.toml",
);
const executablePath = path.join(
  root,
  "windows-tauri",
  "src-tauri",
  "target",
  "debug",
  "letscube-windows-tauri.exe",
);
const cargoPath = path.join(os.homedir(), ".cargo", "bin", "cargo.exe");
const processImage = "letscube-windows-tauri.exe";
// The debug shell takes its own single-instance identity when this is set, so
// the installed client is no longer this launch's twin and no longer has to be
// closed first. Refusing to run while LETSCUBE was open stopped two releases.
const isolatedIdentityFlag = "LETSCUBE_TAURI_QA_ISOLATED_IDENTITY";
/// How long the engine is given to release the scenario's profile. See
/// `removeProfile`; the old three seconds failed most runs on this workstation.
const PROFILE_REMOVAL_TIMEOUT_MS = 45_000;
const lifecycleModes = Object.freeze([
  "success",
  "offline",
  "catalog_failure",
  "normal_update",
  "critical_update",
]);
const requestedMode = process.env.LETSCUBE_TAURI_QA_STARTUP_MODE;
const requestedSuite = process.env.LETSCUBE_TAURI_QA_SUITE || "standard";
const supportedSuites = Object.freeze(["standard", "long-session", "storage"]);

if (process.platform !== "win32") {
  console.error("Windows Tauri QA can run only on Windows.");
  process.exit(1);
}
if (!existsSync(cargoPath)) {
  console.error(
    "Rust/Cargo is not installed at the expected user toolchain path.",
  );
  process.exit(1);
}
if (requestedMode && !lifecycleModes.includes(requestedMode)) {
  console.error("LETSCUBE_TAURI_QA_STARTUP_MODE is invalid.");
  process.exit(1);
}
if (!supportedSuites.includes(requestedSuite)) {
  console.error("LETSCUBE_TAURI_QA_SUITE is invalid.");
  process.exit(1);
}
if (requestedSuite !== "standard" && requestedMode) {
  console.error(
    `A startup mode cannot be combined with the ${requestedSuite} suite.`,
  );
  process.exit(1);
}
if (runningIsolatedQaClient()) {
  console.error(
    `Close the running isolated QA client (${executablePath}) before starting another.`,
  );
  process.exit(1);
}

const build = spawnSync(cargoPath, ["build", "--manifest-path", manifestPath], {
  cwd: root,
  stdio: "inherit",
});
if (build.status !== 0 || !existsSync(executablePath)) {
  console.error("Tauri debug build failed.");
  process.exit(build.status ?? 1);
}

let activeScenario = null;
let signalHandled = false;

process.on("SIGINT", () => handleSignal(130));
process.on("SIGTERM", () => handleSignal(143));

const storageSuite = requestedSuite === "storage" ? buildStorageSuite(root) : null;

const scenarios = storageSuite
  ? storageSuite.scenarios
  : requestedSuite === "long-session"
    ? [
        {
          name: "long-session",
          mode: null,
          spec: "tests/e2e/windows-tauri-long-session.spec.ts",
        },
      ]
    : requestedMode
      ? [
          {
            name: requestedMode,
            mode: requestedMode,
            spec: "tests/e2e/windows-tauri-startup.spec.ts",
          },
        ]
      : [
          {
            name: "baseline",
            mode: null,
            spec: "tests/e2e/windows-tauri-shell.spec.ts",
          },
          ...lifecycleModes.map((mode) => ({
            name: mode,
            mode,
            spec: "tests/e2e/windows-tauri-startup.spec.ts",
          })),
        ];

try {
  for (const scenario of scenarios) {
    console.log(`\n[windows-tauri-qa] Running ${scenario.name}...`);
    if (scenario.prepare) scenario.prepare();
    const result = await runScenario(scenario);
    // Only the harness sees the tree between launches, so the observations that
    // need the application stopped are taken here rather than in a spec — and
    // taken even when the spec failed, because a spec that could not find a
    // signed-in window is exactly when the state of the tree is the evidence.
    let failures = [];
    if (scenario.verify) {
      failures = scenario.verify();
      for (const failure of failures) console.error(`  [FAIL] ${failure}`);
    }
    if (result !== 0 || failures.length > 0) {
      process.exitCode = result !== 0 ? result : 1;
      break;
    }
  }
} finally {
  if (storageSuite) await storageSuite.finish();
}

async function runScenario({ name, mode, spec, dataRoot, phase }) {
  const debugPort = await reserveLoopbackPort();
  // A suite that measures relocation owns the whole data root instead of one
  // pinned profile, and keeps it across its own launches.
  const profilePath = dataRoot
    ? null
    : mkdtempSync(path.join(os.tmpdir(), `letscube-tauri-qa-${name}-`));
  const scenario = {
    profilePath,
    qaProcess: null,
    client: null,
    cleanupPromise: null,
  };
  activeScenario = scenario;

  try {
    const outputPath = path.join(
      "output",
      "playwright-test",
      "windows-tauri-qa",
      name,
    );
    const cdpUrl = `http://127.0.0.1:${debugPort}`;
    const qaEnv = {
      ...process.env,
      LETSCUBE_TAURI_CDP_URL: cdpUrl,
    };
    const clientEnv = {
      ...process.env,
      LETSCUBE_WEBVIEW2_DEBUG_PORT: String(debugPort),
      LETSCUBE_TAURI_QA_HOLD_PREFLIGHT: "1",
      [isolatedIdentityFlag]: "1",
    };
    if (dataRoot) {
      // Pinning the profile would step straight over the relocation code, so
      // the root moves instead and the shell resolves its own way down to a
      // profile, exactly as it does on a user's machine.
      delete clientEnv.LETSCUBE_WEBVIEW2_DATA_DIR;
      clientEnv.LETSCUBE_APP_DATA_DIR = dataRoot;
      qaEnv.LETSCUBE_TAURI_QA_DATA_ROOT = dataRoot;
      qaEnv.LETSCUBE_TAURI_QA_STORAGE_PHASE = phase;
      qaEnv.LETSCUBE_TAURI_QA_STORAGE_TARGET = path.join(dataRoot, "relocated");
    } else {
      clientEnv.LETSCUBE_WEBVIEW2_DATA_DIR = profilePath;
      delete clientEnv.LETSCUBE_APP_DATA_DIR;
    }
    if (mode) {
      qaEnv.LETSCUBE_TAURI_QA_STARTUP_MODE = mode;
      clientEnv.LETSCUBE_TAURI_QA_STARTUP_MODE = mode;
    } else {
      delete qaEnv.LETSCUBE_TAURI_QA_STARTUP_MODE;
      delete clientEnv.LETSCUBE_TAURI_QA_STARTUP_MODE;
    }

    scenario.qaProcess = spawn(
      process.env.ComSpec || "cmd.exe",
      [
        "/d",
        "/s",
        "/c",
        "pnpm.cmd",
        "exec",
        "playwright",
        "test",
        spec,
        "--project",
        "chromium-desktop-1440",
        "--output",
        outputPath,
      ],
      { cwd: root, env: qaEnv, stdio: "inherit" },
    );
    scenario.client = spawn(executablePath, [], {
      cwd: root,
      env: clientEnv,
      stdio: "ignore",
    });
    scenario.client.once("error", (error) => {
      console.error(
        `Windows Tauri QA client failed to start: ${error.message}`,
      );
    });
    return await waitForExit(scenario.qaProcess);
  } finally {
    const clean = await cleanupOwnedResources(scenario);
    if (activeScenario === scenario) activeScenario = null;
    if (!clean) process.exitCode = 1;
  }
}

/// Whether another copy of *this* executable is already running.
///
/// It has to be this executable rather than this image name. The installed
/// client is also called `letscube-windows-tauri.exe` — `productName` names the
/// installer, the shortcut and the install directory, never the binary — so an
/// image-name check could not tell the two apart, and a `LETSCUBE.exe` entry
/// that had been added beside it to catch the installed client had in fact
/// never matched anything. What actually refused every run started while
/// LETSCUBE was open was the image name they share, and that stopped the 0.2.13
/// and 0.2.14 releases until someone closed the application by hand.
///
/// Now that the QA launch renames its own single-instance identity, the
/// installed client is no longer a conflict at all. A second isolated QA client
/// still is: it takes the same suffixed identity, and it holds the very file
/// cargo is about to relink.
///
/// A path is only obtainable per process, so this asks CIM rather than
/// `tasklist`. If that cannot be asked, the run continues: this check exists to
/// replace a confusing linker error with a clear sentence, not to be a gate of
/// its own.
function runningIsolatedQaClient() {
  const target = path.resolve(executablePath).toLowerCase();
  const script =
    `Get-CimInstance Win32_Process -Filter "Name='${processImage}'" |` +
    " ForEach-Object { $_.ExecutablePath }";
  for (const shell of ["pwsh.exe", "powershell.exe"]) {
    const result = spawnSync(
      shell,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf8" },
    );
    if (result.error || result.status !== 0) continue;
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .some((candidate) => path.resolve(candidate).toLowerCase() === target);
  }
  console.warn(
    "[windows-tauri-qa] Could not list running processes; a second QA client would surface as a link failure.",
  );
  return false;
}

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (port) resolve(port);
        else reject(new Error("Could not reserve a loopback port."));
      });
    });
  });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

function handleSignal(exitCode) {
  if (signalHandled) return;
  signalHandled = true;
  void cleanupOwnedResources(activeScenario).then((clean) =>
    process.exit(clean ? exitCode : 1),
  );
}

async function cleanupOwnedResources(scenario) {
  if (!scenario) return true;
  if (scenario.cleanupPromise) return scenario.cleanupPromise;

  scenario.cleanupPromise = (async () => {
    const { qaProcess, client, profilePath } = scenario;
    // Named, because "cleanup did not complete safely" on its own sent a reader
    // looking for a surviving process when what had actually happened was a
    // profile the engine had not finished letting go of.
    const unfinished = [];
    if (!(await terminateOwnedProcess(qaProcess)))
      unfinished.push(`the Playwright process (pid ${qaProcess?.pid}) is still running`);
    if (!(await terminateOwnedProcess(client)))
      unfinished.push(`the QA client (pid ${client?.pid}) is still running`);
    // A shared data root outlives its scenarios; its owner removes it.
    if (profilePath && !(await removeProfile(profilePath)))
      unfinished.push(`the temporary profile ${profilePath} could not be removed`);
    if (unfinished.length > 0) {
      console.error(
        `Windows Tauri QA cleanup did not complete safely: ${unfinished.join("; ")}.`,
      );
    }
    return unfinished.length === 0;
  })();
  return scenario.cleanupPromise;
}

async function terminateOwnedProcess(child) {
  if (!child?.pid || !isPidRunning(child.pid)) return true;
  spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
    stdio: "ignore",
  });
  await delay(500);
  return !isPidRunning(child.pid);
}

/// Removes the scenario's temporary profile once the engine has let go of it.
///
/// WebView2 outlives the shell it belongs to by a moment — its browser process
/// is not in the tree `taskkill /T` walks — and while it lives it holds files
/// inside the profile open. Four attempts over about three seconds were not
/// enough for it: measured on this workstation, two runs in three ended with
/// "cleanup did not complete safely" and every one of those profiles deleted by
/// hand a minute later. Nothing had leaked; the wait was simply too short. It
/// still set the exit code, so `windows:tauri:qa` reported failure after a suite
/// whose every scenario had passed — a gate failing for something that is not
/// the product, which is the fault this whole change is about.
///
/// Bounded rather than unbounded: a profile that is still there after the
/// deadline is a real leak and has to be said out loud, with the reason.
async function removeProfile(profilePath) {
  const deadline = Date.now() + PROFILE_REMOVAL_TIMEOUT_MS;
  let lastError = null;
  for (;;) {
    try {
      rmSync(profilePath, {
        recursive: true,
        force: true,
        maxRetries: 40,
        retryDelay: 250,
      });
    } catch (error) {
      lastError = error;
    }
    if (!existsSync(profilePath)) return true;
    if (Date.now() >= deadline) break;
    await delay(750);
  }
  console.error(
    `  [cleanup] ${profilePath} is still held: ${lastError?.code ?? lastError?.message ?? "unknown reason"}`,
  );
  return false;
}

function isPidRunning(pid) {
  const result = spawnSync(
    "tasklist.exe",
    ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
    {
      encoding: "utf8",
    },
  );
  if (result.status !== 0) return true;
  return result.stdout.includes(`"${pid}"`);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
