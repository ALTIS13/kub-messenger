pub mod startup;
pub mod storage;
pub mod updater;

use std::future::Future;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Deserialize;
use startup::{PeerIdentity, StartupErrorCode, StartupSnapshot, StartupStage, StartupState};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{
    AppHandle, Emitter, Manager, Runtime, State, Url, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::{Update, UpdaterExt};
use updater::{
    load_update_channel, parse_update_metadata, store_update_channel, update_endpoint,
    DesktopUpdatePhase, DesktopUpdateSnapshot, DesktopUpdateState, UpdateChannel,
};

const PRODUCTION_ORIGIN: &str = "https://app.letscube.ru";
const API_ORIGIN: &str = "https://api.letscube.ru";
const PRODUCTION_URL: &str = "https://app.letscube.ru/";
const BUNDLED_STARTUP_URL: &str = "http://tauri.localhost/startup.html";
const PRODUCTION_PROFILE: &str = "webview-production-v1";
const UPDATE_CHANNEL_FILE: &str = "updater-channel.json";
const STORAGE_SETTINGS_FILE: &str = "storage-settings.json";
/// Where the fingerprint of the node's certificate is remembered between runs.
/// Reached through app_data_root like every other file the shell owns, so the
/// storage QA harness relocates it with the rest of the profile.
const PEER_TRUST_FILE: &str = "node-trust.json";
/// A trust record is 64 hex characters and a timestamp. Anything larger is not
/// one, and is refused without being parsed.
const MAX_PEER_TRUST_BYTES: u64 = 4 * 1024;
const UPDATE_TIMEOUT: Duration = Duration::from_secs(8);
const STARTUP_EVENT: &str = "letscube://startup-state";
const DESKTOP_NOTIFICATION_ACTION_EVENT: &str = "letscube:desktop-notification-action";
const WINDOWS_NOTIFICATION_SCHEME: &str = "letscube-notification";
const WINDOWS_APP_ID: &str = "ru.letscube.messenger";
const DESKTOP_BUILD: &str = env!("LETSCUBE_DESKTOP_BUILD");
static MAIN_READY: AtomicBool = AtomicBool::new(false);
static PREFLIGHT_RUNNING: AtomicBool = AtomicBool::new(false);
#[cfg(debug_assertions)]
static QA_OFFLINE_FAILURE_EMITTED: AtomicBool = AtomicBool::new(false);

struct StartupController(Mutex<StartupState>);

struct PendingNotificationRoute(Mutex<Option<String>>);

struct NativeUpdateState {
    state: DesktopUpdateState,
    pending: Option<Update>,
}

struct UpdateController {
    inner: Mutex<NativeUpdateState>,
    channel_path: PathBuf,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct DesktopNotificationRequest {
    id: u32,
    title: String,
    body: String,
    kind: String,
    group: String,
    header: Option<DesktopNotificationHeader>,
    route: String,
    icon: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct DesktopNotificationHeader {
    id: String,
    title: String,
    route: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct DesktopNotificationIdentity {
    id: u32,
    kind: String,
    group: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PreflightEntry {
    RunHttps,
    Reject,
}

fn is_allowed_navigation(url: &Url) -> bool {
    url.scheme() == "https" && url.origin().ascii_serialization() == PRODUCTION_ORIGIN
}

fn is_local_startup_url(url: &Url) -> bool {
    url.as_str() == BUNDLED_STARTUP_URL
}

fn require_production_main(window: &WebviewWindow) -> Result<(), &'static str> {
    if window.label() != "main"
        || window
            .url()
            .map(|url| !is_allowed_navigation(&url))
            .unwrap_or(true)
    {
        return Err("unauthorized");
    }
    Ok(())
}

fn require_startup_main(window: &WebviewWindow) -> Result<(), &'static str> {
    if window.label() != "main"
        || window
            .url()
            .map(|url| !is_local_startup_url(&url))
            .unwrap_or(true)
    {
        return Err("unauthorized");
    }
    Ok(())
}

fn is_safe_external_url(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "mailto")
        && url.username().is_empty()
        && url.password().is_none()
}

/// The directory this shell keeps its own files in.
///
/// Debug builds accept a replacement so QA can own the whole storage chain —
/// the settings file, the default profile and the relocation performed between
/// them — instead of only the profile. `LETSCUBE_WEBVIEW2_DATA_DIR` cannot do
/// that job: it pins the profile path outright and so steps over the very code
/// a relocation lives in, which is how that code reached users unrun. A release
/// build has no such door and can only ever answer with the user's own AppData.
fn app_data_root<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<PathBuf> {
    #[cfg(debug_assertions)]
    if let Some(value) = std::env::var_os("LETSCUBE_APP_DATA_DIR") {
        let path = PathBuf::from(value);
        // A relative root would resolve against whatever directory the process
        // happened to start in, which is not isolation.
        if path.is_absolute() {
            return Ok(path);
        }
    }

    app.path().app_local_data_dir()
}

/// SHA-256 of the DER leaf certificate, lowercase hex.
///
/// The bytes come off a response that reqwest already returned `Ok` for, which
/// means rustls had validated the chain against the platform roots and matched
/// the hostname before this function can be reached. This is a fingerprint of
/// an already-trusted certificate, never a substitute for trusting it: there is
/// no custom verifier anywhere in this file and no path that accepts an invalid
/// chain.
fn certificate_fingerprint(der: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(der);
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(hex, "{byte:02x}");
    }
    hex
}

fn peer_trust_path<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<PathBuf> {
    Ok(app_data_root(app)?.join(PEER_TRUST_FILE))
}

/// The recorded fingerprint, or None when there is nothing to compare against —
/// a first run, a cleared profile, or a file that is not a record this version
/// wrote. A damaged record reads as "no record": it re-adopts on the next
/// success rather than accusing the node of changing.
fn load_peer_trust<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let path = peer_trust_path(app).ok()?;
    let file = std::fs::File::open(&path).ok()?;
    if file.metadata().ok()?.len() > MAX_PEER_TRUST_BYTES {
        return None;
    }
    let mut bytes = Vec::new();
    std::io::Read::read_to_end(
        &mut std::io::Read::take(file, MAX_PEER_TRUST_BYTES + 1),
        &mut bytes,
    )
    .ok()?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let recorded = value.get("sha256")?.as_str()?;
    is_fingerprint(recorded).then(|| recorded.to_ascii_lowercase())
}

