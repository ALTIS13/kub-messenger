"use client";

import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo, type CSSProperties, type ReactNode } from "react";
import { copyWithFeedback } from "@/lib/actionFeedback";
import { resolveCssLength } from "@/lib/cssLength";
import { createPortal } from "react-dom";
import type { MessageWithSender } from "@/types/database";
import { formatFullTime } from "@/lib/format";
import { MessageActorAvatar } from "@/components/ui/ChatAvatar";
import type { AvatarVariantUrls, MessageMediaVariantUrls } from "@/hooks/useMediaVariants";
import { AudioMessage } from "./AudioMessage";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app.store";
import { FormattedText, isLocationPreviewMessage } from "@/lib/formatText";
import { KubIcon, type KubIconName } from "@/components/kub";
import type { MediaViewerItem } from "./MediaViewer";
import { useChatMediaPlayback, VideoCircleProgressRing, type ChatMediaPlaybackItem } from "./ChatMediaPlayback";
import { requestAppConfirm } from "@/lib/appDialogs";
import type { MessageDeliveryState } from "@/lib/messageDelivery";
import {
  getGroupReadReceiptAriaLabel,
  getGroupReadReceiptCompactLabel,
  type GroupReadReceiptInfo,
} from "@/lib/groupReadReceipts";
import { formatReplyMessagePreview } from "@/lib/messagePreview";
import { getVideoPlaybackFallbackUrl, selectVideoPlaybackUrl } from "@/lib/mediaQuality";
import { EmojiCategoryPicker } from "@/components/ui/EmojiCategoryPicker";
import { MESSAGE_EMOJI_CATEGORIES, MESSAGE_EMOJI_SEARCH_TERMS } from "@/lib/emojiCatalog";
import {
  messageActorDisplayName,
  resolveMessageActor,
} from "@/lib/messageActor";

const EMOJI_QUICK = ["👍", "❤️", "😂", "😮", "😢", "🔥", "👏", "🎉"];

interface ContextItem {
  icon: KubIconName;
  label: string;
  danger?: boolean;
  action: () => void;
}

type TextLayoutKind = "short" | "regular" | "link" | "longToken" | "preformatted" | "media";
type MetaPlacement = "inline" | "anchored";

interface MessageBubbleProps {
  message: MessageWithSender;
  /** Arrived while the list was on screen. History does not animate. */
  isEntering?: boolean;
  isMe: boolean;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  onReply: () => void;
  onJumpToReply?: (messageId: string) => void;
  onReaction: (emoji: string) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onHideForMe?: () => void;
  onStartSelection?: () => void;
  onTogglePin?: () => void;
  onForward?: () => void;
  onRetrySend?: () => void;
  onEditFailedSend?: () => void;
  onDiscardLocalMessage?: () => void;
  onOpenMedia?: (media: MediaViewerItem) => void;
  reactionMenuOpen?: boolean;
  onToggleReactionMenu?: () => void;
  onCloseReactionMenu?: () => void;
  actionMenuOpen?: boolean;
  onOpenActionMenu?: () => void;
  onCloseActionMenu?: () => void;
  selected?: boolean;
  isSelectionMode?: boolean;
  messagesMap?: Record<string, MessageWithSender>;
  mediaVariant?: MessageMediaVariantUrls;
  senderAvatarVariant?: AvatarVariantUrls;
  deliveryState?: MessageDeliveryState | null;
  groupReadInfo?: GroupReadReceiptInfo | null;
  onOpenGroupReadReceipts?: () => void;
  myRole?: "owner" | "admin" | "member" | null;
  isSavedChat?: boolean;
}

