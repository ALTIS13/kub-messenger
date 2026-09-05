import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * A structural guard on the one-channel-per-table rule.
 *
 * The failure this protects against cannot be observed from the client: a
 * channel that binds a table missing from the `supabase_realtime` publication
 * reports SUBSCRIBED, reaches state `joined`, and is assigned a server-side id
 * for every binding — and then delivers nothing, for *any* of its bindings. So
 * no behavioural test can catch the regression on a developer's machine, and
 * the feature that dies is whichever one happened to share the channel.
 *
 * See `artifacts/kub/src/lib/realtimeTableChannels.ts` for the measurement and
 * for why the rule is stated as "one channel per table" rather than "isolate
 * the unpublished tables": an allowlist of published tables would be a second
 * copy of a fact that lives in the database, and it would go stale silently and
 * dangerously.
 *
 * This scan does not read the publication, and it needs no list of published
 * tables. It only asserts the shape of the subscription. Bindings routed
 * through `subscribeByTable` are not scanned because the helper guarantees the
 * grouping by construction and is covered by
 * `realtime-table-channels.test.mts`; what is scanned is the hand-chained
 * `.channel(...).on("postgres_changes", ...)` form, which is the only way to
 * put two tables on one channel.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const srcRoot = join(here, "..", "..", "artifacts", "kub", "src");

type ChannelSite = {
  file: string;
  line: number;
  tables: string[];
};

/**
 * Chained channels that still carry more than one table.
 *
 * Every one of these binds only tables that are in the publication today, so
 * they work — but they hold exactly the shape that failed, and they are one
 * `alter publication ... drop table` away from going silent. They are listed
 * rather than converted so the residual risk is visible in the tree instead of
 * only in a report.
 *
 * This list cannot rot the way a list of published tables would. It describes
 * the source, and the source is what this test reads: converting one of these
 * to `subscribeByTable`, or changing which tables it binds, fails the second
 * assertion below until the entry is updated or deleted. It never silently
 * excuses something it no longer describes.
 */
const KNOWN_MULTI_TABLE_CHANNELS: { file: string; tables: string[] }[] = [
  { file: "hooks/useFolders.ts", tables: ["chat_members", "folder_chats", "folders"] },
  { file: "hooks/useTask.ts", tables: ["task_events", "tasks"] },
  { file: "hooks/useTaskRouting.ts", tables: ["location_members", "locations"] },
  {
    file: "lib/support/operatorApi.ts",
    tables: ["support_ticket_events", "support_ticket_messages", "support_tickets"],
  },
  { file: "pages/admin/BansMutesTab.tsx", tables: ["bans", "mutes"] },
  { file: "pages/admin/UsersTab.tsx", tables: ["profiles", "user_global_roles"] },
];

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

function relative(file: string): string {
  return file.slice(srcRoot.length + 1).split("\\").join("/");
}

/**
 * Every hand-chained `.channel(...)` in the application source, with the
 * distinct tables it binds.
 *
 * A site runs from `.channel(` to the `.subscribe(` that closes it. A site with
 * no `.subscribe(` after it is not something this scanner can judge, so it is
 * reported as a parse failure rather than passed over — a channel that silently
 * fell out of the scan is exactly the hole this test exists to close.
 */
function channelSites(): { sites: ChannelSite[]; unterminated: string[] } {
  const sites: ChannelSite[] = [];
  const unterminated: string[] = [];

  for (const file of sourceFiles(srcRoot)) {
    const source = readFileSync(file, "utf8");
    let cursor = 0;
    for (;;) {
      const start = source.indexOf(".channel(", cursor);
      if (start === -1) break;
      cursor = start + ".channel(".length;
      const end = source.indexOf(".subscribe(", start);
      if (end === -1) {
        unterminated.push(`${relative(file)}:${source.slice(0, start).split("\n").length}`);
        continue;
      }
      const block = source.slice(start, end);
      const tables = new Set<string>();
      for (const match of block.matchAll(/\btable:\s*["'`]([A-Za-z0-9_]+)["'`]/g)) {
        tables.add(match[1]);
      }
      sites.push({
        file: relative(file),
        line: source.slice(0, start).split("\n").length,
        tables: [...tables].sort(),
      });
    }
  }

  return { sites, unterminated };
}

test("every chained realtime channel is parseable", () => {
  const { sites, unterminated } = channelSites();
  assert.deepEqual(unterminated, [], "a .channel( with no .subscribe( after it cannot be checked");
  assert.ok(sites.length > 10, `expected the scan to find the application's channels, found ${sites.length}`);
});

test("no chained realtime channel binds two tables outside the known list", () => {
  const { sites } = channelSites();
  const offenders = sites
    .filter((site) => site.tables.length > 1)
    .filter(
      (site) =>
        !KNOWN_MULTI_TABLE_CHANNELS.some(
          (known) => known.file === site.file && known.tables.join(",") === site.tables.join(","),
        ),
    )
    .map((site) => `${site.file}:${site.line} binds ${site.tables.join(", ")}`);

  assert.deepEqual(
    offenders,
    [],
    "one binding to an unpublished table silences every other binding on the same channel; " +
      "pass these through subscribeByTable (artifacts/kub/src/lib/realtimeTableChannels.ts)",
  );
});

test("the known multi-table list describes channels that still exist", () => {
  const { sites } = channelSites();
  const stale = KNOWN_MULTI_TABLE_CHANNELS.filter(
    (known) =>
      !sites.some(
        (site) => site.file === known.file && site.tables.join(",") === known.tables.join(","),
      ),
  ).map((known) => `${known.file} (${known.tables.join(", ")})`);

  assert.deepEqual(stale, [], "these entries no longer match any channel and must be deleted");
});

test("the four repaired channels no longer chain more than one table", () => {
  const { sites } = channelSites();
  const repaired = [
    "components/chat/ChatInfoPanel.tsx",
    "components/sidebar/PhoneSection.tsx",
    "hooks/useAdminDashboard.ts",
    "hooks/useDynamicRoles.ts",
  ];
  for (const file of repaired) {
    const chained = sites.filter((site) => site.file === file && site.tables.length > 0);
    assert.deepEqual(
      chained.map((site) => `${site.file}:${site.line}`),
      [],
      `${file} must subscribe through subscribeByTable, not by chaining postgres_changes bindings`,
    );
  }
});