/// 32 bytes of lowercase hex and nothing else. Guards both what is written to
/// the record and what is read back out of it.
fn is_fingerprint(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn store_peer_trust<R: Runtime>(app: &AppHandle<R>, fingerprint: &str) {
    if !is_fingerprint(fingerprint) {
        return;
    }
    let Ok(path) = peer_trust_path(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let record = serde_json::json!({ "sha256": fingerprint });
    if let Ok(text) = serde_json::to_string(&record) {
        let _ = std::fs::write(path, text);
    }
}

fn storage_settings_path<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<PathBuf> {
    Ok(app_data_root(app)?.join(STORAGE_SETTINGS_FILE))
}

fn default_profile_dir<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<PathBuf> {
    Ok(app_data_root(app)?.join(PRODUCTION_PROFILE))
}

fn production_profile_dir<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<PathBuf> {
    #[cfg(debug_assertions)]
    if let Some(path) = std::env::var_os("LETSCUBE_WEBVIEW2_DATA_DIR") {
        return Ok(PathBuf::from(path));
    }

    let default = default_profile_dir(app)?;
    let settings = storage::load_settings(&storage_settings_path(app)?);
    Ok(settings
        .location
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .unwrap_or(default))
}

/// Carries out a recorded relocation and trims an over-budget cache.
///
/// Called once, before any window is built. WebView2 holds exclusive locks on
/// a live profile, so this is the only moment either is possible.
fn settle_storage_before_launch<R: Runtime>(app: &AppHandle<R>) {
    let Ok(settings_path) = storage_settings_path(app) else {
        return;
    };
    let mut settings = storage::load_settings(&settings_path);

    if let Some(target) = settings.pending_location.clone() {
        let target = PathBuf::from(&target);
        let current = settings
            .location
            .clone()
            .map(PathBuf::from)
            .or_else(|| default_profile_dir(app).ok())
            .unwrap_or_else(|| target.clone());
        // Set once the new location has been durably written down.
        let mut recorded = false;
        if target.is_absolute() && target != current {
            // The new location is written down BEFORE the old copy is removed,
            // and the move is abandoned if that write fails.
            //
            // The previous order removed the original first and then wrote the
            // settings with `let _ =`. A failing write — a full disk, an
            // antivirus lock — left the settings naming a directory that no
            // longer existed; WebView2 recreated it empty at the next launch
            // and the person was signed out with their data stranded at a path
            // nothing referenced. Reproduced end to end on the real client:
            // 210 files moved, settings unwritten, /login with no auth keys.
            //
            // Committing first makes that failure harmless: the settings still
            // name the original, the original is still whole, and the only cost
            // is a duplicate copy left at the target.
            let mut committed = settings.clone();
            committed.location = Some(target.to_string_lossy().into_owned());
            committed.pending_location = None;
            let settings_path_for_commit = settings_path.clone();
            match storage::apply_pending_move(&current, &target, || {
                storage::store_settings(&settings_path_for_commit, &committed)
            }) {
                // Either outcome means the profile is at the target and
                // recorded there. `MovedWithLeftovers` differs only in that
                // stale bytes remain at the old path, which is rubbish to
                // collect, not a reason to revert anything.
                Ok(_) => {
                    settings = committed;
                    recorded = true;
                }
                Err(_) => {
                    // Nothing was committed, so the original is still whole and
                    // still the recorded location. Clear the request rather
                    // than retrying a failing copy on every launch.
                }
            }
        }
        if !recorded {
            settings.pending_location = None;
            let _ = storage::store_settings(&settings_path, &settings);
        }
    }

    if let Ok(profile) = production_profile_dir(app) {
        if storage::cache_size(&profile) > settings.cache_limit_bytes {
            let _ = storage::clear_cache(&profile);
        }
    }
}

#[cfg(debug_assertions)]
fn debug_browser_args() -> Option<String> {
    let port = std::env::var("LETSCUBE_WEBVIEW2_DEBUG_PORT")
        .ok()?
        .parse::<u16>()
        .ok()?;
    if port < 1024 {
        return None;
    }

    Some(format!(
        "--remote-debugging-port={port} --remote-allow-origins=http://127.0.0.1:{port}"
    ))
}

#[cfg(debug_assertions)]
fn qa_holds_preflight() -> bool {
    std::env::var("LETSCUBE_TAURI_QA_HOLD_PREFLIGHT").as_deref() == Ok("1")
}

/// Whether this launch is the harness's own, and so must not be the installed
/// client's twin.
///
/// `tauri-plugin-single-instance` names its mutex, window class and window
/// after `config.identifier` and offers no Windows-side override — only a
/// Linux `dbus_id`. So to Windows the isolated QA build and the installed
/// client were one instance: launching QA while LETSCUBE was open handed the
/// launch straight to the installed client and left the suite waiting on a
/// window that was never built. The harness refused to start rather than do
/// that, which stopped the 0.2.13 and 0.2.14 releases until someone closed the
/// application by hand.
///
/// Two gates on purpose. The whole branch is compiled out of release builds, so
/// the shipped identity cannot move; and even a debug build takes it only when
/// the harness asks, so `tauri dev` keeps the shipped identity and a
/// developer's own profile with it.
#[cfg(debug_assertions)]
fn qa_wants_isolated_identity() -> bool {
    std::env::var("LETSCUBE_TAURI_QA_ISOLATED_IDENTITY").as_deref() == Ok("1")
}

/// The identity an isolated QA launch runs under.
///
/// A suffix rather than an unrelated name, so anything this leaves on the
/// machine is recognisably ours. `identifier` also names
/// `%LOCALAPPDATA%\<identifier>`, and that is the point rather than a side
/// effect: until this existed every QA run wrote its update channel and its
/// node-trust record into the installed client's own directory.
///
/// What it does *not* move: the toast AUMID (`WINDOWS_APP_ID`, a separate
/// constant), the `letscube-notification` scheme (registered by the installer,
/// never by this process), the updater endpoint and its signing key, and the
/// tray, which is per-process and never keyed by identifier.
#[cfg(debug_assertions)]
fn qa_isolated_identifier(shipped: &str) -> String {
    format!("{shipped}.qa")
}

#[cfg(debug_assertions)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum QaStartupMode {
    Success,
    Offline,
    CatalogFailure,
    NormalUpdate,
    CriticalUpdate,
}

#[cfg(debug_assertions)]
fn qa_startup_mode() -> Option<QaStartupMode> {
    match std::env::var("LETSCUBE_TAURI_QA_STARTUP_MODE").as_deref() {
        Ok("success") => Some(QaStartupMode::Success),
        Ok("offline") => Some(QaStartupMode::Offline),
        Ok("catalog_failure") => Some(QaStartupMode::CatalogFailure),
        Ok("normal_update") => Some(QaStartupMode::NormalUpdate),
        Ok("critical_update") => Some(QaStartupMode::CriticalUpdate),
        _ => None,
    }
}

#[cfg(debug_assertions)]
fn qa_should_fail_network_once() -> bool {
    matches!(qa_startup_mode(), Some(QaStartupMode::Offline))
        && !QA_OFFLINE_FAILURE_EMITTED.swap(true, Ordering::AcqRel)
}

#[cfg(debug_assertions)]
fn qa_skips_catalog_source() -> bool {
    matches!(qa_startup_mode(), Some(QaStartupMode::CatalogFailure))
}

#[cfg(debug_assertions)]
fn apply_qa_update_state(state: &mut DesktopUpdateState) {
    let Some(mode) = qa_startup_mode() else {
        return;
    };

    // QA fixtures replace only the observed state and never inherit a user's channel choice.
    state.set_channel(UpdateChannel::Stable);
    match mode {
        QaStartupMode::Success => {
            let _ = state.begin_check();
            let _ = state.mark_current();
        }
        QaStartupMode::CatalogFailure => {
            state.fail("update_check_failed");
        }
        QaStartupMode::NormalUpdate => {
            let _ = state.begin_check();
            let _ = state.mark_available("0.2.1", false, Some(1_572_864));
        }
        QaStartupMode::CriticalUpdate => {
            let _ = state.begin_check();
            state.set_mandatory(true);
            let _ = state.mark_available("0.3.0", true, Some(1_835_008));
        }
        QaStartupMode::Offline => {}
    }
}

fn desktop_bridge_script() -> String {
    format!(
        r#"
(() => {{
  if (window.location.origin !== {origin:?}) return;
  const runtimeInfo = Object.freeze({{
    platform: "windows",
    version: {version:?},
    build: {build}
  }});
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  const call = (command, args) => typeof invoke === "function"
    ? invoke(command, args)
    : Promise.reject("desktop_runtime_unavailable");
  window.letscubeDesktop = Object.freeze({{
    platform: "windows",
    version: runtimeInfo.version,
    build: runtimeInfo.build,
    getRuntimeInfo: async () => runtimeInfo,
    getUpdateState: async () => call("desktop_get_update_state"),
    getUpdateChannel: async () => call("desktop_get_update_channel"),
    setUpdateChannel: async (channel) => call("desktop_set_update_channel", {{ channel }}),
    checkUpdate: async () => call("desktop_check_update"),
    installUpdate: async () => call("desktop_install_update"),
    showMain: async () => call("desktop_show_main"),
    isMainForeground: async () => call("desktop_is_main_foreground"),
    notify: async (notification) => call("desktop_notify", {{ notification }}),
    removeNotification: async (notification) => call("desktop_remove_notification", {{ notification }}),
    takePendingNotificationRoute: async () => call("desktop_take_pending_notification_route"),
    startDragging: async () => call("desktop_start_dragging"),
    minimize: async () => call("desktop_minimize"),
    toggleMaximize: async () => call("desktop_toggle_maximize"),
    isMaximized: async () => call("desktop_is_maximized"),
    closeToTray: async () => call("desktop_close_to_tray"),
    getStorageState: async () => call("desktop_get_storage_state"),
    setStorageLocation: async (location) => call("desktop_set_storage_location", {{ location }}),
    setCacheLimit: async (bytes) => call("desktop_set_cache_limit", {{ bytes }}),
    clearCache: async () => call("desktop_clear_cache")
  }});
  Object.defineProperty(window, "letscubeDesktop", {{
    configurable: false,
    enumerable: false,
    writable: false,
    value: window.letscubeDesktop
  }});
}})();
"#,
        origin = PRODUCTION_ORIGIN,
        version = env!("CARGO_PKG_VERSION"),
        build = DESKTOP_BUILD,
    )
}

fn startup_runtime_script() -> String {
    format!(
        r#"
(() => {{
  if (window.location.href !== {startup_url:?}) return;
  const applyVersion = () => {{
    const label = document.querySelector("[data-desktop-version]");
    if (label) label.textContent = `Desktop ${{{version:?}}}`;
  }};
  if (document.readyState === "loading") {{
    document.addEventListener("DOMContentLoaded", applyVersion, {{ once: true }});
  }} else {{
    applyVersion();
  }}
}})();
"#,
        startup_url = BUNDLED_STARTUP_URL,
        version = env!("CARGO_PKG_VERSION"),
    )
}

fn production_overlay_script() -> String {
    let overlay_html = include_str!("../../ui/startup-overlay.html").replace(
        "__LETSCUBE_LOGO_SVG__",
        include_str!("../../ui/letscube-logo.svg"),
    );
    include_str!("../../ui/startup-overlay.js")
        .replace(
            "__LETSCUBE_PRODUCTION_ORIGIN__",
            &serde_json::to_string(PRODUCTION_ORIGIN).expect("production origin serializes"),
        )
        .replace(
            "__LETSCUBE_STARTUP_EVENT__",
            &serde_json::to_string(STARTUP_EVENT).expect("startup event serializes"),
        )
        .replace(
            "__LETSCUBE_OVERLAY_CSS__",
            &serde_json::to_string(include_str!("../../ui/startup-overlay.css"))
                .expect("overlay CSS serializes"),
        )
        .replace(
            "__LETSCUBE_OVERLAY_HTML__",
            &serde_json::to_string(&overlay_html).expect("overlay HTML serializes"),
        )
}

fn initialization_script() -> String {
    format!(
        "{}\n{}\n{}",
        startup_runtime_script(),
        desktop_bridge_script(),
        production_overlay_script()
    )
}

fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
}

