# LETSCUBE Production Priority Tracker

Status: active production-hardening tracker, updated 2026-08-31.

This file is the working source of truth for the next production stages. Before starting any new production task, read this file first, then update the relevant checkboxes/status when work is completed, blocked, or intentionally deferred.

Execution ownership:

- This tracker/chat owns the shared backend and web interface plus Windows and Android applications.
- iPhone/iPad PWA implementation and physical QA are owned by a separate agent. Do not modify or repeat that work from this execution stream; only consume its committed `main` baseline after checking `git status` and `git log`.

Approved architecture handoff (2026-08-30):

- `[x]` Registration lifecycle cleanup Tasks 1-5 are implemented, reviewed and deployed in report-only mode. A fresh production backup, checksum/restore-list verification, rolled-back migration rehearsal, exact migration apply, auth-gateway deployment, trusted worker deployment, bounded backfill and aggregate smoke all passed. The worker is healthy with `REGISTRATION_CLEANUP_ENABLED=true` and `REGISTRATION_CLEANUP_REPORT_ONLY=true`; the observed report contained one not-due invite lifecycle and no candidates or failures.
- `[!]` Automatic deletion remains deliberately disabled. Changing `REGISTRATION_CLEANUP_REPORT_ONLY=false` requires a separate aggregate report review and an explicitly observed bounded deletion canary; do not infer that approval from the completed report-only rollout.
- `[x]` LETSCUBE Bot API foundation is migrated, deployed and production-canary verified. Public creation remains restricted to one internal owner while the public app/download home, compact Stable changelog and shared motion system move to the next stage specified in `docs/superpowers/specs/2026-08-30-registration-lifecycle-bot-platform-public-home-design.md`.
- The specification contains a mandatory macOS/iOS handoff. Apple clients must consume the shared registration, bot identity, notification, release/changelog and motion contracts instead of creating parallel backend behavior. iPhone/iPad PWA implementation remains externally owned and is not modified by this stage.

Legend:

- `[x]` done and covered by regression checks.
- `[~]` active stage.
- `[ ]` pending.
- `[!]` blocked or deferred by an external dependency.

## Current Execution Order

1. `[x]` Priority 1 - Auth and anti-abuse baseline.
2. `[x]` Priority 2 - RLS and security audit baseline.
3. `[!]` Priority 3 - Backup and restore drill follow-ups.
4. `[x]` Priority 4 - Operator security observability.
5. `[~]` Priority 5 - Installed web/PWA production shell. iPhone/iPad-specific implementation and QA are externally owned.
6. `[!]` Priority 6 - Monitoring and self-hosted Sentry.
7. `[~]` Native/mobile packaging resumed: Windows Tauri secure startup and signed updater are complete; Android Stable now publishes the signed `0.1.3/4` APK with authenticated upgrade/logout/login/session restore, foreground/background/killed FCM acceptance, exact taps/read-sync, offline/reconnect, initial read/unread anchoring, fast-upward/prepend/footer stability, bounded geolocation and complete product media/capture acceptance on official-GMS Nothing. Live recovery, signer/Asset Links parity and a fresh official-GMS automatic domain verification passed. Android embeds its web bundle at build time, so unlike the Windows shell it does not pick up deployed web fixes; the published `0.1.3` carries the bundle built from `920c8e8` and is behind. External backup, a rebuild for the stale bundle and Play release remain active gates.

## Next Execution Queue

Use this queue before starting the next production-hardening turn. Do not repeat completed items unless a new bug report or regression test proves the old fix is insufficient.

1. `[x]` Fix Coolify worker auto-deploy gap so `letscube-worker` updates automatically when worker/backend code changes. Verified on 2026-06-23: push `56ac76e` created worker deployment `l9ca22g6e83fkn2psv6cc8lx` with `is_webhook=true` and status `finished`. Worker `watch_paths` now limit deploys to `artifacts/api-server`, Docker/deploy files and workspace dependency manifests so docs-only commits do not redeploy the worker. GitHub Actions are intentionally disabled and workflow files were removed; Coolify webhooks are the deployment path.
2. `[~]` Continue chat performance audit and synchronization hardening. Current known findings:
   - `[x]` Composer text is cleared immediately after optimistic send instead of waiting for delivery/read checks.
   - `[x]` Fully read chat opens anchored to latest messages.
   - `[x]` Chat with unread messages opens near the first unread boundary.
   - `[x]` Chat info media gallery uses generated variants instead of original media files for tiles.
   - `[x]` Reproduce and fix fast upward history scrolling bug: when the user quickly scrolls up through older messages, the message list no longer jumps back to the newest/bottom position during initial bottom settling.
   - `[x]` Prevent older-history auto-prepend from racing initial chat open anchoring: the top-of-list loader is disabled until the initial unread/bottom scroll has been applied, so read chats do not silently open on an older slice.
   - `[x]` Keep the sent message visible in the sidebar immediately through the optimistic store update and reconcile it with the realtime echo by `client_message_id` (`a458cd9`).
   - `[x]` Reopen a recently visited PWA chat from cached messages without an empty loading loop, then reconcile in the background (`f2c6673`).
   - `[x]` Hydrate chat/sender metadata before completing push navigation so a slow PWA resume does not stay on the generic `Чат` fallback (`f2c6673`).
   - `[x]` Add proposal-only batched sidebar summaries RPC and a frontend compatibility path. The RPC reduces last-message/unread loading from approximately `2 + 3N` requests to three batch requests while remaining `SECURITY INVOKER` and RLS-aware.
   - `[x]` Applied `.migration-backup/supabase/migrations/20260709_chat_list_summaries.sql` manually on 2026-07-09 after a verified full database backup. All 10 users with chat memberships matched the legacy unread/preview semantics, anonymous RPC access is denied, authenticated REST and production frontend calls return `200`, and `VITE_CHAT_LIST_SUMMARIES_RPC_ENABLED=1` is active in the healthy web deployment.
   - `[x]` Measured the active batch RPC and large-history rendering in production on 2026-07-10 with `owner`, `tech_admin`, `location_staff` and `client` QA accounts at 1440x900 and 390x844. For the 246-message history, cold sidebar readiness was 505-564 ms, summary RPC was 47-55 ms, first 100 messages rendered in 452-467 ms, and warm reopen was 174-200 ms. Loading the remaining 146 messages took two 642-757 ms prepend pages without returning to the bottom; scroll-anchor error was 0 px desktop and at most 42 px mobile.
   - `[x]` Replaced the startup permission fan-out with one authenticated access snapshot. `.migration-backup/supabase/migrations/20260710_current_user_access_snapshot.sql` was applied manually on 2026-07-11 after verified backup `/srv/letscube/backups/pre-migrations/20260711-105607-before-access-snapshot.dump`. Full parity covered all 12 profiles with zero global-role, global-permission or location-permission mismatches. `anon` has no execute grant, `authenticated` does. `VITE_ACCESS_SNAPSHOT_RPC_ENABLED=1` is active in production; live Playwright observed exactly one `current_user_access_snapshot` request and zero legacy `has_permission`, `has_location_permission` or `has_global_role` requests.
