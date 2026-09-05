"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bumpFetch, registerChannel, unregisterChannel } from "@/lib/dev/instrumentation";
import {
  ROLES_PERMISSIONS_REQUIRED_MESSAGE,
  ROLES_PERMISSIONS_STORAGE_EVENT,
  getRolesPermissionsEnabled,
  isRolesPermissionsMissingError,
  isRolesPermissionsPermissionError,
  mapRolesPermissionsError,
  setRolesPermissionsEnabled,
} from "@/lib/rolePermissions";
import { subscribeByTable } from "@/lib/realtimeTableChannels";
import { createClient, getRealtimeClient } from "@/lib/supabase/client";
import type { DynamicRole, Permission, RolePermission, UserGlobalRole } from "@/types/database";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface UseDynamicRolesOptions {
  enabled?: boolean;
  includeAssignments?: boolean;
}

type LoadOptions = {
  background?: boolean;
};

export interface DynamicRolesState {
  available: boolean;
  checked: boolean;
  loading: boolean;
  error: string | null;
  roles: DynamicRole[];
  permissions: Permission[];
  rolePermissions: RolePermission[];
  userGlobalRoles: UserGlobalRole[];
  refetch: () => Promise<void>;
}

export function useDynamicRoles(options: UseDynamicRolesOptions = {}): DynamicRolesState {
  const enabled = options.enabled ?? true;
  const includeAssignments = options.includeAssignments ?? false;
  const supabase = useMemo(() => createClient(), []);
  const rt = useMemo(() => getRealtimeClient(), []);
  const channelIdRef = useRef(`dynamic-roles:${Math.random().toString(36).slice(2)}`);
  const [available, setAvailable] = useState(false);
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [roles, setRoles] = useState<DynamicRole[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [rolePermissions, setRolePermissions] = useState<RolePermission[]>([]);
  const [userGlobalRoles, setUserGlobalRoles] = useState<UserGlobalRole[]>([]);

  const load = useCallback(
    async (options: LoadOptions = {}) => {
      const background = options.background === true;
      if (!enabled) {
        setAvailable(false);
        setChecked(true);
        setLoading(false);
        setError(null);
        setRoles([]);
        setPermissions([]);
        setRolePermissions([]);
        setUserGlobalRoles([]);
        return;
      }

      bumpFetch("useDynamicRoles");
      if (!background) setLoading(true);
      setError(null);

      const rolesQuery = supabase
        .from("roles")
        .select("*")
        .order("scope", { ascending: true })
        .order("is_system", { ascending: false })
        .order("name", { ascending: true });
      const permissionsQuery = supabase
        .from("permissions")
        .select("*")
        .order("category", { ascending: true, nullsFirst: false })
        .order("key", { ascending: true });
      const rolePermissionsQuery = supabase.from("role_permissions").select("*");
      const userRolesQuery = includeAssignments ? supabase.from("user_global_roles").select("*") : null;

      const [rolesRes, permissionsRes, rolePermissionsRes, userRolesRes] = await Promise.all([
        rolesQuery,
        permissionsQuery,
        rolePermissionsQuery,
        userRolesQuery ?? Promise.resolve({ data: [], error: null }),
      ]);

      const firstError = rolesRes.error ?? permissionsRes.error ?? rolePermissionsRes.error ?? userRolesRes.error;
      if (firstError) {
        const friendlyError = isRolesPermissionsMissingError(firstError)
          ? ROLES_PERMISSIONS_REQUIRED_MESSAGE
          : isRolesPermissionsPermissionError(firstError)
            ? "Недостаточно прав для управления ролями."
            : mapRolesPermissionsError(firstError);
        setError(friendlyError);
        if (isRolesPermissionsMissingError(firstError)) {
          setRolesPermissionsEnabled(false);
        }
        if (!isRolesPermissionsMissingError(firstError) && !isRolesPermissionsPermissionError(firstError)) {
          if (import.meta.env.DEV) console.warn("[dynamic-roles] load failed", firstError);
        }
        if (background) {
          setLoading(false);
          return;
        }
        setAvailable(false);
        setRoles([]);
        setPermissions([]);
        setRolePermissions([]);
        setUserGlobalRoles([]);
        setChecked(true);
        setLoading(false);
        return;
      }

      setAvailable(true);
      setRoles((current) => updateIfChanged(current, (rolesRes.data ?? []) as DynamicRole[], roleSignature));
      setPermissions((current) => updateIfChanged(current, (permissionsRes.data ?? []) as Permission[], permissionSignature));
      setRolePermissions((current) =>
        updateIfChanged(current, (rolePermissionsRes.data ?? []) as RolePermission[], rolePermissionSignature),
      );
      setUserGlobalRoles((current) =>
        updateIfChanged(current, (userRolesRes.data ?? []) as UserGlobalRole[], userGlobalRoleSignature),
      );
      setChecked(true);
      setLoading(false);
    },
    [enabled, includeAssignments, supabase],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!enabled || !available) return;
    let timer: number | null = null;
    const debounced = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void load({ background: true });
      }, 250);
    };
    // One channel per table. All four bindings used to share a channel, and
    // `permissions` is the one table of the four that is not in the
    // `supabase_realtime` publication — which means the channel delivered
    // nothing at all, not even the `roles` and `user_global_roles` events it
    // could have, while still reporting SUBSCRIBED. Role changes therefore
    // reached an open admin screen only on its next manual refetch. Grouped by
    // table, the inert `permissions` binding can no longer take the other three
    // with it. See lib/realtimeTableChannels.ts.
    const baseName = channelIdRef.current;
    const channels = subscribeByTable<typeof debounced, RealtimeChannel>(
      rt,
      baseName,
      [
        { event: "*", schema: "public", table: "roles", handler: debounced },
        { event: "*", schema: "public", table: "permissions", handler: debounced },
        { event: "*", schema: "public", table: "role_permissions", handler: debounced },
        { event: "*", schema: "public", table: "user_global_roles", handler: debounced },
      ],
      (name, status) => {
        if (import.meta.env.DEV) console.debug(`[${name}]`, status);
      },
    );
    for (const { name } of channels) registerChannel(name);
    return () => {
      if (timer) window.clearTimeout(timer);
      for (const { name, channel } of channels) {
        rt.removeChannel(channel);
        unregisterChannel(name);
      }
    };
  }, [available, enabled, load, rt]);

  return { available, checked, loading, error, roles, permissions, rolePermissions, userGlobalRoles, refetch: load };
}

