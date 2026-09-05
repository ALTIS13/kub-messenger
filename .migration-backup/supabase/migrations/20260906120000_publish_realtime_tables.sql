/**
 * Publish the three tables whose realtime bindings have never delivered.
 *
 * A channel with a binding to a table that is not in `supabase_realtime` stops
 * delivering **everything** on that channel, while still reporting SUBSCRIBED
 * and receiving a server id for each binding. It fails silently and completely.
 * That is what killed the unread counter — the sidebar's channel carried
 * bindings to both `messages` and `chats`, and the unpublished one took the
 * published one down with it. Isolated on the live server at the time by
 * subscribing the same bindings in different combinations.
 *
 * Three more channels have the same defect and have simply never worked:
 *
 *   chat-info:{id}      binds chats, chat_members, group_invites
 *                       → a chat's member list and its invites never update
 *   admin-dashboard-v2  binds profiles, bans, mutes, messages, chats, audit_logs
 *                       → the admin dashboard never refreshes by itself
 *   profile-contacts:{id}  binds profile_contacts
 *                       → phone verification state never updates live
 *
 * The client is being changed separately so that one unpublished binding can no
 * longer silence its neighbours. That makes the failure survivable; this makes
 * the features work. Both are needed, and neither replaces the other.
 *
 * SAFETY. Realtime applies row-level security to `postgres_changes`, so a
 * subscriber receives only rows its own policies already allow it to read.
 * Verified on production before writing this: all three tables have RLS enabled
 * — chats with 8 policies, profile_contacts with 4, audit_logs with 1 — so
 * publishing them widens no read that a plain select did not already permit.
 *
 * Replica identity is `default` (primary key) on all three, which is what the
 * bindings need: every filter used against them is on the primary key or on a
 * column carried by the new row of an UPDATE.
 *
 * Additive and idempotent: each table is added only if it is not already in the
 * publication, so a second apply does nothing.
 */

do $$
declare
  v_table text;
begin
  foreach v_table in array array['chats', 'profile_contacts', 'audit_logs'] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
      raise notice 'published public.%', v_table;
    else
      raise notice 'public.% was already published', v_table;
    end if;
  end loop;
end
$$;

-- ── Refuse to succeed unless all three are actually published ────────────────
-- The defect this repairs is invisible from the database side: the client
-- reports a healthy subscription either way, so nothing downstream would notice
-- a half-applied publication.
do $$
declare
  v_missing text;
begin
  select string_agg(name, ', ')
  into v_missing
  from (values ('chats'), ('profile_contacts'), ('audit_logs')) as expected(name)
  where not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = expected.name
  );
  if v_missing is not null then
    raise exception 'publication incomplete, still missing: %', v_missing;
  end if;

  -- And every one of them must still be behind RLS, because that is the whole
  -- reason publishing them is safe.
  select string_agg(c.relname, ', ')
  into v_missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('chats', 'profile_contacts', 'audit_logs')
    and c.relrowsecurity is not true;
  if v_missing is not null then
    raise exception 'published without row-level security: %', v_missing;
  end if;
end
$$;