3. `[x]` Add a bounded 720p video transcode worker path and upload/playback quality selection. The trusted worker now creates H.264/AAC MP4 variants at up to 1280x720 without upscaling, with two ffmpeg threads and a ten-minute timeout. A production-runtime benchmark converted a 10-second 1080p/9 MB sample to approximately 1 MB in 1.55 seconds; landscape, portrait, audio and no-upscale contracts passed. Compact/standard playback prefers the ready 720p derivative, high quality and explicit original-file opening keep the original. Existing originals are retained. Production backfill is complete for all 26 non-deleted videos with a valid Storage source; five older videos initially outside the newest 120 media rows were recovered after adding bounded pagination.
4. `[x]` Added hybrid media upload progress, retry and current-session resume. Files above 6 MiB use TUS with exact 6 MiB chunks and bounded retries; smaller files keep the standard Storage path. Cancellation terminates partial uploads, retry keeps a stable object path, and chat/composer scopes prevent delayed files, recordings, location results or failed captions from crossing into another chat. A disposable 7 MiB production object was uploaded, read back at the exact size and deleted.
5. `[!]` Keep iPhone/iPad Home Screen as the only PWA install target. Android browsers use the APK catalog and Windows browsers use the EXE catalog. Further iPhone/iPad PWA implementation and physical QA are owned by a separate agent and are out of scope for this execution stream.
6. `[!]` Keep monitoring/Sentry and backup restore rehearsal deferred until the user confirms the backup environment and restore-test window.
7. `[~]` Complete the Capacitor Android release candidate. The signed and verified `0.1.3/4` APK is published in Stable; its matching AAB remains local and unpublished. Android 13/14/16 Google Play emulators passed the emulator lifecycle matrix. Separately, official-GMS Nothing passed same-key package-data and authenticated session/chat/native-registration retention, explicit logout/login plus cold session restore, warm/cold/killed callbacks, malformed/foreign rejection, signed-final foreground/background/killed FCM, exact-chat taps/read-sync, authenticated offline/reconnect, read/unread initial anchoring, fast-upward and prepend stability, footer stability, bounded geolocation, large-file product upload/progress/sent playback/cleanup and camera/photo/regular-video/video-circle/voice controls. Local Task 4, live Asset Links parity, recovery routing, fresh official-GMS automatic domain verification and Stable catalog publication are complete. External off-device backup and Play setup remain external gates.

    **Re-verified 2026-09-05 against the live bytes, not the manifest.** The
    download at `https://api.letscube.ru/releases/files/android/0.1.3/letscube-0.1.3.apk`
    is 6,744,616 bytes with SHA-256 `77049445...c509863`. That matches the
    manifest's `size` and `sha256`, and matches the locally built
    `android/app/build/outputs/apk/release/app-release.apk` byte for byte, so the
    published artifact is the reviewed one. Those bytes pass
    `scripts/verify-android-release.mjs`: v2 signature scheme, exactly one
    non-debug signing certificate, `com.kub.messenger`, versionName `0.1.3`,
    versionCode `4`, not debuggable, the exact exported-component and permission
    contracts, and a certificate matching the tracked Digital Asset Links
    statement, which is in turn byte-identical to the one
    `https://app.letscube.ru/.well-known/assetlinks.json` serves. The Android
    unit suite passes 46/46 and `android/version.properties` declares the same
    `0.1.3`/`4`, so no unreleased version bump exists. Gradle still configures
    the project offline, and `assembleRelease` fails closed without
    `LETSCUBE_ANDROID_KEYSTORE_PATH` before any task runs, which is where a
    verification pass has to stop.

    **The open item is the shipped web bundle, not the packaging.**
    `capacitor.config.ts` sets no `server.url`, so the WebView loads
    `assets/public/` out of the APK instead of `https://app.letscube.ru`, the way
    the Windows shell does. The published APK's `assets/public/` is
    byte-identical to `android/app/src/main/assets/public/`, built 2026-09-03
    20:15 from `920c8e8`; 37 commits under `artifacts/kub/` have landed since,
    and none of them can reach an installed Android client. One matters on its
    own: `be18439` fixed the pre-paint theme bootstrap, and the shipped bytes
    still carry the break. Parsing the APK's own `index.html` reproduces
    `SyntaxError: Unexpected token '.'`, so the `0.1.3` release note
    «Тема приложения следует системной» cannot hold before React
    mounts on the installed build, and the remaining "confirm on a device" step
    of D-028 cannot pass against `0.1.3` at all. Browser and Windows users
    already have the fix because both load the deployed origin; only a new APK
    gives it to Android.

    **And the published `0.1.3` has no push at all.** Looking for the stale
    bundle turned up something worse in the same artifact. `apkanalyzer
    resources names` over the two published APKs differs by exactly six string
    resources, all lost and none gained: `google_app_id`, `gcm_defaultSenderId`,
    `google_api_key`, `project_id`, `google_storage_bucket` and
    `google_crash_reporting_api_key`. Those are what the google-services Gradle
    plugin emits from `google-services.json`, and `FirebaseInitProvider` reads
    them at startup. `0.1.3` still carries the entire Firebase messaging stack --
    `FirebaseInitProvider`, `FirebaseMessagingService`, the Capacitor
    `MessagingService`, `FirebaseInstanceIdReceiver` -- with nothing for any of
    it to initialise from, and no `FirebaseOptions` is hardcoded anywhere under
    `android/app/src`. So `PushNotifications.register()` cannot obtain a token,
    and every account that took the `0.1.3` update lost notifications entirely.

    The cause is mechanical rather than mysterious. `android/app/build.gradle`
    applies the plugin inside a `try/catch` that logs at `info` level when the
    file is absent, so a release build that omits it prints nothing and
    succeeds. `google-services.json` is local-only and ignored, and the QA
    record of 2026-09-02 states it was deliberately left out of this worktree
    for the routing debug build; the `0.1.3` release was then built from that
    same worktree on 2026-09-03 and inherited the omission. `0.1.2`, built
    where the file was present, carries all six resources.

    Two gates now fail closed on it. `android/app/build.gradle` refuses a
    release task graph without `google-services.json`, checked after the
    existing signing gates so their message stays first, and only for release
    tasks so a debug build without Firebase still builds.
    `scripts/verify-android-release.mjs` rejects a release APK missing any of
    the four resources Firebase initialises from. Both are mutation-tested, and
    the hardened verifier was run against the real artifacts: it rejects the
    published `0.1.3` with "Release APK has no google-services configuration"
    and accepts the published `0.1.2` unchanged. The Android unit suite is
    48/48.

    The rebuild this entry already needed for the stale bundle is now also the
    fix for push, and it must be built where `google-services.json` is present.
    Note that the checkout that holds it, `D:\CodexProjects\LetsCube-Chat`, is
    202 commits behind `origin/main` and older than the `0.1.3` bundle, so it
    cannot simply be built from as it stands.
