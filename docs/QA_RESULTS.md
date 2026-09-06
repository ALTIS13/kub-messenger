# QA Results

## 2026-09-06 - Windows 0.2.13 Stable release, and the QA gate it had to fix first

Cut `0.2.13` / `desktopBuild` 17 for one change: the flat stage track on the
connection screen, which landed in `5f1a0d4` *after* 0.2.12 was built, so 0.2.12
still showed the old bevelled one. That track is compiled into the shell, so a
build is the only thing that ships it. Nothing else in `windows-tauri/` moved
between `07b3c82` and this cut.

Published from `/srv/letscube/releases/incoming/windows-0.2.13-17`:

```
Published signed Windows updater test 0.2.13 (2366043 bytes, sha256 3a0134cfaf305e34f64adcf50271685108eadb385ac5895ef1fd3fd5e5384752)
Published signed Windows updater stable 0.2.13 (2366043 bytes, sha256 3a0134cfaf305e34f64adcf50271685108eadb385ac5895ef1fd3fd5e5384752)
Published windows stable 0.2.13 build 17 (2366043 bytes, sha256 3a0134cfaf305e34f64adcf50271685108eadb385ac5895ef1fd3fd5e5384752)
```

`node scripts/verify-public-release-artifact.mjs windows`, exit code 0:

```
windows 0.2.13: verified 2366043 bytes, sha256 3a0134cfaf305e34f64adcf50271685108eadb385ac5895ef1fd3fd5e5384752
```

Four independent readings agree on those bytes, which is the point of doing more
than one: the publisher's own report, the verifier streaming the download
catalog, a plain `curl` of each of the two public URLs hashed separately, and a
full `cmp` of both downloads against the locally built installer. The download
copy and the updater copy are byte-identical to each other and to the artifact
that was signed here.

The updater path was replayed the way an installed client walks it, using the
`pubkey` read out of `tauri.conf.json` **as it stood at `07b3c82`, the 0.2.12
cut** — the key a 0.2.12 installation actually holds. Stable returns `0.2.13`,
the SemVer gate offers it, `mandatory` is false with no `minimumSupportedVersion`,
the artifact at the manifest URL hashes to the manifest SHA-256, and the
signature carried *in the manifest* verifies against that 0.2.12 key over the
downloaded bytes. Server-side `minisign -Vm` reported `Signature and comment
signature verified` before publication. The key is unchanged since 0.2.11, so no
installed client has to learn a new signer. The verifier used for this was itself
checked in both directions first: it accepts the already-published 0.2.12, and
refuses both a different file and the same file with one bit flipped.

**The release was blocked first, and the block was real.** `pnpm.cmd
windows:tauri:qa` failed on `critical_update`: the helper `loginIfNeeded` uses to
confirm a session reported a signed-in client as signed out, and the scenario
burned its whole 45s budget. The screenshot showed the app signed in with the
mandatory-update gate correctly on screen, so the product was right and the test
was wrong. Cause: `inert` and `aria-hidden` do not hide an element, they take it
out of the accessibility tree, and `MainLayout` puts both on `desktop-app-shell`
while the gate is up — so `getByRole("button", { name: "Меню" })` could not reach
a button that was drawn and visible.

It was confirmed pre-existing rather than a regression by stashing the version
bump, rebuilding the shell at 0.2.12 and reproducing the identical failure on the
version already in production. Fixed in `52abfdb` by racing a `desktop-app-shell`
fallback alongside the role query. `app-top-bar` was rejected as the fallback:
`PublicPreviewCapturePage` renders `AppTopBar` on a public route, so it can be on
screen with no session behind it.

Two things worth recording rather than rediscovering:

- A mutation aimed at the gate's UI proves nothing here. `windows-tauri-startup.spec.ts`
  drives the shell to `https://app.letscube.ru`, not to `artifacts/kub/dist/public`,
  so editing `MainLayout.tsx` and rebuilding the local bundle left the scenario
  green while looking like a mutation that had been applied. Only `baseline`
  (`windows-tauri-shell.spec.ts`) serves the local build. What does bite: inverting
  the spec's own `inert` assertion, which turns the scenario red against a shell
  reported as `inert="" aria-hidden="true"`, and flipping the shell's injected
  `set_mandatory(true)` to false, which turns it red too. Every mutation was
  checked by SHA-256 before and after, on both the source and the built bundle.
- `pnpm.cmd windows:tauri:qa` cannot sign in when `artifacts/kub/dist` was built
  without `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`; it renders the
  "Подключение к серверу не настроено" screen and no login form appears.
  Rebuilding that bundle with the public client configuration is a prerequisite
  of the suite, not an app defect. This cost time in the 0.2.12 cut as well.

Authenticode is still not applied. That remains an open packaging item, not a
regression: SmartScreen treats 0.2.13 exactly as it treated 0.2.12.

## 2026-09-06 - Windows 0.2.12 Stable release and byte verification

Cut `0.2.12` / `desktopBuild` 16 (version pinned in `windows-tauri/package.json`,
`src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` and the
drift test). Built with `scripts/windows-tauri-updater-build.ps1`, which loads the
signing identity from the ignored local key material and asserts it against
`scripts/windows-updater-public.key` before running `tauri build`.

Published from `/srv/letscube/releases/incoming/windows-0.2.12-16` on the server:
the signed updater to `test`, promoted byte-identically to `stable`, then the
download catalog as build 16 with a five-entry highlights list.

```
Published signed Windows updater test 0.2.12 (2366203 bytes, sha256 2251a7ee4e3117b5861b7ba9b8b4b7d95c3db1f63d2d17e8a31bbaa6767893a1)
Published signed Windows updater stable 0.2.12 (2366203 bytes, sha256 2251a7ee4e3117b5861b7ba9b8b4b7d95c3db1f63d2d17e8a31bbaa6767893a1)
Published windows stable 0.2.12 build 16 (2366203 bytes, sha256 2251a7ee4e3117b5861b7ba9b8b4b7d95c3db1f63d2d17e8a31bbaa6767893a1)
```

`node scripts/verify-public-release-artifact.mjs windows`, exit code 0:

```
windows 0.2.12: verified 2366203 bytes, sha256 2251a7ee4e3117b5861b7ba9b8b4b7d95c3db1f63d2d17e8a31bbaa6767893a1
```

That verifier only covers the download catalog, so the updater side was checked
separately by replaying what an installed client does. Using the `pubkey` read
out of `tauri.conf.json` **as it stood at `8c39af4`, the 0.2.11 cut**, the stable
updater endpoint returns `0.2.12`, the SemVer gate offers the update,
`mandatory` is false with no `minimumSupportedVersion`, the artifact at the
manifest URL hashes to the manifest SHA-256, and the signature carried in the
manifest verifies against that 0.2.11 key over the downloaded bytes. Server-side
`minisign -Vm` reported `Signature and comment signature verified` for the same
bundle before publication. The updater public key is unchanged since the 0.2.11
cut, so no installed client has to learn a new signer.

Two things worth recording rather than rediscovering:

- 0.2.11 was published to production on 2026-09-04 (all three live manifests
  carried it) but no QA or tracker entry was ever written, so the documentation
  read as though 0.2.10 were current. Live manifests, not docs, are the
  authority for what is deployed.
- `pnpm.cmd windows:tauri:qa` serves `artifacts/kub/dist/public` and cannot sign
  in when that bundle was built without `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_ANON_KEY`; it renders the "Подключение к серверу не настроено"
  screen and the login form never appears. Rebuilding the bundle with the public
  client configuration is a prerequisite of that suite, not an app defect.


## 2026-09-01 - Public release artifact byte verification

Ran `node scripts/verify-public-release-artifact.mjs windows android macos ios`
against the live catalog. The verifier streams the real artifact, bounds the
stream, hashes what arrives and requires both the byte count and the SHA-256 to
equal the manifest before a public download is considered eligible.

```
windows 0.2.10: verified 2321755 bytes, sha256 31ed5a8749a85802ce67581e92a9518f67b9c5930fb7463072ab7bcfd737d760
android 0.1.2: verified 6513250 bytes, sha256 d414fb7a818beb86a5bfbd06dc9cdc657e8aa82fa07acc32927b15ab2748af99
macos: unpublished, nothing to verify
ios: unpublished, nothing to verify
```

Exit code 0. Missing Apple manifests are the expected unavailable state, not a
failure.

Discrepancy worth recording: the tracker's Windows entry names a `2,322,508`
byte installer with SHA-256 `697f345b…`, which is not what the live Stable
manifest points at today. The live manifest and its bytes agree with each other,
so the download surface is safe; the tracker figure refers to a different or
earlier artifact and must not be quoted as the current one.

## 2026-09-01 - Public product preview privacy sign-off

The plan for these assets states that scanning compressed image bytes is not
accepted as proof of image privacy, so this is a record of looking at the
generated pixels.

Assets: the six files under `artifacts/kub/public/product/`, as generated by
`node scripts/capture-public-home-previews.mjs`. Each was converted to PNG and
inspected individually.

| Asset | Geometry | What is visible | Verdict |
| --- | --- | --- | --- |
| `windows-messenger-dark.webp` | 1440x900 | Application bar with the LETSCUBE wordmark, sidebar with the real search control and two chat rows, chat header `Команда проекта / 4 участников`, a `Сегодня` separator, eight message bubbles with times and read receipts, empty composer | Clean |
| `windows-messenger-light.webp` | 1440x900 | The same interface in the light theme | Clean |
| `macos-preview-placeholder.webp` | 1512x945 | The same interface at MacBook proportions, light theme | Clean |
| `android-messenger-dark.webp` | 760x1140 | Conversation pane alone with the back control, as the application shows on a phone with a chat open | Clean |
| `android-messenger-light.webp` | 760x1140 | The same in the light theme | Clean |
| `ios-preview-placeholder.webp` | 780x1180 | The same at iPhone proportions, dark theme | Clean |

Confirmed absent from every image: real names, postal or email addresses, phone
numbers, tokens or credentials, production hostnames or paths, photographic
avatars, and any element that could be mistaken for a real account. Every
rendered string traces to the checked-in fictional fixture
`tests/fixtures/public-home-demo.json` or to the application's own interface
labels. Avatars are generated initials.

Neither Apple asset carries an App Store or Google Play badge, a download
prompt, a version, a release date or a certification claim. Labelling those
platforms as in development is the public interface's responsibility.

All six assets are byte-distinct, which the contract test enforces.

Known limitation recorded at the same time: because the previews render the
shipping components, they faithfully reproduce the message-bubble defects
recorded as D-001 and D-002 in `docs/INTERFACE_DEFECT_REGISTER.md`. Regenerate
the previews after those are fixed.

## 2026-08-31 - Bot API production canary

- Applied the Bot Platform migration after fresh backup `/srv/letscube/backups/automated/20260831-163741`, isolated PG17 restore, transactional schema smoke and isolated RLS validation.
- Deployed the dedicated Bot Gateway from exact commit `01d26a9225fee1cda0b8e9676b4ab03b084dec64`; Coolify deployment `z9rvt9gh3qtos2oqp3lcxoh5` completed healthy. Bot creation remains restricted to one pinned internal owner.
- Token creation/rotation passed: the current token authenticated and the previous token returned `401`. No token or credential was printed, committed or persisted in tracked files.
- The production canary passed private updates, restricted-group plain-message exclusion, restricted mentions, membership updates, polling/webhook mutual exclusion, idempotent send retry, two-message notification grouping, chat read-sync and bot-message no-echo behavior.
- Two dedicated QA participants with no active browser/native push destinations were used. Cleanup independently confirmed zero remaining canary chats, messages, notifications, updates, webhook rows, delivery attempts, leases and bot memberships; root-only evidence contains no raw token pattern.

## 2026-07-12 - Native release catalog and iOS-only PWA policy

- Added strict Android/Windows release manifest validation, SemVer plus Android build comparison, five-second timeout, six-hour cache, stale fallback and safe download URL allow-listing for `api.letscube.ru`.
- Settings now offers Home Screen PWA installation only on iPhone/iPad. Android browsers show APK status, Windows browsers show EXE status, and Capacitor Android compares its installed version/build. Download handoff is animated but never reports fake byte percentages.
- Deployed Coolify application `letscube-releases` (`fsk7qm5e4nm9kap9hv8chtts`) from exact commit `491e172`; final deployment `x11jjzh6qbcnszndx5av5paj` is healthy. The runtime uses non-root Nginx, host catalog files are not writable by the process, TLS is valid, manifests return CORS plus `no-cache`, artifacts return immutable caching, directory/root requests return 404 and POST is denied.
- Published the production-configured Android `0.1.0` debug APK as an internal QA artifact. Public download size and SHA-256 match the local build. At this release-catalog stage Windows was still `available:false`; its current Tauri status is recorded below.
- Validation passed: release unit/deployment contracts 17/17, typecheck, production Vite build, Android sync and production-debug APK build, PWA/distribution Settings 25/25 over 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915, authenticated smoke 5/5, production Settings smoke, advisory DB type drift check and RLS smoke. Existing Vite sourcemap/chunk-size warnings and generated/manual DB type warnings remain advisory.

2026-07-12 Android physical-device push and cold-start routing QA:

- Added a second physical Android 15 device (Realme RMX3830) to the Android UI matrix. The packaged phone activity is now locked to portrait so a sensor state cannot launch LETSCUBE in landscape; production-configured APK install and portrait startup passed on both physical devices.
- Updated the Realme custom-ROM microG stack from the official microG release, installed the matching Companion and Framework Proxy, enabled device registration/cloud messaging and excluded microG/LETSCUBE from battery optimization. The ROM still receives `AccountDisabled` from Google Check-in and therefore cannot obtain FCM registration. Official GMS was not mixed into the locked crDroid GSI because a reliable replacement requires a GApps-capable system image, not user-level APK replacement.
- On the Nothing/Spacewar A063 with official Google Play Services, a real owner-to-location-staff message was delivered while the LETSCUBE process was absent. The message used the `messages` channel and stable per-chat tag; tapping it cold-started the app and opened the correct chat.
- Fixed the cold-start action race: native push targets now wait until the authenticated profile is restored before calling `safeOpenChat`, preventing a false `Chat unavailable` dialog. Fixed the related bell race by marking chat message notifications through the existing auth-scoped server RPC even when the local Notification Center page has not loaded yet.
- Physical retest confirmed the tapped message was visible, no unavailable/ErrorBoundary UI appeared, and the corresponding server notification row became read. A separately created task arrived through the `tasks` channel and opened the assigned task on `/tasks` for `location_staff`.
- QA cleanup removed exactly three temporary messages, one task, their notifications/outboxes and the temporary location-staff FCM device row. Both physical devices were returned to the login screen; no credentials or raw FCM tokens were printed or committed.

2026-07-11 Android 16 emulator native-push release QA:

- Added a Google Play Android 16 / API 36 emulator to the existing Android 15 physical-device matrix and installed the production-configured debug APK without exposing private build values.
- Real owner-to-client message QA produced one recipient notification, zero sender notifications and one native outbox delivery. Three same-chat messages collapsed to one active Android notification with the stable `message:chat:<chat_id>` tag. Tapping the notification opened the correct chat, and all three related server notification rows became read.
- A task created through `task_create_v3` produced a separate native task notification. Tapping it opened the tasks route safely; the client-role fixture received the expected access-restricted screen instead of an ErrorBoundary. A staff-role task-detail routing pass remains pending.
- Disabling the message push category kept the in-app message notification but suppressed the native outbox. The category was restored after the check.
- Fixed native push lifecycle persistence: enable/disable now writes `notification_preferences.push_enabled`, and an enabled Android installation automatically refreshes its FCM registration after a cold app restart without prompting again. Android UI and database enabled/revoked states were verified.
- Fixed the light-theme auth logo to use the official dark LETSCUBE vertical wordmark; the targeted Playwright assertion passes.
- Validation passed: 9 Android production/FCM/preference unit tests, typecheck, web build, 21 auth-brand layout checks across five viewports, 5 Notification Center checks, 30 push/phone checks, 5 PWA checks, 5 authenticated smoke checks, advisory DB type drift check, RLS smoke, and a final production Android build/install on both the Android 15 physical device and Android 16 emulator. Eight unrelated signup assertions in the full auth file cannot reach their mocked signup response while live `invite-only` mode requires a code; the rendered restriction banner was verified and the focused brand suite passes.
- QA cleanup removed only the prefixed test messages/task/notifications/outboxes and the emulator device/preference rows. Production verification returned zero remaining prefixed QA messages and tasks. Raw FCM tokens and Firebase credentials were never printed.

2026-07-11 Android production APK and native FCM delivery foundation:

- Added a production debug APK build path that reads public Vite connection values from the ignored local infrastructure env, validates the HTTPS Supabase endpoint and publishes only an explicit public allowlist into the Vite build. Server credentials and service-role values are not forwarded to the app bundle.
- Registered the Firebase Android app for package `com.kub.messenger`. Local `android/app/google-services.json` and the Firebase Admin service-account JSON are ignored and untracked; the service-account credentials are configured only in the trusted self-hosted Edge Function runtime.
- Applied `20260711_native_push_fcm_delivery.sql` after explicit approval. The live schema now has the auth-scoped device registration/revocation RPCs, RLS-protected `user_push_devices`, and a separate native delivery outbox while retaining the browser Web Push outbox.
- Physical QA used a Nothing/Spacewar A063 on Android 15. The production APK installed and launched with the live connection configuration, Android notification permission was granted, FCM registration completed without printing the token, and the `messages`, `tasks`, and `system` channels were created.
- Auth-scoped REST/RPC smoke returned HTTP 204 for both device registration and revocation. The enabled and revoked database states were verified, then the smoke device row and temporary token files were removed.
- Trusted dispatcher smoke delivered one FCM notification to the backgrounded physical device. The notification appeared under LETSCUBE and tapping it opened the app without an ErrorBoundary. Test notification/device/outbox rows were removed afterward.
- Remaining native push release QA: killed-app delivery, a staff-role task-detail route, and a broader physical-device matrix. Release signing/AAB and external app links remain separate stages.

2026-07-11 Android release-candidate branding groundwork:

- Replaced the default Capacitor launcher/splash resources with generated LETSCUBE assets based on the official blue/magenta mark and dark club surface. The adaptive foreground includes mask-safe padding and both light/dark Android splash resource sets are generated.
- Added reproducible source `assets/logo.svg` and `pnpm.cmd android:assets`, which invokes pinned `@capacitor/assets@3.0.5` through `pnpm dlx` so the generator does not inflate production web/worker dependencies. Android identity remains `com.kub.messenger` / `LETSCUBE`; version baseline is `versionCode 1`, `versionName 0.1.0`.
- Android release asset contract tests passed 2/2. `pnpm.cmd android:sync` passed and `pnpm.cmd android:build:debug` completed successfully; `android/app/build/outputs/apk/debug/app-debug.apk` exists. Android Build Tools `aapt` confirmed package `com.kub.messenger`, version `1` / `0.1.0`, label `LETSCUBE`, min SDK 24 and target SDK 36.
- Physical install/launch branding QA is pending because `adb devices -l` returned no connected device. Native FCM, internal routing, release signing and AAB were not changed in this step.

2026-07-11 production access snapshot activation:

- Created and validated custom-format backup `/srv/letscube/backups/pre-migrations/20260711-105607-before-access-snapshot.dump` before changing the production schema.
- Applied `.migration-backup/supabase/migrations/20260710_current_user_access_snapshot.sql` in one transaction. The function is `SECURITY INVOKER`; `anon` has no execute grant and `authenticated` has execute access.
- Compared the snapshot with the legacy role/permission path for all 12 profiles: zero global-role, global-permission and location-permission mismatches. No profile identifiers or personal data were emitted by the comparison.
- Enabled `VITE_ACCESS_SNAPSHOT_RPC_ENABLED=1` in Coolify and completed deployment `yyexubdplrbqn87zncw47gac` for commit `81d3a47`.
- Live production Playwright observed exactly one `current_user_access_snapshot` request and zero `has_permission`, `has_location_permission` or `has_global_role` requests. The production authenticated smoke suite passed at 1440x900, 1920x1080, 3840x2160, 390x844 and 412x915 (5/5).

2026-07-10 pre-packaging access snapshot groundwork:

- Added proposal-only `.migration-backup/supabase/migrations/20260710_current_user_access_snapshot.sql`; SQL was not applied. The self-scoped authenticated RPC returns global role keys, global permissions and per-location permission keys without accepting a target user id.
- `useRole` now has one shared in-flight snapshot/cache path for all role and permission hooks, cache invalidation notifies mounted consumers, and the existing per-key RPC implementation remains the compatibility fallback.
- Rollout is gated by `VITE_ACCESS_SNAPSHOT_RPC_ENABLED=1`. With the flag disabled, the browser does not probe a missing RPC and therefore emits no expected PostgREST 404. The flag must be enabled only after the proposal is applied and verified.
- Access snapshot unit/source-contract tests passed 6/6. Typecheck and production build passed; build retained the existing sourcemap and large-chunk warnings.
- A rollout-only Playwright build with `VITE_ACCESS_SNAPSHOT_RPC_ENABLED=1` intercepted the snapshot response and verified exactly one snapshot request with zero `has_permission`, `has_location_permission` or `has_global_role` calls. The test exposed and then covered an enabled-state transition race that initially allowed nine location permission fallbacks to start after the snapshot request.
- Authenticated smoke passed on 1440x900, 1920x1080, 3840x2160, 390x844 and 412x915 (5/5). PWA shell/offline checks passed on the same viewport matrix (5/5), with no console errors in smoke.
- Multi-account realtime QA passed 3/3 on Vite dev: optimistic sidebar preview, push-target chat hydration and missed-message reconnect reconciliation all worked without refresh.
- The long-session test was corrected to use the available role-specific auth states instead of silently skipping for a missing default account. Its 125-second idle, tab return and offline/reconnect scenario passed in 2.5 minutes with no reload, draft loss, duplicate realtime channels, failed requests or console errors.
- `pnpm.cmd rls:smoke` passed against the current production schema with mutation probes disabled. `pnpm.cmd db:types:check` passed with the existing advisory drift for `global_search_v2`, `search_chat_messages` and server-only `notifications_push_outbox`.

2026-07-10 production chat-load performance measurement:

- Measured `owner`, `tech_admin`, `location_staff` and `client` QA accounts at 1440x900 and 390x844. `location_admin` was skipped because it currently has no measurable chat history. The largest accessible QA history contained 246 messages; other measured histories contained 88 and 2 messages.
- Cold sidebar readiness across the matrix was 505-591 ms. Exactly one `chat_list_summaries` call was made per cold load at 37-55 ms, with zero legacy initial `messages` or `message_hidden_for_users` fan-out requests.
- The 246-message history rendered the first 100 messages in 452-467 ms and reopened from the in-memory cache in 174-200 ms. The server-side summary function benchmark averaged 13.383 ms over 50 authenticated iterations (min 11.748 ms, max 19.278 ms).
- The remaining 146 messages loaded in two prepend pages: 716/757 ms on desktop and 642/724 ms on mobile. The history did not return to the bottom; visual anchor error was 0 px desktop and at most 42 px mobile.
- All measured fully read chats settled at the bottom with 0 px initial scroll shift. A preliminary unread run with 22 unread messages rendered its unread separator without scroll shift. No failed REST responses, console errors or ErrorBoundary were observed.
- The next dominant startup cost is permission fan-out in `useRole`: normal accounts issued 49 initial REST requests, including 20 `has_permission`, 9 `has_location_permission` and 4 `has_global_role` calls. The chat summary path itself is no longer the primary bottleneck.
- Detailed NDJSON and desktop/mobile screenshots are stored locally under `.local/performance/` and remain ignored by Git because they contain QA account UI data.

2026-07-09 production connection, PWA identity and chat-summary batching groundwork:

- Verified Coolify read/write MCP connectivity: Coolify `4.1.2`, MCP `2.13.0`, project `LETSCUBE`, and healthy `letscube-web`/`letscube-worker` applications.
- Verified SSH access for both `techadmin@ms.letscube.ru` and the configured root maintenance profile without exposing key material.
- Verified DNS and expected service reachability for `app.letscube.ru`, `deploy.letscube.ru`, `core.letscube.ru`, `mailserver.letscube.ru`, `notify.letscube.ru`, and `ms.letscube.ru`. `api`, `status`, and `monitor` currently resolve but have no HTTPS service and are treated as reserved endpoints.
- Verified the production web bundle embeds `core.letscube.ru` and does not embed the legacy cloud Supabase hostname. The installed Supabase MCP connector still targets the legacy cloud project and is not used for production database inspection.
- Added dedicated LETSCUBE iPhone/PWA/maskable icons, wired the 180x180 Apple touch icon through HTML/manifest/service-worker precache, and advanced the app-shell cache version.
- Created proposal-only `.migration-backup/supabase/migrations/20260709_chat_list_summaries.sql`. SQL was not applied. The frontend batch path is disabled by default and keeps the existing sidebar queries until the proposal is manually applied and `VITE_CHAT_LIST_SUMMARIES_RPC_ENABLED=1` is set for a rebuild.
- Validation: chat summary unit tests passed (3/3), KUB typecheck/build passed, PWA spec passed on 1440/1920/3840/390/412 (5/5), authenticated smoke passed on the same viewport matrix (5/5), and realtime message reconciliation passed (7 passed, 8 viewport-conditional skips). Build retained the known sourcemap/chunk-size warnings.

2026-07-09 chat-list summary RPC production activation:

- Created and validated a full pre-migration custom-format database backup at `/srv/letscube/backups/pre-migrations/20260709-234302-before-chat-list-summaries.dump` before changing the schema.
- Applied `.migration-backup/supabase/migrations/20260709_chat_list_summaries.sql` manually in one transaction. The partial index is valid/ready, and the function is stable, `SECURITY INVOKER`, and has a locked empty `search_path`.
- Verified all 10 users with chat memberships: RPC row scope, unread counts and latest visible previews matched the legacy query path with zero mismatches. `anon` has no execute privilege; an anonymous REST call returned `401/42501`.
- Reloaded the PostgREST schema cache, verified an authenticated REST call returned `200` with the expected row shape, enabled `VITE_CHAT_LIST_SUMMARIES_RPC_ENABLED=1` for `letscube-web`, and completed Coolify deployment `urbjmigkvmskeryfl3cjh4kj` successfully.
- Production Playwright confirmed that the frontend issued `POST /rest/v1/rpc/chat_list_summaries` and received `200`. Authenticated production smoke passed at 1440/1920/3840/390/412 (5/5) with no console errors or ErrorBoundary.

2026-06-22 media variants pipeline:

- Applied `.migration-backup/supabase/migrations/20260622_media_variants_pipeline.sql` to the live self-host database after explicit approval.
- Pre-apply schema backup: `/srv/letscube/backups/manual/pre-media-variants-schema-20260622T203630Z.sql`.
- Verified `public.media_variants` exists, RLS is enabled, authenticated users have read-only access through scoped policies, and worker/server roles can write through trusted server credentials only.
- Added optional `kub-worker` service/`api-runtime` Docker target. It starts the existing server-side push dispatcher plus a new media variants worker, and self-disables media processing if `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are absent.
- The worker generates WebP variants for image messages and user avatars. It also has a video poster stage (`video_poster`) backed by ffmpeg in the API runtime; 720p video transcoding remains a separate stage because it needs CPU/runtime sizing and production load checks.
- Chat info media gallery tiles now consume ready media variants (`image_thumb`/`image_preview`/`video_poster`) instead of using original media files as tile sources.
- Chat scroll anchoring now cancels the initial bottom-settle lock on real user wheel/touch/pointer input, preventing fast upward history scrolling from being pulled back to the newest message.
- `db:types:check` no longer reports missing `messages.media_bucket` / `messages.media_path` in the manual compatibility layer. Existing advisory warnings remain for search RPCs and `notifications_push_outbox`.

2026-06-22 admin/ops security report foundation:

- Added admin-only `/admin/ops` as a read-only operator report for auth/invite observability.
- The tab shows current public CAPTCHA/gateway build status immediately and shows live aggregate metrics only after the manual RPC proposal is applied.
- Created proposal-only SQL `.migration-backup/supabase/migrations/20260622_admin_ops_security_report.sql`; SQL was not applied automatically.
- The proposal returns aggregate counts and sanitized invite/auth event labels only. It does not return email, IP, password, CAPTCHA token, recovery token, push token, actor ID, or target ID values.
- Added `docs/security/ADMIN_OPS_REPORT.md` and `tests/e2e/admin-ops-report.spec.ts`.
- Validation: `git diff --check`, KUB typecheck/build, `admin-ops-report.spec.ts` on 3840/1920/1440/390/412, `visual-style-layout.spec.ts --project=chromium-desktop-1440`, `e2e:smoke`, `db:types:check`, `rls:smoke`, and `auth:anti-abuse:smoke` passed. `db:types:check` keeps the known advisory drift for message media fields and search RPCs.

2026-06-22 auth gateway rate-limit hardening:

- Added an in-function rate limiter to `auth-yandex-gateway` for signup and
  password recovery before CAPTCHA validation and Supabase Auth calls.
- Defaults are `900s` window, `5` attempts per action/email and `30` attempts
  per action/IP; runtime env knobs are documented in
  `docs/security/AUTH_CAPTCHA_SETUP.md`.
- Added `tests/security/auth-yandex-rate-limit.test.mjs` to cover email
  throttling, IP fan-out throttling, action separation and missing-IP behavior.
- Deployed updated `auth-yandex-gateway` files to the self-hosted function
  volume and restarted `supabase-edge-functions`.
- Live smoke against `core.letscube.ru/functions/v1/auth-yandex-gateway`
  returned five `captcha_required` responses followed by HTTP 429
  `rate_limited` for a repeated valid-shape signup request without CAPTCHA.
- Targeted Playwright `auth-yandex-captcha.spec.ts` passed with the test
  Yandex CAPTCHA env and still verifies no direct signup/recovery Auth calls.

2026-06-21 Yandex SmartCaptcha auth gateway foundation:

- Added `yandex-smartcaptcha` as the preferred CAPTCHA provider for registration and password recovery.
- Added frontend routing so Yandex-protected registration/recovery call `/functions/v1/auth-yandex-gateway` instead of direct Supabase Auth endpoints.
- Added `auth-yandex-gateway` Edge Function source. It verifies Yandex SmartCaptcha server-side and then calls Supabase Auth with the public anon key.
- No Yandex secret was committed. Runtime needs `YANDEX_SMARTCAPTCHA_SECRET`, `SUPABASE_ANON_KEY`, and `KUB_AUTH_ALLOWED_REDIRECT_ORIGINS`.
- Important remaining hardening: public direct `/auth/v1/signup` and recovery calls must be restricted/routed through the gateway at the Supabase/Kong/Caddy layer to prevent bypass outside the official UI.

2026-06-21 auth CAPTCHA and RLS execute-grant follow-up:

- Added optional Cloudflare Turnstile frontend support for registration and password recovery. It is disabled by default and renders only when public build-time env values `VITE_AUTH_CAPTCHA_PROVIDER=turnstile` and `VITE_AUTH_CAPTCHA_SITE_KEY` are provided.
- Registration and recovery now pass `captchaToken` to Supabase Auth when CAPTCHA is enabled. Normal password login remains protected by server/proxy rate limiting and does not show a CAPTCHA prompt.
- Deployment docs now include the public frontend CAPTCHA env names; provider secrets remain server-side only in the self-hosted GoTrue environment.
- Created setup docs at `docs/security/AUTH_CAPTCHA_SETUP.md`. Server-side CAPTCHA was not enabled because no provider site/secret keys were supplied.
- Read-only live RLS/RPC audit confirmed `public` tables without RLS = `0`, policies referencing `raw_user_meta_data` = `0`, storage object policies are authenticated-only/path-scoped, and many public functions remain callable by `anon` through default function execute grants.
- Created proposal-only SQL `.migration-backup/supabase/migrations/20260621_revoke_anon_public_function_execute.sql` to revoke `PUBLIC`/`anon` execute from public functions while granting execution to `authenticated` and `service_role`. SQL was not applied automatically.

2026-06-21 auth anti-abuse and RLS hardening:

- Registration now treats existing-email signup errors as generic confirmation/recovery guidance, so the UI does not reveal whether an email is already registered.
- The signup form still uses a non-persisted Supabase Auth client, so a signup response cannot create an app session or localStorage auth token.
- Self-host read-only audit confirmed all inspected `public` tables have RLS enabled and no `public` views/materialized views exist.
- Applied `.migration-backup/supabase/migrations/20260621_auth_rls_security_hardening.sql` on the live self-hosted database after explicit approval. Pre-apply backup: `/srv/letscube/backups/config/function-defs-pre-search-path-20260621-202946.sql`.
- Live verification confirmed `public.get_my_chat_ids()` and `public.handle_new_user()` now both have `search_path=public`; live verification also confirmed `public_tables_without_rls=0` out of `public_tables_total=29`.
- Server-side GoTrue email throttles were enabled on self-hosted Supabase: `GOTRUE_RATE_LIMIT_EMAIL_SENT=60` and `GOTRUE_SMTP_MAX_FREQUENCY=60s`. The `supabase-auth` container was recreated and returned healthy.
- `/auth/v1/settings` returned 200 with the public anon key after the auth restart; `external.email=true` and `disable_signup=false`.
- Added Traefik edge throttling for sensitive `core.letscube.ru` Auth endpoints: `/auth/v1/token`, `/auth/v1/signup`, `/auth/v1/recover`, `/auth/v1/verify`, `/auth/v1/otp`, and `/auth/v1/resend`. Configured middleware `letscube-auth-sensitive-rate` uses average `20/min`, burst `40`, period `1m`; backup: `/srv/letscube/backups/config/supabase-traefik-pre-auth-throttle-20260621-203230.yml`.
- After the Traefik update, `supabase-kong`, `supabase-auth`, `supabase-rest`, `realtime-dev.supabase-realtime`, and `supabase-storage` were running healthy. `https://core.letscube.ru/auth/v1/settings` and `https://app.letscube.ru/login` returned HTTP 200.
- Validation: `git diff --check`, auth Playwright spec across 3840/1920/1440/390/412, KUB typecheck/build, deployed `e2e:smoke`, and `db:types:check` passed. `rls:smoke` skipped locally because Supabase URL/key are not configured in the local QA env.
- Post-apply validation after SQL and Traefik changes: `git diff --check`, KUB typecheck/build, deployed `KUB_BASE_URL=https://app.letscube.ru pnpm.cmd e2e:smoke`, and `db:types:check` passed. `rls:smoke` still skipped locally because Supabase URL/key are not configured in the local QA env. Build keeps the existing Vite sourcemap/chunk-size warnings.

