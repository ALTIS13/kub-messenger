"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { subscribeByTable } from "@/lib/realtimeTableChannels";
import { createClient } from "@/lib/supabase/client";
import { buildRegistrationSeries, type RegistrationPoint } from "@/pages/admin/dashboardModel";
import type { AuditLog, AuditLogWithActor, Profile } from "@/types/database";
import type { RealtimeChannel } from "@supabase/supabase-js";

export interface AdminDashboardMetrics {
  totalUsers: number;
  online: number;
  newToday: number;
  newThisWeek: number;
  totalChats: number;
  messagesToday: number;
  activeBans: number;
  activeMutes: number;
}

export interface AdminDashboardErrors {
  metrics: string | null;
  registrations: string | null;
  users: string | null;
  events: string | null;
}

export interface UseAdminDashboardResult {
  metrics: AdminDashboardMetrics;
  registrationSeries: RegistrationPoint[];
  recentUsers: Profile[];
  recentEvents: AuditLogWithActor[];
  errors: AdminDashboardErrors;
  loading: boolean;
  updatedAt: Date | null;
  refresh: () => Promise<void>;
}

const EMPTY_METRICS: AdminDashboardMetrics = {
  totalUsers: 0,
  online: 0,
  newToday: 0,
  newThisWeek: 0,
  totalChats: 0,
  messagesToday: 0,
  activeBans: 0,
  activeMutes: 0,
};

const EMPTY_ERRORS: AdminDashboardErrors = {
  metrics: null,
  registrations: null,
  users: null,
  events: null,
};

export function useAdminDashboard(): UseAdminDashboardResult {
  const supabase = createClient();
  const [metrics, setMetrics] = useState(EMPTY_METRICS);
  const [registrationSeries, setRegistrationSeries] = useState<RegistrationPoint[]>(() =>
    buildRegistrationSeries([], new Date(), 7),
  );
  const [recentUsers, setRecentUsers] = useState<Profile[]>([]);
  const [recentEvents, setRecentEvents] = useState<AuditLogWithActor[]>([]);
  const [errors, setErrors] = useState<AdminDashboardErrors>(EMPTY_ERRORS);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const loadInFlightRef = useRef(false);
  const refreshQueuedRef = useRef(false);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (loadInFlightRef.current) {
      refreshQueuedRef.current = true;
      return;
    }
    loadInFlightRef.current = true;

    const now = new Date();
    const nowIso = now.toISOString();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - 6);
    const onlineCutoffIso = new Date(now.getTime() - 60_000).toISOString();

    try {
      const [metricsResult, registrationResult, usersResult, eventsResult] = await Promise.all([
        loadMetrics(supabase, nowIso, today.toISOString(), weekStart.toISOString(), onlineCutoffIso),
        loadRegistrationSeries(supabase, weekStart.toISOString(), now),
        loadRecentUsers(supabase),
        loadRecentEvents(supabase),
      ]);

      if (!mountedRef.current) return;
      setMetrics(metricsResult.value);
      setRegistrationSeries(registrationResult.value);
      setRecentUsers(usersResult.value);
      setRecentEvents(eventsResult.value);
      setErrors({
        metrics: metricsResult.error,
        registrations: registrationResult.error,
        users: usersResult.error,
        events: eventsResult.error,
      });
      setUpdatedAt(new Date());
    } finally {
      loadInFlightRef.current = false;
      if (mountedRef.current) setLoading(false);
      if (mountedRef.current && refreshQueuedRef.current) {
        refreshQueuedRef.current = false;
        queueMicrotask(() => void refresh());
      }
    }
  }, [supabase]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  useEffect(() => {
    let timer: number | null = null;
    const scheduleRefresh = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), 450);
    };
    // One channel per table. All six bindings used to share a channel, and the
    // two that cannot be delivered — `chats` and `audit_logs` are not in the
    // `supabase_realtime` publication — silenced the four that can, so this
    // dashboard has only ever refreshed on its 30s interval and on window
    // focus, never on an actual event. A channel that binds an unpublished
    // table delivers nothing at all while still reporting SUBSCRIBED. See
    // lib/realtimeTableChannels.ts.
    const channels = subscribeByTable<typeof scheduleRefresh, RealtimeChannel>(
      supabase,
      "admin-dashboard-v2",
      [
        { event: "*", schema: "public", table: "profiles", handler: scheduleRefresh },
        { event: "*", schema: "public", table: "bans", handler: scheduleRefresh },
        { event: "*", schema: "public", table: "mutes", handler: scheduleRefresh },
        { event: "INSERT", schema: "public", table: "messages", handler: scheduleRefresh },
        { event: "INSERT", schema: "public", table: "chats", handler: scheduleRefresh },
        { event: "INSERT", schema: "public", table: "audit_logs", handler: scheduleRefresh },
      ],
    );

    return () => {
      if (timer) window.clearTimeout(timer);
      for (const { channel } of channels) void supabase.removeChannel(channel);
    };
  }, [refresh, supabase]);

  return {
    metrics,
    registrationSeries,
    recentUsers,
    recentEvents,
    errors,
    loading,
    updatedAt,
    refresh,
  };
}