8. `[x]` Replace the retired Electron spike with a clean-profile Tauri 2 Windows client. The one-window secure startup, tray/single-instance behavior, Stable/Test channels and signed Tauri updater are complete. Physical `0.2.0 -> 0.2.1`, `0.2.1 -> 0.2.2`, `0.2.2 -> 0.2.3`, `0.2.7 -> 0.2.8`, `0.2.8 -> 0.2.9` and `0.2.9 -> 0.2.10` production-update rehearsals passed without losing the authenticated profile. The `0.2.10/14` release keeps the hardened startup fix, restores Yandex SmartCaptcha compatibility in WebView2 and replaces the legacy venue subtitle embedded in the startup SVG with the neutral LETSCUBE wordmark. A successful version change shows a compact four-second confirmation and then frees the top-right area for future call controls.
9. `[~]` Complete the external Windows release gates. LETSCUBE `0.2.10/14` retains the exact-origin native Windows toast/history/action contract: one stable Toast Header per chat, up to five unread message cards, exact per-message routing from fresh and historical cards, independent routing for other chats, and chat-scoped history removal after reading. Its reproducible updater wrapper reads the existing encrypted signing identity only from ignored local files and fails if the matching public key changes. Stable download plus Stable/Test updater catalogs expose the same verified immutable installer. A fail-closed Authenticode path, provider-isolated WNS sender, sanitized Windows matrix and native offline/long-session suite are prepared. A second fail-closed tool validates Microsoft package metadata, requires the exact PFN in its generated client contract, reports all missing metadata in one pass, renders matching sparse-package/executable manifests and builds a local unsigned `MakeAppx` validation artifact without changing the internal NSIS path. The live Supabase schema was audited read-only and the `windows/wns` proposal passed a production-schema transaction rehearsal with full rollback; it remains unapplied until a real identified client can acquire a WNS channel. Remaining external work is the real Microsoft package identity/publisher/PFN/Entra mapping, production signing and SmartScreen reputation, Windows 10 and alternate WebView2 device runs, Windows App SDK channel/COM registration, proposal application, server secrets and true killed-process physical delivery.
10. `[x]` Harden direct-email support notifications. New inbound email tickets now create the same PII-free `ticket_created` event as web tickets, eligible pool operators receive one creation notification, and later requester replies notify the pool while the ticket remains unassigned. The first email message does not create a duplicate requester notification. The production migration was applied after a verified dump and passed a transactional live-DB fanout smoke.
11. `[x]` Improve global search for messages and people. The existing full-history message RPC remains active and measured an average 33.221 ms over 20 runs in the current largest 236-message chat. Exact verified-phone lookup now accepts only an explicit complete `+E.164` query, requires `users.view`, returns a profile-only projection, caps results at 10 and grants execution only to `authenticated`. It never returns the phone field or queries `profile_contacts` from the frontend. Migration `20260801112259_privacy_safe_phone_search.sql` was applied after backup `/srv/letscube/backups/pre-migrations/20260801-113105-before-privacy-safe-phone-search.dump` and passed production transaction rehearsal plus post-apply authorization smoke. Production currently has no verified phone contacts, so real phone results remain empty until SMS/OTP verification is configured and completed.
12. `[x]` Unify the LETSCUBE web and Windows application chrome. Desktop now has one 44px application bar with one wordmark, aligned sidebar/chat control rows and exact-origin Tauri window controls. Placeholder build `0.0.0` is hidden, media quality uses a compact accessible track, the empty chat view uses factual copy, and the administration dashboard shows bounded real metrics, registrations, users and audit activity. The bundled startup and production handoff preserve pixel-stable endpoint geometry; the update pill sits below the titlebar and cannot cover window controls. Browser, mobile viewport, Rust and complete Windows lifecycle QA passed on 2026-08-20.
13. `[x]` Harden Windows WebView auth and reorganize user settings. Yandex SmartCaptcha now enables its supported embedded-WebView mode in Windows/native shells while retaining the browser flow. Physical WebView2 diagnostics found that the non-default Tauri `freezePrototype: true` blocked the Yandex runtime while assigning its internal `toString`; the client now uses Tauri's compatible default while exact-origin navigation, minimal capabilities, immutable desktop bridge and CSP remain enforced. The real Windows WebView loaded the runtime, rendered the checkbox frames and exposed no CAPTCHA load error. The auth shell now owns bounded vertical scrolling, so registration controls and recovery/privacy links remain reachable in a short `1360x860` window. Settings open on a quick section for theme and notifications, with direct Profile, Audio and Application tabs; mobile tabs use a stable 2x2 layout. Active microphone/self-monitor gain changes update the live Web Audio graph, processing changes prefer in-place track constraints, and video quality appears only after staging video with Economy, Standard and Original choices. Desktop `1440x900` plus mobile `390x844`/`412x915` layout checks, auth gateway regression, production build, smoke, database type drift, RLS smoke and the complete Windows lifecycle suite passed on 2026-08-21.
14. `[x]` Remove the nested vertical scroll surface from the folder editor. `KubModal` now remains the only vertical scroll owner while the chat checklist expands in normal modal flow, keeping its footer reachable without adjacent scrollbars. The focused regression passed against production at desktop `1440x900` and mobile `390x844`; full authenticated smoke passed all five project viewports.
15. `[x]` Expand and group emoji selection without stretching the interface. Folder icons now expose 48 choices across four task-oriented categories; the message composer exposes 80 emoji across five categories. Both use one reusable keyboard-accessible picker, render only the active category and remain overflow-free on desktop and mobile. The message picker is capped at 420px on wide chats and stays full-width on narrow screens.
16. `[x]` Deploy and canary the LETSCUBE Bot API foundation. A fresh backup, isolated PG17 restore, transactional schema smoke and RLS checks preceded production apply. The dedicated Bot Gateway runs exact commit `01d26a9225fee1cda0b8e9676b4ab03b084dec64`; token rotation, private/restricted update privacy, webhook/polling exclusion, idempotent sends, two-message notification grouping/read-sync, log redaction and exact cleanup passed with push-free QA participants. Bot creation remains limited to one internal owner.
17. `[~]` Build the unauthenticated public app/download home with theme-safe product previews, verified Windows/Android Stable downloads, a compact Stable changelog and shared motion feedback. Preserve native-shell routing, `/privacy`, `/support`, authentication callbacks and iPhone/iPad PWA ownership boundaries.
18. `[~]` Interface audit and polish stage. Requested by the user on 2026-09-01 and deliberately scheduled **after** the public home plan closes, so it does not interleave with an approved in-flight plan. The goal is a measurably better interface, not a restyling: find the accumulated visual defects, make the interface more responsive, and give actions real feedback. It has two halves that must not be merged into one undisciplined sweep.

    - **Half A - audit first, then fix.** Enumerate defects before changing anything. Sweep the six release viewports (`3840x2160`, `1920x1080`, `1440x900`, `412x915`, `390x844`, `360x800`), both themes, and all three shells (browser, Windows Tauri WebView2, Android APK WebView). Record every finding with a reproduction, the exact surface, a screenshot and a severity, then fix in scoped batches with a regression test proportional to the risk. Do not "polish by eye": a change without a recorded defect or an explicit design decision is out of scope. `360x800` was added on 2026-09-06: the matrix used to stop at 390, and three of the five findings of the first Android walk (D-058, D-060, D-061) came from below it, on the 360-wide phone the product is installed on. Expect findings in layout overflow and clipping, inconsistent spacing and control heights, focus and hover states, contrast in both themes, scrollbar and safe-area behaviour, keyboard insets on Android, long-content and long-name truncation, empty and error states, and loading placeholders that shift layout.
    - **Half B - execute the already approved motion plan.** `docs/superpowers/plans/2026-08-30-shared-motion-feedback.md` already specifies the response and action animations: semantic timing tokens (90/140/220/320 ms and a ~2.4 s transient success), a bounded global action-feedback controller, consistent copy/save feedback, standardized loading/modal/save transitions, and cross-platform visual QA. It is 5 tasks and 33 steps, none started. Execute that plan rather than inventing a parallel animation system.

    Binding constraints for both halves: preserve every contract in the critical regression list, especially chat entry anchoring, search and notification jumps, history prepend, fast upward scrolling, notification grouping and read sync. Never animate layout dimensions for decorative feedback and never let an essential action wait on an animation. Honour `prefers-reduced-motion: reduce` by removing movement while keeping text, icon and colour feedback. Keep loading placeholders dimensionally stable. iPhone/iPad PWA behaviour remains externally owned; provide shared tokens and handoff notes instead of editing it.

    The defect register is open at `docs/INTERFACE_DEFECT_REGISTER.md`; entries D-001 to D-005 were recorded on 2026-09-01 while capturing the product previews from the shipping components.

    Deliverables: a defect register with evidence, scoped fix commits with tests, the motion plan closed task by task, and a visual QA record across the viewport and shell matrix. Write the detailed task-by-task plan when this stage actually starts; this entry is the approved scope and ordering only.

    **Half A is substantially complete as of 2026-09-06, and it turned into
    something larger than an audit.** The owner asked for the interface to be
    brought to a modern standard with translucent surfaces, so the stage
    absorbed a redesign as well as a defect sweep. What shipped:

    - The product's surfaces are one material — four tokens per theme and two
      utilities — with the contract and its eleven rules in
      `docs/operations/interface-material.md`. Six of those rules were learned by
      breaking something first, which is why they are written down.
    - D-044 to D-050 are closed; D-048 closed itself when the text colour tokens
      landed for another reason.
    - Controls have one focus language instead of three. The old one was
      assembled and immediately overwritten — a focused button's computed style
      was byte-for-byte identical to an unfocused one — because Tailwind draws a
      ring as `box-shadow` and every glow and shadow utility answers to the same
      property.
    - Disabled controls are readable: they were faded with six different values
      of `opacity` across 79 places, measuring 2.23:1 and 1.94:1 against a
      threshold of 4.5.
    - The type scale has one bottom step instead of two, across 203 places.
    - Borders belong to what you aim at, not to everything.

    Four things this stage found are worth keeping in mind because they are
    general, not cosmetic: elevation is relative while tokens are absolute, and
    the same defect therefore arrived three times; a contrast measurement tells
    you whether text on a surface is legible and never whether the surface is
    visible; the application's own classes sat outside cascade layers and so
    silently beat every Tailwind utility applied beside them; and `opacity` is
    not a way to be disabled.

    **What remains in Half A:** the five-viewport, three-shell sweep is still
    browser-only — the Windows Tauri and Android WebView passes have not been
    run. Six realtime channels bind several tables each and work only because
    all their tables happen to be published; they are named in
    `tests/unit/realtime-channel-tables.test.mts` so the risk is visible in the
    tree rather than only in a report.

    **Progress as of 2026-09-03.** Half A's audit harness is
    `scripts/interface-audit.mjs`; it measures overflow, clipping, touch targets,
    contrast and focus visibility across the surface/viewport/theme matrix and
    refuses to measure an unstyled page — an early run produced 549 invented
    findings from raw HTML, every contrast reading exactly 1.00:1. The register
    at `docs/INTERFACE_DEFECT_REGISTER.md` now runs to D-019. Production
    measures 64 cells, 0 findings, 0 unreachable.

    Half B's motion plan is closed through Task 4; the shipped contract is
    documented in `docs/operations/shared-motion-feedback.md`. Task 5's browser
    validation is done; its Windows and Android runs remain.

    **Two defects found by this stage were worse than anything it set out to
    find, and neither was cosmetic.**

    The first: the profile was fetched three times concurrently while a stored
    session was being recovered — once by the mount effect and again for every
    auth event Supabase emits along the way. Measured against production, six
    restored sessions out of ten never reached the app; a person who closed the
    tab and came back sat on a spinner. Nothing was slow — that query executes in
    0.55ms, PostgREST was healthy and Postgres had 28 idle connections of 100 —
    but `loading` is only cleared in a `finally`, so one request that never
    settles holds the screen forever. Deduplicating to a single in-flight load
    took a local reproduction from 7/10 hung to 0/10. Fixed in `1310d5b`.

    The residual seen straight after the fix — 2 of 6 returns still hanging —
    was the measurement, not the product. Those runs signed in four times in two
    minutes, and the failures followed that rate: they clustered after the first
    few rounds, appeared as sign-ins that could not complete at all, and
    persisted with a fresh browser process per round, which rules out anything
    accumulating in the browser. Spaced 45 seconds apart, as a returning visitor
    actually behaves, production measured **0 of 6 hung**, every return in
    466-1169ms.

    The defect itself was not rate-induced, and the comparison that shows it is
    controlled: the same account at the same measurement rate went from 7/10 hung
    to 0/10 with only the code changed, and the instrumentation showed three
    identical outstanding profile requests in every hung run and none in the
    others.

    The second: two scroll-anchoring contracts listed as critical in the handoff
    had been reporting "skipped" on every run instead of protecting anything. The
    helper called `count()` on the chat list immediately after sign-in, and
    `count()` is a snapshot rather than a wait, so it read zero rows and skipped.
    They run now.

