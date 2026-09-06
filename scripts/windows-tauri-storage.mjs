// Filesystem measurement for the Windows storage QA suite.
//
// The application is the only thing that may move a profile, and it only ever
// does so before a window exists. So the observations that matter — what the
// tree held, what it holds now, whether the session bytes are the same bytes —
// can only be taken between launches, which is here rather than in a spec.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export const PROFILE_DIRECTORY = "webview-production-v1";
export const SETTINGS_FILE = "storage-settings.json";

/// Mirrors `CACHE_SUBDIRECTORIES` in windows-tauri/src-tauri/src/storage.rs.
/// Duplicated deliberately: a copy that is asserted against the Rust source is
/// how this harness notices the list changing under it.
export const CACHE_SUBDIRECTORIES = Object.freeze([
  "EBWebView/Default/Cache",
  "EBWebView/Default/Code Cache",
  "EBWebView/Default/GPUCache",
  "EBWebView/Default/DawnGraphiteCache",
  "EBWebView/Default/DawnWebGPUCache",
  "EBWebView/GrShaderCache",
  "EBWebView/ShaderCache",
  "EBWebView/component_crx_cache",
  "EBWebView/Subresource Filter",
]);

/// Where a WebView2 profile keeps what signing a person out would cost them.
/// `Local Storage` holds the Supabase session; `Network` holds the cookies.
export const SESSION_SUBDIRECTORIES = Object.freeze([
  "EBWebView/Default/Local Storage",
  "EBWebView/Default/Network",
  "EBWebView/Default/Session Storage",
  "EBWebView/Default/IndexedDB",
]);