2026-06-07 native Android push / FCM foundation:

- Added the Capacitor Push Notifications client foundation for Android without changing the browser/PWA Web Push path.
- Android settings now show Firebase/FCM setup status instead of the old “next stage” placeholder or browser permission copy.
- The native adapter creates Android channels `messages`, `tasks`, and `system`, listens for registration and notification taps, and routes safe payloads inside the SPA.
- FCM registration tokens are sent only to the authenticated `register_push_device` RPC when that SQL is applied; raw tokens are not printed and are not stored in frontend localStorage.
- `android/app/google-services.json` is not present locally and remains git-ignored, so physical FCM delivery is still pending.
- SQL was not applied automatically. The existing proposal `20260531_notification_center_read_sync_native_push.sql` remains the manual device-token/RPC prerequisite.
- Backend FCM delivery is still pending: trusted Firebase credentials must be configured server-side and the push dispatcher/Edge Function must fan out to `user_push_devices`.

2026-05-27 notification center read-sync/native push foundation:

- Notification Center now separates events into tabs: `Все`, `Задачи`, `Сообщения`, `Системные`.
- Message notifications are compacted into one row per chat/dialog in the bell; the grouped unread badge counts a chat with unread messages once, not once per message row.
- Reading an open chat now dispatches a notification read-sync event after `mark_chat_read`; the frontend marks the loaded unread message notifications for that chat read through the existing `notifications_mark_read` RPC, so the update propagates through realtime to other clients.
- Sender/self message notification rows are filtered from the bell and marked read defensively if old rows exist.
- Proposal-only SQL `20260531_notification_center_read_sync_native_push.sql` adds the server-side `notifications_mark_chat_messages_read` RPC and a future `user_push_devices` model for native FCM/APNS tokens. SQL was not applied automatically.
- Native Android push remains pending because `android/app/google-services.json` is not present locally. Browser/PWA Web Push remains the active push path.
- Validation: `git diff --check`, KUB typecheck/build, local Playwright `notification-center.spec.ts`, `e2e:smoke`, `pwa.spec.ts`, `push-phone-foundation.spec.ts`, `db:types:check`, `rls:smoke`, `android:sync`, and `android:build:debug` passed. Build keeps the existing Vite sourcemap/chunk warnings. ADB listed no connected device, so physical native-push delivery QA remains pending.

2026-05-23 Android Capacitor MVP groundwork:

- Added Capacitor at repo root with `capacitor.config.ts`, app id `com.kub.messenger`, app name `KUB Messenger`, and `webDir` pointing at `artifacts/kub/dist/public`.
- Added Android project under `android/` and root scripts for sync/open/debug build.
- Android manifest includes network, camera, microphone, media read, legacy external read, and Android 13+ notification permissions. Native FCM push, release signing, deep links, and final branding are intentionally deferred.
- Android gitignore now excludes local keystores and `google-services.json`; no signing or FCM secret files are committed.
- `pnpm.cmd android:sync` completed after the Vite build. `pnpm.cmd android:build:debug` reached Gradle but did not produce an APK in the current local environment because `JAVA_HOME` points to a JRE-only Eclipse Adoptium install without `javac`; Android Studio/JDK setup is required on the packaging machine.

2026-05-20 phone verification without SMS provider:

- Phone settings now require explicit international `+` E.164-style input; local numbers such as `89991234567` are rejected instead of being silently converted.
- The phone flow still has no “save without verification” path. A changed phone reaches `profile_contacts` only after Supabase Auth `verifyOtp` succeeds and `profile_phone_mark_verified()` mirrors the confirmed Auth phone.
- Missing SMS provider errors are mapped to `SMS-провайдер не настроен. Обратитесь к администратору.`; raw provider/Twilio details are not shown in the UI.
- The OTP state includes a resend countdown, and verified phones can show the DB-backed `phone_verified_at` timestamp when migration `20260528_phone_verification.sql` is applied.
- Regression coverage in `tests/e2e/push-phone-foundation.spec.ts` verifies strict phone input, missing-provider friendly fallback, absence of raw provider text, absence of “save without verification”, push switch bounds, and SW push routing checks.

2026-05-19 push notification grouping and switch layout:

- Hardened `artifacts/kub/public/sw.js` so push messages derive stable tags by media type and chat/task/invite id, close existing same-tag notifications with `registration.getNotifications({ tag })`, then call `showNotification` with the same tag and `renotify` disabled for message pushes.
- No new SQL was applied and no new DB migration proposal was needed; `20260530_push_message_notification_polish.sql` already provides stable `message:chat:<chat_id>` payload tags.
- Added reusable `KubSwitch` and wired Push preference rows to it so the thumb is constrained inside a 44x24 track and the switch stays inside the settings card on mobile.
- Regression test coverage was extended in `tests/e2e/push-phone-foundation.spec.ts` to assert same-tag notification replacement code and switch-thumb bounds.

2026-05-16 Supabase generated database types:

- Ran `pnpm.cmd supabase:typegen` with `SUPABASE_PROJECT_REF=nhogbeojfnbjcfipitrh`; generated `artifacts/kub/src/types/database.generated.ts`.
- Generated types contain the expected public `Database` type, current public tables, functions/RPC, and enums. Key applied areas present: `locations`, `location_members`, `roles`, `permissions`, `role_permissions`, `user_global_roles`, `task_recurrences`, task soft-delete fields/RPC, and group invite RPC.
- Secret scan on `database.generated.ts` found no `service_role`, Supabase access token, QA email, or QA password strings.
- The generated file is not wired into app imports yet. Existing `artifacts/kub/src/types/database.ts` remains the active compatibility type file.
- Comparison against the manual file found one generated-only table, `notifications_push_outbox`, which is intentionally server-side; generated `messages` also includes `media_bucket` and `media_path`, which the manual file does not currently model. Generated RPCs include additional internal helper functions not represented in the manual app-facing type file. Enums matched.

2026-05-16 core QA tooling and Supabase typegen:

- Added root tooling scripts for Supabase typegen, Playwright e2e, RLS/RPC smoke, and scoped Biome lint/format.
- Supabase CLI is installed under the user's Scoop directory (`~/scoop/shims/supabase.exe`) at version `2.98.2`, but the current Codex terminal PATH does not include the Scoop shims path. Typegen script searches the common Scoop paths as a fallback and otherwise prints a friendly setup error.
- No SQL was applied. No Supabase tokens or QA passwords were printed.
- Playwright config now defines desktop viewports `3840x2160`, `1920x1080`, `1440x900` and mobile viewports `390x844`, `412x915`, with failure screenshots/video/trace under ignored `output/playwright-test` and `output/playwright-report`.
- Authenticated smoke tests read QA credentials from env or `~/.kub-messenger-qa.env` without logging the password.
- RLS/RPC smoke script uses anon + authenticated user session only, probes selected RPCs with safe fake UUIDs where possible, and does not use `service_role`.
- Validation passed: `git diff --check`, `pnpm.cmd --filter @workspace/kub run typecheck`, `PORT=5173 BASE_PATH=/ pnpm.cmd --filter @workspace/kub run build`, `pnpm.cmd format:check`, and `pnpm.cmd lint`. Build still emits the existing Vite sourcemap/dynamic-import/chunk-size warnings.
- Playwright smoke ran against `https://kub.apollot.ru` with viewports `1440x900`, `1920x1080`, `3840x2160`, `390x844`, `412x915`; all 5 projects passed with console errors 0.
- `pnpm.cmd supabase:typegen` was tested without `SUPABASE_PROJECT_REF` and stopped with the intended friendly error; no generated database file was written in this pass.
- `pnpm.cmd rls:smoke` was tested without Supabase URL/key env and skipped safely.

2026-05-16 owner / tech_admin task soft delete:

- Created proposal-only SQL at `.migration-backup/supabase/migrations/20260521_task_soft_delete_owner_tech_admin.sql`; SQL was not applied automatically.
- Proposed model adds `tasks.deleted_at`, `tasks.deleted_by`, `tasks.delete_reason`, `task_soft_delete`, `task_restore`, `task_bulk_soft_delete`, `tasks.delete`, `tasks.restore`, `tasks.bulk_delete`, task-event kinds `soft_delete`/`restore`, audit writes and recurrence generator protection for deleted templates.
- Frontend uses only RPC calls for task removal. No direct `delete()` against `public.tasks` was added.
- Normal task lists hide deleted tasks by default; users with global cleanup permissions can enable `Показать удалённые`. Deleted rows show a `Удалена` badge and task actions/comments are disabled.
- TasksPage adds owner/tech cleanup affordances: visible-task selection, selected count, bulk soft-delete modal with optional reason, and partial-success messaging. Task detail adds a single-task delete action behind the same permission gate.
- Authenticated Playwright QA ran against local UI `http://127.0.0.1:5173` with viewports 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915. Screenshots and JSON summary are in `output/playwright/task-soft-delete/` (ignored from git): `desktop-3840x2160-tasks.png`, `desktop-1920x1080-tasks.png`, `desktop-1440x900-tasks.png`, `mobile-390x844-tasks.png`, `mobile-412x915-tasks.png`, `qa-result.json`.
- QA result: `/tasks` loaded on all required desktop/mobile viewports with console errors 0 and unexpected failed requests 0. Safe authenticated API smoke against `task_soft_delete` with a fake UUID returned 404, confirming the new soft-delete migration is not applied yet.
- QA limitation: the available QA account did not have owner/tech_admin cleanup permissions, so delete buttons and `Показать удалённые` were correctly absent for that account. Owner/tech_admin delete UI and actual soft-delete/restore behavior require manual verification after applying the migration with an owner/tech_admin account.

Снимок аудита: 2026-05-05. Test domain: `https://kub.apollot.ru` временный; домен нельзя хардкодить в source code.

## Passed

- Supabase MCP read-only подключение работает для проекта `nhogbeojfnbjcfipitrh`.
- В `public` найдено 17 таблиц, RLS включен на user-facing таблицах.
- Realtime publication содержит `bans`, `chat_members`, `chats`, `folder_chats`, `folders`, `messages`, `mutes`, `notifications`, `profiles`, `reactions`, `task_events`, `tasks`, `topics`.
- `tasks` и `task_events` используют direct write block policies; mutations идут через SECURITY DEFINER RPC.
- Sidebar source уже содержит `min-w-0`, fixed 36px icon buttons и profile menu с admin entry.
- Auth callback в frontend доменно-агностичный: redirect строится от текущего origin, не от hardcoded `kub.apollot.ru`.
- Heartbeat source использует singleton/refcount и throttle; `useChats`, `useTasks`, `useNotifications` уже имеют стабильные channel names и debounced refetch.

## Failed

- Auth logs за последние 24 часа все еще показывают `referer=tg.letscube.ru`. Это не доказывает hardcode в source code, но означает, что Supabase Auth URL/settings нужно держать под контролем при смене домена.
- Supabase Auth logs показывали SMS-provider setup error на `/user` при phone update. Это отдельный Supabase Auth/SMS configuration вопрос, не frontend secret/frontend privilege проблема.

## Applied In Production Supabase

- Task privacy/assignment уже применены: `tasks.visibility`, `tasks.assignment_scope`, `task_create_v2`, `task_update_v2`, `task_claim`, RLS `tasks select with visibility`.
- Storage `media` уже переведен на scoped policies: `media authenticated scoped read`, `insert`, `update`, `delete`.
- Folders policy cleanup уже применен: legacy `folders`/`folder_chats` `*_own` policies отсутствуют, остались scope-aware policies и restrictive banned-user guards.
- User manually applied `.migration-backup/supabase/migrations/20260507_message_hide_for_me.sql`; read-only MCP confirmed `message_hidden_for_users`, authenticated-only RLS policies and `hide_message_for_me` / `unhide_message_for_me` RPC.
- User manually applied `.migration-backup/supabase/migrations/20260507_message_hide_for_me_grants_hardening.sql`; read-only MCP confirmed `anon`/`PUBLIC` table/function grants are absent and authenticated access remains.
- User manually applied `.migration-backup/supabase/migrations/20260508_messages_client_message_id.sql`; read-only MCP confirmed `messages.client_message_id`, `messages.client_sent_at`, server `created_at default now()` and the idempotency lookup/unique indexes.

## Needs Manual Verification

- Browser QA на `https://kub.apollot.ru`:
  - login/logout/session restore;
  - direct refresh `/admin`, `/tasks`, `/auth/callback`;
  - sidebar profile menu на desktop и admin panel entry;
  - notifications popover;
  - tasks page/admin/audit;
  - folders create/edit/delete/add/remove chat;
  - voice recording/send/playback;
  - themes light/dark/system;
  - responsive 390px, 768px, 1280px.
- Network QA:
  - idle 2 минуты без request storm;
  - heartbeat примерно не чаще штатного интервала;
  - realtime websocket остается подключенным;
  - нет повторяющихся `Failed to fetch` / `ERR_INSUFFICIENT_RESOURCES`.
- Email confirmation UX:
  - успешная ссылка ведет на текущий `/auth/callback`;
  - expired/invalid link показывает дружелюбное сообщение, а не raw Supabase JSON.

## Needs DB Migration

- No pending DB migration for message hide-for-me or delivery receipts after the user's 2026-05-07 manual applies. Future group read-count/all-delivered UX would need a separate schema design.

## Needs UX Polish

- Chat list search сейчас ищет по названию чата и last message text, но не по всем сообщениям.
- In-chat search работает только по загруженным сообщениям текущего чата, не по всей истории.
- Нет глобальной search/command palette.
- Task filters пока не знают о pool/unassigned/visibility; SQL уже применен, следующий этап - frontend alignment на `task_create_v2`, `task_update_v2`, `task_claim`.
- Chat overview в `useChats` все еще делает per-chat last-message/unread enrichment; при росте количества чатов стоит вынести это в RLS-safe RPC/view отдельной миграцией.

## Browser QA Notes

Safe QA note: Live QA should use the Codex/QA browser session or QA credentials from a secure environment; never store secrets in the repo and do not depend on the user's mouse/manual browser.

2026-05-13 desktop tab-return refresh/reinit diagnosis:

- Playwright live probe on `https://kub.apollot.ru` before the auth-listener patch classified the reproducible automated tab-switch path as not a browser document reload: document navigation requests `0`, main-frame navigations `0`, `beforeunload/pagehide` `0`, `window.__kubNoReloadMarker` survived, composer draft survived, and staged attachment survived.
- Code diagnosis found the remaining real-desktop risk in `useUser`: Supabase can emit `SIGNED_IN` again when a hidden tab is focused; the old handler treated every `SIGNED_IN` as a blocking profile load, rendered `LoadingScreen`, and could remount `MainLayout/ChatWindow` even when the same user was already loaded.
- Patch behavior: same-user auth events refresh the profile/realtime token silently; only a user identity change blocks the UI with the loading screen.
- Live deploy QA after the updated bundle reached `https://kub.apollot.ru`: the same probe kept `window.__kubNoReloadMarker`, composer value `TAB_RETURN_TEST_*`, and staged attachment count `1` after a second-tab `bringToFront` switch plus supplemental focus/visibility events. Document navigation requests `0`, main-frame navigations `0`, `beforeunload/pagehide` `0`, `LoadingScreen` hits `0`, textarea disappearance hits `0`, console errors `0`, failed requests `0`.
- Playwright probe artifacts:
  - `output/playwright/desktop-tab-return/desktop-3840x2160.png`
  - `output/playwright/desktop-tab-return/desktop-1920x1080.png`
  - `output/playwright/desktop-tab-return/desktop-1440x900.png`
  - `output/playwright/desktop-tab-return/mobile-390x844.png`
  - `output/playwright/desktop-tab-return/mobile-412x915.png`
  - `output/playwright/desktop-tab-return/summary.json`

2026-05-13 mobile keyboard inset / tab return polish:

- Local Playwright QA used `http://127.0.0.1:5173` production preview with the current local JS bundle. Because the Windows build still emits the known small Tailwind CSS bundle, visual local QA injected the current live production CSS as a stylesheet shim; screenshots below are ignored artifacts under `output/playwright`.
- Viewports checked locally with Playwright: `3840x2160`, `1920x1080`, `1440x900`, `390x844`, `412x915`.
- Screenshot evidence:
  - `output/playwright/mobile-keyboard-inset/desktop-3840-open-chat.png`
  - `output/playwright/mobile-keyboard-inset/mobile-390-keyboard-closed.png`
  - `output/playwright/mobile-keyboard-inset/mobile-390-input-focused.png`
  - `output/playwright/mobile-keyboard-inset/mobile-390-multiline.png`
  - `output/playwright/mobile-keyboard-inset/mobile-390-staged-attachment.png`
- Mobile `390x844` local metrics after staged attachment/tab-return simulation: composer height `166px`, scroller bottom equals composer top, `scrollGap = 0`, MessageList padding-bottom `24px`, `--kub-keyboard-inset = 0px`, `--kub-message-list-bottom-inset = 0px`, visual gap between last message and composer `26px`, horizontal overflow `0`.
- Tab-return local QA: a draft marker, composer text, and staged attachment survived the simulated tab switch/visibility return; no document reload marker loss was observed.
- Local console errors `0`, failed requests `0`. Headed browser on the physical 4K monitor was not used to avoid interfering with the user's workspace; screenshots were taken with Playwright-controlled viewports.
- Live deploy QA after Coolify updated the bundle (`https://kub.apollot.ru` contained `preserveActiveChat` and the focus-gated keyboard threshold code): Playwright checked `3840x2160`, `1920x1080`, `1440x900`, `390x844`, `412x915` without a CSS shim. Live metrics matched the local result: mobile `390x844` staged state had composer height `166px`, MessageList padding-bottom `24px`, `--kub-keyboard-inset = 0px`, `--kub-message-list-bottom-inset = 0px`, visual gap `26px`, horizontal overflow `0`; tab-return marker/text/staged attachment survived. Console errors `0`, failed requests `0`.

2026-05-13 mobile chat bottom overlap polish:

- Local Windows production build currently emits a small Tailwind CSS bundle without generated utility classes, while the live Linux/Coolify bundle contains the expected utilities. For local screenshot QA of the current JS bundle, Playwright used `http://127.0.0.1:5173` production preview with the current live production CSS stylesheet injected as a visual QA shim.
- Viewports checked with Playwright: `3840x2160`, `1920x1080`, `1440x900`, `390x844`, `412x915`.
- Screenshot evidence:
  - `output/playwright/mobile-bottom-overlap-desktop-3840-open-chat.png`
  - `output/playwright/mobile-bottom-overlap-mobile-390-open-chat.png`
  - `output/playwright/mobile-bottom-overlap-mobile-390-focused-multiline.png`
  - `output/playwright/mobile-bottom-overlap-mobile-390-staged-attachment.png`
- Mobile metrics at `390x844`: composer height tracked `70px` on open, `118px` with multiline draft, and `214px` with staged attachment; MessageList padding-bottom tracked `94px`, `142px`, and `238px`; `scrollGap = 0`; document horizontal overflow was `0`.
- Mobile metrics at `412x915` with staged attachment: composer height `214px`, MessageList padding-bottom `238px`, `scrollGap = 0`, horizontal overflow `0`.
- Desktop metrics at `3840x2160`, `1920x1080`, `1440x900`: scroller bottom and composer top aligned; `scrollGap = 0`; horizontal overflow `0`.
- Headed browser on the physical 4K monitor was not used to avoid interfering with the user's workspace; screenshot QA was done with Playwright-controlled browser viewports.
- Live deploy QA after Coolify updated the bundle (`https://kub.apollot.ru` contained the new `--kub-composer-height` / `--kub-message-list-bottom-inset` code): Playwright checked `3840x2160`, `1920x1080`, `1440x900`, `390x844`, `412x915`; console errors `0`, failed requests `0`.
- Live screenshot artifacts:
  - `output/playwright/mobile-bottom-overlap/desktop-3840-open-chat.png`
  - `output/playwright/mobile-bottom-overlap/mobile-390-open-chat.png`
  - `output/playwright/mobile-bottom-overlap/mobile-390-focused-multiline.png`
  - `output/playwright/mobile-bottom-overlap/mobile-390-staged-attachment.png`

2026-05-10 admin users bulk roles / location QoL note:

- Users panel now has selection, visible-row select/clear, global-role and location bulk actions, and location/global-role/status filters.
- Mobile admin content received `min-h-0`/bottom padding so long users lists and sticky bulk controls can scroll to the end on 390/412px viewports.
- Bulk role assignment uses existing `user_assign_global_role` / `user_remove_global_role` RPC per selected user; bulk location assignment uses existing `location_member_assign_role` or `location_member_assign` per selected user.
- New SQL was not applied automatically. Proposal `.migration-backup/supabase/migrations/20260516_dynamic_roles_default_user_baseline.sql` adds an idempotent default dynamic `user` role trigger/backfill for newly registered normal users.

2026-05-09 notifications/group-invites stage note:

- Live/authenticated QA must use the Codex/QA browser session or local QA credentials kept outside the repo.
- Do not store QA passwords, auth tokens, cookies or service-role keys in docs, `.env.example`, README or committed source.
- Group invites required manual application of `.migration-backup/supabase/migrations/20260509_group_invites.sql`; the user later applied it on 2026-05-10, while the frontend keeps the migration-required fallback for other environments.
- SQL was not applied automatically during this stage.

2026-05-05 logged-in Browser QA на `https://kub.apollot.ru`:

- Sidebar/profile menu на desktop работает; пункт `Админ-панель` доступен из меню профиля.
- Sidebar search/notification/new chat icons проверены на 390px, 768px и 1280px; document horizontal overflow не обнаружен.
- Notification bell открывается и не выталкивает layout за пределы sidebar.
- Direct refresh `/admin` проходит, dashboard и audit tab открываются без console errors.
- `/tasks` открывается, текущий task UI еще не выровнен под `visibility`/`assignment_scope`/`task_claim`.
- Network на admin dashboard показал лишние повторные metric count-запросы от realtime `profiles` updates; frontend fix убрал `profiles` realtime trigger для dashboard и добавил overlapping-load guard.
- Скриншоты не коммитить; локальные browser artifacts остаются untracked.
- Replit overlay/banners checked: production `kub.apollot.ru` не должен показывать Replit preview UI; `IframeAuthBanner` ограничен Replit iframe-контекстом, а Replit runtime overlay отключен для production build.

## Phase 2 Task V2 Inspection

2026-05-05 Supabase MCP read-only подтвердил, что production Supabase уже готов для task v2:

- `tasks.visibility task_visibility not null default 'staff'`.
- `tasks.assignment_scope task_assignment_scope not null default 'user'`.
- enums `task_visibility = staff/private/chat` и `task_assignment_scope = user/manager_pool/staff_pool`.
- RPC `task_create_v2`, `task_update_v2`, `task_claim`.
- RLS `tasks select with visibility` и `task_events select with visibility`.
- Direct writes to `tasks` / `task_events` blocked; mutations go through RPC.
- Realtime publication includes `tasks` and `task_events`.

Repo state:

- `artifacts/kub/src/types/database.ts` already contains task v2 columns, enums and RPC types.
- `docs/SUPABASE_SCHEMA_MAP.md` and `docs/SUPABASE_CURRENT_STATE.md` already describe task v2 as applied.
- `docs/SUPABASE_MIGRATION_RULES.md` was updated so the 20260505 task/storage/folders SQL files are no longer marked as pending.

Frontend gap:

- `TaskFormModal` still calls compatible old RPC `task_create` / `task_update`.
- `TaskAssignModal` still calls `task_assign`.
- `task_claim` is not used in UI yet.
- Task cards/details do not yet show `visibility` / `assignment_scope` badges.
- Task filters do not yet expose pool/private/staff/chat views.

Next safe task UI alignment:

1. Read-only UI badges for task `visibility` and `assignment_scope`.
2. Add `task_claim` button for eligible staff pool tasks.
3. Add staff-friendly task filters for my/available/waiting/all/private/chat.
4. Move create/edit to `task_create_v2` / `task_update_v2` with client-side guards while keeping RLS/RPC as source of truth.

## Phase 3 Task Claim And Replit Overlay

- `task_claim` frontend action added for eligible pool tasks: staff/admin/manager role, `status = new`, `assignment_scope != user`, no `assignee_id`.
- Backend RPC/RLS remain the source of truth; SQL was not changed or applied.
- Existing create/edit/assign workflow remains on compatible `task_create`, `task_update`, `task_assign` in this phase.
- Browser QA on current data needs a real pool task to click the claim path. Existing visible tasks may not include pool tasks.
- Replit overlay/banners checked in source: production build should not include Replit runtime overlay, and iframe auth banner should only show in Replit iframe context.

## Phase 4 Task Notification UX

- Supabase read-only inspection confirmed task notification payload already contains `task_id`; no migration is required for task deep links.
- Current issue reproduced in browser: clicking a task notification opened `/tasks` only, leaving the user on the default tab instead of opening the task.
- Frontend now uses `/tasks?task=<task_id>` for task notifications, and `/tasks?task=<id>` opens `TaskDetailModal` directly after refresh.
- If RLS hides the task or the task was deleted, the modal shows: `Задача недоступна или была удалена.`
- Non-staff users no longer see the task cancel action in `TaskDetailModal`; RPC/RLS remain the source of truth.
- Staff task tabs now include `Доступные` for unassigned `manager_pool` / `staff_pool` tasks with `status = new`.

## Roles And Permissions Foundation

- Supabase read-only audit confirmed current authorization is still based on `profiles.role`, `app_role`, `is_admin()` and `is_manager_or_admin()`.
- Dynamic roles should be introduced as a staged compatibility layer, not by replacing existing RLS/RPC at once.
- Added planning docs and SQL proposal only; production DB was not changed.
- Manual SQL proposal: `.migration-backup/supabase/migrations/20260505_roles_permissions_foundation.sql`.

## Production UI Consistency Audit

2026-05-05 Browser QA checked the live UI on `https://kub.apollot.ru` without hardcoding the domain in source code.

- Viewports checked: 390x844, 768x1024, 1280x720, 1920x1080, 3840x2160.
- Routes checked: `/`, `/tasks`, `/admin`, `/admin/users`, `/admin/bans`, `/admin/audit`; logged-in `/login` and `/register` redirect back to the app as expected.
- Areas checked: sidebar, chat list/search, notification bell, profile/settings modal, chat window/message input, task cards/detail modal/actions, admin dashboard, users, bans/mutes, audit expanded details.
- Automated viewport audit found no document-level horizontal overflow on the checked routes.
- Notification popover, profile menu, task detail modal and admin user action menu stay inside the mobile viewport.
- Mobile audit expanded details were visually too narrow because the desktop left offset and label/value row layout were reused on 390px. The audit detail panel is now full-width on mobile, while desktop keeps the indented layout.
- Screenshots are stored under `output/playwright/` and are not intended for commit.

## Task UX Hardening

2026-05-05 frontend-only task UX pass:

- SQL/RLS/RPC were not changed.
- Task detail now shows contextual callouts for `waiting_confirmation`, rejected reason from `task_events.payload.reason`, and available pool tasks.
- Task actions are visually grouped into a bordered action area; assignment/edit remain secondary, and cancel is styled as a destructive action instead of competing with the primary CTA.
- The comment send icon-only button now has an explicit `aria-label`.
- Task cards wrap assignee/update/due metadata safely on mobile instead of forcing a single crowded row.

## Messenger Keyboard And Search UX

2026-05-05 frontend-only messenger UX pass:

- SQL/RLS/RPC were not changed.
- `Ctrl+K` / `Cmd+K` focuses the existing chat search; on mobile it first returns from the open chat to the chat list.
- `Escape` closes the profile menu and notification popover; on mobile it returns from an open chat to the chat list when focus is not inside an input/textarea.
- Message input keeps Enter-to-send and Shift+Enter newline behavior, but now avoids sending while IME composition is active and does not send while upload is in progress.
- Message input `Escape` closes emoji/attachment popovers without clearing typed text.
- Chat notifications already navigate to the target chat when payload contains `chat_id`; task notifications continue to use `/tasks?task=<id>`.

## Supabase Password Recovery Flow

2026-05-06 frontend-only hotfix:

- Supabase recovery links intentionally create a temporary authenticated session.
- The app must not treat `PASSWORD_RECOVERY` as a normal login; it must show the password update form first.
- Recovery is now detected by `/auth/callback?type=recovery`, `#type=recovery`, and the Supabase `PASSWORD_RECOVERY` auth event.
- While recovery state is active, the user stays on the password update screen even if Supabase has already established a session.
- After successful `supabase.auth.updateUser({ password })`, the app clears recovery state, signs the user out, and returns to `/login?password_reset=1`.
- Invalid/expired recovery links show a friendly Russian message instead of raw Supabase output.
- Confirmation email flow remains separate: non-recovery auth callback can still complete login/confirmation normally.

## Chat Safety And Task Roadmap Notes

2026-05-06 avatar/profile and chat safety pass:

- Own avatar/profile editing remains in `SettingsModal`; other users' avatars are not edited from normal user profile surfaces.
- Group/channel avatar editing is only shown for chat owner/admin; private chats and `Избранное` do not show chat avatar/name edit controls.
- Direct global `Очистить историю` was removed from chat header/info UI because production DB does not yet have a safe per-user clear/hide model.
- Manual SQL proposal prepared, not applied: `.migration-backup/supabase/migrations/20260506_chat_history_private_hide_permissions.sql`.
- Manual SQL proposal prepared, not applied: `.migration-backup/supabase/migrations/20260506_chat_pins.sql`.
- Until those proposals are applied and frontend-aligned, private chat deletion is intentionally not exposed as a destructive global delete.
- `Избранное` is sorted above regular chats in frontend as a system-like saved space.