19. `[~]` Roles and permissions. Requested by the owner on 2026-09-04 ("крайне неудобно", "очень перегружена для администратора", "старые fallback роли"), then on the same day: remove the excess without breaking what works, and reassign anyone on a legacy role to a proper one. **Data half done and applied 2026-09-04 (`20260904060000`); the UI half and one owner decision remain.**

    **This entry's first version measured the wrong table, and the correction is the useful part.** It counted `role_permissions` rows and concluded that `owner` and `tech_admin` "grant an identical 40-permission set". They do — and it does not matter, because `has_permission` never reads those rows for them. Verified against production:

    ```
    has_permission(u, k):
      1. has_global_role(u,'owner') or has_global_role(u,'tech_admin') -> return true   -- no table read
      2. user_global_roles -> role_permissions, scope='global' and is_active
      3. otherwise _legacy_role_has_permission(profiles.role, k)                        -- hardcoded in the function
    ```

    What follows from that, all measured rather than reasoned:

    - **`role_permissions` currently decides nothing for anybody.** All 14 accounts resolve to exactly two outcomes: 40 permissions (4 accounts, via tier 1) or one, `chats.invite` (10 accounts, via tier 3). Nothing lands on `admin`'s 23 rows or `manager`'s 9. Emptying those tables would change no one's access.
    - **There are four administrators, not two.** Two hold `profiles.role='admin'` *and* a global `owner`/`tech_admin`; the other two hold `owner`/`tech_admin` while the legacy column still calls them ordinary users. Any reasoning that starts from `profiles.role` is wrong about who can do what.
    - **The location tier is load-bearing and must not be removed.** `_task_visible_to_current_user_v3`, the SELECT policy on `tasks`, calls `has_location_permission` five times, and that function *does* read `role_permissions`. 4 locations, 15 members, 40 tasks depend on it. The first version of this entry proposed deleting the tier "unless something depends on it" — something does.
    - **The chat tier is the genuinely dead one.** `has_permission` filters `scope='global'` and `has_location_permission` filters `scope='location'`, so a chat-scope role is read nowhere; real chat authority comes from `chat_members.role`.

    **Applied on 2026-09-04** — names and descriptions only, plus two backfills; no write to `profiles.role`, no change to `role_permissions`:

    - the five «клуб» titles became «Владелец / Администратор / Менеджер / Сотрудник / Участник локации», satisfying section 7 of `CLAUDE.md`. No UI change was needed: `getRoleLabel` prefers `roles.name` from the database, and the club strings lived only in the seed.
    - the three chat-scope roles are `is_active = false` — deactivated, not deleted, because the foreign keys cascade. The admin panel already filters inactive roles out of its assignment pickers.
    - seven pre-trigger accounts got the global `user` role they should always have had, and one `location_members.role_id` that was NULL was filled.

    Verified before and after: the full cross product of every account against every permission was compared, and **not one decision changed** — 4 accounts with all 40, 10 with one, exactly as before. The migration carries that check internally and aborts on drift in either direction, widening included.

    **Decided by the owner, 2026-09-04 — the parity is intentional, and this is not a defect to fix.** The split between `owner` and `tech_admin` is organisational: one runs the technical side, the other runs people and the product, and the second also comes in to test, so narrowing his reach would obstruct the thing he is there to do. The roles say who someone is; they were never an access boundary. The short-circuit in `has_permission` is therefore the correct implementation, and the descriptions now state it (`20260904070000`) so the next audit does not re-file it as a bug — this one did. Changing it later means changing the function, not the data.

    **Still open — the panel, but far less of it than this entry claimed.** Read on 2026-09-04, `RolesPermissionsTab.tsx` already does most of what was proposed here: it groups permissions with `PERMISSION_CATEGORY_ORDER` / `getPermissionCategory` into a two-column grid of labelled, described category cards, gives every permission a name, a description and its technical key, and already renders a notice reading «Владелец и тех. администратор всегда получают полный доступ. Набор прав здесь информационный и не ограничивает эти роли» — the exact statement this entry asked for.

    What is plausibly left is density rather than structure: eight category cards, every permission expanded with its full description, nothing collapsed, and one column below the `lg` breakpoint — a very tall page for a screen whose job is usually "check one thing". Collapsing categories by default with a count of what is enabled, and diffing two roles without opening both, would both help. But that is a guess at what the owner finds inconvenient, and **this entry has now been wrong three times by inferring the interface from the database instead of reading it. Ask before redesigning.**

    **A trap worth remembering.** The `20260514` seed uses `on conflict (key) do update ... is_active = true`, so re-running it silently restores the club titles and revives the chat roles. Recorded in the migration and covered by a test.

    Two smaller findings left deliberately untouched: one member row whose `role='staff'` disagrees with its `role_id=location_client` — aligning it would *add* `tasks.view` and `tasks.claim`, which is a widening and needs a decision — and the two bypass-role holders whose legacy column reads `user`: these are two of the five `is_test_account` logins, given `owner` and `tech_admin` deliberately so the functionality behind them could be exercised, and they disappear when those logins are deleted. The audit first read them as privilege that had leaked, which they are not — but any count of administrators that does not exclude test accounts is wrong by two.

20. `[~]` The user profile card. The frame moved off the docked column on 2026-09-04 (`94b5ce1`); its contents were reworked on the same day. The owner's reference is a desktop messenger's contact card, and the gap is in what the card *contains*, not where it sits.

    **Shipped:** above `DOCK_BREAKPOINT` the card floats and drags, reusing `lib/floatingWindow.ts` and the drag-skip that keeps header buttons clickable; below it, the docked panel renders exactly as before. Focus handling, Escape and the session-remembered position are in. Nobody has looked at a rendered pixel of it — see below.

    **The four findings the owner reported on 2026-09-04 after using it are addressed.** Each contract below was mutation-tested — 33 mutations, all caught — in `tests/unit/message-media-sections.test.mts` and `tests/unit/profile-window.test.mts`.

    - **The gallery is a sub-view, not an expanding block.** The card body is two stacked layers; «Общие медиа» pushes, the arrow in the title bar and Escape pop. `resolveProfileWindowEscape` in `lib/profileWindow.ts` decides between ignore / back / close, so a confirmation standing over the gallery still owns Escape. The root cause of "cannot be collapsed" was that for a private chat the info block rendered on `!isGroup` regardless of tab, so the media block was appended *underneath* it and nothing could take it away.
    - **The media is divided by type, with counts.** `lib/messageMediaSections.ts` classifies rows into Фото, Видео, GIF, Файлы, Ссылки, Голосовые, Видеосообщения and Аудио from `type` plus the voice/round-video predicates, which were lifted out of `ChatWindow.tsx` rather than copied, so playback and the gallery cannot disagree about a row. A section with a count of zero is never offered. The media query now also loads `audio`; links come from a separate, soft-failing query over text rows, capped at 60 and run only on opening the gallery. Counts are of loaded rows and read `12+` while more exist — «at least 12» is true either way, where a bare `12` beside 300 photos is not.
    - **There is one profile surface.** `ChatProfilePreviewModal` is deleted from `ChatList.tsx`; «Открыть профиль» and the group/channel information entry both go through `selectAndOpenPanel("info")`, the route `Поиск в чате` already used. The nickname copy button — the one thing the mini-profile had and the card did not — moved onto the card. **Behaviour change:** the mini-profile deliberately did not change `selectedChatId` (recorded in `QA_RESULTS.md`); the card lives inside the chat window, so opening it now selects the chat. That is the cost of having one surface.
    - **The media viewer regression is fixed.** `MediaViewer` is portalled to `document.body`, so its `z-[90]` is measured against the page instead of against the card's `z-[60]` stacking context, and the `z-[70]` support window no longer paints over a full-screen photo.

    **Motion:** the push uses `.kub-subview` in `index.css` — `transform` and `opacity` only, on `--kub-motion-standard` / `--kub-ease-standard`, with the layers absolutely positioned inside a box that already has a size, so nothing with a size is animated. Reduced motion collapses it with the rest.

    **Still not verified by eye.** There is no jsdom or component runner in this repository, so the push and pop, the drag, the docked fallback on a phone, the section strip scrolling horizontally, both themes and the paint order of a confirmation opened from inside the gallery have never been looked at. The contract tests cover structure, wiring and the pure classification, not appearance. The links query is also unverified against a real chat: it is a single loose `content ilike '%http%'` over text rows with no supporting index, bounded by `chat_id` + `created_at` and by a 60-row range, and it fails soft — if it errors the section is simply absent.

    **The division moved into the card on 2026-09-04, at the owner's request.** They had seen the divided sub-view, liked the result, and asked for it arranged the way their reference desktop contact card arranges it: the counts belong in the card, and the card scrolls. So the horizontal strip of section tabs is gone and the card root carries a vertical list of counted rows — icon, then a label that *is* its count, «1543 фотографии», one kind per line, full width, between the settings rows and the destructive actions. Pressing one pushes the same sub-view, now holding only that kind; the title bar names it, the arrow and Escape still pop it. A kind with a count of zero has no row, and in a chat that has never carried media the band is absent entirely.

    Two consequences worth writing down rather than rediscovering:

    - **The counts had to move to the front of the load.** They used to be fetched when «Общие медиа» was pressed. They cannot be, now that the card decides which rows exist from what came back: a kind not yet loaded is indistinguishable from one this chat has never contained. Both queries — the media page and the soft-failing links query — therefore run when the card opens, so opening a profile now costs what opening the gallery used to. Both loaders were rekeyed from the `currentUser` object to `currentUserId` at the same time; with the object in the dependency list, any profile change from the store would have emptied and refetched the counts underneath the reader.
    - **The counts are still of loaded rows, so they read «24+», not «1543».** `MEDIA_PAGE_SIZE` is 24 and `classifyMessageMedia` splits `image` into photo/GIF, `video` into video/GIF/round and `audio` into voice/track on the client. An exact per-kind total would need those predicates expressed again in PostgREST filter syntax — a second classifier, which is exactly what the module exists to prevent. The visible cost is that a kind living only beyond the loaded window has no row at all: 24 recent photos hide an older file. That was equally true of the tab strip, but the strip did not look like a complete inventory and this list does. Fixing it properly means either paging until every kind is settled or moving the classification into SQL; neither was in scope and neither should be done by eye.

    Russian numeral agreement lives in `messageMediaSections.ts` beside the classifier (`selectRussianPluralForm`, `MESSAGE_MEDIA_COUNT_FORMS`, `formatMediaCountLabel`): «1 фотография» / «2 фотографии» / «5 фотографий», with the teens taking the «many» form, and `видео` indeclinable in all three slots on purpose. The `12+` form keeps agreeing with the number actually printed. 23 mutations across the two contracts, all caught, including two guards that had to be strengthened first: `role="tablist"` matched only the literal the strip happened to be written with and walked past the same role reintroduced as an expression, and the harness's own "did the mutant apply" check mis-read a duplication as unapplied.

    **Also still not verified by eye**, for the same reason as above: the counted rows in either theme, their density beside the existing action rows, the docked card below 640, the one-row loading placeholder, and how a long label such as «619 голосовых сообщений» truncates in the narrow docked column.

## Last Confirmed Deploy Baseline

**Current: `8bff49f`, deployed 2026-09-05/06 in four staged pushes.** The
staging was deliberate — the interface work changes how the whole product looks,
and shipping it apart from the fixes means a regression points at one batch
rather than at twelve commits.

| batch | tip | what it carried |
| --- | --- | --- |
| 1 | `5fcc6dd` | Windows startup screen rebuilt with real TLS fingerprints; the storage relocation fix; the material foundation; chat sync repairs; the file name that arrived as the sender's caption |
| 2 | `7837286` | `/privacy` printing in one column; the guest-session fixture dated from the run; a flake that was a race, not a threshold |
| 3 | `0f3c0cd` | the cascade-layer move; seven interface findings closed; the fourth text colour |
| 4 | `053aeb6` | the visual redesign: quieted material, glass that shows content, one focus language, the type scale, border discipline |
| 5 | `8bff49f` | realtime channels split per table |

