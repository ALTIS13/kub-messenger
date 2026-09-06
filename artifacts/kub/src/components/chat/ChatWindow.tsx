"use client";

import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo, type CSSProperties, type DragEvent } from "react";
import { ChatHeader } from "./ChatHeader";
import { PinnedMessage } from "./PinnedMessage";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { ChatSearchBar } from "./ChatSearchBar";
import { ChatInfoPanel } from "./ChatInfoPanel";
import { ForwardModal } from "./ForwardModal";
import { MediaViewer, type MediaViewerItem } from "./MediaViewer";
import { ChatMediaPlaybackBar, ChatMediaPlaybackProvider, type ChatMediaPlaybackItem } from "./ChatMediaPlayback";
import { TopicStrip } from "./TopicStrip";
import { useTopics } from "@/hooks/useTopics";
import { useMessages } from "@/hooks/useMessages";
import { useMessageMediaVariantUrls, type MessageMediaVariantUrls } from "@/hooks/useMediaVariants";
import { useMeasuredHeight } from "@/hooks/useMeasuredHeight";
import { useAppStore } from "@/store/app.store";
import { createClient, getSupabasePublicUrl } from "@/lib/supabase/client";
import { KubEmptyState, KubIcon } from "@/components/kub";
import { showAppAlert } from "@/lib/appDialogs";
import { KUB_CHAT_MESSAGE_JUMP_EVENT, requestChatMessageJump, type ChatMessageJumpDetail } from "@/lib/chatJumpEvents";
import { isSavedChat } from "@/lib/chatDisplay";
import { reportError } from "@/lib/monitoring";
import { messageActorDisplayName, resolveMessageActor } from "@/lib/messageActor";
// One copy of "is this a voice note / a round video", shared with the profile
// card's shared-media sections. A second copy drifts, and then playback and the
// gallery disagree about the same row.
import { isRoundVideoMessageContent, isVoiceMessageContent } from "@/lib/messageMediaSections";
import { bumpMount, bumpUnmount } from "@/lib/dev/instrumentation";
import {
  DEFAULT_MEDIA_QUALITY,
  MEDIA_QUALITY_METADATA_KEY,
  MEDIA_QUALITY_STORAGE_KEY,
  applyVideoQualityToAttachments,
  normalizeMediaQuality,
  selectVideoPlaybackUrl,
  type MediaQuality,
} from "@/lib/mediaQuality";
import { prepareChatImageAttachment, readMediaDimensions } from "@/lib/mediaUpload";
import {
  CHAT_MEDIA_BUCKET,
  MAX_STAGED_ATTACHMENTS,
  chatAttachmentUploadPath,
  createStagedAttachment,
  createStagedVideoMessageAttachment,
  createStagedVoiceAttachment,
  revokeAttachmentPreview,
  stagedAttachmentTextContent,
  validateStagedAttachment,
  type StagedAttachment,
  type StagedAttachmentUpload,
} from "@/lib/stagedAttachments";
import {
  shouldUseResumableUpload,
  startResumableStorageUpload,
} from "@/lib/resumableStorageUpload";
import {
  createStagedUploadHandleRegistry,
  createStagedUploadScope,
  clearStagedAttachmentChat,
  commitPreparedStagedAttachments,
  getAttachmentUploadErrorMessage,
  markStagedAttachmentSendFailed,
  runScopedStagedPreparation,
  runScopedStagedSendAttempt,
  selectStagedAttachmentsForSend,
  transitionStagedAttachmentChat,
  type StagedUploadScopeToken,
} from "@/lib/stagedUploadWorkflow";
import type { Json, MessageWithSender } from "@/types/database";
import { cacheControlFor } from "@/lib/mediaCacheControl";

interface ChatWindowProps {
  chatId: string;
}

const EMPTY_GENERAL_TOPIC_IDS: string[] = [];