2026-05-06 follow-up:

- User manually applied `.migration-backup/supabase/migrations/20260506_chat_history_private_hide_permissions.sql`.
- User manually applied `.migration-backup/supabase/migrations/20260506_chat_pins.sql`.
- Supabase read-only check confirmed `chat_members.hidden_at`, `chat_members.cleared_at`, `chat_members.pinned`, `chat_members.pinned_at` and RPC `clear_chat_for_me`, `hide_private_chat`, `unhide_private_chat`, `pin_chat`, `unpin_chat`.
- Frontend alignment is enabled for local chat clear, private chat hide, and per-user chat pin/unpin.
- User manually applied `.migration-backup/supabase/migrations/20260506_admin_avatar_management.sql`.
- Supabase read-only check confirmed `_kub_media_path_allowed` now permits admin-managed uploads to `avatars/{target_user_id}/...` for non-admin profile rows, while users keep only their own avatar path.
- Frontend admin profile preview now exposes upload/reset avatar controls for ordinary users only. Manager/admin-to-admin avatar management remains hidden and backend-controlled.
- `Очистить историю у себя` is documented and worded as a local hide: messages and attachments disappear only for the current user; Storage files are not deleted.
- Destructive "delete my media from chat" remains planned only. It needs a separate RPC design because one participant must not delete media still visible to another participant.
- Chat media panel now renders gallery media lazily in small batches with lazy images and non-preloaded video previews.

2026-05-06 production bugfix follow-up:

- Hidden private chats are reactivated from the frontend via existing `unhide_private_chat` RPC when a new message makes them visible again or when the user starts the same private chat again.
- Media gallery clicks now use the in-app `MediaViewer`; video previews stay lightweight and do not preload the video file in the grid.
- Avatar uploads are limited in frontend validation to JPG, PNG, WebP and GIF up to 2 MB. The shared `media` bucket currently has no global `file_size_limit`; do not set a bucket-wide 2 MB limit because the bucket also stores voice/messages/files.
- Profile bootstrap now keeps the app on the loading screen until the authenticated user's `profiles` row is loaded or created, avoiding a half-broken UI with `currentUser = null`.
- Message pin/unpin actions are exposed to authenticated chat viewers and backend RPC remains the source of truth; this avoids hiding pin controls while membership role data is still catching up.

Recurring tasks roadmap note:

- Future task-system phase should add recurring tasks: daily, weekly, monthly, yearly, custom interval, `next_run_at`, auto-create next occurrence, stop recurrence, reuse `visibility` / `assignment_scope`, and history of occurrences.

2026-05-06 production data consistency follow-up:

- Supabase read-only audit confirmed the current `media` Storage bucket is public. This is acceptable only for avatars, not for private/group chat media.
- Added `docs/MEDIA_SECURITY_PLAN.md` and migration proposal `.migration-backup/supabase/migrations/20260506_secure_chat_media_access.sql` for a private `chat-media` bucket and `messages.media_bucket` / `messages.media_path` rollout.
- Message timeline initial fetch now loads the newest 100 visible messages, then sorts them ascending in the store. This fixes the case where a just-sent message appeared realtime/sidebar but disappeared from the active chat after refresh in long chats.
- Pinned messages and media gallery now re-check current `chat_members.cleared_at` before rendering local cleared history, so old pinned/media entries should not flash back after local clear/hide.
- Media gallery now fetches media from DB in pages and filters by `cleared_at`; image/video clicks still use the in-app viewer.
- Added a non-destructive app update banner that detects a new Vite entry bundle on interval/visibility return and asks the user to refresh instead of forcing a full page reload.

2026-05-06 chat consistency follow-up:

- User manually applied `.migration-backup/supabase/migrations/20260506_secure_chat_media_access.sql`; Supabase read-only check confirmed private `chat-media`, chat media policies and `messages.media_bucket` / `messages.media_path`.
- Legacy `media` bucket remains public for avatars/old media compatibility. Full security still requires moving new message uploads and legacy media reads to `chat-media` signed URLs.
- Chat preview now filters last message/unread counts by current user's `chat_members.cleared_at`.
- Chat search ignores soft-deleted message placeholders.
- Topic-aware text/media/voice sends now include `topic_id`; when topics are disabled the message hook no longer filters out topic messages.
- Frontend name limits were added for group/chat/folder/topic names. `.migration-backup/supabase/migrations/20260506_entity_name_constraints.sql` was applied manually on 2026-05-06; read-only MCP confirmed active checks on `chats.name`, `folders.name` and `topics.name`.

2026-05-06 messenger polish follow-up:

- `rg` is installed and available in PATH (`ripgrep 15.1.0`); use it as the primary project search tool.
- Forum chats now expose a frontend pseudo-topic `Общие` for legacy/general messages with `messages.topic_id IS NULL`; database `topics.is_general` rows are treated as part of that general stream for compatibility.
- Bulk message selection is entered from the message action menu (`Выбрать сообщения`) instead of a persistent toolbar button.
- Media gallery uses lightweight placeholder tiles for image/GIF/video batches; full media is loaded only when opened in the in-app viewer. Real thumbnail generation remains a future media pipeline task.
- App update prompt no longer has a permanent skip action. `Напомнить позже` snoozes briefly; fatal chunk-load errors show a blocking reload prompt.

2026-05-06 production stability follow-up:

- Mobile bulk delete selection was adjusted: selection starts from the message action menu, the action menu closes immediately, and deletion uses an in-app two-step toolbar confirmation instead of a native browser confirm.
- Long text messages and long URLs now use `overflow-wrap:anywhere` / `break-word` so message bubbles do not stretch the chat horizontally.
- Typing broadcasts are scoped by active chat/topic and cleared on chat/topic switch to prevent stale typing indicators from leaking into another chat.
- Profile bootstrap now exposes a retryable loading error state instead of leaving users on an unexplained spinner forever.
- Media gallery now shows lazy real previews for static image items on the current page; GIF/video remain lightweight placeholders until opened in the in-app viewer.
- Root `docker-compose.yml` now has an nginx healthcheck for Coolify/container readiness; docs deploy compose files already had healthchecks.
- App update banner now also reports temporary server connection instability, which can happen during redeploy, without forcing an automatic reload.

2026-05-06 message layout / realtime follow-up:

- Native browser `confirm` / `alert` / `prompt` scan remains clean in `artifacts/kub/src`.
- Chat list media previews now use semantic labels (`Фото`, `GIF`, `Видео`, `Голосовое`, `Файл`) instead of raw media URLs.
- Muted chat state is still local per-device (`ng_muted` in localStorage); the UI now uses a larger bell-off indicator. A DB-backed per-user preference can be added later if cross-device mute sync is required.
- Active chat message sync has a fallback: sidebar message realtime events dispatch a debounced active-chat refetch/merge event so the open MessageList does not miss rows that already appeared in the chat preview.

2026-05-07 message hide-for-me frontend follow-up:

- Frontend now exposes `Удалить у себя` for visible messages and keeps `Удалить для всех` separate for own non-saved-chat messages.
- Bulk selection can hide any selected visible messages locally; global bulk delete is offered only when all selected messages are own messages in a non-saved chat.
- Active MessageList, pinned messages, in-chat search, media gallery and chat preview now filter out rows present in `message_hidden_for_users` for the current user.
- `20260507_message_hide_for_me.sql` and `20260507_message_hide_for_me_grants_hardening.sql` are no longer pending.

2026-05-07 message receipts / reactions follow-up:

- Bubble and chat-list preview both use `getMessageDeliveryState`. Current honest states are: sending, sent, failed and private-chat read via the other member's `last_read_at`; saved chats show no checkmarks and group chats do not show fake read state.
- `20260507_message_delivery_receipts.sql` is now applied. Read-only MCP confirmed `chat_members.last_delivered_at`, `mark_chat_delivered(p_chat_id uuid)` and `mark_chat_read(p_chat_id uuid)` with authenticated-only execute grants.
- Bubble and chat-list preview now support private-chat delivered state via the other member's `last_delivered_at`; saved chats still show no checkmarks and group chats still do not show fake read/delivered state.
- Desktop message action menu now includes the same quick reaction row as the mobile long-press sheet.

2026-05-07 receipt sync / bubble rhythm follow-up:

- Sender-side receipt sync now uses one stable `chat-members:receipts:{userId}` subscription in `useChats` for RLS-visible `chat_members` UPDATE rows. It patches affected chat members in store instead of refetching all chats, so inactive chat preview can move from sent to delivered/read.
- The older active-chat-only receipt path was the reason sender checkmarks updated after entering the chat; active bubbles and preview now read the same store member receipt state.
- Text bubbles without reactions render footer meta inline at the end of the text flow; reaction bubbles keep the compact bottom meta row.
- Link bubbles no longer force a wide desktop width; they use fit-content with responsive max-width and URL wrapping.

2026-05-08 reliable send follow-up:

- Text, location, media, voice and forwarded message inserts now include `client_message_id` and `client_sent_at`, but do not send client `created_at`.
- Message bubbles stay pending until the DB insert returns/fetches the server row; the server `created_at` replaces the local pending timestamp after acknowledgement.
- Retry reuses the same `client_message_id` and fetches an existing row on duplicate/unknown responses, preventing duplicate messages after network timeouts.

2026-05-08 chat actions/profile/group receipts follow-up:

- Chat list `Открыть профиль` / group info actions now open a separate preview modal/sheet without changing `selectedChatId`; the chat opens only from the explicit `Открыть чат` button.
- Mobile chat long-press suppresses the touch `contextmenu` path, so only the bottom action sheet should appear.
- Supabase read-only check confirmed `chat_members.last_read_at` is visible to chat members through existing RLS and `chat_members` is in realtime; group own-message read counts and the `Кто прочитал` modal use that data without faking private receipt states.
- User manually applied `.migration-backup/supabase/migrations/20260508_chat_pinned_order.sql`; read-only MCP confirmed `chat_members.pinned_order`, `set_pinned_chat_order(uuid[])`, authenticated-only execute grants and no anon/PUBLIC execute access.

2026-05-08 pinned/profile/group receipt polish:

- Group own-message footer now uses a compact `✓ count/total` read indicator instead of appending a second loose read badge after the sent check; full names remain in the `Кто прочитал` modal.
- Pinned chat order UI is enabled through context menu / mobile sheet `Переместить выше` and `Переместить ниже`; saved chat remains above all pinned chats.
- Mini-profile preview no longer shows service copy about preview mode and now displays profile `bio` plus a localized app role label when available.

2026-05-08 bubble/footer/group preview/pinned drag polish:

- Message bubble meta now uses measured Telegram-like placement for text/link/reply cases: meta stays inline when it fits the measured last text line and falls back to a compact next-line-end row only when needed. Reactions render below the text+meta group, while float/absolute text footer, artificial spacer/wbr, and large padding reserve are not used for ordinary text bubbles.
- Chat-list preview now derives own group-message read count from the same `chat_members.last_read_at` member data as in-chat receipts; online status is not used as read state.
- Desktop pinned chat drag reorder is enabled through a lightweight handle and still persists through `set_pinned_chat_order(uuid[])`; context-menu and mobile sheet move up/down actions remain the fallback.

2026-05-08 anchored bubble meta / compact reactions follow-up:

- Text meta no longer uses "fits last line" as the only Telegram-like rule. Inline meta is limited to simple single-line text; wrapped multiline text, long URLs/tokens and reply/compound bubbles use anchored bottom-right meta inside the bubble.
- Anchored meta uses a measured final-line tail reserve only when the last text line would run under the footer; it does not apply global right/bottom padding and reactions do not participate in the text/meta placement decision.
- Reactions are rendered as a secondary compact layer below text+meta: the default row shows up to two reaction chips plus `+N`, with the overflow list shown as an overlay on hover/focus or by tapping `+N`.

2026-05-09 final message bubble polish:

- Anchored text meta no longer inserts an inline tail spacer for long CAPS / long-token messages. If the final text line would collide with the footer, the footer uses a compact bottom-end flow row; otherwise it stays anchored over the natural free corner.
- Location messages that match `📍 Местоположение: https://maps.google.com/?q=lat,lng` are displayed as rounded coordinates while preserving the original map href; ordinary Google and non-map URLs still use the regular formatter.
- Very short messages with multiple reactions now default to one visible reaction chip plus `+N`, so the reaction layer does not widen the core text+meta bubble.

2026-05-09 final bubble geometry follow-up:

- `+N` reaction overflow now opens in a fixed portal popover anchored to the `+N` chip instead of expanding inline inside the bubble, so hidden reactions do not shift message geometry or render under neighboring messages.
- Location messages are classified as compact short text before URL layout is chosen. Desktop keeps the full `📍 Местоположение:` label, while narrow/mobile viewports use the shorter `📍` label; both preserve the original Google Maps href.
- Anchored multiline/long-token text meta keeps Telegram-like behavior: it remains bottom-right when the final text line leaves room, and uses a compact measured bottom-end slot only when the final line would collide with the footer.

2026-05-10 notifications bounds / group invites follow-up:

- User manually applied `.migration-backup/supabase/migrations/20260509_group_invites.sql`.
- Read-only Supabase MCP confirmed `public.group_invites` exists with RLS enabled and expected FKs to `chats`/`profiles`; available MCP table introspection does not expose RPC definitions, so RPC behavior is verified through authenticated app QA.
- Notification popover QA should use the Codex/QA browser session or secure local QA credentials; never store secrets in repo/docs and do not depend on the user's mouse.

2026-05-10 group invite status/live update follow-up:

- Group info now has an owner/admin invite-status section backed by `public.group_invites`.
- The invite modal reads all latest invite statuses for the current chat: pending users are disabled, members are disabled, declined/cancelled/expired users can be invited again.
- Chat info subscribes to current-chat `chat_members` and `group_invites` realtime changes and refetches both lists after changes; action handlers also refetch after invite/cancel/remove/role changes.
- No SQL was applied automatically. Manual proposal pending: `.migration-backup/supabase/migrations/20260510_group_invite_join_system_messages.sql` for persistent join system messages after invite accept.

2026-05-10 invite unread / role / system notice follow-up:

- Frontend chat unread calculation now uses an effective baseline from `last_read_at`, `joined_at` and `cleared_at`, so accepted invitees do not inherit unread counts from pre-join history when `last_read_at` is still null.
- Chat list/store comparison now includes `chat_members.role`, allowing current-user admin/owner role changes to update role-gated UI after realtime/refetch without a full page refresh.
- System messages render as centered micro-notices outside `MessageBubble`; they do not show avatar, delivery checks, reactions, reply controls or normal user bubble styling.
- No SQL was applied automatically. New manual proposal pending: `.migration-backup/supabase/migrations/20260511_invite_accept_read_baseline_and_system_notice.sql`.

2026-05-10 reinvite / invite policy follow-up:

- Historical accepted invites are now treated as history unless the invitee is still present in `chat_members`; removed ex-members become inviteable again in both the invite modal and owner/admin invite status list.
- Invite UI uses friendly status/error copy only. Technical RPC names, raw payloads, UUIDs, PostgreSQL codes and stack details remain console-only diagnostics.
- Group info includes a gated "Кто может приглашать" setting. Until the manual DB proposal is applied, the UI falls back to `owner_admin_only` and shows a friendly migration-required note instead of breaking.
- No SQL was applied automatically. New manual proposal pending: `.migration-backup/supabase/migrations/20260512_group_invite_reinvite_and_policy.sql`.

2026-05-10 microphone self-monitoring follow-up:

- Mic test lives in `artifacts/kub/src/components/sidebar/AudioSettingsSection.tsx`; voice-message recording remains isolated in `artifacts/kub/src/hooks/useVoiceRecorder.ts` and `artifacts/kub/src/components/chat/VoiceRecorder.tsx`.
- Mic test now has an explicit "Прослушивать себя" toggle. It is off by default, enabled only while the mic test is active, and creates a local-only `AudioContext -> MediaStreamSource -> GainNode -> destination` monitoring path.
- Stopping the mic test, closing settings, disabling the toggle, or losing the mic stream disconnects monitoring nodes and closes the owned AudioContext. The mic test stream remains separate from normal voice-message recording and is not sent to chat.

2026-05-10 microphone self-monitoring quality follow-up:

- Mic test adds a local-only processing mode selector: "Чистый голос" requests browser echo cancellation, noise suppression, auto gain, mono input and 48 kHz / 16-bit ideals; "Без обработки" requests those processing constraints off.
- If advanced constraints are not supported, mic test falls back to simpler constraints and then `{ audio: true }`, showing friendly fallback copy instead of raw DOM errors.
- Self-monitoring has an app-only "Громкость прослушивания" GainNode control with 80% default; it does not change system volume and does not affect voice-message recording.

2026-05-10 staged attachments follow-up:

- The chat composer/send pipeline is split between `artifacts/kub/src/components/chat/MessageInput.tsx`, `artifacts/kub/src/components/chat/ChatWindow.tsx` and `artifacts/kub/src/hooks/useMessages.ts`.
- Existing media messages use the single-row `messages.media_url` model, so staged multi-file sends are sent sequentially as separate `image` / `video` / `audio` / `file` messages. No multi-attachment schema migration was added.
- File picker, drag-and-drop and clipboard files now create local staged attachments first. Upload to the existing `media` storage bucket starts only after Send; successful attachments are removed from the tray only after `sendMediaMessage` returns the DB-acknowledged row through the existing `client_message_id` path.

2026-05-10 staged voice follow-up:

- Voice recording now uses the staged attachment model: stopping the recorder creates a local `voice` preview item with an object URL, duration and stable `clientMessageId`; upload and message insert still happen only after Send.
- Recorded voice is sent as the existing `audio` message type through the same media bucket and `sendMediaMessage` DB-ack path. Typed text with a staged voice is sent as a separate text message first, so the voice bubble keeps the existing voice/audio rendering.
- The recorder and mic self-monitoring remain separate. Voice recording does not enable live monitoring, and deleting/sending a staged voice revokes the local preview URL.

2026-05-10 locations / task routing foundation:

- Read-only Supabase MCP confirmed that `locations`, `location_members` and the routing columns on `tasks` are not yet present in the live schema.
- New SQL was not applied automatically. Manual proposal: `.migration-backup/supabase/migrations/20260513_locations_task_routing.sql`.
- Frontend fallback expectation: `/admin/locations` must show “Локации требуют обновления базы данных.” until the migration is applied, while existing task create/update flows continue to work through the current task RPC.
- After applying the migration manually, QA should cover location creation, location member assignment, primary admin routing, owner-to-admin tasks, staff-only visibility, location filters and task notifications.
- Live QA should use the Codex/QA browser session or QA credentials from secure environment; do not rely on user mouse/manual browser.

2026-05-10 dynamic roles / permissions foundation:

- User manually applied `.migration-backup/supabase/migrations/20260513_locations_task_routing.sql`; read-only Supabase MCP confirmed the locations/task routing schema and RPC are present.
- Dynamic roles schema is not applied yet: `roles`, `permissions`, `role_permissions`, `user_global_roles` and `location_members.role_id` are absent.
- New SQL was not applied automatically. Manual proposal: `.migration-backup/supabase/migrations/20260514_dynamic_roles_permissions.sql`.
- Frontend fallback expectation: `/admin/roles` must show “Роли и права требуют обновления базы данных.” until the migration is applied. Existing profiles, locations and tasks must keep working through legacy `profiles.role` / `location_members.role`.
- After applying the migration manually, QA should cover custom role create/edit, permission assignment, global role assignment/removal, location dynamic role assignment, profile/mini-profile role display, last owner/tech_admin protection, admin-only task visibility and group invite permissions.
- Authenticated local Playwright QA covered `/admin/roles` fallback at desktop and mobile widths, `/admin/locations` after the applied routing migration, admin user profile role summary, private chat profile role summary, and the main chat shell. With the dynamic roles probe disabled while migration is absent, normal fallback pages produced no console errors.

2026-05-10 roles / permissions activation follow-up:

- Read-only Supabase MCP against the live app project ref `nhogbeojfnbjcfipitrh` did not find `public.roles`, `public.permissions`, `public.role_permissions`, `public.user_global_roles`, `location_members.role_id` or the role-management RPCs yet, so the applied dynamic roles migration is not confirmed on the live project.
- Frontend schema detection no longer stays disabled just because an older browser session cached the pre-migration fallback. Dynamic roles probing is enabled by default, records an explicit local `0` only after a missing-schema response, and `/admin/roles` auto-probes once on open.
- Fallback states now separate missing schema from permission denial: missing migration shows the database-update message, while protected/denied access shows a friendly insufficient-permissions state.

2026-05-10 dynamic roles / permissions polish:

- User confirmed `.migration-backup/supabase/migrations/20260514_dynamic_roles_permissions.sql` was applied. Read-only Supabase MCP confirmed dynamic role tables, `location_members.role_id`, seeded roles/permissions, helper functions and role-management RPC on project ref `nhogbeojfnbjcfipitrh`.
- `/admin/roles` was polished for non-technical admins: role-vs-permission helper copy, scope explanations, system-role warnings, friendly permission categories, readable permission labels/descriptions and technical keys moved to secondary text.
- Dynamic global roles are now considered by admin/manager role hooks, and the admin users list shows dynamic global role labels before legacy `profiles.role` fallback labels.
- Security review found RLS policies protecting role tables and authenticated-only role-management RPC grants. A grants-hardening proposal was added, not applied automatically: `.migration-backup/supabase/migrations/20260515_dynamic_roles_grants_hardening.sql`.
- Remaining schema integration risk: `group_invite_create` currently does not enforce seeded dynamic invite permissions such as `chats.invite_any`; invite flow still uses the existing chat admin/member policy.
- Polish QA found that the current QA admin account can view roles but does not have `roles.manage`; `/admin/roles` now presents a clear read-only state and disables create/edit/permission changes instead of letting a 403 surface after click.
- Security review also found that `user_assign_global_role` should additionally protect owner/tech_admin assignment and self-escalation for callers that only have `users.assign_roles`. The same proposal file now includes this RPC hardening; SQL was not applied automatically.

2026-05-10 admin users bulk roles/location QoL:

- Admin users panel now has mobile-safe scrolling through the admin layout content scroller (`min-h-0`, `overflow-y-auto`, extra bottom padding) and a UsersTab bottom padding so bulk controls do not cover the last rows on mobile.
- UsersTab adds visible-row selection, per-user checkboxes, a sticky bulk toolbar, global role assignment/removal, location assignment, location role assignment and primary-admin assignment. Bulk actions use the existing per-user RPCs and report partial success with friendly errors; no service role or direct table writes are used.
- Users can be filtered by search, global role, location, location role, primary admin and status. Rows now show friendly dynamic global role labels, location badges and primary-admin labels with legacy role fallback.
- Read-only Supabase MCP confirmed the live dynamic roles schema is present; `user` already has `tasks.view` and `chats.invite`, and existing legacy `profiles.role = user` profiles have dynamic global role coverage. A default-role trigger for future profiles is not present yet.
- SQL was not applied automatically. Manual proposal for future default-role/backfill safety: `.migration-backup/supabase/migrations/20260516_dynamic_roles_default_user_baseline.sql`.

2026-05-13 recurring tasks with routing:

- Read-only Supabase MCP confirmed current task infrastructure: `tasks`, `task_events`, task enums, `task_create_v2`, `task_update_v2`, `task_create_v3`, `task_update_v3`, `locations`, `location_members`, dynamic role/permission helpers and routing fields on `tasks`.
- Read-only Supabase MCP confirmed recurring-task infrastructure is not applied yet: `task_recurrences`, `task_recurrence_events` and `task_recurrence_*` RPC are absent.
- SQL was not applied automatically. Manual proposal created at `.migration-backup/supabase/migrations/20260518_recurring_tasks.sql`.
- Frontend task form now contains a “Повторение” section. With the migration missing it shows the friendly database-update state and keeps normal task create/update available.
- Recurring design copies location routing and visibility fields into generated occurrences: `location_id`, `target_role`, `route_admin_id`, `created_for_admin`, `visibility`, `assignment_scope`, `assignee_id`, `chat_id` and `priority`.
- Production still needs a scheduler/cron/Edge Function to call `task_recurrence_run_due()`. The frontend does not claim recurring tasks execute automatically while that scheduler is absent.
- Local authenticated Playwright QA ran against `http://127.0.0.1:5173` with viewports 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915. Screenshots and summary are in `output/playwright/recurring-tasks/` (ignored from git). Result: fallback visible, no raw technical UI, no ErrorBoundary, no horizontal overflow, existing task create/edit smoke passed. App console errors after filtering the expected missing-schema network probe: 0; unexpected failed requests: 0.

2026-05-14 recurring permissions / roles / filters polish:

- Read-only Supabase MCP confirmed the recurring tasks schema and RPCs are now present on project ref `nhogbeojfnbjcfipitrh`.
- MCP inspection found `_task_recurrence_can_manage(public.tasks)` still allows `tasks.manage` for creator/assignee or no-location templates. A manual hardening proposal was created at `.migration-backup/supabase/migrations/20260519_recurring_permissions_and_legacy_roles.sql`; SQL was not applied automatically.
- Frontend recurring lifecycle buttons now use `has_permission` / `has_location_permission` through the shared permission hook. Visible task badges remain available to assignees, but pause/resume/stop requires explicit recurrence-management authority.
- `/tasks` now gates task visibility through dynamic task permissions (`tasks.view`, `tasks.view_admin_tasks`, `tasks.view_all_locations`, `tasks.manage*`) instead of treating legacy admin/manager as the primary model. `profiles.role` remains fallback only.
- `/admin/users` no longer exposes direct legacy role mutation actions (`profiles.role = admin/manager/user`) as primary UI. Global and location role management is through dynamic role RPCs and role IDs; legacy labels remain fallback display only.
- Bans/mutes expired filtering now loads recent sanctions once and applies the active/expired toggle on the client, with expired rows marked by the existing “истёк” badge.
- UsersTab realtime refresh was moved to background loading for profile events and avoids reloading dynamic roles/routing redundantly from the same tab subscription; this should remove visible loading flicker while preserving live updates through the dedicated hooks.
- Local authenticated Playwright QA ran against `http://127.0.0.1:5173` with viewports 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915. Screenshots and JSON summary are in `output/qa-recurring-polish/` (ignored from git): `desktop-3840-users.png`, `desktop-1920-users.png`, `desktop-1440-users.png`, `desktop-1440-bans.png`, `desktop-1440-tasks.png`, `desktop-1440-roles.png`, `mobile-390-users.png`, `mobile-412-users.png`, `mobile-390-tasks.png`, `mobile-412-tasks.png`, `qa-summary.json`.
- QA result: login succeeded through UI, UsersTab stayed stable during a 60s wait with no loading flicker, recurring task badge was visible and pause/resume/stop controls were not shown for the current non-owner QA account, bans expired toggle changed the visible list, mobile users/tasks had no horizontal overflow after the task filter width fix, console errors were 0 and unexpected failed requests were 0.
- QA limitation: the available QA account is shown by the app as manager-level, so tech_admin/owner-only recurrence-management controls and role-management page access were not live-verified with that account in this pass. The visible `Maxim Kozlov` text in `/tasks` came from live chat/user data, not a source-code task-filter hardcode; source scan found no `Maxim/Kozlov` dependency outside unrelated Russian "Максимум" file-size copy.

2026-05-14 role cleanup / filters / sanctions polish:

- Created proposal-only SQL at `.migration-backup/supabase/migrations/20260520_role_cleanup_task_filters_sanctions.sql`; SQL was not applied automatically.
- Frontend task access now combines global dynamic task permissions with location-scoped permissions from the current user's memberships. Client/global user fallback no longer grants task access in the frontend helpers.
- `/tasks` filters now derive available locations and admin/staff filter availability from the current user and their dynamic/location permissions, not from a specific user name or QA fixture.
- `/admin/roles` now distinguishes custom role deletion vs archive: unused custom roles show “Удалить роль”, used/unknown roles show “Отключить роль”, and the action is protected by an app dialog instead of `window.confirm`.
- `/admin/users` reduces flicker by comparing row/state/contact signatures before replacing state during background refresh; filters and selection are preserved.
- Bans/mutes now expose a paginated sanctions history when “Показать истёкшие” is enabled. Audit rows hydrate target profiles/chats and render actor/action/target/reason/expiry without raw JSON as the primary UI.
- Validation completed: `git diff --check`, `pnpm.cmd --filter @workspace/kub run typecheck`, and `PORT=5173 BASE_PATH=/ pnpm.cmd --filter @workspace/kub run build` passed. Build emitted the existing Vite sourcemap/chunk-size warnings.
- Authenticated Playwright QA ran against local UI `http://127.0.0.1:5173` with viewports 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915. Screenshots and summary are in `output/qa-role-cleanup/` (ignored from git): `users-*.png`, `tasks-*.png`, `roles-*.png`, `bans-*.png`, `qa-summary.json`.
- QA result: login through UI succeeded, `/admin/users` opened by dynamic permissions and stayed stable during the 60s 1440x900 wait with `loadingHits=0`, `/admin/roles` showed system-role/delete/archive copy, `/admin/bans` showed sanctions history after “Показать истёкшие”, `/tasks` loaded without recurrence management controls for the current account, desktop/mobile had no horizontal overflow, console errors were 0 and unexpected failed requests were 0.
- QA limitation: only the available QA account was used. Separate staff/client accounts without admin permissions were not available in this pass, so multi-account RLS visibility for “location_staff without global role” and custom-role deletion after the new SQL proposal is applied still need manual verification.

2026-05-16 location_staff task access verification:

- Read-only Supabase MCP confirmed the current live schema on project ref `nhogbeojfnbjcfipitrh`: `roles`, `permissions`, `role_permissions`, `user_global_roles`, `locations`, `location_members`, `tasks`, `task_recurrences`, `task_events`, and `tasks.deleted_at/deleted_by/delete_reason` are present with RLS enabled.
- Read-only SQL inspection confirmed `location_staff` is an active system location role with only `tasks.view`; `location_client` has no task permissions; global `user` has no task permissions; `owner` and `tech_admin` include task view/manage/delete/restore permissions.
- Read-only SQL inspection confirmed `has_location_permission(p_user_id, p_location_id, p_permission_key)` resolves `location_members.role_id` first and falls back from legacy `location_members.role` to `location_owner/location_admin/location_manager/location_staff/location_client`. `_task_visible_to_current_user_v3` allows location-scoped staff-visible tasks through `has_location_permission(..., 'tasks.view')` and blocks `created_for_admin` unless the user has admin-task visibility.
- Frontend fix: `useTaskRouting` now always merges the current user's own `location_members` rows into the routing state. This avoids hiding task access when RLS limits the all-members query but still allows the user's own membership row.
- Frontend fix: mobile `BottomNav` now shows a `Задачи` tab when `useTaskAccessGate()` allows tasks. Client/default users without global task permissions or task-capable location membership still do not get that tab.
- Authenticated API smoke with the configured QA account is saved at `output/location-staff-task-access/authenticated-api-summary.json` (ignored from git). That account currently has no location membership and no global task permissions, so it is a client-baseline negative check, not a pure `location_staff` UI account.
- Local authenticated Playwright QA ran against `http://127.0.0.1:5173` on 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915 via `pnpm.cmd e2e:smoke`. Result: 5/5 passed, no ErrorBoundary, no unexpected console errors in the smoke test, `/tasks` renders a friendly no-access state for the current baseline account.
- QA limitation: no separate staff/client credentials are available in `C:\Users\maksi\.kub-messenger-qa.env`, and current live `location_members` data contains `location_owner` rows only. Full UI proof for a pure `location_staff` user without global manager/admin must be checked manually with a staff fixture/account after deployment.

2026-05-17 TaskFormModal v2 / unified bulk selection polish:

- Frontend-only polish; SQL was not changed or applied. TaskFormModal now uses a wider mobile-safe modal, keeps recurrence compact, explains scheduler requirements to admins, validates location/routing/chat/admin-only combinations before RPC, and hides admin-only task controls unless the current user has admin-task management permissions.
- Bulk selection now uses one shared visual control for tasks and admin users. Selected task cards/list rows and selected user rows get the same cyan-tinted border/background state; actions remain app-dialog/RPC based and do not use `window.confirm`.
- Validation completed: `git diff --check`, `pnpm.cmd --filter @workspace/kub run typecheck`, `PORT=5173 BASE_PATH=/ pnpm.cmd --filter @workspace/kub run build`, and `pnpm.cmd e2e:smoke` passed. Build still emits the existing Vite sourcemap/chunk-size warnings.
- Local Playwright smoke ran against `http://127.0.0.1:5173` on 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915. Result: 5/5 passed, no ErrorBoundary and no console errors in the smoke test.
- Additional local Playwright UI pass opened `/tasks` and `/admin/users` on all five required viewports with the configured QA credentials. Current QA credentials are baseline/non-admin for these routes, so create-task, task bulk delete and users bulk toolbar controls were correctly not visible; no horizontal overflow or ErrorBoundary appeared. Because this account cannot access the owner/admin-only UI, TaskFormModal create flow and users bulk role/location actions still need manual verification with an owner/tech_admin/admin fixture after deploy.

2026-05-17 production UI polish pass:

- Frontend-only polish; SQL was not changed or applied. Source UI copy was cleaned for role/location labels, role-management critical-role copy, user search placeholder text, audit UUID display and bans/mutes missing-profile fallbacks.
- Mini-profile/profile polish: compact role summary now shows friendly dynamic/global role badges, first location role, `+N` club count with Russian pluralization, expandable club list and primary admin label for staff memberships. Private chat profile preview gained a copy-username action.
- Audio settings polish: device selection, voice-processing mode, browser processing toggles, mic test/self-monitoring and gain controls are grouped into clearer production copy. Functionality remains local to audio settings and does not change staged voice recording.
- Production-like Playwright screenshot QA ran against local `http://127.0.0.1:5173` with tech-admin and client QA sessions. Browser contexts were created by Playwright and closed by the scripts; user mouse/main browser were not used.
- Screenshot artifacts are ignored from git and stored in `output/qa-production-ui-polish/`. Key paths: `tech-desktop-3840-chat-main-loaded.png`, `tech-desktop-1440-mini-profile-context.png`, `tech-desktop-1440-audio-settings.png`, `tech-mobile-390-audio-settings-sound-section.png`, `tech-mobile-390-admin-users.png`, `client-mobile-390-mini-profile.png`, `client-desktop-1440-tasks-page.png`, `qa-summary.json`.
- Screenshot QA result: 48 screenshots recorded, console errors 0, unexpected request failures 0. Existing QA database content still contains test chat names/messages; those are live data, not source-code labels.
- Validation completed: `git diff --check`, `pnpm.cmd --filter @workspace/kub run typecheck`, `PORT=5173 BASE_PATH=/ pnpm.cmd --filter @workspace/kub run build`, and `pnpm.cmd e2e:smoke` passed. Build still emits the existing Vite sourcemap/chunk-size warnings.

2026-05-17 long-session realtime/background sync hardening:

- Frontend-only hardening; SQL was not changed or applied. Added `tests/e2e/long-session.spec.ts` and `pnpm.cmd e2e:long-session` for a dedicated long-session browser proof outside the default smoke suite.
- Realtime/focus map reviewed:
  - `useChats`: `chats:user:{userId}`, `chat-members:receipts:{userId}`, `chat-members:user:{userId}`, `visibilitychange`, app refresh event, now also `online` reconnect refetch.
  - `useMessages`: `messages:chat:{chatId}:typing`, `messages:chat:{chatId}`, `reactions:chat:{chatId}`, `profiles:chat:{chatId}`, `visibilitychange`, now also `online` background message refetch.
  - `useUser`: ref-counted `profile-self:{userId}` channel and Supabase auth listener; same-user `SIGNED_IN` / token refresh stays silent.
  - `useNotifications`, `useTasks`, `useTask`, `useRecurringTasks`, `useFolders`, `useTopics`, bans/mutes/admin panels: channel cleanup exists on unmount/change; refetches are debounced.
  - `useDynamicRoles` and `useTaskRouting`: random per-hook channel names remain stable for each mount and cleanup on unmount; realtime refresh now runs as background refresh and state arrays are replaced only when signatures change.
- Dev-only instrumentation now exposes `window.__kubDevInstrumentation` with metadata-only counters: cumulative fetches, active realtime channels, duplicate channel counts, active mounts and heartbeat counters. No tokens, payloads, messages, profile data or secrets are captured.
- Background refresh state preservation:
  - Dynamic roles and task routing no longer set full `loading=true` during realtime refresh, and background errors keep the current data instead of clearing UI.
  - Chats refetch on tab return/online with `preserveActiveChat: true`.
  - Active message history refetches on reconnect in background so composer draft/staged state is not touched.
  - Reaction fallback refetch is now background-only, avoiding visible loading flicker.
- Network hardening: unread counters in `useChats` no longer use Supabase `head: true` requests. They keep exact counts with a tiny `GET ... limit(1)` query, which removed Chromium/Playwright `net::ERR_ABORTED` artifacts during background transitions.
- Local Playwright QA ran against `http://127.0.0.1:5173`. Dev server was started from the local workspace with public Supabase config extracted from the live bundle without printing values; QA credentials stayed in the local env file.
- `pnpm.cmd e2e:long-session` result: 1/1 passed on 1440x900. The test kept the app open for about 2.4 minutes, typed a draft marker, set a window reload marker, switched to a second Playwright page and back, simulated offline/online, and verified: draft marker preserved, window marker preserved, no main-frame reload, no password/login screen, no ErrorBoundary, duplicate realtime channels `{}`, request count below threshold, failed requests 0, console/page errors 0.
- `pnpm.cmd e2e:smoke` result: 5/5 passed on 1440x900, 1920x1080, 3840x2160, 390x844 and 412x915. Smoke opened the shell, notifications and tasks route without console errors.
- Guard scans completed: no credentials matches, no `service_role` frontend matches, no `window.confirm/alert/prompt`, no forbidden pnpm PowerShell wrapper references. Reload scan still finds only existing explicit/manual paths: ErrorBoundary refresh button, app-update button, iframe open-current-page action and safe link formatting.

2026-05-17 recurring scheduler setup:

- Production scheduler strategy is now documented as Supabase Edge Function + Supabase Cron. Function source: `supabase/functions/recurring-tasks-run-due/index.ts`.
- Manual scheduler SQL proposal created at `.migration-backup/supabase/migrations/20260524_recurring_scheduler_edge_function.sql`. SQL was not applied automatically and the function was not deployed automatically.
- The Edge Function requires a scheduler token and backend-only Supabase secret key in Supabase Edge runtime. No secret values were committed.
- `rls:smoke` now probes `task_recurrence_run_due`: owner/tech_admin execution is skipped by default unless `KUB_QA_ALLOW_MUTATIONS=1`; `location_admin`, `location_staff`, and `client` are expected to be denied.
- Multi-account applied-flow QA remains non-mutating by default. Routing-field copy and notification delivery for generated occurrences still require fixture-backed mutation QA after the scheduler is deployed.
- Validation completed: `git diff --check`, `node --check scripts/rls-smoke.mjs`, `pnpm.cmd exec biome check scripts/rls-smoke.mjs supabase/functions/recurring-tasks-run-due/index.ts`, `pnpm.cmd --filter @workspace/kub run typecheck`, `PORT=5173 BASE_PATH=/ pnpm.cmd --filter @workspace/kub run build`, `pnpm.cmd e2e:smoke`, `pnpm.cmd exec playwright test tests/e2e/roles-visibility.spec.ts`, and `pnpm.cmd rls:smoke` passed. Build still emits the existing Vite sourcemap/chunk-size warnings.

2026-05-17 deployed recurring scheduler read-only verification:

- Supabase MCP read-only SQL confirmed `cron.job` has active job `kub-recurring-tasks-run-due` with schedule `*/5 * * * *`.
- Supabase Edge Function list confirmed `recurring-tasks-run-due` is `ACTIVE`.
- Latest `net._http_response` rows showed HTTP `200` at `2026-05-17 18:25`, `18:30` and `18:35` UTC. Earlier `401` rows were from before the scheduler token was fixed.
- `public.task_recurrences` due count was `0`, so there was no due recurrence available for creation during the read-only check.
- Local `KUB_QA_ALLOW_MUTATIONS` was not enabled and no local scheduler token was present, so no QA tasks were created, no occurrences were generated, duplicate prevention was not exercised and cleanup was not needed.
- Applied-flow instructions were added to `docs/RECURRING_SCHEDULER.md` for the next pass with `KUB_QA_ALLOW_MUTATIONS=1`.
- Validation completed: `git diff --check`, credential/service-role/forbidden-wrapper guard scans, `pnpm.cmd rls:smoke` with deployed public Supabase config, `pnpm.cmd --filter @workspace/kub run typecheck`, `PORT=5173 BASE_PATH=/ pnpm.cmd --filter @workspace/kub run build`, `KUB_BASE_URL=https://kub.apollot.ru pnpm.cmd e2e:smoke`, and `KUB_BASE_URL=https://kub.apollot.ru pnpm.cmd exec playwright test tests/e2e/roles-visibility.spec.ts` passed. Build still emits the existing Vite sourcemap/chunk-size warnings.

2026-05-17 deployed recurring scheduler applied-flow verification:

- Local mutation guard was enabled with `KUB_QA_ALLOW_MUTATIONS=1`; passwords/tokens were read only from the local QA env and were not printed.
- Created two temporary authenticated owner QA fixtures in `TestLocationCodex`: one staff-visible staff-pool recurrence and one admin-only recurrence routed to the location-admin QA account.
- Waited for deployed cron/Edge scheduler rather than calling the scheduler token locally. Cron created both due occurrences during the `2026-05-17 19:15:00` UTC run; `net._http_response` latest rows remained HTTP `200`.
- Generated occurrences copied all checked routing/security fields from their templates: `location_id`, `target_role`, `route_admin_id`, `created_for_admin`, `visibility`, `assignment_scope`, `assignee_id`, `chat_id` and `priority`.
- Duplicate prevention was verified by forcing the staff recurrence back to the same `recurrence_scheduled_for` and calling authenticated `task_recurrence_run_due`: return value was `0`, and occurrence count stayed `1 -> 1`.
- Role visibility was verified through authenticated role sessions: location staff saw the staff-visible occurrence, client did not; staff did not see the admin-only occurrence, while location-admin and owner did.
- Notification delivery was verified for the safe QA fixtures: staff-visible occurrence notification was visible to the location-staff QA account and admin-only occurrence notification was visible to the location-admin QA account.
- Cleanup completed through authenticated RPCs: two QA recurrences were stopped and four QA task rows were soft-deleted. Read-only post-check confirmed `open_codex_qa_tasks=0` and `open_codex_qa_recurrences=0`.
- Validation completed: `git diff --check`, credential/service-role/forbidden-wrapper guard scans, deployed `pnpm.cmd rls:smoke` with `KUB_QA_ALLOW_MUTATIONS=1` in process env, `pnpm.cmd --filter @workspace/kub run typecheck`, `PORT=5173 BASE_PATH=/ pnpm.cmd --filter @workspace/kub run build`, `KUB_BASE_URL=https://kub.apollot.ru pnpm.cmd e2e:smoke`, and `KUB_BASE_URL=https://kub.apollot.ru pnpm.cmd exec playwright test tests/e2e/roles-visibility.spec.ts` passed. Build still emits the existing Vite sourcemap/chunk-size warnings.

2026-05-17 global search and command palette:

- Frontend added a global search palette opened by Ctrl+K/Cmd+K and by the mobile search tab. Existing sidebar chat-list search remains local and unchanged.
- Profile search uses the existing `profiles.full_name` and `profiles.username` fields; no separate `nickname` column exists in the current generated/manual types.
- Created proposal-only SQL at `.migration-backup/supabase/migrations/20260522_global_search.sql`; SQL was not applied automatically. The proposal adds `global_search(p_query, p_limit, p_types)` plus trigram indexes for profiles/chats/messages/tasks/locations.
- While the migration is missing, the UI falls back to RLS-visible frontend search: visible chats, loaded messages, profiles by full name/username, visible tasks and locations. The palette shows a friendly note instead of raw PGRST/RPC text.
- Result actions verified locally: user result opens a mini-profile preview, chat result uses `safeOpenChat`, message result opens the chat and requests a message jump/highlight, task result navigates to `/tasks?task=...`, location result opens admin locations only for staff/admin access.
- Added `tests/e2e/global-search.spec.ts`; it verifies Ctrl+K opens the palette, username-style input is accepted, Escape closes the palette and no ErrorBoundary appears. `tests/e2e/helpers/auth.ts` now waits briefly for the login form before deciding the user is already authenticated.
- Local Playwright QA ran against `http://127.0.0.1:5173` with viewports 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915. Screenshots and summary are in `output/qa-global-search/` (ignored from git): `*-palette-open.png`, `*-username-query.png`, `*-mini-profile.png`, `*-chat-list-search.png`, `*-chat-result-opened.png`, `qa-summary.json`.
- QA result: Ctrl+K opened the palette on desktop, the mobile search tab opened the sheet on 390/412 widths, `@te` username query rendered, `Maxim` returned a user result and mini-profile, `TestGroup` returned a chat result and opened via `safeOpenChat`, local chat-list search still accepted `QA`, and all five viewport overflow checks were false.
- Because the SQL proposal is not applied, each fresh browser context can produce one expected missing-RPC `404` probe before fallback is cached in that page. There were no repeated probes/request storm, no unexpected failed requests after filtering that expected probe, and no raw technical error in visible UI.

2026-05-17 sidebar-integrated global search:

- Sidebar search is now the primary desktop global-search entry. Empty query keeps the regular folder tabs and chat list; non-empty query replaces the list area with grouped global results while local chat matches remain immediate and deduped against RPC/fallback chat results.
- Ctrl+K/Cmd+K focuses the existing sidebar search input on desktop when the sidebar is visible. Mobile search still opens the same global-search sheet, now backed by the same shared result renderer and result actions.
- Shared search UI/action layer added for sidebar and palette: result sections/items, empty state, mini-profile preview, command results and navigation actions.
- Existing in-chat search remains separate in `ChatWindow`/`ChatSearchBar`.
- `20260522_global_search.sql` was rechecked after the previous syntax fix; SQL was not applied automatically.
- Playwright QA ran on 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915. Evidence is in ignored `output/qa-sidebar-global-search/`: desktop `*-sidebar-username.png`, `*-sidebar-chat.png`, `*-chat-opened.png`; mobile `*-mobile-sheet-username.png`; `qa-summary.json`.
- QA summary: Ctrl+K focused sidebar search on desktop, sidebar `@te` and `TestGroup` searches rendered without overflow, chat result opened through the normal chat path, mobile search tab opened the global search sheet, console errors 0, unexpected failed requests 0.

## 2026-05-17 — Multi-account QA fixtures foundation

- Added local-only multi-account QA format for owner, tech admin, location admin, location staff, and client in `docs/QA_ACCOUNTS.md`.
- Added ignored Playwright auth-state generation under `output/playwright-auth/` via `pnpm.cmd e2e:auth-states`.
- Added `tests/e2e/roles-visibility.spec.ts` for role-specific UI visibility checks. Role tests skip per role when neither credentials nor storage state are available.
- Extended `pnpm.cmd rls:smoke` to run role-aware authenticated RPC/RLS probes with fake UUIDs by default. Real fixture mutations remain gated for future work by `KUB_QA_ALLOW_MUTATIONS=1`.
- No real credentials are documented here; only local env variable names are listed in workflow docs.

## 2026-05-17 — location_staff staff_pool task claim investigation

- Reproduced with local-only multi-account QA credentials and `KUB_QA_ALLOW_MUTATIONS=1`: owner created a temporary `staff_pool` task in `TestLocationCodex`; `location_staff` could read the task but `task_claim` returned HTTP 403 with `only_staff_can_claim_pool_tasks`.
- Confirmed task fields during reproduction: `status=new`, `assignment_scope=staff_pool`, `assignee_id=null`, `created_for_admin=false`, `target_role=staff`, `location_id=TestLocationCodex`, `deleted_at=null`, `recurrence_id=null`.
- Read-only schema/function inspection found the root cause in backend RPC: live `public.task_claim` still checks legacy `public.is_manager_or_admin(v_caller)` before looking at task location membership. That blocks pure `location_staff` even though task visibility now correctly uses location-scoped permissions.
- Frontend also had a legacy gate: `TaskDetailModal` showed the claim action only through global `useIsManagerOrAdmin()`. It now uses a separate claim permission gate (`tasks.claim`/task-management permissions) with location-scoped checks.
- Created proposal-only migration `.migration-backup/supabase/migrations/20260525_task_claim_location_staff.sql`. SQL was not applied automatically. The proposal adds `tasks.claim`, grants it to owner/tech/admin/manager plus location owner/admin/manager/staff, and replaces `task_claim` so staff can claim only visible, undeleted, unassigned, non-admin `staff_pool` tasks in their own location.
- Updated `scripts/rls-smoke.mjs` with adaptive `tasks.claim` checks. Until the migration is applied, the smoke prints an advisory skip for missing `tasks.claim`; after applying it, `location_staff` must have location `tasks.claim` and `client` must not have global claim permission.
- Temporary QA task from reproduction was soft-deleted through authenticated RPC; no direct DB hacks or service-role access were used.
- Local Playwright QA ran against `http://127.0.0.1:5173` with the required 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915 projects: `pnpm.cmd e2e:smoke` passed 5/5 and `pnpm.cmd exec playwright test tests/e2e/roles-visibility.spec.ts` passed 20/20.
- Validation completed: `git diff --check`, `node --check scripts/rls-smoke.mjs`, `pnpm.cmd exec biome check scripts/rls-smoke.mjs`, `pnpm.cmd --filter @workspace/kub run typecheck`, `cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"`, local Playwright smoke/roles visibility, and `pnpm.cmd rls:smoke` with public Supabase config passed. Build still emits the existing Vite sourcemap/chunk-size warnings.

## 2026-05-18 — Search v2 filters and in-chat full-history search

- Added frontend parser and removable chips for `type:`, `from:`, `in:`, `has:`, `before:` and `after:` filters. Simple text search remains unchanged; `@username` still works as a normal username-prioritized query.
- Sidebar search and Ctrl+K/mobile global search now pass parsed filters into `useGlobalSearch`. Missing `global_search_v2` is treated as an expected fallback path and shows friendly limited-search copy instead of raw RPC/PGRST text.
- In-chat search now calls `search_chat_messages` when available, keeps loaded-message fallback, supports `has:`/date/from filters, current-topic vs all-topic mode, a compact result list, next/prev, and async jump/highlight through `ensureMessageLoaded`.
- Proposal-only SQL created at `.migration-backup/supabase/migrations/20260526_global_search_filters.sql`. SQL was not applied automatically. The proposal adds `global_search_v2(p_query, p_filters, p_limit)` and `search_chat_messages(...)` with authenticated RLS-safe table access.
- Manual Playwright QA used local dev server `http://127.0.0.1:5173` with refreshed multi-account auth states. Checked global/sidebar/mobile search and in-chat search on 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915. In-chat QA opened Saved Messages, opened search inside chat, verified `has:link` and `after:2026-05-01` chips, no horizontal overflow and no unexpected console errors.
- Validation completed: `git diff --check`, `pnpm.cmd --filter @workspace/kub run typecheck`, `cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"`, `pnpm.cmd e2e:smoke`, and `pnpm.cmd exec playwright test tests/e2e/global-search.spec.ts` passed. Build still emits existing sourcemap/chunk-size warnings.

## 2026-05-18 - Search v2 applied migration verification

- After the required search migrations were applied in Supabase, local Playwright QA confirmed the new RPC path is active rather than the fallback path.
- Refreshed multi-account auth states with `pnpm.cmd e2e:auth-states`; owner, tech admin, location admin, location staff and client states were saved under ignored `output/playwright-auth/`.
- Applied-flow browser check ran against `http://127.0.0.1:5173` on 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915. One browser was used sequentially with closed contexts.
- `global_search_v2` returned HTTP 200 on all five viewports for `type:message has:link after:2026-05-01`; the "database update required" fallback copy was absent.
- `search_chat_messages` returned HTTP 200 on desktop 3840x2160, 1920x1080 and 1440x900 from the real in-chat search UI; the loaded-messages fallback copy was absent.
- Validation completed after the applied-flow check: `pnpm.cmd e2e:smoke`, `pnpm.cmd exec playwright test tests/e2e/global-search.spec.ts`, `pnpm.cmd --filter @workspace/kub run typecheck`, and `cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"` passed. Build still emits existing Vite sourcemap/chunk-size warnings.

## 2026-05-18 - Generated database types bridge and drift check

- Fresh typegen ran with `SUPABASE_PROJECT_REF=nhogbeojfnbjcfipitrh`; `artifacts/kub/src/types/database.generated.ts` was updated from the live public schema.
- Secret scan on `database.generated.ts` found no `service_role`, Supabase access token, QA password, or real QA email.
- Added `artifacts/kub/src/types/database.app.ts` as the app-facing bridge between manual `database.ts` and generated `database.generated.ts`; existing imports remain unchanged.
- Added advisory `pnpm.cmd db:types:check`. Current drift: generated-only `messages.media_bucket/media_path`, generated-only app RPC types `global_search_v2` and `search_chat_messages`, and server-side-only `notifications_push_outbox`.
- No UI code was changed. Deployed Playwright smoke ran on the standard five viewports and passed 5/5.
- Validation completed: `git diff --check`, `node --check scripts/check-database-type-drift.mjs`, `pnpm.cmd db:types:check`, `pnpm.cmd --filter @workspace/kub run typecheck`, `cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"`, deployed `KUB_BASE_URL=https://kub.apollot.ru pnpm.cmd e2e:smoke`, and `pnpm.cmd rls:smoke` with public deployed Supabase config passed. Build still emits existing Vite sourcemap/chunk-size warnings.

## 2026-05-18 - PWA baseline and offline shell

- Existing manifest/service worker were hardened for installability and authenticated-app safety. Manifest now uses `KUB Messenger`, `display: standalone`, `orientation: any`, `scope: /`, and 192/512/maskable icon entries.
- Service worker now caches only the app shell, icons, manifest, offline shell and same-origin static assets. Supabase Auth/REST/Realtime/Storage requests, non-GET requests, cross-origin requests and authenticated API responses are not cached.
- Service worker updates are surfaced through the existing app update banner. `skipWaiting` is sent only after explicit user click; `clients.claim()` is not used and focus/visibility does not force reload.
- Added runtime offline/reconnect banner: offline shows `Нет подключения`, online recovery shows `Подключение восстановлено` and hides automatically.
- Settings now expose a browser install action when `beforeinstallprompt` is available, with browser-menu fallback copy when the browser does not emit the prompt.
- Added `docs/PWA_NATIVE_READINESS.md` with installability, caching, update, offline, native packaging and permission/deep-link notes.
- Playwright PWA QA ran locally on 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915. It verified manifest fetch, icon fetches, service worker registration, no auto `skipWaiting`, no `clients.claim`, offline/reconnect banner state, and direct `/tasks`/`/admin` app-shell routes.
- Validation completed: `git diff --check`, `pnpm.cmd --filter @workspace/kub run typecheck`, `cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"`, `pnpm.cmd e2e:smoke`, `pnpm.cmd rls:smoke` with public Supabase config, `pnpm.cmd db:types:check`, and `pnpm.cmd exec playwright test tests/e2e/pwa.spec.ts` passed. Build still emits existing Vite sourcemap/chunk-size warnings.

## 2026-05-18 - Production frontend monitoring foundation

- Added optional Sentry browser monitoring through `@sentry/react`. The SDK initializes only when `VITE_SENTRY_DSN` exists; without it, reporting functions are no-op and the app sends no monitoring network requests.
- Added `artifacts/kub/src/lib/monitoring.ts` with `initMonitoring`, `reportError`, `reportMessage`, user id scoping, breadcrumbs, build metadata, and shared redaction.
- Redaction removes passwords, access/refresh/id tokens, authorization headers, Supabase key shaped values, service-role shaped keys, email addresses, raw message/content/body/text fields, media/signed/public URLs and URL query secrets.
- `AppErrorBoundary` now reports sanitized errors while keeping friendly UI and explicit user actions: `Попробовать снова` and `Обновить страницу`.
- Global `window.error` and `unhandledrejection` reporting is installed at app boot. App-level categories were added for auth callback/password recovery failures, message send failures/timeouts, staged attachment upload/send failures, media playback failures, and PWA registration/update-check failures.
- Settings now show safe build metadata: app version and optional commit short SHA.
- Added `tests/e2e/monitoring.spec.ts`; Playwright QA ran locally on 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915 and verified disabled-by-default behavior plus redaction.
- Validation completed: `git diff --check`, `pnpm.cmd --filter @workspace/kub run typecheck`, `cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"`, `pnpm.cmd e2e:smoke`, `pnpm.cmd exec playwright test tests/e2e/pwa.spec.ts`, `pnpm.cmd exec playwright test tests/e2e/monitoring.spec.ts`, `pnpm.cmd rls:smoke` with public Supabase config, and `pnpm.cmd db:types:check` passed. Build still emits existing Vite sourcemap/chunk-size warnings.

## 2026-05-19 - Push notifications and phone verification foundation

- Added proposal-only push migration `.migration-backup/supabase/migrations/20260527_push_notifications_foundation.sql` for `push_subscriptions`, `notification_preferences`, `chat_notification_preferences`, outbox enqueue hardening, and preference-aware delivery.
- Added proposal-only phone migration `.migration-backup/supabase/migrations/20260528_phone_verification.sql` to add `phone_verified_at` and keep verified state mirrored only after Supabase Auth OTP success.
- Settings now expose push type toggles for messages, tasks and invites, with friendly states for unsupported browsers, blocked permission, missing VAPID public key and missing DB migration.
- Phone settings no longer offer “save without verification”; a changed phone can be persisted only after the OTP verify path succeeds.
- Service worker push handling now sanitizes payloads, uses `Новое уведомление` fallback copy, rejects unsafe notification click URLs, and keeps the existing PWA update/offline behavior.
- Added Edge Function source `supabase/functions/send-push-notifications/index.ts` for outbox delivery; deployment and secrets are manual.
- Added docs `docs/PUSH_NOTIFICATIONS.md` and `docs/PHONE_VERIFICATION.md`.
- Playwright QA ran locally on 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915: `tests/e2e/push-phone-foundation.spec.ts` passed 10/10, `tests/e2e/pwa.spec.ts` passed 5/5, smoke passed 5/5, and roles visibility passed 20/20.
- Validation completed: `git diff --check`, `pnpm.cmd --filter @workspace/kub run typecheck`, `cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"`, `pnpm.cmd e2e:smoke`, `pnpm.cmd rls:smoke` with public Supabase config and mutation probes disabled, `pnpm.cmd db:types:check`, `pnpm.cmd exec playwright test tests/e2e/pwa.spec.ts`, and `pnpm.cmd exec playwright test tests/e2e/push-phone-foundation.spec.ts` passed. Build still emits existing Vite sourcemap/chunk-size warnings.

## 2026-05-19 - Message push notifications and realtime sync hardening

- Read-only Supabase check confirmed `notifications -> notifications_push_outbox` trigger exists, `messages -> notifications` trigger was missing, and existing message notification rows were absent.
- Added proposal-only migration `.migration-backup/supabase/migrations/20260529_message_notifications_for_push.sql` to create `message` notifications from `messages` inserts, skip sender/system rows, use safe media labels, and include `chat_id/message_id/sender_id` payload for preference-aware push delivery.
- Notification bell and service worker now handle message payloads with `message_id`: clicking opens the chat and requests message jump/highlight. Edge Function safe payload now forwards `messageId`.
- Active chat realtime now keeps direct INSERT merge, plus debounced background reconciliation on sidebar realtime signals without a message id, websocket subscribe/error recovery, browser online, and visibility return. Merges still dedupe by `id`/`client_message_id` and sort by server `created_at`.
- Push settings switches were constrained with grid/min-width/shrink rules so toggles stay inside the settings card on mobile.
- Added `tests/e2e/realtime-messages.spec.ts`; it uses owner/client QA auth, gates DB mutations behind `KUB_QA_ALLOW_MUTATIONS=1`, inserts a safe QA private-chat message, verifies reconnect reconciliation without page refresh, dedupe, and server-created ordering.
- Validation completed: `git diff --check`, `pnpm.cmd --filter @workspace/kub run typecheck`, `cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"`, `pnpm.cmd e2e:smoke`, `pnpm.cmd rls:smoke`, `pnpm.cmd db:types:check`, `pnpm.cmd exec playwright test tests/e2e/pwa.spec.ts`, `pnpm.cmd exec playwright test tests/e2e/push-phone-foundation.spec.ts`, and `pnpm.cmd exec playwright test tests/e2e/realtime-messages.spec.ts` passed. Build still emits existing Vite sourcemap/chunk-size warnings; `db:types:check` still reports the known advisory manual/generated drift.

## 2026-05-19 - Push message notification polish and presence consistency

- Read-only Supabase inspection confirmed the applied 20260529 state: `message` notification rows exist, `notifications -> notifications_push_outbox` exists, and `messages -> notifications` exists. Latest outbox rows still had private-message copy shaped as `sender` title plus `sender: preview` body, message tags included the individual `message_id`, and private chat membership inserts still produced `chat_added`.
- Added proposal-only migration `.migration-backup/supabase/migrations/20260530_push_message_notification_polish.sql`. SQL was not applied automatically. The proposal suppresses `chat_added` for private one-to-one chats, adds `chat_type` to message notification payloads, formats private/group message push copy differently, and uses stable `message:chat:<chat_id>` tags.
- Service worker now keeps message push click routing and uses `renotify: false` for message pushes so repeated messages in the same chat can collapse by tag where the browser/OS supports it.
- Notification bell message copy now mirrors the private/group distinction and keeps legacy fallback for existing rows where `chat_type` is absent but `chat_name` equals `sender_name`.
- Push settings rows were tightened again with contained grid rows, mobile full-width action buttons, `min-w-0`, and fixed switch shrink behavior. `tests/e2e/push-phone-foundation.spec.ts` verifies switch bounds on all five required viewports.
- Presence status now goes through shared `getUserPresenceState` / `isUserOnline` helpers and a single `90s` threshold. ChatHeader, sidebar chat rows, and the mini-profile preview use the same timestamp and local timer source.
- Playwright QA used local dev server `http://127.0.0.1:5173` and saved multi-account auth states. `push-phone-foundation.spec.ts`, `pwa.spec.ts`, `smoke.spec.ts`, and `realtime-messages.spec.ts` passed on 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915.
- Realtime multi-account QA verified owner/client private-chat incoming message reconciliation without refresh, no duplicate after a second reconcile, and ordering by server `created_at`.
- Validation completed: `git diff --check`, `pnpm.cmd --filter @workspace/kub run typecheck`, `cmd /c "set PORT=5173&& set BASE_PATH=/&& pnpm.cmd --filter @workspace/kub run build"`, `pnpm.cmd e2e:smoke`, configured `pnpm.cmd rls:smoke`, `pnpm.cmd db:types:check`, `pnpm.cmd exec playwright test tests/e2e/pwa.spec.ts`, `pnpm.cmd exec playwright test tests/e2e/push-phone-foundation.spec.ts`, and `pnpm.cmd exec playwright test tests/e2e/realtime-messages.spec.ts` passed. Build still emits existing Vite sourcemap/chunk-size warnings; `db:types:check` still reports known advisory drift.

## 2026-07-12 - Web/PWA push reliability and cross-device read presentation