#[tauri::command]
fn desktop_show_main(window: WebviewWindow) -> Result<(), &'static str> {
    require_production_main(&window)?;
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
fn desktop_is_main_foreground(window: WebviewWindow) -> Result<bool, &'static str> {
    require_production_main(&window)?;
    let visible = window
        .is_visible()
        .map_err(|_| "window_state_unavailable")?;
    let minimized = window
        .is_minimized()
        .map_err(|_| "window_state_unavailable")?;
    let focused = window
        .is_focused()
        .map_err(|_| "window_state_unavailable")?;
    Ok(visible && !minimized && focused)
}

#[tauri::command]
fn desktop_start_dragging(window: WebviewWindow) -> Result<(), &'static str> {
    require_production_main(&window)?;
    window.start_dragging().map_err(|_| "window_action_failed")
}

#[tauri::command]
fn desktop_minimize(window: WebviewWindow) -> Result<(), &'static str> {
    require_production_main(&window)?;
    window.minimize().map_err(|_| "window_action_failed")
}

#[tauri::command]
fn desktop_toggle_maximize(window: WebviewWindow) -> Result<(), &'static str> {
    require_production_main(&window)?;
    let maximized = window
        .is_maximized()
        .map_err(|_| "window_state_unavailable")?;
    if maximized {
        window.unmaximize().map_err(|_| "window_action_failed")
    } else {
        window.maximize().map_err(|_| "window_action_failed")
    }
}

#[tauri::command]
fn desktop_is_maximized(window: WebviewWindow) -> Result<bool, &'static str> {
    require_production_main(&window)?;
    window
        .is_maximized()
        .map_err(|_| "window_state_unavailable")
}

#[tauri::command]
fn desktop_close_to_tray(window: WebviewWindow) -> Result<(), &'static str> {
    require_production_main(&window)?;
    window.hide().map_err(|_| "window_action_failed")
}

#[tauri::command]
fn startup_start_dragging(window: WebviewWindow) -> Result<(), &'static str> {
    require_startup_main(&window)?;
    window.start_dragging().map_err(|_| "window_action_failed")
}

#[tauri::command]
fn startup_minimize(window: WebviewWindow) -> Result<(), &'static str> {
    require_startup_main(&window)?;
    window.minimize().map_err(|_| "window_action_failed")
}

#[tauri::command]
fn startup_toggle_maximize(window: WebviewWindow) -> Result<(), &'static str> {
    require_startup_main(&window)?;
    let maximized = window
        .is_maximized()
        .map_err(|_| "window_state_unavailable")?;
    if maximized {
        window.unmaximize().map_err(|_| "window_action_failed")
    } else {
        window.maximize().map_err(|_| "window_action_failed")
    }
}

#[tauri::command]
fn startup_close_to_tray(window: WebviewWindow) -> Result<(), &'static str> {
    require_startup_main(&window)?;
    window.hide().map_err(|_| "window_action_failed")
}

fn is_safe_notification_route(route: &str) -> bool {
    if route.len() > 512
        || !route.starts_with('/')
        || route.starts_with("//")
        || route.chars().any(char::is_control)
    {
        return false;
    }
    Url::parse(&format!("{PRODUCTION_ORIGIN}{route}"))
        .map(|url| is_allowed_navigation(&url))
        .unwrap_or(false)
}

fn is_safe_notification_text(value: &str, max_chars: usize) -> bool {
    !value.trim().is_empty()
        && value.chars().count() <= max_chars
        && !value.chars().any(|character| character == '\0')
}

fn is_safe_notification_icon(value: &str) -> bool {
    if value.len() > 2048 || value.chars().any(char::is_control) {
        return false;
    }
    Url::parse(value)
        .map(|url| {
            let lower = value.to_ascii_lowercase();
            let origin = url.origin().ascii_serialization();
            url.scheme() == "https"
                && url.username().is_empty()
                && url.password().is_none()
                && url.port().is_none()
                && (origin == PRODUCTION_ORIGIN || origin == API_ORIGIN)
                && !lower.contains("/storage/v1/")
                && !lower.contains("/object/sign/")
                && !lower.contains("token=")
                && !lower.contains("signedurl")
                && !lower.contains("signed_url")
        })
        .unwrap_or(false)
}

fn notification_group(kind: &str) -> Option<&'static str> {
    match kind {
        "message" => Some("messages"),
        "task" => Some("tasks"),
        "system" => Some("system"),
        _ => None,
    }
}

fn is_safe_notification_group(kind: &str, group: &str) -> bool {
    if notification_group(kind).is_none() {
        return false;
    }
    let expected_prefix = format!("{kind}:");
    group.len() > expected_prefix.len()
        && group.len() <= 64
        && group.starts_with(&expected_prefix)
        && group.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, ':' | '_' | '-')
        })
}

fn validate_desktop_notification(
    notification: &DesktopNotificationRequest,
) -> Result<(), &'static str> {
    if notification.id == 0
        || !is_safe_notification_group(&notification.kind, &notification.group)
        || !is_safe_notification_route(&notification.route)
        || !is_safe_notification_text(&notification.title, 120)
        || !is_safe_notification_text(&notification.body, 280)
        || notification
            .icon
            .as_deref()
            .is_some_and(|icon| !is_safe_notification_icon(icon))
    {
        return Err("notification_invalid");
    }

    match (&*notification.kind, &notification.header) {
        ("message", Some(header))
            if header.id == notification.group
                && is_safe_notification_text(&header.title, 120)
                && is_safe_notification_route(&header.route) =>
        {
            Ok(())
        }
        ("task" | "system", None) => Ok(()),
        _ => Err("notification_invalid"),
    }
}

fn notification_activation_url(route: &str) -> Result<String, &'static str> {
    if !is_safe_notification_route(route) {
        return Err("notification_invalid");
    }
    let mut activation = Url::parse(&format!("{WINDOWS_NOTIFICATION_SCHEME}://open"))
        .map_err(|_| "notification_invalid")?;
    activation.query_pairs_mut().append_pair("route", route);
    Ok(activation.into())
}

fn notification_route_from_activation_url(value: &str) -> Option<String> {
    let activation = Url::parse(value).ok()?;
    if activation.scheme() != WINDOWS_NOTIFICATION_SCHEME
        || activation.host_str() != Some("open")
        || !activation.username().is_empty()
        || activation.password().is_some()
        || activation.port().is_some()
        || !matches!(activation.path(), "" | "/")
        || activation.fragment().is_some()
    {
        return None;
    }
    let mut routes = activation
        .query_pairs()
        .filter(|(key, _)| key == "route")
        .map(|(_, route)| route.into_owned());
    let route = routes.next()?;
    if routes.next().is_some() || !is_safe_notification_route(&route) {
        return None;
    }
    Some(route)
}

fn notification_route_from_args(args: &[String]) -> Option<String> {
    args.iter()
        .find_map(|arg| notification_route_from_activation_url(arg))
}