export function ChatWindow({ chatId }: ChatWindowProps) {
  // Dev-only mount/unmount счётчик. Должен скакать только при смене чата
  // (новый key={chatId} в родителе), не при heartbeat-эхо (Task #48).
  useEffect(() => {
    bumpMount("ChatWindow");
    return () => bumpUnmount("ChatWindow");
  }, []);
  const chats = useAppStore((s) => s.chats);
  const userId = useAppStore((s) => s.currentUser?.id ?? null);
  const markChatRead = useAppStore((s) => s.markChatRead);
  const setEditingMessage = useAppStore((s) => s.setEditingMessage);
  const setForwardingMessage = useAppStore((s) => s.setForwardingMessage);
  const forwardingMessage = useAppStore((s) => s.forwardingMessage);
  const selectedTopicId = useAppStore((s) => s.selectedTopicId);
  const setSelectedTopicId = useAppStore((s) => s.setSelectedTopicId);
  const chatPanelRequest = useAppStore((s) => s.chatPanelRequest);
  const clearChatPanelRequest = useAppStore((s) => s.clearChatPanelRequest);
  const chat = chats.find((c) => c.id === chatId);
  const savedChat = chat ? isSavedChat(chat, userId) : false;
  const isForum = !!chat?.is_forum;
  const { topics, createTopic } = useTopics(chatId, isForum);
  const generalTopicIds = useMemo(
    () => topics.filter((topic) => topic.is_general).map((topic) => topic.id),
    [topics],
  );
  const messageTopicId = isForum ? selectedTopicId : undefined;
  const messageGeneralTopicIds = isForum ? generalTopicIds : EMPTY_GENERAL_TOPIC_IDS;
  const {
    messages, pinnedMessages, pinnedReady, loading, loadingOlder, hasMoreOlder, olderError, isTyping,
    sendMessage, sendMediaMessage, sendTyping, toggleReaction,
    retryMessageSend, discardLocalMessage,
    editMessage, deleteMessage, hideMessageForMe, hideMessagesForMe, togglePin, forwardMessage, clearChatForMe,
    loadOlderMessages, ensureMessageLoaded,
  } = useMessages(chatId, messageTopicId, messageGeneralTopicIds);

  useEffect(() => { markChatRead(chatId); }, [chatId, markChatRead]);

  const [replyTo, setReplyTo] = useState<MessageWithSender | null>(null);
  const [replyFocusKey, setReplyFocusKey] = useState(0);
  const [showSearch, setShowSearch] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [openMedia, setOpenMedia] = useState<MediaViewerItem | null>(null);
  const [draftRestore, setDraftRestore] = useState<{ id: string; text: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Both pieces of chrome run over the conversation, so both have to report the
  // height the list pads itself by. The composer is the one that moves most —
  // reply preview, attachments, a draft that wraps — and it was already
  // measured; the header stack grows too, when a message is pinned or the
  // in-chat search opens.
  const {
    ref: composerRef,
    height: composerHeight,
    measure: measureComposerHeight,
    node: composerNode,
  } = useMeasuredHeight<HTMLDivElement>(chatId);
  const { ref: chromeRef, height: chromeHeight } = useMeasuredHeight<HTMLDivElement>(chatId);
  const messageRefs = useRef<Record<string, HTMLDivElement>>({});
  const pendingJumpRef = useRef<string | null>(null);
  const initialUnreadRef = useRef<{ chatId: string; count: number; since: string | null } | null>(null);
  const supabase = createClient();
  const [stagedAttachments, setStagedAttachments] = useState<StagedAttachment[]>([]);
  const [mediaQuality, setMediaQualityState] = useState<MediaQuality>(() => {
    if (typeof window === "undefined") return DEFAULT_MEDIA_QUALITY;
    return normalizeMediaQuality(window.localStorage.getItem(MEDIA_QUALITY_STORAGE_KEY));
  });
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const stagedAttachmentsRef = useRef<StagedAttachment[]>([]);
  const cancelledAttachmentIdsRef = useRef<Set<string>>(new Set());
  const uploadRegistryRef = useRef<ReturnType<typeof createStagedUploadHandleRegistry> | null>(null);
  const uploadScopeRef = useRef<ReturnType<typeof createStagedUploadScope> | null>(null);
  if (!uploadRegistryRef.current) uploadRegistryRef.current = createStagedUploadHandleRegistry();
  if (!uploadScopeRef.current) uploadScopeRef.current = createStagedUploadScope(chatId);
  const uploadRegistry = uploadRegistryRef.current;
  const uploadScope = uploadScopeRef.current;
  const dragDepthRef = useRef(0);
  const [draggingFiles, setDraggingFiles] = useState(false);

  useLayoutEffect(() => {
    stagedAttachmentsRef.current = stagedAttachments;
  }, [stagedAttachments]);

  const setMediaQuality = useCallback((quality: MediaQuality) => {
    setMediaQualityState(quality);
    setStagedAttachments((current) => applyVideoQualityToAttachments(current, quality));
    if (typeof window !== "undefined") {
      window.localStorage.setItem(MEDIA_QUALITY_STORAGE_KEY, quality);
    }
  }, []);

  useEffect(() => {
    const visualViewport = window.visualViewport;
    const updateKeyboardInset = () => {
      const mobile = window.innerWidth < 768;
      const composerHasFocus = Boolean(composerNode?.contains(document.activeElement));
      if (!mobile || !visualViewport || !isComposerFocused || !composerHasFocus) {
        setKeyboardInset(0);
        return;
      }
      const rawInset = Math.max(0, Math.round(window.innerHeight - visualViewport.height - visualViewport.offsetTop));
      setKeyboardInset(rawInset > 80 ? rawInset : 0);
    };

    updateKeyboardInset();
    visualViewport?.addEventListener("resize", updateKeyboardInset);
    visualViewport?.addEventListener("scroll", updateKeyboardInset);
    window.addEventListener("resize", updateKeyboardInset);
    window.addEventListener("orientationchange", updateKeyboardInset);
    return () => {
      visualViewport?.removeEventListener("resize", updateKeyboardInset);
      visualViewport?.removeEventListener("scroll", updateKeyboardInset);
      window.removeEventListener("resize", updateKeyboardInset);
      window.removeEventListener("orientationchange", updateKeyboardInset);
    };
  }, [composerNode, isComposerFocused]);

  useLayoutEffect(() => {
    measureComposerHeight();
  }, [
    measureComposerHeight,
    keyboardInset,
    stagedAttachments.length,
    replyTo?.id,
    draftRestore?.id,
  ]);

  useLayoutEffect(() => {
    const staleAttachments = transitionStagedAttachmentChat(
      uploadScope,
      chatId,
      stagedAttachmentsRef,
      () => { void uploadRegistry.abortAll(); },
    );
    staleAttachments.forEach(revokeAttachmentPreview);
    setStagedAttachments((current) => current.length ? [] : current);
    cancelledAttachmentIdsRef.current.clear();
    setDraggingFiles(false);
    dragDepthRef.current = 0;

    return () => {
      const abandonedAttachments = clearStagedAttachmentChat(
        uploadScope,
        stagedAttachmentsRef,
        () => { void uploadRegistry.abortAll(); },
      );
      abandonedAttachments.forEach(revokeAttachmentPreview);
      cancelledAttachmentIdsRef.current.clear();
    };
  }, [chatId, uploadRegistry, uploadScope]);

  useEffect(() => {
    if (!chatPanelRequest || chatPanelRequest.chatId !== chatId) return;
    if (chatPanelRequest.panel === "info") setShowInfo(true);
    if (chatPanelRequest.panel === "search") setShowSearch(true);
    clearChatPanelRequest(chatPanelRequest.key);
  }, [chatId, chatPanelRequest, clearChatPanelRequest]);

  const myRole = (chat?.members?.find((m) => m.user_id === userId)?.role ?? null) as
    | "owner" | "admin" | "member" | null;
  const canManageTopics = myRole === "owner" || myRole === "admin";
  if (chat && initialUnreadRef.current?.chatId !== chatId) {
    const myMembership = chat.members?.find((member) => member.user_id === userId) ?? null;
    initialUnreadRef.current = {
      chatId,
      count: chat.unread_count ?? 0,
      since: latestTimestamp(myMembership?.last_read_at, myMembership?.joined_at, myMembership?.cleared_at),
    };
  }

  const updateStagedAttachment = useCallback((
    attachmentId: string,
    updater: (attachment: StagedAttachment) => StagedAttachment,
  ) => {
    setStagedAttachments((current) => current.map((attachment) =>
      attachment.id === attachmentId ? updater(attachment) : attachment
    ));
  }, []);

  const removeStagedAttachment = useCallback((attachmentId: string) => {
    cancelledAttachmentIdsRef.current.add(attachmentId);
    void uploadRegistry.abort(attachmentId);
    setStagedAttachments((current) => {
      const target = current.find((attachment) => attachment.id === attachmentId);
      if (target) revokeAttachmentPreview(target);
      return current.filter((attachment) => attachment.id !== attachmentId);
    });
  }, [uploadRegistry]);

  const cancelStagedAttachment = useCallback((attachmentId: string) => {
    cancelledAttachmentIdsRef.current.add(attachmentId);
    removeStagedAttachment(attachmentId);
  }, [removeStagedAttachment]);

  const stageFiles = useCallback(async (files: File[], _source: "picker" | "paste" | "drop" | "camera") => {
    if (!files.length) return;
    const scopeToken = uploadScope.capture();
    const existingCount = stagedAttachmentsRef.current.length;
    const availableSlots = Math.max(0, MAX_STAGED_ATTACHMENTS - existingCount);
    const accepted: StagedAttachment[] = [];
    const errors: string[] = [];

    if (!availableSlots) {
      showAppAlert(`Можно подготовить не больше ${MAX_STAGED_ATTACHMENTS} вложений за раз.`, "Вложения");
      return;
    }

    for (const sourceFile of files.slice(0, availableSlots)) {
      if (!uploadScope.isActive(scopeToken)) {
        accepted.forEach(revokeAttachmentPreview);
        return;
      }
      let file = sourceFile;
      if (sourceFile.type.startsWith("image/")) {
        const prepared = await runScopedStagedPreparation(
          uploadScope,
          scopeToken,
          () => prepareChatImageAttachment(sourceFile, DEFAULT_MEDIA_QUALITY),
        );
        if (prepared.status === "stale") {
          accepted.forEach(revokeAttachmentPreview);
          return;
        }
        file = prepared.value;
      }
      const error = validateStagedAttachment(file);
      if (error) {
        errors.push(`${sourceFile.name || file.name || "Файл"}: ${error}`);
        continue;
      }
      const preparedDimensions = await runScopedStagedPreparation(
        uploadScope,
        scopeToken,
        () => readMediaDimensions(file),
      );
      if (preparedDimensions.status === "stale") {
        accepted.forEach(revokeAttachmentPreview);
        return;
      }
      const dimensions = preparedDimensions.value;
      accepted.push(createStagedAttachment(file, {
        width: dimensions?.width,
        height: dimensions?.height,
        optimized: file !== sourceFile || file.size !== sourceFile.size || file.type !== sourceFile.type,
        originalSize: sourceFile.size,
        originalMimeType: sourceFile.type || undefined,
        mediaQuality: file.type.startsWith("video/") ? mediaQuality : undefined,
      }));
    }

    if (files.length > availableSlots) {
      errors.push(`Добавлено ${availableSlots} из ${files.length}: максимум ${MAX_STAGED_ATTACHMENTS} вложений за раз.`);
    }

    if (accepted.length) {
      const committed = commitPreparedStagedAttachments(
        uploadScope,
        scopeToken,
        accepted,
        (attachments) => {
          setStagedAttachments((current) => {
            if (!uploadScope.isActive(scopeToken)) {
              attachments.forEach(revokeAttachmentPreview);
              return current;
            }
            return [...current, ...attachments];
          });
        },
      );
      if (!committed) {
        accepted.forEach(revokeAttachmentPreview);
        return;
      }
    }
    if (errors.length && uploadScope.isActive(scopeToken)) {
      showAppAlert(errors.slice(0, 3).join("\n"), "Вложения");
    }
  }, [mediaQuality, uploadScope]);

  const stageVoiceRecording = useCallback((blob: Blob, durationMs: number, mimeType: string) => {
    const error = validateStagedAttachment(new File([blob], "voice.webm", { type: mimeType || blob.type || "audio/webm" }));
    if (error) {
      showAppAlert(error, "Голосовое сообщение");
      return;
    }
    const currentVoice = stagedAttachmentsRef.current.find((attachment) => attachment.kind === "voice");
    if (currentVoice) removeStagedAttachment(currentVoice.id);
    if (!currentVoice && stagedAttachmentsRef.current.length >= MAX_STAGED_ATTACHMENTS) {
      showAppAlert(`Можно подготовить не больше ${MAX_STAGED_ATTACHMENTS} вложений за раз.`, "Голосовое сообщение");
      return;
    }
    setStagedAttachments((current) => [...current, createStagedVoiceAttachment(blob, durationMs, mimeType)]);
  }, [removeStagedAttachment]);

  const stageVideoMessageRecording = useCallback((blob: Blob, durationMs: number, mimeType: string) => {
    const error = validateStagedAttachment(new File([blob], "video-message.webm", { type: mimeType || blob.type || "video/webm" }));
    if (error) {
      showAppAlert(error, "Видео-сообщение");
      return;
    }
    const currentVideoMessage = stagedAttachmentsRef.current.find((attachment) => attachment.kind === "video_message");
    if (currentVideoMessage) removeStagedAttachment(currentVideoMessage.id);
    if (!currentVideoMessage && stagedAttachmentsRef.current.length >= MAX_STAGED_ATTACHMENTS) {
      showAppAlert(`Можно подготовить не больше ${MAX_STAGED_ATTACHMENTS} вложений за раз.`, "Видео-сообщение");
      return;
    }
    setStagedAttachments((current) => [...current, createStagedVideoMessageAttachment(blob, durationMs, mimeType, mediaQuality)]);
  }, [mediaQuality, removeStagedAttachment]);

  const uploadStagedAttachment = useCallback(async (
    attachment: StagedAttachment,
    scopeToken: StagedUploadScopeToken,
  ): Promise<StagedAttachmentUpload> => {
    if (!userId) throw new Error("auth");
    const sourceChatId = scopeToken.chatId;
    const path = chatAttachmentUploadPath(sourceChatId, userId, attachment);
    const contentType = attachment.mimeType || attachment.file.type || "application/octet-stream";
    let uploadedPath = path;

    if (shouldUseResumableUpload(attachment.file.size)) {
      const handle = startResumableStorageUpload({
        supabaseClient: supabase,
        supabaseUrl: getSupabasePublicUrl(),
        file: attachment.file,
        bucketName: CHAT_MEDIA_BUCKET,
        objectName: path,
        contentType,
        onProgress: (progress) => {
          if (
            !uploadScope.isActive(scopeToken) ||
            cancelledAttachmentIdsRef.current.has(attachment.id)
          ) return;
          updateStagedAttachment(attachment.id, (current) => ({ ...current, progress }));
        },
      });
      uploadRegistry.register(attachment.id, handle);
      try {
        const result = await handle.result;
        uploadedPath = result.path;
      } finally {
        uploadRegistry.release(attachment.id, handle);
      }
    } else {
      const { data, error } = await supabase.storage
        .from(CHAT_MEDIA_BUCKET)
        .upload(path, attachment.file, {
          contentType,
          upsert: false,
          cacheControl: cacheControlFor(path),
        });
      if (error || !data) throw error ?? new Error("upload_failed");
      uploadedPath = data.path;
    }

    const { data: publicData } = supabase.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(uploadedPath);
    return {
      bucket: CHAT_MEDIA_BUCKET,
      path: uploadedPath,
      publicUrl: publicData.publicUrl,
    };
  }, [supabase, updateStagedAttachment, uploadRegistry, uploadScope, userId]);

  const sendStagedAttachments = useCallback(async (caption: string, onlyAttachmentId?: string): Promise<boolean> => {
    if (!userId) {
      showAppAlert("Войдите в аккаунт, чтобы отправлять файлы.", "Вложения");
      return false;
    }

    const scopeToken = uploadScope.capture();
    const captionText = caption.trim();
    const targets = selectStagedAttachmentsForSend(
      stagedAttachmentsRef.current,
      onlyAttachmentId,
    );
    if (!targets.length) return false;

    let sentAny = false;
    const firstTarget = targets[0];
    if (captionText && (firstTarget?.kind === "voice" || firstTarget?.kind === "video_message")) {
      const textResult = await runScopedStagedSendAttempt(
        uploadScope,
        scopeToken,
        () => sendMessage(captionText, replyTo?.id ?? undefined),
      );
      if (textResult.status === "stale") return false;
      if (textResult.status === "failed") {
        updateStagedAttachment(firstTarget.id, (current) =>
          markStagedAttachmentSendFailed(current, current.uploaded)
        );
        return false;
      }
      sentAny = true;
    }

    for (const attachment of targets) {
      if (
        cancelledAttachmentIdsRef.current.has(attachment.id) ||
        !uploadScope.isActive(scopeToken)
      ) return sentAny;
      updateStagedAttachment(attachment.id, (current) => ({
        ...current,
        status: "uploading",
        progress: 0,
        error: null,
      }));

      let uploaded: StagedAttachmentUpload | null = attachment.uploaded;
      if (!uploaded) {
        try {
          uploaded = await uploadStagedAttachment(attachment, scopeToken);
        } catch (error) {
          if (
            cancelledAttachmentIdsRef.current.has(attachment.id) ||
            !uploadScope.isActive(scopeToken)
          ) return sentAny;
          const uploadErrorMessage = getAttachmentUploadErrorMessage(error, attachment.kind);
          console.warn("[attachments] upload failed.");
          reportError(new Error("attachment_upload_failed"), {
            category: "attachment_upload_failed",
            attachmentKind: attachment.kind,
            mimeType: attachment.mimeType,
            fileSize: attachment.file.size,
          });
          updateStagedAttachment(attachment.id, (current) => ({
            ...current,
            status: "failed",
            error: uploadErrorMessage,
          }));
          return sentAny;
        }
      }

      if (
        cancelledAttachmentIdsRef.current.has(attachment.id) ||
        !uploadScope.isActive(scopeToken)
      ) return sentAny;

      updateStagedAttachment(attachment.id, (current) => ({
        ...current,
        progress: 100,
        uploaded,
      }));

      if (!uploadScope.isActive(scopeToken)) return sentAny;

      updateStagedAttachment(attachment.id, (current) => ({
        ...current,
        status: "sending",
        progress: 100,
        uploaded,
        error: null,
      }));

      const content = getStagedAttachmentMessageContent(attachment, sentAny || !captionText ? null : captionText);
      const sendResult = await runScopedStagedSendAttempt(
        uploadScope,
        scopeToken,
        () => sendMediaMessage({
          type: getStagedAttachmentMessageType(attachment),
          content,
          mediaBucket: uploaded.bucket,
          mediaPath: uploaded.path,
          mediaUrl: uploaded.publicUrl,
          replyToId: replyTo?.id ?? null,
          clientMessageId: attachment.clientMessageId,
          mediaMetadata: getStagedAttachmentMediaMetadata(attachment),
        }),
      );

      if (sendResult.status === "stale") return sentAny;
      if (sendResult.status === "failed") {
        reportError(new Error("staged_attachment_send_failed"), {
          category: "attachment_send_failed",
          attachmentKind: attachment.kind,
          mimeType: attachment.mimeType,
          fileSize: attachment.file.size,
        });
        updateStagedAttachment(attachment.id, (current) =>
          markStagedAttachmentSendFailed(current, uploaded)
        );
        return sentAny;
      }

      sentAny = true;
      removeStagedAttachment(attachment.id);
    }

    if (sentAny) setReplyTo(null);
    return sentAny;
  }, [replyTo?.id, removeStagedAttachment, sendMediaMessage, sendMessage, updateStagedAttachment, uploadScope, uploadStagedAttachment, userId]);

  const retryStagedAttachment = useCallback((attachmentId: string) => {
    void sendStagedAttachments("", attachmentId);
  }, [sendStagedAttachments]);

  const handleSend = useCallback((content: string) => {
    if (stagedAttachmentsRef.current.length) {
      return sendStagedAttachments(content);
    }
    if (!userId) {
      showAppAlert("Войдите в аккаунт, чтобы отправлять сообщения.", "Сообщение");
      return false;
    }
    const replyToId = replyTo?.id;
    void sendMessage(content, replyToId);
    setReplyTo(null);
    return true;
  }, [replyTo?.id, sendMessage, sendStagedAttachments, userId]);

  const handleReply = useCallback((msg: MessageWithSender) => {
    setReplyTo(msg);
    setReplyFocusKey((key) => key + 1);
  }, []);

  const handleSendVoice = useCallback(async (blob: Blob, durationMs: number, mimeType: string) => {
    if (!userId) {
      showAppAlert("Войдите в аккаунт, чтобы отправлять голосовые сообщения.", "Голосовое сообщение");
      return;
    }
    if (!blob || blob.size === 0 || durationMs < 1000) {
      showAppAlert("Запись слишком короткая или пустая.", "Голосовое сообщение");
      return;
    }
    stageVoiceRecording(blob, durationMs, mimeType);
  }, [stageVoiceRecording, userId]);

  const handleSendVideoMessage = useCallback(async (blob: Blob, durationMs: number, mimeType: string) => {
    if (!userId) {
      showAppAlert("Войдите в аккаунт, чтобы отправлять видео-сообщения.", "Видео-сообщение");
      return;
    }
    if (!blob || blob.size === 0 || durationMs < 500) {
      showAppAlert("Запись слишком короткая или пустая.", "Видео-сообщение");
      return;
    }
    stageVideoMessageRecording(blob, durationMs, mimeType);
  }, [stageVideoMessageRecording, userId]);

  const showJumpNotice = useCallback((message: string) => {
    setPinError(message);
    window.setTimeout(() => setPinError(null), 4000);
  }, []);

  const scrollToMessage = useCallback((messageId: string) => {
    const el = messageRefs.current[messageId];
    if (!el) return false;
    setHighlightedId(messageId);
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => setHighlightedId(null), 2000);
    return true;
  }, []);

  const jumpToMessage = useCallback((messageId: string) => {
    if (!scrollToMessage(messageId)) showJumpNotice("Сообщение пока не загружено.");
  }, [scrollToMessage, showJumpNotice]);

  const handleJumpToReply = useCallback(async (messageId: string) => {
    const localTarget = messages.find((message) => message.id === messageId);
    if (localTarget?.deleted_at) {
      showJumpNotice("Исходное сообщение недоступно.");
      return;
    }
    if (scrollToMessage(messageId)) return;
    const result = await ensureMessageLoaded(messageId);
    if (!result.ok || result.message.deleted_at) {
      const message =
        !result.ok && result.reason === "topic"
          ? "Сообщение находится в другом топике."
          : "Исходное сообщение недоступно.";
      showJumpNotice(message);
      return;
    }
    pendingJumpRef.current = messageId;
    requestAnimationFrame(() => {
      if (scrollToMessage(messageId)) pendingJumpRef.current = null;
    });
  }, [ensureMessageLoaded, messages, scrollToMessage, showJumpNotice]);

  const handleSearchJump = useCallback((messageId: string, topicId?: string | null) => {
    if (isForum && topicId !== undefined && (topicId ?? null) !== (selectedTopicId ?? null)) {
      setSelectedTopicId(topicId ?? null);
      pendingJumpRef.current = messageId;
      window.setTimeout(() => requestChatMessageJump(chatId, messageId), 250);
      return;
    }
    void handleJumpToReply(messageId);
  }, [chatId, handleJumpToReply, isForum, selectedTopicId, setSelectedTopicId]);

  useEffect(() => {
    const handleGlobalJump = (event: Event) => {
      const detail = (event as CustomEvent<ChatMessageJumpDetail>).detail;
      if (!detail || detail.chatId !== chatId) return;
      void handleJumpToReply(detail.messageId);
    };

    window.addEventListener(KUB_CHAT_MESSAGE_JUMP_EVENT, handleGlobalJump);
    return () => window.removeEventListener(KUB_CHAT_MESSAGE_JUMP_EVENT, handleGlobalJump);
  }, [chatId, handleJumpToReply]);

  useEffect(() => {
    const pendingId = pendingJumpRef.current;
    if (!pendingId) return;
    if (scrollToMessage(pendingId)) pendingJumpRef.current = null;
  }, [messages, scrollToMessage]);

  const handleJumpToPinned = useCallback((msg: MessageWithSender) => {
    const el = messageRefs.current[msg.id];
    if (!el) return showJumpNotice("Сообщение пока не загружено.");
    jumpToMessage(msg.id);
  }, [jumpToMessage, showJumpNotice]);

  const handleTogglePin = useCallback(async (msg: MessageWithSender) => {
    setPinError(null);
    const result = await togglePin(msg.id, msg.pinned);
    if (!result.ok) {
      setPinError(result.error ?? "Недостаточно прав для закрепления сообщения.");
      window.setTimeout(() => setPinError(null), 5000);
    }
  }, [togglePin]);

  const handleHideForMe = useCallback(async (msg: MessageWithSender) => {
    const result = await hideMessageForMe(msg.id);
    if (!result.ok) {
      showAppAlert(result.error ?? "Не удалось скрыть сообщение.", "Ошибка");
    }
  }, [hideMessageForMe]);

  const handleBulkHideForMe = useCallback(async (items: MessageWithSender[]) => {
    const result = await hideMessagesForMe(items.map((item) => item.id));
    if (!result.ok) {
      throw new Error(result.error ?? "Не удалось скрыть выбранные сообщения.");
    }
  }, [hideMessagesForMe]);

  const handleBulkDeleteForEveryone = useCallback(async (items: MessageWithSender[]) => {
    const failures: string[] = [];
    for (const item of items) {
      const result = await deleteMessage(item.id);
      if (!result?.ok) failures.push(result?.error ?? "Не удалось удалить сообщение.");
    }
    if (failures.length) {
      throw new Error(`Не удалось удалить ${failures.length} из ${items.length} сообщений.`);
    }
  }, [deleteMessage]);

  const handleEditFailedSend = useCallback((msg: MessageWithSender) => {
    if (msg.type !== "text") return;
    discardLocalMessage(msg.id);
    setDraftRestore({ id: `${msg.id}:${Date.now()}`, text: msg.content ?? "" });
  }, [discardLocalMessage]);

  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDraggingFiles(true);
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDraggingFiles(false);
  }, []);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setDraggingFiles(false);
    const files = filesFromDataTransfer(event.dataTransfer);
    if (files.length) stageFiles(files, "drop");
  }, [stageFiles]);

  // The conversation runs the full height of the pane, under both pieces of
  // chrome, so its padding is exactly what they cover. Note what this does
  // *not* change: the list gains `chromeHeight + composerHeight` of client
  // height and the same amount of padding, so `scrollHeight - clientHeight` —
  // every anchor in this chat is expressed in it — comes out unmoved.
  const messageListTopInset = chromeHeight;
  const messageListBottomInset = composerHeight;
  const messageMediaVariants = useMessageMediaVariantUrls(messages);
  const mediaPlaylist = useMemo(
    () => messages
      .map((message) => createMediaPlaybackItem(message, chatId, userId, messageMediaVariants[message.id]))
      .filter((item): item is ChatMediaPlaybackItem => Boolean(item)),
    [chatId, messageMediaVariants, messages, userId],
  );

  return (
    <ChatMediaPlaybackProvider chatId={chatId} playlist={mediaPlaylist}>
      <div
        // The pane paints no fill of its own. It used to paint --kub-chat-bg,
        // which never showed, and was the flat sheet behind the header and the
        // composer that their blur had to sample. Now the list runs the whole
        // height of the pane and passes under both, so what they sample is the
        // conversation — which is the only thing that reads as frosted.
        className="relative flex h-full w-full min-w-0 overflow-hidden"
        style={{
          "--kub-keyboard-inset": `${keyboardInset}px`,
          "--kub-composer-height": `${composerHeight}px`,
          "--kub-chat-chrome-height": `${chromeHeight}px`,
          "--kub-message-list-bottom-inset": `${messageListBottomInset}px`,
        } as CSSProperties}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
      {draggingFiles && (
        <div className="pointer-events-none absolute inset-3 z-50 flex items-center justify-center rounded-3xl border-2 border-dashed border-[color:var(--kub-cyan)] bg-[color-mix(in_srgb,var(--kub-bg)_76%,var(--kub-cyan)_10%)] shadow-2xl">
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-5 py-4 text-center">
            <KubIcon name="attach" size={28} tone="accent" />
            <div className="text-sm font-semibold text-[color:var(--kub-text)]">Отпустите, чтобы добавить вложения</div>
            <div className="text-xs text-[color:var(--kub-muted)]">Файлы будут загружены только после отправки.</div>
          </div>
        </div>
      )}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {loading ? (
          <div className="flex-1 flex items-center justify-center chat-bg">
            <KubIcon name="spinner" size={28} className="text-[color:var(--kub-cyan)]" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center chat-bg">
            <KubEmptyState
              icon={<KubIcon name="chatRect" size={24} />}
              title="Сообщений пока нет"
              description="Поздоровайтесь и начните разговор."
            />
          </div>
        ) : (
          <MessageList
            messages={messages}
            onReply={handleReply}
            onJumpToReply={handleJumpToReply}
            onReaction={toggleReaction}
            onEdit={(msg) => setEditingMessage(msg)}
            onDelete={(msg) => deleteMessage(msg.id)}
            onHideForMe={handleHideForMe}
            onBulkHideForMe={handleBulkHideForMe}
            onBulkDeleteForEveryone={savedChat ? undefined : handleBulkDeleteForEveryone}
            onTogglePin={userId ? handleTogglePin : undefined}
            onForward={(msg) => setForwardingMessage(msg)}
            onRetrySend={(msg) => void retryMessageSend(msg)}
            onEditFailedSend={handleEditFailedSend}
            onDiscardLocalMessage={(msg) => discardLocalMessage(msg.id)}
            onOpenMedia={setOpenMedia}
            bottomRef={bottomRef}
            isTyping={isTyping}
            highlightedId={highlightedId}
            messageRefs={messageRefs}
            chatMembers={chat?.members}
            chatType={chat?.type}
            isSavedChat={savedChat}
            myRole={myRole}
            onLoadOlder={loadOlderMessages}
            hasMoreOlder={hasMoreOlder}
            loadingOlder={loadingOlder}
            olderError={olderError}
            bottomInset={messageListBottomInset}
            topInset={messageListTopInset}
            layoutKey={chatId}
            layoutVersion={composerHeight}
            initialUnreadCount={initialUnreadRef.current?.chatId === chatId ? initialUnreadRef.current.count : 0}
            initialUnreadSince={initialUnreadRef.current?.chatId === chatId ? initialUnreadRef.current.since : null}
          />
        )}

        <div
          ref={chromeRef}
          // Over the conversation, not above it. Taken out of the column's flow
          // so the list can have the whole pane and the glass something to
          // frost; the list pays it back as padding, measured from this box.
          //
          // D-062: last in the column's markup, and that is load-bearing. The
          // header, the list and the composer are all positioned boxes with
          // `z-index: auto`, so what paints on top is decided by tree order.
          // This block used to come first and `order: -1` on the list was what
          // moved the list underneath it — but `order` only re-orders painting
          // for flex *items*, and WebKit does not apply it to positioned ones
          // at all. Measured on Safari 26.4 at 390x844: the topmost element at
          // the header's centre was a message bubble, the back button's own
          // centre hit-tested to a bubble, and the header's menu could not be
          // opened at any width. Nobody could leave a conversation on iPhone.
          //
          // Tree order is the only mechanism here that costs nothing else. A
          // `z-index` on this box, or an `isolation` on the column, would make
          // a stacking context and clamp every `fixed` overlay hosted in this
          // subtree — this header's menu and its modals, the composer's camera
          // and video recorder, a bubble's context menu — inside it; whichever
          // of the two chrome boxes then lost would have its full-screen dialog
          // covered by the other. A negative `z-index` on the list is worse: it
          // stops being the hit-test target, measured false in both engines.
          //
          // The cost paid instead is reading order: the conversation is read
          // before its header. `KubGlassLayer`'s note explains why the header
          // still keeps a plain `relative` box.
          className="absolute inset-x-0 top-0 flex flex-col"
          data-testid="chat-chrome-stack"
        >
          <ChatHeader
            chatId={chatId}
            chat={chat}
            onSearchOpen={() => setShowSearch(true)}
            onInfoOpen={() => setShowInfo(true)}
            onClearForMe={clearChatForMe}
            mediaPlayback={<ChatMediaPlaybackBar compact />}
          />

          {isForum && (
            <TopicStrip
              topics={topics}
              canManage={canManageTopics}
              onCreate={createTopic}
            />
          )}

          {showSearch && (
            <ChatSearchBar
              chatId={chatId}
              currentTopicId={messageTopicId}
              isForum={isForum}
              messages={messages}
              onClose={() => setShowSearch(false)}
              onJumpTo={handleSearchJump}
            />
          )}

          {pinError && (
            <div className="mx-3 mt-2 rounded-lg border border-[color:var(--kub-border-color)] bg-[var(--kub-surface)] px-3 py-2 text-xs text-[color:var(--kub-muted)]">
              {pinError}
            </div>
          )}

          {pinnedReady && pinnedMessages.length > 0 && (
            <PinnedMessage
              messages={pinnedMessages}
              onJump={handleJumpToPinned}
              onUnpin={userId ? (msg) => void handleTogglePin(msg) : undefined}
            />
          )}
        </div>

        <div
          ref={composerRef}
          data-testid="chat-composer-dock"
          // Over the conversation for the same reason the header is, and last
          // in the column's markup for the same reason it was: nothing about
          // the composer's own box changes, so the camera, the video recorder
          // and the attachment backdrop still lay out against the viewport.
          className="absolute inset-x-0 bottom-0 transition-[padding-bottom] duration-150 ease-out"
          style={{ paddingBottom: "calc(var(--kub-keyboard-inset, 0px) + env(safe-area-inset-bottom))" }}
        >
          <MessageInput
            chatId={chatId}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            onSend={handleSend}
            onEdit={editMessage}
            onSendVoice={handleSendVoice}
            onSendVideoMessage={handleSendVideoMessage}
            onTyping={sendTyping}
            attachments={stagedAttachments}
            mediaQuality={mediaQuality}
            onMediaQualityChange={setMediaQuality}
            onStageFiles={(files, source) => stageFiles(files, source)}
            onRemoveAttachment={removeStagedAttachment}
            onRetryAttachment={retryStagedAttachment}
            onCancelAttachment={cancelStagedAttachment}
            draftOverride={draftRestore}
            focusRequestKey={replyFocusKey}
            onFocusChange={setIsComposerFocused}
          />
        </div>
      </div>
      {showInfo && chat && (
        <ChatInfoPanel chat={chat} onClose={() => setShowInfo(false)} onClearForMe={clearChatForMe} />
      )}
      {forwardingMessage && (
        <ForwardModal
          message={forwardingMessage}
          onClose={() => setForwardingMessage(null)}
          onForward={async (targetChatId) => {
            await forwardMessage(forwardingMessage, targetChatId);
            setForwardingMessage(null);
          }}
        />
      )}
        <MediaViewer media={openMedia} onClose={() => setOpenMedia(null)} />
      </div>
    </ChatMediaPlaybackProvider>
  );
}

function hasDraggedFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types ?? []).includes("Files");
}

function filesFromDataTransfer(dataTransfer: DataTransfer): File[] {
  return Array.from(dataTransfer.files ?? []).filter((file) => file instanceof File);
}

function getStagedAttachmentMessageType(attachment: StagedAttachment): "image" | "video" | "audio" | "file" {
  if (attachment.kind === "voice") return "audio";
  if (attachment.kind === "video_message") return "video";
  if (attachment.kind === "image" || attachment.kind === "video" || attachment.kind === "audio") return attachment.kind;
  return "file";
}

function getStagedAttachmentMessageContent(attachment: StagedAttachment, caption: string | null): string {
  if (attachment.kind === "voice") {
    return `🎤 Голосовое сообщение (${formatVoiceDurationLabel(attachment.durationMs ?? 0)})`;
  }
  if (attachment.kind === "video_message") {
    return `Видео-сообщение (${formatVoiceDurationLabel(attachment.durationMs ?? 0)})`;
  }
  return stagedAttachmentTextContent(attachment.kind, caption, attachment.name);
}

function getStagedAttachmentMediaMetadata(attachment: StagedAttachment): Json | null | undefined {
  if (attachment.kind === "video_message") {
    return {
      kind: "video_message",
      shape: "round",
      duration_ms: attachment.durationMs ?? null,
      mime_type: attachment.mimeType,
      size_bytes: attachment.size,
      [MEDIA_QUALITY_METADATA_KEY]: attachment.mediaQuality,
    };
  }
  if (
    attachment.kind === "image" ||
    attachment.kind === "video" ||
    attachment.kind === "audio" ||
    attachment.kind === "file"
  ) {
    return {
      kind: attachment.kind,
      mime_type: attachment.mimeType,
      size_bytes: attachment.size,
      original_size_bytes: attachment.originalSize ?? attachment.size,
      original_mime_type: attachment.originalMimeType ?? null,
      optimized: attachment.optimized ?? false,
      width: attachment.width ?? null,
      height: attachment.height ?? null,
      ...(attachment.kind === "image" || attachment.kind === "video"
        ? { [MEDIA_QUALITY_METADATA_KEY]: attachment.mediaQuality }
        : {}),
    };
  }
  return undefined;
}