- Production read-only audit confirmed one active Apple Web Push subscription, an every-minute successful dispatcher cron, 0 self-message notification rows out of 88 recent message notifications, and 0 self-message Web Push outbox rows.
- The Apple subscription had not refreshed `last_seen_at` since 2026-06-22. Historical 2026-07-01 delivery contained 5 exhausted HTTP 403 rows and 2 accepted rows. Current web/Edge VAPID public fingerprints match, the private/public keypair validates, and the configured VAPID subject has a valid non-local format.
- Added browser subscription reconciliation on startup, focus, reconnect and `pushsubscriptionchange`, including VAPID-key comparison and server `is_active/last_seen_at` repair.
- Added Declarative Web Push fallback, per-tag hashed Web Push Topic, urgency selection, sanitized Apple reason parsing and permanent `VapidPkHashMismatch` pruning without exposing endpoint or key data.
- Reading a notification now closes its matching same-tag browser card on active clients and updates the installed-app badge. Cross-device DB `read_at` remains server/realtime-backed.
- Multi-account mutation passed: sender exclusion, recipient notification insert and chat-open read-sync. QA fixture messages and notifications were removed afterward.
- Playwright: push/notification/PWA viewport matrix passed 41 tests across 1440x900, 1920x1080, 3840x2160, 390x844 and 412x915; 4 mutation duplicates skipped by design. Realtime messaging passed 3/3 and smoke passed 5/5 with no unexpected console errors.
- Unit contracts passed 32/32; typecheck and production Vite build passed. Existing sourcemap and chunk-size warnings remain advisory.
- A live Apple Web Push probe exposed a dual-consumer race: the legacy API worker failed the same outbox row twice with sanitized `BadJwtToken`, then the minute Edge cron delivered it. The API push loop now defaults off, Edge cron is the single production owner, and the legacy failure logger retains only status/reason without endpoint data. A focused ownership/token-hygiene regression test passes 2/2; API typecheck and build pass.
- Coolify auto-deployed the exact single-owner commit and reported a healthy worker. Runtime logs showed the API and media variants worker starting with no legacy push loop. A post-deploy Apple probe was sent by Edge with zero failed attempts and no error; both QA probes were then deleted and zero QA markers remained.
- Physical iPhone Home Screen background delivery remains required after deploy; Windows Chromium cannot validate Apple OS delivery or Notification Center history.

## 2026-07-12 - Bounded 720p video variants and playback quality

- Added trusted-worker generation of `video_720p` derivatives alongside existing posters. Output is H.264/AAC MP4 with preserved aspect ratio, no upscaling, even dimensions, `yuv420p`, fast-start, two ffmpeg threads and a ten-minute transcode timeout.
- A production-compatible worker-runtime benchmark converted a 10-second 1080p/9 MB sample into an approximately 1 MB 720p derivative in 1.55 seconds. Separate checks passed for audio, landscape, 1080x1920 portrait output and a 640x360 no-upscale input; temporary files were removed after each run.
- New image/video messages persist the selected media quality. Compact and standard video playback prefer a ready 720p derivative, high quality and explicit original-file opening use the retained original, and derivative load failures fall back to the original once.
- Variant refreshes are bounded per chat, coalesce in-flight reloads and paired focus/visibility events, clean up listeners/timers, and perform a single follow-up when variant IDs change during a request.
- Server worker tests passed 8/8. Focused frontend contracts passed 35/35 across the five configured Playwright projects. Real authenticated UI QA of the composer quality selector passed 5/5 at 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915 with no unexpected console errors. KUB and API typechecks/builds passed; the production Vite build retains only the existing advisory sourcemap/chunk warnings.
- Live schema inspection confirmed `video_720p` is already accepted by the applied media-variants schema. No SQL or migration was applied for this stage, and frontend bundles receive no trusted worker credentials.
- The first production rollout exposed a bounded-queue starvation bug: five valid videos ranked 122-127 among current image/video messages, outside the previous newest-120 query. A failing regression test was added first, then the worker was changed to scan bounded pages up to 1,200 rows per tick. API typecheck/build and worker tests passed 9/9 after the fix.
- Coolify webhook deployments `oqlj1qbl89whqgtt4hqvpx05` (web) and `q78f7hbdjcs0yl2328tfqqol` (worker) finished exact commit `4775a1a`; both applications report `running:healthy` and `https://app.letscube.ru` returns HTTP 200.
- Production backfill finished with 26/26 videos that have a valid Storage source. DB and Storage both report 26 derivatives totalling 32,522,253 bytes; zero ready rows violate MP4 MIME, positive size, even dimensions or the 1280x720 bound. Two legacy video rows without a Storage source remain intentionally untouched. Worker failure logs are sanitized to error name/status and expose no object paths.
- Post-deploy authenticated production UI QA of the media quality selector passed 5/5 at 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915.

## 2026-07-12 - Resumable media upload and cross-chat safety

- Added `tus-js-client@4.3.1` for chat attachments larger than 6 MiB. The TUS contract uses exact 6 MiB chunks, bounded retry delays `0/3/5/10/20s`, authenticated Storage metadata, previous-upload recovery in the current staged session, stable object paths and remote partial termination on cancel. Attachments at or below 6 MiB retain the existing Supabase Storage upload path.
- Staged attachments now show determinate upload progress and a separate indeterminate message-send state. Failed uploads remain retryable without generating a new object path. No file blobs are persisted in IndexedDB, so resume after a full browser/app restart remains intentionally out of scope.
- Chat-scoped guards cover asynchronous image preparation, upload completion, message acknowledgement, draft restoration, picker/camera results, geolocation and voice/video recorder completion. Switching chats aborts active uploads and prevents delayed work from appearing or sending in the next chat.
- A recorder regression exposed duplicate React keys because camera and video modals shared the raw chat ID. Their keys are now type-prefixed; the full desktop recorder suite completed with 7 passed and 2 mobile-only skips, including regular video, video-circle and locked voice/video flows without console errors.
- Contract/safety validation passed 110/110 across the five configured Playwright projects. Real authenticated browser QA passed 5/5 at 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915: a 7 MiB file entered TUS, rendered determinate progress, cancelled cleanly and issued termination without sending a message.
- Production Storage smoke uploaded a disposable 7 MiB object through TUS, emitted 11 progress events, downloaded the exact 7,340,032 bytes and removed the object. No token, upload URL or object path was logged. No SQL, schema, RLS or infrastructure change was required.
- Coolify webhook deployments `exe5a6smqbvwpyxj2hxtc0pa` (web) and `ayhm60bc1qvuvwe5vjp1vq9w` (worker, triggered by the shared lockfile) finished exact commit `70de36e`; both applications report `running:healthy`. Authenticated production UI repeated the TUS progress/cancel scenario 5/5 at 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915.

## 2026-07-12 - Windows Electron internal package

- Added an Electron `43.1.0` Windows shell and electron-builder `26.15.3` x64 NSIS package for LETSCUBE. The initial immutable `0.1.0` build `1` exposed a first-context stale-cache race during production QA; `0.1.1` build `2` added shell-level HTTP/Service Worker cache reconciliation. Final internal stable `0.1.2` build `3` additionally restores clipboard/fullscreen and safe external HTTP handoff, and shows a local retry screen when production is unreachable.
- Desktop build dependencies and lockfile are isolated under `desktop/`; normal root workspace/Coolify web and worker installs do not download Electron.
- The shell loads only `https://app.letscube.ru`, uses a persistent isolated session, disables Node integration, enables context isolation/sandbox/web security, rejects cross-origin navigation and exposes only validated version metadata through preload IPC.
- Browser PWA installation, Service Worker registration and Browser Web Push are excluded from the Electron runtime. Native Windows notifications, deep links, public signing and automatic update application remain pending.
- The packaged ASAR contains six expected entries and no application dependencies. Electron fuses disable RunAsNode, Node environment/inspect flags and file-protocol privileges while enabling cookie encryption and ASAR integrity.
- `pnpm.cmd windows:test` passed 10/10. Production Electron QA passed 6/6 across 1440x900, 1920x1080 and 3840x2160, including first-context desktop detection and installed-version state. The x64 NSIS installer built and installed silently for the current user, and the installed executable opened a responsive `LETSCUBE` window. Android sync/debug build remained green. The internal installer is unsigned by design.
- Web typecheck/build, release catalog tests 18/18, five-viewport authenticated smoke 5/5, RLS smoke and advisory DB type drift check completed. Existing Vite sourcemap/chunk warnings and generated-only search RPC/outbox drift remain unchanged.

## 2026-07-12 - Windows Tauri clean-profile replacement

- Retired the Electron source, dependencies, installer offer, installed package and shared QA profile after confirming that Electron Playwright and the installed app reused `%APPDATA%/letscube-desktop`. The old `Owner Test` session was local profile state, not credentials bundled in ASAR.
- Added an isolated Tauri 2 shell under `windows-tauri/`, outside the root pnpm workspace. Rust `1.97.0`, Cargo `1.97.0`, MSVC `14.44.35207` and WebView2 `150.0.4078.65` were verified without changing Java/Android configuration.
- The shell accepts only `https://app.letscube.ru`, uses stable `webview-production-v1` storage, ignores QA profile overrides in release builds, grants only exact-origin notification plugin permissions and exposes no filesystem/shell/process/updater capability.
- A local animated splash, reduced-motion mode, single instance, native tray Open/Exit and close-to-hide are implemented. Runtime detection is synchronous before React startup; version/build retrieval remains the existing async frontend contract.
- Foreground realtime message notifications use the official Tauri notification plugin only while the Windows window is hidden/in tray. Browser Notification, Browser/PWA Push and Android FCM paths remain separate and unchanged. Killed-process Windows push is not claimed.
- Tauri contract tests passed 3/3; Rust tests passed 2/2; frontend Tauri/distribution tests passed 11/11; independent task reviews returned spec PASS and quality APPROVED.
- The final unsigned x64 NSIS installer built successfully at 1,242,693 bytes (1.19 MiB), and the executable remains about 3.14 MiB. Installed WebView2 is reused rather than bundling Chromium.
- Clean install physical QA opened the LETSCUBE login page with no authenticated shell and no `Owner Test` state. Alt+F4 hid the only process; a second launch kept process count at one and restored the single window.
- Final review added safe external handoff for `http`, `https` and `mailto` links through the Rust-owned opener while continuing to deny popup WebViews and `file`/`javascript`/credential-bearing URLs. A readiness atomic keeps second-launch/tray restore on splash until the main page finishes loading.
- Web typecheck/build and release catalog tests passed. Authenticated browser smoke passed 5/5 and PWA regression passed 10/10 across 3840x2160, 1920x1080, 1440x900, 390x844 and 412x915. Android sync/debug build passed.
- RLS smoke completed with existing advisory/leak probes reported separately; no SQL/RLS/schema change was made in this Windows stage. DB type drift remains advisory for the two search RPCs and server-only outbox.
- Coolify webhook deployments `qu9qpxb8d6w1rr04zwgdf20p` (web) and `hjlbhqir375ia6wzmqarhswq` (worker) finished exact commit `8d20b89645b9471b4477a8566a5d23ff5cfc9027`; both rolling updates passed their first healthcheck. Production Playwright opened the LETSCUBE login screen with HTTP 200 and zero console errors.
- Reinstalled the final clean-profile NSIS candidate, confirmed login-only startup, close-to-hide and single-instance restore, then published immutable Windows stable `0.2.0` build `4`. The public artifact is 1,242,693 bytes with SHA-256 `5d44610ef376cf8a66e4fa744cbc3845082dec3bdcc1301acb33354115e8aba1`; a fresh HTTPS download matched both manifest fields. Authenticode, signed updater metadata, killed-process push and the broader Windows 10/11 device matrix remain release gates.

## 2026-07-13 - Repeatable Windows Tauri parity and installer lifecycle QA

- Added an opt-in `LETSCUBE_WEBVIEW2_DEBUG_PORT` to the main WebView only in debug builds. It accepts ports `1024-65535`, binds Playwright to a loopback CDP origin and is compiled out of release behavior; production capabilities remain notification-only.
- Added `pnpm.cmd windows:tauri:qa`. The wrapper refuses to stop an existing LETSCUBE process, builds the current debug shell, allocates a unique temporary WebView2 profile and loopback port, waits for the exact production target, runs one native-shell Playwright project and removes its process tree/profile.
- The physical WebView2 smoke passed against `https://app.letscube.ru`: clean login, synchronous desktop bridge `windows/0.2.0/4`, authenticated sidebar, hydrated chat/composer, attachment actions, media quality selector, Notification Center and Windows-specific notification settings. MediaDevices/getUserMedia, MediaRecorder, geolocation, clipboard and fullscreen APIs were present; Browser PWA install UI was absent; console errors were zero during a controlled pre-login reload and the authenticated flow.
- NSIS lifecycle QA passed with exit code `0` for same-version repair, silent uninstall and reinstall. Uninstall removed the executable and HKCU uninstall record while preserving the user WebView profile; reinstall restored version `0.2.0` and opened the expected login screen.
- Hardware capture/permission allow-deny testing, a true upgrade between different versions, Authenticode/SmartScreen, signed updater application and killed-process notification delivery remain separate gates.

## 2026-07-13 - Windows startup and updater lifecycle QA

- Added bounded debug-only startup fixtures for `success`, `offline`, `catalog_failure`, `normal_update` and `critical_update`. Fixtures replace observed state only; production origin, updater endpoints, signing public key and installer behavior remain untouched. Each fixture starts from Stable so an existing Test-channel preference cannot invalidate the critical-state check.
- The wrapper now runs baseline plus each fixture in a separate temporary WebView2 profile, retains Playwright output under `output/playwright-test/windows-tauri-qa/<scenario>`, and converges signal/finally cleanup on one promise with profile-removal retries.
- Startup/lifecycle WebView2 QA passed for baseline 3/3 and `success`, `offline`, and `catalog_failure` 1/1 each. Startup geometry passed at 1920x1080, 1440x900 and 960x640; screenshots were visually inspected for endpoint/center clearance and offline Retry. The suite verifies one-window exact-origin handoff and fingerprint convergence.
- Native `normal_update` and `critical_update` fixtures expose the real bridge state and then require the authenticated production UI pill/gate. The current remote production frontend does not contain those controls, so the strict physical assertions fail until that frontend is deployed; this is not recorded as a successful pill/gate check. The Test-to-Stable reversal is covered by the controlled local frontend bridge contract, including the exact `set:test`, `check`, `set:stable`, `check` call sequence and final bridge state.
- `pnpm.cmd windows:tauri:test` passed 10/10 after the lifecycle review hardening. The native pill/gate deployment dependency remains an open physical QA gate.
- The final release EXE scan found zero startup QA env/mode strings, WebView2 debug/CDP markers, service-role secret names and PEM private-key markers. A broader text scan also saw the legitimate production `critical_update_required` state and generic crypto-library wording, neither of which is fixture or key material.

## 2026-07-13 - Signed Windows 0.2.1 physical upgrade and stable promotion

- Built LETSCUBE Tauri `0.2.1` build `5` as a signed NSIS updater artifact. The immutable installer is 2,324,540 bytes with SHA-256 `157aa2bbb7688ce309177d58f2dd1cbe5a4e76aa49f8c1313dd8ddc6c73299d3`; its Tauri signature is present and the hardened publisher verifies it with `minisign` before changing a manifest.
- The pre-updater public `0.2.0` used an older updater trust root for which no valid release signing identity remained. It therefore cannot accept `0.2.1` over the air. A local-only, ignored `0.2.0` build with the current public trust root was installed as a one-time rehearsal baseline; it was not committed or published. Existing users of the old test build need one manual reinstall to enter the new trust chain.
- A real installed `0.2.0/4` client opted into Test, discovered `0.2.1`, downloaded the public HTTPS artifact, accepted its signature and completed the NSIS update. A second run established a client QA session before update and verified after relaunch that runtime reported `0.2.1/5`, `kub-auth` remained present, the authenticated app shell was visible and a profile marker retained the same SHA-256.
- Installed-client lifecycle checks passed: a second launch exited with code 0 while process count stayed one; closing the window kept the process alive in the tray; launching again restored one responsive LETSCUBE window. The rehearsal channel was reset from Test to Stable, and the installed `0.2.1` client then returned updater phase `current` with the authenticated session still present.
- The former permanent Stable/current check icon was removed. A real installed-version change now shows a compact `Обновление установлено` status for 4.2 seconds, fades out and does not return on later launches of the same version. Targeted authenticated Playwright passed and the 1440x900 screenshot confirmed a bounded top-right status with no header or composer overlap.
- The same immutable artifact was promoted without rebuilding. Stable and Test updater manifests match on version, URL, size and SHA-256 and both contain a signature. The public updater/download endpoints return HTTP 200 with immutable artifact caching. The Windows download catalog also publishes `0.2.1` build `5`, so fresh installs and OTA clients use the same installer bytes.
- Release catalog deployment `uvtyn0rcnq7vfi49ir14z571` and web deployment `nf6d0ykn8nnp5cpp0sbgfdf4` completed the exact runtime commit `3fcea10c0d6147e60ec55aaafac9b655a39fea0d`. The later commit `337b2f85c89022307c690679ff0d7fdf8c9a42e9` changes only native lifecycle QA metadata expectations.
- Authenticode/SmartScreen reputation, killed-process Windows push and the broader Windows 10/11 hardware matrix remain separate external release gates. No SQL/schema/RLS change was made for this stage, and updater private material remains under ignored local storage only.

## 2026-07-13 - Windows 0.2.2 startup handoff and transient success status

- The visible jump came from two sequential scenes in one WebView: the local startup page used explicit client/server grid columns and a 190px state footer, while the production handoff overlay let the server auto-flow into the middle column, used a 130px footer and removed itself after only the 320ms fade. The handoff now pins endpoints to columns 1/3, embeds the same official LETSCUBE logo, reuses matching device geometry and keeps the four-stage footer throughout navigation.
- Real network, TLS/origin and updater checks remain unpadded. After the production page has loaded, its already-mounted overlay stays visible for at least 2.2 seconds and keeps the confirmed state for at least 0.9 seconds before the 320ms fade. Reduced-motion mode keeps a 1ms fade but preserves the readable hold.
- The Stable/current check control no longer occupies future call-control space permanently. A detected installed-version change displays `Обновление установлено` for 4.2 seconds, then unmounts; reopening the same version does not recreate it.
- Full native WebView2 QA passed: baseline `3/3`, then `1/1` for success, offline/retry, catalog failure, normal update and critical update. Geometry assertions cover endpoint symmetry and the connected-state hold. Contract tests passed `12/12`, Rust passed `25/25`, and release-catalog tests passed `27/27`.
- Signed LETSCUBE `0.2.2` build `6` is 2,327,965 bytes with SHA-256 `a20de9643869f99d0e2638815c6eec4ab41b176021692732c5fd5f8df90fc75e`. The publisher cryptographically verified the signature before Test publication. An installed authenticated `0.2.1/5` client discovered `0.2.2`, completed the updater install, relaunched as `0.2.2/6`, retained `kub-auth`, returned to Stable/current and showed then removed the transient success status.
- The exact Test artifact was promoted without rebuilding. Stable/Test updater manifests match on version, URL, size, SHA-256 and signature presence; the fresh-install Stable catalog uses the same bytes. Both public artifacts return HTTP 200. Web deployment `e3h1h6pl55f77mri39jfjv4m` completed exact commit `1f389e0baf456b9af48618fa19ec8d0a746adb34` healthy.
- Typecheck and production web build passed. Existing Vite sourcemap/dynamic-import/chunk-size warnings and Cargo PDB/linker warnings remain advisory. No SQL/schema/RLS change was made, and signing material remained ignored and outside Git.

## 2026-07-13 - Windows 0.2.3 fixed connection ports

- The remaining rail overlap came from percentage insets tied to endpoint centers rather than the real computer/server bounds. The server body is solid and narrower than the monitor, so the right rail entered its chassis. A second intermittent shift came from auto-sized title/subtitle line boxes changing the vertically centered endpoint stack when the production document loaded its font metrics.
- Both local and injected startup scenes now use explicit client/server connection ports, device-edge rail bounds, a center seal pinned to exactly 50%, and fixed endpoint grid rows/line heights. Only inner rail fill and colors change by stage; device, port and seal layout properties do not animate.
- Native WebView2 QA compared the computer, server, both ports and center seal before navigation, in the production overlay and after `complete`; every bounding box stayed identical. At 960x640, 1440x900, 1920x1080 and 3840x2160, both port gaps were 0 px, both body clearances were 18 px, the seal center offset was 0 px and horizontal overflow was 0 px.
- Full Windows lifecycle QA passed baseline `3/3` plus `1/1` for success, offline, catalog failure, normal update and critical update. Tauri contracts passed `12/12`, Rust passed `25/25`, release catalog passed `27/27`, and web typecheck/production build passed with only the existing advisory sourcemap/chunk and Cargo linker/PDB warnings.
- Signed LETSCUBE `0.2.3` build `7` is 2,328,922 bytes with SHA-256 `7e3ab643bfa0b589e2b4a853cf163e819c69459b267ee218ce2c97206c249a58`. The hardened publisher verified its signature, an installed authenticated `0.2.2` client completed the real Test-channel OTA and relaunched as `0.2.3/7` with `kub-auth` retained, then returned to Stable/current.
- Stable/Test updater manifests and the fresh-install Stable catalog use the same immutable bytes and signature. The public download was fetched again and matched the expected size/SHA. No SQL/schema/RLS change was made; signing material remained local-only and ignored.

## 2026-07-13 - Windows tray notification reconciliation candidate

- Native Windows notification ownership moved from the currently open-chat hook to the global Notification Center Realtime stream. This covers messages from every chat plus task/system rows while the Tauri process remains alive in the tray; Browser/PWA Push and Android FCM paths are unchanged.
- Message rows now map to one stable positive Windows notification id/group per chat, while tasks and system events use separate semantic groups. Raw media URLs are replaced with a safe attachment label and notification bodies are bounded.
- The first fetched unread page establishes a silent baseline. Later Realtime inserts and reconnect/online refetches present only newly observed rows, so a network interruption does not lose tray delivery and an app restart does not replay the historical unread backlog.
- Notification actions accept only relative same-app routes, call the exact-origin `desktop_show_main` bridge to show/unminimize/focus the existing window, then reuse the authenticated Android/desktop pending-route queue. The Tauri capability adds only the notification action listener and this generated command permission.
- Tauri `0.2.4` build `8` signed NSIS candidate built successfully at 2,329,436 bytes with SHA-256 `dbb1d22e2a05bbcb41b8a2b2dcb7fd267b57a744ec11bb7c4c452517daa803e0`. Updater signing material remained ignored/local-only and was loaded only into the build process environment.
- Contract tests passed 22/22, Rust passed 25/25, typecheck and production web build passed, and full native WebView2 lifecycle QA passed baseline 3/3 plus success/offline/catalog-failure/normal-update/critical-update 1/1 each. Role auth states were regenerated locally; Notification Center category/grouping checks passed on all five viewports and the dedicated read-sync fixture passed (`6 passed`, `4` duplicate mutation cases skipped by the spec). General smoke remained `5 skipped` because its separate `default` QA account is not configured. RLS smoke passed and DB type drift retained only the existing advisory search-RPC/server-outbox notes.
- Coolify deployment `d10dqxllayooif96npfbl4dq` completed exact commit `0bbfca210ebf6afbfc61ee17005c5fa9aedc5e78`; the first healthcheck passed and the rolling update finished. Authenticated production Notification Center QA then passed category/grouping layout on 1440x900, 1920x1080, 3840x2160, 390x844 and 412x915. The production-safe mutation fixture passed sender exclusion and grouped-card read-sync without importing Vite source modules (`6 passed`, `4` expected duplicate mutation skips).
- The signed 2,329,436-byte `0.2.4/8` installer was published to the opt-in Test updater channel. Its public manifest contains the signature, exact SHA-256 `dbb1d22e2a05bbcb41b8a2b2dcb7fd267b57a744ec11bb7c4c452517daa803e0`, matching size and an immutable HTTPS artifact returning HTTP 200. Stable remains `0.2.3/7`; no promotion occurred because the physical hidden-window message/task/action and reconnect pass is still pending.
- True delivery after the Windows process is fully terminated is not claimed. It requires a separate WNS/device-token/backend delivery model, plus Authenticode/SmartScreen work and a broader Windows 10/11 device matrix.

## 2026-07-13 - Windows native toast bridge follow-up

- Installed `0.2.4/8` and local `0.2.5/9` physical QA confirmed that close-to-hide leaves `letscube-windows-tauri.exe` alive and that hidden-client Realtime updates the sidebar immediately. Windows Notification Center still received no LETSCUBE row.
- Root cause was two-layered: WebView2 remains DOM-visible after the native main window is hidden, and the desktop implementation of `@tauri-apps/plugin-notification` ignores id/group/extra data and spawns a toast call whose error is discarded. The plugin path therefore could not provide verifiable replacement or action semantics.
- `0.2.6/10` uses exact-origin Rust commands for real native foreground state and Windows toast delivery. Foreground requires a visible, focused, non-minimized window. The native command validates bounded title/body, a known message/task/system group and a relative production-app route, checks Windows notification policy, XML-escapes untrusted preview text and sets a stable eight-character tag plus semantic group. A clicked route remains pending in Rust until the frontend listener consumes it, and read-sync removes the matching native history row.
- A direct WinRT physical probe registered handler `ru.letscube.messenger` and stored one `toast` row with the expected `codexqa1/system` tag/group without reading or printing its payload. Frontend and Tauri contract tests passed 24/24, Rust passed 28/28, and the full native lifecycle matrix passed baseline 3/3 plus all five startup/update scenarios 1/1. The final signed 2,300,940-byte installer has SHA-256 `9bf7353636cd279a7f80a25df323d9a65577590cc11d593e23b0b406e4b38d25`.
- Coolify deployment `w85ts4luj9w561qaphsu2jm3` completed exact commit `b66584808ae50e288d9f93e111856f8f60bb9e5b`; the first healthcheck passed and the rolling update finished. Authenticated production Notification Center QA then passed `2/2` on the 1440x900 desktop project.
- The signed `0.2.6/10` client was installed with its existing QA session retained, hidden to the tray, and exercised against real owner/client rows. Two same-chat message notifications produced one active Windows `messages` toast. Marking both rows read through the authenticated RPC removed that toast. A separately assigned task produced one Windows `tasks` toast from a zero baseline, and marking its notification read returned the task history count to zero. Test tasks were soft-deleted and QA notification rows were marked read; no notification payload, message content or token was printed.
- The current release publisher was installed on the release host after its SHA-256 and updater public-key identity were verified. The signed 2,300,940-byte artifact replaced `0.2.4/8` in the opt-in Test updater channel. Public and server-side Test manifests report `0.2.6`, contain a signature and reference an immutable artifact whose SHA-256 is `9bf7353636cd279a7f80a25df323d9a65577590cc11d593e23b0b406e4b38d25`; a fresh HTTPS download matched both size and hash. Stable remains `0.2.3/7`.
- Notification-card action activation remains pending because it was not safe to automate through the active Windows desktop session. Stable promotion therefore did not occur. Killed-process delivery remains a separate WNS/device-token/backend stage.

## 2026-07-14 - Windows 0.2.7 grouped message actions

- LETSCUBE `0.2.7/11` assigns every message card a unique native tag while using one stable Toast Header/group per chat. Windows history retains no more than the five newest unread cards for that chat; different chats and task/system notifications remain isolated.
- Physical QA confirmed that both a fresh popup and an older card in Windows Notification Center restore the existing LETSCUBE window and open the exact referenced chat/message. A card from another chat remains independently actionable.
- Opening and reading one chat removes only that chat's message cards from Windows history. Cards belonging to other senders/chats remain available.
- Sender duplication was removed: the sender/chat name is rendered once by the native Toast Header, while each child card contains only its message preview. Physical follow-up confirmed the resulting hierarchy and routing.
- Rust notification/protocol tests passed `32/32`; desktop/Tauri notification contracts passed `26/26`; web typecheck passed. The updater-signed installer is 2,318,468 bytes with SHA-256 `408c238d0eae67471c6fb9b8ae95a1c9bb54640912883d86d7ae390a414d65e1`. Signing material remains local-only and ignored.
- True notification delivery after the Windows process is fully terminated still requires a separate WNS device-token/backend design. Authenticode/SmartScreen reputation and a broader Windows 10/11 hardware matrix also remain open.

## 2026-07-23 - Windows 0.2.7 Test-to-Stable promotion

- The exact physically tested artifact was published to Test, verified publicly, and then promoted unchanged to Stable. Test and Stable updater manifests share the same signed immutable URL and SHA-256; the Stable fresh-install catalog reports `0.2.7` build `11`. Fresh updater and download requests both returned 2,318,468 bytes with SHA-256 `408c238d0eae67471c6fb9b8ae95a1c9bb54640912883d86d7ae390a414d65e1`. Manifests use `no-cache, no-store`, while the versioned artifact uses immutable one-year caching.

## 2026-07-23 - Windows external release-gate foundation

- Added a dedicated fail-closed Authenticode production path. It supports
  Microsoft Artifact Signing or a valid current-user code-signing certificate,
  verifies the final NSIS installer independently and does not alter the
  unsigned internal QA path. Preflight stopped as designed because no signing
  provider/account or certificate is configured.
- Split internal NSIS packaging from updater publication. The internal config
  no longer requires the Tauri updater private key and produced
  a 2,319,055-byte `LETSCUBE_0.2.7_x64-setup.exe`; the local matrix reports
  `NotSigned`, so this artifact is not a public release candidate.
- Added provider-aware WNS backend delivery with Microsoft OAuth, strict
  `*.notify.windows.com` SSRF protection, bounded/escaped toast XML, exact
  message routes and permanent channel cleanup. FCM and Browser Web Push
  regression tests passed. No Windows device schema or SQL was added/applied.
- Added an isolated Tauri long-session/offline runner and sanitized Windows
  capability report. The local environment is Windows 11 Pro build `26200`
  x64 with WebView2 `150.0.4078.83`. The native 60-second soak was correctly
  blocked because a user-owned LETSCUBE process was running; the runner did not
  terminate or reuse it. Browser long-session and authenticated smoke were
  skipped because their QA auth state was unavailable in this shell.
- Windows/Tauri contracts passed `12/12`, Rust passed `32/32`, release-security,
  WNS and long-session contract tests passed, Deno checked the complete Edge
  Function successfully, web typecheck/build passed, and the internal NSIS
  build passed. Existing Vite sourcemap/chunk-size and Cargo linker/PDB warnings
  remain advisory. DB type drift retains the known missing manual search RPC
  declarations. RLS smoke completed with the existing broad-list diagnostic
  rows still visible for dedicated security follow-up.
- Windows 10 22H2, alternate WebView2, a real signing identity/SmartScreen
  reputation, package identity/PFN onboarding, WNS device registration and
  physical killed-process delivery remain external gates.

## 2026-07-24 - Windows sparse identity preflight

- Added a fail-closed Windows sparse-package identity renderer. It validates
  the production package name, publisher, application ID, four-part version
  and Entra remote GUID without printing those values.
- The generated `AppxManifest.xml` and executable side-by-side manifest use
  the same package/publisher/application identifiers. A public-only WNS client
  config is generated beside them; no client secret or channel URI is stored.
- The preflight locates the newest installed Windows SDK outside `PATH`,
  requires Windows build 19041 or newer and checks for Windows App Runtime.
  This host has Windows SDK `10.0.26100.0` and Windows App Runtime packages.
- A disposable test identity produced a 1,756-byte unsigned package through
  `MakeAppx`. The package contains only sparse identity metadata and its
  generated block map; executable metadata and WNS client configuration stay
  outside it. All output remains under ignored `.local` storage and is
  explicitly not deployable or publishable.
- Package identity contract tests passed `4/4`, including missing-config
  fail-closed behavior, aligned manifest rendering and package-content
  isolation. The normal internal NSIS build remains independent of package
  identity.
