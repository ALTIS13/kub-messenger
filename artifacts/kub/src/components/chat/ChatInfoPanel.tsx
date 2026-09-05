"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAppStore } from "@/store/app.store";
import { ChatAvatar, UserAvatar } from "@/components/ui/ChatAvatar";
import { KubIcon, KubModal, KubStableSkeleton, type KubIconName } from "@/components/kub";
import { cn } from "@/lib/utils";
import { mapPgError, prefixError } from "@/lib/errors";
import { avatarUploadPath, prepareAvatarImage, validateAvatarImage, validateAvatarUploadImage } from "@/lib/mediaUpload";
import { getChatDisplayInfo } from "@/lib/chatDisplay";
import { dispatchChatsRefresh, KUB_CHATS_REFRESH_EVENT, type ChatsRefreshDetail } from "@/lib/chatEvents";
import { requestAppConfirm, showAppAlert } from "@/lib/appDialogs";
import { subscribeByTable } from "@/lib/realtimeTableChannels";
import { MediaViewer, type MediaViewerItem } from "./MediaViewer";
import { GroupInviteModal } from "./GroupInviteModal";
import { ProfileRoleSummary } from "@/components/profile/ProfileRoleSummary";
import {
  cancelGroupInvite,
  createGroupInvite,
  formatGroupInviteError,
  GROUP_INVITES_MIGRATION_REQUIRED,
  INVITE_POLICY_MIGRATION_REQUIRED,
  isGroupInviteUnavailableError,
  isInvitePolicyUnavailableError,
} from "@/lib/groupInvites";
import type { GroupInviteStatus, InvitePolicy } from "@/lib/groupInvites";
import type { ChatWithLastMessage, Profile, Message } from "@/types/database";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { CHAT_NAME_MAX_LENGTH, limitText } from "@/lib/entityLimits";
import { useMessageMediaVariantUrls, type MessageMediaVariantUrls } from "@/hooks/useMediaVariants";
import { cacheControlFor } from "@/lib/mediaCacheControl";
import { currentViewport, type Point, type WindowPlacement } from "@/lib/floatingWindow";
import {
  profileDragPosition,
  profileWindowFrame,
  readProfileWindowPlacement,
  resolveProfileWindowEscape,
  resolveProfileWindowPlacement,
  shouldStartProfileDrag,
  writeProfileWindowPlacement,
} from "@/lib/profileWindow";
import {
  buildMessageMediaSections,
  extractFirstLink,
  isGridMediaKind,
  parseMessageMediaCounts,
  resolveActiveMediaSection,
  type ChatMediaCountRow,
  type MessageMediaCounts,
  type MessageMediaKind,
} from "@/lib/messageMediaSections";
import { copyWithFeedback } from "@/lib/actionFeedback";

interface ChatInfoPanelProps {
  chat: ChatWithLastMessage;
  onClose: () => void;
  onClearForMe?: () => Promise<{ ok: boolean; error: string | null }>;
}

type Tab = "info" | "members";

/**
 * The card root, and the contents of one media kind.
 *
 * The division used to live behind this boundary: «Общие медиа» pushed into a
 * sub-view whose own strip of tabs said what the chat contained. The counts are
 * in the card's scroll now — one row per kind, «1543 фотографии» — and the
 * sub-view is only the contents of the row that was pressed. What is left of
 * the push is the same push: one layer at a time, a back control, Escape to pop.
 */
type CardView = "root" | "gallery";

const MEDIA_PAGE_SIZE = 24;

/**
 * Links live in ordinary text messages, so they are paged by a query of their
 * own rather than with the media.
 */
const LINK_PAGE_SIZE = 60;

/** The message types that can carry an attachment worth listing. */
type MediaMessageType = Message["type"];
const MEDIA_MESSAGE_TYPES: readonly MediaMessageType[] = ["image", "video", "file", "audio"];

/**
 * Which message types a kind can be built from.
 *
 * Opening a kind narrows the query to these, so «Файлы» is reachable in a chat
 * whose recent pages hold nothing but photos. Several kinds share a type — a
 * voice note and an attached track are both `audio`, a round message and a clip
 * are both `video` — so the classifier still has the last word; this only keeps
 * the request from spending its page on rows that cannot possibly belong.
 * `link` is absent because links come from the text query instead.
 */
const MEDIA_KIND_MESSAGE_TYPES: Record<MessageMediaKind, readonly MediaMessageType[]> = {
  photo: ["image"],
  video: ["video"],
  gif: ["image", "video"],
  file: ["file"],
  link: [],
  voice: ["audio"],
  videoMessage: ["video"],
  audio: ["audio"],
};

type MemberRow = Profile & { chat_role: "owner" | "admin" | "member" };
type InviteWithProfiles = {
  id: string;
  invitee_id: string;
  inviter_id: string;
  status: GroupInviteStatus;
  created_at: string;
  expires_at: string | null;
  responded_at: string | null;
  invitee: Profile | null;
  inviter: Profile | null;
};

const DEFAULT_INVITE_POLICY: InvitePolicy = "owner_admin_only";

/** One icon per section of the shared-media sub-view. */
const MEDIA_SECTION_ICONS: Record<MessageMediaKind, KubIconName> = {
  photo: "image",
  video: "video",
  gif: "play",
  file: "file",
  link: "externalLink",
  voice: "voice",
  videoMessage: "video",
  audio: "volume",
};

