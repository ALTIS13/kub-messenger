import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = new URL("../../", import.meta.url);
const windowsTauriRoot = new URL("../../windows-tauri/", import.meta.url);
const srcTauriRoot = new URL("../../windows-tauri/src-tauri/", import.meta.url);
const rootPackage = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const workspaceConfig = readFileSync(new URL("../../pnpm-workspace.yaml", import.meta.url), "utf8");

function readText(relativePath) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

/* The startup screen is plain script served as-is — there is no build step in
 * windows-tauri/ui and there must not be one — so a helper cannot be imported.
 * Lifting the declaration out of the shipped file and running it is still a
 * behavioural test of the code that ships, which a regex over the source would
 * not be: a scan stays green while the rule inside the function rots. */
function evaluateStartupHelper(source, name, dependencies = []) {
  const declarationOf = (fn) => {
    const declaration = source.match(new RegExp(`^function ${fn}\\([\\s\\S]*?^\\}`, "m"))?.[0];
    assert.ok(declaration, `${fn} must remain a top-level function in windows-tauri/ui/startup.js`);
    return declaration;
  };
  const program = [...dependencies, name].map(declarationOf).join("\n");
  return vm.runInNewContext(`${program}\n${name}`);
}

/* `--kub-x: #hex;` declarations of one CSS block, as a Map.
 *
 * `glass` is in the prefix list beside `kub`, and it is the half that was
 * missing. The four values that decide what the surfaces are made of are named
 * --glass-*, so a pattern that only knew --kub-, --brand- and --app- compared
 * the palette while leaving the material unguarded — and the three copies of
 * it drifted apart under a green suite. Proved by mutation: --glass-fill could
 * be set to opaque red in startup.css and nothing here noticed. */
function collectTokens(css, blockPattern) {
  // Comments are blanked before the block is read. A prose sentence naming a
  // token — "deliberately not --kub-surface-2: that one also means ..." — is a
  // `--name:` sequence as far as the pattern below is concerned, and the value
  // it then captures runs to the next semicolon, which is somewhere in the
  // following declaration. That made writing about a token a way to break the
  // check that guards it.
  const source = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  const block = source.match(blockPattern)?.[0] ?? "";
  const tokens = new Map();
  // Every custom property, not a list of prefixes it is allowed to be. The
  // list was `kub|brand|app` when the material arrived called `--glass-`, so
  // the check that exists to stop these copies drifting could not see the thing
  // that had drifted — proven by mutation: the fill turned opaque red, the edge
  // green and the blur to zero, and the suite stayed green on all three.
  // Adding `glass` to the list fixes today and loses the next family the same
  // way, so there is no list. A name only ever reaches a comparison when BOTH
  // files declare it, so widening this cannot produce a false failure; it can
  // only stop one from being missed.
  for (const [, name, value] of block.matchAll(/(--[a-z][a-z0-9-]*)\s*:\s*([^;]+);/g)) {
    // --glass-shadow is three shadows on three lines. Newlines and the
    // indentation after them are not part of the value, so they are collapsed
    // before the comparison; anything else that differs is a real difference.
    tokens.set(name, value.replace(/\s+/g, " ").trim());
  }
  return tokens;
}

test("Windows Tauri shell stays isolated from the root workspace and exposes only the root launcher scripts", () => {
  assert.equal(existsSync(windowsTauriRoot), true, "windows-tauri package is missing");
  assert.doesNotMatch(workspaceConfig, /windows-tauri/, "windows-tauri must stay outside the pnpm workspace");

  assert.match(rootPackage.scripts["windows:tauri:run"], /windows-tauri/);
  assert.match(rootPackage.scripts["windows:tauri:run"], /tauri dev/);
  assert.match(rootPackage.scripts["windows:tauri:run"], /\.cargo\\bin/);
  assert.equal(rootPackage.scripts["windows:tauri:test"], "node --test tests/unit/tauri-shell.test.mjs");
  assert.match(rootPackage.scripts["windows:tauri:build:internal"], /windows-tauri/);
  assert.match(rootPackage.scripts["windows:tauri:build:internal"], /tauri build/);
  assert.match(rootPackage.scripts["windows:tauri:build:internal"], /\.cargo\\bin/);
  assert.equal(rootPackage.scripts["windows:tauri:qa"], "node scripts/windows-tauri-qa.mjs");

  const shellPackage = readJson("windows-tauri/package.json");
  assert.equal(shellPackage.private, true);
  assert.equal(Number.isSafeInteger(shellPackage.desktopBuild), true);
  assert.ok(shellPackage.desktopBuild > 0);

  const pinnedDependencies = {
    ...(shellPackage.dependencies ?? {}),
    ...(shellPackage.devDependencies ?? {}),
  };

  for (const [name, version] of Object.entries(pinnedDependencies)) {
    assert.doesNotMatch(
      version,
      /^[~^]/,
      `${name} must be pinned exactly so the Windows toolchain stays reproducible`,
    );
  }
});

test("Windows release version and build metadata stay aligned", () => {
  const shellPackage = readJson("windows-tauri/package.json");
  const tauriConfig = readJson("windows-tauri/src-tauri/tauri.conf.json");
  const cargoToml = readText("windows-tauri/src-tauri/Cargo.toml");
  const cargoVersion = cargoToml.match(/^version = "([^"]+)"$/m)?.[1] ?? null;
  const startupHtml = readText("windows-tauri/ui/startup.html");
  const libRs = readText("windows-tauri/src-tauri/src/lib.rs");
  const publisherPublicKey = readText("scripts/windows-updater-public.key").trim();

  assert.equal(shellPackage.version, "0.2.13");
  assert.equal(shellPackage.desktopBuild, 17);
  assert.equal(tauriConfig.version, shellPackage.version);
  assert.equal(cargoVersion, shellPackage.version);
  assert.equal(tauriConfig.plugins.updater.pubkey, publisherPublicKey);
  assert.doesNotMatch(startupHtml, /Desktop\s+\d+\.\d+\.\d+/);
  assert.match(libRs, /startup_runtime_script[\s\S]*CARGO_PKG_VERSION/);
});

test("Windows startup uses the neutral LETSCUBE wordmark without the former venue descriptor", () => {
  const startupLogo = readText("windows-tauri/ui/letscube-logo.svg").trim();
  const neutralWordmark = readText(
    "artifacts/kub/public/brand/letscube/letscube-wordmark-horizontal-light.svg",
  ).trim();
  const startupCss = readText("windows-tauri/ui/startup.css");
  const overlayCss = readText("windows-tauri/ui/startup-overlay.css");

  assert.equal(startupLogo, neutralWordmark);
  assert.doesNotMatch(startupCss, /filter:\s*brightness\(0\)\s+invert\(1\)/);
  assert.doesNotMatch(overlayCss, /filter:\s*brightness\(0\)\s+invert\(1\)/);
});

