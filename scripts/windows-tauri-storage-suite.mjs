// The storage suite: six launches of the real application over one data root.
//
// The shipped feature can move the directory holding a person's signed-in
// session, and until this suite existed nothing had ever watched it do so. Each
// phase launches the client for real, and the checks that need the application
// stopped are taken here, between launches, because that is the only moment the
// tree is not being written to.
//
// Nothing in here may point at a real profile. The root is a fresh temporary
// directory, the client is told to use it through the debug-only
// `LETSCUBE_APP_DATA_DIR` seam, and the user's own AppData is inventoried before
// the first launch and re-checked after every one.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CACHE_SUBDIRECTORIES,
  PROFILE_DIRECTORY,
  SESSION_SUBDIRECTORIES,
  SETTINGS_FILE,
  added,
  arrival,
  cacheSubset,
  directories,
  inventory,
  localStorageHoldsOnDisk,
  makeUncreatableTarget,
  missingOrChanged,
  plantCacheBytes,
  plantDecoy,
  readCacheSubdirectoriesFromRust,
  readSettings,
  sessionSubset,
  totalBytes,
  waitUntilReleased,
  writeSettings,
} from "./windows-tauri-storage.mjs";

const SPEC = "tests/e2e/windows-tauri-storage.spec.ts";
const OVER_BUDGET_BYTES = 150 * 1024 * 1024; // above the 128 MiB floor limit.
/// The localStorage key the spec writes; the harness looks for it on disk.
const SESSION_WITNESS = "__letscubeStorageQaMarker";
/// Files WebView2 owns the lifetime of: `EBWebView/lockfile` is its own
/// single-instance lock, removed when it exits and remade when it starts.
const ENGINE_TRANSIENTS = /(^|\/)(lockfile|[^/]+\.tmp)$/;