fn activate_notification_route<R: Runtime>(window: &WebviewWindow<R>, route: String) {
    if !is_safe_notification_route(&route) {
        return;
    }
    if let Ok(mut pending_route) = window.state::<PendingNotificationRoute>().0.lock() {
        *pending_route = Some(route);
    }
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    let script = format!(
        "window.dispatchEvent(new CustomEvent({event:?}));",
        event = DESKTOP_NOTIFICATION_ACTION_EVENT,
    );
    let _ = window.eval(script);
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn windows_notification_xml(
    notification: &DesktopNotificationRequest,
) -> Result<String, &'static str> {
    let activation_url = notification_activation_url(&notification.route)?;
    let header = match &notification.header {
        Some(header) => {
            let header_activation_url = notification_activation_url(&header.route)?;
            format!(
                r#"<header id="{}" title="{}" arguments="{}" activationType="protocol"/>"#,
                escape_xml(&header.id),
                escape_xml(header.title.trim()),
                escape_xml(&header_activation_url),
            )
        }
        None => String::new(),
    };
    let content = if notification.header.is_some() {
        format!(r#"<text>{}</text>"#, escape_xml(notification.body.trim()))
    } else {
        format!(
            r#"<text>{}</text><text>{}</text>"#,
            escape_xml(notification.title.trim()),
            escape_xml(notification.body.trim()),
        )
    };
    let image = notification
        .icon
        .as_ref()
        .map(|icon| {
            format!(
                r#"<image placement="appLogoOverride" hint-crop="circle" src="{}"/>"#,
                escape_xml(icon),
            )
        })
        .unwrap_or_default();
    Ok(format!(
        r#"<toast duration="short" activationType="protocol" launch="{}">{}<visual><binding template="ToastGeneric">{}{}</binding></visual></toast>"#,
        escape_xml(&activation_url),
        header,
        image,
        content,
    ))
}

#[cfg(windows)]
fn show_windows_notification(
    notification: &DesktopNotificationRequest,
) -> Result<(), &'static str> {
    use windows::core::HSTRING;
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::UI::Notifications::{
        NotificationSetting, ToastNotification, ToastNotificationManager,
    };

    let tag = format!("{:08x}", notification.id);
    let xml = windows_notification_xml(notification)?;
    let document = XmlDocument::new().map_err(|_| "notification_unavailable")?;
    document
        .LoadXml(&HSTRING::from(xml))
        .map_err(|_| "notification_invalid")?;
    let toast = ToastNotification::CreateToastNotification(&document)
        .map_err(|_| "notification_unavailable")?;
    toast
        .SetTag(&HSTRING::from(tag))
        .map_err(|_| "notification_unavailable")?;
    toast
        .SetGroup(&HSTRING::from(&notification.group))
        .map_err(|_| "notification_unavailable")?;

    let notifier =
        ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(WINDOWS_APP_ID))
            .map_err(|_| "notification_unavailable")?;
    if notifier.Setting().map_err(|_| "notification_unavailable")? != NotificationSetting::Enabled {
        return Err("notification_disabled");
    }
    notifier
        .Show(&toast)
        .map_err(|_| "notification_unavailable")?;
    Ok(())
}

#[cfg(windows)]
fn remove_windows_notification(
    notification: &DesktopNotificationIdentity,
) -> Result<(), &'static str> {
    use windows::core::HSTRING;
    use windows::UI::Notifications::ToastNotificationManager;

    let tag = format!("{:08x}", notification.id);
    let history = ToastNotificationManager::History().map_err(|_| "notification_unavailable")?;
    history
        .RemoveGroupedTagWithId(
            &HSTRING::from(tag),
            &HSTRING::from(&notification.group),
            &HSTRING::from(WINDOWS_APP_ID),
        )
        .map_err(|_| "notification_unavailable")
}

#[cfg(windows)]
fn clear_legacy_windows_message_notifications() {
    use windows::core::HSTRING;
    use windows::UI::Notifications::ToastNotificationManager;

    if let Ok(history) = ToastNotificationManager::History() {
        let _ =
            history.RemoveGroupWithId(&HSTRING::from("messages"), &HSTRING::from(WINDOWS_APP_ID));
    }
}

#[cfg(not(windows))]
fn clear_legacy_windows_message_notifications() {}

#[cfg(not(windows))]
fn remove_windows_notification(
    _notification: &DesktopNotificationIdentity,
) -> Result<(), &'static str> {
    Err("notification_unavailable")
}

#[cfg(not(windows))]
fn show_windows_notification(
    _notification: &DesktopNotificationRequest,
) -> Result<(), &'static str> {
    Err("notification_unavailable")
}

#[tauri::command]
fn desktop_notify(
    window: WebviewWindow,
    notification: DesktopNotificationRequest,
) -> Result<bool, &'static str> {
    require_production_main(&window)?;
    validate_desktop_notification(&notification)?;
    show_windows_notification(&notification)?;
    Ok(true)
}

#[tauri::command]
fn desktop_remove_notification(
    window: WebviewWindow,
    notification: DesktopNotificationIdentity,
) -> Result<bool, &'static str> {
    require_production_main(&window)?;
    if notification.id == 0 || !is_safe_notification_group(&notification.kind, &notification.group)
    {
        return Err("notification_invalid");
    }
    remove_windows_notification(&notification)?;
    Ok(true)
}

#[tauri::command]
fn desktop_take_pending_notification_route(
    window: WebviewWindow,
    pending: State<'_, PendingNotificationRoute>,
) -> Result<Option<String>, &'static str> {
    require_production_main(&window)?;
    let mut route = pending.0.lock().map_err(|_| "notification_unavailable")?;
    Ok(route.take())
}

fn restore_startup_surface<R: Runtime>(app: &AppHandle<R>) {
    show_main(app);
}

fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Открыть LETSCUBE", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, "exit", "Выйти", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &exit])?;

    let mut tray = TrayIconBuilder::with_id("letscube-tray")
        .menu(&menu)
        .tooltip("LETSCUBE")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => restore_startup_surface(app),
            "exit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                restore_startup_surface(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn current_snapshot<R: Runtime>(app: &AppHandle<R>) -> Option<StartupSnapshot> {
    app.state::<StartupController>()
        .0
        .lock()
        .ok()
        .map(|state| state.snapshot())
}

fn emit_startup_snapshot<R: Runtime>(app: &AppHandle<R>) {
    let Some(snapshot) = current_snapshot(app) else {
        return;
    };
    let _ = app.emit_to("main", STARTUP_EVENT, &snapshot);
    if let (Some(main), Ok(payload)) = (
        app.get_webview_window("main"),
        serde_json::to_string(&snapshot),
    ) {
        let _ = main.eval(format!(
            "window.dispatchEvent(new CustomEvent({STARTUP_EVENT:?}, {{ detail: {payload} }}));"
        ));
    }
}

fn transition_startup<R: Runtime>(app: &AppHandle<R>, next: StartupStage) -> bool {
    let transitioned = app
        .state::<StartupController>()
        .0
        .lock()
        .ok()
        .is_some_and(|mut state| state.transition(next).is_ok());
    if transitioned {
        emit_startup_snapshot(app);
    }
    transitioned
}

fn enter_preflight(state: &mut StartupState) -> PreflightEntry {
    match state.snapshot().stage {
        StartupStage::Boot => match state.transition(StartupStage::NetworkCheck) {
            Ok(()) => PreflightEntry::RunHttps,
            Err(_) => PreflightEntry::Reject,
        },
        StartupStage::NetworkCheck => PreflightEntry::RunHttps,
        _ => PreflightEntry::Reject,
    }
}

fn prepare_preflight<R: Runtime>(app: &AppHandle<R>) -> PreflightEntry {
    let entry = app
        .state::<StartupController>()
        .0
        .lock()
        .ok()
        .map_or(PreflightEntry::Reject, |mut state| {
            enter_preflight(&mut state)
        });
    if entry == PreflightEntry::RunHttps {
        emit_startup_snapshot(app);
    }
    entry
}

async fn launch_https_path<T, F, Fut>(entry: PreflightEntry, request: F) -> Option<T>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = T>,
{
    if entry != PreflightEntry::RunHttps {
        return None;
    }
    Some(request().await)
}

fn fail_startup<R: Runtime>(app: &AppHandle<R>, error: StartupErrorCode) {
    if let Ok(mut state) = app.state::<StartupController>().0.lock() {
        let _ = state.fail(error);
    }
    PREFLIGHT_RUNNING.store(false, Ordering::Release);
    emit_startup_snapshot(app);
}

fn classify_request_error(error: &reqwest::Error) -> StartupErrorCode {
    let detail = error.to_string().to_ascii_lowercase();
    if detail.contains("certificate")
        || detail.contains("tls")
        || detail.contains("ssl")
        || detail.contains("unknown issuer")
    {
        StartupErrorCode::TlsOrigin
    } else {
        StartupErrorCode::Network
    }
}