function updateIfChanged<T>(current: T[], next: T[], signature: (item: T) => string): T[] {
  return collectionSignature(current, signature) === collectionSignature(next, signature) ? current : next;
}

function collectionSignature<T>(items: T[], signature: (item: T) => string): string {
  return items.map(signature).sort().join("|");
}

function roleSignature(role: DynamicRole): string {
  return [
    role.id,
    role.key,
    role.name,
    role.scope,
    role.is_active ? "1" : "0",
    role.is_system ? "1" : "0",
    role.updated_at,
  ].join(":");
}

function permissionSignature(permission: Permission): string {
  return [permission.key, permission.name, permission.category ?? "", permission.description ?? ""].join(":");
}

function rolePermissionSignature(permission: RolePermission): string {
  return `${permission.role_id}:${permission.permission_key}`;
}

function userGlobalRoleSignature(role: UserGlobalRole): string {
  return [role.user_id, role.role_id, role.assigned_by ?? "", role.assigned_at].join(":");
}

export function useDynamicRolesEnabledPreference(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabledState] = useState(() => getRolesPermissionsEnabled());

  useEffect(() => {
    const sync = () => setEnabledState(getRolesPermissionsEnabled());
    window.addEventListener(ROLES_PERMISSIONS_STORAGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(ROLES_PERMISSIONS_STORAGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    setRolesPermissionsEnabled(next);
    setEnabledState(next);
  }, []);

  return [enabled, setEnabled];
}