export function readCacheSubdirectoriesFromRust(repoRoot) {
  const source = readFileSync(
    path.join(repoRoot, "windows-tauri", "src-tauri", "src", "storage.rs"),
    "utf8",
  );
  const block = source.match(
    /pub const CACHE_SUBDIRECTORIES: &\[&str\] = &\[([\s\S]*?)\];/,
  );
  if (!block) throw new Error("CACHE_SUBDIRECTORIES is no longer declared as expected.");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

/// Every file under `root`, keyed by forward-slashed relative path.
///
/// `hash: false` skips reading the bytes, which is what a directory only being
/// watched for accidental change needs.
///
/// A path is in this map if it is on disk. Whether its bytes could be read is a
/// separate question, answered by `unreadable`, because the two are not the
/// same thing and conflating them is how a relocation that carried every file
/// came to be reported as one that had lost eight of them.
export function inventory(root, { hash = true } = {}) {
  const entries = new Map();
  walk(root, "", entries, hash);
  return entries;
}

function walk(absolute, relative, entries, hash) {
  let listing;
  try {
    listing = readdirSync(absolute, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of listing) {
    if (entry.isSymbolicLink()) continue;
    const child = path.join(absolute, entry.name);
    const key = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      walk(child, key, entries, hash);
      continue;
    }
    if (!entry.isFile()) continue;
    let size;
    try {
      size = statSync(child).size;
    } catch {
      // Gone between the listing and the stat. This is the only case in which a
      // path is left out, and it is the only one that means "not there".
      continue;
    }
    let sha256 = null;
    let unreadable = false;
    if (hash) {
      try {
        sha256 = createHash("sha256").update(readFileSync(child)).digest("hex");
      } catch {
        // On disk, and held open by someone else. WebView2 keeps every leveldb
        // `LOCK` and the cookie store open exactly this way for as long as it
        // runs, so a measurement taken before it has let go used to report them
        // as files a move had failed to carry.
        unreadable = true;
      }
    }
    entries.set(key, { size, sha256, unreadable });
  }
}

/// Directories that exist under `root`, keyed by forward-slashed relative path.
export function directories(root) {
  const found = [];
  const visit = (absolute, relative, depth) => {
    if (depth > 4) return;
    let listing;
    try {
      listing = readdirSync(absolute, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of listing) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const key = relative ? `${relative}/${entry.name}` : entry.name;
      found.push(key);
      visit(path.join(absolute, entry.name), key, depth + 1);
    }
  };
  visit(root, "", 0);
  return found;
}

/// The subset of an inventory that would sign the person out if it changed.
export function sessionSubset(entries) {
  const subset = new Map();
  for (const [key, value] of entries) {
    if (SESSION_SUBDIRECTORIES.some((prefix) => key.startsWith(`${prefix}/`))) {
      subset.set(key, value);
    }
  }
  return subset;
}

export function cacheSubset(entries) {
  const subset = new Map();
  for (const [key, value] of entries) {
    if (CACHE_SUBDIRECTORIES.some((prefix) => key.startsWith(`${prefix}/`))) {
      subset.set(key, value);
    }
  }
  return subset;
}

export function totalBytes(entries) {
  let total = 0;
  for (const value of entries.values()) total += value.size;
  return total;
}

/// Files present in `before` whose bytes are missing or different in `after`.
export function missingOrChanged(before, after) {
  const differences = [];
  for (const [key, value] of before) {
    const other = after.get(key);
    if (!other) {
      differences.push(`${key} (gone)`);
    } else if (other.size !== value.size) {
      differences.push(`${key} (resized)`);
    } else if (other.unreadable || value.unreadable) {
      // The bytes were never seen on one of the two sides, so nothing can be
      // claimed about them. The path is there and its length is unchanged, and
      // calling that a difference would be inventing one.
      continue;
    } else if (other.sha256 !== value.sha256) {
      differences.push(`${key} (changed)`);
    }
  }
  return differences;
}

/// Whether every path that was owed reached the destination.
///
/// One reading of a move, phrased once. Both the failure a phase reports and
/// the measurement it records are taken from this, so the run cannot describe
/// the same relocation two different ways.
export function arrival(owed, destination) {
  const missing = owed.filter((key) => !destination.has(key));
  return {
    owed: owed.length,
    missing,
    complete: missing.length === 0,
    summary:
      missing.length === 0
        ? `all ${owed.length} non-cache paths arrived`
        : `${owed.length - missing.length} of ${owed.length} non-cache paths arrived and ${missing.length} did not: ${missing.slice(0, 5).join(", ")}`,
  };
}

/// Paths in `after` that `before` did not have.
export function added(before, after) {
  return [...after.keys()].filter((key) => !before.has(key));
}

/// Whether a string has actually reached the profile's Local Storage on disk.
///
/// Chromium batches localStorage writes and commits them after a pause, so a
/// value that a page can read back is not yet a value that would survive the
/// process. Without this check a profile killed before its flush looks exactly
/// like a relocation that lost the session.
export function localStorageHoldsOnDisk(profile, needle) {
  const directory = path.join(profile, "EBWebView/Default/Local Storage/leveldb");
  const utf8 = Buffer.from(needle, "utf8");
  const utf16 = Buffer.from(needle, "utf16le");
  let listing;
  try {
    listing = readdirSync(directory, { withFileTypes: true });
  } catch {
    return false;
  }
  const unread = [];
  for (const entry of listing) {
    if (!entry.isFile()) continue;
    try {
      const bytes = readFileSync(path.join(directory, entry.name));
      if (bytes.includes(utf8) || bytes.includes(utf16)) return true;
    } catch {
      unread.push(entry.name);
    }
  }
  if (unread.length > 0) {
    // "Could not look" is not "not there". Answering `false` here would report
    // a session lost to a relocation on the strength of a file that was merely
    // still open, which is the strongest claim this suite makes.
    throw new Error(
      `${unread.length} file(s) under ${directory} could not be read (${unread.slice(0, 5).join(", ")}), so whether the session is on disk is unknown rather than false`,
    );
  }
  return false;
}

export function readSettings(root) {
  try {
    return JSON.parse(readFileSync(path.join(root, SETTINGS_FILE), "utf8"));
  } catch {
    return null;
  }
}

export function writeSettings(root, settings) {
  writeFileSync(path.join(root, SETTINGS_FILE), JSON.stringify(settings), "utf8");
}

/// Fills the cache directories past a limit without writing the bytes.
///
/// `directory_size` measures file length, which `ftruncate` sets outright, so a
/// budget can be exceeded in milliseconds instead of minutes.
export function plantCacheBytes(profile, bulkBytes) {
  const planted = new Map();
  CACHE_SUBDIRECTORIES.forEach((relative, index) => {
    const directory = path.join(profile, relative);
    mkdirSync(directory, { recursive: true });
    // A distinct size per directory, so a clear that misses one is visible.
    const marker = path.join(directory, "qa-planted-marker");
    writeFileSync(marker, Buffer.alloc(1024 * (index + 1), 0x51));
    planted.set(`${relative}/qa-planted-marker`, 1024 * (index + 1));
  });

  const bulk = path.join(profile, CACHE_SUBDIRECTORIES[0], "qa-planted-bulk");
  const handle = openSync(bulk, "w");
  try {
    ftruncateSync(handle, bulkBytes);
  } finally {
    closeSync(handle);
  }
  planted.set(`${CACHE_SUBDIRECTORIES[0]}/qa-planted-bulk`, bulkBytes);
  return planted;
}

/// A marker outside the cache list, to prove a clear stops where it says it does.
export function plantDecoy(profile) {
  const relative = "EBWebView/Default/qa-not-a-cache/keep-me";
  const absolute = path.join(profile, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, "this directory is not in CACHE_SUBDIRECTORIES");
  return relative;
}

/// Waits until nothing holds a handle inside `profile`.
///
/// A killed client's WebView2 children outlive their parent by seconds, and
/// while they do, the next launch cannot open the profile and the relocation
/// that launch would perform cannot delete the original. Renaming a directory
/// is the exact question being asked — Windows refuses it while any file
/// beneath is open — so it is a better probe than a fixed wait.
export function waitUntilReleased(profile, attempts = 60) {
  if (!existsSync(profile)) return true;
  const probe = `${profile}.qa-release-probe`;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      renameSync(profile, probe);
      renameSync(probe, profile);
      return true;
    } catch {
      // Still held; try again below.
    }
    sleepSync(500);
  }
  return false;
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/// A destination whose creation cannot succeed: its parent is a regular file.
///
/// `create_dir_all` answers `NotADirectory` here, which is the same shape of
/// failure as a volume that has gone read-only or been unplugged between the
/// moment a move was recorded and the launch that would carry it out.
export function makeUncreatableTarget(root) {
  const blocker = path.join(root, "blocked-parent");
  rmSync(blocker, { recursive: true, force: true });
  writeFileSync(blocker, "not a directory");
  return path.join(blocker, PROFILE_DIRECTORY);
}