type SupabaseClient = ReturnType<typeof createClient>;
type SectionResult<T> = { value: T; error: string | null };

async function loadMetrics(
  supabase: SupabaseClient,
  nowIso: string,
  todayIso: string,
  weekIso: string,
  onlineCutoffIso: string,
): Promise<SectionResult<AdminDashboardMetrics>> {
  // QA accounts are excluded from every user figure. A count that quietly
  // includes five test logins is worse than no count: it reads as growth.
  const realUsers = () =>
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("is_test_account", false);

  const results = await Promise.all([
    realUsers(),
    realUsers().gte("online_at", onlineCutoffIso),
    realUsers().gte("created_at", todayIso),
    realUsers().gte("created_at", weekIso),
    supabase.from("chats").select("id", { count: "exact", head: true }),
    supabase.from("messages").select("id", { count: "exact", head: true }).gte("created_at", todayIso),
    supabase.from("bans").select("id", { count: "exact", head: true }).or(`expires_at.is.null,expires_at.gt.${nowIso}`),
    supabase.from("mutes").select("id", { count: "exact", head: true }).or(`expires_at.is.null,expires_at.gt.${nowIso}`),
  ]);

  return {
    value: {
      totalUsers: results[0].count ?? 0,
      online: results[1].count ?? 0,
      newToday: results[2].count ?? 0,
      newThisWeek: results[3].count ?? 0,
      totalChats: results[4].count ?? 0,
      messagesToday: results[5].count ?? 0,
      activeBans: results[6].count ?? 0,
      activeMutes: results[7].count ?? 0,
    },
    error: results.some((result) => result.error) ? "Часть показателей временно недоступна" : null,
  };
}

async function loadRegistrationSeries(
  supabase: SupabaseClient,
  fromIso: string,
  now: Date,
): Promise<SectionResult<RegistrationPoint[]>> {
  const { data, error } = await supabase
    .from("profiles")
    .select("created_at")
    .gte("created_at", fromIso)
    .order("created_at", { ascending: false })
    .limit(2_000);

  return {
    value: buildRegistrationSeries(data ?? [], now, 7),
    error: error
      ? "Динамика регистраций временно недоступна"
      : data?.length === 2_000
        ? "Показаны последние 2 000 регистраций за период"
        : null,
  };
}

async function loadRecentUsers(supabase: SupabaseClient): Promise<SectionResult<Profile[]>> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,username,full_name,avatar_url,bio,online_at,role,created_at,updated_at")
    .eq("is_test_account", false)
    .order("created_at", { ascending: false })
    .limit(6);

  return {
    value: (data ?? []) as Profile[],
    error: error ? "Новые пользователи временно недоступны" : null,
  };
}

async function loadRecentEvents(supabase: SupabaseClient): Promise<SectionResult<AuditLogWithActor[]>> {
  const { data, error } = await supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(8);

  if (error) return { value: [], error: "Последние события временно недоступны" };

  const rows = (data ?? []) as AuditLog[];
  const actorIds = Array.from(new Set(rows.map((row) => row.actor_id).filter((id): id is string => Boolean(id))));
  let actors: Record<string, Profile> = {};
  if (actorIds.length > 0) {
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id,username,full_name,avatar_url,bio,online_at,role,created_at,updated_at")
      .in("id", actorIds);
    if (profileError) return { value: rows, error: "Имена участников событий временно недоступны" };
    actors = Object.fromEntries(((profiles ?? []) as Profile[]).map((profile) => [profile.id, profile]));
  }

  return {
    value: rows.map((row) => ({ ...row, actor: row.actor_id ? actors[row.actor_id] ?? null : null })),
    error: null,
  };
}