Each batch was validated at its own commit before shipping — batches 2 and 3 in
a throwaway worktree, because a green run on the full tree says nothing about
whether a batch works **without** what sits above it. That caught three
failures in batch 2 that turned out to be a missing production build, which the
tests refuse to proceed without rather than passing trivially.

Every deployment was verified by reading the running container's own image tag,
its healthcheck and its replica count, and then by fetching the live stylesheet
to confirm the change reached a reader. A webhook firing is not evidence that
anyone received anything.

Rollback is a fast-forward of `main` to the previous tip in that table.

Three production database repairs were applied in the same window, each with a
verified schema backup taken first and each ending in a check that raises
rather than reporting success on a half-applied state. They are in
`.migration-backup/supabase/migrations/`: `20260905140000` gave back the
execute permission that had stopped **every** client upload for 37 hours;
`20260905150000` fixed a UUID pattern of 8-4-4-12 that had made two storage
paths unreachable since May; `20260906120000` and `20260906130000` published
four tables whose realtime bindings had never delivered.

- Previous baseline, superseded: `5da93e0` (public home with downloads and the
  compact Stable changelog, over the previous single-scroll folder editor,
  grouped emoji pickers, privacy-safe verified-phone search, Windows
  notification routing and chat-history anchoring baseline). `main` was
  fast-forwarded from `7a99f52` to `5da93e0` on 2026-09-02, taking 63 commits, so
  it no longer diverges from the branch the Bot Gateway canary was cut from.