- The native long-session runner connected to its isolated WebView2 instance
  but did not reach the authenticated sidebar after the configured QA login.
  The offline/reconnect cycle therefore did not run and is not counted as a
  pass. The local trace remains ignored; login was not retried to avoid
  anti-abuse side effects.
- Real Microsoft identity/publisher/PFN/Entra mapping, package signing, NSIS
  registration hooks, Windows App SDK channel/COM activation and
  killed-process physical QA remain blocked by external onboarding. No SQL,
  schema or WNS client registration was applied.

## 2026-07-27 - Privacy and support foundation

- Published public `/privacy` and `/support` routes before the authenticated
  application gate. The support form requires contact data, category, subject,
  message, privacy acceptance and Yandex SmartCaptcha, then opens the guest
  chat immediately without an email-link round trip.
- Guest session secrets remain raw only in IndexedDB. The deployed
  `support-gateway` stores an HMAC digest, validates allowed origin and CAPTCHA,
  applies persistent and in-process rate limits and returns bounded projections
  without raw provider errors.
- Created a verified pre-migration dump at
  `/srv/letscube/backups/pre-migrations/20260727-100210-before-support-ticketing.dump`.
  The migration passed an isolated restore rehearsal, transactional production
  apply and synthetic guest RPC smoke. Production reports 11 support/privacy
  tables with RLS enabled and no anonymous direct table privileges.
- Production multi-role RLS smoke passed: requester ownership, unrelated-user
  isolation, masked contact data before claim, full contact visibility after
  assignment, denied requester transitions, one-winner atomic claim race and
  operator-only lifecycle history. Its temporary least-privilege QA role and
  synthetic tickets were removed; follow-up counts were both zero.
- Support Notification Center routing uses only validated ticket UUIDs and
  bounded Russian copy. Email, phone, request text and untrusted payload routes
  are excluded from in-app and Windows native cards. Unit/adapter tests passed
  20/20, and web typecheck passed at this checkpoint.
- Added the permission-gated `/admin/support` operator workspace with bounded
  pool/mine/urgent/waiting/resolved/spam queues, atomic workflow actions,
  assigned conversation, masked/full contact boundary, audited customer lookup,
  immutable event history, intake limits and per-operator notification
  preferences.
- Applied the additive delivery-hardening migration after a verified
  `/srv/letscube/backups/pre-migrations/20260727-105107-before-support-delivery-hardening.dump`
  checkpoint and successful transactional rollback rehearsal. Transfer targets
  now come only from eligible support operators, message and ticket limits are
  edited together, transfer preferences are enforced, and disabling support
  OS push does not remove the in-app notification.
- Production support RLS smoke passed again after the forward migration; the
  temporary QA role and synthetic tickets were removed. Public privacy/support
  Playwright passed 15/15 and operator workspace Playwright passed 15/15 across
  3840x2160, 1920x1080, 1440x900, 390x844 and 412x915.
- Final local regression checkpoint: support/privacy/unit contracts passed
  38/38, support gateway security tests passed 7/7, authenticated smoke passed
  5/5, Notification Center layout/grouping passed 5/5, and PWA passed 10/10.
  Five cross-account notification read-sync cases were skipped because that
  spec did not resolve a second receiver auth pair in this run; the dedicated
  production support RLS smoke still passed.
- KUB typecheck and production Vite build passed. The existing Vite sourcemap,
  mixed dynamic/static import and large-chunk warnings remain advisory.
  `db:types:check` passed with the known generated-only outbox/session tables
  and missing manual typings for `global_search_v2` and
  `search_chat_messages`. General RLS smoke passed with its pre-existing fake-ID
  mutation skips and broad-storage visibility diagnostics reported separately.
- Pushed `main` and completed Coolify deployment
  `fm5kg13xryald1w97djq233m` for exact commit `a4f6978`. Production
  `https://app.letscube.ru` then passed public privacy/support 6/6 and operator
  authorization/workspace 6/6 on desktop 1440x900 and mobile 390x844.
- Self-hosted Kong currently emits a shared wildcard CORS response header, but
  `support-gateway` independently rejects an unapproved request Origin before
  data access. Broad Kong reconfiguration is deferred until all Edge Functions
  can be regression-tested together.
- Mailcow integration for `support@app.letscube.ru`, support attachments and
  malware scanning, automated retention/anonymization and final legal review
  remain release gates.

## 2026-07-28 - Support mail bridge foundation

- Provisioned Mailcow domain `app.letscube.ru`, mailbox
  `support@app.letscube.ru` and privacy/postmaster/DMARC aliases. Mailbox and
  SMTP authentication passed without exposing credentials or sending a
  production message.
- Added a separate non-public IMAP/SMTP worker runtime with fail-closed
  configuration, bounded parsing, auto-reply quarantine, deterministic
  Message-ID, opaque reply routes, lease/retry handling and sanitized logs.
  Disabled runtime health/readiness returned HTTP 200 and opened no mail
  connection.
- Created and verified the pre-migration custom dump at
  `/srv/letscube/backups/pre-migrations/20260728-before-support-mail-bridge.dump`.
  A second 3,029,132-byte checkpoint was created before intake/delivery
  hardening at
  `/srv/letscube/backups/pre-migrations/20260728-before-support-mail-intake-hardening.dump`.
  `pg_restore -l` passed for the checkpoints.
- Restored the production schema into an isolated database. The migration
  parsed successfully there. A transactional enqueue/claim/inbound-reply test
  found and fixed the partial-index `ON CONFLICT` predicate before production.
- Applied the bridge, intake guard, delivery hardening and idempotent
  acknowledgement migrations from `20260728082213` through `20260728093755`.
  A synthetic end-to-end database scenario covered grants, open/closed intake,
  reply ownership, closed/spam quarantine, persistent limits, final-attempt
  sweep, idempotent acknowledgement and retention inside
  `BEGIN ... ROLLBACK`; follow-up production counts remained zero.
- Support mail rules/schema/packaging contracts passed 18/18. API server
  typecheck and build passed, including the separate worker bundle.
- Support gateway/schema/RLS/operator security contracts passed 45/45. KUB
  typecheck and production Vite build passed with the existing sourcemap,
  dynamic-import and chunk-size warnings.
- Production dependency audit still reports broader workspace advisories, but
  reports zero findings on the support-mail
  `imapflow@1.5.0`/`mailparser@3.9.13`/`nodemailer@9.0.3` dependency paths.
- Runtime hardening uses strict TLS, a trusted local Mailcow
  `Authentication-Results`, IMAP `UIDVALIDITY:UID` dedupe, per-message poison
  isolation, one-row/300-second leases, SMTP 4xx/5xx classification,
  idempotent post-SMTP acknowledgement, readiness reset and a non-root,
  read-only Compose boundary.
- The production Docker target built from a clean context. `.dockerignore`
  now excludes generated Rust/Tauri `target` and local QA outputs instead of
  transferring roughly 23 GiB of unrelated build artifacts. The disabled
  container ran as `node` with read-only filesystem, dropped capabilities and
  successful `/healthz` and `/readyz` responses without opening IMAP/SMTP.
- Deployed the non-public Coolify resource `letscube-support-mail` from exact
  commit `a149ff9` using the root Git-backed Compose file. The resource has no
  FQDN or host port bindings and is `running:healthy` with
  `SUPPORT_MAIL_ENABLED=0`. Runtime inspection confirmed UID 1000, read-only
  root filesystem, `cap_drop=ALL`, `NoNewPrivs=1` and both health endpoints
  reporting `enabled=false`.
- `db:types:check` passed with the known advisory drift for
  `global_search_v2` and `search_chat_messages`. `rls:smoke` completed with the
  existing fake-ID mutation skips and broad-storage diagnostics. Authenticated
  Playwright smoke was skipped because reusable auth states were unavailable.
- DNS remained the activation gate at this checkpoint: MX, SPF and DMARC for
  `app.letscube.ru` were absent, so `SUPPORT_MAIL_ENABLED` remained `0`.
  Exact records are stored at
  `/srv/letscube/ops/support-mail-dns-records.md`.
- The corporate email from the ООО «КУБ» company card is business-only and is
  intentionally not used as the support mailbox. The privacy policy retains
  the current legal address at Димитрова, 51/3, office 3.

## 2026-07-29 - Support mail production activation

- Verified MX, SPF, DKIM and DMARC for `app.letscube.ru` against both REG.RU
  authoritative nameservers plus Google and Cloudflare public resolvers.
- Created the full pre-enable backup
  `/srv/letscube/backups/automated/20260729-134340`. Database dumps, Storage,
  Mailcow volumes and configuration archives were written; `SHA256SUMS` and
  the required database dump files passed verification.
- Confirmed an empty mail ledger/open-ticket baseline, one active support
  mailbox and three active support aliases before enabling delivery.
- Enabled only the production `letscube-support-mail` environment. Coolify
  deployment `t62rj4zw12jp7jgomlfru4va` finished, the container became healthy,
  and `/healthz` plus `/readyz` returned `enabled=true`.
- Rechecked the runtime boundary after deployment: non-root Node user,
  read-only root filesystem, `cap_drop=ALL` and `no-new-privileges`.
- Created one explicitly labelled QA support ticket and operator reply. The
  real trigger/outbox/worker path reached `sent` in one attempt with no stored
  error. Mailcow delivered it to Gmail MX over the normal outbound path, Gmail
  returned `250 2.0.0 OK`, and the local mail queue was empty.
- External receipt confirmation and the inbound reply/IMAP routing check are
  pending user confirmation. No production customer content was inspected.
- The recipient confirmed external receipt. Their first reply reached the
  opaque route but was quarantined as `sender_mismatch` because the manually
  seeded QA contact used plain SHA-256 instead of the production email HMAC.
  The production gateway path was not affected; the QA contact hash was
  corrected using the server-side key without exposing it.
- Processing that reply revealed a real ImapFlow deadlock: the worker attempted
  `messageFlagsAdd` inside an active fetch iterator, timed out after 60 seconds
  and restarted. Delivery was fail-safe because the email remained unseen and
  the database ledger deduplicated repeated intake.
- The worker was disabled before repair and stayed healthy with zero restarts.
  A failing behavioral test reproduced the nested-command ordering. Commit
  `8c1f5fa` added an error observer and moved `\Seen` updates after fetch
  completion; 69 support/privacy/security tests, API typecheck and build passed.
- The repaired production worker stayed healthy, ready and restart-free for
  more than two previous timeout intervals. The original reply remained one
  quarantined ledger row and was marked seen without duplication.
- The second physical reply passed the corrected sender HMAC, resolved the
  existing opaque route and was accepted into the same ticket. Production
  metadata showed exactly one received inbound ledger row, one requester email
  message and one requester event; a later poll did not increase any count.
  The original `sender_mismatch` quarantine row remained as an immutable audit
  record, the route `last_used_at` advanced, and Mailcow reported zero unseen
  support messages.
- Live Playwright QA with the saved owner auth state opened the production
  support workspace. The two-message conversation rendered the new reply with
  zero console errors and zero failed requests. The manually seeded ticket had
  no assigned operator, so the assignment-scoped notification trigger
  correctly produced no personal `support_requester_message` row for this
  synthetic case.
- After the second reply the worker remained enabled, ready and healthy with
  zero restarts and no recent socket-timeout, unhandled-error or ingestion
  failure logs. Bidirectional SMTP/IMAP delivery is accepted.
- Added the previously missing repository push webhook for
  `letscube-support-mail`; the GitHub ping completed with HTTP 200 and auto
  deploy is enabled on the Coolify resource. A later matching source push still
  needs to prove automatic deployment with `is_webhook=true`.

## 2026-08-01 - Direct-email support notification fanout

- A production audit found that `_support_email_ingest_inbound_core` created a
  ticket and requester message but no `ticket_created` event. The notification
  trigger also skipped requester messages for unassigned tickets. Therefore a
  new direct-email ticket, and later replies before claim, could notify no
  operator.
- A failing transactional smoke reproduced the gap on the live schema with
  `email_ticket_created_event_count:0`; the transaction rolled back and left no
  QA rows.
- Created and verified the custom-format pre-migration dump at
  `/srv/letscube/backups/pre-migrations/20260801-101035-before-support-email-pool-notifications.dump`.
  `pg_restore --list` passed and a SHA-256 sidecar was stored with root-only
  permissions.
- Applied
  `.migration-backup/supabase/migrations/20260801100856_support_email_pool_notifications.sql`.
  Direct-email inserts now append one PII-free `ticket_created` event. Eligible
  pool operators receive one creation notification, the first requester body
  is deduplicated, and later requester replies notify the pool while the ticket
  remains unassigned. Assigned-ticket behavior is unchanged.
- The post-apply production DB smoke passed inside `BEGIN ... ROLLBACK`. The
  internal trigger helper exists, its trigger is enabled, and `anon`,
  `authenticated` and `service_role` have no direct execute privilege.
- The support-mail worker remained healthy with zero restarts and no recent
  timeout, unhandled or ingestion failure logs. A `support -> support` SMTP
  message was intentionally not used as an external-delivery substitute: it
  follows local mailbox semantics and would leave avoidable production QA
  data. The already completed Gmail/Mailcow physical SMTP/IMAP test remains the
  delivery proof; this stage validates the corrected DB notification contract.
- This stage did not change support-mail worker source or matching watch paths,
  so no artificial webhook deployment was triggered. The next genuine worker
  source change remains the auto-deploy proof point.

## 2026-08-01 - Windows identity and WNS gate re-audit

- The local release host has `MakeAppx.exe`, `SignTool.exe`, 19 installed
  Windows App Runtime packages and Windows build 26200. Tooling is not the
  current blocker.
- WNS delivery, device-schema, sparse identity and Tauri shell contracts passed
  24/24. The live self-hosted schema has the existing native device/outbox
  tables and registration RPCs, no registered native-device rows, and still
  permits only Android/FCM plus the reserved iOS/APNS pair.
- Rehearsed `20260724_windows_wns_push_devices.sql` against the live production
  schema inside one transaction. Constraints, RPC replacements and native
  enqueue function compiled, postconditions passed, and the transaction ended
  with `ROLLBACK`; production schema was not changed.
- Strengthened the package identity preflight through a RED/GREEN contract.
  It now reports all missing Microsoft metadata in one run, requires the exact
  Partner Center Package Family Name and places that public PFN in
  `wns-client-config.json` for future runtime identity comparison.
- The real preflight remains correctly fail-closed because Package Name,
  Publisher, Publisher Display Name, Application ID, PFN, four-part package
  version and Entra WNS Remote ID have not been provided. No Publisher/PFN
  mapping, production package identity, signing configuration, WNS server
  secret or database proposal was applied.

## 2026-08-01 - Privacy-safe verified-phone search

- Audited the current search model and live self-hosted schema without exposing
  profile contacts or message bodies. Existing message search uses bounded
  `global_search_v2` / `search_chat_messages` RPCs plus trigram and active-chat
  indexes. On the current largest 236-message chat, 20 in-chat search runs
  averaged 33.221 ms; 20 global searches over 816 RLS-visible active messages
  averaged 90.244 ms. No search-function rewrite was justified by this data.
- Added `search_profiles_by_phone(text, integer)` as a narrow, stable
  `SECURITY DEFINER` RPC because the frontend must not receive direct contact
  table access. The function checks `auth.uid()`, ban state and `users.view`,
  accepts only an explicit complete `+E.164`, matches only `phone_verified=true`
  rows, limits output to 10 profiles and never returns a phone value.
- Revoked execute from `PUBLIC`, `anon`, `authenticated` and `service_role`,
  then granted only `authenticated`; live verification returned
  `security_definer=true`, `authenticated=true`, `anon=false` and
  `service_role=false`. The in-function permission check remains mandatory.
- Rehearsed the migration and authorization smoke together in one production
  transaction with rollback. Created and validated backup
  `/srv/letscube/backups/pre-migrations/20260801-113105-before-privacy-safe-phone-search.dump`,
  applied `20260801112259_privacy_safe_phone_search.sql`, then passed the same
  smoke again inside `BEGIN ... ROLLBACK`. It covers exact authorized lookup,
  partial/no-country rejection, unauthorized empty results and grants.
- The frontend normalizes formatted international input, invokes only the new
  RPC, merges the profile with existing search results and never queries
  `profile_contacts`. Search hints now explain the permission-aware full-number
  behavior. Manual/generated app RPC typings now cover both existing search
  RPCs and the new phone RPC, removing the old search-function drift warnings.
- Production currently contains zero non-null verified phone contacts. This is
  expected while real SMS OTP is not configured: no phone result is fabricated.
- Contract tests passed 3/3. KUB typecheck and production build passed. The
  build retains the existing sourcemap and large-chunk warnings. Initial local
  Playwright login failed because the ignored `.env.local` pointed Supabase at
  Vite itself; only public Supabase browser settings were refreshed from the
  protected server env without printing values, then all five role auth states
  regenerated successfully.
- Real Playwright QA passed 5/5 at 3840x2160, 1920x1080, 1440x900, 390x844 and
  412x915. It verifies formatted-number normalization before RPC, a rendered
  profile result without the raw number, existing username/filter behavior,
  no ErrorBoundary and no unexpected console errors. A later repeat hit the
  existing long-bootstrap recovery screen once at 390x844; the isolated
  390x844 rerun passed in 9.9 seconds without a code or environment change.
- Final validation passed `git diff --check`, the 3/3 phone-search contract,
  KUB typecheck/build, 5/5 authenticated smoke, anonymous REST RLS probe,
  authenticated multi-role RLS smoke and the database type-drift check. The
  build retains existing sourcemap/large-chunk warnings; RLS smoke retains its
  existing informational broad-storage rows for privileged/fixture clients.
- Coolify webhook deployment `o5kpnw78lx42yefr3qxnkhvj` finished exact commit
  `d53e7f26b55782eef9c287d66b48aa88a6fde759` with `is_webhook=true` and the
  application remained `running:healthy`. Production HTML and its referenced
  JS asset returned HTTP 200 and the bundle contains the new phone-search RPC.
  Production Playwright passed all three desktop projects in one run. The two
  mobile projects hit the existing long-bootstrap recovery screen only in the
  sequential matrix; isolated 390x844 and 412x915 production reruns both
  passed in 8.3-8.4 seconds.

## 2026-08-10 - Neutral terminology, disabled SMS.RU foundation and support chat hardening

- Replaced visible computer-club/cyber-arena wording in current application
  surfaces with neutral LETSCUBE, organization and location terminology.
  Legal references to ООО «КУБ» remain intentionally visible in the privacy
  policy and public legal footer.
- Added a provider-disabled SMS.RU source foundation. The OTP template is 46
  characters with a hard 65-character guard. The adapter uses POST form data,
  verifies the Supabase Standard Webhooks signature before authorization, and
  cannot contact SMS.RU unless the trusted runtime explicitly enables delivery.
- The proposal re-checks concurrent webhook IDs after claim locking and caps
  authorized attempts across replacement claims at 5 per user/hour, 10 per
  user/24 hours and 5 per target-phone HMAC/hour. These limits are not active
  because the proposal remains unapplied.
- Added the unapplied
  `.migration-backup/supabase/migrations/20260810_smsru_phone_verification_foundation.sql`
  proposal with rollout defaults disabled, private HMAC claim/idempotency
  storage and service-only internal RPCs. No SQL, Auth hook, Edge Function or
  real SMS delivery was applied in this stage.
- Replaced unconditional support-chat scroll-to-bottom behavior with a shared
  anchor. A conversation opens at the latest message; incoming messages follow
  only while the reader is near the bottom or after their own reply. Readers
  reviewing history keep their position and receive a compact «Новые
  сообщения» action. Content and viewport resizes both re-anchor an active
  bottom reader.
- The public support shell now resets its own scroll root when a newly created
  or restored ticket opens. Polling updates do not move the page itself.
- Focused unit contracts passed 12/12. Support Playwright passed 30/30 at
  3840x2160, 1920x1080, 1440x900, 390x844 and 412x915. The 412x915 operator
  case was repeated three times after fixing an 8-pixel late-layout drift.
- Authenticated smoke passed 5/5. Typecheck, production build, database type
  drift, RLS smoke and `git diff --check` passed. The build retains existing
  sourcemap/large-chunk warnings, and mutation/fixture-dependent RLS probes
  remain explicitly skipped unless their opt-in environment is enabled.

## 2026-08-12 - Provider-disabled p1sms adapter hardening

- Replaced the inactive SMS.RU transport source with a narrow p1sms adapter.
  Supabase Auth still generates and verifies the OTP; the adapter only submits
  one immediate `digit` message to `POST /apiSms/create`.
- The shared LETSCUBE p1sms account is protected by a fixed endpoint, one-item
  request, blocked redirects and source guards forbidding
  account, sender, history, scheduling, reject, phone-base and blacklist APIs.
- Added strict response correlation: exactly one positive provider message ID,
  the expected destination, a bounded response body and an accepted status are
  required. Raw provider responses never leave the adapter.
- Added `phone_change` destination handling that prefers valid `user.new_phone`
  and refuses a malformed new number instead of falling back to the old one.
- Added `.ops-private/` to the tracked ignore policy. The p1sms key remains only
  in local private storage; its value was not printed, copied to documentation
  or added to Git.
- Delivery remains disabled. No Edge Function, Auth hook, SQL, provider secret
  or production configuration was changed, and no real SMS was sent.
- Focused p1sms and hook contracts passed 14/14. `git diff --check`, KUB
  typecheck, production build, database type drift, authenticated multi-role
  RLS smoke and anonymous REST RLS probe passed. The build retains its existing
  sourcemap/large-chunk warnings; mutation and fixture-dependent RLS probes
  retain their documented skips.
- The first authenticated Playwright smoke invocation targeted a stale local
  service on port 5173 (`Apollo.GAP`) and was invalid for LETSCUBE. The
  corrected production run against `https://app.letscube.ru` passed 1440x900,
  390x844 and 412x915. Its 1920x1080 and 3840x2160 cases observed two transient
  Google Fonts 404 responses; both isolated reruns passed. The LETSCUBE API,
  auth flow and frontend runtime reported no regression.
- No global Deno installation was added. A one-off Deno 2.9.5 runner with
  automatic npm dependency resolution typechecked the Edge Function
  entrypoint successfully; Supabase CLI 2.98.2 remains available for the later
  controlled deployment stage.

## 2026-08-12 - Controlled p1sms phone verification pilot

- Created a current production database/configuration backup under the
  root-only server backup directory and verified its `pg_restore` inventory.
- Rehearsed the SMS migration inside a transaction with `ROLLBACK`, then
  applied the reviewed schema. Global SMS policy, account cutoff and
  data-access enforcement remain disabled.
- Added one expiring server-managed pilot allowlist entry. No email, phone,
  provider key, OTP or user identifier is stored in Git or documentation.
- Deployed the signed Auth Send SMS Hook and authenticated phone claim gateway.
  Auth and Edge Runtime are healthy. A signed synthetic hook request reached
  the claim gate and was rejected with `claim_required`; it did not contact
  p1sms or send an SMS.
- The settings flow now creates an HMAC claim before both initial send and
  resend, uses Supabase Auth `phone_change` OTP verification, cancels failed or
  abandoned claims, and mirrors verified state only through
  `profile_phone_mark_verified()` after Auth confirmation.
- A rollback-only live database smoke confirmed: pilot claim `created`,
  non-pilot claim `disabled`, zero claims after rollback, and no `anon` or
  `authenticated` access to pilot/claim tables or internal RPCs.
- Focused source contracts pass 16/16. Targeted authenticated Playwright passes
  all five required desktop/mobile projects. The only remaining production QA
  is the pilot user's manual request and entry of a real six-digit SMS code.
- KUB typecheck, production build, database type drift, authenticated
  multi-account RLS smoke, production authenticated smoke (`5/5`) and
  `git diff --check` pass. The build retains its existing sourcemap and large
  chunk warnings. An initial smoke without an explicit LETSCUBE base URL hit an
  unrelated local service on port 5173 and was discarded; the corrected run
  targeted `https://app.letscube.ru`.

## 2026-08-12 - GoTrue Send SMS hook destination compatibility

- The first manual pilot request failed before contacting p1sms. Auth reported
  `Invalid payload sent to hook`; the live claim remained cancelled with zero
  sends and the SMS event table remained empty.
- Exact deployed GoTrue `v2.189.0` source inspection showed that phone-change
  hooks place the requested destination in `sms.phone`. The hook previously
  inspected only `user.new_phone` / `user.phone`, so it rejected a valid signed
  payload as malformed.
- Added a regression test that failed with the old parser, then updated the
  narrow payload adapter to prefer `sms.phone` while keeping a fail-closed
  legacy fallback. Invalid explicit destinations never fall back to another
  number.
- The corrected hook was deployed after a root-only server backup. Local and
  deployed SHA-256 hashes match, and Edge Runtime is healthy.
- A signed synthetic request using the real `sms.phone` shape reached the HMAC
  claim gate and returned the expected `403 claim_required`. It did not call
  p1sms: SMS events and active claims remained zero, the single expiring pilot
  remained active, and global policy/enforcement remained disabled.
- A second manual attempt exposed a narrower format mismatch: GoTrue validates
  the submitted E.164 number and removes its leading `+` before constructing
  `sms.phone`. The claim was cancelled with `send_count = 0` and no SMS event,
  proving that neither the provider nor its key was involved. The regression
  fixture now uses the exact digits-only GoTrue payload, and the hook restores
  canonical `+E.164` before claim HMAC and p1sms correlation.

# 2026-08-20 - p1sms Telegram-first OTP cascade

- Switched the single p1sms OTP request from direct `digit` delivery to
  `telegram_auth`. The account-level p1sms rule owns the `not_delivered`
  fallback to digital SMS; LETSCUBE does not set `cascadeSchemeId` or issue a
  second provider request.
- Kept the 46-character OTP text, 65-character hard limit, fixed endpoint,
  redirect blocking, provider-response sanitization, rate limits and pilot
  allowlist unchanged.
- Updated phone settings to use channel-neutral delivery wording. Supabase Auth
  remains the sole OTP generator and verifier.
- Validation: p1sms/hook contracts 18/18, frontend typecheck and production
  build passed. The targeted five-viewport push/phone suite passed 15 static
  guards and skipped 15 authenticated cases because no QA auth state was
  available. Authenticated smoke skipped all five viewports for the same
  reason. Database type drift remained advisory-only; RLS smoke exited 0 after
  reporting unavailable QA sessions and no mutation fixtures. No provider
  delivery request was made by automated validation.

# 2026-08-20 - p1sms SMS-first OTP cascade

- Changed the single provider request from `telegram_auth` to `digit` after
  confirmation that the p1sms account-level cascade is bidirectional. P1SMS
  now owns the `not_delivered` fallback from direct SMS to Telegram.
- LETSCUBE still submits exactly one short message tagged `letscube-otp`; it
  does not create a second request or mutate shared provider cascade settings.
- Deployed only the `auth-send-sms` adapter after a timestamped root-only
  server backup. Local and deployed SHA-256 hashes match, the Edge Functions
  container returned to `healthy`, and an unsigned hook probe was rejected
  with HTTP 401 without contacting the provider.
- Validation: focused p1sms/phone contracts passed 21/21, frontend typecheck,
  production build and `git diff --check` passed. The build retains existing
  sourcemap and large-chunk warnings. Automated validation made no real OTP
  delivery request.

# 2026-08-20 - confirmed-phone delivery no-op handling

- Production evidence for the reported missing p1sms request showed a new
  active claim with `send_count = 0` and no SMS event. The claim HMAC matched
  the account's already-confirmed Supabase Auth phone, so `auth.updateUser()`
  correctly treated the unchanged phone as a no-op and never invoked the Send
  SMS Hook. The UI had incorrectly reported that a code was sent.
- Phone settings now detect the same confirmed Auth phone before creating a
  delivery claim. They restore the verified profile mirror only through
  `profile_phone_mark_verified()`, whose server-side implementation rechecks
  Auth confirmation. A genuinely changed phone still follows the SMS-first
  OTP flow.
- User-facing delivery copy is provider-neutral: `Код отправлен на номер ...`.
  Telegram remains an internal provider fallback and is no longer mentioned
  in the phone settings UI.
- Validation: the new regression test failed before the fix, then the focused
  phone/p1sms suite passed 22/22. Frontend typecheck, production build and
  `git diff --check` passed; existing sourcemap and large-chunk warnings remain.

# 2026-08-20 - phone verification global delivery rollout

- Before rollout, the live singleton policy had `enabled=false`, no mandatory
  cutoff and `enforce_data_access=false`; one of 12 accounts was in the active
  pilot allowlist and one verified phone existed.
- Created and validated root-only backup
  `/srv/letscube/backups/pre-migrations/20260820-192123-before-phone-global-rollout.dump`
  containing the phone policy and pilot tables.
- Applied
  `.migration-backup/supabase/migrations/20260820161957_enable_phone_verification_for_all_accounts.sql`.
  The live policy is now `enabled=true`, while the cutoff remains unset and
  `enforce_data_access=false`. Registration and ordinary application access do
  not require a verified phone.
- A rollback-only database smoke used an account outside the pilot allowlist:
  `phone_verification_claim_begin_internal()` returned `created`, the
  transaction rolled back, and zero synthetic claims remained. No Auth hook or
  provider delivery was invoked.
- The four internal phone policy/claim/event tables still expose zero table
  grants to `anon` or `authenticated`. Focused phone/p1sms contracts passed
  23/23 and `git diff --check` passed.

# 2026-08-20 - restored p1sms Telegram-first OTP cascade

- Returned the single provider request to `telegram_auth`. The account-level
  p1sms rule owns the `not_delivered` fallback to digital SMS; LETSCUBE still
  submits exactly one message and does not manage or duplicate the cascade.
- Kept the provider-neutral UI, 120-second resend cooldown, HMAC claims,
  server-side rate limits and global availability for authenticated accounts.
- Deployed only the adapter after a timestamped root-only backup. The local and
  deployed SHA-256 hashes match, the Edge Functions container is healthy, and
  an unsigned hook probe returned HTTP 401 before provider delivery.
- Focused phone/p1sms contracts passed 23/23, frontend typecheck, production
  build and `git diff --check` passed. Automated validation did not send a real
  OTP or expose provider credentials.

# 2026-08-21 - Windows 0.2.10 and folder editor scroll ownership

- Physical WebView2 QA isolated the Yandex SmartCaptcha startup failure to the
  non-default frozen-prototype option. The compatible Tauri default now lets
  the CAPTCHA runtime render while exact-origin navigation, CSP and the narrow
  desktop capability boundary remain unchanged.
- The Windows startup lockup now uses the neutral LETSCUBE wordmark instead of
  the legacy SVG that encoded the retired venue subtitle. Physical signed
  updates `0.2.8 -> 0.2.9 -> 0.2.10` retained the authenticated profile, and
  the early startup frame displayed the stable endpoint geometry without the
  old subtitle.

- The folder editor no longer combines a scrollable modal body with a second
  scrollable chat checklist. The shared modal body is the sole vertical scroll
  owner, so the footer remains reachable without adjacent scrollbars.
- Folder icons now provide 48 choices in four compact categories, while the
  message composer provides 80 emoji in five categories. Only the active
  category is rendered; the desktop message picker is capped at 420px and the
  mobile picker uses the available width without horizontal overflow. A shared
  accessible component preserves keyboard focus, selected state and text
  insertion.
- The focused folder-layout regression passed against production at desktop
  `1440x900` and mobile `390x844`. Full desktop layout QA passed 8 scenarios
  with 2 fixture-dependent skips, and authenticated smoke passed all 5 desktop
  and mobile projects. Typecheck, production build, Tauri contracts `14/14`,
  Rust `32/32` and the complete Windows lifecycle suite passed; only the known
  sourcemap/chunk and Cargo linker/PDB warnings remain.
- After Coolify completed the rolling replacement, the production folder and
  message picker checks passed `4/4` at desktop `1440x900` and mobile
  `390x844`. One earlier request reached the retiring replica during the
  rolling overlap; the final check ran only after the previous container had
  exited.