async fn run_preflight<R: Runtime>(app: AppHandle<R>) {
    if PREFLIGHT_RUNNING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return;
    }

    let entry = prepare_preflight(&app);
    if entry != PreflightEntry::RunHttps {
        PREFLIGHT_RUNNING.store(false, Ordering::Release);
        return;
    }
    #[cfg(debug_assertions)]
    if qa_should_fail_network_once() {
        fail_startup(&app, StartupErrorCode::Network);
        return;
    }

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        // Surfaces the leaf certificate of a connection rustls has already
        // validated. It changes nothing about how that validation is done.
        .tls_info(true)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if is_allowed_navigation(attempt.url()) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
    {
        Ok(client) => client,
        Err(_) => {
            fail_startup(&app, StartupErrorCode::Network);
            return;
        }
    };

    if !transition_startup(&app, StartupStage::TlsOriginCheck) {
        PREFLIGHT_RUNNING.store(false, Ordering::Release);
        return;
    }

    let response = match launch_https_path(entry, || client.get(PRODUCTION_URL).send()).await {
        Some(Ok(response)) => response,
        Some(Err(error)) => {
            fail_startup(&app, classify_request_error(&error));
            return;
        }
        None => return,
    };
    if !response.status().is_success()
        || response.status().is_redirection()
        || !is_allowed_navigation(response.url())
    {
        fail_startup(&app, StartupErrorCode::TlsOrigin);
        return;
    }

    // Only now, on a response whose chain and hostname rustls already accepted,
    // is the certificate hashed and compared with the one this computer
    // recorded. The comparison is a change detector, not an authentication: a
    // client whose first connection is intercepted records the interceptor. The
    // authentication is the chain validation above, which fails the request
    // outright and can never be continued past.
    if let Some(der) = response
        .extensions()
        .get::<reqwest::tls::TlsInfo>()
        .and_then(|info| info.peer_certificate())
    {
        let observed = certificate_fingerprint(der);
        let expected = load_peer_trust(&app);
        let accepted = app
            .state::<StartupController>()
            .0
            .lock()
            .ok()
            .and_then(|state| state.accepted_peer().map(str::to_owned));
        let identity = PeerIdentity {
            observed_sha256: observed.clone(),
            expected_sha256: expected.clone(),
        };

        match expected {
            // A recorded value that no longer matches, and which the person has
            // not just accepted for this attempt. This stops, and offers the
            // comparison; it never blocks permanently, because an ordinary
            // renewal looks exactly like this and a hard block would lock every
            // client out of the app that carries its own updater.
            Some(recorded)
                if recorded != observed && accepted.as_deref() != Some(observed.as_str()) =>
            {
                if let Ok(mut state) = app.state::<StartupController>().0.lock() {
                    let _ = state.fail_peer_changed(identity);
                }
                PREFLIGHT_RUNNING.store(false, Ordering::Release);
                emit_startup_snapshot(&app);
                return;
            }
            _ => {
                // First run, an unchanged certificate, or one accepted for this
                // attempt: adopt it so the next run compares against what was
                // actually served.
                store_peer_trust(&app, &observed);
                if let Ok(mut state) = app.state::<StartupController>().0.lock() {
                    state.set_peer(identity);
                }
                emit_startup_snapshot(&app);
            }
        }
    }

    if !transition_startup(&app, StartupStage::UpdateCheck) {
        PREFLIGHT_RUNNING.store(false, Ordering::Release);
        return;
    }

    #[cfg(debug_assertions)]
    let checks_catalog = !qa_skips_catalog_source();
    #[cfg(not(debug_assertions))]
    let checks_catalog = true;

    // Catalog availability is informative and must not block the installed client.
    if checks_catalog {
        let _ = client
            .get(update_endpoint(UpdateChannel::default()))
            .timeout(Duration::from_secs(8))
            .send()
            .await;
    }

    if !transition_startup(&app, StartupStage::ProductionNavigation) {
        PREFLIGHT_RUNNING.store(false, Ordering::Release);
        return;
    }
    let Some(main) = app.get_webview_window("main") else {
        fail_startup(&app, StartupErrorCode::Network);
        return;
    };
    if main
        .navigate(Url::parse(PRODUCTION_URL).expect("production URL is valid"))
        .is_err()
    {
        fail_startup(&app, StartupErrorCode::Network);
    }
}

fn build_main_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .expect("tauri.conf.json must define the main window")
        .clone();
    let profile_dir = production_profile_dir(app)?;
    let navigation_handle = app.clone();
    let new_window_handle = app.clone();

    let cache_limit = storage::load_settings(&storage_settings_path(app)?).cache_limit_bytes;
    // Chromium sizes its own cache; asking the engine is the only way to bound
    // it. The trim at launch is the backstop, not the mechanism.
    #[allow(unused_mut)]
    let mut browser_args = storage::disk_cache_argument(cache_limit);

    // `additional_browser_args` replaces rather than appends, so the debug
    // switches are joined onto the same string. Passing them separately dropped
    // the cache limit from every QA run, which is the one run meant to behave
    // like production.
    #[cfg(debug_assertions)]
    if let Some(args) = debug_browser_args() {
        browser_args.push(' ');
        browser_args.push_str(&args);
    }

    let builder = WebviewWindowBuilder::from_config(app, &config)?
        .data_directory(profile_dir)
        .initialization_script(initialization_script())
        .additional_browser_args(&browser_args);

    builder
        .on_navigation(move |url| {
            if is_local_startup_url(url) || is_allowed_navigation(url) {
                true
            } else {
                if is_safe_external_url(url) {
                    let _ = navigation_handle
                        .opener()
                        .open_url(url.as_str(), None::<&str>);
                }
                false
            }
        })
        .on_new_window(move |url, _features| {
            if is_safe_external_url(&url) {
                let _ = new_window_handle
                    .opener()
                    .open_url(url.as_str(), None::<&str>);
            }
            NewWindowResponse::Deny
        })
        .on_page_load(|window, payload| {
            let app = window.app_handle();
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            if is_local_startup_url(payload.url()) {
                emit_startup_snapshot(app);
                return;
            }
            if !is_allowed_navigation(payload.url()) {
                return;
            }
            if transition_startup(app, StartupStage::WorkspaceReady)
                && transition_startup(app, StartupStage::Complete)
            {
                MAIN_READY.store(true, Ordering::Release);
                PREFLIGHT_RUNNING.store(false, Ordering::Release);
            }
        })
        .build()?;

    Ok(())
}

fn setup_update_controller<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let channel_path = app_data_root(app)?.join(UPDATE_CHANNEL_FILE);
    let channel = load_update_channel(&channel_path);
    let state = DesktopUpdateState::new(channel, app.package_info().version.to_string());
    #[cfg(debug_assertions)]
    let state = {
        let mut state = state;
        apply_qa_update_state(&mut state);
        state
    };
    app.manage(UpdateController {
        inner: Mutex::new(NativeUpdateState {
            state,
            pending: None,
        }),
        channel_path,
    });
    Ok(())
}

fn update_command_error(code: &'static str) -> String {
    code.to_owned()
}

fn update_snapshot(controller: &UpdateController) -> Result<DesktopUpdateSnapshot, &'static str> {
    controller
        .inner
        .lock()
        .map(|native| native.state.snapshot())
        .map_err(|_| "update_state_unavailable")
}

fn transition_update_failed(controller: &UpdateController, code: &'static str) -> String {
    if let Ok(mut native) = controller.inner.lock() {
        native.state.fail(code);
    }
    update_command_error(code)
}

fn download_error_code(error: &tauri_plugin_updater::Error) -> &'static str {
    match error {
        tauri_plugin_updater::Error::Reqwest(error) if error.is_timeout() => {
            "update_download_timeout"
        }
        _ => "update_download_failed",
    }
}

#[tauri::command]
fn desktop_get_update_state(
    window: WebviewWindow,
    controller: State<'_, UpdateController>,
) -> Result<DesktopUpdateSnapshot, String> {
    require_production_main(&window).map_err(update_command_error)?;
    update_snapshot(&controller).map_err(update_command_error)
}

#[tauri::command]
fn desktop_get_update_channel(
    window: WebviewWindow,
    controller: State<'_, UpdateController>,
) -> Result<UpdateChannel, String> {
    require_production_main(&window).map_err(update_command_error)?;
    controller
        .inner
        .lock()
        .map(|native| native.state.channel())
        .map_err(|_| update_command_error("update_state_unavailable"))
}

/// What the settings screen shows: where the profile is, how big it is, and
/// how much of that is cache it may drop.
#[derive(serde::Serialize)]
struct DesktopStorageState {
    location: String,
    is_default_location: bool,
    total_bytes: u64,
    cache_bytes: u64,
    cache_limit_bytes: u64,
    min_cache_limit_bytes: u64,
    max_cache_limit_bytes: u64,
    /// A relocation that will happen at the next launch, if one is recorded.
    pending_location: Option<String>,
}

fn storage_state_for(app: &AppHandle) -> Result<DesktopStorageState, String> {
    let settings_path = storage_settings_path(app).map_err(|_| "storage_unavailable".to_owned())?;
    let settings = storage::load_settings(&settings_path);
    let profile = production_profile_dir(app).map_err(|_| "storage_unavailable".to_owned())?;
    let default = default_profile_dir(app).map_err(|_| "storage_unavailable".to_owned())?;
    Ok(DesktopStorageState {
        location: profile.to_string_lossy().into_owned(),
        is_default_location: profile == default,
        total_bytes: storage::directory_size(&profile),
        cache_bytes: storage::cache_size(&profile),
        cache_limit_bytes: settings.cache_limit_bytes,
        min_cache_limit_bytes: storage::MIN_CACHE_LIMIT_BYTES,
        max_cache_limit_bytes: storage::MAX_CACHE_LIMIT_BYTES,
        pending_location: settings.pending_location,
    })
}