function formatVoiceDurationLabel(durationMs: number): string {
  const totalSec = Math.max(1, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const seconds = (totalSec % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function createMediaPlaybackItem(
  message: MessageWithSender,
  chatId: string,
  currentUserId: string | null,
  mediaVariant?: MessageMediaVariantUrls,
): ChatMediaPlaybackItem | null {
  if (!message.media_url || message.deleted_at) return null;
  if (message.type !== "audio" && message.type !== "video") return null;
  const kind: ChatMediaPlaybackItem["kind"] = message.type === "video"
    ? isRoundVideoMessageContent(message)
      ? "video_message"
      : "video"
    : isVoiceMessageContent(message)
      ? "voice"
      : "audio";
  const actor = resolveMessageActor(message);
  const senderName = actor.kind === "user" && actor.id === currentUserId
    ? "Вы"
    : messageActorDisplayName(actor);
  return {
    id: message.id,
    chatId,
    kind,
    url: message.type === "video"
      ? selectVideoPlaybackUrl({
        originalUrl: message.media_url,
        video720pUrl: mediaVariant?.video720pUrl,
        mediaMetadata: message.media_metadata,
      })
      : message.media_url,
    title: kind === "video_message"
      ? "Видеосообщение"
      : kind === "voice"
        ? "Голосовое сообщение"
        : kind === "audio"
          ? "Аудио"
          : "Видео",
    subtitle: senderName,
    durationMs: getMessageMediaMetadataNumber(message, "duration_ms") ?? parseMessageDurationMs(message.content),
  };
}

function getMessageMediaMetadataNumber(message: MessageWithSender, key: string): number | null {
  const metadata = message.media_metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseMessageDurationMs(content: string | null | undefined): number | null {
  const match = content?.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  return (minutes * 60 + seconds) * 1000;
}

function latestTimestamp(...values: Array<string | null | undefined>): string | null {
  let latest: string | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const time = new Date(value).getTime();
    if (!Number.isFinite(time) || time <= latestTime) continue;
    latest = value;
    latestTime = time;
  }
  return latest;
}