export function ChatInfoPanel({ chat, onClose, onClearForMe }: ChatInfoPanelProps) {
  const { currentUser, setSelectedChatId, chats, setChats, setMessages, mutedChatIds, toggleMutedChat } = useAppStore();
  const supabase = createClient();
  // The identity, not the object. The store hands back a fresh `currentUser`
  // whenever anything on the profile changes, and the media loaders are keyed
  // on their dependencies: with the object in there, a presence update would
  // re-run them and empty the counts the card is showing.
  const currentUserId = currentUser?.id ?? null;
  const display = getChatDisplayInfo(chat, currentUser?.id ?? null);
  const isSaved = display.isSaved;
  const isGroup = !isSaved && (chat.type === "group" || chat.type === "channel");
  const storedMemberRole: "owner" | "admin" | "member" | null =
    (chat.members?.find((m) => m.user_id === currentUser?.id)?.role as
      | "owner" | "admin" | "member" | undefined) ?? null;
  const canHidePrivateChat = chat.type === "private" && !isSaved;
  const isPinned = Boolean(chat.is_pinned);
  const isMuted = mutedChatIds.includes(chat.id);

  const [tab, setTab] = useState<Tab>("info");
  const [view, setView] = useState<CardView>("root");
  const [mediaSection, setMediaSection] = useState<MessageMediaKind | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(chat.name ?? "");
  const [description, setDescription] = useState(chat.description ?? "");
  const [saving, setSaving] = useState(false);
  const [deletingChat, setDeletingChat] = useState(false);
  const [leavingChat, setLeavingChat] = useState(false);
  const [deleteGroupOpen, setDeleteGroupOpen] = useState(false);
  const [leaveGroupOpen, setLeaveGroupOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [destructiveError, setDestructiveError] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  // --- The card as a window ------------------------------------------------
  // It used to be a 320px column welded to the right edge for as long as it was
  // open. It is the same panel with the same actions; only where it sits moved.
  // Every rule about where it may sit is in `@/lib/profileWindow`, on top of the
  // geometry the support window already uses — what is left here is wiring.
  const [viewport, setViewport] = useState(currentViewport);
  const [placement, setPlacement] = useState<WindowPlacement>(() =>
    resolveProfileWindowPlacement(readProfileWindowPlacement(), currentViewport()),
  );
  // The pointer-up that ends a drag must persist the position the last
  // pointer-move produced, not the one this render happened to close over.
  const placementRef = useRef<WindowPlacement>(placement);
  const dragRef = useRef<{ pointerId: number; origin: Point; start: Point } | null>(null);
  const windowRef = useRef<HTMLDivElement | null>(null);
  const applyPlacement = useCallback((next: WindowPlacement) => {
    placementRef.current = next;
    setPlacement(next);
  }, []);
  const frame = profileWindowFrame(placement, viewport);
  const docked = frame.docked;
  const rootTitle = isSaved ? "Избранное" : isGroup ? "Информация о группе" : "Профиль пользователя";

  // A resize or a rotation can strand the card off screen; crossing the dock
  // breakpoint has to put it back into the column it came from.
  useEffect(() => {
    const onResize = () => {
      const next = currentViewport();
      setViewport(next);
      applyPlacement(resolveProfileWindowPlacement(placementRef.current, next));
    };
    window.addEventListener("resize", onResize);
    onResize();
    return () => window.removeEventListener("resize", onResize);
  }, [applyPlacement]);

  // Opening the card moves focus into it, so it can be read and dismissed from
  // the keyboard; closing it hands focus back to whatever opened it, which is
  // normally the info button in the chat header.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    windowRef.current?.focus({ preventScroll: true });
    return () => {
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      const outcome = resolveProfileWindowEscape({
        key: event.key,
        defaultPrevented: event.defaultPrevented,
        editing:
          tagName === "INPUT" || tagName === "TEXTAREA" || Boolean(target?.isContentEditable),
        // A confirmation, the invite dialog and the media viewer are all modal
        // and own Escape until they are gone. The card is not modal, which is
        // also why the shell's own Escape handler stands down while it is open.
        overlayAbove: Boolean(document.querySelector('[aria-modal="true"]')),
        // Inside the gallery, Escape means «назад», the same as the arrow.
        subview: view !== "root",
      });
      if (outcome === "ignore") return;
      event.preventDefault();
      if (outcome === "back") {
        setView("root");
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, view]);

  const onHandlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (
      !shouldStartProfileDrag({
        docked,
        button: event.button,
        target: event.target as HTMLElement | null,
      })
    ) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      origin: { x: event.clientX, y: event.clientY },
      start: placementRef.current.position,
    };
  };

  const onHandlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const current = placementRef.current;
    applyPlacement({
      ...current,
      position: profileDragPosition(
        drag,
        { x: event.clientX, y: event.clientY },
        current.size,
        currentViewport(),
      ),
    });
  };

  const endHandleDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    writeProfileWindowPlacement(placementRef.current);
  };
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invites, setInvites] = useState<InviteWithProfiles[]>([]);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteBusyId, setInviteBusyId] = useState<string | null>(null);
  const [media, setMedia] = useState<Message[]>([]);
  const [links, setLinks] = useState<Message[]>([]);
  const [linksHasMore, setLinksHasMore] = useState(false);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [mediaHasMore, setMediaHasMore] = useState(false);
  const [openMedia, setOpenMedia] = useState<MediaViewerItem | null>(null);
  /**
   * The server's totals, or null while they are unknown.
   *
   * Null is not «this chat has nothing»: it is «nobody has counted», which is
   * the state on a deployment where `chat_media_counts` has not been applied
   * yet. Everything below falls back to counting the loaded page in that case,
   * which is what the card did before.
   */
  const [mediaCounts, setMediaCounts] = useState<MessageMediaCounts | null>(null);
  /**
   * Which kind the media query is currently restricted to, or null for the
   * mixed page the card opens with.
   *
   * A kind is only worth a request of its own once its total is known, because
   * that is the only case where the card can say the loaded rows fall short.
   */
  const [mediaScope, setMediaScope] = useState<MessageMediaKind | null>(null);
  /**
   * How many rows the server has already handed over for the current scope.
   *
   * Not `media.length`: hidden rows are dropped after they arrive, so the list
   * grows more slowly than the range does. Paging from the list's length
   * re-requests rows that were already refused and, once a whole page is
   * hidden, stops advancing at all — which with automatic loading is a loop
   * rather than a stuck button.
   */
  const mediaCursorRef = useRef(0);
  const linkCursorRef = useRef(0);
  /**
   * The last automatic request came back with nothing.
   *
   * Only reachable when a total is stale — a row counted a moment ago and
   * deleted since. It stops the sentinel asking again and takes the loading
   * indicator off, so the list ends instead of spinning.
   */
  const [autoLoadStalled, setAutoLoadStalled] = useState(false);
  const [sentinelVisible, setSentinelVisible] = useState(false);
  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const mediaScrollerRef = useRef<HTMLDivElement | null>(null);
  const chatInvitePolicy = readChatInvitePolicy(chat);
  const [invitePolicy, setInvitePolicy] = useState<InvitePolicy>(chatInvitePolicy ?? DEFAULT_INVITE_POLICY);
  const [invitePolicySupported, setInvitePolicySupported] = useState(chatInvitePolicy !== null);
  const [invitePolicySaving, setInvitePolicySaving] = useState(false);
  const [invitePolicyError, setInvitePolicyError] = useState<string | null>(null);
  const localMemberRole = (members.find((member) => member.id === currentUser?.id)?.chat_role ?? null) as
    | "owner"
    | "admin"
    | "member"
    | null;
  const myRole = localMemberRole ?? storedMemberRole;
  const isOwner = myRole === "owner";
  const isOwnerOrAdmin = !isSaved && (myRole === "owner" || myRole === "admin");
  const canEditChatProfile = isGroup && isOwnerOrAdmin;
  const canSendInvites = isGroup && Boolean(myRole) && (isOwnerOrAdmin || (invitePolicySupported && invitePolicy === "members_can_invite"));

  const loadMembers = useCallback(async () => {
    if (!isGroup) {
      setMembers([]);
      return;
    }
    const { data } = await supabase
      .from("chat_members")
      .select("role, profile:profiles(*)")
      .eq("chat_id", chat.id);
    if (data) {
      setMembers(
        data.map((m) => ({ ...(m.profile as Profile), chat_role: m.role as "owner" | "admin" | "member" }))
      );
    }
  }, [chat.id, isGroup, supabase]);

  const loadInvites = useCallback(async () => {
    if (!isGroup || !isOwnerOrAdmin) {
      setInvites([]);
      setInviteError(null);
      return;
    }
    const { data, error } = await supabase
      .from("group_invites")
      .select("id,invitee_id,inviter_id,status,created_at,expires_at,responded_at,invitee:profiles!group_invites_invitee_id_fkey(*),inviter:profiles!group_invites_inviter_id_fkey(*)")
      .eq("chat_id", chat.id)
      .order("created_at", { ascending: false });
    if (error) {
      if (isGroupInviteUnavailableError(error)) {
        setInviteError(GROUP_INVITES_MIGRATION_REQUIRED);
        setInvites([]);
        return;
      }
      setInviteError(formatGroupInviteError(error, "Не удалось загрузить приглашения."));
      return;
    }
    setInviteError(null);
    setInvites(
      ((data ?? []) as Array<{
        id: string;
        invitee_id: string;
        inviter_id: string;
        status: GroupInviteStatus;
        created_at: string;
        expires_at: string | null;
        responded_at: string | null;
        invitee: Profile | null;
        inviter: Profile | null;
      }>).map((row) => ({
        ...row,
        invitee: row.invitee ?? null,
        inviter: row.inviter ?? null,
      }))
    );
  }, [chat.id, isGroup, isOwnerOrAdmin, supabase]);

  const loadInvitePolicy = useCallback(async () => {
    if (!isGroup) {
      setInvitePolicy(DEFAULT_INVITE_POLICY);
      setInvitePolicySupported(false);
      setInvitePolicyError(null);
      return;
    }
    if (chatInvitePolicy === null) {
      setInvitePolicy(DEFAULT_INVITE_POLICY);
      setInvitePolicySupported(false);
      setInvitePolicyError(null);
      return;
    }
    setInvitePolicySupported(true);
    setInvitePolicyError(null);
    setInvitePolicy(chatInvitePolicy);
  }, [chatInvitePolicy, isGroup]);

  useEffect(() => {
    void loadMembers();
    void loadInvites();
    void loadInvitePolicy();
  }, [loadInvitePolicy, loadInvites, loadMembers]);

  useEffect(() => {
    if (!isGroup) return;
    let timer: number | null = null;
    const scheduleRefresh = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void loadMembers();
        void loadInvites();
        void loadInvitePolicy();
        dispatchChatsRefresh({ reason: "membership-change", chatId: chat.id });
      }, 150);
    };
    // One channel per table. These three bindings used to share a channel, and
    // the `chats` one silenced the other two: `public.chats` is not in the
    // `supabase_realtime` publication, and a channel that binds an unpublished
    // table delivers nothing at all while still reporting SUBSCRIBED. So this
    // panel's member list and its invites have never updated live — they moved
    // only when the panel was reopened. See lib/realtimeTableChannels.ts.
    const channels = subscribeByTable<typeof scheduleRefresh, RealtimeChannel>(
      supabase,
      `chat-info:${chat.id}`,
      [
        { event: "UPDATE", schema: "public", table: "chats", filter: `id=eq.${chat.id}`, handler: scheduleRefresh },
        { event: "*", schema: "public", table: "chat_members", filter: `chat_id=eq.${chat.id}`, handler: scheduleRefresh },
        { event: "*", schema: "public", table: "group_invites", filter: `chat_id=eq.${chat.id}`, handler: scheduleRefresh },
      ],
    );
    return () => {
      if (timer) window.clearTimeout(timer);
      for (const { channel } of channels) void supabase.removeChannel(channel);
    };
  }, [chat.id, isGroup, loadInvitePolicy, loadInvites, loadMembers, supabase]);

  /**
   * One page of media, either mixed or restricted to a single kind.
   *
   * Returns how many rows the server handed over, which is the only honest
   * answer to «is there any point asking again». The count of rows that reached
   * the list is not: a page can be entirely hidden rows and still sit in front
   * of a hundred more.
   */
  const loadMedia = useCallback(async (
    reset = false,
    kind: MessageMediaKind | null = null,
  ): Promise<number> => {
    if (!currentUserId) {
      setMedia([]);
      setMediaHasMore(false);
      return 0;
    }
    setLoadingMedia(true);
    const start = reset ? 0 : mediaCursorRef.current;
    const { data: membership } = await supabase
      .from("chat_members")
      .select("cleared_at")
      .eq("chat_id", chat.id)
      .eq("user_id", currentUserId)
      .maybeSingle();
    // `audio` joined the list so voice notes have a section of their own; the
    // classifier in `messageMediaSections.ts` decides which section each row
    // lands in from `type` plus the shared voice/round-video predicates.
    //
    // A kind narrows the query to the message types it can be built from, which
    // is how «96 файлов» can be opened in a chat whose recent pages are nothing
    // but photos. `gif` spans two types because a GIF arrives as either.
    let query = supabase
      .from("messages")
      .select("*")
      .eq("chat_id", chat.id)
      .in("type", kind ? MEDIA_KIND_MESSAGE_TYPES[kind] : MEDIA_MESSAGE_TYPES)
      .is("deleted_at", null)
      .not("media_url", "is", null);
    if (membership?.cleared_at) {
      query = query.gt("created_at", membership.cleared_at);
    }
    const { data } = await query
      .order("created_at", { ascending: false })
      .range(start, start + MEDIA_PAGE_SIZE - 1);
    let received = 0;
    if (data) {
      const rawPage = data as Message[];
      received = rawPage.length;
      mediaCursorRef.current = start + received;
      const hiddenIds = await fetchHiddenMessageIdSet(supabase, rawPage.map((item) => item.id));
      const page = rawPage.filter((item) => !hiddenIds.has(item.id));
      setMedia((current) => {
        const next = reset ? page : [...current, ...page];
        return Array.from(new Map(next.map((item) => [item.id, item])).values());
      });
      setMediaHasMore(received >= MEDIA_PAGE_SIZE);
    }
    setLoadingMedia(false);
    return received;
  }, [chat.id, currentUserId, supabase]);

  /**
   * One page of links, which are ordinary text messages outside the media page.
   *
   * Deliberately additive and soft-failing: if this query is rejected the
   * «Ссылки» section simply never appears and every other section still works.
   */
  const loadLinks = useCallback(async (reset = false): Promise<number> => {
    if (!currentUserId) {
      setLinks([]);
      setLinksHasMore(false);
      return 0;
    }
    setLoadingLinks(true);
    const start = reset ? 0 : linkCursorRef.current;
    const { data: membership } = await supabase
      .from("chat_members")
      .select("cleared_at")
      .eq("chat_id", chat.id)
      .eq("user_id", currentUserId)
      .maybeSingle();
    // A single deliberately loose `ilike`: the pattern carries no `,` `:` or
    // `/` for a filter parser to trip over, and `extractFirstLink` does the
    // exact match on the client, so a row containing the word "http" and no
    // address is fetched and then dropped rather than shown.
    let query = supabase
      .from("messages")
      .select("*")
      .eq("chat_id", chat.id)
      .eq("type", "text")
      .is("deleted_at", null)
      .ilike("content", "%http%");
    if (membership?.cleared_at) {
      query = query.gt("created_at", membership.cleared_at);
    }
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .range(start, start + LINK_PAGE_SIZE - 1);
    if (error || !data) {
      if (reset) {
        setLinks([]);
        setLinksHasMore(false);
      }
      setLoadingLinks(false);
      return 0;
    }
    const rows = data as Message[];
    linkCursorRef.current = start + rows.length;
    const hiddenIds = await fetchHiddenMessageIdSet(supabase, rows.map((item) => item.id));
    const visible = rows.filter((item) => !hiddenIds.has(item.id) && extractFirstLink(item.content));
    setLinks((current) => {
      const next = reset ? visible : [...current, ...visible];
      return Array.from(new Map(next.map((item) => [item.id, item])).values());
    });
    setLinksHasMore(rows.length >= LINK_PAGE_SIZE);
    setLoadingLinks(false);
    return rows.length;
  }, [chat.id, currentUserId, supabase]);

  /**
   * The exact totals, counted where the rows are.
   *
   * Soft-failing on purpose. `chat_media_counts` is applied separately from the
   * bundle, so a deployment that has the client and not the function must show
   * the card it showed before rather than an error: `null` counts put every
   * section back on «what the loaded page contains».
   */
  const loadMediaCounts = useCallback(async () => {
    if (!currentUserId) {
      setMediaCounts(null);
      return;
    }
    const { data, error } = await supabase.rpc("chat_media_counts", { p_chat_id: chat.id });
    if (error || !data) {
      setMediaCounts(null);
      return;
    }
    setMediaCounts(parseMessageMediaCounts(data as ChatMediaCountRow[]));
  }, [chat.id, currentUserId, supabase]);

  /**
   * The counts are on the card root, so they are loaded with the card.
   *
   * This used to wait for «Общие медиа» to be pressed, which was affordable
   * while the division lived behind that press. It cannot wait now: the card
   * decides which rows exist from what came back, and a row it has not loaded
   * yet is indistinguishable from a kind this chat has never contained.
   *
   * Both loaders are keyed on `chat.id` and `currentUserId` alone, so this runs
   * once per chat rather than on every render of the card.
   */
  useEffect(() => {
    setMedia([]);
    setLinks([]);
    setLinksHasMore(false);
    setMediaHasMore(false);
    setMediaCounts(null);
    setMediaScope(null);
    setAutoLoadStalled(false);
    mediaCursorRef.current = 0;
    linkCursorRef.current = 0;
    setOpenMedia(null);
    setMediaSection(null);
    setView("root");
    void loadMediaCounts();
    void loadMedia(true);
    void loadLinks(true);
  }, [loadMedia, loadLinks, loadMediaCounts]);

  useEffect(() => {
    const handleHiddenMessage = (event: Event) => {
      const detail = (event as CustomEvent<ChatsRefreshDetail>).detail;
      if (detail?.reason !== "message-hidden" || detail.chatId !== chat.id) return;
      if (detail.messageId) {
        setMedia((current) => current.filter((item) => item.id !== detail.messageId));
        setLinks((current) => current.filter((item) => item.id !== detail.messageId));
        // The server counted that row a moment ago, so the total has to be
        // taken again rather than adjusted by one from here: which section the
        // row belonged to is not known at this point.
        void loadMediaCounts();
        return;
      }
      // No longer conditional on the gallery being open: the counts are on the
      // root, so a hidden message has to be taken off them there too.
      mediaCursorRef.current = 0;
      linkCursorRef.current = 0;
      void loadMediaCounts();
      void loadMedia(true, mediaScope);
      void loadLinks(true);
    };
    window.addEventListener(KUB_CHATS_REFRESH_EVENT, handleHiddenMessage);
    return () => window.removeEventListener(KUB_CHATS_REFRESH_EVENT, handleHiddenMessage);
  }, [chat.id, loadLinks, loadMedia, loadMediaCounts, mediaScope]);

  const handleSave = async () => {
    setSaving(true);
    const trimmedName = name.trim();
    if (trimmedName.length > CHAT_NAME_MAX_LENGTH) {
      setSaving(false);
      return;
    }
    const { data } = await supabase
      .from("chats")
      .update({ name: trimmedName || null, description: description.trim() || null, updated_at: new Date().toISOString() })
      .eq("id", chat.id)
      .select("*")
      .single();
    if (data) {
      setChats(chats.map((c) => c.id === chat.id ? { ...c, name: data.name, description: data.description } : c));
    }
    setSaving(false);
    setEditing(false);
  };

  const handleAvatarChange = async (file: File) => {
    if (!currentUser) return;
    const validationError = validateAvatarImage(file);
    if (validationError) {
      setAvatarError(validationError);
      showAppAlert(validationError, "Аватар не загружен");
      return;
    }
    setAvatarError(null);
    const preparedFile = await prepareAvatarImage(file);
    const preparedValidationError = validateAvatarUploadImage(preparedFile);
    if (preparedValidationError) {
      setAvatarError(preparedValidationError);
      showAppAlert(preparedValidationError, "Аватар не загружен");
      return;
    }
    const path = avatarUploadPath("chat", chat.id, preparedFile);
    const { data, error } = await supabase.storage.from("media")
      .upload(path, preparedFile, {
        contentType: preparedFile.type,
        upsert: false,
        cacheControl: cacheControlFor(path),
      });
    if (error) {
      const message = prefixError("Не удалось загрузить аватар чата", error);
      setAvatarError(message);
      showAppAlert(message, "Ошибка");
      return;
    }
    const { data: { publicUrl } } = supabase.storage.from("media").getPublicUrl(data.path);
    const { error: updateErr } = await supabase.from("chats").update({ avatar_url: publicUrl }).eq("id", chat.id);
    if (updateErr) {
      const message = prefixError("Не удалось сохранить аватар чата", updateErr);
      setAvatarError(message);
      showAppAlert(message, "Ошибка");
      return;
    }
    setChats(chats.map((c) => c.id === chat.id ? { ...c, avatar_url: publicUrl } : c));
  };

  const handleLeave = async () => {
    if (!currentUser || leavingChat) return;
    setDestructiveError(null);
    setLeavingChat(true);
    const { error } = await supabase.from("chat_members")
      .delete().eq("chat_id", chat.id).eq("user_id", currentUser.id);
    if (error) {
      // Most likely the last-owner protection (P0001).  Surface the
      // server-side message so the user understands why nothing happened.
      console.error("leave chat failed:", error);
      setDestructiveError(mapPgError(error));
      setLeavingChat(false);
      return;
    }
    setLeavingChat(false);
    setLeaveGroupOpen(false);
    setChats(chats.filter((c) => c.id !== chat.id));
    setSelectedChatId(null);
    onClose();
  };

  const handleDeleteGroup = async () => {
    if (!isGroup || !isOwner || deletingChat) return;
    setDestructiveError(null);

    setDeletingChat(true);
    const { data, error } = await supabase
      .from("chats")
      .delete()
      .eq("id", chat.id)
      .select("id")
      .maybeSingle();
    setDeletingChat(false);

    if (error) {
      console.error("delete group chat failed:", error);
      setDestructiveError(prefixError("Не удалось удалить групповой чат", error));
      return;
    }

    if (!data) {
      setDestructiveError("Недостаточно прав для удаления этого чата.");
      return;
    }

    setDeleteGroupOpen(false);
    setChats(chats.filter((c) => c.id !== chat.id));
    setSelectedChatId(null);
    onClose();
  };

  const handlePinToggle = async () => {
    const rpcName = isPinned ? "unpin_chat" : "pin_chat";
    const { error } = await supabase.rpc(rpcName, { p_chat_id: chat.id });
    if (error) {
      showAppAlert(prefixError(isPinned ? "Не удалось открепить чат" : "Не удалось закрепить чат", error), "Ошибка");
      return;
    }
    setChats(chats.map((c) =>
      c.id === chat.id
        ? { ...c, is_pinned: !isPinned, pinned_at: isPinned ? null : new Date().toISOString() }
        : c
    ));
    dispatchChatsRefresh({ reason: "membership-change", chatId: chat.id });
  };

  const handleClearForMe = async () => {
    if (!onClearForMe) return;
    const title = isSaved ? "Очистить избранное у себя?" : "Очистить историю у себя?";
    const body = "Сообщения и вложения будут скрыты только у вас. У других участников они останутся. Файлы из хранилища не удаляются.";
    const confirmed = await requestAppConfirm({
      title,
      description: body,
      confirmLabel: "Очистить",
      tone: "danger",
      icon: "delete",
    });
    if (!confirmed) return;
    const result = await onClearForMe();
    if (!result.ok) {
      showAppAlert(result.error ?? "Не удалось очистить историю у себя.", "Ошибка");
      return;
    }
    const clearedAt = new Date().toISOString();
    setMessages(chat.id, []);
    setChats(chats.map((c) =>
      c.id === chat.id
        ? { ...c, last_message: undefined, unread_count: 0, cleared_at: clearedAt }
        : c
    ));
    setMedia([]);
    setLinks([]);
    setLinksHasMore(false);
    setMediaHasMore(false);
    setOpenMedia(null);
    dispatchChatsRefresh({ reason: "membership-change", chatId: chat.id });
  };

  const handleHidePrivateChat = async () => {
    if (!canHidePrivateChat) return;
    const confirmed = await requestAppConfirm({
      title: "Удалить чат у себя?",
      description: "Чат исчезнет только из вашего списка. У собеседника история останется.",
      confirmLabel: "Удалить у себя",
      tone: "danger",
      icon: "logout",
    });
    if (!confirmed) return;
    const { error } = await supabase.rpc("hide_private_chat", { p_chat_id: chat.id });
    if (error) {
      showAppAlert(prefixError("Не удалось удалить чат у себя", error), "Ошибка");
      return;
    }
    setMessages(chat.id, []);
    setMedia([]);
    setLinks([]);
    setLinksHasMore(false);
    setMediaHasMore(false);
    setOpenMedia(null);
    setChats(chats.filter((c) => c.id !== chat.id));
    setSelectedChatId(null);
    dispatchChatsRefresh({ reason: "membership-change", chatId: chat.id });
    onClose();
  };

  const handleRemoveMember = async (userId: string) => {
    const { error } = await supabase.from("chat_members")
      .delete().eq("chat_id", chat.id).eq("user_id", userId);
    if (error) {
      console.error("removeMember failed:", error);
      showAppAlert(prefixError("Не удалось удалить участника", error), "Ошибка");
      return;
    }
    setMembers((m) => m.filter((u) => u.id !== userId));
    void loadMembers();
    void loadInvites();
    dispatchChatsRefresh({ reason: "membership-change", chatId: chat.id });
  };

  const setMemberRole = async (userId: string, role: "admin" | "member") => {
    const { error } = await supabase
      .from("chat_members").update({ role })
      .eq("chat_id", chat.id).eq("user_id", userId);
    if (error) {
      // Triggered by the role-change matrix (only owner) or the
      // last-owner protection trigger.
      console.error("setMemberRole:", error);
      showAppAlert(prefixError("Не удалось изменить роль", error), "Ошибка");
      return;
    }
    setMembers((ms) => ms.map((m) => m.id === userId ? { ...m, chat_role: role } : m));
    void loadMembers();
  };

  const handleInvitePolicyChange = async (nextPolicy: InvitePolicy) => {
    if (!isOwnerOrAdmin || invitePolicySaving || invitePolicy === nextPolicy) return;
    if (!invitePolicySupported) {
      setInvitePolicyError(INVITE_POLICY_MIGRATION_REQUIRED);
      return;
    }
    setInvitePolicySaving(true);
    setInvitePolicyError(null);
    const { data, error } = await supabase
      .from("chats")
      .update({ invite_policy: nextPolicy })
      .eq("id", chat.id)
      .select("invite_policy")
      .maybeSingle();
    setInvitePolicySaving(false);
    if (error) {
      if (isInvitePolicyUnavailableError(error)) {
        setInvitePolicySupported(false);
        setInvitePolicyError(INVITE_POLICY_MIGRATION_REQUIRED);
        return;
      }
      setInvitePolicyError("Не удалось изменить режим приглашений.");
      return;
    }
    const savedPolicy = normalizeInvitePolicy(data?.invite_policy);
    setInvitePolicy(savedPolicy);
    setChats(chats.map((item) =>
      item.id === chat.id ? { ...item, invite_policy: savedPolicy } : item
    ));
    dispatchChatsRefresh({ reason: "membership-change", chatId: chat.id });
  };

  const handleCancelInvite = async (invite: InviteWithProfiles) => {
    if (inviteBusyId) return;
    setInviteBusyId(invite.id);
    setInviteError(null);
    const result = await cancelGroupInvite(supabase, invite.id);
    setInviteBusyId(null);
    if (!result.ok) {
      setInviteError(result.message);
      return;
    }
    await loadInvites();
  };

  const handleReinvite = async (invite: InviteWithProfiles) => {
    if (inviteBusyId) return;
    setInviteBusyId(invite.id);
    setInviteError(null);
    const result = await createGroupInvite(supabase, chat.id, invite.invitee_id);
    setInviteBusyId(null);
    if (!result.ok) {
      setInviteError(result.message);
      return;
    }
    await loadInvites();
  };

  const roleLabel = (role: string) =>
    role === "owner" ? "Владелец" : role === "admin" ? "Администратор" : "";

  const otherUser = !isGroup ? (chat.other_user as Profile | null) : null;

  // Фото, видео, GIF, файлы, ссылки, голосовые, видеосообщения, аудио — from
  // the server's totals where there are any, and from the loaded rows where
  // there are not. A section holding nothing is never built, so the card only
  // ever offers a row for what this chat actually contains — and now offers one
  // for every kind it contains, including the kinds no loaded page reached.
  const mediaSections = useMemo(
    () => buildMessageMediaSections([...media, ...links], {
      hasMore: mediaHasMore,
      hasMoreLinks: linksHasMore,
      counts: mediaCounts,
    }),
    [media, links, mediaHasMore, linksHasMore, mediaCounts],
  );
  const activeMediaSection = resolveActiveMediaSection(mediaSections, mediaSection);
  const activeSection = mediaSections.find((section) => section.kind === activeMediaSection) ?? null;
  // The sub-view is one kind now, so the title bar names it. It falls back to
  // the old wording only in the moment between the last row of a kind being
  // cleared and the pop that follows it.
  const windowTitle = view === "gallery" ? (activeSection?.label ?? "Общие медиа") : rootTitle;
  const mediaGridItems = useMemo(
    () => media.filter((m) => m.type === "image" || m.type === "video"),
    [media],
  );
  const mediaVariantUrls = useMessageMediaVariantUrls(mediaGridItems);
  const memberIdSet = useMemo(() => new Set(members.map((member) => member.id)), [members]);
  const visibleInvites = useMemo(
    () => invites.filter((invite) => !(invite.status === "accepted" && memberIdSet.has(invite.invitee_id))),
    [invites, memberIdSet],
  );
  /**
   * Whether the open section is worth asking the server about again.
   *
   * Per section, not per panel. The button this replaced asked the media page
   * counter, so it appeared under «Ссылки» — which that counter cannot extend —
   * and offered to fetch a section that was already complete.
   * `section.hasMore` is `loaded < total` once the total is known, which is the
   * reliable form of the question.
   */
  const sectionLoading = activeSection?.kind === "link" ? loadingLinks : loadingMedia;
  const sectionHasMore = activeSection?.hasMore === true && !autoLoadStalled;

  /**
   * The next page of whatever is open.
   *
   * Two guards, and both are needed. `sectionLoading` keeps one request in
   * flight; `autoLoadStalled` handles the case the first guard cannot see, a
   * request that comes back with nothing while the total still says there is
   * more — a stale total, a row deleted since it was counted. Without it the
   * sentinel stays on screen, the effect fires again on every completion, and
   * the panel spins against the server for as long as it is open.
   */
  const loadMoreActiveSection = useCallback(async () => {
    if (!activeSection || activeSection.hasMore !== true) return;
    if (autoLoadStalled) return;
    // The state flags below are the ones a reader can see; this ref is the one
    // that cannot be stale. A render has to happen before `loadingMedia` is
    // visible here, and a second press does not have to wait for one.
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    try {
      if (activeSection.kind === "link") {
        if (loadingLinks) return;
        if ((await loadLinks(false)) === 0) setAutoLoadStalled(true);
        return;
      }
      if (loadingMedia) return;
      if ((await loadMedia(false, mediaScope)) === 0) setAutoLoadStalled(true);
    } finally {
      loadingMoreRef.current = false;
    }
  }, [activeSection, autoLoadStalled, loadLinks, loadMedia, loadingLinks, loadingMedia, mediaScope]);

  /**
   * Load the next page when the reader reaches the end of the list.
   *
   * The sentinel is watched rather than the scroll offset, and the effect below
   * re-runs when a load finishes: a page that adds nothing visible leaves the
   * sentinel where it was, and an observer only reports a change, so without the
   * second look a short page would end the list early.
   */
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || view !== "gallery" || !sectionHasMore) {
      setSentinelVisible(false);
      return;
    }
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => setSentinelVisible(entries.some((entry) => entry.isIntersecting)),
      { root: mediaScrollerRef.current, rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [view, sectionHasMore, activeMediaSection]);

  useEffect(() => {
    if (!sentinelVisible) return;
    void loadMoreActiveSection();
  }, [sentinelVisible, loadMoreActiveSection]);

  /**
   * Pressing a counted row opens that kind, and only that kind.
   *
   * Once the totals are known the query is narrowed to the message types that
   * kind can be built from. That is what makes «96 файлов» openable in a chat
   * whose recent pages hold nothing but photos — the row exists because the
   * chat holds ninety-six files, and it would open on an empty list otherwise.
   * Without totals nothing is narrowed and the sub-view behaves as it did.
   */
  const openMediaSection = (kind: MessageMediaKind) => {
    setMediaSection(kind);
    setView("gallery");
    setAutoLoadStalled(false);
    if (!mediaCounts || kind === "link" || mediaScope === kind) return;
    setMediaScope(kind);
    mediaCursorRef.current = 0;
    void loadMedia(true, kind);
  };

  const copyUsername = async () => {
    if (!otherUser?.username) return;
    await copyWithFeedback(`@${otherUser.username}`, {
      success: "Никнейм скопирован",
      error: "Не удалось скопировать никнейм",
      key: "username",
    });
  };

  const tabLabels: Record<Tab, string> = { info: "Сведения", members: "Участники" };
  // A hover is the «immediate» step of the shared scale, and it is a colour, so
  // nothing with a size moves. Taking the duration from the token rather than
  // from Tailwind's built-in 150ms is also what makes reduced motion reach it:
  // the tokens collapse to 1ms under the preference, a literal does not.
  const rowMotionClass =
    "transition-colors duration-[var(--kub-motion-instant)] ease-[var(--kub-ease-standard)]";
  // D-047: `kub-button focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]` is the opt-in for the 44px touch rule. These rows are
  // 357x36 without it, and this card is one of the two surfaces rebuilt after
  // the rule was written, so it had never been opted in. The class costs
  // nothing on a pointer device — it only carries the coarse-pointer minimum.
  const actionRowClass = cn(
    "kub-button inline-flex min-w-0 items-center gap-3 w-full py-2 text-sm rounded-xl px-2 text-left kub-raise-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]",
    rowMotionClass,
  );
  const dangerActionRowClass = cn(
    "kub-button inline-flex min-w-0 items-center gap-3 w-full py-2 text-sm rounded-xl px-2 text-left text-[color:var(--kub-danger-text)] hover:bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]",
    rowMotionClass,
  );

  return (
    <div
      ref={windowRef}
      role="dialog"
      aria-label={windowTitle}
      tabIndex={-1}
      className={cn(frame.className, "outline-none")}
      style={frame.style}
      data-testid="chat-info-panel"
      data-docked={docked ? "true" : "false"}
    >
      <div
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={endHandleDrag}
        onPointerCancel={endHandleDrag}
        className={cn(
          // D-047: the tracks size to what they hold rather than to a fixed 2.5rem,
          // so a control that grows to the 44px touch minimum on a coarse
          // pointer is not overflowing a 40px column.
          "kub-glass-strong sticky top-0 z-20 grid h-[var(--kub-control-row-height)] flex-shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-[color:var(--kub-border-color)] px-3",
          // The title bar is the handle. `touch-none` stops a drag on a tablet
          // from scrolling the page instead of moving the card.
          docked ? "" : "cursor-grab touch-none select-none active:cursor-grabbing",
        )}
        data-testid="chat-info-header"
      >
        {/* One slot, two meanings: inside a sub-view the leading control goes
            back to the card root rather than closing the card, which is what
            the arrow says and what Escape does. */}
        {view === "gallery" ? (
          <button
            onClick={() => setView("root")}
            className="kub-icon-action h-9 w-9 rounded-lg text-[color:var(--kub-muted)] transition-colors kub-raise-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]"
            aria-label="Назад"
            data-testid="chat-info-back"
          >
            <KubIcon name="chevronLeft" size={18} />
          </button>
        ) : (
          <button
            onClick={onClose}
            className="kub-icon-action h-9 w-9 rounded-lg text-[color:var(--kub-muted)] transition-colors kub-raise-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]"
            aria-label="Закрыть"
          >
            <KubIcon name="close" size={18} />
          </button>
        )}
        <span className="min-w-0 truncate text-center text-sm font-semibold text-[color:var(--kub-text)]">
          {windowTitle}
        </span>
        <div className="flex min-h-9 min-w-9 items-center justify-center justify-self-end">
          {canEditChatProfile && !editing && view === "root" && (
            <button
              onClick={() => setEditing(true)}
              className="kub-icon-action h-9 w-9 rounded-lg text-[color:var(--kub-cyan)] kub-raise-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]"
              aria-label="Редактировать"
            >
              <KubIcon name="edit" size={16} />
            </button>
          )}
          {editing && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="kub-icon-action h-9 w-9 rounded-lg text-[color:var(--kub-cyan)] kub-raise-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]"
              aria-label="Сохранить"
            >
              <KubIcon name="check" size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Two layers, one visible at a time. The box already has a size, so the
          push moves them without resizing anything — see `.kub-subview`. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
      <div
        className="kub-subview absolute inset-0 overflow-y-auto"
        data-state={view === "root" ? "current" : "behind"}
        data-testid="chat-info-root-view"
        inert={view !== "root"}
      >
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-4 px-4 flex-shrink-0 border-b border-[color:var(--kub-border-color)] kub-grid-subtle" data-testid="chat-info-summary">
        <div className="relative">
          <ChatAvatar
            chat={{ id: chat.id, name: display.title, avatar_url: chat.avatar_url ?? null, type: chat.type }}
            size="xl"
            isSaved={display.isSaved}
          />
          {canEditChatProfile && (
            <label className="absolute bottom-0 right-0 w-9 h-9 rounded-full flex items-center justify-center cursor-pointer bg-[var(--kub-cyan)] text-[color:var(--kub-bg)] kub-glow-cyan">
              <KubIcon name="camera" size={14} label="Сменить аватар" />
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAvatarChange(f); }}
              />
            </label>
          )}
          {avatarError && (
            <div className="text-xs text-center text-[color:var(--kub-danger-text)]">
              {avatarError}
            </div>
          )}
        </div>

        {editing ? (
          <div className="col-start-2 row-span-2 w-full min-w-0 space-y-2">
            <input
              value={name}
              onChange={(e) => setName(limitText(e.target.value, CHAT_NAME_MAX_LENGTH))}
              maxLength={CHAT_NAME_MAX_LENGTH}
              className="w-full text-sm rounded-xl px-3 py-2 text-center font-semibold bg-[var(--kub-surface-2)] text-[color:var(--kub-text)] border border-[color:var(--kub-border-color)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Описание…"
              rows={2}
              className="w-full text-sm rounded-xl px-3 py-2 resize-none bg-[var(--kub-surface-2)] text-[color:var(--kub-text)] border border-[color:var(--kub-border-color)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
            />
          </div>
        ) : (
          <>
            <div
              className="col-start-2 row-start-1 w-full max-w-full text-left text-base font-semibold leading-snug text-[color:var(--kub-text)] line-clamp-2 [overflow-wrap:anywhere]"
              title={display.title}
            >
              {display.title}
            </div>
            {isSaved ? (
              <div className="col-start-2 row-start-2 text-left text-xs text-[color:var(--kub-muted)]">
                Личное пространство для сохранённых сообщений
              </div>
            ) : isGroup ? (
              <div className="col-start-2 row-start-2 text-left text-xs text-[color:var(--kub-muted)]">
                {members.length || chat.members?.length || 0} участников
              </div>
            ) : otherUser?.username ? (
              // Carried over from the chat-list mini-profile this card replaced:
              // copying the nickname was the one affordance that surface had and
              // this one did not.
              <div className="col-start-2 row-start-2 inline-flex min-w-0 items-center gap-1 text-left text-xs text-[color:var(--kub-muted)]">
                <span className="truncate">@{otherUser.username}</span>
                <button
                  type="button"
                  data-testid="chat-info-copy-username"
                  onClick={() => void copyUsername()}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-cyan)]"
                  aria-label="Скопировать никнейм"
                  title="Скопировать никнейм"
                >
                  <KubIcon name="copy" size={12} />
                </button>
              </div>
            ) : (
              <div className="col-start-2 row-start-2 text-left text-xs text-[color:var(--kub-muted)]">
                Без имени пользователя
              </div>
            )}
            {chat.description && (
              <p className="col-span-2 mt-2 max-w-full text-left text-xs text-[color:var(--kub-muted)] line-clamp-3 [overflow-wrap:anywhere]">
                {chat.description}
              </p>
            )}
          </>
        )}
      </div>

      {/* The summary scrolls away with the content; the tabs do not, so a long
          member list is still switchable without scrolling back up. */}
      {isGroup && (
        <div className="kub-glass-strong sticky top-0 z-10 flex flex-shrink-0 border-b border-[color:var(--kub-border-color)]">
          {(["info", "members"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "relative flex-1 py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors",
                tab === t ? "text-[color:var(--kub-accent-text)]" : "text-[color:var(--kub-muted)] hover:text-[color:var(--kub-text)]"
              )}
            >
              {t === "members"
                ? <KubIcon name="users" size={14} className="mx-auto mb-0.5" />
                : null}
              {tabLabels[t]}
              {tab === t && (
                <span className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-[var(--kub-cyan)] kub-glow-soft" />
              )}
            </button>
          ))}
        </div>
      )}

        {(tab === "info" || !isGroup) && (
          <div>
            {!isGroup && otherUser && (
              <div className="px-4 py-3 border-b border-[color:var(--kub-rule)]">
                <ProfileRoleSummary user={otherUser} compact />
              </div>
            )}
            {!isGroup && otherUser?.bio && (
              <div className="px-4 py-3 border-b border-[color:var(--kub-rule)]">
                <div className="text-[12px] uppercase tracking-wider mb-1 text-[color:var(--kub-accent-text)]">О себе</div>
                <div className="text-sm text-[color:var(--kub-text)]">{otherUser.bio}</div>
              </div>
            )}
            <div className="px-4 py-3 space-y-1">
              <button
                onClick={() => toggleMutedChat(chat.id)}
                className={cn(actionRowClass, "text-[color:var(--kub-text)]")}
              >
                <KubIcon name={isMuted ? "notificationsOff" : "notifications"} size={17} tone={isMuted ? "accent" : "muted"} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">
                  {isMuted ? "Включить уведомления" : "Отключить уведомления"}
                </span>
              </button>
              {isGroup && canSendInvites && (
                <button
                  onClick={() => setInviteOpen(true)}
                  className={cn(actionRowClass, "text-[color:var(--kub-text)]")}
                >
                  <KubIcon name="userPlus" size={17} tone="muted" className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">Пригласить пользователя</span>
                </button>
              )}
              {isGroup && (
                <div className="rounded-xl px-3 py-2 kub-raise">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[color:var(--kub-text)]">Кто может приглашать</div>
                      <div className="text-xs text-[color:var(--kub-muted)]">
                        {invitePolicy === "members_can_invite" ? "Все участники" : "Только администраторы"}
                      </div>
                    </div>
                    {!invitePolicySupported && (
                      <span className="shrink-0 rounded-full border border-[color:var(--kub-border-color)] px-2 py-0.5 text-[12px] font-semibold text-[color:var(--kub-muted)]">
                        Недоступно
                      </span>
                    )}
                  </div>
                  {isOwnerOrAdmin && (
                    <div className="grid grid-cols-2 gap-1">
                      <button
                        type="button"
                        disabled={!invitePolicySupported || invitePolicySaving}
                        onClick={() => void handleInvitePolicyChange("owner_admin_only")}
                        className={cn(
                          "h-8 rounded-lg px-2 text-xs font-semibold transition-colors disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed",
                          invitePolicy === "owner_admin_only"
                            ? "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]"
                            : "border border-[color:var(--kub-border-color)] text-[color:var(--kub-muted)] kub-raise-hover",
                        )}
                      >
                        Администраторы
                      </button>
                      <button
                        type="button"
                        disabled={!invitePolicySupported || invitePolicySaving}
                        onClick={() => void handleInvitePolicyChange("members_can_invite")}
                        className={cn(
                          "h-8 rounded-lg px-2 text-xs font-semibold transition-colors disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed",
                          invitePolicy === "members_can_invite"
                            ? "bg-[var(--kub-cyan)] text-[color:var(--kub-bg)]"
                            : "border border-[color:var(--kub-border-color)] text-[color:var(--kub-muted)] kub-raise-hover",
                        )}
                      >
                        Все участники
                      </button>
                    </div>
                  )}
                  {!invitePolicySupported && isOwnerOrAdmin && (
                    <div className="mt-2 text-xs text-[color:var(--kub-muted)]">
                      {INVITE_POLICY_MIGRATION_REQUIRED}
                    </div>
                  )}
                  {invitePolicyError && (
                    <div className="mt-2 text-xs text-[color:var(--kub-danger-text)]">
                      {invitePolicyError}
                    </div>
                  )}
                </div>
              )}
              {isGroup && chat.type === "group" && isOwner && (
                <button
                  onClick={async () => {
                    const next = !chat.is_forum;
                    const confirmed = await requestAppConfirm({
                      title: next ? "Включить режим топиков?" : "Выключить режим топиков?",
                      description: next
                        ? "Все будущие сообщения можно будет отправлять в общий раздел или выбранный топик."
                        : "Топики останутся в базе, но чат вернётся к обычному отображению.",
                      confirmLabel: next ? "Включить" : "Выключить",
                      icon: "hash",
                    });
                    if (!confirmed) return;
                    const { error: updErr } = await supabase
                      .from("chats").update({ is_forum: next }).eq("id", chat.id);
                    if (updErr) {
                      console.error("toggle is_forum failed:", updErr);
                      showAppAlert(prefixError("Не удалось переключить режим топиков", updErr), "Ошибка");
                      return;
                    }
                    setChats(chats.map((c) => c.id === chat.id ? { ...c, is_forum: next } : c));
                    if (next) {
                      const { data: existing } = await supabase
                        .from("topics").select("id").eq("chat_id", chat.id).eq("is_general", true).maybeSingle();
                      if (!existing) {
                        const { error: tErr } = await supabase.from("topics").insert({
                          chat_id: chat.id, name: "Общий", emoji: "💬", is_general: true, position: 0,
                        });
                        if (tErr) console.error("create general topic failed:", tErr);
                      }
                    }
                  }}
                  className={cn(actionRowClass, "text-[color:var(--kub-text)]")}
                >
                  <KubIcon
                    name="hash"
                    size={17}
                    tone={chat.is_forum ? "accent" : "muted"}
                    className="shrink-0"
                  />
                  <span className="flex-1 text-left">Топики</span>
                  <span className={cn(
                    "text-[12px] uppercase tracking-wide font-semibold",
                    chat.is_forum ? "text-[color:var(--kub-accent-text)]" : "text-[color:var(--kub-muted)]"
                  )}>
                    {chat.is_forum ? "Вкл" : "Выкл"}
                  </span>
                </button>
              )}
            </div>
            {/* What this chat holds, counted, one kind per line.

                Not a strip of tabs behind «Общие медиа»: the point of the
                division is knowing there are 96 files without going looking for
                them, and a count is only worth having where it can be read
                without a press. A kind with nothing in it has no row at all —
                `buildMessageMediaSections` never builds one — so the band is
                absent entirely in a chat that has only ever carried text. */}
            {mediaSections.length > 0 && (
              <div
                className="px-4 py-3 mt-2 space-y-1 border-t border-[color:var(--kub-rule)]"
                data-testid="chat-info-media-rows"
              >
                {mediaSections.map((section) => (
                  <button
                    key={section.kind}
                    type="button"
                    onClick={() => openMediaSection(section.kind)}
                    className={cn(actionRowClass, "text-[color:var(--kub-text)]")}
                    data-testid="chat-info-media-row"
                    data-media-kind={section.kind}
                  >
                    <KubIcon
                      name={MEDIA_SECTION_ICONS[section.kind]}
                      size={17}
                      tone="muted"
                      className="shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate">{section.countedLabel}</span>
                    <KubIcon name="chevronRight" size={16} tone="muted" className="shrink-0" />
                  </button>
                ))}
              </div>
            )}
            {/* One row, not three: a placeholder standing in for a count the
                card does not have yet must not imply how many rows are coming.
                Absence would read as «this chat has no shared media», which is
                a claim nothing has established while the query is in flight. */}
            {mediaSections.length === 0 && loadingMedia && (
              <div
                className="px-4 py-3 mt-2 border-t border-[color:var(--kub-rule)]"
                data-testid="chat-info-media-loading"
              >
                <div className="flex items-center gap-3 px-2 py-2">
                  <KubStableSkeleton width="17px" height="17px" rounded="sm" />
                  <KubStableSkeleton width="9rem" height="0.875rem" />
                </div>
              </div>
            )}
            <div className="px-4 py-3 mt-2 border-t border-[color:var(--kub-rule)]">
              <button
                onClick={handlePinToggle}
                className={cn(actionRowClass, "text-[color:var(--kub-text)]")}
              >
                <KubIcon name={isPinned ? "pinOff" : "pin"} size={17} tone="muted" className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{isPinned ? "Открепить чат" : "Закрепить чат"}</span>
              </button>
              {onClearForMe && (
                <button
                  onClick={handleClearForMe}
                  className={dangerActionRowClass}
                >
                  <KubIcon name="delete" size={17} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {isSaved ? "Очистить избранное у себя" : "Очистить историю у себя"}
                  </span>
                </button>
              )}
              {canHidePrivateChat && (
                <button
                  onClick={handleHidePrivateChat}
                  className={dangerActionRowClass}
                >
                  <KubIcon name="logout" size={17} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">Удалить чат у себя</span>
                </button>
              )}
              {isGroup && !isOwner && (
                <button
                  onClick={() => {
                    setDestructiveError(null);
                    setLeaveGroupOpen(true);
                  }}
                  disabled={leavingChat}
                  className={dangerActionRowClass}
                >
                  <KubIcon name="logout" size={17} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{leavingChat ? "Выходим..." : "Покинуть группу"}</span>
                </button>
              )}
              {isGroup && isOwner && (
                <button
                  onClick={() => {
                    setDestructiveError(null);
                    setDeleteGroupOpen(true);
                  }}
                  disabled={deletingChat}
                  className={dangerActionRowClass}
                >
                  <KubIcon name="userRemove" size={17} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {deletingChat ? "Удаление..." : "Удалить групповой чат"}
                  </span>
                </button>
              )}
            </div>
          </div>
        )}

        {tab === "members" && isGroup && (
          <div className="py-2">
            {canSendInvites && (
              <div className="px-4 pb-2">
                <button
                  type="button"
                  onClick={() => setInviteOpen(true)}
                  className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 text-sm font-semibold text-[color:var(--kub-accent-text)] transition-colors kub-raise-hover"
                >
                  <KubIcon name="userPlus" size={15} />
                  Пригласить пользователя
                </button>
              </div>
            )}
            {members.map((member) => {
              const isSelf = member.id === currentUser?.id;
              const isMemberOwner = member.chat_role === "owner";
              const isMemberAdmin = member.chat_role === "admin";
              // Promote/demote matrix mirrors the SQL trigger
              // `enforce_chat_member_update`:
              //   • owner can change anyone (last-owner trigger guards
              //     the chat from going ownerless),
              //   • admin can promote member↔demote admin, but never
              //     touch owners and never create new owners.
              const canPromote = !isSelf && member.chat_role === "member" && isOwnerOrAdmin;
              const canDemote  = !isSelf && isMemberAdmin && isOwnerOrAdmin;
              const canRemove  = !isSelf && !isMemberOwner && (
                isOwner || (myRole === "admin" && member.chat_role === "member")
              );
              return (
                <div key={member.id} className="flex items-center gap-3 px-4 py-2.5 kub-raise-hover group">
                  <UserAvatar user={member} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate flex items-center gap-1 text-[color:var(--kub-text)]">
                      {isMemberOwner && <KubIcon name="crown" size={12} tone="pink" className="flex-shrink-0" label="Владелец" />}
                      {isMemberAdmin && <KubIcon name="shield" size={12} tone="accent" className="flex-shrink-0" label="Администратор" />}
                      <span className="truncate">{member.full_name ?? member.username ?? "Без имени"}</span>
                      {isSelf && <span className="text-xs flex-shrink-0 text-[color:var(--kub-muted)]">(вы)</span>}
                    </div>
                    {(isMemberOwner || isMemberAdmin) && (
                      <div className="text-xs text-[color:var(--kub-accent-text)]">{roleLabel(member.chat_role)}</div>
                    )}
                  </div>

                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    {canPromote && (
                      <button
                        onClick={() => setMemberRole(member.id, "admin")}
                        title="Сделать администратором"
                        aria-label="Сделать администратором"
                        className="p-1.5 rounded-lg kub-raise-hover transition-all text-[color:var(--kub-cyan)]"
                      >
                        <KubIcon name="chevronUp" size={14} />
                      </button>
                    )}
                    {canDemote && (
                      <button
                        onClick={() => setMemberRole(member.id, "member")}
                        title="Снять администратора"
                        aria-label="Снять администратора"
                        className="p-1.5 rounded-lg kub-raise-hover transition-all text-[color:var(--kub-muted)]"
                      >
                        <KubIcon name="shieldOff" size={14} />
                      </button>
                    )}
                    {canRemove && (
                      <button
                        onClick={async () => {
                          const confirmed = await requestAppConfirm({
                            title: "Удалить участника из чата?",
                            description: `${member.full_name ?? "Участник"} потеряет доступ к этому чату.`,
                            confirmLabel: "Удалить",
                            tone: "danger",
                            icon: "userRemove",
                          });
                          if (confirmed) void handleRemoveMember(member.id);
                        }}
                        title="Удалить из чата"
                        aria-label="Удалить из чата"
                        className="p-1.5 rounded-lg hover:bg-[color-mix(in_srgb,var(--kub-danger)_15%,transparent)] transition-all text-[color:var(--kub-danger)]"
                      >
                        <KubIcon name="close" size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {isOwnerOrAdmin && (
              <div className="mt-3 border-t border-[color:var(--kub-rule)] px-4 pt-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--kub-accent-text)]">
                      Приглашения
                    </div>
                    <div className="text-xs text-[color:var(--kub-muted)]">
                      Статусы обновляются без перезагрузки панели.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadInvites()}
                    className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-[color:var(--kub-muted)] kub-raise-hover"
                  >
                    <KubIcon name="rotate" size={12} />
                    Обновить
                  </button>
                </div>

                {inviteError && (
                  <div className="mb-2 rounded-xl border border-[color:var(--kub-danger)]/40 bg-[color-mix(in_srgb,var(--kub-danger)_10%,transparent)] px-3 py-2 text-xs text-[color:var(--kub-danger-text)]">
                    {inviteError}
                  </div>
                )}

                {visibleInvites.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[color:var(--kub-border-color)] px-3 py-3 text-xs text-[color:var(--kub-muted)]">
                    Активных или отклонённых приглашений пока нет.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {visibleInvites.map((invite) => {
                      const invitee = invite.invitee;
                      const inviter = invite.inviter;
                      const inviteeIsCurrentMember = memberIdSet.has(invite.invitee_id);
                      const canReinvite = !inviteeIsCurrentMember && (
                        invite.status === "accepted" ||
                        invite.status === "declined" ||
                        invite.status === "cancelled" ||
                        invite.status === "expired"
                      );
                      const canCancel = invite.status === "pending";
                      return (
                        <div key={invite.id} className="rounded-xl px-2 py-2 kub-raise-hover">
                          <div className="flex min-w-0 items-center gap-3">
                            <UserAvatar user={invitee ?? { id: invite.invitee_id, full_name: null, username: null, avatar_url: null }} size="sm" />
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="truncate text-sm font-medium text-[color:var(--kub-text)]">
                                  {invitee ? displayProfileName(invitee) : "Пользователь"}
                                </span>
                                <span className={cn(
                                  "shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold",
                                  inviteStatusClass(invite.status),
                                )}>
                                  {inviteStatusLabel(invite.status, inviteeIsCurrentMember)}
                                </span>
                              </div>
                              <div className="truncate text-xs text-[color:var(--kub-muted)]">
                                Пригласил: {inviter ? displayProfileName(inviter) : "администратор"} · {formatInviteTime(invite.created_at)}
                              </div>
                            </div>
                          </div>
                          {(canCancel || canReinvite) && (
                            <div className="mt-2 flex justify-end gap-2">
                              {canCancel && (
                                <button
                                  type="button"
                                  onClick={() => void handleCancelInvite(invite)}
                                  disabled={inviteBusyId === invite.id}
                                  className="inline-flex h-7 items-center justify-center rounded-lg border border-[color:var(--kub-border-color)] px-2 text-xs font-semibold text-[color:var(--kub-muted)] kub-raise-hover disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed"
                                >
                                  {inviteBusyId === invite.id ? "Отмена..." : "Отменить"}
                                </button>
                              )}
                              {canReinvite && (
                                <button
                                  type="button"
                                  onClick={() => void handleReinvite(invite)}
                                  disabled={inviteBusyId === invite.id}
                                  className="inline-flex h-7 items-center justify-center rounded-lg bg-[var(--kub-cyan)] px-2 text-xs font-semibold text-[color:var(--kub-bg)] hover:bg-[var(--kub-cyan-hover)] disabled:bg-[var(--kub-inset)] disabled:shadow-none disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed"
                                >
                                  {inviteBusyId === invite.id ? "Отправка..." : "Пригласить снова"}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      </div>

      {/* The contents of one kind. The strip of section tabs that used to stand
          above this list is gone: the division and the counts are rows in the
          card's own scroll now, and repeating them here would be two places to
          read the same thing and one of them wrong. */}
      <div
        className="kub-subview absolute inset-0 flex min-h-0 flex-col"
        data-state={view === "gallery" ? "current" : "ahead"}
        data-testid="chat-info-gallery-view"
        inert={view !== "gallery"}
      >
        <div
          ref={mediaScrollerRef}
          className="min-h-0 flex-1 overflow-y-auto p-2"
          id="chat-info-media-panel"
          data-media-kind={activeSection?.kind ?? undefined}
          role={activeSection ? "region" : undefined}
          aria-label={activeSection?.countedLabel}
        >
          {/* The placeholder stands for the section that is open, not for the
              panel: with the totals known, «96 файлов» can be pressed in a chat
              whose loaded page is all photos, and the sub-view then has a
              section and nothing in it yet. */}
          {sectionLoading && (activeSection?.loadedCount ?? 0) === 0 ? (
            <div className="grid grid-cols-3 gap-1">
              {Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={index}
                  className="aspect-square animate-pulse rounded-lg bg-[var(--kub-surface-2)]"
                />
              ))}
            </div>
          ) : !activeSection ? (
            <div className="py-8 text-center text-sm text-[color:var(--kub-muted)]">Медиа пока нет</div>
          ) : isGridMediaKind(activeSection.kind) ? (
            <div className="mb-3 grid grid-cols-3 gap-1">
              {activeSection.items.map((m) => {
                const mediaVariant = mediaVariantUrls[m.id];
                return (
                  <button
                    type="button"
                    key={m.id}
                    className="relative aspect-square overflow-hidden rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
                    onClick={() => setOpenMedia({
                      type: m.type === "video" ? "video" : "image",
                      url: m.media_url!,
                      title: m.content ?? (m.type === "video" ? "Видео" : "Фото"),
                    })}
                  >
                    <MediaGalleryTile message={m} mediaVariant={mediaVariant} />
                  </button>
                );
              })}
            </div>
          ) : activeSection.kind === "link" ? (
            <div className="mb-3">
              {activeSection.items.map((m) => {
                const href = extractFirstLink(m.content)!;
                return (
                  <a
                    key={m.id}
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[color:var(--kub-text)] transition-colors kub-raise-hover"
                  >
                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--kub-cyan)_18%,transparent)]">
                      <KubIcon name="externalLink" size={15} tone="accent" />
                    </div>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{href}</span>
                      {m.content && m.content.trim() !== href && (
                        <span className="block truncate text-xs text-[color:var(--kub-muted)]">{m.content}</span>
                      )}
                    </span>
                  </a>
                );
              })}
            </div>
          ) : (
            <div className="mb-3">
              {activeSection.items.map((m) => (
                <a
                  key={m.id}
                  href={m.media_url!}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[color:var(--kub-text)] transition-colors kub-raise-hover"
                >
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--kub-cyan)_18%,transparent)]">
                    <KubIcon name={MEDIA_SECTION_ICONS[activeSection.kind]} size={15} tone="accent" />
                  </div>
                  <span className="truncate text-sm">{m.content ?? activeSection.label}</span>
                </a>
              ))}
            </div>
          )}

          {/* The end of the list, and what is at it.
              Nothing at all once the section is complete: the button that used
              to stand here was drawn from the media page counter, so it sat
              under a links section it could not extend and under sections that
              had already loaded everything. What is here now exists only while
              `section.hasMore` — `loaded < total` once the server has counted —
              is still true.

              The sentinel is what the observer watches, and it is also the
              control a reader who arrives by keyboard needs: nothing scrolls
              into view when you tab, so an observer alone would leave the rest
              of the list unreachable. It stays one element across the load
              rather than swapping a button out for a spinner, because unmounting
              the button somebody just pressed drops their focus to the document.
              The animation is a skeleton, which is where this codebase already
              answers `prefers-reduced-motion` — see `.kub-skeleton`. */}
          {activeSection && sectionHasMore && (
            <div ref={sentinelRef} className="mb-3">
              <button
                type="button"
                onClick={() => void loadMoreActiveSection()}
                aria-busy={sectionLoading}
                data-testid="chat-info-media-sentinel"
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-[color:var(--kub-border-color)] px-3 py-2 text-sm text-[color:var(--kub-accent-text)] kub-raise-hover"
              >
                {sectionLoading && <KubStableSkeleton width="0.875rem" height="0.875rem" rounded="full" />}
                <span>{sectionLoading ? "Загружаем ещё…" : "Загрузить ещё"}</span>
              </button>
            </div>
          )}
        </div>
      </div>
      </div>
      <KubModal
        open={leaveGroupOpen}
        onClose={() => {
          if (!leavingChat) setLeaveGroupOpen(false);
        }}
        title="Покинуть группу?"
        description="Группа исчезнет из вашего списка. История у других участников останется."
        icon={<KubIcon name="logout" size={18} tone="danger" />}
        size="sm"
        mobileSheet={false}
        footer={(
          <>
            <button
              type="button"
              onClick={() => setLeaveGroupOpen(false)}
              disabled={leavingChat}
              className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-semibold text-[color:var(--kub-muted)] kub-raise-hover disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleLeave}
              disabled={leavingChat}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-[var(--kub-action-danger-background)] px-3 text-sm font-semibold text-[color:var(--kub-action-danger-foreground)] hover:bg-[var(--kub-action-danger-hover)] active:brightness-95 disabled:bg-[var(--kub-inset)] disabled:shadow-none disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed"
            >
              {leavingChat ? "Выходим..." : "Покинуть"}
            </button>
          </>
        )}
      >
        {destructiveError ? (
          <div className="rounded-xl border border-[color:var(--kub-danger)]/40 bg-[color-mix(in_srgb,var(--kub-danger)_10%,transparent)] px-3 py-2 text-sm text-[color:var(--kub-danger-text)]">
            {destructiveError}
          </div>
        ) : (
          <p className="text-sm text-[color:var(--kub-muted)]">
            Повторные нажатия будут заблокированы после подтверждения.
          </p>
        )}
      </KubModal>
      <KubModal
        open={deleteGroupOpen}
        onClose={() => {
          if (!deletingChat) setDeleteGroupOpen(false);
        }}
        title="Удалить групповой чат?"
        description="Это действие нельзя отменить. Чат и история исчезнут у всех участников."
        icon={<KubIcon name="userRemove" size={18} tone="danger" />}
        size="sm"
        mobileSheet={false}
        footer={(
          <>
            <button
              type="button"
              onClick={() => setDeleteGroupOpen(false)}
              disabled={deletingChat}
              className="inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-semibold text-[color:var(--kub-muted)] kub-raise-hover disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleDeleteGroup}
              disabled={deletingChat}
              className="inline-flex h-9 items-center justify-center rounded-lg bg-[var(--kub-action-danger-background)] px-3 text-sm font-semibold text-[color:var(--kub-action-danger-foreground)] hover:bg-[var(--kub-action-danger-hover)] active:brightness-95 disabled:bg-[var(--kub-inset)] disabled:shadow-none disabled:bg-[var(--kub-inset)] disabled:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))] disabled:text-[color:var(--kub-muted)] disabled:cursor-not-allowed"
            >
              {deletingChat ? "Удаляем..." : "Удалить"}
            </button>
          </>
        )}
      >
        {destructiveError ? (
          <div className="rounded-xl border border-[color:var(--kub-danger)]/40 bg-[color-mix(in_srgb,var(--kub-danger)_10%,transparent)] px-3 py-2 text-sm text-[color:var(--kub-danger-text)]">
            {destructiveError}
          </div>
        ) : (
          <p className="text-sm text-[color:var(--kub-muted)]">
            После удаления группа исчезнет у всех участников.
          </p>
        )}
      </KubModal>
      <MediaViewer media={openMedia} onClose={() => setOpenMedia(null)} />
      {inviteOpen && (
        <GroupInviteModal
          chatId={chat.id}
          chatName={display.title}
          currentUserId={currentUser?.id ?? null}
          memberIds={Array.from(memberIdSet)}
          onClose={() => {
            setInviteOpen(false);
            void loadMembers();
            void loadInvites();
            void loadInvitePolicy();
          }}
        />
      )}
    </div>
  );
}

function displayProfileName(profile: Profile): string {
  return profile.full_name ?? profile.username ?? "Без имени";
}

function inviteStatusLabel(status: GroupInviteStatus, isCurrentMember = false): string {
  if (status === "pending") return "Ожидает подтверждения";
  if (status === "declined") return "Отказался";
  if (status === "accepted") return isCurrentMember ? "Принял" : "Был участником";
  if (status === "cancelled") return "Отменено";
  return "Истекло";
}

function inviteStatusClass(status: GroupInviteStatus): string {
  if (status === "pending") return "bg-[color-mix(in_srgb,var(--kub-cyan)_14%,transparent)] text-[color:var(--kub-accent-text)]";
  if (status === "declined") return "bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)] text-[color:var(--kub-danger-text)]";
  if (status === "accepted") return "bg-[color-mix(in_srgb,var(--kub-online)_14%,transparent)] text-[color:var(--kub-online-text)]";
  return "bg-[var(--kub-surface-3)] text-[color:var(--kub-muted)]";
}

function formatInviteTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "недавно";
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.max(0, Math.round(diffMs / 60_000));
  if (diffMin < 1) return "только что";
  if (diffMin < 60) return `${diffMin} мин назад`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours} ч назад`;
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

function readChatInvitePolicy(chat: ChatWithLastMessage): InvitePolicy | null {
  const value = (chat as ChatWithLastMessage & { invite_policy?: string | null }).invite_policy;
  if (value === "owner_admin_only" || value === "members_can_invite") return value;
  return null;
}

function normalizeInvitePolicy(value: string | null | undefined): InvitePolicy {
  return value === "members_can_invite" ? "members_can_invite" : DEFAULT_INVITE_POLICY;
}

function MediaGalleryTile({
  message,
  mediaVariant,
}: {
  message: Message;
  mediaVariant?: MessageMediaVariantUrls;
}) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const kind = getMediaTileKind(message);
  const icon = kind === "video" ? "video" : kind === "gif" ? "image" : "image";
  const label = kind === "video" ? "Видео" : kind === "gif" ? "GIF" : "Фото";
  const previewUrl = selectMediaGalleryPreviewUrl(message, mediaVariant);

  if (previewUrl && !previewFailed) {
    return (
      <>
        <img
          src={previewUrl}
          alt={message.content ?? label}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-200 hover:scale-[1.03]"
          onError={() => setPreviewFailed(true)}
        />
        <span className="pointer-events-none absolute bottom-1 left-1 rounded-full bg-black/45 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/85">
          {label}
        </span>
      </>
    );
  }

  return (
    <div className={cn(
      "flex h-full w-full flex-col items-center justify-center gap-1 text-white",
      kind === "video"
        ? "bg-[linear-gradient(135deg,color-mix(in_srgb,var(--kub-cyan)_18%,#111827),#0b0f18)]"
        : "bg-[linear-gradient(135deg,color-mix(in_srgb,var(--kub-pink)_16%,#111827),color-mix(in_srgb,var(--kub-cyan)_14%,#0b0f18))]"
    )}>
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/14 backdrop-blur">
        <KubIcon name={icon} size={18} className="text-white" />
      </span>
      <span className="rounded-full bg-black/25 px-2 py-0.5 text-[12px] font-semibold uppercase tracking-wide text-white/80">
        {label}
      </span>
    </div>
  );
}

function selectMediaGalleryPreviewUrl(
  message: Message,
  mediaVariant: MessageMediaVariantUrls | undefined,
): string | null {
  const kind = getMediaTileKind(message);
  if (kind === "gif") return null;
  if (kind === "video") return mediaVariant?.videoPosterUrl ?? null;
  return mediaVariant?.thumbUrl ?? mediaVariant?.previewUrl ?? null;
}

function getMediaTileKind(message: Message): "image" | "gif" | "video" {
  if (message.type === "video") return "video";
  const source = `${message.content ?? ""} ${message.media_url ?? ""}`.toLowerCase();
  if (source.includes(".gif")) return "gif";
  return "image";
}

async function fetchHiddenMessageIdSet(
  supabase: ReturnType<typeof createClient>,
  messageIds: string[],
): Promise<Set<string>> {
  const ids = Array.from(new Set(messageIds.filter(Boolean)));
  if (!ids.length) return new Set();
  const { data, error } = await supabase
    .from("message_hidden_for_users")
    .select("message_id")
    .in("message_id", ids);
  if (error) {
    console.error("Hidden media ids fetch error:", error);
    return new Set();
  }
  return new Set((data ?? []).map((row) => row.message_id));
}