#[tauri::command]
fn desktop_get_storage_state(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<DesktopStorageState, String> {
    require_production_main(&window)?;
    storage_state_for(&app)
}

/// Records where the profile should live. The move happens at the next launch.
///
/// It cannot happen now: WebView2 holds exclusive locks on the profile of an
/// open window, and the signed-in session lives in the same folder, so a
/// half-finished move signs the person out.
#[tauri::command]
fn desktop_set_storage_location(
    window: WebviewWindow,
    app: AppHandle,
    location: Option<String>,
) -> Result<DesktopStorageState, String> {
    require_production_main(&window)?;
    let settings_path = storage_settings_path(&app).map_err(|_| "storage_unavailable".to_owned())?;
    let mut settings = storage::load_settings(&settings_path);
    let current = production_profile_dir(&app).map_err(|_| "storage_unavailable".to_owned())?;

    match location {
        None => {
            // Back to the default, by the same deferred route.
            let default = default_profile_dir(&app).map_err(|_| "storage_unavailable".to_owned())?;
            settings.pending_location = if default == current {
                None
            } else {
                Some(default.to_string_lossy().into_owned())
            };
        }
        Some(raw) => {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                return Err("not_absolute".to_owned());
            }
            // The chosen folder gets a folder of our own inside it rather than
            // being taken over wholesale.
            let target = std::path::Path::new(trimmed).join(PRODUCTION_PROFILE);
            storage::validate_location(&target, &current)
                .map_err(|problem| problem.code().to_owned())?;
            settings.pending_location = if target == current {
                None
            } else {
                Some(target.to_string_lossy().into_owned())
            };
        }
    }

    storage::store_settings(&settings_path, &settings).map_err(|_| "storage_write_failed".to_owned())?;
    storage_state_for(&app)
}

#[tauri::command]
fn desktop_set_cache_limit(
    window: WebviewWindow,
    app: AppHandle,
    bytes: u64,
) -> Result<DesktopStorageState, String> {
    require_production_main(&window)?;
    let settings_path = storage_settings_path(&app).map_err(|_| "storage_unavailable".to_owned())?;
    let settings = storage::load_settings(&settings_path).with_limit(bytes);
    storage::store_settings(&settings_path, &settings).map_err(|_| "storage_write_failed".to_owned())?;
    storage_state_for(&app)
}