test("Windows updater build loads the encrypted local signing identity without exposing secrets", () => {
  const scriptPath = new URL("../../scripts/windows-tauri-updater-build.ps1", import.meta.url);
  assert.equal(existsSync(scriptPath), true, "Windows updater build wrapper is missing");
  assert.equal(
    rootPackage.scripts["windows:tauri:build:updater"],
    "pwsh -NoLogo -NoProfile -NonInteractive -File scripts/windows-tauri-updater-build.ps1",
  );

  const script = readFileSync(scriptPath, "utf8");
  assert.match(script, /\.codex-local[\\/]windows-updater[\\/]updater\.key/);
  assert.match(script, /\.codex-local[\\/]windows-updater[\\/]updater-password\.txt/);
  assert.match(script, /scripts[\\/]windows-updater-public\.key/);
  assert.match(script, /TAURI_SIGNING_PRIVATE_KEY/);
  assert.match(script, /TAURI_SIGNING_PRIVATE_KEY_PASSWORD/);
  assert.match(script, /try\s*\{[\s\S]*?finally\s*\{/);
  assert.match(script, /Remove-Item\s+Env:TAURI_SIGNING_PRIVATE_KEY/);
  assert.match(script, /Remove-Item\s+Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD/);
  assert.doesNotMatch(script, /Write-(?:Host|Output|Verbose|Debug)[^\n]*(?:PRIVATE_KEY|PASSWORD)/i);
  assert.doesNotMatch(script, /--(?:key|password)/i);
});

test("Windows Tauri shell files encode the minimum-capability production contract", () => {
  const cargoTomlPath = new URL("./Cargo.toml", srcTauriRoot);
  const libRsPath = new URL("./src/lib.rs", srcTauriRoot);
  const mainRsPath = new URL("./src/main.rs", srcTauriRoot);
  const buildRsPath = new URL("./build.rs", srcTauriRoot);
  const tauriConfig = readJson("windows-tauri/src-tauri/tauri.conf.json");
  const capability = readJson("windows-tauri/src-tauri/capabilities/production.json");
  const startupCapability = readJson("windows-tauri/src-tauri/capabilities/startup.json");
  const cargoToml = readFileSync(cargoTomlPath, "utf8");
  const libRs = readFileSync(libRsPath, "utf8");
  const updaterRs = readText("windows-tauri/src-tauri/src/updater.rs");
  const mainRs = readFileSync(mainRsPath, "utf8");
  const buildRs = readFileSync(buildRsPath, "utf8");

  assert.equal(existsSync(cargoTomlPath), true);
  assert.equal(existsSync(libRsPath), true);
  assert.equal(existsSync(mainRsPath), true);
  assert.equal(existsSync(buildRsPath), true);

  assert.match(cargoToml, /^name = "letscube-windows-tauri"$/m);
  assert.match(cargoToml, /^tauri = \{ version = "2\.11\.[^"]+"/m);
  assert.match(cargoToml, /^tauri-build = \{ version = "2\.[^"]+"/m);
  assert.doesNotMatch(cargoToml, /^tauri-plugin-notification\s*=/m);
  assert.match(cargoToml, /^windows = \{ version = "0\.61", features = \[[^\]]*"UI_Notifications"/m);
  assert.match(cargoToml, /^tauri-plugin-opener = "2\.[^"]+"/m);
  assert.match(cargoToml, /^tauri-plugin-deep-link = "=?2\.[^"]+"/m);
  assert.match(
    cargoToml,
    /^tauri-plugin-single-instance = \{[^\n]*features = \["deep-link"\][^\n]*\}$/m,
  );
  assert.match(cargoToml, /^tauri-plugin-updater = "=2\.10\.1"$/m);
  assert.equal((cargoToml.match(/^reqwest\s*=/gm) ?? []).length, 1);
  assert.match(cargoToml, /^reqwest = \{[^\n]*version = "=0\.13\.4"[^\n]*features = \[[^\]]*"json"[^\]]*\]/m);

  assert.match(mainRs, /letscube_windows_tauri::run\(\)/);
  assert.match(buildRs, /tauri_build::try_build\(/);
  assert.match(buildRs, /package\.json/);
  assert.match(buildRs, /LETSCUBE_DESKTOP_BUILD/);
  for (const command of [
    "retry_main",
    "begin_startup_qa",
    "desktop_get_update_state",
    "desktop_get_update_channel",
    "desktop_set_update_channel",
    "desktop_check_update",
    "desktop_install_update",
    "desktop_show_main",
    "desktop_is_main_foreground",
    "desktop_notify",
    "desktop_remove_notification",
    "desktop_take_pending_notification_route",
    "desktop_start_dragging",
    "desktop_minimize",
    "desktop_toggle_maximize",
    "desktop_is_maximized",
    "desktop_close_to_tray",
    "desktop_get_storage_state",
    "desktop_set_storage_location",
    "desktop_set_cache_limit",
    "desktop_clear_cache",
    "startup_start_dragging",
    "startup_minimize",
    "startup_toggle_maximize",
    "startup_close_to_tray",
  ]) {
    assert.match(
      buildRs,
      new RegExp(`const\\s+COMMANDS[\\s\\S]*?${command}`),
      `${command} must be registered in the application ACL manifest`,
    );
    const permissionPath = `windows-tauri/src-tauri/permissions/autogenerated/${command}.toml`;
    assert.equal(existsSync(new URL(`../../${permissionPath}`, import.meta.url)), true);
    const permission = readText(permissionPath);
    assert.match(permission, new RegExp(`identifier = "allow-${command.replaceAll("_", "-")}"`));
    assert.match(permission, new RegExp(`commands\\.allow = \\["${command}"\\]`));
  }
  assert.match(buildRs, /AppManifest::new\(\)\.commands\(COMMANDS\)/);

  assert.match(libRs, /https:\/\/app\.letscube\.ru\//);
  assert.match(libRs, /webview-production-v1/);
  assert.match(libRs, /window\.letscubeDesktop/);
  assert.match(libRs, /desktop_show_main/);
  assert.match(libRs, /showMain: async \(\) => call\("desktop_show_main"\)/);
  assert.match(libRs, /desktop_is_main_foreground/);
  assert.match(libRs, /isMainForeground: async \(\) => call\("desktop_is_main_foreground"\)/);
  assert.match(libRs, /desktop_notify/);
  assert.match(libRs, /notify: async \(notification\) => call\("desktop_notify"/);
  assert.match(libRs, /desktop_remove_notification/);
  assert.match(libRs, /removeNotification: async \(notification\) => call\("desktop_remove_notification"/);
  assert.match(libRs, /desktop_take_pending_notification_route/);
  assert.match(libRs, /takePendingNotificationRoute: async \(\) => call\("desktop_take_pending_notification_route"\)/);
  assert.match(libRs, /startDragging: async \(\) => call\("desktop_start_dragging"\)/);
  assert.match(libRs, /minimize: async \(\) => call\("desktop_minimize"\)/);
  assert.match(libRs, /toggleMaximize: async \(\) => call\("desktop_toggle_maximize"\)/);
  assert.match(libRs, /isMaximized: async \(\) => call\("desktop_is_maximized"\)/);
  assert.match(libRs, /closeToTray: async \(\) => call\("desktop_close_to_tray"\)/);
  assert.match(libRs, /getStorageState: async \(\) => call\("desktop_get_storage_state"\)/);
  assert.match(libRs, /setStorageLocation: async \(location\) => call\("desktop_set_storage_location"/);
  assert.match(libRs, /setCacheLimit: async \(bytes\) => call\("desktop_set_cache_limit"/);
  assert.match(libRs, /clearCache: async \(\) => call\("desktop_clear_cache"\)/);
  assert.equal(capability.permissions.includes("allow-desktop-show-main"), true);
  assert.equal(capability.permissions.includes("allow-desktop-is-main-foreground"), true);
  assert.equal(capability.permissions.includes("allow-desktop-notify"), true);
  assert.equal(capability.permissions.includes("allow-desktop-remove-notification"), true);
  assert.equal(capability.permissions.includes("allow-desktop-take-pending-notification-route"), true);
  assert.match(libRs, /window\s*\.is_visible\(\)/);
  assert.match(libRs, /window\s*\.is_minimized\(\)/);
  assert.match(libRs, /window\s*\.is_focused\(\)/);
  assert.match(libRs, /NotificationSetting::Enabled/);
  assert.match(libRs, /RemoveGroupedTagWithId/);
  assert.match(
    libRs,
    /RemoveGroupWithId[\s\S]*"messages"/,
    "the first grouped build must remove legacy per-chat replacement cards",
  );
  assert.match(libRs, /PendingNotificationRoute/);
  assert.match(
    libRs,
    /activationType="protocol"[\s\S]*launch="\{\}"/,
    "Windows toast cards must use durable protocol activation from Notification Center",
  );
  assert.match(libRs, /notification_route_from_activation_url/);
  assert.match(libRs, /notification_route_from_args/);
  assert.match(libRs, /tauri_plugin_deep_link::init\(\)/);
  assert.match(
    libRs,
    /DeepLinkExt[\s\S]*\.deep_link\(\)\.on_open_url/,
    "the running Windows instance must consume protocol URLs emitted by the deep-link bridge",
  );
  assert.doesNotMatch(libRs, /ActiveWindowsNotifications/);
  assert.deepEqual(tauriConfig.plugins["deep-link"].desktop.schemes, [
    "letscube-notification",
  ]);
  assert.match(libRs, /Object\.freeze/);
  assert.match(libRs, /version:\s*runtimeInfo\.version/);
  assert.match(libRs, /build:\s*runtimeInfo\.build/);
  assert.match(libRs, /platform:\s*"windows"/);
  assert.match(libRs, /build:/);
  assert.match(libRs, /#\[cfg\(debug_assertions\)\]/);
  assert.match(libRs, /LETSCUBE_WEBVIEW2_DATA_DIR/);
  assert.match(libRs, /#\[cfg\(debug_assertions\)\][\s\S]*LETSCUBE_TAURI_QA_HOLD_PREFLIGHT/);
  assert.match(libRs, /single_instance/);
  assert.match(libRs, /Открыть LETSCUBE/);
  assert.match(libRs, /Выйти/);
  assert.match(libRs, /hide\(\)/);
  assert.match(libRs, /show\(\)/);
  assert.match(libRs, /notify|notification/i);
  assert.match(libRs, /on_new_window/);
  assert.match(libRs, /is_safe_external_url/);
  assert.match(libRs, /opener\(\)\s*\.open_url/);
  assert.match(libRs, /MAIN_READY/);
  assert.match(libRs, /restore_startup_surface/);
  assert.doesNotMatch(libRs, /dangerous_accept_invalid_certs|dangerous_accept_invalid_hostnames/);
  assert.match(libRs, /tauri_plugin_updater::Builder::new\(\)\.build\(\)/);
  assert.match(libRs, /update\.timeout\s*=\s*Some\(UPDATE_TIMEOUT\)/);
  assert.match(libRs, /transition_update_failed/);
  assert.match(updaterRs, /File::open\(path\)/);
  assert.match(updaterRs, /file\.metadata\(\)/);
  assert.match(updaterRs, /take\(MAX_CHANNEL_FILE_BYTES\s*\+\s*1\)/);
  assert.match(updaterRs, /read_to_end/);
  assert.doesNotMatch(updaterRs, /fs::metadata\(path\)|fs::read\(path\)/);
  const updaterCommands = [
    "desktop_get_update_state",
    "desktop_get_update_channel",
    "desktop_set_update_channel",
    "desktop_check_update",
    "desktop_install_update",
  ];
  for (const command of updaterCommands) {
    assert.match(libRs, new RegExp(command));
    const commandBody = libRs.match(
      new RegExp(`(?:async\\s+)?fn\\s+${command}[\\s\\S]*?(?=\\n#\\[tauri::command\\]|\\npub fn run)`),
    )?.[0] ?? "";
    assert.match(commandBody, /require_production_main\(&window\)/, `${command} must use the production/main guard`);
  }
  for (const command of [
    "desktop_start_dragging",
    "desktop_minimize",
    "desktop_toggle_maximize",
    "desktop_is_maximized",
    "desktop_close_to_tray",
  ]) {
    const commandBody = libRs.match(
      new RegExp(`fn\\s+${command}[\\s\\S]*?(?=\\n#\\[tauri::command\\]|\\npub fn run)`),
    )?.[0] ?? "";
    assert.match(commandBody, /require_production_main\(&window\)/, `${command} must use the production/main guard`);
  }
  for (const command of [
    "startup_start_dragging",
    "startup_minimize",
    "startup_toggle_maximize",
    "startup_close_to_tray",
  ]) {
    const commandBody = libRs.match(
      new RegExp(`fn\\s+${command}[\\s\\S]*?(?=\\n#\\[tauri::command\\]|\\npub fn run)`),
    )?.[0] ?? "";
    assert.match(commandBody, /require_startup_main\(&window\)/, `${command} must use the exact startup/main guard`);
  }
  const productionGuard = libRs.match(
    /fn require_production_main[\s\S]*?(?=\nfn is_safe_external_url)/,
  )?.[0] ?? "";
  assert.match(productionGuard, /window\.label\(\)\s*!=\s*"main"/);
  assert.match(productionGuard, /window\s*\.url\(\)/);
  assert.match(productionGuard, /is_allowed_navigation\(&url\)/);
  assert.match(libRs, /getUpdateState:\s*async/);
  assert.match(libRs, /getUpdateChannel:\s*async/);
  assert.match(libRs, /setUpdateChannel:\s*async/);
  assert.match(libRs, /checkUpdate:\s*async/);
  assert.match(libRs, /installUpdate:\s*async/);
  assert.match(libRs, /WebviewWindowBuilder::from_config/);
  assert.match(libRs, /StartupState/);
  assert.match(libRs, /letscube:\/\/startup-state/);
  assert.match(libRs, /PageLoadEvent::Finished/);
  assert.match(libRs, /is_allowed_navigation\([^)]*url/);
  assert.doesNotMatch(libRs, /thread::sleep|letscube:\/\/load-timeout/);
  const retryMain = libRs.match(/fn retry_main[\s\S]*?#\[tauri::command\]\s*fn begin_startup_qa/)?.[0] ?? "";
  assert.match(
    retryMain,
    /window\s*\.url\(\)[\s\S]*is_local_startup_url/,
    "retry_main must positively require the exact bundled startup URL",
  );
  assert.doesNotMatch(
    retryMain,
    /window\s*\.url\(\)[\s\S]*is_allowed_navigation/,
    "retry_main must not authorize every URL that is merely non-production",
  );

  assert.equal(tauriConfig.productName, "LETSCUBE");
  assert.equal(tauriConfig.identifier, "ru.letscube.messenger");
  assert.equal(tauriConfig.bundle.active, true);
  assert.deepEqual(tauriConfig.bundle.targets, ["nsis"]);
  assert.equal(tauriConfig.bundle.createUpdaterArtifacts, true);
  assert.equal(typeof tauriConfig.plugins.updater.pubkey, "string");
  assert.ok(tauriConfig.plugins.updater.pubkey.length > 40);
  assert.equal(tauriConfig.bundle.windows.webviewInstallMode.type, "skip");

  assert.equal(capability.identifier, "production");
  assert.deepEqual(capability.windows, ["main"]);
  assert.deepEqual(capability.remote.urls, ["https://app.letscube.ru/*"]);
  assert.ok(Array.isArray(capability.permissions), "production capability permissions must be explicit");
  assert.ok(
    capability.permissions.every((permission) => !/fs|shell|process|updater|sql|http:default|opener/i.test(permission)),
    "production capability must not expose filesystem, shell, process, updater, generic opener or wildcard HTTP access",
  );
  assert.ok(
    capability.permissions.every((permission) => !/^notification:/.test(permission)),
    "remote production origin must use the guarded native toast command instead of plugin-wide notification access",
  );
  assert.ok(
    capability.permissions.every((permission) => !/^updater:/.test(permission)),
    "remote production pages must use only the origin-guarded Rust updater commands",
  );
  assert.deepEqual(
    capability.permissions.filter((permission) => /^allow-desktop-/.test(permission)).sort(),
    [
      "allow-desktop-check-update",
      "allow-desktop-clear-cache",
      "allow-desktop-close-to-tray",
      "allow-desktop-get-storage-state",
      "allow-desktop-get-update-channel",
      "allow-desktop-get-update-state",
      "allow-desktop-install-update",
      "allow-desktop-is-main-foreground",
      "allow-desktop-is-maximized",
      "allow-desktop-minimize",
      "allow-desktop-notify",
      "allow-desktop-remove-notification",
      "allow-desktop-set-cache-limit",
      "allow-desktop-set-storage-location",
      "allow-desktop-set-update-channel",
      "allow-desktop-show-main",
      "allow-desktop-start-dragging",
      "allow-desktop-take-pending-notification-route",
      "allow-desktop-toggle-maximize",
    ],
    "remote production origin must receive only the guarded desktop commands",
  );
  assert.deepEqual(startupCapability.permissions.sort(), [
    "allow-begin-startup-qa",
    "allow-retry-main",
    // Added deliberately: the one control that continues past a fingerprint
    // that no longer matches. It is scoped to our own recorded value and can
    // never reach the chain validation, which fails the request outright.
    "allow-startup-accept-peer-change",
    "allow-startup-close-to-tray",
    "allow-startup-minimize",
    "allow-startup-start-dragging",
    "allow-startup-toggle-maximize",
  ]);
});

test("Windows startup uses one main window and a local approved handshake scene", () => {
  const config = readJson("windows-tauri/src-tauri/tauri.conf.json");
  assert.deepEqual(config.app.windows.map((window) => window.label), ["main"]);
  assert.equal(config.app.windows[0].url, "startup.html");
  assert.equal(config.app.windows[0].visible, true);
  assert.equal(config.app.windows[0].decorations, false);
  assert.equal(config.app.windows[0].resizable, true);
  assert.equal(config.app.windows[0].center, true);
  assert.equal(config.app.windows[0].minWidth, 960);
  assert.equal(config.app.windows[0].minHeight, 640);
  assert.equal(existsSync(new URL("../../windows-tauri/ui/splash.html", import.meta.url)), false);

  const html = readText("windows-tauri/ui/startup.html");
  const css = readText("windows-tauri/ui/startup.css");
  const script = readText("windows-tauri/ui/startup.js");
  assert.match(html, /data-testid="startup-client-fingerprint"/);
  assert.match(html, /data-testid="startup-server-fingerprint"/);
  assert.match(html, /data-testid="startup-client-port"/);
  assert.match(html, /data-testid="startup-server-port"/);
  assert.match(html, /data-testid="startup-center-seal"/);
  assert.match(html, /data-testid="startup-titlebar"/);
  assert.match(html, /data-testid="startup-window-minimize"/);
  assert.match(html, /data-testid="startup-window-maximize"/);
  assert.match(html, /data-testid="startup-window-close"/);
  assert.match(html, /id="startup-status"/);
  assert.match(html, /id="startup-retry"/);
  assert.match(css, /grid-template-columns:\s*1fr\s+34px\s+1fr/);
  assert.match(css, /\.endpoint-client\s*\{\s*grid-column:\s*1;/);
  assert.match(css, /\.endpoint-server\s*\{\s*grid-column:\s*3;/);
  assert.match(css, /grid-template-rows:\s*74px\s+20px\s+126px\s+20px\s+19px\s+4px\s+14px/);
  // These four numbers used to be pinned literally: right -18px, left -22px,
  // and the two rail ends at 25%+83.5px and 25%+75.5px. Measured in a browser,
  // that geometry put the left rail exactly on its node and the right rail 4px
  // *inside* its node, with the two nodes 4px apart vertically and at different
  // distances from their devices. The assertions were green the whole time,
  // because pinning each side separately cannot notice that they disagree.
  //
  // What is pinned now is that neither side has a number of its own.
  assert.match(css, /\.connection-port-client\s*\{\s*right:\s*calc\(-1 \* var\(--node-offset\)\);\s*\}/);
  assert.match(css, /\.connection-port-server\s*\{\s*left:\s*calc\(-1 \* var\(--node-offset\)\);\s*\}/);
  assert.match(css, /\.connection-port\s*\{\s*top:\s*calc\(50% - var\(--connector-node\) \/ 2\);\s*\}/);
  assert.match(
    css,
    /--node-offset:\s*calc\(var\(--connector-clear\) \+ var\(--connector-node\) - var\(--chassis-inset\)\)/,
  );
  assert.match(
    css,
    /\.rail-left\s*\{[^}]*left:\s*calc\(25% - var\(--column-shift\) \+ var\(--device-half\) \+ var\(--node-offset\)\);[^}]*right:\s*calc\(50% \+ var\(--conduit-core\) \/ 2\);[^}]*\}/s,
  );
  assert.match(
    css,
    /\.rail-right\s*\{[^}]*left:\s*calc\(50% \+ var\(--conduit-core\) \/ 2\);[^}]*right:\s*calc\(25% - var\(--column-shift\) \+ var\(--node-half\) \+ var\(--node-offset\)\);[^}]*\}/s,
  );
  // The two sockets are one declaration, so they cannot end up different sizes
  // the way the old 12px/34px/12px circles did.
  assert.match(
    css,
    /\.connection-port\s*\{[^}]*width:\s*var\(--connector-node\);\s*height:\s*var\(--connector-node\);/s,
  );
  // The channel is an enclosure, not a line: it carries the device blocks' own
  // material. The relationship is what is pinned, not a literal colour — the
  // colour is exactly what changed when these surfaces became translucent, and
  // a pin on the old value would have failed for a change that kept the
  // contract intact.
  assert.match(
    css,
    /\.rail\s*\{[^}]*height:\s*var\(--conduit-height\);[^}]*background:\s*var\(--glass-fill\);[^}]*border:\s*1px solid var\(--kub-border-color\);/s,
  );
  // Every panel on this screen is the same material, and none of them is
  // opaque. A surface that stops sampling the scene behind it stops being a
  // surface and becomes a flat patch of a slightly different colour, which is
  // what this screen was before.
  for (const selector of [".handshake::before {", ".computer::before, .server::before {", ".rail {"]) {
    const start = css.indexOf(selector);
    assert.ok(start >= 0, selector + " is missing");
    const block = css.slice(start, css.indexOf("}", start));
    // The unprefixed property specifically. Matching the bare name as a
    // substring also matches -webkit-backdrop-filter, so deleting the real
    // declaration left this green on the prefix alone — measured, not assumed.
    assert.match(
      block,
      /(?:^|[^-\w])backdrop-filter:\s*var\(--glass-blur\)/m,
      selector + " must sample the scene behind it",
    );
  }
  // An SVG fill cannot be glass: backdrop-filter has no effect on one, so the
  // rect could only ever be an opaque colour pretending to be a pane.
  assert.doesNotMatch(css, /\.device-art \.device-glass/);
  assert.doesNotMatch(html, /class="device-glass"/);
  // The scene needs something behind it worth revealing. One flat colour blurs
  // to the same flat colour and the panels stop reading as material at all.
  // Counted inside .startup-shell's own block. Across the whole sheet this
  // also counted the stage head's glow, so the scene could lose a light while
  // the total still cleared the bar.
  const sceneStart = css.indexOf(".startup-shell {");
  assert.ok(sceneStart >= 0, ".startup-shell is missing");
  const scene = css.slice(sceneStart, css.indexOf("}", sceneStart));
  assert.ok(
    (scene.match(/radial-gradient\(/g) ?? []).length >= 4,
    "the ambient scene must be layered, or the translucency has nothing to sample",
  );
  // It must not report progress. The stage track below already does that, and
  // two indicators counting the same stages is what made this one read as a
  // stepper. Nothing here may key off a stage.
  assert.doesNotMatch(css, /\.rail\s+i\s*\{[^}]*transform:\s*scaleX/s);
  assert.doesNotMatch(
    css,
    /body\[data-stage=[^\]]+\][^{]*\.rail/,
    "the channel must show the state of the channel, not the stage the shell is on",
  );
  // Movement along the channel is one of its three states, so it has to stop.
  assert.match(css, /prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.rail i \{ animation: none; \}/);

  // -- The stage track --------------------------------------------------------
  // Two rebuilds sit behind this. It was first four 4px bars with 10px gaps,
  // which read as a dotted rule rather than as one indicator. It then became
  // one recessed channel, and that was reported as looking dated three
  // separate times. The cause was five period signals stacked on a single
  // 680px object: a bevelled channel, a 7px height, notches cutting it into
  // four segments, a gradient running along the fill, and a pulsing radial
  // glow at the head. Every one of them had been added to make the object
  // richer, and richness is what aged it.
  //
  // Each of the five is pinned below as an assertion that it stays gone. They
  // are not hypothetical: all five were written deliberately once, so all five
  // can be written deliberately again.
  const cssBody = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /\.stages\s*\{[^}]*gap:\s*0;/s, "the track is one object, so the columns carry no gaps");
  assert.match(
    cssBody,
    /\.stages\s*\{[^}]*--track-height:\s*[0-4]px;/s,
    "a modern determinate track is 2-4px; 7px carrying decoration is a download-manager meter",
  );
  assert.match(
    cssBody,
    /\.stages::before\s*\{[^}]*left:\s*0;\s*right:\s*0;[^}]*height:\s*var\(--track-height\);/s,
    "the track must span the block",
  );
  assert.doesNotMatch(
    cssBody,
    /\.stages::before\s*\{[^}]*(?:box-shadow|border)\s*:/s,
    "the track stays flat: a bevelled channel is the strongest dated signal this screen ever carried",
  );
  assert.match(
    cssBody,
    /\.stages::after\s*\{[^}]*background-color:\s*var\(--track-accent\);/s,
    "the fill is one solid colour; a gradient along its length is decoration from the same period",
  );
  // The fill is revealed rather than sized, and that is also what confines the
  // travelling highlight to the filled length instead of letting it paint on
  // the empty track ahead of the head.
  assert.match(
    cssBody,
    /\.stages::after\s*\{[^}]*clip-path:\s*inset\(0 calc\(100% - var\(--fill\)\) 0 0 round 999px\);/s,
    "the fill is revealed by clip-path, which is what clips the highlight to it",
  );
  assert.doesNotMatch(
    cssBody,
    /\.stages li \+ li::before/,
    "the stage division belongs to the four labels; notches through the track read as a battery gauge",
  );
  assert.doesNotMatch(
    cssBody,
    /\.stages[^{}]*\{[^}]*radial-gradient/s,
    "no glowing head: a radial pulse on the fill is a gamer overlay, not a system screen",
  );
  // Three levels of label, so the row reads without the track.
  assert.match(css, /\.stages li\.is-done \{ color: var\(--kub-muted\); \}/);
  assert.match(css, /\.stages li\.is-active \{ color: var\(--kub-text\); \}/);

  // Nothing on this screen may borrow the skeleton's timing again. The head's
  // pulse is a multiple of --kub-motion-standard, several times longer than
  // .kub-skeleton's loop, and it is the only thing on the indicator that moves.
  for (const [label, sheet] of [
    ["startup.css", css],
    ["startup-overlay.css", readText("windows-tauri/ui/startup-overlay.css")],
  ]) {
    assert.doesNotMatch(
      sheet.replace(/\/\*[\s\S]*?\*\//g, ""),
      /var\(--kub-motion-shimmer\)/,
      `${label} must not animate on the skeleton's timing`,
    );
    for (const [, duration] of sheet.matchAll(/animation:[^;]*?calc\(var\(--kub-motion-standard\) \* (\d+)\)/g)) {
      assert.ok(
        Number(duration) >= 8,
        `${label} runs an ambient loop at ${duration}x220ms; it has to stay well clear of the 1200ms skeleton`,
      );
    }
  }
  assert.match(
    cssBody,
    /\.stages::after\s*\{[^}]*animation: stage-sheen calc\(var\(--kub-motion-standard\) \* \d+\)/s,
  );
  // The highlight is a claim that work is in flight. A halted sequence that
  // still shows movement says the shell is working on it; `recoverable_error`
  // is a screen the person sits in front of, so that claim would be a lie for
  // as long as they look at it.
  assert.match(
    cssBody,
    /body\[data-stage="complete"\] \.stages::after,\s*body\[data-stage="recoverable_error"\] \.stages::after \{ animation: none; \}/,
    "the sheen must stop when the sequence stops, both on success and on a halt",
  );
  assert.match(
    css,
    /prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.stages::after \{ animation: none; \}/,
    "the head's pulse must stop, not merely shorten",
  );
  assert.match(css, /prefers-reduced-motion/);
  assert.match(script, /letscube:\/\/startup-state/);
  assert.match(script, /startup_start_dragging/);
  assert.match(script, /startup_minimize/);
  assert.match(script, /startup_toggle_maximize/);
  assert.match(script, /startup_close_to_tray/);
  assert.match(script, /snapshot\.stage\s*===\s*"complete"\s*&&\s*snapshot\.connected\s*===\s*true/);
  assert.doesNotMatch(script, /setTimeout|setInterval/);

  const iconsDir = new URL("../../windows-tauri/icons/", import.meta.url);
  assert.equal(existsSync(iconsDir), true, "icons directory is missing");
  const iconNames = readdirSync(iconsDir).map((entry) => path.basename(entry).toLowerCase());
  assert.ok(iconNames.some((entry) => entry.endsWith(".ico")), "Windows icon asset is missing");
  assert.ok(iconNames.some((entry) => entry.endsWith(".png")), "PNG icon asset is missing");
});

/* A run of two-digit groups separated by spaces or colons — the shape a
 * fingerprint is written in. The markup used to carry four of them per side as
 * literals, which is what made the screen claim a comparison it never
 * performed. Nothing of that shape may be authored in either scene again. */
const FINGERPRINT_SHAPED = /\b[0-9A-Fa-f]{2}(?:[ :][0-9A-Fa-f]{2}){2,}\b/;

test("the startup scenes state no fingerprint they were not given", () => {
  const html = readText("windows-tauri/ui/startup.html");
  const overlayHtml = readText("windows-tauri/ui/startup-overlay.html");
  const script = readText("windows-tauri/ui/startup.js");
  const overlayScript = readText("windows-tauri/ui/startup-overlay.js");

  assert.doesNotMatch(html, FINGERPRINT_SHAPED, "startup.html must not author a fingerprint");
  assert.doesNotMatch(overlayHtml, FINGERPRINT_SHAPED, "startup-overlay.html must not author a fingerprint");
  assert.doesNotMatch(script, FINGERPRINT_SHAPED, "startup.js must not carry a fallback fingerprint");
  assert.doesNotMatch(overlayScript, FINGERPRINT_SHAPED, "startup-overlay.js must not carry a fallback fingerprint");

  // Both identity blocks ship empty; every digit in them is written from the
  // snapshot at runtime.
  for (const [name, markup] of [["startup.html", html], ["startup-overlay.html", overlayHtml]]) {
    for (const [, body] of markup.matchAll(/data-fingerprint-value[^>]*>([\s\S]*?)<\/span>/g)) {
      assert.equal(body.trim(), "", `${name} must leave the fingerprint value empty`);
    }
    assert.equal(
      (markup.match(/data-fingerprint-value/g) ?? []).length,
      2,
      `${name} must keep exactly one identity value per endpoint`,
    );
  }

  // Both scenes read the observed and the expected value from separate fields.
  // Rendering one value into both panels would be the same theatre with extra
  // steps, so the pair of reads is the contract, not the pair of panels.
  for (const [name, source] of [["startup.js", script], ["startup-overlay.js", overlayScript]]) {
    assert.match(source, /digestLines\(peer\?\.observedSha256[,)]/, `${name} must read the observed value`);
    assert.match(source, /digestLines\(peer\?\.expectedSha256[,)]/, `${name} must read the expected value`);
  }

  const digestLines = evaluateStartupHelper(script, "digestLines", ["normalizeDigest"]);
  const sha256 = "952f8c14a7be03d95c61f0428ab7d3e6510c9d27fa8b46e0193c7d5ab2ee908f";
  // Joined, because the helper runs in its own realm and its Array does not
  // share a prototype with this one.
  const lines = (value, full) => digestLines(value, full)?.join("\n") ?? null;

  // The quiet form is a prefix and says so. Four leading bytes without the
  // ellipsis would read as a whole fingerprint that happens to be short.
  assert.equal(lines(sha256, false), "95:2F:8C:14…");
  assert.equal(digestLines(sha256, false).length, 1, "the short form occupies one line");

  // The full form appears only where two values have to be compared, and then
  // it must carry all 32 bytes: a digest trimmed to fit is not comparable.
  assert.equal(
    lines(sha256, true),
    ["95:2F:8C:14:A7:BE:03:D9", "5C:61:F0:42:8A:B7:D3:E6", "51:0C:9D:27:FA:8B:46:E0", "19:3C:7D:5A:B2:EE:90:8F"].join("\n"),
  );
  assert.equal(digestLines(sha256, true).length, 4, "the full form occupies four lines");
  assert.equal(lines(sha256, true).replace(/[\n:]/g, "").length, 64, "the full form must lose no byte to the layout");
  assert.equal(
    lines("95:2F:8C:14:A7:BE:03:D9:5C:61:F0:42:8A:B7:D3:E6:51:0C:9D:27:FA:8B:46:E0:19:3C:7D:5A:B2:EE:90:8F", true),
    lines(sha256, true),
    "an already-grouped digest must format to the same four lines",
  );

  // Only the changed-pin state asks for the long form, so the screen stays
  // quiet while there is nothing to compare.
  assert.match(script, /renderPeer\(snapshot, peerChanged\)/, "the full digest belongs to the changed-pin state");
  // Anything that is not exactly 32 bytes of hex is refused rather than shown
  // in a shape a person would read as authoritative.
  for (const rejected of [
    undefined,
    null,
    42,
    "",
    sha256.slice(0, 62),
    `${sha256}ab`,
    `${sha256.slice(0, 63)}z`,
    "неизвестно",
  ]) {
    for (const full of [false, true]) {
      assert.equal(digestLines(rejected, full), null, `${String(rejected)} is not a SHA-256 and must not render`);
    }
  }

  // The issuer and the validity date arrive from the certificate, so they are
  // whatever answered the connection. They are bounded before they reach the
  // notice.
  const boundedField = evaluateStartupHelper(script, "boundedField");
  assert.equal(boundedField("Let's Encrypt R11", 48), "Let's Encrypt R11");
  assert.equal(boundedField("  Let's\n Encrypt  R11 ", 48), "Let's Encrypt R11");
  assert.equal(boundedField("x".repeat(400), 48).length, 48);
  assert.equal(boundedField("   ", 48), null);
  assert.equal(boundedField(123, 48), null);
});

test("the startup screen offers an override for a changed pin and never for a rejected chain", () => {
  const html = readText("windows-tauri/ui/startup.html");
  const script = readText("windows-tauri/ui/startup.js");

  // The hard failure — no connection, or a certificate the Windows trust store
  // rejected — carries a retry and nothing else. A control that continued past
  // it would turn a real interception into a dialog a person clicks through.
  const failureBlock = html.match(/<div id="startup-failure"[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.notEqual(failureBlock, "", "the hard-failure notice must remain in the markup");
  assert.deepEqual(
    [...failureBlock.matchAll(/<button[^>]*id="([^"]+)"/g)].map(([, id]) => id),
    ["startup-retry"],
    "the hard-failure notice must offer a retry and no other action",
  );
  assert.doesNotMatch(failureBlock, /accept_peer_change|is-quiet/);

  const mismatchBlock = html.match(/<div id="startup-mismatch"[\s\S]*?<div class="mismatch-actions">[\s\S]*?<\/div>/)?.[0] ?? "";
  assert.deepEqual(
    [...mismatchBlock.matchAll(/<button[^>]*id="([^"]+)"/g)].map(([, id]) => id),
    ["startup-mismatch-recheck", "startup-mismatch-continue"],
    "the changed-pin notice must offer a recheck first and the override second",
  );

  // The two notices are driven by two different states, and only the soft one
  // reaches the override.
  assert.match(
    script,
    /const peerChanged = snapshot\.stage === "recoverable_error" && snapshot\.errorCode === "peer_changed"/,
    "the override state must be its own error code, not a variant of the TLS failure",
  );
  assert.match(
    script,
    /const hardFailure = snapshot\.stage === "recoverable_error" && !peerChanged/,
    "every recoverable error that is not a changed pin must be the hard failure",
  );
  assert.match(script, /focusWhenRevealed\(mismatch, mismatchRecheck, peerChanged\)/);
  assert.match(script, /focusWhenRevealed\(failure, retry, hardFailure\)/);

  // The override command is wired to exactly one control, and it is the quiet
  // one inside the changed-pin notice.
  assert.deepEqual(
    [...script.matchAll(/(\w+)\.addEventListener\("click", \(\) => invokeGuarded\(\1, "startup_accept_peer_change"\)\)/g)]
      .map(([, control]) => control),
    ["mismatchContinue"],
    "startup_accept_peer_change must be reachable from the override control only",
  );
  assert.equal(
    (script.match(/startup_accept_peer_change/g) ?? []).length,
    1,
    "a second call site would be a second way past the check",
  );

  // Nothing in this directory may weaken transport security, whatever a state
  // is called. The override is about our own pin, never about validation.
  for (const name of ["startup.html", "startup.css", "startup.js", "startup-overlay.html", "startup-overlay.css", "startup-overlay.js"]) {
    const source = readText(`windows-tauri/ui/${name}`);
    assert.doesNotMatch(
      source,
      /danger(?:ous)?_accept_invalid|rejectUnauthorized|insecure[_-]?skip[_-]?verify|allow[_-]?invalid[_-]?cert/i,
      `${name} must not name a switch that disables certificate validation`,
    );
    assert.doesNotMatch(source, /http:\/\/(?:app|api)\.letscube\.ru/, `${name} must not name a plaintext LETSCUBE origin`);
  }

  // The override is per occurrence. A remembered "always allow" turns the
  // comparison into a habit and deletes the only signal it exists to give.
  assert.doesNotMatch(script, /localStorage|sessionStorage|alwaysAllow|remember/i);
});

test("the startup scenes never put the node's address in front of the person", () => {
  const libRs = readText("windows-tauri/src-tauri/src/lib.rs");
  const productionOrigin = libRs.match(/const PRODUCTION_ORIGIN: &str = "([^"]+)";/)?.[1] ?? null;
  assert.equal(typeof productionOrigin, "string", "PRODUCTION_ORIGIN must remain a single constant in lib.rs");

  // The product is heading for a distributed network. The host a given client
  // reaches will be one of many, so an address shown here would be a fact that
  // stops being true without anything on this screen changing — and it would
  // still be there in the failure and override copy, which is exactly where a
  // wrong one does the most damage. Both endpoints are named by their role.
  //
  // The host itself is checked, and the check is what the fingerprint attests
  // to. It is only never displayed. The origin lives in lib.rs, where it is
  // enforced and where a developer reads it.
  const host = new URL(productionOrigin).hostname;
  for (const name of [
    "startup.html",
    "startup.css",
    "startup.js",
    "startup-overlay.html",
    "startup-overlay.css",
    "startup-overlay.js",
  ]) {
    const source = readText(`windows-tauri/ui/${name}`);
    assert.equal(
      source.includes(host),
      false,
      `${name} names the node's host; the scenes must speak of the node by its role`,
    );
    assert.equal(
      source.includes(productionOrigin),
      false,
      `${name} names the node's origin; the scenes must speak of the node by its role`,
    );
  }
  // The overlay still guards on the origin — it must not mount on any other
  // page. It reaches that value through a placeholder the shell substitutes,
  // so the guard survives without the literal ever being in a rendered file.
  assert.match(
    readText("windows-tauri/ui/startup-overlay.js"),
    /window\.location\.origin !== __LETSCUBE_PRODUCTION_ORIGIN__/,
    "removing the address must not remove the overlay's origin guard",
  );

  const html = readText("windows-tauri/ui/startup.html");
  // The version is injected by startup_runtime_script, so it can never go
  // stale in the markup.
  assert.match(html, /data-desktop-version/);
  assert.doesNotMatch(html, /Desktop\s+\d+\.\d+\.\d+/);
});

test("the startup scenes carry the application's tokens and write no duration of their own", () => {
  const appCss = readText("artifacts/kub/src/index.css");
  const startupCss = readText("windows-tauri/ui/startup.css");
  const overlayCss = readText("windows-tauri/ui/startup-overlay.css");

  // windows-tauri/ui cannot import the application's stylesheet — it is served
  // as-is, with no build step — so the tokens are copied. This is what makes a
  // copy that drifted from its source a test failure rather than a colour
  // nobody notices.
  const appTokens = collectTokens(appCss, /^\.dark \{[\s\S]*?^\}/m);
  const rootTokens = collectTokens(appCss, /^:root \{[\s\S]*?^\}/m);
  for (const [name, value] of rootTokens) if (!appTokens.has(name)) appTokens.set(name, value);
  assert.ok(appTokens.size > 20, "the application's dark token block must be readable");

  for (const [label, css, pattern] of [
    ["startup.css", startupCss, /^:root \{[\s\S]*?^\}/m],
    ["startup-overlay.css", overlayCss, /^:host \{[\s\S]*?^\}/m],
  ]) {
    const copied = collectTokens(css, pattern);
    const compared = [...copied].filter(([name]) => appTokens.has(name));
    assert.ok(compared.length >= 10, `${label} must copy the application's tokens by their own names`);
    for (const [name, value] of compared) {
      assert.equal(
        value.toLowerCase(),
        appTokens.get(name).toLowerCase(),
        `${label} copied ${name} from artifacts/kub/src/index.css and has drifted from it`,
      );
    }
  }

  // Every duration must resolve to one of the five semantic tokens. A number
  // written here is outside the shared system and drifts silently — see
  // docs/operations/shared-motion-feedback.md. Zero is not a choice of speed,
  // so it is allowed.
  // Comments explain measurements in milliseconds; only declarations are scanned.
  const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));
  for (const [label, css] of [["startup.css", startupCss], ["startup-overlay.css", overlayCss]]) {
    for (const line of stripComments(css).split("\n")) {
      for (const [literal, amount] of line.matchAll(/\b(\d+(?:\.\d+)?)m?s\b/g)) {
        // 0 is no duration, and 1ms is the collapse that
        // docs/operations/shared-motion-feedback.md defines for reduced
        // motion. Neither is a speed chosen on this screen.
        if (Number(amount) === 0 || literal === "1ms") continue;
        assert.match(
          line,
          /--kub-motion-/,
          `${label} writes the duration ${literal} outside a motion token: ${line.trim()}`,
        );
      }
    }
    assert.match(css, /prefers-reduced-motion/, `${label} must honour the reduced-motion preference`);
    assert.match(
      css,
      /prefers-reduced-motion: reduce\)\s*\{[\s\S]*?--kub-motion-standard:\s*1ms/,
      `${label} must collapse the movement durations rather than each transition`,
    );
  }

  // Nothing that occupies space may be animated: a box that resizes while it is
  // being read cannot be measured, and moves the controls beside it.
  for (const [label, css] of [["startup.css", startupCss], ["startup-overlay.css", overlayCss]]) {
    for (const [, properties] of css.matchAll(/transition:\s*([^;]+);/g)) {
      assert.doesNotMatch(
        properties,
        /\b(?:width|height|padding|margin|inset|top|left|right|bottom|font-size|all)\b/,
        `${label} animates a property that changes a laid-out box: ${properties.trim()}`,
      );
    }
  }
});

test("production startup handoff keeps one stable scene long enough to read", () => {
  const html = readText("windows-tauri/ui/startup-overlay.html");
  const css = readText("windows-tauri/ui/startup-overlay.css");
  const script = readText("windows-tauri/ui/startup-overlay.js");

  assert.match(html, /startup-overlay-endpoint-client/);
  assert.match(html, /startup-overlay-endpoint-server/);
  assert.match(html, /data-testid="production-startup-client-port"/);
  assert.match(html, /data-testid="production-startup-server-port"/);
  assert.match(html, /__LETSCUBE_LOGO_SVG__/);
  assert.match(html, /startup-overlay-stages/);
  assert.match(css, /\.startup-overlay-endpoint-client\s*\{\s*grid-column:\s*1;/);
  assert.match(css, /\.startup-overlay-endpoint-server\s*\{\s*grid-column:\s*3;/);
  assert.match(css, /\.startup-overlay-fingerprint\s*\{[^}]*height:\s*74px;/s);
  assert.match(css, /grid-template-rows:\s*74px\s+20px\s+126px\s+20px\s+19px\s+4px\s+14px/);
  // The overlay's connector must be derived exactly as the startup window's is,
  // or the whole assembly shifts at the handoff. Same expressions, not the same
  // numbers written twice.
  assert.match(css, /\.startup-overlay-port-server\s*\{\s*left:\s*calc\(-1 \* var\(--node-offset\)\);\s*\}/);
  assert.match(css, /\.startup-overlay-port-client\s*\{\s*right:\s*calc\(-1 \* var\(--node-offset\)\);\s*\}/);
  assert.match(
    css,
    /\.startup-overlay-rail:first-child\s*\{[^}]*left:\s*calc\(25% - var\(--column-shift\) \+ var\(--device-half\) \+ var\(--node-offset\)\);/s,
  );
  assert.match(
    css,
    /\.startup-overlay-rail:last-child\s*\{[^}]*right:\s*calc\(25% - var\(--column-shift\) \+ var\(--node-half\) \+ var\(--node-offset\)\);/s,
  );
  // The constants must hold the same values in both scenes, so the two cannot
  // drift apart one number at a time.
  const startupCss = readText("windows-tauri/ui/startup.css");
  for (const name of [
    "--device-half",
    "--node-half",
    "--chassis-inset",
    "--column-shift",
    "--connector-node",
    "--conduit-height",
    "--conduit-core",
    "--connector-clear",
  ]) {
    const read = (sheet) => sheet.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim() ?? null;
    assert.notEqual(read(css), null, `${name} must be declared in both scenes`);
    assert.equal(
      read(css),
      read(startupCss),
      `${name} differs between the startup window and the overlay`,
    );
  }
  assert.match(script, /minimumVisibleDuration\s*=\s*2_200/);
  assert.match(script, /successHoldDuration\s*=\s*900/);
  assert.match(script, /Math\.max\(minimumVisibleDuration[^)]*successHoldDuration/s);
});

test("Windows Tauri exposes main-WebView automation only through a debug-only opt-in port", () => {
  const libRs = readText("windows-tauri/src-tauri/src/lib.rs");

  assert.match(libRs, /LETSCUBE_WEBVIEW2_DEBUG_PORT/);
  assert.match(libRs, /additional_browser_args/);
  assert.match(
    libRs,
    /#\[cfg\(debug_assertions\)\]\s*fn debug_browser_args\(\)/,
    "release builds must ignore the WebView2 automation port",
  );
  assert.doesNotMatch(
    libRs,
    /#\[cfg\(not\(debug_assertions\)\)\]\s*fn debug_browser_args\(\)/,
    "release builds must not compile a debug browser helper",
  );
  assert.doesNotMatch(
    libRs,
    /--remote-allow-origins=\*/,
    "debug automation must not allow arbitrary remote origins",
  );
});

test("Windows Tauri QA wrapper owns an isolated process, profile and loopback CDP endpoint", () => {
  const scriptPath = new URL("../../scripts/windows-tauri-qa.mjs", import.meta.url);
  assert.equal(existsSync(scriptPath), true, "Windows Tauri QA wrapper is missing");
  const script = readFileSync(scriptPath, "utf8");

  assert.match(script, /LETSCUBE_WEBVIEW2_DATA_DIR/);
  assert.match(script, /LETSCUBE_WEBVIEW2_DEBUG_PORT/);
  assert.match(script, /LETSCUBE_TAURI_QA_HOLD_PREFLIGHT/);
  assert.match(script, /LETSCUBE_TAURI_CDP_URL/);
  assert.match(script, /windows-tauri-shell\.spec\.ts/);
  assert.match(script, /chromium-desktop-1440/);
  assert.match(script, /--output/);
  assert.match(script, /windows-tauri-qa/);
  assert.match(script, /mkdtemp/);
  assert.match(script, /rmSync/);
  assert.match(script, /tasklist/i);
  assert.match(script, /qaProcess\s*=\s*spawn[\s\S]*client\s*=\s*spawn/);
  assert.doesNotMatch(script, /startsWith\("https:\/\/app\.letscube\.ru/);
  assert.match(script, /process\.on\("SIGINT"/);
  assert.match(script, /process\.on\("SIGTERM"/);
  assert.doesNotMatch(script, /process\.once\("SIG(?:INT|TERM)"/);
  assert.match(script, /cleanupOwnedResources/);
  assert.match(script, /process\.exitCode\s*=\s*1/);
  assert.match(script, /existsSync\(profilePath\)/);
  assert.doesNotMatch(script, /remote-allow-origins=\*/);

  const spec = readText("tests/e2e/windows-tauri-shell.spec.ts");
  assert.match(spec, /validateCdpUrl/);
  assert.match(spec, /hostname\s*!==\s*"127\.0\.0\.1"/);
  assert.match(spec, /protocol\s*!==\s*"http:"/);
  assert.match(spec, /await page\.reload/);
  assert.match(spec, /startup-center-seal/);
  assert.match(spec, /startup-status/);
  assert.match(spec, /contexts\(\)\.flatMap/);
  assert.match(spec, /waitForURL/);
  assert.match(spec, /connectToTauri/);
});

test("Windows lifecycle QA modes are bounded to debug state sources", () => {
  const wrapper = readText("scripts/windows-tauri-qa.mjs");
  const startupSpecPath = new URL("../../tests/e2e/windows-tauri-startup.spec.ts", import.meta.url);
  const libRs = readText("windows-tauri/src-tauri/src/lib.rs");
  const tauriConfig = readJson("windows-tauri/src-tauri/tauri.conf.json");
  const modes = [
    "success",
    "offline",
    "catalog_failure",
    "normal_update",
    "critical_update",
  ];

  assert.equal(existsSync(startupSpecPath), true, "dedicated startup lifecycle spec is missing");
  assert.match(wrapper, /LETSCUBE_TAURI_QA_STARTUP_MODE/);
  assert.match(wrapper, /windows-tauri-startup\.spec\.ts/);
  for (const mode of modes) {
    assert.match(wrapper, new RegExp(`["']${mode}["']`), `${mode} QA mode is not orchestrated`);
  }

  assert.match(
    libRs,
    /#\[cfg\(debug_assertions\)\][\s\S]*fn qa_startup_mode\(\)[\s\S]*LETSCUBE_TAURI_QA_STARTUP_MODE/,
    "QA mode lookup must compile only in debug builds",
  );
  assert.doesNotMatch(
    libRs,
    /#\[cfg\(not\(debug_assertions\)\)\][\s\S]*fn qa_startup_mode/,
    "release builds must not compile a startup QA mode helper",
  );
  assert.match(libRs, /QaStartupMode::Offline/);
  assert.match(libRs, /QaStartupMode::CatalogFailure/);
  assert.match(libRs, /QaStartupMode::NormalUpdate/);
  assert.match(libRs, /QaStartupMode::CriticalUpdate/);
  assert.doesNotMatch(
    libRs,
    /qa_startup_mode[\s\S]{0,900}(PRODUCTION_ORIGIN|update_endpoint|updater_builder|pubkey)/,
    "debug injection must not replace production origin, updater endpoint, or signing key",
  );

  assert.equal(tauriConfig.app.windows[0].url, "startup.html");
  assert.deepEqual(tauriConfig.plugins.updater.endpoints ?? [], []);
  assert.equal(typeof tauriConfig.plugins.updater.pubkey, "string");
  assert.ok(tauriConfig.plugins.updater.pubkey.length > 40);
});

test("Windows lifecycle fixtures are deterministic and cleanup remains single-flight", () => {
  const wrapper = readText("scripts/windows-tauri-qa.mjs");
  const libRs = readText("windows-tauri/src-tauri/src/lib.rs");
  const fixtureState = libRs.match(
    /#\[cfg\(debug_assertions\)\]\s*fn apply_qa_update_state[\s\S]*?(?=\nfn desktop_bridge_script)/,
  )?.[0] ?? "";

  assert.match(
    fixtureState,
    /state\.set_channel\(UpdateChannel::Stable\)/,
    "debug fixture state must not inherit a persisted Test channel",
  );
  assert.match(
    wrapper,
    /cleanupPromise:\s*null/,
    "each spawned scenario must retain one shared cleanup promise",
  );
  assert.match(
    wrapper,
    /scenario\.cleanupPromise/,
    "signal and finally cleanup must converge on the same promise",
  );
});

test("Windows lifecycle wrapper owns a profile before either child can exist", () => {
  const wrapper = readText("scripts/windows-tauri-qa.mjs");
  const scenarioSetup = wrapper.match(
    /async function runScenario[\s\S]*?(?=\nfunction runningClientImage)/,
  )?.[0] ?? "";
  assert.notEqual(scenarioSetup, "", "runScenario must remain the scenario entry point");

  assert.match(
    scenarioSetup,
    /const profilePath = dataRoot\s*\?\s*null\s*:\s*mkdtempSync\([^\n]+\);\s*const scenario = \{\s*profilePath,\s*qaProcess: null,\s*client: null,\s*cleanupPromise: null,?\s*\};\s*activeScenario = scenario;\s*try \{/,
    "profile ownership must be registered immediately before setup or a child spawn can race a signal",
  );
  assert.match(scenarioSetup, /scenario\.qaProcess = spawn\(/);
  assert.match(scenarioSetup, /scenario\.client = spawn\(/);
  assert.match(scenarioSetup, /cleanupOwnedResources\(scenario\)/);
});

test("Windows lifecycle spec observes real native updater UI and all startup text geometry", () => {
  const spec = readText("tests/e2e/windows-tauri-startup.spec.ts");

  assert.match(spec, /loginAsRoleOrSkip/);
  assert.match(spec, /desktop-update-pill/);
  assert.match(spec, /desktop-critical-update-gate/);
  assert.match(spec, /startup-client-fingerprint.*span/);
  assert.match(spec, /startup-server-fingerprint.*span/);
  assert.match(spec, /\.endpoint-client h2/);
  assert.match(spec, /\.endpoint-client p/);
  assert.match(spec, /\.endpoint-server h2/);
  assert.match(spec, /\.endpoint-server p/);
  assert.match(spec, /\.stages li/);
  assert.match(spec, /startup-offline-retry-\$\{viewport\.width\}x\$\{viewport\.height\}/);
});

test("Windows storage QA owns a data root instead of the user's own AppData", () => {
  const wrapper = readText("scripts/windows-tauri-qa.mjs");
  const suite = readText("scripts/windows-tauri-storage-suite.mjs");
  const libRs = readText("windows-tauri/src-tauri/src/lib.rs");

  assert.equal(
    rootPackage.scripts["windows:tauri:qa:storage"],
    "set LETSCUBE_TAURI_QA_SUITE=storage&& node scripts/windows-tauri-qa.mjs",
  );

  // The seam only exists so the relocation code can be run at all. It must stay
  // debug-only, and it must be the single way the shell finds its own root, or
  // a phase would record a move of the user's real profile.
  const root = libRs.match(/fn app_data_root[\s\S]*?\n}/)?.[0] ?? "";
  assert.match(root, /#\[cfg\(debug_assertions\)\]\s*if let Some\(value\) = std::env::var_os\("LETSCUBE_APP_DATA_DIR"\)/);
  assert.match(root, /path\.is_absolute\(\)/, "a relative root is not isolation");
  assert.match(root, /app\.path\(\)\.app_local_data_dir\(\)/);
  assert.equal(
    [...libRs.matchAll(/app_local_data_dir\(\)/g)].length,
    1,
    "app_local_data_dir must be reached only through app_data_root",
  );
  for (const site of ["storage_settings_path", "default_profile_dir"]) {
    const body = libRs.match(new RegExp(`fn ${site}[\\s\\S]*?\\n}`))?.[0] ?? "";
    assert.match(body, /app_data_root\(app\)\?/, `${site} must resolve through app_data_root`);
  }

  // The relocation runs before a window exists, because WebView2 locks a live
  // profile and the session lives inside it.
  assert.match(
    libRs,
    /settle_storage_before_launch\(app\.handle\(\)\);[\s\S]{0,200}?build_main_window\(app\.handle\(\)\)\?;/,
    "a profile may only be moved before the window that would lock it is built",
  );

  assert.match(wrapper, /clientEnv\.LETSCUBE_APP_DATA_DIR = dataRoot;/);
  assert.match(
    wrapper,
    /if \(dataRoot\) \{[\s\S]*?delete clientEnv\.LETSCUBE_WEBVIEW2_DATA_DIR;/,
    "pinning the profile would step over the very code the suite exists to run",
  );
  assert.match(wrapper, /conflictingImages/);
  assert.match(wrapper, /"LETSCUBE\.exe"/, "a running release client shares the single-instance identity");
  assert.match(
    wrapper,
    /let failures = \[\];[\s\S]*?if \(scenario\.verify\)/,
    "the tree must be measured even when a phase's spec failed",
  );

  assert.match(suite, /refuses a data root outside the temporary directory/);
  assert.match(suite, /refuses a data root inside the user's own profile/);
  assert.match(suite, /requires an empty data root/);
  assert.match(
    suite,
    /LETSCUBE_APP_DATA_DIR was not honoured/,
    "the suite must abort before recording a move if the seam was ignored",
  );
});

test("the Windows cache list the harness measures is the list the shell clears", async () => {
  const { CACHE_SUBDIRECTORIES, readCacheSubdirectoriesFromRust, SESSION_SUBDIRECTORIES } =
    await import("../../scripts/windows-tauri-storage.mjs");
  const repoRootPath = fileURLToPath(repoRoot);

  assert.deepEqual(
    readCacheSubdirectoriesFromRust(repoRootPath),
    [...CACHE_SUBDIRECTORIES],
    "storage.rs and the QA harness must agree on which directories are only cache",
  );
  assert.equal(CACHE_SUBDIRECTORIES.length, 9);
  for (const entry of CACHE_SUBDIRECTORIES) {
    for (const session of SESSION_SUBDIRECTORIES) {
      assert.notEqual(entry, session, `${entry} carries the session and must never be cleared`);
      assert.equal(
        entry.startsWith(`${session}/`),
        false,
        `${entry} sits inside the session directory ${session}`,
      );
    }
  }
});

/* The storage suite once reported, in one run, that a relocation had left eight
 * of 154 files behind and that all 154 had arrived. Neither sentence was a
 * measurement of what it claimed: the failure came from an inventory that threw
 * away every file it could not open, and the note was prose that said "all"
 * whatever the failure had just found. These four hold both halves shut. */

test(
  "an inventory records a file it can see but cannot read",
  { skip: process.platform !== "win32" ? "only Windows opens files unshared" : false },
  async () => {
    const { inventory, localStorageHoldsOnDisk } = await import(
      "../../scripts/windows-tauri-storage.mjs"
    );
    const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = await import("node:fs");
    const { spawn } = await import("node:child_process");
    const os = await import("node:os");

    // A leveldb `LOCK` is opened with no sharing at all for as long as the
    // engine runs, and the cookie store with it. This is that, exactly.
    const root = mkdtempSync(path.join(os.tmpdir(), "letscube-inventory-test-"));
    const leveldb = path.join(root, "EBWebView/Default/Local Storage/leveldb");
    mkdirSync(leveldb, { recursive: true });
    writeFileSync(path.join(leveldb, "000003.log"), "a session would live in here");
    const held = path.join(leveldb, "LOCK");
    writeFileSync(held, "");

    const holder = spawn(
      "pwsh",
      [
        "-NoLogo",
        "-NoProfile",
        "-Command",
        `$s=[System.IO.File]::Open('${held.replaceAll("\\", "\\\\")}','Open','ReadWrite','None');` +
          "Write-Output HELD; Start-Sleep -Seconds 30; $s.Close()",
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    try {
      await new Promise((resolve, reject) => {
        holder.on("error", reject);
        holder.stdout.on("data", (chunk) => {
          if (String(chunk).includes("HELD")) resolve();
        });
      });

      const entries = inventory(leveldb);
      assert.ok(
        entries.has("LOCK"),
        "a file that is on disk must be in the inventory whether or not its bytes could be read",
      );
      assert.equal(entries.get("LOCK").unreadable, true, "and must say that they could not");
      assert.equal(entries.get("LOCK").sha256, null);
      assert.equal(entries.get("000003.log").unreadable, false);
      assert.notEqual(entries.get("000003.log").sha256, null);

      // The suite's strongest instrument. A held file makes the answer unknown,
      // and reporting a lost session on that basis is the failure this replaces.
      assert.throws(
        () => localStorageHoldsOnDisk(root, "__letscubeStorageQaMarker"),
        /unknown rather than false/,
      );
    } finally {
      holder.kill();
      for (let attempt = 0; attempt < 20 && existsSync(root); attempt += 1) {
        try {
          rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
        } catch {
          // The holder may not be gone yet.
        }
        if (!existsSync(root)) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  },
);

test("a byte comparison does not invent a difference it never saw", async () => {
  const { missingOrChanged } = await import("../../scripts/windows-tauri-storage.mjs");
  const before = new Map([["LOCK", { size: 0, sha256: "abc", unreadable: false }]]);

  assert.deepEqual(
    missingOrChanged(before, new Map([["LOCK", { size: 0, sha256: null, unreadable: true }]])),
    [],
    "bytes that could not be read are unknown, not changed",
  );
  assert.deepEqual(
    missingOrChanged(before, new Map([["LOCK", { size: 1, sha256: null, unreadable: true }]])),
    ["LOCK (resized)"],
    "a length is still a fact about a file nobody could open",
  );
  assert.deepEqual(missingOrChanged(before, new Map()), ["LOCK (gone)"]);
  assert.deepEqual(
    missingOrChanged(before, new Map([["LOCK", { size: 0, sha256: "def", unreadable: false }]])),
    ["LOCK (changed)"],
  );
});

test("a relocation is read once, so a failure and a measurement cannot disagree", async () => {
  const { arrival } = await import("../../scripts/windows-tauri-storage.mjs");
  const owed = ["Network/Cookies", "Session Storage/LOCK", "Local Storage/leveldb/CURRENT"];

  const whole = arrival(owed, new Map(owed.map((key) => [key, {}])));
  assert.equal(whole.complete, true);
  assert.equal(whole.summary, "all 3 non-cache paths arrived");

  const short = arrival(owed, new Map([["Local Storage/leveldb/CURRENT", {}]]));
  assert.equal(short.complete, false);
  assert.deepEqual(short.missing, ["Network/Cookies", "Session Storage/LOCK"]);
  assert.doesNotMatch(
    short.summary,
    /\ball 3\b/,
    "the sentence a passing run prints must not be reachable from a failing one",
  );
  assert.match(short.summary, /1 of 3 non-cache paths arrived and 2 did not/);
});

test("no storage measurement can assert a verdict its own phase could contradict", () => {
  const suite = readText("scripts/windows-tauri-storage-suite.mjs");

  // "all ${n}" is a claim of completeness with a number pasted into it, which
  // is what the note said while the failure beside it named eight missing
  // files. Only `arrival` may say "all", and only when it has just counted.
  assert.doesNotMatch(
    suite,
    /\ball \$\{/,
    "a phase must report the count it measured rather than assert completeness",
  );
  // The harness cannot see the window, so it may not report on it: `verify`
  // runs even when the phase's spec failed.
  assert.doesNotMatch(suite, /signed in/);
  for (const phase of ["the move did not carry", "the second move did not carry"]) {
    assert.ok(
      suite.includes(`${phase} every non-cache file: \${carried.summary}`),
      `${phase} must be worded from the same reading as its note`,
    );
  }
  assert.equal(
    [...suite.matchAll(/\$\{carried\.summary\}/g)].length,
    4,
    "each of the two moves states its one reading twice: once as a failure, once as a measurement",
  );

  // And the reading itself must be taken from a tree nothing is still holding,
  // which is what `prepare` always did and `verify` never did.
  assert.match(
    suite,
    /scenarios: scenarios\.map\(\(scenario\) => \(\{[\s\S]*?const held = stillHeld\(\);\s*return held \? \[held\] : scenario\.verify\(\);/,
    "every phase's verify must settle the tree first, and not by remembering to",
  );
});

test("Windows update UI contract confirms Test to Stable reversal", () => {
  const spec = readText("tests/e2e/windows-tauri-shell.spec.ts");

  assert.match(spec, /set:stable/);
  assert.match(
    spec,
    /\[\s*"set:test",\s*"check",\s*"set:stable",\s*"check",?\s*\]/,
  );
  assert.match(
    spec,
    /toMatchObject\(\{\s*channel: "stable",\s*phase: "current",\s*mandatory: false,?\s*\}\)/,
  );
});