export function buildStorageSuite(repoRoot) {
  const listInRust = readCacheSubdirectoriesFromRust(repoRoot);
  if (listInRust.join("\n") !== CACHE_SUBDIRECTORIES.join("\n")) {
    fail(
      "CACHE_SUBDIRECTORIES in storage.rs no longer matches the harness copy:\n" +
        `  rust:    ${listInRust.join(", ")}\n` +
        `  harness: ${CACHE_SUBDIRECTORIES.join(", ")}`,
    );
  }

  const credentials = path.join(os.homedir(), ".kub-messenger-qa.env");
  if (!process.env.KUB_QA_EMAIL && !existsSync(credentials)) {
    fail(
      "The storage suite must sign in to prove a session survives a move, and " +
        `no QA credentials were found at ${credentials}.`,
    );
  }

  const userAppData = realAppDataDirectory();
  const dataRoot = mkdtempSync(path.join(os.tmpdir(), "letscube-tauri-qa-storage-"));
  guardRoot(dataRoot, userAppData);

  const userAppDataBefore = userAppData ? inventory(userAppData, { hash: false }) : new Map();
  const defaultProfile = path.join(dataRoot, PROFILE_DIRECTORY);
  const relocationParent = path.join(dataRoot, "relocated");
  const relocatedProfile = path.join(relocationParent, PROFILE_DIRECTORY);

  const ledger = {
    dataRoot,
    defaultProfile,
    relocatedProfile,
    sourceInventory: null,
    sessionBefore: null,
    planted: null,
    decoy: null,
    blockedTarget: null,
    notes: [],
    // Findings this suite reproduces on purpose. They are shipped behaviour,
    // so they are reported loudly rather than failing the run; when one is
    // fixed, move it back into `problems` so a regression fails again.
    defects: [],
  };

  const orphanInventory = () => inventory(ledger.orphanTarget);

  /// Where the shell will look for the profile on the next launch.
  const currentProfile = () => readSettings(dataRoot)?.location ?? defaultProfile;

  /// Whether the tree is free of every handle the last client held.
  ///
  /// The whole root rather than the current profile: a phase moves the profile,
  /// so the directory a straggler is holding is not always the one the settings
  /// now name. Returns the complaint, or `null` when nothing holds it.
  const stillHeld = () =>
    waitUntilReleased(dataRoot)
      ? null
      : `something still holds a file under ${dataRoot} after 30s; anything measured now would be the harness rather than the product`;

  /// Every phase begins by waiting out the previous client's stragglers. A
  /// launch that starts while they still hold the profile cannot open it, and
  /// the relocation it would perform cannot delete the original — which reads
  /// as a product failure and is not one.
  const settleFilesystem = () => {
    const held = stillHeld();
    if (held) fail(`A launch now would measure the harness, not the product: ${held}.`);
  };

  const untouched = () => {
    if (!userAppData) return [];
    const now = inventory(userAppData, { hash: false });
    const changed = missingOrChanged(userAppDataBefore, now);
    const fresh = added(userAppDataBefore, now);
    const problems = [];
    if (changed.length > 0)
      problems.push(`the user's own profile lost or changed files: ${changed.slice(0, 5).join(", ")}`);
    if (fresh.length > 0)
      problems.push(`the user's own profile gained files: ${fresh.slice(0, 5).join(", ")}`);
    return problems;
  };

  const scenarios = [
    {
      name: "storage-record",
      phase: "record",
      spec: SPEC,
      mode: null,
      dataRoot,
      verify: () => {
        const problems = untouched();
        // The seam has to have been honoured, or every later phase would be
        // recording a relocation of the user's real profile.
        if (!existsSync(defaultProfile)) {
          problems.push(
            `the client did not build its profile under the isolated root (${defaultProfile} is missing) — LETSCUBE_APP_DATA_DIR was not honoured`,
          );
          return problems;
        }
        const settings = readSettings(dataRoot);
        if (!settings) problems.push(`${SETTINGS_FILE} was not written under the isolated root`);
        else {
          if (settings.pending_location !== relocatedProfile)
            problems.push(
              `pending_location is ${settings.pending_location}, expected ${relocatedProfile}`,
            );
          if (settings.location != null)
            problems.push(`location moved while a window was open: ${settings.location}`);
        }
        // `validate_location` creates and write-probes the chosen directory, so
        // it exists from the moment it is picked. What must not have happened is
        // any of the profile arriving in it while a window still held the source.
        const staged = inventory(relocatedProfile);
        if (staged.size > 0)
          problems.push(
            `${staged.size} file(s) were copied to the target while the window was still open`,
          );

        ledger.sourceInventory = inventory(defaultProfile);
        ledger.sessionBefore = sessionSubset(ledger.sourceInventory);
        if (ledger.sessionBefore.size === 0)
          problems.push(
            "no session files were found in the profile, so a move cannot be shown to preserve one",
          );
        // Without this, a profile whose localStorage never reached disk before
        // the process was killed is indistinguishable from a relocation that
        // lost the session — and the wrong one of those is a shipped defect.
        const sessionOnDisk = localStorageHoldsOnDisk(defaultProfile, SESSION_WITNESS);
        if (!sessionOnDisk) {
          problems.push(
            "the session was never committed to disk before the client stopped, so the next phase cannot tell a lost session from an unflushed one",
          );
        }

        ledger.notes.push(
          `source profile: ${ledger.sourceInventory.size} files, ${mib(totalBytes(ledger.sourceInventory))}, of which ${ledger.sessionBefore.size} session files, ` +
            (sessionOnDisk
              ? "with the session committed to disk"
              : "and the session was NOT committed to disk"),
        );
        ledger.notes.push(...auditCacheList(defaultProfile));
        return problems;
      },
    },
    {
      name: "storage-settle",
      phase: "settle",
      spec: SPEC,
      mode: null,
      dataRoot,
      prepare: settleFilesystem,
      verify: () => {
        const problems = untouched();
        const originalRemoved = !existsSync(defaultProfile);
        if (!originalRemoved)
          problems.push("the original profile still exists after a verified move");
        if (!existsSync(relocatedProfile)) {
          problems.push("the profile was not moved to the recorded location");
          return problems;
        }
        // The move and the launch that follows it happen in one run of the
        // client, so the tree can only be seen once the application has already
        // used it. Every path the source had must be there; the bytes of the
        // ones the engine writes to are its own business by now.
        const after = inventory(relocatedProfile);
        // Two kinds of file are excluded, and only these two. Cache entries,
        // because the engine evicts and rewrites them the moment it starts; and
        // its own lock and scratch files, which it deletes on the way out. Their
        // absence afterwards says nothing about the copy. Everything else — the
        // session included — must be there.
        const owed = [...ledger.sourceInventory.keys()].filter(
          (key) =>
            !CACHE_SUBDIRECTORIES.some((prefix) => key.startsWith(`${prefix}/`)) &&
            !ENGINE_TRANSIENTS.test(key),
        );
        const carried = arrival(owed, after);
        if (!carried.complete)
          problems.push(`the move did not carry every non-cache file: ${carried.summary}`);
        const sessionCarried = localStorageHoldsOnDisk(relocatedProfile, SESSION_WITNESS);
        if (!sessionCarried)
          problems.push(
            "the relocated profile's Local Storage no longer holds the session written before the move",
          );
        const settings = readSettings(dataRoot);
        if (settings?.location !== relocatedProfile)
          problems.push(`settings.location is ${settings?.location}, expected ${relocatedProfile}`);
        if (settings?.pending_location != null)
          problems.push(`pending_location was not cleared: ${settings?.pending_location}`);

        const rewritten = missingOrChanged(ledger.sourceInventory, after).length;
        ledger.notes.push(
          `moved ${ledger.sourceInventory.size} files (${mib(totalBytes(ledger.sourceInventory))}); ` +
            `${carried.summary}, the session ${sessionCarried ? "with them" : "NOT among them"}, ` +
            `and the original was ${originalRemoved ? "removed" : "LEFT BEHIND"}; ` +
            `${rewritten} files differ afterwards because the engine started on top of them`,
        );
        ledger.sessionBefore = sessionSubset(after);
        return problems;
      },
    },
    {
      name: "storage-blocked",
      phase: "blocked",
      spec: SPEC,
      mode: null,
      dataRoot,
      prepare: () => {
        settleFilesystem();
        ledger.blockedTarget = makeUncreatableTarget(dataRoot);
        const settings = readSettings(dataRoot) ?? {};
        writeSettings(dataRoot, { ...settings, pending_location: ledger.blockedTarget });
        // Small enough that the launch-time budget check leaves it alone: this
        // phase is about the runtime clear, which runs while the engine holds
        // part of the cache open.
        ledger.here = currentProfile();
        ledger.planted = plantCacheBytes(ledger.here, 4096);
        ledger.decoy = plantDecoy(ledger.here);
        ledger.sessionBefore = sessionSubset(inventory(ledger.here));
      },
      verify: () => {
        const problems = untouched();
        if (!existsSync(ledger.here)) {
          problems.push("a failed relocation destroyed the original profile");
          return problems;
        }
        if (existsSync(ledger.blockedTarget))
          problems.push(`the impossible target was created after all: ${ledger.blockedTarget}`);

        // Files, not bytes: leveldb rewrites its own write-ahead and text logs
        // continuously while the engine runs, so comparing the bytes of a live
        // session directory measures Chromium's housekeeping rather than this
        // feature. What must never happen is a session file going missing.
        const after = inventory(ledger.here);
        const sessionLost = missingFrom(ledger.sessionBefore, sessionSubset(after));
        if (sessionLost.length > 0)
          problems.push(
            `a failed relocation and a runtime cache clear cost ${sessionLost.length} session file(s): ${sessionLost.slice(0, 5).join(", ")}`,
          );
        const decoyKept = after.has(ledger.decoy);
        if (!decoyKept)
          problems.push(`clear_cache removed a file outside CACHE_SUBDIRECTORIES: ${ledger.decoy}`);

        const settings = readSettings(dataRoot);
        if (settings?.location !== ledger.here)
          problems.push(
            `a failed relocation changed the recorded location to ${settings?.location}`,
          );
        if (settings?.pending_location != null)
          problems.push(
            `a failed relocation left pending_location set (${settings?.pending_location}), so it would be retried on every launch`,
          );

        const survivors = [...ledger.planted.keys()].filter((key) => after.has(key));
        ledger.notes.push(
          `runtime clear_cache: ${ledger.planted.size - survivors.length}/${ledger.planted.size} planted cache markers removed while the engine held the profile open; ` +
            `${ledger.sessionBefore.size - sessionLost.length} of ${ledger.sessionBefore.size} session files survived; ` +
            `the decoy outside the cache list was ${decoyKept ? "kept" : "REMOVED"}`,
        );
        return problems;
      },
    },
    {
      name: "storage-cache",
      phase: "cache",
      spec: SPEC,
      mode: null,
      dataRoot,
      prepare: () => {
        settleFilesystem();
        ledger.here = currentProfile();
        ledger.planted = plantCacheBytes(ledger.here, OVER_BUDGET_BYTES);
        ledger.decoy = plantDecoy(ledger.here);
        const before = inventory(ledger.here);
        ledger.sessionBefore = sessionSubset(before);
        ledger.cacheBefore = totalBytes(cacheSubset(before));
      },
      verify: () => {
        const problems = untouched();
        const after = inventory(ledger.here);
        const survivors = [...ledger.planted.keys()].filter((key) => after.has(key));
        if (survivors.length > 0)
          problems.push(
            `the launch-time budget check left ${survivors.length} planted cache file(s) in place: ${survivors.slice(0, 5).join(", ")}`,
          );
        const decoyKept = after.has(ledger.decoy);
        if (!decoyKept)
          problems.push(
            `the launch-time cache clear reached outside CACHE_SUBDIRECTORIES: ${ledger.decoy}`,
          );
        const sessionLost = missingFrom(ledger.sessionBefore, sessionSubset(after));
        if (sessionLost.length > 0)
          problems.push(
            `the launch-time cache clear cost ${sessionLost.length} session file(s): ${sessionLost.slice(0, 5).join(", ")}`,
          );
        ledger.notes.push(
          `launch-time budget: ${mib(ledger.cacheBefore)} of cache against a ${mib(readSettings(dataRoot)?.cache_limit_bytes ?? 0)} limit reduced to ${mib(totalBytes(cacheSubset(after)))}; ` +
            `${ledger.planted.size - survivors.length} of ${ledger.planted.size} planted files gone, ` +
            `the decoy beside them ${decoyKept ? "kept" : "REMOVED"}, ` +
            `${ledger.sessionBefore.size - sessionLost.length} of ${ledger.sessionBefore.size} session files still there`,
        );
        return problems;
      },
    },
    {
      name: "storage-again",
      phase: "again",
      spec: SPEC,
      mode: null,
      dataRoot,
      prepare: () => {
        settleFilesystem();
        // A second relocation, from a profile that is already somewhere the
        // person chose. The first move starts from a directory the installer
        // made; this one starts from one the feature made, and it is the move a
        // person actually repeats when they change their mind about a drive.
        ledger.here = currentProfile();
        ledger.againTarget = path.join(dataRoot, "again", PROFILE_DIRECTORY);
        ledger.beforeAgain = inventory(ledger.here);
        const settings = readSettings(dataRoot) ?? {};
        writeSettings(dataRoot, { ...settings, pending_location: ledger.againTarget });
      },
      verify: () => {
        const problems = untouched();
        const settings = readSettings(dataRoot);
        const destination = inventory(ledger.againTarget);
        const owed = [...ledger.beforeAgain.keys()].filter(
          (key) =>
            !CACHE_SUBDIRECTORIES.some((prefix) => key.startsWith(`${prefix}/`)) &&
            !ENGINE_TRANSIENTS.test(key),
        );
        const carried = arrival(owed, destination);
        if (!carried.complete)
          problems.push(`the second move did not carry every non-cache file: ${carried.summary}`);
        if (settings?.location !== ledger.againTarget)
          problems.push(
            `after a second move the recorded location is ${settings?.location}, expected ${ledger.againTarget}`,
          );
        if (settings?.pending_location != null)
          problems.push(`pending_location was not cleared: ${settings?.pending_location}`);
        const sessionCarried = localStorageHoldsOnDisk(ledger.againTarget, SESSION_WITNESS);
        if (!sessionCarried) problems.push("the second move did not carry the session");
        ledger.notes.push(
          `second relocation, from a chosen location to another: ${carried.summary}, ` +
            `the session ${sessionCarried ? "with them" : "NOT among them"}`,
        );
        return problems;
      },
    },
    {
      name: "storage-orphan",
      phase: "orphan",
      spec: SPEC,
      mode: null,
      dataRoot,
      prepare: () => {
        settleFilesystem();
        // The one path that costs a user their session outright: the copy
        // succeeds, and the record of where the profile now lives does not.
        ledger.orphanTarget = path.join(dataRoot, "orphan", PROFILE_DIRECTORY);
        const settings = readSettings(dataRoot) ?? {};
        writeSettings(dataRoot, { ...settings, pending_location: ledger.orphanTarget });
        ledger.here = currentProfile();
        ledger.beforeOrphan = inventory(ledger.here);
        ledger.sessionBefore = sessionSubset(ledger.beforeOrphan);
        makeReadOnly(path.join(dataRoot, SETTINGS_FILE));
      },
      verify: () => {
        const problems = untouched();
        makeWritable(path.join(dataRoot, SETTINGS_FILE));
        const settings = readSettings(dataRoot);
        // Not `!existsSync(here)`: WebView2 recreates a missing profile
        // directory on the spot, so the original path exists again either way.
        // What separates the two outcomes is where the person's files ended up
        // and which of the two places the shell recorded.
        const arrived = [...ledger.beforeOrphan.keys()].filter((key) =>
          orphanInventory().has(key),
        ).length;
        const copied = arrived === ledger.beforeOrphan.size && ledger.beforeOrphan.size > 0;
        const recorded = settings?.location === ledger.orphanTarget;
        // Arrival at the target is NOT what separates the two outcomes, because
        // the relocation copies before it records: after a refused record the
        // target holds a complete duplicate in either case. What separates them
        // is whether the original was then destroyed.
        //
        // The witness is the session itself, read off the disk. A missing
        // directory proves nothing — WebView2 recreates one on the spot — and
        // neither does a count of session paths: measured against the real
        // defect, the recreated profile came back with 22 of the 23 names it
        // had before, so a check resting on which paths exist had a margin of
        // one file. The value written into Local Storage before the phase began
        // cannot be regenerated by a fresh profile, so it separates a kept
        // original from a recreated one outright.
        const sessionKept = localStorageHoldsOnDisk(ledger.here, SESSION_WITNESS);
        const sessionLost = missingFrom(ledger.sessionBefore, inventory(ledger.here));
        if (recorded) {
          ledger.notes.push(
            "the settings write survived a read-only settings file, so the move completed (no orphan)",
          );
        } else if (!sessionKept) {
          ledger.defects.push(
            "a relocation whose settings write fails signs the person out and orphans their profile: " +
              `${arrived} of ${ledger.beforeOrphan.size} files were moved to ${ledger.orphanTarget}, the settings file could not be updated ` +
              `so it still names ${settings?.location}, and the shell started from that path — which WebView2 ` +
              `recreated empty — the session written before the phase is no longer on disk there, and ` +
              `${sessionLost.length} of ${ledger.sessionBefore.size} session files are gone. ` +
              "The data is intact but unreachable, and the session is gone.",
          );
        } else {
          ledger.notes.push(
            `an unwritable settings file abandoned the move rather than completing it: ${arrived} of ${ledger.beforeOrphan.size} files reached the target as a duplicate, ` +
              `the settings still name ${settings?.location}, and ${ledger.sessionBefore.size - sessionLost.length} of ${ledger.sessionBefore.size} session files stayed there with the session on disk` +
              (copied ? "" : " (the copy did not finish either)"),
          );
        }
        return problems;
      },
    },
  ];

  return {
    // Wrapped here rather than at each call site so a phase added later cannot
    // forget it. `prepare` has always waited for the last client to let go;
    // `verify` never did, and ran 500ms after a `taskkill` whether or not the
    // engine had finished dying. That asymmetry is the whole reason one phase
    // could count a file and the next report it as one a move had lost.
    scenarios: scenarios.map((scenario) => ({
      ...scenario,
      verify: scenario.verify
        ? () => {
            const held = stillHeld();
            return held ? [held] : scenario.verify();
          }
        : undefined,
    })),
    async finish() {
      console.log("\n[windows-tauri-qa] storage measurements");
      for (const note of ledger.notes) console.log(`  - ${note}`);
      for (const defect of ledger.defects) console.log(`\n  [KNOWN DEFECT] ${defect}\n`);
      makeWritable(path.join(dataRoot, SETTINGS_FILE));
      const leftovers = untouched();
      for (const leftover of leftovers) console.error(`  [FAIL] ${leftover}`);
      if (leftovers.length > 0) process.exitCode = 1;
      if (process.env.LETSCUBE_TAURI_QA_KEEP_ROOT === "1") {
        console.log(`  - isolated root kept for inspection: ${dataRoot}`);
        return;
      }
      // A just-killed WebView2 child keeps a handle on the profile for a
      // while after its parent is gone, so this waits it out rather than
      // reporting a leak that is only a few seconds old.
      for (let attempt = 0; attempt < 12; attempt += 1) {
        try {
          rmSync(dataRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
        } catch {
          // Tried again below.
        }
        if (!existsSync(dataRoot)) {
          console.log(`  - isolated root removed: ${dataRoot}`);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      console.error(`  - isolated root could not be removed: ${dataRoot}`);
      process.exitCode = 1;
    },
  };
}

/// Paths in `before` that `after` no longer has at all.
function missingFrom(before, after) {
  return [...before.keys()].filter((key) => !after.has(key));
}

/// Which of the nine the real profile actually has, and what it has instead.
function auditCacheList(profile) {
  const present = directories(profile).map((entry) => entry.replaceAll("\\", "/"));
  const known = new Set(present);
  const matched = CACHE_SUBDIRECTORIES.filter((entry) => known.has(entry));
  const absent = CACHE_SUBDIRECTORIES.filter((entry) => !known.has(entry));
  const sessionPresent = SESSION_SUBDIRECTORIES.filter((entry) => known.has(entry));
  const overlap = CACHE_SUBDIRECTORIES.filter((cache) =>
    SESSION_SUBDIRECTORIES.some(
      (session) => cache === session || cache.startsWith(`${session}/`),
    ),
  );
  // Only the outermost uncovered cache directory is worth naming; its children
  // are the same bytes counted twice.
  const unlisted = present.filter(
    (entry) =>
      /cache/i.test(entry) &&
      !CACHE_SUBDIRECTORIES.some((known2) => entry === known2 || entry.startsWith(`${known2}/`)),
  );
  const roots = unlisted.filter(
    (entry) => !unlisted.some((other) => other !== entry && entry.startsWith(`${other}/`)),
  );
  const all = inventory(profile);
  const measure = (prefix) =>
    totalBytes(
      new Map([...all].filter(([key]) => key === prefix || key.startsWith(`${prefix}/`))),
    );
  return [
    `cache list: ${matched.length}/${CACHE_SUBDIRECTORIES.length} of the nine exist in a real profile (absent here: ${absent.join(", ") || "none"})`,
    `cache list holds nothing from ${SESSION_SUBDIRECTORIES.join(", ")}: ${overlap.length === 0 ? "confirmed" : `VIOLATED by ${overlap.join(", ")}`}`,
    `session directories actually present: ${sessionPresent.join(", ") || "none"}`,
    `cache-named directories the list does not cover: ${
      roots.map((entry) => `${entry} (${mib(measure(entry))})`).join(", ") || "none"
    }`,
    `the nine hold ${mib(totalBytes(cacheSubset(all)))} of a ${mib(totalBytes(all))} profile`,
  ];
}

function realAppDataDirectory() {
  const local = process.env.LOCALAPPDATA;
  if (!local) return null;
  const directory = path.join(local, "ru.letscube.messenger");
  return existsSync(directory) ? directory : null;
}

function guardRoot(dataRoot, userAppData) {
  const resolved = path.resolve(dataRoot);
  if (!resolved.toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase())) {
    fail(`The storage suite refuses a data root outside the temporary directory: ${resolved}`);
  }
  if (userAppData && resolved.toLowerCase().startsWith(path.resolve(userAppData).toLowerCase())) {
    fail(`The storage suite refuses a data root inside the user's own profile: ${resolved}`);
  }
  const entries = existsSync(resolved) ? inventory(resolved, { hash: false }) : new Map();
  if (entries.size > 0) fail(`The storage suite requires an empty data root: ${resolved}`);
}

/// `MoveFileExW(MOVEFILE_REPLACE_EXISTING)` refuses a read-only destination,
/// which is how the settings write is made to fail without a full disk.
function makeReadOnly(file) {
  if (existsSync(file)) spawnSync("attrib.exe", ["+R", file], { stdio: "ignore" });
}

function makeWritable(file) {
  if (existsSync(file)) spawnSync("attrib.exe", ["-R", file], { stdio: "ignore" });
}

function mib(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function fail(message) {
  console.error(`[windows-tauri-qa] ${message}`);
  process.exit(1);
}