/// Drops what can be downloaded again. Never touches the session.
#[tauri::command]
fn desktop_clear_cache(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<DesktopStorageState, String> {
    require_production_main(&window)?;
    let profile = production_profile_dir(&app).map_err(|_| "storage_unavailable".to_owned())?;
    // Some of it is held open by the running engine; what cannot be removed now
    // is removed at the next launch by the same limit check.
    let _ = storage::clear_cache(&profile);
    storage_state_for(&app)
}

#[tauri::command]
fn desktop_set_update_channel(
    window: WebviewWindow,
    controller: State<'_, UpdateController>,
    channel: String,
) -> Result<DesktopUpdateSnapshot, String> {
    require_production_main(&window).map_err(update_command_error)?;
    let channel = updater::parse_update_channel_input(&channel)
        .ok_or_else(|| update_command_error("invalid_update_channel"))?;
    let mut native = controller
        .inner
        .lock()
        .map_err(|_| update_command_error("update_state_unavailable"))?;
    if matches!(
        native.state.snapshot().phase,
        DesktopUpdatePhase::Checking
            | DesktopUpdatePhase::Downloading
            | DesktopUpdatePhase::Installing
    ) {
        return Err(update_command_error("update_busy"));
    }
    store_update_channel(&controller.channel_path, channel)
        .map_err(|_| update_command_error("update_channel_store_failed"))?;
    native.state.set_channel(channel);
    native.pending = None;
    Ok(native.state.snapshot())
}

#[tauri::command]
async fn desktop_check_update(
    window: WebviewWindow,
    app: AppHandle,
    controller: State<'_, UpdateController>,
) -> Result<DesktopUpdateSnapshot, String> {
    require_production_main(&window).map_err(update_command_error)?;
    let (channel, installed_version) = {
        let mut native = controller
            .inner
            .lock()
            .map_err(|_| update_command_error("update_state_unavailable"))?;
        native
            .state
            .begin_check()
            .map_err(|_| update_command_error("update_busy"))?;
        native.pending = None;
        let snapshot = native.state.snapshot();
        (snapshot.channel, snapshot.installed_version)
    };

    let updater = app
        .updater_builder()
        .endpoints(vec![update_endpoint(channel)])
        .map_err(|_| transition_update_failed(&controller, "update_configuration_failed"))?
        .timeout(UPDATE_TIMEOUT)
        .build()
        .map_err(|_| transition_update_failed(&controller, "update_configuration_failed"))?;
    let checked = match updater.check().await {
        Ok(checked) => checked,
        Err(_) => {
            return Err(transition_update_failed(&controller, "update_check_failed"));
        }
    };

    let mut native = controller
        .inner
        .lock()
        .map_err(|_| update_command_error("update_state_unavailable"))?;
    match checked {
        Some(mut update) => {
            update.timeout = Some(UPDATE_TIMEOUT);
            let metadata = parse_update_metadata(&update.raw_json, channel, &installed_version);
            native.state.set_mandatory(metadata.mandatory);
            native
                .state
                .mark_available(update.version.clone(), metadata.critical, None)
                .map_err(|_| update_command_error("update_state_unavailable"))?;
            native.pending = Some(update);
        }
        None => {
            native
                .state
                .mark_current()
                .map_err(|_| update_command_error("update_state_unavailable"))?;
        }
    }
    Ok(native.state.snapshot())
}

#[tauri::command]
async fn desktop_install_update(
    window: WebviewWindow,
    controller: State<'_, UpdateController>,
) -> Result<DesktopUpdateSnapshot, String> {
    require_production_main(&window).map_err(update_command_error)?;
    let update = {
        let mut native = controller
            .inner
            .lock()
            .map_err(|_| update_command_error("update_state_unavailable"))?;
        let update = native
            .pending
            .clone()
            .ok_or_else(|| update_command_error("update_not_available"))?;
        native
            .state
            .begin_download()
            .map_err(|_| update_command_error("update_not_available"))?;
        update
    };

    let bytes = match update
        .download(
            |chunk_bytes, total_bytes| {
                if let Ok(mut native) = controller.inner.lock() {
                    native.state.record_download_progress(
                        u64::try_from(chunk_bytes).unwrap_or(u64::MAX),
                        total_bytes,
                    );
                }
            },
            || {},
        )
        .await
    {
        Ok(bytes) => bytes,
        Err(error) => {
            let code = download_error_code(&error);
            return Err(transition_update_failed(&controller, code));
        }
    };

    {
        let mut native = controller
            .inner
            .lock()
            .map_err(|_| update_command_error("update_state_unavailable"))?;
        native
            .state
            .finish_verified_download()
            .map_err(|_| update_command_error("update_state_unavailable"))?;
    }
    if update.install(bytes).is_err() {
        return Err(transition_update_failed(
            &controller,
            "update_install_failed",
        ));
    }

    update_snapshot(&controller).map_err(update_command_error)
}

#[tauri::command]
fn retry_main(window: WebviewWindow, app: AppHandle) {
    if window.label() != "main"
        || window
            .url()
            .map(|url| !is_local_startup_url(&url))
            .unwrap_or(true)
    {
        return;
    }
    let retried = app
        .state::<StartupController>()
        .0
        .lock()
        .ok()
        .is_some_and(|mut state| state.retry().is_ok());
    if !retried {
        return;
    }
    emit_startup_snapshot(&app);
    tauri::async_runtime::spawn(run_preflight(app));
}

#[tauri::command]
fn startup_accept_peer_change(window: WebviewWindow, app: AppHandle) {
    // Same guard as every other startup command: the exact bundled startup URL
    // in the main window, nothing else.
    if require_startup_main(&window).is_err() {
        return;
    }
    // The state machine refuses unless the machine is sitting on a changed pin,
    // so this cannot be used to continue past a chain that failed to validate.
    let accepted = app
        .state::<StartupController>()
        .0
        .lock()
        .ok()
        .is_some_and(|mut state| state.accept_peer_change().is_ok());
    if !accepted {
        return;
    }
    emit_startup_snapshot(&app);
    tauri::async_runtime::spawn(run_preflight(app));
}

#[tauri::command]
fn begin_startup_qa(window: WebviewWindow, app: AppHandle) {
    #[cfg(not(debug_assertions))]
    {
        let _ = (window, app);
        return;
    }

    #[cfg(debug_assertions)]
    {
        if !qa_holds_preflight()
            || window.label() != "main"
            || window
                .url()
                .map(|url| !is_local_startup_url(&url))
                .unwrap_or(true)
        {
            return;
        }
        tauri::async_runtime::spawn(run_preflight(app));
    }
}

pub fn run() {
    #[allow(unused_mut)]
    let mut context = tauri::generate_context!();
    // Done here rather than inside `setup`, because the single-instance plugin
    // reads the identifier in its own setup and the mutex it names has to be
    // taken before any window exists.
    #[cfg(debug_assertions)]
    if qa_wants_isolated_identity() {
        let isolated = qa_isolated_identifier(&context.config().identifier);
        context.config_mut().identifier = isolated;
    }

    tauri::Builder::default()
        .manage(StartupController(Mutex::new(StartupState::new())))
        .manage(PendingNotificationRoute(Mutex::new(None)))
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(route) = notification_route_from_args(&args) {
                if let Some(main) = app.get_webview_window("main") {
                    activate_notification_route(&main, route);
                    return;
                }
            }
            restore_startup_surface(app);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            retry_main,
            startup_accept_peer_change,
            begin_startup_qa,
            desktop_get_update_state,
            desktop_get_update_channel,
            desktop_set_update_channel,
            desktop_check_update,
            desktop_install_update,
            desktop_show_main,
            desktop_is_main_foreground,
            desktop_notify,
            desktop_remove_notification,
            desktop_take_pending_notification_route,
            desktop_start_dragging,
            desktop_minimize,
            desktop_toggle_maximize,
            desktop_is_maximized,
            desktop_close_to_tray,
            desktop_get_storage_state,
            desktop_set_storage_location,
            desktop_set_cache_limit,
            desktop_clear_cache,
            startup_start_dragging,
            startup_minimize,
            startup_toggle_maximize,
            startup_close_to_tray
        ])
        .setup(|app| {
            settle_storage_before_launch(app.handle());
            setup_update_controller(app.handle())?;
            setup_tray(app.handle())?;
            build_main_window(app.handle())?;
            clear_legacy_windows_message_notifications();
            let notification_app = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                let route = event
                    .urls()
                    .iter()
                    .find_map(|url| notification_route_from_activation_url(url.as_str()));
                if let Some(route) = route {
                    if let Some(main) = notification_app.get_webview_window("main") {
                        activate_notification_route(&main, route);
                    }
                }
            });
            show_main(app.handle());
            let startup_args = std::env::args().collect::<Vec<_>>();
            if let Some(route) = notification_route_from_args(&startup_args) {
                if let Some(main) = app.get_webview_window("main") {
                    activate_notification_route(&main, route);
                }
            }
            #[cfg(debug_assertions)]
            let hold_preflight = qa_holds_preflight();
            #[cfg(not(debug_assertions))]
            let hold_preflight = false;
            if !hold_preflight {
                tauri::async_runtime::spawn(run_preflight(app.handle().clone()));
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(context)
        .expect("error while running LETSCUBE Windows client");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn update_controller_with_state(state: DesktopUpdateState) -> UpdateController {
        UpdateController {
            inner: Mutex::new(NativeUpdateState {
                state,
                pending: None,
            }),
            channel_path: PathBuf::new(),
        }
    }

    #[test]
    fn asset_timeout_failure_releases_downloading_state_for_retry() {
        let mut state = DesktopUpdateState::new(UpdateChannel::Stable, "0.2.0");
        state.begin_check().unwrap();
        state.mark_available("0.2.1", false, None).unwrap();
        state.begin_download().unwrap();
        let controller = update_controller_with_state(state);

        let code = transition_update_failed(&controller, "update_download_timeout");
        assert_eq!(code, "update_download_timeout");
        let mut native = controller.inner.lock().unwrap();
        assert_eq!(native.state.snapshot().phase, DesktopUpdatePhase::Failed);
        assert_eq!(
            native.state.snapshot().error_code.as_deref(),
            Some("update_download_timeout")
        );
        native.state.begin_check().unwrap();
        assert_eq!(native.state.snapshot().phase, DesktopUpdatePhase::Checking);
    }

    #[test]
    fn check_setup_failure_never_leaves_state_checking() {
        let mut state = DesktopUpdateState::new(UpdateChannel::Stable, "0.2.0");
        state.begin_check().unwrap();
        let controller = update_controller_with_state(state);

        let code = transition_update_failed(&controller, "update_configuration_failed");
        assert_eq!(code, "update_configuration_failed");
        let snapshot = controller.inner.lock().unwrap().state.snapshot();
        assert_eq!(snapshot.phase, DesktopUpdatePhase::Failed);
        assert_eq!(
            snapshot.error_code.as_deref(),
            Some("update_configuration_failed")
        );
    }

    /// The QA identity has to be a different name to Windows — that is the
    /// whole mechanism — and it has to stay a legal one, because it becomes a
    /// named mutex, a window class and a directory under `%LOCALAPPDATA%`.
    #[test]
    fn isolated_qa_identity_is_a_distinct_and_legal_name() {
        let shipped = "ru.letscube.messenger";
        let isolated = qa_isolated_identifier(shipped);

        assert_ne!(isolated, shipped);
        assert!(isolated.starts_with(shipped));
        assert!(!isolated
            .chars()
            .any(|character| r#"\/:*?"<>|"#.contains(character)));
    }

    #[test]
    fn navigation_is_limited_to_exact_production_origin() {
        assert!(is_allowed_navigation(
            &Url::parse("https://app.letscube.ru/login").unwrap()
        ));
        assert!(!is_allowed_navigation(
            &Url::parse("http://app.letscube.ru/login").unwrap()
        ));
        assert!(!is_allowed_navigation(
            &Url::parse("https://app.letscube.ru.evil.example/").unwrap()
        ));
        assert!(!is_allowed_navigation(
            &Url::parse("https://deploy.letscube.ru/").unwrap()
        ));
    }

    #[test]
    fn notification_routes_remain_inside_the_production_app() {
        assert!(is_safe_notification_route(
            "/?chat=chat-1&message=message-1"
        ));
        assert!(is_safe_notification_route("/tasks?task=task-1"));
        assert!(!is_safe_notification_route("https://evil.example/chat"));
        assert!(!is_safe_notification_route("//evil.example/chat"));
        assert!(!is_safe_notification_route("/chat\nforged"));
    }

    #[test]
    fn notification_protocol_round_trips_only_safe_relative_routes() {
        let route = "/?chat=chat-1&message=message-1";
        let activation = notification_activation_url(route).unwrap();
        assert_eq!(
            notification_route_from_activation_url(&activation).as_deref(),
            Some(route)
        );
        assert_eq!(
            notification_route_from_args(&["letscube.exe".into(), activation]),
            Some(route.into())
        );
        assert_eq!(
            notification_route_from_activation_url(
                "letscube-notification://open/?route=%2F%3Fchat%3Dchat-1%26message%3Dmessage-1"
            )
            .as_deref(),
            Some(route)
        );
        assert_eq!(
            notification_route_from_activation_url(
                "letscube-notification://open?route=https%3A%2F%2Fevil.example"
            ),
            None
        );
        assert_eq!(
            notification_route_from_activation_url(
                "letscube-notification://open?route=%2Ftasks&route=%2F"
            ),
            None
        );
        assert_eq!(
            notification_route_from_activation_url("https://app.letscube.ru/?chat=chat-1"),
            None
        );
    }

    #[test]
    fn notification_payloads_use_bounded_text_and_isolated_groups() {
        assert!(is_safe_notification_text("Новое сообщение", 120));
        assert!(!is_safe_notification_text("   ", 120));
        assert!(!is_safe_notification_text(&"x".repeat(121), 120));
        assert_eq!(notification_group("message"), Some("messages"));
        assert_eq!(notification_group("task"), Some("tasks"));
        assert_eq!(notification_group("system"), Some("system"));
        assert_eq!(notification_group("unknown"), None);
    }

    #[test]
    fn message_notification_xml_uses_a_protocol_header_and_exact_card_route() {
        let notification = DesktopNotificationRequest {
            id: 17,
            title: "Никита".into(),
            body: "Первое сообщение".into(),
            kind: "message".into(),
            group: "message:0123abcd".into(),
            header: Some(DesktopNotificationHeader {
                id: "message:0123abcd".into(),
                title: "Никита".into(),
                route: "/?chat=chat-1".into(),
            }),
            route: "/?chat=chat-1&message=message-1".into(),
            icon: Some("https://api.letscube.ru/media/bots/helper.webp".into()),
        };

        validate_desktop_notification(&notification).unwrap();
        let xml = windows_notification_xml(&notification).unwrap();
        assert!(xml.contains("activationType=\"protocol\""));
        assert!(xml.contains("<header id=\"message:0123abcd\""));
        assert!(xml.contains("title=\"Никита\""));
        assert!(!xml.contains("<text>Никита</text>"));
        assert!(xml.contains("<text>Первое сообщение</text>"));
        assert!(xml.contains("route=%2F%3Fchat%3Dchat-1"));
        assert!(xml.contains("route=%2F%3Fchat%3Dchat-1%26message%3Dmessage-1"));
        assert!(xml.contains("src=\"https://api.letscube.ru/media/bots/helper.webp\""));
        assert!(is_safe_notification_icon(
            "https://app.letscube.ru/media/bots/helper.webp"
        ));
        assert!(!is_safe_notification_icon(
            "https://api.letscube.ru/storage/v1/object/sign/bots/helper.webp?token=secret"
        ));
        assert!(!is_safe_notification_icon(
            "https://evil.example/media/bots/helper.webp"
        ));
    }

    #[test]
    fn notification_groups_and_headers_are_bounded_and_kind_isolated() {
        assert!(is_safe_notification_group("message", "message:0123abcd"));
        assert!(is_safe_notification_group("task", "task:0123abcd"));
        assert!(is_safe_notification_group("system", "system:0123abcd"));
        assert!(!is_safe_notification_group("message", "task:0123abcd"));
        assert!(!is_safe_notification_group("message", "message:bad/group"));
        assert!(!is_safe_notification_group("message", &"m".repeat(65)));

        let task_with_header = DesktopNotificationRequest {
            id: 18,
            title: "Новая задача".into(),
            body: "Проверить компьютеры".into(),
            kind: "task".into(),
            group: "task:0123abcd".into(),
            header: Some(DesktopNotificationHeader {
                id: "task:0123abcd".into(),
                title: "Задачи".into(),
                route: "/tasks".into(),
            }),
            route: "/tasks?task=task-1".into(),
            icon: None,
        };
        assert_eq!(
            validate_desktop_notification(&task_with_header),
            Err("notification_invalid")
        );
    }

    #[test]
    fn task_notification_without_header_keeps_title_and_body() {
        let notification = DesktopNotificationRequest {
            id: 19,
            title: "Новая задача".into(),
            body: "Проверить компьютеры".into(),
            kind: "task".into(),
            group: "task:0123abcd".into(),
            header: None,
            route: "/tasks?task=task-1".into(),
            icon: None,
        };

        validate_desktop_notification(&notification).unwrap();
        let xml = windows_notification_xml(&notification).unwrap();
        assert!(xml.contains("<text>Новая задача</text>"));
        assert!(xml.contains("<text>Проверить компьютеры</text>"));
    }

    #[test]
    fn notification_xml_escapes_untrusted_preview_text() {
        assert_eq!(
            escape_xml("<b title=\"x\">A&B's</b>"),
            "&lt;b title=&quot;x&quot;&gt;A&amp;B&apos;s&lt;/b&gt;"
        );
    }

    #[test]
    fn only_the_bundled_startup_document_is_allowed_before_production() {
        assert!(is_local_startup_url(
            &Url::parse("http://tauri.localhost/startup.html").unwrap()
        ));
        assert!(!is_local_startup_url(
            &Url::parse("http://localhost:4317/startup.html").unwrap()
        ));
        assert!(!is_local_startup_url(
            &Url::parse("http://tauri.localhost/nested/startup.html").unwrap()
        ));
        assert!(!is_local_startup_url(
            &Url::parse("https://tauri.localhost/startup.html").unwrap()
        ));
        assert!(!is_local_startup_url(
            &Url::parse("http://tauri.localhost/startup.html?retry=1").unwrap()
        ));
    }

    #[test]
    fn retry_entry_continues_into_the_https_preflight_path() {
        use std::sync::atomic::AtomicUsize;

        let mut state = StartupState::new();
        state.transition(StartupStage::NetworkCheck).unwrap();
        state.fail(StartupErrorCode::Network).unwrap();
        state.retry().unwrap();

        let entry = enter_preflight(&mut state);
        assert_eq!(entry, PreflightEntry::RunHttps);
        assert_eq!(state.snapshot().stage, StartupStage::NetworkCheck);

        let launches = AtomicUsize::new(0);
        let result = tauri::async_runtime::block_on(launch_https_path(entry, || async {
            launches.fetch_add(1, Ordering::SeqCst);
            "https-request-started"
        }));
        assert_eq!(result, Some("https-request-started"));
        assert_eq!(launches.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn bridge_is_origin_guarded_and_contains_no_credentials() {
        let script = desktop_bridge_script();
        assert!(script.contains(PRODUCTION_ORIGIN));
        assert!(script.contains("Object.freeze"));
        assert!(!script.to_ascii_lowercase().contains("service_role"));
        assert!(!script.to_ascii_lowercase().contains("supabase_key"));
    }

    #[test]
    fn production_overlay_is_origin_guarded_and_records_connected_fade_lifecycle() {
        let script = production_overlay_script();
        let html = include_str!("../../ui/startup-overlay.html");
        let css = include_str!("../../ui/startup-overlay.css");
        assert!(script.contains(PRODUCTION_ORIGIN));
        assert!(script.contains("window.location.origin"));
        assert!(script.contains("production-startup-overlay"));
        assert!(script.contains("letscube://startup-state"));
        assert!(script.contains("__letscubeStartupOverlayHistory"));
        assert!(script.contains("sessionStorage"));
        assert!(script.contains("letscube:startup-overlay-complete"));
        assert!(script.contains("is-connected"));
        assert!(script.contains("320"));
        assert!(html.contains("Подготавливаем рабочее пространство"));
        assert!(html.contains("production-startup-client-port"));
        assert!(html.contains("production-startup-server-port"));
        assert!(!html.contains("Рабочее пространство готово"));
        assert!(script.contains("status.textContent = successText"));
        assert!(script.contains("statusText: status.textContent"));
        assert!(css.contains("prefers-reduced-motion: reduce"));
        assert!(css.contains("transition-duration: 1ms"));
        assert!(css.contains("grid-template-rows: 74px 20px 126px 20px 19px 4px 14px"));
        // Both rails derive their outer end from the same expression instead
        // of from two hand-written numbers. The literals pinned here before
        // described a connector whose right rail ran 4px into its own node and
        // whose two nodes sat 4px apart vertically; pinning each side
        // separately could not notice that they disagreed.
        assert!(css.contains(
            "left: calc(25% - var(--column-shift) + var(--device-half) + var(--node-offset))"
        ));
        assert!(css.contains(
            "right: calc(25% - var(--column-shift) + var(--node-half) + var(--node-offset))"
        ));
        assert!(css.contains(
            "--node-offset: calc(var(--connector-clear) + var(--connector-node) - var(--chassis-inset))"
        ));
        assert!(script.contains("matchMedia"));
        assert!(script.contains("reducedMotion ? 1 : 320"));
        assert!(script.contains("fadeDuration"));
        assert!(!script.contains("service_role"));
    }

    #[test]
    fn a_certificate_fingerprint_is_the_sha256_of_the_der_bytes() {
        // NIST vector for the empty input, so a swapped digest is caught rather
        // than a self-consistent wrong one.
        assert_eq!(
            certificate_fingerprint(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            certificate_fingerprint(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(certificate_fingerprint(b"").len(), 64);
    }

    #[test]
    fn only_32_bytes_of_hex_is_accepted_as_a_fingerprint() {
        assert!(is_fingerprint(&"a".repeat(64)));
        assert!(is_fingerprint(&certificate_fingerprint(b"abc")));
        assert!(!is_fingerprint(""));
        assert!(!is_fingerprint(&"a".repeat(63)));
        assert!(!is_fingerprint(&"a".repeat(65)));
        assert!(!is_fingerprint(&format!("{}z", "a".repeat(63))));
        assert!(!is_fingerprint(&"-".repeat(64)));
    }

    #[test]
    fn external_handoff_allows_only_safe_system_protocols() {
        assert!(is_safe_external_url(
            &Url::parse("https://api.letscube.ru/releases/files/windows/client.exe").unwrap()
        ));
        assert!(is_safe_external_url(
            &Url::parse("mailto:admin@example.com").unwrap()
        ));
        assert!(!is_safe_external_url(
            &Url::parse("file:///C:/Windows/System32/cmd.exe").unwrap()
        ));
        assert!(!is_safe_external_url(
            &Url::parse("javascript:alert(1)").unwrap()
        ));
        assert!(!is_safe_external_url(
            &Url::parse("https://user:password@example.com/").unwrap()
        ));
    }
}
