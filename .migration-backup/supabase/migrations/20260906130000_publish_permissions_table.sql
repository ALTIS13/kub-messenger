/**
 * The fourth table with the same defect, found after the other three.
 *
 * `20260906120000_publish_realtime_tables.sql` published chats,
 * profile_contacts and audit_logs. It was written from a list of three
 * channels; a full census of every `.channel(` in the client then turned up a
 * fourth with the same shape, which nobody had named because it is called
 * `dynamic-roles:{random}` rather than `roles:*`.
 *
 * It binds roles, permissions, role_permissions and user_global_roles. Three of
 * those are published; `public.permissions` is not, and is not added by any
 * migration in the tree. So none of the four has ever delivered — the roles
 * screen has never updated itself, and the reason was one binding out of four.
 *
 * That is the whole argument for the census: the first three were found because
 * someone noticed a symptom, and this one had no symptom anybody had reported.
 *
 * Safe on the same grounds as the other three, verified on production before
 * writing: RLS enabled with 4 policies, and realtime applies row-level security
 * to `postgres_changes`, so a subscriber receives only rows it could already
 * read. Replica identity is `default` (primary key), which is what the binding
 * needs — it carries no filter at all.
 *
 * Idempotent: adds the table only if it is not already published.
 */

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'permissions'
  ) then
    alter publication supabase_realtime add table public.permissions;
    raise notice 'published public.permissions';
  else
    raise notice 'public.permissions was already published';
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'permissions'
  ) then
    raise exception 'public.permissions is still not published';
  end if;
  if not (
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'permissions'
  ) then
    raise exception 'public.permissions is published without row-level security';
  end if;
end
$$;