- Deployed revision verified by behaviour, not by assumption: the live page
  renders the macOS and iPhone/iPad status as `В разработке` and joins the
  summary with `и` ("Windows и Android доступны для загрузки; macOS и iOS в
  разработке"). Both strings exist only in `5da93e0`. The served bundle changed
  from `index-Do_cSPEY.js` to `index-DY4jgnIu.js` roughly 150 seconds after the
  push. The Coolify deployment id, its healthcheck result and the replica
  replacement were not read from Coolify in this session and are therefore not
  recorded here.
- Coolify app: `letscube-web`.
- Public app: `https://app.letscube.ru`.
- Auto deploy: GitHub webhook to Coolify is active for `letscube-web`. The latest UI code container completed exact commit `aff77ab82c9af30deea25781caa742b558dbecbb`, passed its healthcheck and replaced the previous rolling replica. The chat-summary and access-snapshot RPC build flags remain enabled.
- Worker auto deploy: worker-specific GitHub webhook is verified. Deployment `hjlbhqir375ia6wzmqarhswq` completed exact commit `8d20b89645b9471b4477a8566a5d23ff5cfc9027` with `is_webhook=true`, status `finished` and a healthy `/api/healthz` check. Worker `watch_paths` remain limited to worker/build/runtime paths and shared package manifests. GitHub Actions are intentionally disabled and repo workflow files/secrets were removed to avoid billing-lock email noise.
- Self-host stack: Coolify proxy, self-hosted Supabase, Mailcow, app and worker deployment are already in place.
- Bot Gateway: Coolify application `letscube-bot-gateway` (`twezs89u2m6d6ln6c0rpaqxe`) is healthy on exact commit `01d26a9225fee1cda0b8e9676b4ab03b084dec64`; deployment `z9rvt9gh3qtos2oqp3lcxoh5` passed the 2026-08-31 production canary. Creation admission is still bounded to one internal owner.
- Support mail bridge: MX/SPF/DKIM/DMARC passed on authoritative and public
  resolvers. The non-public `letscube-support-mail` worker is enabled and
  healthy after verified backup
  `/srv/letscube/backups/automated/20260729-134340`. A real outbox delivery was
  accepted by Gmail MX and external receipt was confirmed. Commit `8c1f5fa`
  fixed the IMAP fetch/flag deadlock found by the first reply; production is
  restart-free after the repair. The manually seeded QA contact HMAC was
  corrected. A second physical reply was attached to the same ticket exactly
  once, acknowledged in Mailcow and displayed in the production operator UI
  without console/network errors, completing bidirectional acceptance. A
  dedicated GitHub push webhook was added for this resource, passed its initial
  ping and has auto deploy enabled; the next matching support-mail source push
  still needs to prove a deployment with `is_webhook=true`.
- Support notification fanout: migration
  `.migration-backup/supabase/migrations/20260801100856_support_email_pool_notifications.sql`
  is active after verified backup
  `/srv/letscube/backups/pre-migrations/20260801-101035-before-support-email-pool-notifications.dump`.
  The production DB smoke covers creation fanout, first-message dedupe and
  later unassigned requester replies inside `BEGIN ... ROLLBACK`. Client roles
  cannot execute the internal trigger helper. No support-mail source changed in
  this stage, so a webhook deployment was intentionally not manufactured.
- Production domains verified on 2026-07-09: `app.letscube.ru`, `deploy.letscube.ru`, `core.letscube.ru`, `mailserver.letscube.ru`, `notify.letscube.ru`, and SSH host `ms.letscube.ru` resolve and expose their expected services with valid TLS where applicable.
- `api.letscube.ru` now serves the read-only native release catalog with valid TLS through Coolify application `letscube-releases`; `status.letscube.ru` and `monitor.letscube.ru` remain reserved future endpoints.
- The installed Supabase MCP connector still targets the legacy cloud project. Production self-host checks must use `core.letscube.ru`, the local secret-safe env file, or read-only SSH/database inspection.

## Completed Baseline - Do Not Rebuild Without A New Finding

- `[x]` Self-host migration foundation: app, Supabase, Storage/media, mail delivery, and Coolify deployment moved to the server.
- `[x]` Docker subnet conflict with hoster gateway identified and avoided by custom Docker address pools.
- `[x]` Mail delivery baseline: Mailcow DNS, DKIM, PTR, external smoke, Supabase recovery email delivery and branded recovery template.
- `[x]` Auth copy: signup and recovery messages are generic and do not reveal account existence.
- `[x]` Password recovery route and UI flow work with self-hosted mail.
- `[x]` Existing-account signup cannot be used to obtain access to an existing user account.
- `[x]` Yandex SmartCaptcha gateway protects signup and recovery.
- `[x]` Direct public signup/recovery bypass paths are blocked at the proxy layer.
- `[x]` Auth gateway has in-function rate limiting before CAPTCHA/Auth calls.
- `[x]` Login token endpoint HTTP 429 maps to friendly Russian UI copy.
- `[x]` Invite code/link flow exists, with invite-only mode controlled from the admin panel.
- `[x]` Invite code field is hidden when invite-only mode is off; preconfigured invite links apply role/club in the background.
- `[x]` Reserved admin-like usernames are blocked for non-admin users.
- `[x]` RLS smoke and anon REST probes exist and cover authenticated/anonymous boundaries.
- `[x]` Group invite non-member hardening proposal was applied manually after explicit approval.
- `[x]` Notification center tabs and grouping are in place.
- `[x]` Message notification read-sync/grouping baseline is in place.
- `[x]` Chat scroll anchoring baseline: no unread -> bottom, unread -> first unread, search/notification jumps preserved.
- `[x]` LETSCUBE visual cleanup: auth branding, duplicate sidebar logo, mascot placement, and visible KUB/KUB text cleanup are done.
- `[x]` Unified interface chrome: one desktop wordmark, aligned shell dividers, compact media quality selector, factual welcome state, real-data admin dashboard and integrated Windows titlebar are complete.

## Priority 1 - Auth And Anti-Abuse

Status: `[x]` baseline complete. Keep as regression guard.

Goal: public auth endpoints must not allow bot signup, password guessing, recovery abuse, or CAPTCHA bypass.

Definition of done:

- `[x]` Signup and recovery go through the Yandex SmartCaptcha auth gateway in the public app.
- `[x]` Direct public bypass paths to sensitive Supabase Auth endpoints are blocked or rate limited at the proxy layer.
- `[x]` Login, signup, recovery, verify, resend and token endpoints have server-side throttling or gateway protections.
- `[x]` User-facing auth errors do not reveal whether an account exists.
- `[x]` Existing users cannot obtain a session through the registration screen.
- `[x]` 429/rate-limit errors map to friendly Russian UI copy.
- `[x]` Auth abuse checks have repeatable smoke tests and operational verification commands.

Keep checking:

- `[ ]` Run gateway/no-direct-auth Playwright checks when CAPTCHA env is enabled.
- `[ ]` Add an operator-facing auth anti-abuse smoke script if repeated manual curl checks become noisy.
- `[ ]` Revisit stronger account creation controls only if abuse continues despite CAPTCHA/rate limits/invite mode.

## Priority 2 - RLS And Security Audit

Status: `[x]` baseline complete. Keep as regression guard.

Goal: authenticated users can only read/write rows, objects and RPC effects allowed by membership, role, location and task permissions.

Definition of done:

- `[x]` All inspected exposed public tables have RLS enabled.
- `[x]` Public views are absent or use `security_invoker` / restricted grants.
- `[x]` Anonymous REST exposure checks exist.
- `[x]` Authenticated role boundary checks exist.
- `[x]` Storage policies for media, avatars and task attachments are path-scoped and role-aware.
- `[x]` SECURITY DEFINER function hardening is tracked through proposals when needed.

Keep checking:

- `[ ]` Run `pnpm.cmd rls:anon-rest` in security-stage validation.
- `[ ]` Run `pnpm.cmd rls:smoke` in security-stage validation.
- `[ ]` Run `KUB_QA_ALLOW_MUTATIONS=1 pnpm.cmd rls:smoke` only when mutation fixture validation is needed.
- `[ ]` Create new SQL proposals only for concrete drift or a verified gap.

## Priority 3 - Backup And Restore Drill

Status: `[!]` follow-ups deferred by user on 2026-06-22.

Goal: a full LETSCUBE production restore must be executable from backups without relying on memory or ad hoc commands.

Guardrails:

- No SQL changes in this stage unless explicitly requested.
- No restore into production.
- No destructive remote cleanup during inventory.
- No env, token, database password, SMTP password, or secret contents in repo/docs/logs.
- Restore rehearsal must use an isolated temporary target.

Definition of done:

- `[x]` P3.1 Read current backup status and runbooks before making changes.
- `[x]` P3.2 Record read-only live inventory: backup directories, scripts, timers, cron, Docker volumes, Supabase/Mailcow/Coolify config locations.
- `[x]` P3.3 Confirm Postgres logical backup command and retention policy.
- `[x]` P3.4 Confirm Supabase Storage/media backup command and retention policy.
- `[x]` P3.5 Confirm Coolify, Mailcow, Caddy, Supabase compose/env/config, and ops docs are backed up without exposing secret values.
- `[x]` P3.6 Add or update backup scripts only if missing, idempotent, and secret-safe. Existing scripts are present; no script update was needed during this inventory pass.
- `[x]` P3.7 Run non-destructive backup verification: archive listing, metadata checks, row/object counts where safe.
- `[!]` P3.8 Prepare isolated restore target plan and get explicit approval before any restore. Deferred.
- `[!]` P3.9 Rehearse restore into isolated target. Deferred.
- `[!]` P3.10 Verify restore: row counts, key tables, Storage object counts, basic app smoke. Deferred.
- `[x]` P3.11 Decide and document temporary off-server/offsite backup destination. Temporary target is a private GitHub repository with client-side encrypted chunks; permanent backup storage remains a later replacement.

Current baseline:

- Infrastructure docs describe backup/restore expectations.
- Self-host migration placed operational files under `/srv/letscube`.
- Server backup inventory and non-destructive verification are recorded in `docs/infra/BACKUP_RESTORE_STATUS_20260622.md`.
- Latest verified local backup set: `/srv/letscube/backups/automated/20260622-034450`.
- Latest backup checksum verification: passed.
- Temporary GitHub offsite backup is configured and encrypted before upload.
- GitHub offsite target: private repository `ALTIS13/letscube-encrypted-backups`.
- Server upload script: `/srv/letscube/scripts/letscube-github-offsite-backup.sh`.
- Server timer: `letscube-github-offsite-backup.timer`.
- Latest controlled GitHub offsite sync: completed for `/srv/letscube/backups/automated/20260622-034450`.

Next action:

- `[!]` Monitor the first scheduled GitHub offsite timer run on 2026-06-23. Deferred by user.
- `[!]` Replace temporary GitHub storage with a dedicated backup target (`rclone`, `restic`, or `borg`) when available. Deferred until backup environment is ready.
- `[!]` Prepare an isolated restore target plan and get explicit approval before any restore. Deferred.

## Priority 4 - Operator Security Observability

Status: `[x]` baseline complete. Keep as regression guard.

Goal: make auth abuse, invite-code abuse, and suspicious registration/login patterns visible to operators without leaking sensitive data.

Candidate work:

- `[x]` Add or document an operator smoke command for auth gateway rate limits and direct-auth bypass checks.
- `[x]` Add an admin-facing or ops-facing view/report for recent auth/invite security aggregates if product-safe.
- `[x]` Ensure reports do not show raw secrets, passwords, CAPTCHA tokens, recovery tokens, or full IP data unless explicitly approved.
- `[x]` Keep this separate from CAPTCHA/rate-limit implementation unless new gaps are found.

Current baseline:

- Operator smoke script: `scripts/auth-anti-abuse-smoke.mjs`.
- Package command: `pnpm.cmd auth:anti-abuse:smoke`.
- Runbook: `docs/security/AUTH_OPERATOR_SMOKE.md`.
- Default smoke checks direct `/auth/v1/signup` and `/auth/v1/recover` protection without creating users.
- Default smoke checks `auth-yandex-gateway` signup/recovery no-CAPTCHA handling.
- Repeated gateway rate-limit stress is opt-in through `--stress-rate-limit` or `KUB_AUTH_SMOKE_STRESS_RATE_LIMIT=1`.
- 2026-06-22 live smoke result: direct signup/recovery returned 403, gateway no-CAPTCHA returned `captcha_required`, opt-in stress observed 429 `rate_limited` on repeated gateway attempts.
- Admin/Ops report UI: `/admin/ops`.
- Admin/Ops report runbook: `docs/security/ADMIN_OPS_REPORT.md`.
- Admin/Ops report SQL proposal: `.migration-backup/supabase/migrations/20260622_admin_ops_security_report.sql`.
- SQL was not applied automatically. Until the RPC is applied, `/admin/ops` shows a friendly migration warning and still displays frontend protection status.
- The report intentionally returns aggregate counts and sanitized invite/auth event labels only; it does not show email, IP, password, CAPTCHA/recovery/push tokens, actor IDs, or target IDs.

## Priority 5 - Installed Web/PWA Production Shell

Status: `[~]` active. The iOS-only install policy and Android/Windows release catalogs are deployed. iPhone/iPad-specific implementation and physical QA are owned by a separate agent and must not be duplicated here.

Goal: retain the full browser client on every platform, expose PWA installation only on iPhone/iPad, and direct Android/Windows users to dedicated native packages.

Scope:

- `[x]` Refresh PWA shell identity: document title, Apple app title, manifest name/short name and install metadata use `LETSCUBE`.
- `[x]` Add platform-aware Settings distribution state: iPhone/iPad PWA, Android APK and Windows EXE. Android/Windows no longer render a PWA CTA or receive a manifest link.
- `[x]` Add a five-second, six-hour cached release check with stale fallback, strict manifest/SemVer/SHA validation and honest system download handoff without fake byte progress.
- `[x]` Deploy read-only `https://api.letscube.ru/releases/` through non-root Nginx/Coolify with SSH-only atomic publishing, CORS, no-cache manifests and immutable artifacts.
- `[x]` Verify PWA manifest, service worker registration, offline/reconnect banner and direct app-shell routes across desktop/mobile Playwright viewports.
- `[x]` Verify browser/PWA push contract: stable notification tags, same-tag close behavior, click routing, and no raw media/token fields in SW payload handling.
- `[x]` Harden browser/PWA push lifecycle: reconcile subscriptions on startup/focus/reconnect, detect stale VAPID keys, close read same-tag cards on active clients, update the installed-app badge, and preserve DB `read_at` as the cross-device source of truth.
- `[x]` Add Web Push `Topic` isolation and a backward-compatible Declarative Web Push fallback for iOS/iPadOS 18.4+ without changing Browser/PWA subscription semantics.
- `[x]` Remove the dual-dispatcher race: Supabase Cron/`send-push-notifications` owns production Web/FCM delivery; the legacy API push loop is off by default and cannot consume the same outbox unless explicitly enabled for isolated local testing.
- `[ ]` Verify the installed iPhone/iPad Home Screen window without browser chrome.
- `[ ]` Verify real browser/PWA push delivery and notification click routing against a live installed client.
- `[x]` Verify automated iOS manifest injection and confirm Android/Windows browsers are not offered PWA installation across all five Playwright viewports.
- `[ ]` Preserve full messenger functionality: auth, chats, media, camera, voice, video-circle, tasks, search, notifications.
- `[x]` Keep release signing material out of Git. The verified signed `0.1.3/4` APK passed release review and is published in Stable, superseding `0.1.2/3`; its AAB remains under ignored local storage and was not uploaded to Play Console.

Current baseline:

- The Android `0.1.3/4` signed APK is published in Stable. Its public manifest
  and fresh HTTPS download match the 6,744,616-byte canonical artifact and
  SHA-256 `7704944572e7c97150e159f3326b65b936fee1d11c0b01d852132423dc509863`,
  re-measured 2026-09-05. The superseded `0.1.2/3` was 6,513,250 bytes with
  SHA-256 `d414fb7a818beb86a5bfbd06dc9cdc657e8aa82fa07acc32927b15ab2748af99`.
  Baseline and final APKs produced byte-identical tracked Digital Asset Links
  JSON, while the old debug signature correctly failed in-place upgrade. The
  official-GMS Nothing device retained both a non-sensitive app-local sentinel
  and an authenticated QA session/chat/native-notification registration through
  the same-key upgrade. The matching AAB remains local and unpublished.
- Task 4 fix round 1/5 made the Asset Links verifier exact and cleared the
  production-preview browser gate (`e2e:smoke` 5/5; targeted 66 passed with four
  fixture-inapplicable mobile skips). One bounded Nothing login submission did
  not leave the login form, so authenticated upgrade/FCM remain open without a
  retry. Final safe lifecycle/callback checks passed on the official-GMS
  Nothing and sequential API 33/34/36 Google Play AVDs.
- Task 4 fix round 2/5 used the controller-approved temporary same-key QA
  baseline, but Android 15 exposed no WebView devtools socket and the single
  bounded CDP forward returned zero targets. The helper was not invoked. The
  temporary call was removed from source and compiled bytecode before the real
  final rebuild; final `0.1.2/3` is non-debuggable, strictly verified and has
  exact same-key Asset Links parity. Authenticated physical acceptance remains
  blocked on establishing a safe QA session.
- Task 4 fix round 3/5 used the separately authorized ignored QA baseline with
  temporary WebView debugging and `android:debuggable=true` to establish one
  bounded CDP-authenticated session. Final source/Gradle/version state was
  restored before rebuilding and upgrading to non-debuggable `0.1.2/3`.
  Session/chat/registration retention and post-DND background/killed grouped
  system-card, exact-chat tap and read-sync checks passed. Foreground
  realtime/in-app reconciliation passed, but independent foreground FCM
  transport remains unproven. Physical media/geolocation/history/footer checks
  remain skips after UIAutomator could not expose the attachment controls and
  the bounded device run was stopped.
- Task 4 fix round 4/5 used one controller-approved same-key, same-version
  debuggable QA overlay on official-GMS Nothing for bounded CDP instrumentation.
  Independent foreground FCM transport, authenticated offline/reconnect, a
  visible first-unread anchor and bounded geolocation passed. The overlay was
  replaced by restored-source, strictly verified, nondebuggable final `0.1.2/3`;
  the authenticated shell survived and all round-4 helpers/forwards were removed.
- Task 4 fix round 5/5 passed explicit physical logout, bounded helper login,
  cold authenticated session restore, fully-read/no-unread initial bottom,
  fast-upward stability, older-history prepend anchoring and sampled footer/
  timestamp stability. Synthetic media staging passed video-only quality,
  original selection and local preview playback, but no upload was sent because
  an isolated QA-only target was not proven within two minutes. Product upload
  progress/completion/sent playback/cleanup and camera/photo/regular-video/
  video-circle/voice remain physical skips, so Task 4 remains open.
- Controller closeout after the round cap proved a strictly QA-only product
  upload larger than 6 MiB with upload/send progress, completion, sent playback
  and product cleanup. Camera/photo, regular video, video-circle and voice each
  passed live/record/stop/cancel coverage without retaining or sending captured
  environment. Final `0.1.2/3` was rebuilt from restored production source,
  reinstalled nondebuggable with authenticated-shell retention, and all debug
  helpers/forwards were removed. Task 4 local physical acceptance is complete.
- The canonical local APK/AAB are the current restored-source Gradle outputs.
  Signed ZIP byte identity is not expected across independent rebuilds;
  package/version, nondebuggable state, signer/Asset Links parity and strict
  APK/AAB validation are the authoritative equivalence checks.
- Android final-review hardening is complete: callback recovery cannot reuse an
  unrelated persisted session, callback credentials are replaced out of browser
  history before exchange, and the release verifier rejects APKs without a v2
  signature. Canonical `0.1.2/3` was rebuilt and revalidated after these changes.
- The latest production web deployment is healthy. Live recovery opens the new
  password screen and removes callback query/fragment credentials from history;
  live Asset Links has exact final signer parity. Warm, cold and force-stopped
  implicit HTTPS routing passed on Realme under an approved association state.
  Realme's background-restricted OEM verifier is not counted as authoritative;
  the fresh system recheck on official-GMS Nothing returned
  `app.letscube.ru: verified` for the installed final package.
- `artifacts/kub/index.html` title and Apple web app title are `LETSCUBE`.
- `artifacts/kub/public/manifest.json` uses `LETSCUBE`, `display: standalone`, and `display_override` fallbacks.
- The iPhone home-screen icon uses a dedicated 180x180 LETSCUBE club asset; 192/512/maskable PWA icons use the same official mark, and the service worker precaches the complete icon set.
- Settings distribution block shows `iPhone/iPad / iOS PWA`, `Android APK`, `Windows EXE` or web-only status. Native manifests refresh on Settings open/resume without blocking app startup.
- The Windows stable download and both native updater catalogs offer LETSCUBE `0.2.8` build `12`. Their immutable 2,322,508-byte installer and adjacent updater signature passed server-side `minisign` verification. Public manifests agree on SHA-256 `697f345bd544281e27b7ab6f4293abebd6c024c10bf60ca6a6e513c5df2e7bfd`; the versioned artifact returns immutable caching. The production handoff keeps one fixed scene across navigation, remains readable for at least 2.2 seconds and holds the confirmed state for at least 0.9 seconds before fading. Explicit client/server ports bound the two rail halves outside both device bodies, and font loading or the connected state cannot change endpoint geometry.
- `letscube-releases` deployment `x11jjzh6qbcnszndx5av5paj` finished exact commit `491e172`; TLS/health, 404 listing denial, POST denial, CORS/cache headers and Android artifact size/SHA parity passed.
- `tests/e2e/pwa.spec.ts` covers PWA shell metadata, service worker safety, offline/reconnect banner, and SPA direct routes on 1440, 1920, 3840, 390 and 412 viewports.
- `tests/e2e/pwa-install-settings.spec.ts` covers desktop install variant and iPhone Safari home-screen guidance from the Settings install button.
- `tests/e2e/push-phone-foundation.spec.ts` covers push settings layout, phone fallback, SW push grouping/click-routing, native push adapter token hygiene and Android channels on the same viewport matrix.
- 2026-07-12 production audit found one Apple subscription stale since 2026-06-22 and historical HTTP 403 delivery failures. A live probe proved two consumers were racing one outbox: the legacy five-second API worker failed with sanitized Apple `BadJwtToken`, while the canonical Edge cron subsequently delivered the same row. The API loop is now opt-in only; current web/Edge VAPID fingerprints match and the VAPID keypair is valid.
- A post-deploy Apple Web Push probe completed through the canonical Edge cron with `attempt_count=0` and no delivery error. The QA notification and outbox rows were removed afterward; physical iPhone background/card/tap confirmation remains the release gate.
- Same-chat OS push replacement is intentional: the latest card represents that chat. Different chats/tasks remain isolated by tag and hashed Web Push Topic; the in-app Notification Center retains grouped semantic rows and unread counts.
- Client-side chat media optimization baseline is in place: new image attachments and avatars are bounded before upload when possible; new image/video messages carry dimensions/size metadata for stable bubble layout.
- The trusted media worker now produces bounded `video_720p` MP4 derivatives. Frontend quality metadata is explicit for new image/video messages; compact/standard video playback uses a ready derivative and safely falls back to the original while high quality always uses the original.

Next media/performance action:

- `[~]` Media variants pipeline:
  - `[x]` Applied `.migration-backup/supabase/migrations/20260622_media_variants_pipeline.sql` to self-host Postgres after a schema backup.
  - `[x]` Added optional server-side `kub-worker` runtime target/service for trusted media processing; frontend still receives no service-role secrets.
  - `[x]` Added image message variants (`image_thumb`, `image_preview`) and user avatar variants (`avatar_128`, `avatar_256`) generation through `artifacts/api-server`.
  - `[x]` Wired frontend read path to prefer ready message image variants and user avatar variants over original media where available. Avatar variants for chat peers need manual application of `.migration-backup/supabase/migrations/20260623_avatar_variants_read_policy.sql`.
  - `[x]` Raised self-host Supabase Storage upload size for `supabase-storage` to 250 MB and verified a 60 MB object upload/delete through the Storage API.
  - `[x]` Added server-side video poster generation (`video_poster`) through the trusted worker and wired chat video bubbles to use ready posters.
  - `[x]` Wired chat info media gallery to use ready image/video variants for tiles instead of loading original media files.
  - `[x]` Reproduced and fixed fast upward scroll jump in long chat history: user wheel/touch/pointer input now cancels initial bottom settling so quick upward scrolling is preserved.
  - `[x]` Added bounded `video_720p` transcoding and upload/playback quality selection. The worker uses H.264/AAC MP4, maximum 1280x720, preserved aspect ratio, no upscaling, even dimensions, `yuv420p`, fast-start, two ffmpeg threads, and a ten-minute timeout. The frontend polls only chats containing video, coalesces focus/visibility refreshes, bounds its chat cache, and falls back once to the original if a derivative cannot load. The candidate scan now paginates through a bounded 1,200-row window instead of starving media older than the newest 120 rows. Production contains 26 ready DB rows and 26 matching Storage objects (32,522,253 bytes), with zero invalid ready dimensions/MIME/size; two legacy video rows have no Storage source and cannot be derived.
  - `[x]` Added a hybrid Storage upload path: standard uploads through 6 MiB and TUS above 6 MiB with exact 6 MiB chunks, retry delays `0/3/5/10/20s`, previous-upload resume in the current staged session, determinate progress, stable object paths and remote partial termination on cancel. Cross-chat scopes now cover picker/image preparation, upload/send, drafts, geolocation and voice/video recorder completion. Browser QA exercised progress/cancel on all five configured viewports, and production TUS uploaded/read/deleted a 7 MiB disposable object.

## Priority 6 - Monitoring And Self-Hosted Sentry

Status: `[!]` deferred until backup/restore baseline is safe.

Goal: add production monitoring without relying on foreign unstable SaaS paths.

Candidate work:

- `[ ]` Deploy self-hosted Sentry or a lighter local monitoring alternative.
- `[ ]` Verify error capture from frontend and Edge Functions without secrets/message content/media URLs.
- `[ ]` Add uptime and synthetic checks for app, Supabase, mail, and Coolify.
- `[ ]` Add backup job failure alerts.

## Native And Desktop Packaging

Status: `[~]` active. Android and Windows Tauri internal candidates are available; production signing and update gates remain open.

- `[x]` Production debug APK connection and physical launch: the public build allowlist, LETSCUBE adaptive icons/dark splash, Android `0.1.0` versioning, install and first launch were verified on a Nothing/Spacewar A063 running Android 15.
- `[x]` Native Android FCM foundation: local ignored Firebase client config, Capacitor permission/registration/channels, live auth-scoped device RPCs, RLS-protected device/outbox schema, trusted HTTP v1 delivery and one physical background notification/tap smoke are complete.
- `[x]` Self-hosted native release catalog: Android `0.1.0` internal APK and immutable Windows Tauri `0.2.0` build `4` NSIS are available at `api.letscube.ru`; public size/SHA and cache/CORS headers were verified.
- `[~]` Native push release QA: real owner-to-client message delivery, sender exclusion, category preference suppression, same-chat collapse, server-backed chat read-sync, cold-start tap routing, killed-process delivery, separate task delivery, location-staff task routing, restart registration recovery and Android 16 Google Play emulator coverage pass. On 2026-08-26 the signed final `0.1.2/3` Nothing A063 official-GMS candidate retained authenticated session/chat/registration through a same-key upgrade and passed fresh post-DND background/killed grouped cards, exact-chat taps and read-sync. Fix round 4 separately proved independent foreground FCM transport, authenticated offline/reconnect, first-unread anchoring and bounded geolocation. Fix round 5 passed explicit logout/login/session restore and the remaining large-chat/history/footer cases; controller closeout then passed large-file upload/progress/sent playback/cleanup plus camera/photo/video/video-circle/voice controls. An earlier card absence under active DND is not counted as a delivery failure. A second Android 15 Realme device passes APK/portrait UI QA, but its custom-ROM microG cannot complete Google Check-in (`AccountDisabled`); broader vendor/device coverage remains an external release-quality action.
- `[x]` Stabilize chat message footer geometry: a physical Android probe reproduced the `inline`/`anchored` ResizeObserver feedback loop on a medium-length incoming message. Once measured overflow anchors the footer it now remains anchored until a real viewport/content change; timestamp digits and private-delivery icons reserve fixed width. The same physical probe changed from two alternating layouts to one stable layout across 160 samples.
- `[x]` Release signing/AAB with the permanent RSA-4096 PKCS12 identity and all
  signing inputs outside Git. Canonical nondebuggable `0.1.2/3` APK/AAB pass
  strict identity, signer and structure checks; the encrypted off-device backup
  remains an external operational gate.
- `[x]` Android build-environment isolation: inherited unapproved `VITE_*`,
  infra pointers and secret-shaped variables are removed before Vite/Capacitor;
  only the four dedicated signing inputs are restored for Gradle release tasks.
- `[x]` Android verified HTTPS App Links and recovery callback are implemented
  for the exact `https://app.letscube.ru/auth/callback` route, and the three
  gates this bullet used to list are closed: the official-GMS domain
  verification and the warm/cold/killed callback rehearsal are recorded in
  queue item 7, and the production deployment was re-measured on 2026-09-05.
  `https://app.letscube.ru/.well-known/assetlinks.json` is byte-identical to
  the tracked `artifacts/kub/public/.well-known/assetlinks.json` (SHA-256
  `b36206f4...da879777`), carries one statement, one relation and one
  fingerprint for `com.kub.messenger`, and that fingerprint is the certificate
  the published `0.1.3` APK is actually signed with -- proven by running
  `scripts/verify-android-release.mjs` over the downloaded artifact, whose
  association check compares the two directly. Re-run that check whenever the
  signer changes; the association, not the app, is what a signer change breaks.
- `[x]` Retire the Electron spike after QA profile leakage and excessive package weight were confirmed. Electron source, installed package and shared QA profile were removed before publishing Tauri.
- `[x]` Tauri 2 internal candidate: isolated WebView2 profile, 1.19 MiB NSIS installer, tray/close-to-hide, branded startup, single instance, minimum exact-origin capabilities, clean-profile login and hidden-window foreground notifications.
- `[x]` Tauri rollout: frontend adapter deployed, clean installed-client QA repeated, and immutable Windows stable `0.2.0` build `4` published at 1,242,693 bytes with verified SHA-256.
- `[~]` Windows public release gate: repeatable isolated Tauri/WebView2 QA, same-version repair, silent uninstall, clean reinstall and real signed cross-version updater application pass. `0.2.7/11` passes physical hidden-window message/task isolation, five-card per-chat retention, exact fresh/history notification-card routing and chat-scoped read cleanup. Its immutable signed updater artifact was verified in Test and promoted unchanged to Stable. Sparse identity tooling now renders aligned package/executable metadata and passes `MakeAppx` validation locally. The live native-device schema is still Android/FCM-only; `.migration-backup/supabase/migrations/20260724_windows_wns_push_devices.sql` is a contract-tested, unapplied delta for authenticated Windows/WNS registration and shared native outbox enqueue. Real Microsoft identity/PFN onboarding, signed NSIS integration, Authenticode/SmartScreen, broader Windows 10/11 hardware QA and killed-process WNS delivery remain open.
- `[~]` Phone OTP delivery is available only to administrators with `system.manage`. Mandatory cutoff and data-access enforcement remain disabled.
- `[x]` Harden the existing LETSCUBE support conversations before adding another support transport: deterministic initial bottom position, preserved history reading, new-message affordance, responsive height cleanup and Playwright coverage. The shared anchor observes both content and viewport resizes; the final matrix passed 30/30 across all five desktop/mobile viewports.
- `[ ]` Add a separate staff-only LANGAME support workspace after the current support UX is stable. Their official documentation exposes the authenticated individual `Чат ТП` but no public integration API; require an official API/SSO contract or use a clearly separate email bridge rather than scraping the portal.

## Next Phone Verification Rollout

Status: `[~]` p1sms delivery is restricted to administrators after physical pilot QA. The current route is Telegram first with message-scoped digital fallback branches after `agg_error`, `not_delivered` or a terminal provider error; mandatory phone enforcement remains a separate future decision.

- Keep the current no-fake-verification fallback and never mark a number verified before a real OTP succeeds.
- `[x]` Privacy-safe exact phone search is deployed through `search_profiles_by_phone(text, integer)`. It accepts only normalized `+E.164`, requires `users.view`, returns profile fields without the phone number, and includes only `phone_verified = true` contacts.
- `[x]` The profile flow uses only the authenticated phone gateway. The browser cannot update Auth phone state or mark a number verified directly; the service-only gateway does so only after a valid code.
- `[x]` 2026-08-01 production audit: Supabase Auth `v2.189.0`, phone provider disabled, SMS autoconfirm disabled, Send SMS Hook not configured, zero verified phone contacts, and zero pending/duplicate/stale `phone_change` rows.
- `[x]` Delivery architecture selected: authenticated LETSCUBE gateway -> narrow p1sms adapter. The gateway owns the provider-compatible four-digit code because deployed GoTrue `v2.189.0` enforces 6-10 digits; no unsupported Auth setting or private fork is used.
- `[x]` p1sms source foundation: strict 44-character moderated template, hard 65-character guard, one immediate `telegram_auth` message per request, message-scoped `agg_error -> digit`, `not_delivered -> digit` and `error -> digit` fallbacks, no undocumented request fields, redirect blocking, four-digit HMAC-only storage, 10-minute TTL, five verification attempts, per-user/per-phone server ceilings and safe result categories. P1SMS support confirmed that `agg_error` is a separate not-sent status. LETSCUBE neither polls delivery nor issues a second provider request. Automated validation makes no real delivery request.
- `[x]` Provider activation: `P1SMS_API_KEY` and hook/HMAC secrets remain in trusted server storage. The shared LETSCUBE account stays isolated because runtime calls only the single-message send endpoint and never calls p1sms account, sender, history, scheduling, reject, phone-base, blacklist or cascade-management APIs.
- `[x]` The earlier global rollout migration was applied after physical pilot QA, then intentionally superseded by `20260821095000_phone_verification_admin_only.sql`: the global flag is now disabled and claim creation requires `system.manage`. `20260821101000_phone_gateway_admin_only.sql` also protects capability, cancellation, removal and SMS authorization at the server gateway, and cancels stale non-admin claims. Verified pre-change backup: `/srv/letscube/backups/pre-migrations/20260821-094138-before-phone-admin-only.dump`. Cutoff and `enforce_data_access` remain disabled.
- `[x]` Configure `GOTRUE_EXTERNAL_PHONE_ENABLED`, `GOTRUE_HOOK_SEND_SMS_ENABLED`, hook URI and hook secret in the self-hosted Auth runtime; SMS autoconfirm remains disabled.
- `[x]` Resend uses a fresh gateway delivery while preserving the 120-second UI/server cooldown and server-side per-user/per-phone limits. Broader CAPTCHA/cost alerting remains a global-rollout gate.
- `[x]` The current gateway flow does not use `auth.users.phone_change`; concurrent pending claims are rejected by phone HMAC and expired/cancelled OTP material is cleared.
- Decide separately where verified phone is required: profile contact, account recovery, sensitive admin actions, or optional MFA. Do not silently require phone verification for existing users without a migration and rollout plan.
- `[ ]` Complete real-device delivery QA for correct/wrong/expired/resend codes, provider outage, duplicate-number attempts, number changes, audit events, privacy-safe phone search, and recovery/MFA decisions before enabling enforcement.

The browser client remains the universal fallback and iPhone/iPad PWA remains the only web-installed target until Android and Windows release gates pass. Packaging must reuse the same validated frontend and may not weaken browser behavior.

## Default Validation Commands

Run only the commands relevant to the touched area, but prefer this baseline before commit/push:

- `git diff --check`
- `pnpm.cmd --filter @workspace/kub run typecheck`
- `cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"`
- `pnpm.cmd e2e:smoke` when frontend behavior changed.
- `pnpm.cmd db:types:check` when schema/types/database code changed.
- `pnpm.cmd rls:anon-rest` and `pnpm.cmd rls:smoke` during RLS/security stages.

Known validation notes:

- Vite sourcemap/chunk-size warnings may exist and are not automatically blocking unless new.
- `db:types:check` may report known advisory drift around message media fields/search RPCs/notification outbox until those are separately resolved.

## Security Guardrails For Every Stage

- No credentials, env values, access tokens, DB passwords, SMTP passwords, Firebase keys, CAPTCHA server keys, or service-role keys in git/docs/output.
- No `service_role` in frontend/public/mobile bundles.
- No `google-services.json`, keystores, or signing secrets in git.
- No SQL apply without explicit user approval.
- No production restore, destructive cleanup, or broad firewall/network changes without explicit user approval.
- Use focused diffs and record validation results.