- The exact 2,321,755-byte signed-updater artifact was promoted unchanged from
  Test to Stable. Stable/Test updater and Stable download catalogs expose
  `0.2.10/14` with SHA-256
  `31ed5a8749a85802ce67581e92a9518f67b9c5930fb7463072ab7bcfd737d760`.
  Authenticode/SmartScreen reputation and killed-process WNS delivery remain
  separate external release gates.

# 2026-08-21 - p1sms SMS-first fallback and complete phone removal

- After p1sms support disabled the forced account-level cascade and approved
  the LETSCUBE templates, the runtime request now sends one primary `digit`
  message with one inline `not_delivered -> telegram_auth` fallback. P1SMS
  evaluates delivery and creates the fallback; LETSCUBE neither polls status
  nor issues a second provider request.
- The profile `Удалить` action previously cleared only `profile_contacts`.
  Supabase Auth retained the confirmed phone and phone identity, so re-adding
  the same number became an Auth no-op and no fresh OTP was sent.
- A first attempted fix exposed another important constraint: current GoTrue
  accepts an admin update with an empty phone but ignores it, and the profile
  guard correctly rejects direct server updates without its internal bypass.
  The final implementation uses the service-role-only
  `profile_phone_remove_internal(uuid)` RPC. In one transaction it clears the
  Auth phone and pending phone-change state, removes only the phone-change OTP
  token and phone identity, clears the private profile mirror, and cancels the
  active verification claim. `anon` and `authenticated` have no execute grant.
- Migration `20260821093000_phone_remove_internal.sql` passed a production
  rollback rehearsal before apply. Verified backup:
  `/srv/letscube/backups/pre-migrations/20260821-093456-before-test-phone-reset.dump`.
  The final gateway backup is
  `/srv/letscube/backups/edge-functions/20260821-093432-phone-remove-final`.
- The explicitly authorized test account reset was verified without printing
  its phone or user ID: Auth phone empty, pending phone change empty, private
  profile phone empty, zero phone identities and zero active claims.
- Local/deployed Edge Function SHA-256 hashes match and the functions container
  is healthy. Unsigned Send SMS Hook and unauthenticated gateway probes both
  returned HTTP 401; no automated provider delivery was triggered.
- At the user's request, general phone verification access was disabled after
  verified backup
  `/srv/letscube/backups/pre-migrations/20260821-094138-before-phone-admin-only.dump`.
  Migration `20260821095000_phone_verification_admin_only.sql` passed rollback
  rehearsal and apply. A rollback-only production smoke returned `created` for
  an account with `system.manage` and `disabled` for a regular account; the
  internal claim function remains executable only by `service_role`. The phone
  settings section is not rendered for non-administrators.

# 2026-08-21 - Administrator-only phone controls and p1sms error fallback

- Restricted the complete phone verification gateway to accounts with the
  global `system.manage` permission. This covers capability checks, claim
  cancellation, number removal and new claim creation; the Send SMS Hook also
  re-checks the same permission before authorizing provider delivery.
- Cancelled active non-administrator phone claims during migration so a claim
  created before the restriction cannot authorize a later resend.
- Migration `20260821101000_phone_gateway_admin_only.sql` passed a production
  rollback rehearsal and apply after verified backup
  `/srv/letscube/backups/pre-migrations/20260821-095422-before-phone-gateway-admin-only.dump`.
  Production smoke confirmed zero active non-admin claims and execute access
  only for `service_role`.
- A sanitized provider-history check found the latest digital message in
  terminal status `agg_error` with no cascade child. The previous cascade
  listened only for `not_delivered`, so Telegram fallback could not start.
- The local p1sms API manual documents `not_delivered` and `error` as cascade
  conditions. The message-scoped request now includes both terminal branches,
  each targeting `telegram_auth`; LETSCUBE still sends only one provider
  request and does not poll or resend OTPs itself.
- P1SMS support subsequently confirmed that an aggregator failure is surfaced
  as the distinct `agg_error` status and must be listed explicitly in
  `needStatus`. The runtime request now preserves the existing `not_delivered`
  and `error` branches and adds `agg_error -> telegram_auth`; physical fallback
  delivery remains pending a new administrator-initiated verification attempt.
- Focused p1sms/phone validation passed 25/25, followed by frontend typecheck,
  production build, database type-drift check and RLS smoke. The updated
  adapter was deployed with a server-side backup; local and remote SHA-256
  matched, the Edge Functions container returned to `running`, and unsigned
  probes for both phone endpoints remained fail-closed with HTTP 401.
- The current public p1sms API page differs from the support example: a cascade
  step keeps `needStatus` at the step level but requires the delivery `channel`
  inside `smstemplate`. The provider had accepted the old request while
  ignoring its malformed cascade branch. The adapter and structural tests now
  follow the current documented nesting.
- Removed the undocumented `tag` field from the provider request. It was absent
  from the current public send contract and provided no observable correlation
  value in sanitized provider history.
- Validation passed: `git diff --check`, frontend typecheck, production build,
  25/25 focused p1sms/phone tests, database type drift check and RLS smoke. The
  production build retains known sourcemap and large-chunk warnings. The
  authenticated Playwright smoke exited 0 but skipped all five projects because
  this local session had no reusable auth state.

# 2026-08-20 - Windows 0.2.8 startup and chat-history anchoring

- Reproduced the release-only blank window in the installed `0.2.7/11` client.
  An eagerly imported chart dependency mutated a prototype during module load,
  while the Tauri release WebView intentionally freezes built-in prototypes.
  The resulting read-only `constructor` assignment stopped React before mount.
  The dashboard trend is now rendered by bounded React/CSS bars without that
  startup dependency, and the old installed client mounts the production UI.
- Older chat pages now preserve the first actually visible message and its
  viewport offset after React commits the prepended rows. The single-flight
  guard remains active through slow network loads and suppresses bottom-anchor
  observers during restoration, preventing jumps to the first message or back
  to the newest message while the user scrolls upward.
- Added a fail-closed updater build wrapper. It reads the existing encrypted
  private key and password only from ignored `.codex-local` files, verifies the
  corresponding tracked public key before building and removes signing values
  from the process environment in `finally`.
- Built and server-verified the updater-signed `0.2.8/12` NSIS artifact. Stable
  download and both updater manifests expose the same 2,322,508-byte immutable file
  with SHA-256
  `697f345bd544281e27b7ab6f4293abebd6c024c10bf60ca6a6e513c5df2e7bfd`.
  The installed `0.2.7` client reported `available`, applied the native update,
  restarted as `0.2.8/12`, retained its authenticated profile and then reported
  `current`. Authenticode remains `NotSigned` and is still a separate external
  publisher/SmartScreen release gate.

# 2026-08-25 - Four-digit p1sms phone verification

- Root cause confirmed: the p1sms digital channel accepts four-digit
  verification codes, while the previous LETSCUBE profile flow generated six
  digits through GoTrue. The provider configuration will not be changed.
- Self-hosted Auth remains on `supabase/gotrue:v2.189.0`. Its source enforces an
  OTP length from 6 to 10 and resets smaller values to 6, so no unsupported
  environment override or private GoTrue fork was introduced.
- The administrator-only phone gateway now generates an unbiased four-digit
  code, stores only a domain-separated HMAC, applies a 10-minute TTL and a
  five-attempt ceiling, and enforces the existing two-minute resend cooldown.
  The raw code is not stored or logged.
- A correct code remains retryable until Auth succeeds. After Auth confirms the
  phone, claim consumption and the private profile mirror are committed in one
  database transaction.
- Verified pre-change database backup:
  `/srv/letscube/backups/pre-migrations/20260825-180748-before-phone-four-digit-otp.dump`.
  Its archive inventory passed `pg_restore -l` validation.
- Migration `20260825093000_phone_verification_four_digit_otp.sql` passed a
  rollback rehearsal before apply. Production checks confirmed all three
  columns, three service-only functions, RLS enabled, zero OTP-HMAC rows and no
  execute grants for `anon` or `authenticated`.
- A regression test then caught that an early resend could cancel the still
  valid claim before returning `rate_limited`. The cooldown check now runs
  before claim replacement. The updated migration passed another rollback
  rehearsal and apply after verified backup
  `/srv/letscube/backups/pre-migrations/20260825-181848-before-phone-resend-preserve.dump`.
- Edge Function backup:
  `/srv/letscube/backups/edge-functions/20260825-181236-phone-four-digit`.
  The production Edge runtime bundle check passed; deployed file hashes match,
  the container is healthy and unsigned probes remain fail-closed with HTTP
  401. No automated provider delivery was triggered.
- The follow-up gateway backup is
  `/srv/letscube/backups/edge-functions/20260825-181910-phone-resend-preserve`;
  the updated gateway passed the same bundle, health and hash checks.
- Focused phone/p1sms tests passed 26/26. Frontend typecheck, production build,
  DB type-drift check, RLS smoke and rollback-only RPC smoke passed. Targeted
  Playwright completed with 15 contract tests passed and 15 authenticated UI
  cases skipped because reusable local auth state was unavailable. Physical
  four-digit delivery and confirmation remain pending an administrator test in
  the deployed UI.

# 2026-08-25 - Audited phone removal in the administrator panel

- Root cause: the trusted removal action was exposed only in the current
  administrator's profile settings. The administrator user preview displayed a
  phone number but provided no management action.
- The user preview now shows `Удалить номер` beside an existing phone only when
  the caller has `system.manage`. A destructive confirmation explains that Auth
  and profile phone state will be cleared and a new verification will be
  required before the number can be restored.
- The browser sends only the target user ID to the authenticated phone gateway.
  A service-only database wrapper repeats the `system.manage` check, clears Auth,
  identity, profile and active claim state atomically, then writes an
  `admin_phone_removed` audit event without the phone value.
- Verified pre-change database backup:
  `/srv/letscube/backups/pre-migrations/20260825-185322-before-admin-phone-remove.dump`.
  Migration `20260825190000_admin_phone_remove_audit.sql` passed a rollback
  rehearsal before apply. `anon` and `authenticated` have no execute grant.
- A rollback-only production smoke verified Auth/profile clearing and the audit
  event without changing the real account. Edge backup:
  `/srv/letscube/backups/edge-functions/20260825-185406-admin-phone-remove`.
  The Edge bundle check, file hash, health check and unsigned HTTP 401 probe
  passed.

# 2026-08-25 - Restored Telegram-first p1sms cascade

- Provider support clarified that the `digit` channel is an advertising-class
  call whose delivery can be blocked by operators or routed to voicemail. The
  primary OTP channel is therefore `telegram_auth` again.
- The single provider request keeps message-scoped fallbacks for `agg_error`,
  `not_delivered` and `error`, but every fallback now targets `digit`. LETSCUBE
  still sends one four-digit OTP request and never performs a client-side retry
  or exposes provider routing in the UI.
- Focused p1sms/phone contracts passed 27/27. Both Edge entrypoints bundled
  successfully with the staged adapter. Production backup:
  `/srv/letscube/backups/edge-functions/20260825-215448-telegram-first-cascade`.
  The deployed adapter hash matches the validated local file, the Edge runtime
  is healthy, and unsigned gateway/hook probes both fail closed with HTTP 401.
  Automated validation did not send a real OTP.

# 2026-08-26 - Android signed production candidate 0.1.2/3

- The final permanent unpublished identity is owned by `ООО "КУБ"` and was
  created outside Git on 2026-08-26 with organization `ООО КУБ` and country
  `RU`. Its exact expiry is 2051-08-26 and its PKCS12 validity is at least 25
  years. The controller verified that the encrypted local backup opens and
  byte-matches the primary identity, and that the protected private-directory
  ACL is limited to the current owner plus `SYSTEM`. The established PKCS12
  same-password compatibility ruling remains unchanged. An external off-device
  backup is still pending. Signing values, certificate details and private
  inputs were never printed or copied into the worktree.
- Signed baseline artifacts were preserved under ignored local storage:
  `.local/release-baseline/letscube-0.1.1-build-2.apk` is 6,513,186 bytes with
  SHA-256
  `b1f21189c62d259a8f105bab33cc613f47a9424a23cb6abf38016f38249f2442`;
  `.local/release-baseline/letscube-0.1.1-build-2.aab` is 6,150,057 bytes with
  SHA-256
  `431eaac6d25e4cc1539354e274fccddb56c526ccd0a972b63e5e8a4da06f7a95`.
- Final ignored artifacts are
  `.local/release-final/letscube-0.1.2-build-3.apk` (6,513,250 bytes, SHA-256
  `d414fb7a818beb86a5bfbd06dc9cdc657e8aa82fa07acc32927b15ab2748af99`)
  and `.local/release-final/letscube-0.1.2-build-3.aab` (6,150,126 bytes,
  SHA-256
  `8c3be79e742e8771ed679ed9750e7fd530018c4de9ef69da0978df0c2f4430f4`).
  The exact signed build wrapper and final release verifier both passed for
  version `0.1.2`, build `3`.
- These canonical files are the current outputs of the restored tracked
  production source used for the fix-round-5 closeout. Independently rebuilt
  signed APK/AAB ZIP containers are not expected to retain byte identity, so
  an older artifact hash is not used as proof of source equivalence. Package,
  version, nondebuggable state, signer/Asset Links parity, strict APK checks
  and AAB structure/signature validation are the authoritative release gates.
- The tracked `artifacts/kub/public/.well-known/assetlinks.json` was generated
  from the signed baseline. Regeneration from the final APK was byte-identical
  to both baseline and tracked copies; document SHA-256 is
  `b36206f44ae852f458ba1077d8ec8105b3906baa0341a0deec7b1a05da879777`.
  No certificate value is repeated in this QA record. The document is not
  deployed and production domain verification was not claimed.
- Nothing A063 `P212C6000159`, Android 15/API 35, official Google Play
  Services: the old `0.1.0/1` debug package rejected the release-signed
  baseline with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. After the authorized
  package-only uninstall, the signed `0.1.1/2` baseline installed cleanly.
- Earlier UIAutomator field attempts could not prove credential entry, and the
  final bounded CDP/helper recovery returned `HELPER_UNAVAILABLE`. Fix round
  1/5 used the single newly authorized native credential submission without
  reading either field back. After 25 seconds the login form remained, while
  no app-shell/chat marker or generic authentication error appeared. No retry
  was made. Authenticated session, chat and local notification registration
  retention are explicitly unproven.
- A non-sensitive baseline sentinel at
  `/sdcard/Android/data/com.kub.messenger/files/task4/baseline-0.1.1-build-2.sentinel`
  retained the exact `inode:size:mtime` metadata
  `673040:0:1787699412` after direct `adb install -r` of `0.1.2/3`. Package
  version advanced to `0.1.2/3`, proving same-key package-data preservation
  without substituting that result for authenticated session retention.
- The final Nothing callback matrix passed using explicit-component intents:
  warm delivery retained the process, cold delivery started a new process, and
  killed-process delivery relaunched `MainActivity`. A malformed callback path
  and a foreign host retained the login route, emitted no callback marker and
  did not crash. Raw callback URLs and payload values were suppressed.
- Nothing safe lifecycle checks passed: release package identity/permission
  harness, notification permission granted, portrait orientation, foreground
  launch, background process retention, force-stop and killed relaunch.
  Physical network toggling was skipped to avoid disrupting the user device.
- Google Play emulators ran sequentially, hidden/headless, and each was shut
  down before the next boot. LETSCUBE_API_33 (API 33), LETSCUBE_API_34 (API 34)
  and Medium_Phone_API_36 (API 36) each passed Play-image identity, fresh
  `0.1.2/3` install, notification permission, foreground launch, portrait,
  explicit-component callback routing, offline/reconnect, background process,
  force-stop and killed relaunch. WebView login state was deliberately not
  inspected after the bounded login policy.
- Realme RMX3830 `0C73A18I22105AB1`, Android 15/API 35, custom microG: the
  signed candidate correctly failed to replace the existing debug `0.1.0/1`
  package, which remained unchanged. Wake/launch reached `MainActivity`, the
  process ran and portrait passed. No uninstall or data clear occurred. This
  device is excluded from FCM acceptance.
- Real signed-candidate FCM registration/delivery/tap routing was skipped
  because authentication/token registration could not be proven. Camera,
  photo, regular video, video-circle, voice, media picker/upload/quality/
  playback, geolocation, authenticated login/logout/session restore, physical
  large-chat scrolling and physical message-footer stability were skipped
  because they require authenticated/manual interaction that was not safe to
  automate. Browser coverage for the large-history anchor and footer is
  recorded below.
- Repository validation passed `git diff --check`, Kub typecheck, production
  Vite build, release catalog tests 27/27, database type drift, RLS smoke,
  `android:sync`, the signed wrapper build, final APK verifier and Android unit
  tests 34/34. The build retains advisory sourcemap/dynamic-import/chunk-size
  warnings. Authenticated smoke exited 0 with 5/5 skipped.
- The earlier red Playwright gate was a local setup failure: the server was
  launched in Vite development mode without the ignored production public
  inputs, so the expected production auth shell did not mount and the saved
  owner state was empty. A bounded production preview loaded the ignored
  QA/public values in-process without printing them. `e2e:smoke` then passed
  5/5. The exact targeted command passed 66 assertions with four explicit
  fixture-inapplicable mobile skips. A deterministic history-prepend fixture
  now sends the same wheel input that releases the product's initial bottom
  lock and delays only the older-message request so the existing loading and
  anchor assertions observe the intended state; no assertion was removed or
  weakened.
- Tracked-file guards found zero keystores, signing env files,
  `google-services.json`, production-local env files, PEM payloads, long JWT
  candidates, raw FCM-token candidates or literal signing-secret assignments.
  The sole private-key header text is a validation literal in the push sender,
  with no embedded key payload. No production deploy, catalog publish, Coolify
  change, Play submission, push, SQL/schema/RLS, iOS/PWA or Windows change was
  performed.

# 2026-08-26 - Android Task 4 fix round 1/5

- Base reviewed commit: `990b339`. The Digital Asset Links verifier now
  requires one statement, the exact single authorization relation,
  `android_app` namespace, package `com.kub.messenger`, and one normalized APK
  signer fingerprint. Rejection coverage includes a missing namespace, extra
  statement, extra relation, extra fingerprint, wrong package and wrong
  fingerprint.
- The production-preview correction described above cleared the automated
  gate: `pnpm.cmd e2e:smoke` passed 5/5, and the exact targeted Playwright
  command passed 66 with four fixture-inapplicable mobile skips. The two skipped
  scenarios are fast upward scroll and loading older history on each narrow
  mobile fixture; all applicable large-history anchor and footer assertions
  passed.
- Nothing A063, Android 15/API 35 official GMS: a clean signed `0.1.1/2`
  baseline install received the one bounded credential submission, but the
  login form remained and authentication was not proven. Direct signed
  `adb install -r` returned the device to final `0.1.2/3`. Final version,
  notification permission, portrait, warm/cold/killed explicit-component
  callback process routing, and malformed/foreign rejection all passed in the
  sanitized rerun. The original Task 4 baseline sentinel proof remains the
  package-data retention evidence; it is not session-retention evidence.
- API 33, 34 and 36 Google Play AVDs ran sequentially, headless, with zero AVD
  processes left afterward. Each passed fresh final install, expected API,
  Google Play Services package presence, `0.1.2/3`, notification permission,
  portrait, offline launch/reconnect and background retention. A separate
  OS-level rerun passed warm/cold/killed explicit-component PID and focused
  `MainActivity` routing on all three. The release WebView exposed only one
  accessibility node on these AVDs, so its route text was unobservable and was
  not substituted for the physical malformed/foreign acceptance.
- Realme RMX3830, Android 15/API 35 custom microG: existing debug `0.1.0/1`
  remained unchanged, launch and portrait passed, no release install was
  attempted, and the device remains excluded from FCM acceptance.
- Focused Android unit tests passed 40/40 and workspace typecheck passed.
  Authenticated signed-candidate FCM registration/delivery/taps, session/chat
  retention, physical media, geolocation, large-chat anchoring and physical
  footer stability remain honest skips after the single login attempt failed.
  Browser large-history/footer coverage passed as recorded above.

# 2026-08-26 - Android Task 4 fix round 2/5

- The controller authorized one unpublished same-release-key `0.1.1/2` QA
  baseline with a temporary `WebView.setWebContentsDebuggingEnabled(true)` call
  solely for CDP login. The temporary `MainActivity` and version edits were
  applied without a commit. The approved private wrapper built the production-
  configured release APK/AAB, and compiled bytecode inspection confirmed the
  temporary call was present before `BridgeActivity.onCreate`. The QA APK was
  installed only on Nothing and was never copied into `.local/release-final` or
  any publication path.
- Nothing A063, Android 15/API 35 official GMS: the QA baseline installed
  cleanly as `0.1.1/2`, remained Android `debuggable=false`, launched the
  expected activity and process, but exposed no WebView devtools socket. One
  bounded forward to the standard app-PID local-abstract socket produced zero
  CDP targets. The ignored credential helper was therefore not invoked, no
  credential/token/callback value was read or printed, and no alternate
  token-bearing or logcat-based login path was attempted.
- The temporary source and version edits were restored exactly before the
  final build. Source scan, Git diff and compiled bytecode each found zero
  WebView-debug enabling calls. The approved wrapper rebuilt real final
  `0.1.2/3`; the APK reports `debuggable=false`, passes the strict release
  verifier, and replaced the ignored final APK/AAB. Asset Links regenerated
  from this final APK is byte-identical to the tracked and signed-baseline
  documents. `adb install -r` returned Nothing to final `0.1.2/3`.
- Authenticated baseline shell/chat state could not be established because the
  Android WebView provider did not publish a reachable CDP endpoint despite the
  compiled temporary call. Consequently, session/chat/native-notification
  registration retention, signed-final FCM delivery/taps, media, geolocation,
  physical large-history anchoring and physical footer stability remain
  unproven. Per the bounded recovery ruling, this round stopped without a
  second debugging attempt or fallback authentication mechanism.

# 2026-08-26 - Android Task 4 fix round 3/5

- The controller authorized a second unpublished same-key `0.1.1/2` QA
  baseline with both the temporary WebView-debug call and
  `android:debuggable=true`. The production/Firebase public inputs and permanent
  release key remained unchanged. The QA artifact stayed ignored/local and was
  never copied to a release-final, catalog or publication path.
- On the official-GMS Nothing A063, the intentionally debuggable QA baseline
  exposed a non-empty CDP target. The ignored helper established the private QA
  session without printing credentials, tokens, callback fragments or user
  content. Authenticated app shell, chat access and active native notification
  registration were proven on the baseline.
- All temporary source, Gradle and version edits were restored before the final
  build. The approved wrapper rebuilt real final `0.1.2/3`; source and DEX scans
  contain zero WebView-debug enabling calls, APK/AAB manifests are
  non-debuggable, and the strict APK/Asset Links verifier plus AAB validation
  passed. Final ignored APK/AAB copies match those restored-source outputs, and
  baseline/final/tracked Asset Links remain byte-identical.
- `adb install -r` installed final `0.1.2/3` over the authenticated baseline.
  The authenticated session, chat access and active native notification
  registration survived the same-key upgrade.
- An initial missing notification card occurred while device DND was active.
  The controller later confirmed read-only `zen_mode=0`; the DND-suppressed
  observation is an environmental false negative and is not counted as an FCM
  failure.
- After DND was disabled, fresh signed-final background and killed-process
  checks each produced a grouped `messages` system card. The killed state used
  `am stop-app`: the app process was absent while the package remained eligible
  for delivery. Tapping each card focused final `MainActivity`, opened the
  exact chat/event, cleared the package card and preserved coherent delivered
  and read synchronization. No payload text, account data or token was logged.
- A fresh foreground event appeared and reconciled in the in-app notification
  center. The bounded package-scoped log window did not independently prove an
  FCM receipt, so only foreground realtime/in-app behavior is accepted;
  foreground FCM transport remains unproven.
- The bounded physical media run could not expose the attachment submenu
  controls through UIAutomator. No file was selected, uploaded or sent, and no
  camera, video or voice capture was started. The synthetic local fixture,
  generator and device copy were deleted. Under the stop ruling, no additional
  physical UI attempts were made: media picker/upload/quality/playback,
  camera/photo, regular video, video-circle, voice, geolocation, physical
  large-history anchoring and physical footer stability remain honest skips.
- Round 1 browser regression evidence remains green and applicable because
  round 3 changed no product source: `e2e:smoke` passed 5/5, and the targeted
  suite passed 66 with four explicit fixture-inapplicable mobile skips. It was
  not rerun for this documentation-only closeout.
- Fresh closeout validation passed the strict APK/Asset Links verifier, AAB
  structure/signature/manifest checks, focused Android unit tests 40/40, Kub
  typecheck and repository diff/secret guards. Final cleanup left zero Task 4
  helper processes and zero ADB forwards. No Realme, production deploy,
  publish, push, SQL/schema/RLS, iOS/PWA or Windows operation was performed.

# 2026-08-26 - Android Task 4 fix round 4/5

- A controller-approved unpublished same-key, same-version `0.1.2/3` QA overlay
  temporarily enabled WebView debugging and `android:debuggable=true` only on
  the official-GMS Nothing A063. Android had rejected the attempted `3 -> 2`
  downgrade before changing package data, so no uninstall or data clear was
  used. The overlay never entered the release-final, catalog, Git or publication
  paths.
- Bounded CDP instrumentation proved an authenticated app shell and native push
  plugin, independent foreground FCM receipt, the corresponding unread chat
  state, authenticated offline/reconnect signaling, a visible first-unread
  anchor, and a bounded Capacitor geolocation result. The single synthetic FCM
  message was soft-deleted and its listener/state helper was removed; no token,
  credential, coordinates, payload text or user content was printed.
- Background and killed-process grouped cards, exact-chat taps and coherent
  delivered/read synchronization remain the signed-final evidence from fix
  round 3 and were not repeated or promoted as round 4 results.
- Under the controller timebox, no new physical cases were started after
  geolocation. Media picker/upload/quality/original/playback, camera/photo,
  regular video, video-circle, voice, no-unread bottom anchoring, fast-upward
  scrolling, prepend anchoring, footer stability and an explicit logout/login
  cycle remain honest physical skips. Task 4 therefore remains open.
- Temporary `MainActivity` and Gradle changes were restored exactly. The
  approved wrapper rebuilt final `0.1.2/3`; source and DEX contain zero WebView-
  debug calls, the APK manifest and installed package are nondebuggable, and the
  strict verifier passed. Canonical final APK/AAB copies match the restored-
  source Gradle outputs, and final Asset Links remains byte-identical to the
  baseline and tracked documents.
- `adb install -r` replaced the QA overlay with exact final `0.1.2/3`. The
  authenticated shell survived, `MainActivity` was focused, no login marker or
  WebView debug socket remained, and cleanup left zero round-4 helper processes,
  temporary files or ADB forwards. No Realme, deploy, publication, Play, push,
  SQL/schema/RLS, iOS/PWA or Windows operation was performed.
- Fresh closeout validation passed canonical APK/AAB parity with the restored-
  source Gradle outputs, the focused Android unit suite 40/40, Kub typecheck,
  strict APK/Asset Links verification, Bundletool AAB validation and manifest
  inspection, JAR signature verification, `git diff --check` and tracked secret
  guards. The only private-key header match is the expected PEM parser literal
  without an embedded payload.

# 2026-08-26 - Android Task 4 fix round 5/5

- The controller-approved QA-only ruling was reused for one unpublished,
  same-key, same-version `0.1.2/3` overlay on the official-GMS Nothing A063.
  Temporary WebView debugging and `android:debuggable=true` existed only for
  bounded CDP instrumentation and never entered canonical, catalog, Git or
  publication paths. No FCM message was sent in this round.
- Explicit logout reached the authentication screen. The ignored private
  helper then completed a bounded login without printing credentials, tokens,
  account identity or user content. The authenticated app shell survived a
  cold process restart, closing the physical logout/login/session-restore gate.
- In an existing large QA chat, CDP geometry proved a fully read initial view
  near the bottom, stable fast upward reading without a jump to the bottom or
  absolute top, preserved visible anchoring while older history was prepended,
  and stable sampled footer/timestamp geometry without oscillation.
- Synthetic non-private image and video fixtures exercised the product media
  staging path. Image staging hid video quality controls; video staging exposed
  three quality choices including original, accepted original and played the
  local preview. An isolated two-account QA upload target could not be proven
  within the two-minute bound, so no message/object was uploaded. Upload
  progress/completion, sent-message playback and product-side deletion remain
  honest skips. All host/device fixtures were removed.
- The overall physical timebox expired before camera/photo, regular-video,
  video-circle or voice controls could be exercised. No capture was started,
  saved, sent or copied; those five capture gates remain honest skips. Round 4
  remains the evidence for foreground FCM, authenticated offline/reconnect,
  first-unread anchoring and geolocation. Round 3 remains the evidence for
  background/killed cards, exact taps and delivered/read synchronization.
- Production source, Gradle and version state were restored exactly before the
  approved wrapper rebuilt final `0.1.2/3`. The latest restored-source Gradle
  APK/AAB replaced canonical local outputs, Asset Links was regenerated with
  the same signer, and strict APK/AAB checks passed. `adb install -r` replaced
  the QA overlay with the canonical nondebuggable final; the authenticated
  shell remained available and no WebView debug socket remained.
- Cleanup left zero round-5 helpers, temporary fixtures, captured media,
  device copies or ADB forwards. Task 4 remains open only for the skipped
  product upload lifecycle and camera/photo/regular-video/video-circle/voice
  physical acceptance. No Realme, deploy, publication, Play, push, SQL/schema/
  RLS, iOS/PWA or Windows operation was performed.
- Fresh closeout validation passed the focused Android unit suite 40/40, Kub
  typecheck, strict canonical APK/Asset Links verification, restored-source
  Gradle/canonical parity, Bundletool AAB validation and manifest inspection,
  AAB cryptographic signature verification, zero compiled `MainActivity`
  WebView-debug calls, tracked metadata parity, `git diff --check` and tracked
  secret guards. `jarsigner -strict` additionally reports the expected
  self-signed trust-chain and missing-timestamp warnings for the permanent
  Android app-signing identity; ordinary cryptographic verification succeeds.

# 2026-08-26 - Android Task 4 controller physical closeout

- After the five automated fix rounds were exhausted, the controller closed
  the remaining reviewer P1 on official-GMS Nothing A063 in a strictly QA-only
  private chat. The approved same-key `0.1.2/3` debug overlay was installed only
  for bounded CDP instrumentation and never entered canonical, catalog, Git or
  publication paths.
- The product file chooser staged and uploaded a synthetic WebM larger than
  6 MiB with original quality selected. Product TUS upload progress, separate
  message-send progress, upload completion and sent-message playback all
  passed. The test message was soft-deleted; its original and generated media
  variants were removed. An idempotent cleanup audit found four soft-deleted
  test rows, zero active rows and all four objects removed or already absent.
- Camera/photo reached live preview, shutter and captured preview before the
  modal was closed without adding or sending. Regular video reached live,
  record, stop and recorded preview before deletion. Voice reached record and
  cancel; video-circle reached live and record before close/cancel. No captured
  environment was retained, copied or sent.
- Temporary source/Gradle edits were restored exactly before the private wrapper
  rebuilt canonical final `0.1.2/3`. The installed package is nondebuggable,
  retains the authenticated shell, exposes no WebView debug socket and leaves
  zero controller helper files or ADB forwards. Canonical restored-source
  artifacts are 6,513,250-byte APK SHA-256
  `d414fb7a818beb86a5bfbd06dc9cdc657e8aa82fa07acc32927b15ab2748af99`
  and 6,150,126-byte AAB SHA-256
  `8c3be79e742e8771ed679ed9750e7fd530018c4de9ef69da0978df0c2f4430f4`.
- This closeout sent no FCM event and made no production deploy, publication,
  Play, SQL/schema/RLS, iOS/PWA or Windows change. Local Task 4 physical
  acceptance is complete; Asset Links deployment/domain verification, normal
  HTTPS recovery routing, external backup and catalog publication remain
  separate external gates.