function getMessageTextLayoutKind(type: MessageWithSender["type"], content: string): TextLayoutKind {
  if (type !== "text") return "media";
  const text = content.trim();
  if (!text) return "short";

  const hasUrl = /\bhttps?:\/\/\S+/.test(text);
  const hasCodeFence = /```[\s\S]*```/.test(content);
  const lines = text.split(/\r?\n/);
  const longestToken = text
    .split(/\s+/)
    .reduce((max, token) => Math.max(max, token.length), 0);
  const meaningfulLines = lines.filter((line) => line.trim().length > 0);
  const indentedLines = meaningfulLines.filter((line) => /^( {2,}|\t)/.test(line)).length;
  const spacedLines = meaningfulLines.filter((line) => / {3,}|\t/.test(line)).length;
  const asciiArtLines = meaningfulLines.filter((line) => {
    const compact = line.replace(/\s/g, "");
    if (compact.length < 8) return false;
    const asciiArtChars = compact.match(/[+\-|=_*`~./\\()[\]{}<>#@░▒▓█─│┌┐└┘]/g)?.length ?? 0;
    return asciiArtChars / compact.length >= 0.45;
  }).length;
  const preformattedLike =
    hasCodeFence ||
    (meaningfulLines.length >= 3 && (indentedLines >= 2 || spacedLines >= 2 || asciiArtLines >= 2));

  if (preformattedLike && !hasUrl) return "preformatted";
  if (isLocationPreviewMessage(content)) return "short";
  if (hasUrl) return "link";
  if (longestToken >= 34) return "longToken";
  if (text.length >= 8 && /\s/.test(text)) return "regular";
  return "short";
}

function getMessageWidthClasses(kind: TextLayoutKind): { stack: string; bubble: string; text: string } {
  switch (kind) {
    case "link":
      return {
        stack: "w-fit max-w-[86vw] sm:max-w-[min(64vw,580px,max(16rem,calc(100%-var(--kub-action-lane))))] md:max-w-[min(52vw,580px,max(16rem,calc(100%-var(--kub-action-lane))))]",
        bubble: "w-fit max-w-full min-w-0",
        text: "[overflow-wrap:anywhere] [word-break:break-word]",
      };
    case "preformatted":
      return {
        stack: "w-[min(86vw,54rem)] max-w-[86vw] sm:w-[min(74vw,54rem)] md:w-[min(70vw,54rem)]",
        bubble: "w-full",
        text: "overflow-x-auto font-mono text-[13px] leading-snug [overflow-wrap:anywhere] [tab-size:2]",
      };
    case "longToken":
      return {
        stack: "w-fit max-w-[86vw] sm:max-w-[min(60vw,580px,max(16rem,calc(100%-var(--kub-action-lane))))] md:max-w-[min(52vw,580px,max(16rem,calc(100%-var(--kub-action-lane))))]",
        bubble: "w-fit max-w-full min-w-0",
        text: "[overflow-wrap:anywhere] [word-break:break-word]",
      };
    case "regular":
      return {
        stack: "w-fit max-w-[86vw] sm:max-w-[min(70vw,560px,max(16rem,calc(100%-var(--kub-action-lane))))] md:max-w-[min(56vw,560px,max(16rem,calc(100%-var(--kub-action-lane))))]",
        bubble: "w-fit max-w-full min-w-0",
        text: "[overflow-wrap:break-word] [word-break:normal]",
      };
    case "short":
      return {
        stack: "w-fit max-w-[86vw] sm:max-w-[min(72vw,680px,max(16rem,calc(100%-var(--kub-action-lane))))] md:max-w-[min(65vw,680px,max(16rem,calc(100%-var(--kub-action-lane))))]",
        bubble: "w-fit max-w-full min-w-0",
        text: "[overflow-wrap:break-word] [word-break:normal]",
      };
    case "media":
    default:
      return {
        stack: "w-fit max-w-[86vw] sm:max-w-[min(72vw,680px,max(16rem,calc(100%-var(--kub-action-lane))))] md:max-w-[min(65vw,680px,max(16rem,calc(100%-var(--kub-action-lane))))]",
        bubble: "w-fit",
        text: "[overflow-wrap:break-word] [word-break:normal]",
      };
  }
}

/**
 * The inline cap, which beats the class one — so it carries the same reserve.
 *
 * `calc(100% - 6.5rem)` keeps a lane clear beside the bubble for the hover
 * actions. The row hides its overflow, so without it a bubble at full width
 * left the action cluster nothing: measured on a 1024px window it started at
 * x=347 against a clip edge of x=396, with 49px cut off.
 */
/**
 * The lane, floored.
 *
 * `100%` here is the message row, and the row is not its final width for the
 * first frames after a chat opens. Measured on a chat of 1368 messages: the row
 * was 142px at one sample, which took the lane term to 38px, wrapped a short
 * message into thirteen lines and made the whole list 26,366px tall — against
 * 10,464px once it settled. The view is scrolled to the bottom against that
 * tall version, which is the lurch on entry.
 *
 * The floor means a momentarily narrow row falls back to the other terms rather
 * than collapsing the bubble to nothing. On a real layout `100% - lane` is far
 * above the floor and still governs.
 */
const ACTION_LANE = "max(16rem, calc(100% - var(--kub-action-lane)))";

function getMessageStackStyle(kind: TextLayoutKind): CSSProperties | undefined {
  switch (kind) {
    case "link":
    case "longToken":
      return { maxWidth: `min(86vw, 580px, ${ACTION_LANE})` };
    case "regular":
      return { maxWidth: `min(86vw, 560px, ${ACTION_LANE})` };
    default:
      return undefined;
  }
}

function clampReplyPreviewText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return normalized;
  const chars = Array.from(normalized);
  if (chars.length <= maxLength) return normalized;
  return `${chars.slice(0, Math.max(1, maxLength - 3)).join("")}...`;
}

function getCompactReplyPreviewCap(replyBody: string): { chars: number; maxWidth: string } {
  const length = Array.from(replyBody.replace(/\s+/g, " ").trim()).length;

  if (length <= 6) {
    return { chars: 12, maxWidth: "min(100%, 108px, 13ch)" };
  }

  if (length <= 12) {
    return { chars: 14, maxWidth: "min(100%, 116px, 14ch)" };
  }

  return { chars: 16, maxWidth: "min(100%, 124px, 16ch)" };
}

/*
 * Message text is start-aligned. It was justified, and D-060 is why it is not.
 *
 * Justification moves a line's slack into its word spaces, and it can only give
 * that slack somewhere else if the text hyphenates. Russian prose here does not:
 * the bubble carried `hyphens: manual`, and no engine hyphenates on its own
 * without being asked. So every line paid for the one long word it could not
 * break, and the narrower the column the more it paid.
 *
 * Measured on the DEV preview fixture with a `Range` over each word, worst gap
 * per rendered message against a natural space of 3.94px in this font at 14px:
 *
 *   viewport   bubble    worst gap   × natural
 *   360        275.9px   63.58px     16.15
 *   390        305.9px   52.00px     13.21
 *   412        327.9px   47.55px     12.08
 *   640        481.9px   22.78px      5.79
 *   768        249.9px   39.94px     10.14   (the sidebar appears; the bubble narrows)
 *   1440       537.9px   19.08px      4.85
 *
 * There is no width where it behaves — the widest bubble the product can show
 * still opens gaps nearly five times a space — so this is removed rather than
 * gated behind a breakpoint. The register's own numbers, taken on a real device
 * against a different message, agree: 7.76× at 360 and 3.48× at 412.
 */

/**
 * What to render before anything has been measured.
 *
 * The 56-character rule belonged to the old layout, where the meta flowed after
 * the last word and a long message usually did need a row of its own. The meta
 * is positioned at the bubble's corner now, with its space reserved on the last
 * line, so inline is almost always what the measurement goes on to choose — and
 * guessing anchored meant the message appeared with a row it then dropped.
 * Measured on production: a bubble painted at 81px and settled at 59px.
 *
 * An explicit line break still starts anchored. There the last line is the
 * author's choice rather than the result of wrapping, so it can be full width
 * and leave the meta nowhere to sit.
 */
function getInitialMetaPlacement(content: string): MetaPlacement {
  const text = content.trim();
  if (!text) return "inline";
  if (isLocationPreviewMessage(content)) return "inline";
  if (/[\r\n]/.test(content)) return "anchored";
  return "inline";
}

function canRenderCompactReplyInline(message: MessageWithSender, kind: TextLayoutKind, hasReactions: boolean): boolean {
  if (!message.reply_to_id || hasReactions || message.failed) return false;
  if (message.type !== "text" || kind !== "short") return false;
  const text = (message.content ?? "").trim();
  return Boolean(text) && !/[\r\n]/.test(text) && text.length <= 24;
}

/**
 * One shared promise for "the fonts have loaded", instead of one per message.
 *
 * Every bubble asked `document.fonts.ready` from its own measurement effect. It
 * is a getter that does real work, and with a screenful of messages it showed
 * up in a CPU profile of chat switching as 304ms of self time — the second
 * largest non-idle entry. Reading it once is enough: the answer is the same for
 * every bubble on the page.
 */
let fontsReadyPromise: Promise<unknown> | null = null;

function whenFontsReady(): Promise<unknown> {
  if (typeof document === "undefined") return Promise.resolve();
  if (!fontsReadyPromise) {
    fontsReadyPromise = document.fonts ? document.fonts.ready.catch(() => undefined) : Promise.resolve();
  }
  return fontsReadyPromise;
}

/**
 * A pixel length, or nothing.
 *
 * It used to accept anything `parseFloat` could chew on, which meant a computed
 * `max-width: 100%` came back as the number 100 — a hundred pixels. That fed
 * the inline-meta decision a width of 100px and made it flip its answer every
 * render.
 */
function parsePixelValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed.endsWith("px")) return null;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function getTextLineRects(contentEl: HTMLElement): DOMRect[] {
  const range = document.createRange();
  range.selectNodeContents(contentEl);
  const rects = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0.5 && rect.height > 0.5)
    .sort((a, b) => (a.top === b.top ? a.left - b.left : a.top - b.top));
  range.detach();

  const lines: Array<{ top: number; right: number; bottom: number; left: number }> = [];
  for (const rect of rects) {
    const rectCenter = (rect.top + rect.bottom) / 2;
    const line = lines.find((candidate) => {
      const candidateCenter = (candidate.top + candidate.bottom) / 2;
      return Math.abs(candidateCenter - rectCenter) <= Math.max(4, Math.min(candidate.bottom - candidate.top, rect.height) * 0.7);
    });

    if (line) {
      line.top = Math.min(line.top, rect.top);
      line.right = Math.max(line.right, rect.right);
      line.bottom = Math.max(line.bottom, rect.bottom);
      line.left = Math.min(line.left, rect.left);
    } else {
      lines.push({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left });
    }
  }

  return lines
    .sort((a, b) => (a.top === b.top ? a.left - b.left : a.top - b.top))
    .map((line) => new DOMRect(line.left, line.top, line.right - line.left, line.bottom - line.top));
}

/**
 * The declared ceiling on the bubble's content, in pixels, or nothing.
 *
 * The stack carries the design cap — `min(86vw, 560px, max(16rem, 100% - lane))`
 * — and it is a real ceiling: the row can want more, and the stack still stops
 * there. Measuring the row alone therefore over-estimates whenever the design
 * cap is the tighter constraint, which is D-032: a last line 507px wide was
 * told it had 984px, chose inline, and the reserved spacer then wrapped and
 * grew the bubble 22.8px, 46ms after it was painted.
 *
 * Only the terms that do not move are read. `getComputedStyle` has already made
 * every unit absolute — `86vw` arrives as `1238.4px`, the lane as `104px` — and
 * the one thing left standing is `100%`, whose basis is the row. The row is
 * shrink-to-fit around this very bubble, so that term is not a ceiling at all:
 * it grows with the content, and resolving it against the row's current width
 * fed the measurement a limit that moved with the placement. Measured, that
 * flipped two settled messages in an unrelated chat from inline to anchored and
 * made them 15px taller. So `%` is treated as unbounded here and drops out of
 * the `min()`, leaving the fixed design ceiling — which is the only part that
 * can be applied without reopening a feedback loop.
 *
 * A cap that resolves to nothing finite returns `null`, and the caller keeps
 * the row's answer rather than a guess.
 */
function getDeclaredContentCap(bubbleStyle: CSSStyleDeclaration, stackEl: HTMLElement | null): number | null {
  if (!stackEl) return null;
  const declared = resolveCssLength(getComputedStyle(stackEl).maxWidth, Number.POSITIVE_INFINITY);
  if (declared === null || declared <= 0) return null;

  // The stack's cap bounds the bubble's BORDER box, so the border comes off as
  // well as the padding. The bubble's own `max-width` is deliberately not read:
  // it is `100%` of the stack, and the stack is shrink-to-fit, so it describes
  // the width the bubble happens to have rather than the width it may reach.
  const paddingLeft = parsePixelValue(bubbleStyle.paddingLeft) ?? 0;
  const paddingRight = parsePixelValue(bubbleStyle.paddingRight) ?? 0;
  const borderLeft = parsePixelValue(bubbleStyle.borderLeftWidth) ?? 0;
  const borderRight = parsePixelValue(bubbleStyle.borderRightWidth) ?? 0;
  return declared - paddingLeft - paddingRight - borderLeft - borderRight;
}

/**
 * How wide the bubble's content is allowed to become.
 *
 * This is the quantity the inline-meta decision actually needs. Asking instead
 * how much room is left to the RIGHT of the last line is wrong for an own
 * message: that bubble is pinned to the right edge and grows leftwards, so the
 * space to its right is zero no matter how much room it really has. Measured,
 * that sent a 150px message with a 29px timestamp — inside a 536px allowance —
 * onto its own row.
 */
function getMaxContentWidth(bubbleEl: HTMLElement, stackEl: HTMLElement | null): number {
  const bubbleStyle = getComputedStyle(bubbleEl);
  const paddingLeft = parsePixelValue(bubbleStyle.paddingLeft) ?? 0;
  const paddingRight = parsePixelValue(bubbleStyle.paddingRight) ?? 0;

  // Measured from the ROW, not read from a declared `max-width`. The stack's
  // cap is a `min()` of three terms, which computes to a string no number
  // parses — and the fallback was the bubble's CURRENT width, which differs
  // between the two placements. That is a feedback loop: inline made the bubble
  // narrow, the narrow bubble said the meta did not fit, anchored made it wide,
  // and the wide bubble said it did. Measured on production, that flip cost 228
  // height changes and 1865px of growth on a chat of 100 messages.
  //
  // The row's width is the same in both placements, so the answer is stable. It
  // over-estimates when the design cap is the tighter constraint, and that is
  // the safe direction: the meta is positioned and its space reserved, so a
  // slightly generous "it fits" costs a few pixels of bubble width, never an
  // overlap.
  //
  // What it does NOT over-estimate is the design cap, so that is applied on top
  // of it. The two together only ever tighten the answer, which is why this
  // cannot reopen the feedback loop: a narrower answer can turn inline into
  // anchored, and anchored removes the spacer, which narrows the row further.
  const row = (stackEl ?? bubbleEl).parentElement;
  const rowWidth = row?.getBoundingClientRect().width ?? bubbleEl.getBoundingClientRect().width;
  const lane =
    parsePixelValue(getComputedStyle(document.documentElement).getPropertyValue("--kub-action-lane")) ?? 0;
  const fromRow = Math.max(0, rowWidth - lane) - paddingLeft - paddingRight;
  const cap = getDeclaredContentCap(bubbleStyle, stackEl);
  return cap === null ? fromRow : Math.min(fromRow, cap);
}

function getTextRightLimit(textEl: HTMLElement, bubbleEl: HTMLElement, stackEl: HTMLElement | null): number {
  const textRect = textEl.getBoundingClientRect();
  const bubbleRect = bubbleEl.getBoundingClientRect();
  const bubbleStyle = getComputedStyle(bubbleEl);
  const paddingLeft = parsePixelValue(bubbleStyle.paddingLeft) ?? 0;
  const paddingRight = parsePixelValue(bubbleStyle.paddingRight) ?? 0;
  const currentContentRight = bubbleRect.right - paddingRight;
  // The bubble's own max-width counts as well as the stack's. Falling back to
  // the text's current width was safe while the meta flowed inside the
  // paragraph — that width included it. The meta is positioned now, so the
  // fallback measured the text alone, left no room for anything, and sent every
  // short message to its own row.
  const stackMaxWidth = stackEl ? parsePixelValue(getComputedStyle(stackEl).maxWidth) : null;
  const bubbleMaxWidth = parsePixelValue(bubbleStyle.maxWidth);
  const declaredMaxWidth = Math.max(stackMaxWidth ?? 0, bubbleMaxWidth ?? 0);
  const maxContentWidth = declaredMaxWidth > 0
    ? Math.max(textRect.width, declaredMaxWidth - paddingLeft - paddingRight)
    : textRect.width;
  const maxRightFromText = textRect.left + maxContentWidth;
  const viewportRight = typeof window === "undefined" ? maxRightFromText : window.innerWidth - 8;
  return Math.min(Math.max(currentContentRight, maxRightFromText), viewportRight);
}

function getBubbleInnerRight(bubbleEl: HTMLElement): number {
  const bubbleRect = bubbleEl.getBoundingClientRect();
  const bubbleStyle = getComputedStyle(bubbleEl);
  const paddingRight = parsePixelValue(bubbleStyle.paddingRight) ?? 0;
  return bubbleRect.right - paddingRight;
}


function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

interface MeasuredTextWithMetaProps {
  content: string;
  textClassName: string;
  meta?: ReactNode;
  bubbleRef: React.RefObject<HTMLDivElement | null>;
  stackRef: React.RefObject<HTMLDivElement | null>;
  measureKey: string;
  compound?: boolean;
}

function MeasuredTextWithMeta({
  content,
  textClassName,
  meta,
  bubbleRef,
  stackRef,
  measureKey,
  compound = false,
}: MeasuredTextWithMetaProps) {
  const [placement, setPlacement] = useState<MetaPlacement>(() => getInitialMetaPlacement(content));
  // The meta is taken out of the text flow and pinned to the bubble's bottom
  // right, so this is how much room the last line has to leave for it.
  const [footerReserve, setFooterReserve] = useState(0);
  const textFlowRef = useRef<HTMLParagraphElement | null>(null);
  const textContentRef = useRef<HTMLSpanElement | null>(null);
  const footerRef = useRef<HTMLSpanElement | null>(null);
  const hasMeta = meta !== null && meta !== undefined && meta !== false;

  const measure = useCallback(() => {
    const textEl = textFlowRef.current;
    const contentEl = textContentRef.current;
    const footerEl = footerRef.current;
    // The bubble and the stack are ANCESTORS of this component, and React
    // attaches a host ref during the layout phase, which walks children before
    // parents. On the one mount that matters both refs are therefore still
    // null, this returned at its first guard, and the guess stood: measured on
    // the real chat, an own message's row was painted 38.8px tall and became
    // 50.8px one frame later (D-041).
    //
    // The nodes themselves are already in the document by then — React inserts
    // the whole subtree before it runs any layout effect — so they are read
    // from the DOM instead of waited for. The refs stay the fast path for every
    // later pass, and they point at these same two elements.
    const ownEl = textEl ?? contentEl;
    const bubbleEl =
      bubbleRef.current ?? (ownEl?.closest('[data-message-bubble="true"]') as HTMLElement | null) ?? null;
    const stackEl = stackRef.current ?? (bubbleEl?.parentElement as HTMLElement | null) ?? null;
    if (!hasMeta || !textEl || !contentEl || !footerEl || !bubbleEl) return;

    const lineRects = getTextLineRects(contentEl);
    const lastLine = lineRects.at(-1) ?? null;
    if (!lastLine) {
      setPlacement((current) => (current === "inline" ? current : "inline"));
      return;
    }

    const footerRect = footerEl.getBoundingClientRect();
    const bubbleInnerRight = getBubbleInnerRight(bubbleEl);
    const rightLimit = compound ? bubbleInnerRight : getTextRightLimit(textEl, bubbleEl, stackEl);
    const gap = 8;
    // There used to be a guard here that flipped to `anchored` whenever the
    // footer was not vertically on the last text line. It was written for a
    // footer that flowed after the last word; the footer is positioned now, so
    // the question it asked no longer has meaning — and asking it anyway sent
    // every short single-line message to its own row.

    // Whether the meta fits is a measurement, and the measurement already
    // answers it: `available` is the room left after the *last* rendered line,
    // however many lines there are. A separate single-line condition used to
    // sit on top of this and refuse every wrapped message, so a bubble whose
    // last line ended well short of the edge still grew a row containing
    // nothing but a right-aligned timestamp. See D-008.
    //
    // Removing it cannot oscillate. The spacer that reserves room for the meta
    // sits outside the measured span, so adding it can only shorten the last
    // line and therefore only increase `available` — a message that chose
    // inline never measures its way back out of it.
    const reserve = Math.ceil(footerRect.width + gap);
    setFooterReserve((current) => (Math.abs(current - reserve) <= 1 ? current : reserve));

    // A compound bubble's width is fixed by whatever sits above the text, so
    // for those the room to the right of the last line is the real constraint.
    // A plain text bubble sizes itself, so the question is whether the last
    // line and the meta fit inside the width it is allowed to reach.
    let canInline: boolean;
    if (compound) {
      canInline = rightLimit - lastLine.right >= footerRect.width + gap;
    } else {
      const maxContentWidth = getMaxContentWidth(bubbleEl, stackEl);
      // Refuse to answer on a width that cannot be real. A bubble mounting
      // inside a prepended page is measured while its row is still being laid
      // out, and the row reports a width of zero — which said the meta could
      // never fit inline. Every prepended message therefore appeared with a row
      // for the timestamp and dropped it a frame later: measured, 706px of the
      // list's height vanished at t=303ms and took the reader's place with it.
      // Keeping the current placement and waiting for the next pass costs
      // nothing, because a later pass always comes.
      if (maxContentWidth < 80) return;
      canInline = lastLine.width + footerRect.width + gap <= maxContentWidth;
    }
    const next: MetaPlacement = canInline ? "inline" : "anchored";

    setPlacement((previous) => (previous === next ? previous : next));
  }, [bubbleRef, compound, hasMeta, placement, stackRef]);

  /**
   * Back to the guess when the text CHANGES — and never on the mount itself.
   *
   * This is a passive effect, so React runs it after the commit that mounted
   * the row. On that first run it set state the component already had, which
   * looked like a no-op and was not: by then the layout effect below had
   * already measured the row and replaced the guess with the answer, and this
   * put the guess back. The measured value returned a frame later, through the
   * `requestAnimationFrame` pass, and that frame is D-041 — an own message's
   * bubble painted 36.8px tall and grown to 48.8px 16ms after it appeared.
   *
   * Skipping the first run restores exactly nothing, because `useState` already
   * initialises to the same two values. What it stops doing is overwriting a
   * decision that was made after it.
   */
  const resetKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const resetKey = `${measureKey} ${content}`;
    if (resetKeyRef.current === resetKey) return;
    const isFirstRun = resetKeyRef.current === null;
    resetKeyRef.current = resetKey;
    if (isFirstRun) return;
    setFooterReserve(0);
    setPlacement(getInitialMetaPlacement(content));
  }, [content, measureKey]);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    let frame = 0;
    let cancelled = false;
    const schedule = () => {
      if (cancelled) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };
    const handleViewportResize = () => {
      schedule();
    };

    // Measure once SYNCHRONOUSLY, before this frame is painted. Every pass used
    // to go through `requestAnimationFrame`, which runs after paint — so a
    // message appeared with the meta inline, then grew a row for it on the next
    // frame. Measured on a chat of 100 messages: 304 height changes after mount
    // and 1865px of total growth, every one of them an `inline -> anchored`
    // flip. It is also what broke the history anchor when older messages were
    // prepended, because the restored position was computed from heights that
    // were about to change.
    measure();
    // The later passes stay: fonts, images and a viewport change can all move
    // the answer after the first paint.
    schedule();
    const secondFrame = window.requestAnimationFrame(schedule);
    // Two nodes, not five. The paragraph, its content span and the bubble are
    // all nested inside the stack and resize with it, so observing them as well
    // only multiplied the callbacks: one resize produced five measurements per
    // message, on every message on screen.
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    [stackRef.current ?? bubbleRef.current, footerRef.current]
      .filter(Boolean)
      .forEach((node) => observer?.observe(node as Element));
    window.addEventListener("resize", handleViewportResize);
    void whenFontsReady().then(schedule);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(secondFrame);
      window.removeEventListener("resize", handleViewportResize);
      observer?.disconnect();
    };
  }, [bubbleRef, measure, measureKey, placement, stackRef]);

  const footerClassName = "inline-flex w-fit max-w-full shrink-0 items-center justify-end gap-1 whitespace-nowrap text-right leading-none";

  return (
    <div
      data-message-text-meta-group="true"
      data-message-meta-placement={placement}
      className={cn(
        "relative max-w-full min-w-0",
        placement === "inline" ? "w-fit self-start" : "w-full"
      )}
    >
      <p
        ref={textFlowRef}
        data-message-text-flow="true"
        className={cn(textClassName, placement === "inline" && "w-fit")}
      >
        <span ref={textContentRef} data-message-text-content="true">
          <FormattedText content={content} />
        </span>
        {/* A spacer, not the meta itself. It keeps the last line from running
            under the timestamp — and because it is the only thing left in the
            flow, the bubble still grows for a message that needs the room. */}
        {hasMeta && placement === "inline" && footerReserve > 0 && (
          <span
            aria-hidden="true"
            data-message-footer-reserve="true"
            style={{ display: "inline-block", width: `${footerReserve}px` }}
          />
        )}
      </p>
      {/* Pinned to the bubble's bottom right rather than flowing after the last
          word. A wrapped message takes its width from its LONGEST line, so a
          timestamp glued to a short final line sat in the middle of the bubble
          — measured at 348px, 328px and 157px from the right edge of a 560px
          bubble, against 13px for a single-line message. */}
      {hasMeta && placement === "inline" && (
        <span
          ref={footerRef}
          data-message-footer="true"
          className={cn(footerClassName, "absolute bottom-0 right-0 translate-y-[-1px]")}
        >
          {meta}
        </span>
      )}
      {hasMeta && placement === "anchored" && (
        <div
          data-message-bottom-meta="true"
          className="mt-0.5 flex max-w-full items-center justify-end leading-none"
        >
          <span ref={footerRef} data-message-footer="true" className={footerClassName}>
            {meta}
          </span>
        </div>
      )}
    </div>
  );
}

export function MessageBubble({
  message, isEntering = false, isMe, isFirstInGroup, isLastInGroup,
  onReply, onJumpToReply, onReaction, onEdit, onDelete, onHideForMe, onStartSelection, onTogglePin, onForward, onOpenMedia,
  onRetrySend, onEditFailedSend, onDiscardLocalMessage,
  reactionMenuOpen = false, onToggleReactionMenu, onCloseReactionMenu,
  actionMenuOpen, onOpenActionMenu, onCloseActionMenu, selected = false, isSelectionMode = false,
  messagesMap = {}, mediaVariant, senderAvatarVariant, deliveryState, groupReadInfo, onOpenGroupReadReceipts, isSavedChat,
}: MessageBubbleProps) {
  const [showContext, setShowContext] = useState(false);
  // D-046. `.msg-appear` carries `will-change: opacity, transform` under a
  // comment saying the hint is dropped when the animation ends. Nothing dropped
  // it: measured, a hundred rows still held the class and the hint eighteen
  // seconds after the last one finished. This is what drops it, and because the
  // flag only ever goes from false to true for this mount, a later render can
  // no longer put the class back and replay the fade on a settled bubble.
  const [entranceSettled, setEntranceSettled] = useState(false);
  const [reactionCatalogOpen, setReactionCatalogOpen] = useState(false);
  const [reactionsExpanded, setReactionsExpanded] = useState(false);
  const [contextPos, setContextPos] = useState({ x: 0, y: 0 });
  const [reactionPos, setReactionPos] = useState({ x: 0, y: 0 });
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const stackRef = useRef<HTMLDivElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const reactionsLayerRef = useRef<HTMLDivElement | null>(null);
  const reactionOverflowTriggerRef = useRef<HTMLButtonElement | null>(null);
  const reactionOverflowPopoverRef = useRef<HTMLDivElement | null>(null);
  const reactionOverflowCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reactionOverflowStyle, setReactionOverflowStyle] = useState<CSSProperties>({
    left: 8,
    top: 8,
    maxWidth: "calc(100vw - 16px)",
  });
  const { currentUser } = useAppStore();
  const actor = resolveMessageActor(message);
  const actorName = messageActorDisplayName(actor);
  const textContent = message.content ?? "";
  const mediaCaption = getVisibleMediaCaption(message);
  const mediaDimensions = getMessageMediaDimensions(message);
  const imageDisplayUrl = message.type === "image"
    ? mediaVariant?.previewUrl ?? message.media_url
    : message.media_url;
  const imageDimensions = message.type === "image" && mediaVariant?.previewWidth && mediaVariant?.previewHeight
    ? { width: mediaVariant.previewWidth, height: mediaVariant.previewHeight }
    : mediaDimensions;
  /**
   * The width of whatever `imageDisplayUrl` points at, and of nothing else.
   *
   * `imageDimensions` cannot answer this, which is the trap: it is chosen on
   * `previewWidth && previewHeight` while the URL above is chosen on
   * `previewUrl`, and those are not the same condition. `media_variants.width`
   * is nullable, so a preview row that carries an address but no width sends
   * `imageDimensions` to `mediaDimensions` — the ORIGINAL's metadata — while
   * the element is showing the preview. Declaring the original's width on the
   * preview's address is the same lie as the hardcoded `1280w`, just harder to
   * see, and no `thumbWidth < mainWidth` guard can catch it because the
   * original really is the larger number.
   *
   * Keyed on `previewUrl` so the width and the address can never come from
   * different rows. Unknown stays unknown, and the caller drops the set.
   */
  const imageDisplayWidth = message.type === "image"
    ? (mediaVariant?.previewUrl ? mediaVariant.previewWidth ?? null : mediaDimensions?.width ?? null)
    : null;
  const videoPosterUrl = message.type === "video" ? mediaVariant?.videoPosterUrl : undefined;
  const videoPlaybackUrl = message.type === "video" && message.media_url
    ? selectVideoPlaybackUrl({
      originalUrl: message.media_url,
      video720pUrl: mediaVariant?.video720pUrl,
      mediaMetadata: message.media_metadata,
    })
    : message.media_url;
  const textLayoutKind = getMessageTextLayoutKind(message.type, textContent);
  const widthClasses = getMessageWidthClasses(textLayoutKind);
  const stackStyle = getMessageStackStyle(textLayoutKind);
  const viewportWidth = typeof window === "undefined" ? 1024 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 768 : window.innerHeight;
  const compactContextMenu = viewportWidth < 640;
  const contextMenuWidth = 256;
  const contextMenuMaxHeight = Math.max(180, Math.min(480, viewportHeight - 16));
  const contextMenuOpensUp = !compactContextMenu && contextPos.y > viewportHeight / 2;
  const contextMenuStyle: CSSProperties = compactContextMenu
    ? { left: 12, right: 12, bottom: 12, maxHeight: "min(65vh, 480px)" }
    : {
        left: Math.min(Math.max(8, contextPos.x), Math.max(8, viewportWidth - contextMenuWidth - 8)),
        width: contextMenuWidth,
        maxHeight: contextMenuMaxHeight,
        ...(contextMenuOpensUp
          ? { bottom: Math.max(8, viewportHeight - contextPos.y + 8) }
          : { top: Math.min(contextPos.y + 8, Math.max(8, viewportHeight - contextMenuMaxHeight - 8)) }),
      };
  const reactionPickerWidth = reactionCatalogOpen ? Math.min(480, viewportWidth - 16) : 284;
  const reactionPickerMaxHeight = Math.min(340, viewportHeight - 16);
  const reactionPickerStyle: CSSProperties = {
    left: Math.min(Math.max(8, reactionPos.x - reactionPickerWidth / 2), Math.max(8, viewportWidth - reactionPickerWidth - 8)),
    width: Math.min(reactionPickerWidth, viewportWidth - 16),
    maxHeight: reactionPickerMaxHeight,
    ...(reactionCatalogOpen
      ? reactionPos.y > viewportHeight / 2
        ? { bottom: Math.max(8, viewportHeight - reactionPos.y + 8) }
        : { top: Math.min(viewportHeight - reactionPickerMaxHeight - 8, reactionPos.y + 36) }
      : reactionPos.y > 64
        ? { top: Math.max(8, reactionPos.y - 52) }
        : { top: Math.min(viewportHeight - 52, reactionPos.y + 36) }),
  };
  const contextOpen = actionMenuOpen ?? showContext;
  const closeContext = useCallback(() => {
    setShowContext(false);
    onCloseActionMenu?.();
  }, [onCloseActionMenu]);

  // Belt-and-suspenders cleanup: if the bubble unmounts mid-touch (e.g. user
  // navigates away during a long-press), clear the pending timer so it
  // doesn't try to setShowContext on a torn-down component.
  useEffect(() => () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    if (reactionOverflowCloseTimer.current) clearTimeout(reactionOverflowCloseTimer.current);
    setBodySelectionSuppressed(false);
  }, []);

  useEffect(() => {
    if (!contextOpen) setBodySelectionSuppressed(false);
  }, [contextOpen]);

  useEffect(() => {
    if (!reactionMenuOpen) {
      setReactionCatalogOpen(false);
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseReactionMenu?.();
    };
    const handleOutsidePointer = (event: PointerEvent | MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-reaction-menu], [data-reaction-trigger]")) return;
      onCloseReactionMenu?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handleOutsidePointer, true);
    window.addEventListener("contextmenu", handleOutsidePointer, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handleOutsidePointer, true);
      window.removeEventListener("contextmenu", handleOutsidePointer, true);
    };
  }, [onCloseReactionMenu, reactionMenuOpen]);

  useEffect(() => {
    if (!reactionsExpanded) return;
    const handleOutsidePointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && reactionsLayerRef.current?.contains(target)) return;
      if (target && reactionOverflowPopoverRef.current?.contains(target)) return;
      setReactionsExpanded(false);
    };

    window.addEventListener("pointerdown", handleOutsidePointer, true);
    return () => window.removeEventListener("pointerdown", handleOutsidePointer, true);
  }, [reactionsExpanded]);

  const updateReactionOverflowPosition = useCallback(() => {
    if (typeof window === "undefined") return;
    const trigger = reactionOverflowTriggerRef.current;
    if (!trigger) return;

    const triggerRect = trigger.getBoundingClientRect();
    const popoverRect = reactionOverflowPopoverRef.current?.getBoundingClientRect();
    const maxWidth = Math.min(320, window.innerWidth - 16);
    const width = Math.min(popoverRect?.width ?? 220, maxWidth);
    const height = popoverRect?.height ?? 44;
    const topBelow = triggerRect.bottom + 6;
    const top = topBelow + height <= window.innerHeight - 8
      ? topBelow
      : Math.max(8, triggerRect.top - height - 6);
    const left = clampNumber(triggerRect.right - width, 8, Math.max(8, window.innerWidth - width - 8));

    setReactionOverflowStyle({
      left,
      top,
      maxWidth,
    });
  }, []);

  const clearReactionOverflowClose = useCallback(() => {
    if (reactionOverflowCloseTimer.current) {
      clearTimeout(reactionOverflowCloseTimer.current);
      reactionOverflowCloseTimer.current = null;
    }
  }, []);

  const openReactionOverflow = useCallback(() => {
    clearReactionOverflowClose();
    setReactionsExpanded(true);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(updateReactionOverflowPosition);
    }
  }, [clearReactionOverflowClose, updateReactionOverflowPosition]);

  const closeReactionOverflowSoon = useCallback(() => {
    clearReactionOverflowClose();
    reactionOverflowCloseTimer.current = setTimeout(() => {
      setReactionsExpanded(false);
      reactionOverflowCloseTimer.current = null;
    }, 120);
  }, [clearReactionOverflowClose]);

  useLayoutEffect(() => {
    if (!reactionsExpanded || typeof window === "undefined") return;
    updateReactionOverflowPosition();
    const handleViewportChange = () => updateReactionOverflowPosition();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [reactionsExpanded, updateReactionOverflowPosition]);

  const reactionGroups = (message.reactions ?? []).reduce<Record<string, { count: number; mine: boolean }>>(
    (acc, r) => {
      if (!acc[r.emoji]) acc[r.emoji] = { count: 0, mine: false };
      acc[r.emoji].count++;
      if (r.user_id === currentUser?.id) acc[r.emoji].mine = true;
      return acc;
    }, {}
  );
  const reactionEntries = Object.entries(reactionGroups);
  const isVeryShortReactionText =
    message.type === "text" &&
    textLayoutKind === "short" &&
    textContent.trim().length <= 4 &&
    reactionEntries.length > 1;
  const visibleReactionLimit = Math.min(isVeryShortReactionText ? 1 : 2, reactionEntries.length);
  const visibleReactionEntries = reactionEntries.slice(0, visibleReactionLimit);
  const overflowReactionEntries = reactionEntries.slice(visibleReactionLimit);
  const hiddenReactionCount = reactionEntries
    .slice(visibleReactionLimit)
    .reduce((total, [, { count }]) => total + count, 0);
  const hasReactions = reactionEntries.length > 0;
  const isLocalSend = message.id.startsWith("tmp:") || Boolean(message.pending || message.checking || message.failed);
  const canReact = !isLocalSend;

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const openContextAt = useCallback((clientX: number, clientY: number) => {
    setContextPos({ x: clientX, y: clientY });
    setShowContext(true);
    onOpenActionMenu?.();
    onCloseReactionMenu?.();
  }, [onCloseReactionMenu, onOpenActionMenu]);

  const handleToggleReactionMenu = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setReactionPos({ x: rect.left + rect.width / 2, y: rect.top });
    closeContext();
    onToggleReactionMenu?.();
  }, [closeContext, onToggleReactionMenu]);

  const openFullReactionCatalog = useCallback((anchor?: { x: number; y: number }) => {
    if (anchor) setReactionPos(anchor);
    setReactionCatalogOpen(true);
    closeContext();
    if (!reactionMenuOpen) onToggleReactionMenu?.();
  }, [closeContext, onToggleReactionMenu, reactionMenuOpen]);

  const openContext = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (isSelectionMode) return;
    openContextAt(e.clientX, e.clientY);
  }, [isSelectionMode, openContextAt]);

  const handleTouchStart = useCallback((event: React.TouchEvent) => {
    if (isSelectionMode) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button,a,input,textarea,select,video,audio,[role='slider']")) return;
    const touch = event.touches[0];
    if (!touch) return;
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    clearLongPressTimer();
    setBodySelectionSuppressed(true);
    longPressTimer.current = setTimeout(() => {
      openContextAt(touch.clientX, touch.clientY);
      longPressTimer.current = null;
    }, 650);
  }, [clearLongPressTimer, isSelectionMode, openContextAt]);
  const handleTouchMove = useCallback((event: React.TouchEvent) => {
    const touch = event.touches[0];
    const start = touchStartRef.current;
    if (!touch || !start) return;
    const moved = Math.hypot(touch.clientX - start.x, touch.clientY - start.y);
    if (moved > 10) {
      clearLongPressTimer();
      setBodySelectionSuppressed(false);
    }
  }, [clearLongPressTimer]);
  const handleTouchEnd = useCallback(() => {
    clearLongPressTimer();
    touchStartRef.current = null;
    if (!contextOpen) setBodySelectionSuppressed(false);
  }, [clearLongPressTimer, contextOpen]);

  const regularContextItems: ContextItem[] = [
    { icon: "reply", label: "Ответить", action: () => { onReply(); closeContext(); } },
    ...(groupReadInfo && onOpenGroupReadReceipts ? [
      { icon: "eye" as KubIconName, label: "Кто прочитал", action: () => { onOpenGroupReadReceipts(); closeContext(); } },
    ] : []),
    { icon: "copy",  label: "Копировать", action: () => { void copyWithFeedback(message.content ?? "", { success: "Сообщение скопировано", error: "Не удалось скопировать сообщение", key: "message" }); closeContext(); } },
    ...(isMe && message.type === "text" && onEdit ? [
      { icon: "edit" as KubIconName, label: "Изменить", action: () => { onEdit(); closeContext(); } },
    ] : []),
    ...(onTogglePin ? [{
      icon: (message.pinned ? "pinOff" : "pin") as KubIconName,
      label: message.pinned ? "Открепить" : "Закрепить",
      action: () => { onTogglePin(); closeContext(); },
    }] : []),
    ...(onForward ? [
      { icon: "forward" as KubIconName, label: "Переслать", action: () => { onForward(); closeContext(); } },
    ] : []),
    ...(onStartSelection ? [
      { icon: "check" as KubIconName, label: "Выбрать сообщения", action: () => {
        setBodySelectionSuppressed(false);
        onCloseReactionMenu?.();
        onStartSelection();
        closeContext();
      } },
    ] : []),
    ...(onHideForMe ? [
      { icon: "delete" as KubIconName, label: "Удалить у себя", danger: true, action: () => {
          void requestAppConfirm({
            title: "Удалить сообщение у себя?",
            description: "Сообщение исчезнет только у вас. У других участников оно останется.",
            confirmLabel: "Удалить у себя",
            tone: "danger",
            icon: "delete",
          }).then((confirmed) => {
            if (confirmed) onHideForMe();
          });
          closeContext();
        } },
    ] : []),
    ...(isMe && onDelete && !isSavedChat ? [
      { icon: "delete" as KubIconName, label: "Удалить для всех", danger: true, action: () => {
          void requestAppConfirm({
            title: "Удалить сообщение для всех?",
            description: "Это действие нельзя отменить. Сообщение будет заменено компактной плашкой удаления.",
            confirmLabel: "Удалить для всех",
            tone: "danger",
            icon: "delete",
          }).then((confirmed) => {
            if (confirmed) onDelete();
          });
          closeContext();
        } },
    ] : []),
  ];
  const localSendContextItems: ContextItem[] = [
    ...(onRetrySend ? [
      { icon: "rotate" as KubIconName, label: "Повторить", action: () => { onRetrySend(); closeContext(); } },
    ] : []),
    ...(message.type === "text" && onEditFailedSend ? [
      { icon: "edit" as KubIconName, label: "Изменить", action: () => { onEditFailedSend(); closeContext(); } },
    ] : []),
    { icon: "copy", label: "Копировать", action: () => { void copyWithFeedback(message.content ?? "", { success: "Сообщение скопировано", error: "Не удалось скопировать сообщение", key: "message" }); closeContext(); } },
    ...(onDiscardLocalMessage ? [
      { icon: "delete" as KubIconName, label: "Удалить", danger: true, action: () => { onDiscardLocalMessage(); closeContext(); } },
    ] : []),
  ];
  const contextItems = isLocalSend ? localSendContextItems : regularContextItems;
  const canUseCompactReplyInline = canRenderCompactReplyInline(message, textLayoutKind, hasReactions);
  const canUseMeasuredTextMeta = message.type === "text" && textLayoutKind !== "preformatted" && !message.failed && !canUseCompactReplyInline;
  const footerMode = hasReactions ? "bottom-layer-reactions" : canUseCompactReplyInline ? "compact-reply-inline" : canUseMeasuredTextMeta ? "measured" : "meta-row";
  const showGroupReadIndicator = Boolean(groupReadInfo && groupReadInfo.readCount > 0);
  const groupReadLabel = groupReadInfo ? getGroupReadReceiptCompactLabel(groupReadInfo) : "";
  const groupReadAriaLabel = groupReadInfo ? getGroupReadReceiptAriaLabel(groupReadInfo) : "";
  const footerMeasureKey = [
    textContent,
    message.edited_at ?? "",
    message.pinned ? "pinned" : "",
    groupReadLabel,
    groupReadAriaLabel,
    compactContextMenu ? "mobile-actions" : "desktop-actions",
  ].join("|");
  const renderFooterContent = () => (
    <>
      {message.pinned && (
        <KubIcon name="pin" size={12} tone="muted" label="Закреплено" className="shrink-0" />
      )}
      {message.edited_at && (
        <span className="max-w-8 shrink truncate text-[12px] text-[color:var(--kub-muted)]" title="изменено">изм.</span>
      )}
      {/* `tabular-nums` already makes HH:MM a fixed width, so an extra minimum
          reserved 16px of dead space in every bubble and pushed the meta onto
          its own line far more often than it needed to. */}
      {/* D-005: the row can carry six things at one flat gap, and the eye lands
          on it straight after the message text. The sizes already form a
          coherent scale — 12px flags, 13px status, 20px actions, one type size
          — so what was missing was grouping, not resizing. A single step of
          extra space here separates the flags that precede it, pin and "изм.",
          from the status cluster of time and delivery, which belong together.
          Nothing is resized, moved or removed. */}
      <span
        className={cn(
          "inline-flex shrink-0 justify-end tabular-nums text-right text-[12px] leading-none text-[color:var(--kub-muted)]",
          (message.pinned || message.edited_at) && "ml-1",
        )}
      >
        {formatFullTime(message.created_at)}
      </span>
      {deliveryState?.isOwnMessage && !showGroupReadIndicator && (
        <span
          data-message-delivery-slot="true"
          className="inline-flex h-[13px] w-[13px] shrink-0 items-center justify-center"
        >
          <KubIcon
            name={deliveryState.icon}
            size={13}
            tone={deliveryState.tone}
            label={deliveryState.label}
          />
        </span>
      )}
      {groupReadInfo && showGroupReadIndicator && (
        <button
          type="button"
          // D-004: this is a button that opens the receipt list, but a bare
          // "3/3" after a timestamp looks like more text. The accessible name
          // was already right, so the information existed for assistive
          // technology and for nobody else. A faint chip and a focus outline
          // make it legible as something to press without adding a word to an
          // already crowded row.
          // The boundary is what makes it a control, and it has to be visible
          // against the surface it actually sits on. This chip only ever
          // appears on an OWN message — `getGroupReadReceiptInfo` returns null
          // for anyone else's — so its background is always the tinted own
          // bubble, `--kub-cyan` 22% over `--kub-surface`. Measured against
          // that, the faint fill alone came to 1.07:1 in dark and 1.11:1 in
          // light: the chip was in the markup and invisible on screen, so the
          // count still read as bare text. The accent border measures 3.78:1
          // and 3.90:1, which clears the 3:1 WCAG asks of a UI boundary. It is
          // the accent already used for this chip's hover and focus, so
          // nothing new is introduced.
          className="inline-flex h-4 items-center gap-0.5 rounded-full border border-[color:var(--kub-cyan)] bg-[var(--kub-surface-3)] px-1 text-[12px] leading-none text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-accent-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
          title={groupReadAriaLabel}
          aria-label={groupReadAriaLabel}
          onClick={(event) => {
            event.stopPropagation();
            onOpenGroupReadReceipts?.();
          }}
        >
          <KubIcon name={groupReadInfo.allRead ? "doubleCheck" : "check"} size={13} tone={groupReadInfo.allRead ? "accent" : "muted"} />
          <span className="tabular-nums">{groupReadLabel}</span>
        </button>
      )}
      <button
        type="button"
        className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-[color:var(--kub-muted)] kub-raise-hover sm:hidden"
        aria-label="Действия сообщения"
        onClick={(event) => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          openContextAt(rect.left, rect.bottom + 4);
        }}
      >
        <KubIcon name="more" size={13} />
      </button>
    </>
  );
  const renderReactionChip = ([emoji, { count, mine }]: [string, { count: number; mine: boolean }], keyPrefix = "reaction") => (
    <button
      key={`${keyPrefix}-${emoji}`}
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onReaction(emoji);
      }}
      className={cn(
        "inline-flex h-[22px] items-center gap-1 rounded-full border px-2 text-[12px] leading-none transition-all hover:scale-105 active:scale-95",
        mine
          ? "bg-[color-mix(in_srgb,var(--kub-cyan)_14%,transparent)] border-[color-mix(in_srgb,var(--kub-cyan)_72%,transparent)] text-[color:var(--kub-accent-text)]"
          : "bg-[color-mix(in_srgb,var(--kub-surface-2)_72%,transparent)] border-[color-mix(in_srgb,var(--kub-border-color)_72%,transparent)] text-[color:var(--kub-muted)]"
      )}
    >
      <span className="text-sm leading-none">{emoji}</span>
      {count > 1 && <span className="tabular-nums">{count}</span>}
    </button>
  );

  const renderReactionsRow = (mode: "standalone" | "bottom-layer" = "standalone") => {
    if (!hasReactions) return null;
    return (
      <div
        ref={reactionsLayerRef}
        data-message-reactions-row="true"
        data-message-reactions-expanded={reactionsExpanded ? "true" : "false"}
        className={cn(
          "relative flex max-w-full flex-wrap items-center justify-start gap-1",
          mode === "standalone" ? "mt-1 w-fit self-start" : "min-w-0 flex-1"
        )}
      >
        {visibleReactionEntries.map((entry) => renderReactionChip(entry))}
        {hiddenReactionCount > 0 && (
          <button
            ref={reactionOverflowTriggerRef}
            type="button"
            className="inline-flex h-[22px] items-center rounded-full border border-[color-mix(in_srgb,var(--kub-border-color)_72%,transparent)] bg-[color-mix(in_srgb,var(--kub-surface-2)_72%,transparent)] px-2 text-[12px] leading-none text-[color:var(--kub-muted)]"
            title={`Ещё ${hiddenReactionCount} реакций`}
            aria-label={`Ещё ${hiddenReactionCount} реакций`}
            aria-expanded={reactionsExpanded}
            onMouseEnter={openReactionOverflow}
            onMouseLeave={closeReactionOverflowSoon}
            onFocus={openReactionOverflow}
            onBlur={closeReactionOverflowSoon}
            onClick={(event) => {
              event.stopPropagation();
              if (reactionsExpanded) {
                setReactionsExpanded(false);
              } else {
                openReactionOverflow();
              }
            }}
          >
            +{hiddenReactionCount}
          </button>
        )}
      </div>
    );
  };

  const renderReactionsBottomLayer = () => {
    if (!hasReactions) return null;
    return (
      <div
        data-message-bottom-layer="reactions"
        className="mt-1 flex max-w-full items-end gap-2 self-stretch leading-none"
      >
        {renderReactionsRow("bottom-layer")}
        <div
          data-message-footer="true"
          className="ml-auto inline-flex w-fit max-w-full shrink-0 items-center justify-end gap-1 whitespace-nowrap text-right leading-none"
        >
          {renderFooterContent()}
        </div>
      </div>
    );
  };

  const bubbleClass = isMe
    ? "bg-[color-mix(in_srgb,var(--kub-cyan)_22%,var(--kub-surface))] border border-[color:var(--kub-cyan)]/40 text-[color:var(--kub-text)]"
    : "bg-[var(--kub-message-in)] border border-[color:var(--kub-border-color)] text-[color:var(--kub-text)]";

  // Soft-delete: render an inert placeholder bubble in the same slot so the
  // surrounding date separators / scroll position stay stable.  No reply
  // tail, no context menu, no reactions — it's a stub, not a message.
  // Placed AFTER all hooks to keep the Rules of Hooks happy.
  if (message.deleted_at) {
    return (
      <div className={cn("flex gap-1.5 mb-0.5", isMe ? "justify-end" : "justify-start")}>
        {!isMe && <div className="flex-shrink-0 self-end mb-1 w-8" />}
        <div className={cn("flex max-w-[78%] sm:max-w-[72%] md:max-w-[65%]", isMe ? "items-end" : "items-start")}>
          <div
            data-message-bubble="true"
            className={cn(
              "flex items-center gap-1.5 rounded-2xl px-2.5 py-1.5 text-xs italic leading-none select-none",
              "bg-[var(--kub-surface-2)]/80 border border-dashed border-[color:var(--kub-border-color)] text-[color:var(--kub-muted)]",
              isMe ? "rounded-br-sm" : "rounded-bl-sm",
            )}
          >
            <KubIcon name="delete" size={12} tone="muted" className="shrink-0" />
            <span>Сообщение удалено</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {contextOpen && (
        <div className="fixed inset-0 z-50" onClick={closeContext}>
          <div
            data-action-menu="true"
            className="absolute z-50 min-w-60 overflow-y-auto rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] py-1 kub-glow-soft"
            style={contextMenuStyle}
            onClick={(e) => e.stopPropagation()}
          >
            {canReact && (
              <div className="mb-1 flex items-center justify-between gap-1 border-b border-[color:var(--kub-rule)] px-2 pb-2 pt-2">
                {EMOJI_QUICK.slice(0, 6).map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => { onReaction(emoji); closeContext(); }}
                    className={cn(
                      "kub-interactive flex min-w-0 flex-1 items-center justify-center rounded-full transition-colors kub-raise-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]",
                      compactContextMenu ? "h-11 text-2xl" : "h-10 text-xl",
                    )}
                    aria-label={`Поставить реакцию ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    openFullReactionCatalog({ x: rect.left + rect.width / 2, y: rect.top });
                  }}
                  className={cn(
                    "kub-interactive flex min-w-0 flex-1 items-center justify-center rounded-full text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]",
                    compactContextMenu ? "h-11" : "h-10",
                  )}
                  aria-label="Больше реакций"
                  title="Больше реакций"
                >
                  {/* A plus, not the vertical ellipsis this used to show. That
                      glyph already means "more actions" on the button beside
                      every message, so using it here said the wrong thing about
                      what the control opens. */}
                  <KubIcon name="create" size={15} />
                </button>
              </div>
            )}
            {contextItems.map(({ icon, label, danger, action }) => (
              <button
                key={label}
                onClick={action}
                className={cn(
                  "flex w-full items-center gap-3 whitespace-nowrap px-4 py-2.5 text-left text-sm transition-colors kub-raise-hover",
                  danger ? "text-[color:var(--kub-danger-text)]" : "text-[color:var(--kub-text)]"
                )}
              >
                <KubIcon name={icon} size={16} tone={danger ? "currentColor" : "muted"} />
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {canReact && reactionMenuOpen && (!compactContextMenu || reactionCatalogOpen) && (
        <div
          data-reaction-menu="true"
          className={cn(
            "fixed z-[55] max-w-[calc(100vw-16px)] border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] kub-glow-soft",
            reactionCatalogOpen
              ? "overflow-hidden rounded-xl p-2"
              : "flex items-center justify-center gap-0.5 rounded-full px-2 py-1.5",
          )}
          style={reactionPickerStyle}
          onClick={(e) => e.stopPropagation()}
        >
          {reactionCatalogOpen ? (
            <EmojiCategoryPicker
              categories={MESSAGE_EMOJI_CATEGORIES}
              searchTerms={MESSAGE_EMOJI_SEARCH_TERMS}
              onSelect={(value) => {
                if (!value) return;
                onReaction(value);
                onCloseReactionMenu?.();
              }}
              testIdPrefix="reaction-emoji"
              searchable
              scrollable
              compact
            />
          ) : (
            <>
              {EMOJI_QUICK.slice(0, 6).map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => { onReaction(emoji); onCloseReactionMenu?.(); }}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-lg transition-all hover:scale-125 kub-raise-hover"
                  aria-label={`Поставить реакцию ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setReactionCatalogOpen(true)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-text)]"
                aria-label="Больше реакций"
                title="Больше реакций"
              >
                <KubIcon name="more" size={16} />
              </button>
            </>
          )}
        </div>
      )}

      {hiddenReactionCount > 0 && reactionsExpanded && typeof document !== "undefined" && createPortal(
        <div
          ref={reactionOverflowPopoverRef}
          data-message-reactions-overflow="true"
          className="fixed z-[45] flex w-max flex-wrap items-center gap-1 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] p-1.5 kub-glow-soft"
          style={reactionOverflowStyle}
          onMouseEnter={clearReactionOverflowClose}
          onMouseLeave={closeReactionOverflowSoon}
          onFocus={openReactionOverflow}
          onBlur={closeReactionOverflowSoon}
          onClick={(event) => event.stopPropagation()}
        >
          {overflowReactionEntries.map((entry) => renderReactionChip(entry, "overflow-reaction"))}
        </div>,
        document.body
      )}

      <div
        className={cn(
          "flex gap-1.5 mb-0.5 group relative",
          isEntering && !entranceSettled && "msg-appear",
          "max-w-full min-w-0",
          isMe ? "justify-end" : "justify-start",
        )}
        onAnimationEnd={(event) => {
          // Named, because the subtree runs other animations — a spinner, a
          // recording bar — and any of them would otherwise clear the flag
          // before the entrance had played.
          if (event.animationName !== "msg-appear") return;
          if (event.target !== event.currentTarget) return;
          setEntranceSettled(true);
        }}
        onContextMenu={openContext}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {!isMe && (
          <div className="flex-shrink-0 self-end mb-1 w-8">
            {isLastInGroup && actor.kind !== "system" && (
              <MessageActorAvatar actor={actor} size="sm" avatarVariant={senderAvatarVariant} />
            )}
          </div>
        )}

        <div
          ref={stackRef}
          className={cn("inline-flex min-w-0 max-w-full flex-col", widthClasses.stack, isMe ? "items-end" : "items-start")}
          style={stackStyle}
        >

          {!isMe && isFirstInGroup && actor.kind !== "system" && (
            <span className="ml-3 mb-0.5 inline-flex min-w-0 items-center gap-1.5 text-xs font-semibold text-[color:var(--kub-accent-text)]">
              <span className="truncate">{actorName}</span>
              {actor.kind === "bot" && (
                <span className="rounded-sm bg-[color-mix(in_srgb,var(--kub-cyan)_14%,transparent)] px-1 py-px text-[9px] font-semibold uppercase text-[color:var(--kub-accent-text)]">
                  Бот
                </span>
              )}
            </span>
          )}

          <div
            ref={bubbleRef}
            data-message-bubble="true"
            data-message-layout-kind={textLayoutKind}
            data-message-footer-mode={footerMode}
            className={cn(
              "relative flex flex-col max-w-full px-3 pt-2 rounded-2xl transition-opacity select-none sm:select-text",
              hasReactions ? "pb-2" : "pb-1",
              widthClasses.bubble,
              bubbleClass,
              isMe ? "rounded-br-sm" : "rounded-bl-sm",
              // The last bubble of a group squares its corner on the sender's
              // side. This replaces the old triangular tail, which was drawn
              // outside the bubble and overlapped the avatar.
              isMe && isLastInGroup ? "rounded-br-none" : "",
              !isMe && isLastInGroup ? "rounded-bl-none" : "",
              message.pending && "opacity-70",
              message.failed && "opacity-60",
              selected && "ring-2 ring-[color:var(--kub-cyan)]/55 bg-[color-mix(in_srgb,var(--kub-cyan)_10%,var(--kub-message-in))]",
              isSelectionMode && "cursor-pointer [&_a]:pointer-events-none [&_audio]:pointer-events-none [&_button]:pointer-events-none [&_input]:pointer-events-none [&_video]:pointer-events-none",
            )}
          >
            <div
              className={cn(
                // Anchored to the bubble's edge rather than offset by a guessed
                // number. `-right-20` put the group's right edge 80px past the
                // bubble while the group itself is about 92px wide, so it
                // actually overlapped the message by roughly 12px — the "icons
                // pressed against the message" in the report.
                "absolute top-1/2 z-10 hidden -translate-y-1/2 items-center gap-0.5 rounded-full border border-[color:var(--kub-border-color)]",
                "bg-[var(--kub-surface-2)] p-0.5 opacity-0 shadow-sm transition-opacity sm:flex",
                "group-hover:opacity-100 focus-within:opacity-100",
                isMe ? "right-full mr-2" : "left-full ml-2",
              )}
            >
              {canReact && (
                <button
                  onClick={handleToggleReactionMenu}
                  data-reaction-trigger="true"
                  aria-label="Реакция"
                  className="kub-interactive flex h-7 w-7 items-center justify-center rounded-full text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]"
                >
                  <KubIcon name="smile" size={14} />
                </button>
              )}
              <button
                onClick={onReply}
                aria-label="Ответить"
                className="kub-interactive flex h-7 w-7 items-center justify-center rounded-full text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]"
              >
                <KubIcon name="reply" size={14} />
              </button>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  openContextAt(rect.left, rect.bottom + 4);
                }}
                aria-label="Действия сообщения"
                className="kub-interactive flex h-7 w-7 items-center justify-center rounded-full text-[color:var(--kub-muted)] transition-colors kub-raise-hover hover:text-[color:var(--kub-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)] active:bg-[image:linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil)),linear-gradient(var(--kub-sink-veil),var(--kub-sink-veil))]"
              >
                <KubIcon name="more" size={14} />
              </button>
            </div>

            {message.reply_to_id && (() => {
              const replyMsg = messagesMap[message.reply_to_id] ?? message.reply_to ?? null;
              const replyName = replyMsg && !replyMsg.deleted_at
                ? resolveMessageActor(replyMsg).kind === "user" && replyMsg.user_id === currentUser?.id
                  ? "Вы"
                  : messageActorDisplayName(resolveMessageActor(replyMsg))
                : "Ответ";
              const compactPreview = canUseCompactReplyInline;
              const compactPreviewCap = compactPreview
                ? getCompactReplyPreviewCap(message.content ?? "")
                : null;
              const preview = clampReplyPreviewText(formatReplyMessagePreview(replyMsg), compactPreviewCap?.chars ?? 28);
              const replyNameLabel = clampReplyPreviewText(replyName, compactPreview ? 18 : 24);
              return (
                <button
                  type="button"
                  data-message-reply-preview="true"
                  onClick={(event) => {
                    event.stopPropagation();
                    onJumpToReply?.(message.reply_to_id!);
                  }}
                  className="mb-1.5 flex w-fit min-w-0 items-stretch gap-2 overflow-hidden rounded-xl bg-[color-mix(in_srgb,var(--kub-surface-2)_55%,transparent)] px-2 py-1.5 text-left text-xs transition-colors hover:bg-[color-mix(in_srgb,var(--kub-surface-3)_72%,transparent)]"
                  style={{ maxWidth: compactPreviewCap?.maxWidth ?? "min(100%, 170px, 22ch)" }}
                  aria-label="Перейти к исходному сообщению"
                >
                  <span className="w-0.5 flex-shrink-0 self-stretch rounded-full bg-[var(--kub-cyan)]" />
                  <span className="min-w-0 flex-1 overflow-hidden">
                    <span className="block truncate font-semibold leading-tight text-[color:var(--kub-accent-text)]">
                      {replyNameLabel}
                    </span>
                    <span
                      className="block overflow-hidden truncate whitespace-nowrap leading-tight text-[color:var(--kub-muted)]"
                      style={{
                        textOverflow: "ellipsis",
                      }}
                    >
                      {preview}
                    </span>
                  </span>
                </button>
              );
            })()}

            {isVoiceMessage(message) ? (
              <AudioMessage
                url={message.media_url}
                duration={parseAudioDuration(message.content)}
                isMe={isMe}
                playbackItem={createPlaybackItemFromMessage(message, isMe)}
              />
            ) : message.type === "image" && message.media_url ? (
              <MediaWithCaption caption={mediaCaption}>
                <MediaImage
                  url={imageDisplayUrl ?? message.media_url}
                  originalUrl={message.media_url}
                  thumbUrl={mediaVariant?.thumbUrl}
                  thumbWidth={mediaVariant?.thumbWidth ?? null}
                  mainWidth={imageDisplayWidth}
                  title={message.content ?? "Фото"}
                  dimensions={imageDimensions}
                  onOpen={() => onOpenMedia?.({ type: "image", url: message.media_url!, title: message.content ?? "Фото" })}
                />
              </MediaWithCaption>
            ) : message.type === "video" && message.media_url ? (
              isRoundVideoMessage(message) ? (
                <RoundVideoMessage
                  url={videoPlaybackUrl ?? message.media_url}
                  originalUrl={message.media_url}
                  title={message.content ?? "Видео-сообщение"}
                  posterUrl={videoPosterUrl}
                  durationLabel={parseVideoMessageDuration(message.content, message)}
                  playbackItem={createPlaybackItemFromMessage(message, isMe, videoPlaybackUrl ?? message.media_url)}
                  onOpen={() => onOpenMedia?.({ type: "video", url: message.media_url!, title: message.content ?? "Видео-сообщение" })}
                />
              ) : (
                <MediaWithCaption caption={mediaCaption}>
                  <MediaVideo
                    url={videoPlaybackUrl ?? message.media_url}
                    originalUrl={message.media_url}
                    title={message.content ?? "Видео"}
                    posterUrl={videoPosterUrl}
                    dimensions={mediaDimensions}
                    playbackItem={createPlaybackItemFromMessage(message, isMe, videoPlaybackUrl ?? message.media_url)}
                    onOpen={() => onOpenMedia?.({ type: "video", url: message.media_url!, title: message.content ?? "Видео" })}
                  />
                </MediaWithCaption>
              )
            ) : message.type === "file" && message.media_url ? (
              <a
                href={message.media_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-sm hover:opacity-80 transition-opacity text-[color:var(--kub-accent-text)]"
              >
                <KubIcon name="file" size={16} />
                <span className="truncate max-w-[200px]">{message.content ?? "File"}</span>
              </a>
            ) : canUseCompactReplyInline ? (
              <div
                data-message-text-flow="true"
                data-message-meta-placement="inline"
                className={cn(
                  "flex w-full max-w-full min-w-0 items-baseline gap-2 text-sm leading-relaxed whitespace-pre-wrap text-[color:var(--kub-text)]",
                  widthClasses.text
                )}
              >
                <span className="min-w-0 flex-1">
                  <FormattedText content={message.content ?? ""} />
                </span>
                <span
                  data-message-footer="true"
                  className="ml-auto inline-flex w-fit max-w-full shrink-0 items-center justify-end gap-1 whitespace-nowrap text-right leading-none [vertical-align:-0.12em]"
                >
                  {renderFooterContent()}
                </span>
              </div>
            ) : canUseMeasuredTextMeta ? (
              <MeasuredTextWithMeta
                content={message.content ?? ""}
                textClassName={cn(
                  "min-w-0 max-w-full text-sm leading-relaxed whitespace-pre-wrap text-[color:var(--kub-text)]",
                  widthClasses.text
                )}
                meta={hasReactions ? null : renderFooterContent()}
                bubbleRef={bubbleRef}
                stackRef={stackRef}
                measureKey={footerMeasureKey}
                compound={Boolean(message.reply_to_id)}
              />
            ) : (
              <p
                data-message-text-flow="true"
                className={cn(
                  "min-w-0 max-w-full text-sm leading-relaxed whitespace-pre-wrap text-[color:var(--kub-text)]",
                  widthClasses.text
                )}
              >
                <FormattedText content={message.content ?? ""} />
              </p>
            )}

            {message.failed && isMe && (
              <div
                data-message-send-error="true"
                className="mt-1 flex max-w-full flex-wrap items-center gap-1.5 border-t border-[color:var(--kub-rule)] pt-1 text-[12px] leading-none text-[color:var(--kub-danger-text)]"
              >
                <span className="mr-auto min-w-0">
                  {message.send_error ?? "Не удалось отправить"}
                </span>
                {onRetrySend && (
                  <button
                    type="button"
                    className="inline-flex h-6 items-center rounded-full px-2 font-semibold text-[color:var(--kub-accent-text)] hover:bg-[color-mix(in_srgb,var(--kub-cyan)_12%,transparent)]"
                    onClick={(event) => { event.stopPropagation(); onRetrySend(); }}
                  >
                    Повторить
                  </button>
                )}
                {message.type === "text" && onEditFailedSend && (
                  <button
                    type="button"
                    className="inline-flex h-6 items-center rounded-full px-2 font-semibold text-[color:var(--kub-muted)] kub-raise-hover"
                    onClick={(event) => { event.stopPropagation(); onEditFailedSend(); }}
                  >
                    Изменить
                  </button>
                )}
                {onDiscardLocalMessage && (
                  <button
                    type="button"
                    className="inline-flex h-6 items-center rounded-full px-2 font-semibold text-[color:var(--kub-danger-text)] hover:bg-[color-mix(in_srgb,var(--kub-danger)_12%,transparent)]"
                    onClick={(event) => { event.stopPropagation(); onDiscardLocalMessage(); }}
                  >
                    Удалить
                  </button>
                )}
              </div>
            )}

            {!canUseMeasuredTextMeta && !canUseCompactReplyInline && !hasReactions && (
              <div
                data-message-bottom-meta="true"
                className="mt-0.5 flex self-stretch max-w-full items-center justify-end leading-none"
              >
                <div
                  data-message-footer="true"
                  className="inline-flex w-fit max-w-full shrink-0 items-center justify-end gap-1 whitespace-nowrap text-right leading-none"
                >
                  {renderFooterContent()}
                </div>
              </div>
            )}

            {hasReactions ? renderReactionsBottomLayer() : renderReactionsRow()}
          </div>

        </div>
      </div>
    </>
  );
}

function setBodySelectionSuppressed(suppressed: boolean) {
  if (typeof document === "undefined") return;
  document.body.style.userSelect = suppressed ? "none" : "";
  document.body.style.webkitUserSelect = suppressed ? "none" : "";
  document.documentElement.classList.toggle("kub-selection-suppressed", suppressed);
  if (suppressed) window.getSelection()?.removeAllRanges();
}

interface MediaDimensions {
  width: number;
  height: number;
}

/**
 * A picture in a bubble, with the same two recoveries the video bubbles have.
 *
 * A bubble paints before its variants are known, so its first `src` is the
 * original and `url` changes to the preview a moment later. Without the reset
 * below, one failed request — a blip, a dropped connection, an aborted load —
 * latched `failed` forever: the preview that arrived next was never rendered,
 * because the error box had replaced the `<img>` that would have loaded it.
 * Measured against production: aborting a single message image left the bubble
 * reading "Не удалось загрузить изображение" 28 seconds later in the same chat,
 * and only a reload cleared it. That is the "медиа не грузится, F5 помогает"
 * report.
 *
 * The second recovery is the fallback: a variant that fails hands the bubble
 * back to the original rather than giving up, which is what `MediaVideo` and
 * `RoundVideoMessage` already do.
 */
function MediaImage({
  url,
  originalUrl,
  thumbUrl,
  thumbWidth,
  mainWidth,
  title,
  dimensions,
  onOpen,
}: {
  url: string;
  originalUrl: string;
  thumbUrl?: string;
  thumbWidth?: number | null;
  mainWidth?: number | null;
  title: string;
  dimensions: MediaDimensions | null;
  onOpen: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const [usingOriginal, setUsingOriginal] = useState(false);
  const aspectStyle = getMediaAspectStyle(dimensions);
  const hasReservedAspect = Boolean(aspectStyle);
  const activeUrl = usingOriginal ? originalUrl : url;

  /**
   * Two candidates, each declared at the width it actually is.
   *
   * The descriptors used to be written `${thumbUrl} 360w, ${url} 1280w`, and
   * neither number came from anywhere: both were invented and neither variant
   * is normally either size. A thumb measured 154px wide while claiming 360w,
   * so on a 390px phone — where `sizes` asks for 86vw, about 335px — the
   * browser believed the thumb was enough detail and drew a 154px image into a
   * 335px box. The reverse costs bytes: an over-declared preview is skipped in
   * favour of a full-size original nobody needed.
   *
   * The real widths were already being carried from the database rows all
   * along, in `thumbWidth` and `previewWidth`; they simply never reached this
   * element. Both arrive as props rather than being re-derived here, because
   * the width has to come from the same row as the address it describes — see
   * `imageDisplayWidth` at the call site for what happens when it does not.
   *
   * If either width is unknown, the set is dropped rather than guessed. `src`
   * alone is correct — it is only the resolution hint that is missing — and a
   * wrong descriptor is worse than no descriptor, because the browser trusts
   * it absolutely and has no way to find out otherwise.
   */
  const srcSet = !usingOriginal && thumbUrl && thumbWidth && mainWidth && thumbWidth < mainWidth
    ? `${thumbUrl} ${thumbWidth}w, ${url} ${mainWidth}w`
    : undefined;

  useEffect(() => {
    setFailed(false);
    setUsingOriginal(false);
  }, [originalUrl, url]);

  const handleError = () => {
    if (activeUrl !== originalUrl) {
      setUsingOriginal(true);
      return;
    }
    setFailed(true);
  };

  if (failed) {
    return (
      <div className="flex max-w-[260px] items-center gap-2 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2 text-xs text-[color:var(--kub-muted)]">
        <KubIcon name="warning" size={16} />
        <span className="min-w-0 flex-1">Не удалось загрузить изображение.</span>
        <a href={originalUrl} target="_blank" rel="noreferrer" className="text-[color:var(--kub-accent-text)] hover:underline">
          Открыть
        </a>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group block max-h-[340px] w-[min(360px,calc(100vw-7.5rem))] max-w-full overflow-hidden rounded-xl text-left sm:max-h-[380px] sm:w-[min(420px,70vw)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]"
      style={aspectStyle}
      aria-label="Открыть фото"
    >
      <img
        src={activeUrl}
        srcSet={srcSet}
        sizes={srcSet ? "(max-width: 640px) 86vw, 420px" : undefined}
        alt={title || "Фото"}
        loading="lazy"
        decoding="async"
        className={cn(
          "w-full object-cover transition-transform duration-200 group-hover:scale-[1.01]",
          hasReservedAspect ? "h-full" : "max-h-[340px] sm:max-h-[380px]"
        )}
        onError={handleError}
      />
    </button>
  );
}

function MediaWithCaption({ children, caption }: { children: ReactNode; caption: string | null }) {
  return (
    <div className="flex max-w-full flex-col gap-1.5">
      {children}
      {caption && (
        <p className="min-w-0 max-w-full whitespace-pre-wrap text-sm leading-relaxed text-[color:var(--kub-text)]">
          <FormattedText content={caption} />
        </p>
      )}
    </div>
  );
}

function MediaVideo({
  url,
  originalUrl,
  title,
  posterUrl,
  dimensions,
  playbackItem,
  onOpen,
}: {
  url: string;
  originalUrl: string;
  title: string;
  posterUrl?: string;
  dimensions: MediaDimensions | null;
  playbackItem: ChatMediaPlaybackItem | null;
  onOpen: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [usingOriginal, setUsingOriginal] = useState(false);
  const mediaPlayback = useChatMediaPlayback();
  const replaceCurrentItemUrl = mediaPlayback.replaceCurrentItemUrl;
  const aspectStyle = getMediaAspectStyle(dimensions, 16 / 9);
  const activeUrl = usingOriginal ? originalUrl : url;
  const activePlaybackItem = useMemo(
    () => playbackItem && { ...playbackItem, url: activeUrl },
    [activeUrl, playbackItem],
  );

  useEffect(() => {
    setFailed(false);
    setUsingOriginal(false);
  }, [originalUrl, url]);

  useEffect(() => {
    if (activePlaybackItem) replaceCurrentItemUrl(activePlaybackItem.id, activePlaybackItem.url);
  }, [activePlaybackItem?.id, activePlaybackItem?.url, replaceCurrentItemUrl]);

  const handleError = () => {
    const fallbackUrl = getVideoPlaybackFallbackUrl(activeUrl, originalUrl);
    if (fallbackUrl) {
      if (activePlaybackItem) {
        replaceCurrentItemUrl(activePlaybackItem.id, fallbackUrl, { suppressCurrentError: true });
      }
      setUsingOriginal(true);
      return;
    }
    setFailed(true);
  };

  if (failed) {
    return (
      <div className="flex max-w-[280px] items-center gap-2 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2 text-xs text-[color:var(--kub-muted)]">
        <KubIcon name="warning" size={16} />
        <span className="min-w-0 flex-1">Не удалось загрузить видео.</span>
        <a href={originalUrl} target="_blank" rel="noreferrer" className="text-[color:var(--kub-accent-text)] hover:underline">
          Открыть
        </a>
      </div>
    );
  }

  return (
    <div
      className="relative max-h-[320px] w-[min(360px,calc(100vw-7.5rem))] max-w-full overflow-hidden rounded-xl bg-black sm:w-[min(420px,70vw)]"
      style={aspectStyle}
    >
      <video
        ref={videoRef}
        src={activeUrl}
        poster={posterUrl}
        preload="metadata"
        controls
        playsInline
        className="block h-full max-h-[320px] w-full bg-black object-contain"
        onPlay={(event) => {
          if (activePlaybackItem) mediaPlayback.activate(activePlaybackItem, event.currentTarget);
        }}
        onError={handleError}
      />
      <button
        type="button"
        onClick={onOpen}
        className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-lg bg-black/65 px-2.5 py-1.5 text-xs text-white backdrop-blur transition-colors hover:bg-black/80"
        aria-label="Открыть видео в просмотрщике"
      >
        <KubIcon name="externalLink" size={14} />
        <span className="hidden sm:inline">Открыть</span>
      </button>
    </div>
  );
}

function RoundVideoMessage({
  url,
  originalUrl,
  title,
  posterUrl,
  durationLabel,
  playbackItem,
  onOpen,
}: {
  url: string;
  originalUrl: string;
  title: string;
  posterUrl?: string;
  durationLabel: string | null;
  playbackItem: ChatMediaPlaybackItem | null;
  onOpen: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const [usingOriginal, setUsingOriginal] = useState(false);
  const mediaPlayback = useChatMediaPlayback();
  const activateMediaPlayback = mediaPlayback.activate;
  const replaceCurrentItemUrl = mediaPlayback.replaceCurrentItemUrl;
  const activeUrl = usingOriginal ? originalUrl : url;
  const activePlaybackItem = useMemo(
    () => playbackItem && { ...playbackItem, url: activeUrl },
    [activeUrl, playbackItem],
  );

  useEffect(() => {
    setFailed(false);
    setUsingOriginal(false);
  }, [originalUrl, url]);

  useEffect(() => {
    if (activePlaybackItem) replaceCurrentItemUrl(activePlaybackItem.id, activePlaybackItem.url);
  }, [activePlaybackItem?.id, activePlaybackItem?.url, replaceCurrentItemUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : getMediaMetadataNumberFromItem(activePlaybackItem) / 1000;
      setProgress(duration > 0 ? Math.min(1, Math.max(0, video.currentTime / duration)) : 0);
    };
    const onPlay = () => {
      setPlaying(true);
      if (activePlaybackItem) activateMediaPlayback(activePlaybackItem, video);
      sync();
    };
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setProgress(0);
    };
    video.addEventListener("timeupdate", sync);
    video.addEventListener("loadedmetadata", sync);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    return () => {
      video.removeEventListener("timeupdate", sync);
      video.removeEventListener("loadedmetadata", sync);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
    };
  }, [activateMediaPlayback, activePlaybackItem, activeUrl]);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video || failed) return;
    if (activePlaybackItem) {
      mediaPlayback.toggle(activePlaybackItem, video);
      return;
    }
    if (video.paused) void video.play().catch(() => setPlaying(false));
    else video.pause();
  };
  const activeProgress = activePlaybackItem && mediaPlayback.isCurrent(activePlaybackItem.id) ? mediaPlayback.progress : progress;
  const isActivePlaying = activePlaybackItem && mediaPlayback.isCurrent(activePlaybackItem.id) ? mediaPlayback.isPlaying : playing;
  const isActiveMedia = Boolean(activePlaybackItem && mediaPlayback.isCurrent(activePlaybackItem.id));

  const handleError = () => {
    const fallbackUrl = getVideoPlaybackFallbackUrl(activeUrl, originalUrl);
    if (fallbackUrl) {
      if (activePlaybackItem) {
        replaceCurrentItemUrl(activePlaybackItem.id, fallbackUrl, { suppressCurrentError: true });
      }
      setUsingOriginal(true);
      return;
    }
    setFailed(true);
  };

  if (failed) {
    return (
      <div className="flex max-w-[240px] items-center gap-2 rounded-xl border border-[color:var(--kub-border-color)] bg-[var(--kub-surface-2)] px-3 py-2 text-xs text-[color:var(--kub-muted)]">
        <KubIcon name="warning" size={16} />
        <span className="min-w-0 flex-1">Не удалось загрузить видео.</span>
        <button type="button" onClick={onOpen} className="text-[color:var(--kub-accent-text)] hover:underline">
          Открыть
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="sent-video-message-circle"
      data-active-media={isActiveMedia ? "true" : "false"}
      className={cn(
        "relative h-48 w-48 max-w-full sm:h-52 sm:w-52",
        isActiveMedia && "drop-shadow-[0_0_18px_color-mix(in_srgb,var(--kub-cyan)_28%,transparent)]"
      )}
    >
      <VideoCircleProgressRing
        progress={activeProgress}
        testId="video-message-progress-ring"
        className={cn(isActiveMedia ? "opacity-100" : "opacity-80")}
      />
      <button
        type="button"
        onClick={togglePlayback}
        className={cn(
          "group relative z-10 block h-full w-full overflow-hidden rounded-full bg-black shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--kub-cyan)]",
          isActiveMedia && "ring-2 ring-[color:var(--kub-cyan)]"
        )}
        aria-label={isActivePlaying ? "Пауза видео-сообщения" : "Воспроизвести видео-сообщение"}
      >
        <video
          ref={videoRef}
          src={activeUrl}
          poster={posterUrl}
          preload="metadata"
          playsInline
          className="h-full w-full object-cover"
          onError={handleError}
        />
        {!isActivePlaying && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/20 text-white transition-colors group-hover:bg-black/30">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/55 backdrop-blur">
              <KubIcon name="play" size={19} />
            </span>
          </span>
        )}
        {durationLabel && (
          <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/65 px-2.5 py-1 text-[12px] font-semibold tabular-nums text-white backdrop-blur">
            {durationLabel}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="absolute right-1 top-1 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur transition-colors hover:bg-black/80"
        aria-label="Открыть видео в просмотрщике"
      >
        <KubIcon name="externalLink" size={14} />
      </button>
    </div>
  );
}

function parseAudioDuration(content: string | null | undefined): number {
  const match = content?.match(/(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return 0;
  return minutes * 60 + seconds;
}

function parseVideoMessageDuration(content: string | null | undefined, message?: MessageWithSender): string | null {
  const durationMs = getMediaMetadataNumber(message, "duration_ms");
  if (durationMs && durationMs > 0) return formatMetadataDuration(durationMs);
  return content?.match(/(\d{1,2}:\d{2})/)?.[1] ?? null;
}

function createPlaybackItemFromMessage(
  message: MessageWithSender,
  isMe: boolean,
  mediaUrl: string | null | undefined = message.media_url,
): ChatMediaPlaybackItem | null {
  if (!mediaUrl || message.deleted_at) return null;
  if (message.type !== "audio" && message.type !== "video") return null;
  const kind: ChatMediaPlaybackItem["kind"] = message.type === "video"
    ? isRoundVideoMessage(message)
      ? "video_message"
      : "video"
    : isVoiceMessage(message)
      ? "voice"
      : "audio";
  const durationMs = getMediaMetadataNumber(message, "duration_ms") ?? durationStringToMs(message.content);
  return {
    id: message.id,
    chatId: message.chat_id,
    kind,
    url: mediaUrl,
    title: kind === "video_message"
      ? "Видеосообщение"
      : kind === "voice"
        ? "Голосовое сообщение"
        : kind === "audio"
          ? "Аудио"
          : "Видео",
    subtitle: isMe ? "Вы" : messageActorDisplayName(resolveMessageActor(message)),
    durationMs,
  };
}

function durationStringToMs(content: string | null | undefined): number | null {
  const match = content?.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
  return (minutes * 60 + seconds) * 1000;
}

function getMediaMetadataNumberFromItem(item: ChatMediaPlaybackItem | null): number {
  return item?.durationMs && item.durationMs > 0 ? item.durationMs : 0;
}

function isRoundVideoMessage(message: MessageWithSender): boolean {
  return message.type === "video" && (
    getMediaMetadataString(message, "kind") === "video_message" ||
    getMediaMetadataString(message, "shape") === "round" ||
    /^Видео-сообщение(?:\s|\(|$)/i.test(message.content?.trim() ?? "")
  );
}

function isVoiceMessage(message: MessageWithSender): boolean {
  if (message.type === "audio") return true;
  if (message.type === "video") return false;
  const mediaUrl = message.media_url?.toLowerCase() ?? "";
  if (/\.(webm|ogg|oga|mp3|wav|m4a|aac)(\?|#|$)/.test(mediaUrl)) return true;
  const content = message.content?.toLowerCase() ?? "";
  return content.includes("голосовое") || content.includes("voice");
}

function getVisibleMediaCaption(message: MessageWithSender): string | null {
  if (message.type !== "image" && message.type !== "video") return null;
  const content = message.content?.trim();
  if (!content) return null;
  if (isRoundVideoMessage(message)) return null;
  if (looksLikeMediaFileName(content)) return null;
  if (/^(фото|видео|image|video)$/i.test(content)) return null;
  return content;
}

function getMediaMetadataString(message: MessageWithSender | undefined, key: string): string | null {
  const metadata = message?.media_metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function getMediaMetadataNumber(message: MessageWithSender | undefined, key: string): number | null {
  const metadata = message?.media_metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getMessageMediaDimensions(message: MessageWithSender): MediaDimensions | null {
  const width = getMediaMetadataNumber(message, "width");
  const height = getMediaMetadataNumber(message, "height");
  if (!width || !height || width <= 0 || height <= 0) return null;
  return { width, height };
}

function getMediaAspectStyle(dimensions: MediaDimensions | null, fallbackRatio?: number): CSSProperties | undefined {
  if (!dimensions && !fallbackRatio) return undefined;
  const rawRatio = dimensions ? dimensions.width / dimensions.height : fallbackRatio ?? 1;
  const ratio = Math.min(1.9, Math.max(0.72, rawRatio));
  return { aspectRatio: ratio.toFixed(4) };
}

function formatMetadataDuration(durationMs: number): string {
  const totalSec = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSec / 60).toString();
  const seconds = (totalSec % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function looksLikeMediaFileName(value: string): boolean {
  return /^[\w\s().-]+\.(png|jpe?g|webp|gif|mp4|webm|mov|m4v)$/i.test(value);
}