### 2026-08-27 Android final-review hardening

- Auth callbacks now establish only the session represented by their own PKCE
  code or complete implicit token pair. A recovery marker without callback
  credentials cannot reuse an unrelated persisted session.
- Query and fragment credentials are removed from the current history entry
  before asynchronous exchange. Successful and terminal callback navigation
  uses history replacement, so browser Back cannot restore callback secrets.
- The strict APK verifier now requires APK Signature Scheme v2 in addition to
  the existing signer, package, version, manifest and Asset Links checks.
- Fresh validation passed Android/auth units 50/50, typecheck, production web
  build, release catalog 27/27, authenticated smoke 5/5, database type drift,
  read-only RLS smoke, production debug build, strict canonical APK verification
  and Bundletool AAB validation. The targeted 70-case visual/release matrix
  completed with 62 passes, 7 intentional mobile skips and one 3840px anchor
  timing miss of 4px against a 3px threshold; the exact scenario then passed
  three consecutive reruns.
- A Realme update attempt was rejected before installation because the existing
  local package has a different signer. The app was not uninstalled and its data
  was not cleared. The official-GMS Nothing physical acceptance evidence above
  remains the FCM source of truth.
- Final review found the initial name-based child-environment sanitizer was not
  closed: several common credential names and the keystore-path input could pass
  through. The release pipeline now builds child environments from an explicit
  platform/tool allowlist; approved public Vite values are added deliberately,
  and the four signing inputs exist only in the Gradle release process. Git and
  APK inspection tools receive the same sanitized tool environment. Focused
  allowlist/verifier tests passed 33/33, and fresh production debug plus signed
  release builds passed with the canonical hashes recorded above.
- Scoped final re-review found no new Critical, Important or Minor regressions
  and marked both the child-environment isolation and duplicate-v2 parsing
  findings addressed. On final `HEAD`, Android/auth units passed 53/53,
  TypeScript typecheck passed and the canonical APK passed strict verification.
- The post-deploy recovery check exposed a route-priority race: establishing a
  callback session briefly reloaded global user state, so the loading gate could
  unmount the callback after its URL had already been scrubbed. A RED/GREEN
  regression test now requires `/auth/callback` to render before global loading.
  Fresh Android/auth units passed 54/54, typecheck and production web build
  passed, and the rebuilt APK/AAB passed strict and Bundletool validation.
- Live Asset Links stabilized at 12/12 JSON responses and returns `200`,
  `application/json`, `nosniff` and a one-hour public cache. Exact final APK
  signer parity passed. The rebuilt release installed on Realme as nondebuggable;
  warm, cold and force-stopped recovery links each opened the `Новый пароль`
  screen through an implicit HTTPS `VIEW` intent.
- Scoped review of the callback-priority fix found no new Critical, Important
  or Minor regressions and returned `READY`. The browser callback/history test
  then passed 5/5 across three desktop and two mobile Playwright projects with
  the required public runtime configuration loaded.
- Realme's OEM StatementService later returned `legacy_failure` after an update
  because its verifier network job was background-restricted. Clearing only the
  verifier cache and temporary network/Doze exemptions did not make that OEM
  service deterministic. The routing run therefore used Android's `approved`
  state after cryptographic parity; it is not recorded as a fresh automatic
  verification. The same certificate/manifest had already reached `verified`
  before the frontend-only rebuild. Official-GMS verification remains the
  production device-matrix authority.

# 2026-08-27 - Android release build environment hardening

- Final diff review identified that the Android wrappers validated an explicit
  public Vite allowlist but still inherited the parent process environment.
  The wrappers now construct child environments from a closed platform/tool
  allowlist before adding the approved public values.
- The release Gradle process receives only the four dedicated Android signing
  inputs in addition to the sanitized build environment. Vite, Capacitor,
  `apksigner` and `apkanalyzer` do not receive those signing inputs.
- TDD regression coverage passed for both the public child environment and the
  release-only signing environment. A production-debug build with synthetic
  inherited Vite/backend sentinels completed through Vite, Capacitor sync and
  Gradle, and neither sentinel was present in the web bundle or Android assets.
- No real credential value, signing identity, callback, device token or user
  data was printed. No SQL/schema/RLS, deploy, publication, Play, iOS/PWA or
  Windows operation was performed in this hardening check.

# 2026-08-27 - Android Stable publication closeout

- The callback-priority fix was deployed through Coolify; the production web
  application reached a healthy deployment updated at `2026-08-27T19:37:04`.
  An isolated live recovery run opened `Новый пароль`, retained the exact
  `/auth/callback` route and removed callback query/fragment credentials from
  browser history.
- Live `/.well-known/assetlinks.json` returns the expected JSON/security/cache
  headers and exact signer parity with the final APK. Twelve consecutive probes
  returned JSON without the former SPA fallback.
- The canonical nondebuggable APK `0.1.2` build `3` was atomically published to
  Android Stable. The public manifest reports `available=true`, version `0.1.2`,
  build `3`, 6,513,250 bytes and SHA-256
  `d414fb7a818beb86a5bfbd06dc9cdc657e8aa82fa07acc32927b15ab2748af99`.
  A fresh HTTPS download used an immutable URL and matched both size and hash.
- The matching 6,150,126-byte AAB with SHA-256
  `8c3be79e742e8771ed679ed9750e7fd530018c4de9ef69da0978df0c2f4430f4`
  remains ignored/local and was not published or uploaded to Play Console.
- Final docs-closeout validation passed the focused Android/auth subset 52/52,
  native push navigation 1/1, foreground delivery migration 3/3, TypeScript
  typecheck, strict canonical APK verification, Bundletool AAB validation, the
  current live Stable manifest contract and preserved public-download parity.
- Both Android 15 devices were connected with final `0.1.2/3`; Nothing reported
  `zen_mode=0`. A fresh system `verify-app-links --re-verify` on the official-GMS
  Nothing A063 returned `app.letscube.ru: verified` for `com.kub.messenger`.
- No SQL/schema/RLS, iOS/PWA or Windows change was made. Remaining external gates
  are an encrypted off-device signing backup and Play Console/listing/screenshot
  preparation.

## 2026-09-02 — public home rollout to production

- `main` fast-forwarded `7a99f52..5da93e0` (63 commits) so it stops diverging
  from `codex/bot-platform`, which is the branch the production Bot Gateway
  canary was cut from. The push touched `artifacts/kub` (65 files) and
  `artifacts/api-server` (18 files), so both the `letscube-web` and
  `letscube-worker` webhooks were in scope.
- Pre-deploy state recorded first: `app.letscube.ru/` 200, `api.letscube.ru
  /healthz` 200, both Stable manifests 200, guest `/` and `/download` still
  redirecting to `/login`, bundle `index-Do_cSPEY.js`.
- Post-deploy: bundle `index-DY4jgnIu.js` after roughly 150 seconds; all four
  endpoints still 200; `api.letscube.ru/healthz` returns `ok`.
- The deployed revision was verified rather than assumed. The live page shows
  macOS and iPhone/iPad as `В разработке` and the summary reads "Windows и
  Android доступны для загрузки; macOS и iOS в разработке" — the label fix and
  the conjunction join exist only in `5da93e0`. The Coolify deployment id and
  healthcheck were not read in this session, so they are not claimed.
- Production verification passed on `1440x900` and `390x844` in both themes:
  guest `/` stays on the public home, the hero renders, nothing scrolls
  sideways, three product images decode and match the requested theme, the
  catalog settles, and the console is clean. `/download`, `/privacy` and
  `/support` render; `/tasks` still gates to `/login`.
- The verification also checks the availability sentence against the sections
  beneath it: every platform must appear in exactly one clause, a platform with
  a download link must be inside the "available" clause, and one without must
  not be. All four platforms passed in every state observed.
- Release artifact bytes and SHA-256 were verified against the manifests before
  this rollout: Windows `0.2.10` 2 321 755 bytes and Android `0.1.2` 6 513 250
  bytes both matched. macOS and iOS remain unpublished.
- One intermittent observation, not a production defect: from this workstation
  the catalog fetch sometimes stalled until the client's 5-second timeout and
  was aborted. All external traffic here is tunnelled through a local HTTP
  proxy, direct requests to the same URL answer in about 70 ms, and repeated
  runs without the proxy pressure succeeded in 55-79 ms. The page behaved
  correctly in both outcomes — offering downloads when the catalog resolved, and
  saying the catalog was unreachable with a retry when it did not. Whether the
  5-second timeout is right for a slow mobile network is a question for the
  queued interface stage; there is no evidence of a defect here.
- No SQL, schema, RLS, iOS/PWA or Android change was made in this rollout.

## 2026-09-02 - bot creation opened and phone verification reopened

- Bot creation: the canary cohort had outlived the canary. `BOT_CREATION_CANARY_USER_IDS`
  still pinned the single internal owner, so every other account was refused with
  `403 bot_creation_not_allowed` while meeting every account requirement. The
  variable is retired rather than widened - the gateway no longer reads it and
  compose no longer passes it - and `BOT_CREATION_ENABLED` became a kill switch
  defaulting to open.
- The refusal was also silent: the client built its reason only from the five
  account requirements, so an account meeting all five saw the literal text
  "Создание недоступно: ." with no reason. `describeCreationBlock` now names the
  server switch in that case; a test walks all 32 flag combinations.
- Phone verification was closed in three places and all three are now open: the
  `isAdmin` guard in `SettingsModal`, the blanket administrator check in the
  `phone-verification-gateway` Edge Function, and the `system.manage` checks
  inlined into `phone_verification_claim_begin_internal` and
  `phone_verification_claim_authorize_sms`.
- Database change followed the migration protocol. Target confirmed as
  `supabase-db`, database `postgres`, PostgreSQL 17.6, with the pre-state read
  first: policy `enabled=false`, both gates checking `system.manage`, and
  `phone_verification_available_internal` absent. Fresh backup
  `/srv/letscube/backups/pre-migrations/20260902-003625-before-phone-open-to-all.dump`,
  4 662 173 bytes, verified with `pg_restore --list` (2202 TOC entries, 14
  entries for the objects being changed). Rehearsed in full with the closing
  `commit` replaced by `rollback`: every statement succeeded, the migration's own
  verification block raised nothing, and the policy row read `false` again
  afterwards. Applied once. Post-apply: policy `enabled=true`,
  `enforce_data_access=false`, no cutoff set; both delivery gates now reference
  the policy predicate and neither mentions `system.manage`;
  `admin_profile_phone_remove_internal` still checks it; execute grants remain
  `postgres` and `service_role` only, with nothing exposed to `anon` or
  `authenticated`.
- Edge Function deployed by hand, which is how functions reach this stack. The
  deployed file was byte-identical to the repository baseline first (sha256
  `98f0724d...`), so nothing out of band was overwritten; the previous version
  was saved to `/srv/letscube/backups/edge-functions/20260902-004046-phone-verification-gateway-index.ts.bak`,
  the new file matches the repository (`344c03eb...`), and the runtime restarted
  healthy. An unauthenticated call to
  `https://core.letscube.ru/functions/v1/phone-verification-gateway` returns
  `401 unauthorized`.
- Web deployed through the usual webhook; the served bundle went
  `index-CuY2fyR6.js` -> `index-CtNkELR6.js`, and Coolify's container tag shows
  the web app running commit `37f9b63`.
- **Bot creation is not live yet.** `letscube-bot-gateway`
  (`twezs89u2m6d6ln6c0rpaqxe`) is the only application of five with
  `is_auto_deploy_enabled = false`, pinned during the canary and never restored,
  so it still runs commit `01d26a9` from 32 hours earlier. Its `watch_paths` do
  cover `artifacts/api-server/**`, so the pin, not the paths, is what held it
  back. Exactly one commit and one file separate the pinned revision from HEAD
  within those paths, so the deployment gap is small. It needs a manual deploy.
- Open operational finding, unrelated to this work: three bot-rollout rehearsal
  stacks from 2026-08-31 are still running (12 containers, 3 volumes). The root
  filesystem was at 61 percent with 45 GB free.
- Correction to the line above as first written: it also counted "3.8 GB of
  reclaimable images" as waste. That is wrong. There are zero dangling images;
  `docker system df` counts every image not attached to a running container as
  reclaimable, and here those are the tagged Coolify release images that serve
  as rollback targets. Only the build cache was actually disposable.
- Validation: 608/609 unit tests, web typecheck and production build clean,
  `git diff --check` clean. The single failure is the pre-existing
  `android-release-signing` fixture, unmodified on this branch.

## 2026-09-02 - server cleanup and the bot gateway pin

- Pruned the Docker build cache only: `docker builder prune -f` freed 7.43 GB
  and left one 35.76 MB entry. Disk went from 68 GB used / 45 GB free / 61 per
  cent to 62 GB used / 51 GB free / 55 per cent. Every container stayed healthy,
  and the public surfaces returned 200 / 200 / 200 / 200 with the two
  authenticated APIs returning 401 as they should.
- Images were deliberately not pruned. There were no dangling images at all, and
  `docker image prune -a` would have removed the tagged Coolify release images,
  which are the rollback targets for each application.
- The three rehearsal stacks were left alone. They hold roughly 158 MB of memory
  in total across 12 containers, so they cost little; they may still hold
  evidence from the bot rollout, and removing them is a decision for the owner.
- `letscube-bot-gateway` still runs `01d26a9`, so bot creation remains closed and
  the bots page correctly reports that the feature is switched off on the server.
  That message is the client fix working: the same state used to render
  "Создание недоступно: ." with no reason at all.
- Both `BOT_CREATION_ENABLED` and `BOT_CREATION_CANARY_USER_IDS` are set for that
  application. Coolify stores environment values encrypted at rest, so the values
  were not read and are not recorded here. The deploy is nonetheless safe to run:
  the previous code threw at startup for any value other than empty, `false`, or
  `true` with a valid cohort, and the container has been healthy for 32 hours, so
  the stored value must be one of those three - and the current code accepts all
  three. If the page still reports the feature switched off after the deploy, the
  value is `false` and needs changing or removing.

## 2026-09-02 - bot gateway deployed, creation live

- Deployed `letscube-bot-gateway` through Coolify's own code path rather than
  around it: `queue_application_deployment()` with `no_questions_asked` and
  `is_api`, the same helper its REST controller calls. Deployment
  `uzu34noqs7jugop1k7jr5ro1` finished on commit `935a670`, and the container now
  runs `twezs89u2m6d6ln6c0rpaqxe:935a670d...` and reports healthy. The previous
  image `01d26a92...` is still present as the rollback target.
- Verified in the running bundle, not just in the repository:
  `/app/artifacts/api-server/dist/botGatewayIndex.mjs` contains zero occurrences
  of `BOT_CREATION_CANARY_USER_IDS`, so the value still stored in Coolify is now
  inert, and one occurrence of `BOT_CREATION_ENABLED`, the kill switch.
- `BOT_CREATION_ENABLED` was checked by verdict only, without reading or
  recording its value: it is explicitly enabled, which under the new semantics
  means creation is open. Under the previous semantics the same value required
  cohort membership, which is exactly what refused every other account.
- Gateway startup is clean: `Bot Gateway listening` on port 8098 with no
  configuration error. Nothing on the host is unhealthy. `app.letscube.ru` and
  `api.letscube.ru/healthz` return 200 and the management API returns 401
  unauthenticated.
- This supersedes the previous entry's statement that the deployment was still
  pending. The reasoning recorded there held: the stored value was one the new
  code accepts, so the deploy neither crashed the gateway nor left creation
  closed.

## 2026-09-02 - the authenticated e2e suite was never signing in

Closing Task 5 step 1 meant running the parts of the validation list that had
been skipped. Those runs surfaced a defect in the test harness itself, not in
the product.

- `tests/e2e/helpers/auth.ts` decided whether a session existed by looking for a
  password field and treating its absence as "already signed in". That inference
  held only while a guest at `/` was redirected to `/login`. Since the public
  home shipped, a guest at `/` gets a marketing page, which also has no password
  field, so `loginIfNeeded` did nothing and every following assertion ran as a
  logged-out visitor.
- `tests/e2e/smoke.spec.ts`, named "KUB authenticated smoke", passed in that
  state. Every assertion it makes is true of a logged-out visitor: `body` is
  visible on any page, the notifications button is wrapped in an
  `if (isVisible)` that silently skips when absent, and `/tasks` merely
  redirects a guest to `/login` without an interface error. It reported 5/5
  against production while never authenticating.
- The helper also called `saveAuthState` unconditionally at the end, so a guest
  visit overwrote the role's stored session. `output/playwright-auth/owner.json`
  was found holding zero cookies and only the two release-catalog cache keys.
- Fixed by requiring positive proof: the helper now waits for the sidebar menu
  button, which only exists once a session is loaded, navigates to `/login`
  itself rather than relying on a redirect that no longer happens, asserts it
  reached the authenticated shell, and persists state only after that assertion
  passes. Timings are budgeted against the 45-second per-test timeout, because
  an over-generous helper is torn down mid-sign-in and reports a closed page
  instead of a failed login.
- The fix is demonstrated by the change in outcome rather than asserted: with
  the old helper `e2e:smoke` reported 5/5 against production; with the new one
  the same command fails, and the failure is the real reason.
- That real reason is a second finding: production answers
  `Неверная эл. почта или пароль` for the stored QA owner account, so the
  credentials in the local QA env file are stale. The authenticated suite cannot
  run until they are refreshed. This is the owner's to do; no attempt was made
  to guess or reset any password.
- Consequence for earlier records: any prior entry citing a passing
  `e2e:smoke` against production cannot be taken as evidence that an
  authenticated path was exercised. How long the credentials had been stale
  cannot be determined from here, because the old helper could not tell a signed
  out session from a signed in one.
- Unaffected: `tests/e2e/public-home.spec.ts` and
  `tests/e2e/public-home-routing.spec.ts` do not import the auth helper, so the
  75/75 mounted result recorded for the public home stands. 29 spec files do
  import it and were all affected.
- Also run and passing while closing step 1: `release:catalog:test` 35/35 with no
  skips against the pinned jq 1.7.1, `public-release-artifact-verification`
  12/12, and the full workspace typecheck across all four projects.

## 2026-09-02 - QA owner credentials reset, authenticated suite unblocked

- Diagnosed before changing anything. All four configured QA accounts were
  healthy in `auth.users`: email confirmed, not banned, not deleted, a bcrypt
  hash present, and last signed in on 2026-08-31, with `updated_at` equal to
  that sign-in, so no password had been changed since. The login form's captcha
  was ruled out too: it guards the password-reset flow, not sign-in.
- Asking the Auth API directly, rather than through the interface, isolated the
  fault: `location_admin`, `location_staff` and `client` all signed in with a
  200, and only `owner` returned `400 invalid_credentials`. `tech_admin` has a
  password configured but no email, so it cannot be used at all.
- Only that one password was reset, with the owner's authorisation and only
  because `findFirstAvailableQaRole` puts `owner` first, so a wrong password
  there pins every authenticated spec to a broken account. Done in one
  transaction with pgcrypto: guarded on exactly one matching account, updated,
  then verified inside the same transaction that the new hash validates and that
  the account is still confirmed, unbanned and not deleted. No schema object was
  added or altered. An earlier draft kept the previous hash in a helper table
  under `public`; that was dropped before running, because a table of password
  hashes there is reachable through PostgREST, and there was nothing to roll
  back to - the previous password is the one production already rejects.
- Verified end to end afterwards: all four usable roles return 200 from the Auth
  API, and the QA env file kept all twelve keys.
- `e2e:smoke` now passes 5/5 against production **serially**. Run in parallel it
  fails intermittently, because all five viewports sign in as the same account
  at the same moment; the same run passes when the workers are serialised.
  Authenticated suites should be run with `--workers=1` until the roles have
  separate accounts.
- `visual-style-layout.spec.ts` and `release-distribution-settings.spec.ts` went
  from 5 passed / 25 failed to 31 passed / 4 failed / 18 skipped once sign-in
  actually happened.
- The remaining failures are not treated as defects, and not dismissed either.
  They are confined to the two mobile viewports, and a second run produced a
  *different* set of failing tests, which is the signature of instability rather
  than a defect. The screenshot of one shows the application stuck on its
  retryable loading screen with "Загрузка длится дольше обычного", consistent
  with the proxied network on this workstation that was already measured
  stalling requests until an abort. Desktop projects were clean in both runs.
  A device or network without that proxy is needed to judge the mobile
  viewports, so they are recorded as unverified rather than as passing.

## 2026-09-02 - native startup verified on real devices

The last open item in Task 5 step 4 was native startup: the shells must not show
the public home, not even as a flash. Two Android phones and this Windows
machine were used.

- The two shells load their web code differently, and that decides what a device
  run can prove. `capacitor.config.ts` sets no `server.url`, so Android bundles
  the web assets at build time; the installed release 0.1.2 therefore carries
  code from before the public home and could not exercise the contract at all.
  The Windows shell is the opposite: `windows-tauri/src-tauri/src/lib.rs` pins
  `PRODUCTION_ORIGIN` to `https://app.letscube.ru`, so the installed 0.2.10
  already runs today's deployed web code.
- Android therefore needed a build. A debug APK was produced from the current
  branch with `android:build:production:debug`, 8 520 418 bytes. It was
  installed under `com.kub.messenger.debug` so it could sit beside the tester's
  release build instead of forcing an uninstall that would have dropped their
  session; the suffix was added to `android/app/build.gradle` only for the run
  and reverted afterwards, and the release applicationId was never touched.
  Firebase config was deliberately left out of the worktree, so this build has
  no push - irrelevant to a routing check, and it kept the file out of a tree it
  does not belong in.
- Verified on both phones, each after `pm clear` so the app started as a guest,
  with frames captured concurrently with the launch rather than after it:
  Realme RMX3830 on Android 15 and Nothing A063 on Android 15. Both go splash to
  the application's own loading screen to the login form. The public home appears
  in no frame on either device. The first attempt captured only black frames
  because the phone's display was off; that was a capture fault, not a result,
  and was redone.
- Windows: the installed 0.2.10 was launched and opened straight into the
  messenger, with no public-home frame at any point. This machine holds a
  session, so what it exercises is the authenticated path. The guest path on
  Windows was not exercised directly and is not recorded as if it were; the
  mechanism behind it is that `initialization_script` is registered on the
  webview builder, so `window.letscubeDesktop` is defined before any page
  script, which is why no flash is structurally possible. Android exercised the
  same `nativeShell` branch on real hardware.
- Cleanup: the debug package was uninstalled from both phones, both still report
  `com.kub.messenger 0.1.2`, `android/app/build.gradle` is reverted and the
  worktree is clean.
- No chat content, contact name or personal media from the connected devices or
  the desktop session is reproduced in this record or anywhere else.

## 2026-09-04 - interface stage: what was measured, and what the numbers were

This records the measurements behind eleven unpushed commits. Every figure
here was taken on this workstation against production, not estimated.

### Media caching

- Storage objects were served with `Cache-Control: max-age=3600` — Supabase's
  default, because no upload path ever set one. Inside the hour a repeat visit
  to a chat costs nothing; after it, every avatar and preview costs a
  conditional request answered 304. Verified that revalidation works: a request
  carrying the object's ETag returns `304 Not Modified` with no body, and a
  wrong ETag returns the full 3 056 bytes.
- The lifetime is honoured only when sent at upload time. Editing
  `storage.objects.metadata->>'cacheControl'` in the database changed nothing
  served, including after restarting `supabase-storage`; re-uploading the same
  bytes with the header did. Both directions measured on the same object.
- 593 existing objects were rewritten in place with the correct header
  (`reuploaded=591 already_correct=2 failed=0`), each verified by comparing the
  downloaded size before and after. Live headers afterwards: message variants
  and every avatar file `max-age=31536000, immutable`; profile variants
  `max-age=2592000`.
- Outcome, browser, cache cleared: a first visit to a chat downloads the
  pictures; a second produces no network traffic for media and no 304.

### Avatar sizing

- Avatar originals average 734 kB against 2 717 bytes for `avatar_128`.
- Administrator user list, HTTP cache disabled: **7 originals totalling
  6 250 kB became 7 variants totalling 20 kB**. One private chat went from
  215 kB to 87 kB.
- Two causes, both required: `UserAvatar` could only use a variant through an
  optional prop that 6 of 42 call sites passed, and the RLS policy on
  `media_variants` allowed reading only your own profile's rows, so somebody
  else's avatar could never have resolved to a variant regardless.

### Windows storage

- WebView2 profile at `%LOCALAPPDATA%\ru.letscube.messenger\webview-production-v1`:
  120,3 MB total, of which 112,7 MB is the nine cache directories and 0,2 MB is
  the session (`Local Storage` 0,09 MB, `Network` 0,11 MB). The cache list was
  checked against the real folder rather than assumed.

### The pre-paint theme script

- `https://app.letscube.ru` threw `SyntaxError: Unexpected token '.'` on every
  page load, before any of this stage's changes. `new Function(THEME_INIT_SCRIPT)`
  reproduces it verbatim. The pre-paint theme never ran, and the Android
  night-mode marker branch was unreachable — the most likely explanation for the
  open "Android cold launch is light" item. Verified fixed in a browser driven
  with the marker in the user agent against a light system: the marker wins.

### Database changes applied to production

`privacy_preferences`, `achievements`, `cosmetics`, `product_milestones`,
`profiles.is_test_account`, `profiles.profile_frame`, `profiles.profile_background`,
`bot_set_avatar_internal`, `support_user_ticket_create`,
`support_user_message_create`, and the avatar-variant read policy. Each was
rehearsed inside a transaction with rollback before being applied, and each
refusal path was exercised by name. All are additive, so the deployed code
being older than the schema is the safe direction.

### Known, recorded rather than hidden

- The header rewrite left superseded version files on the storage volume. The
  byte accounting did not reconcile (549 MB of current objects plus 762,8 MB of
  unreferenced files exceeds the 938 MB the volume reports), so nothing was
  deleted. 35 GB free.
- Message media originals live in the **public** `media` bucket under
  `{user_id}/{timestamp}.ext`. The addresses are unguessable but not
  authorised. The private `chat-media` bucket exists and is empty.
- Until this branch deploys, a person changing their own avatar may see the old
  one for up to thirty days in the currently deployed build, which does not
  send the version token. Only 7 profiles have an avatar at all.

## 2026-09-04 - alpha closed, dated from the move to our own server

The `alpha_end` milestone was recorded. It is **write-once**: correcting it now
needs `product_milestone_correct`, which demands a reason and lands in the audit
log with the value it replaced.

**Recorded:** `2026-06-18 16:27:47 +03`, version `0.0.0`.

**Why that moment.** The owner's definition is the move of the project onto its
own server with its own domain. Three dates bracket it, and they were checked
rather than assumed:

- `2026-06-11 00:17 MSK` — the Coolify containers were created; the machine was
  being stood up but the project was not yet on it.
- `2026-06-18 16:27:47 MSK` — the self-hosted Supabase containers were created
  (`supabase-db`, `supabase-rest`, `supabase-realtime`, `supabase-storage`).
  This is the moment the project's own backend began running on our own server,
  and it is attested by the server itself rather than inferred from a commit.
- `2026-06-21` — the first commit carrying `app.letscube.ru` and
  `core.letscube.ru` (`e671a01`), i.e. the application addressed at its own
  domain.

The choice between them turned out not to matter: **12 of the 14 accounts
registered before either date** — every one in May — and the only two later
registrations are 2026-08-29 and 2026-08-31, well after all three. Both
candidate boundaries therefore name the same accounts. The server-attested
moment was recorded as the more defensible of two answers that agree.

**Of those twelve, five are test accounts. The real number of alpha testers is
seven**, out of nine real accounts. "Twelve" was reported before that
distinction was drawn and is corrected here rather than left standing: the five
QA logins exist to exercise the product and will be deleted when the work is
done, and counting them moves every figure about the product in the same
direction. `public.achievement_recipients` and `public.achievement_stats` are
now the canonical answer to "who holds this" and "how many", and both exclude
test accounts on each side of the fraction. Counting straight from
`user_achievements` is the thing to look for in review.

**Version `0.0.0`** because that is what the repository declared at the time;
`package.json` and `artifacts/kub/package.json` both read `0.0.0` at the last
commit on or before that date. Versioning began afterwards.

**Verified after recording**, each inside a transaction that was rolled back:
the oldest account (registered 2026-05-04) earns `alpha_tester`, `beta_tester`,
`conversationalist` and `settled_in`; the newest (2026-08-31) earns
`beta_tester` **only**. The audit log carries the `product_milestone_set` entry
with the date and version.

`v1_0` is deliberately left open. Until it has a date the product is still in
beta and everyone who registers earns the beta badge, which is what it should
mean today. It will be recorded when the current work is finished.

## 2026-09-04 - the alpha's start dated, and the testing before it awarded

The owner refined the boundaries: the alpha **began** when the first native
applications started being built, and the stretch before that counts as testing
done ahead of the alpha. `alpha_end` (2026-06-18, the move to our own server)
is unchanged and was not corrected — this adds the opening bracket.

**Recorded:** `alpha_start` = `2026-05-23 04:50:13 +03`, version `0.0.0`,
through `product_milestone_set`, so it is write-once and carries a
`product_milestone_set` audit entry.

**Why that commit.** `aa3e78e` "Add Android Capacitor MVP groundwork" — 60
files, 1680 insertions, 21 of them under `android/`; the first commit that makes
a native application exist. Two earlier candidates were checked and rejected
rather than assumed away:

- `2aaa3de` (2026-05-05, "Add Windows local build support") changes only
  `.gitignore`, `package.json` and the lockfile, adding
  `@rollup/rollup-win32-x64-msvc` and `lightningcss-win32-x64-msvc` — tooling
  for building on a Windows workstation, not a Windows application.
- The several May commits mentioning "mobile" are responsive-layout polish in
  the web client.

The Windows shell itself is `206d1c0`, 2026-07-12, so Android is the earlier of
the pair and therefore the boundary. Version `0.0.0` from
`git show aa3e78e:package.json` and the same for `artifacts/kub/package.json`.

**`tester` is now earned, not given.** It existed as a manual badge with
`{"kind":"manual"}` and no rule. It now uses
`{"kind":"registered_before_milestone","milestone":"alpha_start"}`, the same
mechanism as `alpha_tester` and `beta_tester`, so it cannot be handed out by
hand — which is the property the owner asked for when this machinery was built.

**The ordering hazard, and the guard.** `achievements_sync` treats a criterion
whose milestone has a null `reached_at` as qualifying *everyone* — that is how
`beta_tester` currently works against the unrecorded `v1_0`. Pointing `tester`
at an undated `alpha_start` would therefore have granted it to every account
that opened the app in the gap, permanently, because the sync inserts into
`user_achievements`. The migration separates the two steps and step 3 carries an
`exists (... reached_at is not null)` guard; the rehearsal confirmed it refuses
to run early (`UPDATE 0`, criteria untouched).

**Who holds it: 7 real people of 9 eligible** (12 of 14 accounts; five are test
logins, excluded on both sides of the fraction by `achievement_recipients` and
`achievement_stats`).

**Nobody registered during the alpha at all.** The twelve early accounts are
2026-05-04 to 2026-05-17 — all before `alpha_start` — and the next two are
2026-08-29 and 2026-08-31. So `tester` and `alpha_tester` name the same seven
people today and will keep doing so unless someone joins a window that has
historically been empty. They are kept separate because the claims differ:
`alpha_tester` is "was here during the alpha", `tester` is "was here before the
native apps existed".

**Verified in both directions before applying**, in a rolled-back transaction:
the earliest real account gains `tester` on sync (holding
`alpha_tester, beta_tester, conversationalist, settled_in` before, and those
plus `tester` after); the newest account (2026-08-31) earns `beta_tester` only.
The badge was then granted by running the ordinary per-user sync for each
qualifying account — the same function the client calls, idempotent through
`on conflict do nothing` — rather than by inserting rows.
