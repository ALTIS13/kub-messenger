"use client";

import { useLocation } from "wouter";
import { useAppStore } from "@/store/app.store";
import { KubIcon, type KubIconName } from "@/components/kub";
import { useIsManagerOrAdmin } from "@/hooks/useRole";
import { useTaskAccessGate } from "@/hooks/useTaskAccess";
import { openGlobalSearch } from "@/lib/globalSearchEvents";
import { cn } from "@/lib/utils";

type SectionId = "chats" | "search" | "folders" | "profile" | "tasks" | "admin";

interface Tab {
  id: SectionId;
  label: string;
  icon: KubIconName;
}

export function BottomNav() {
  const [location, setLocation] = useLocation();
  const isStaff = useIsManagerOrAdmin();
  const { canAccessTasks } = useTaskAccessGate();
  const { mobileSection, setMobileSection } = useAppStore();
  const isOnAdminRoute = location.startsWith("/admin");
  const isOnTasksRoute = location.startsWith("/tasks");

  const tabs: Tab[] = [
    { id: "chats",   label: "Чаты",    icon: "chatBubble" },
    { id: "search",  label: "Поиск",   icon: "search" },
    { id: "folders", label: "Папки",   icon: "folderAdd" },
    { id: "profile", label: "Профиль", icon: "user" },
    ...(canAccessTasks ? [{ id: "tasks" as const, label: "Задачи", icon: "tasks" as KubIconName }] : []),
    ...(isStaff ? [{ id: "admin" as const, label: "Админка", icon: "shield" as KubIconName }] : []),
  ];

  const handleTab = (id: SectionId) => {
    if (id === "tasks") {
      setLocation("/tasks");
      return;
    }
    if (id === "admin") {
      setLocation("/admin");
      return;
    }
    if (id === "search") {
      openGlobalSearch();
      return;
    }
    setMobileSection(id);
  };

  return (
    <nav
      aria-label="Навигация"
      className="kub-glass relative md:hidden flex items-center justify-around flex-shrink-0 px-2 pb-safe border-t border-[color:var(--kub-border-color)]"
      style={{ height: "56px" }}
    >
      {tabs.map(({ id, label, icon }) => {
        const isActive =
          id === "admin"
            ? isOnAdminRoute
            : id === "tasks"
              ? isOnTasksRoute
              : mobileSection === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => handleTab(id)}
            aria-label={label}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              // `px-1`, not `px-2`, and the padding is the whole fix.
              //
              // D-061: with six tabs at 360px the buttons' base sizes summed to
              // more than the row, so flex shrank them, and a shrunk flex item
              // keeps its padding while its content box collapses — the labels
              // spilled out of their own buttons and ended up 3.2px apart, in a
              // font whose space measures 3.3px. They read as one phrase.
              //
              // Measured at 360: the six labels total 314.1px as shipped
              // against 344px of row, so 8px of padding per side could not be
              // paid. At 11px without the extra tracking they total 278.5px,
              // which leaves the padding intact — and intact padding is a floor
              // under the gap that free space cannot take away.
              "relative flex flex-col items-center gap-0.5 min-w-[44px] min-h-[44px] px-1 py-1 rounded-xl transition-colors",
              isActive ? "text-[color:var(--kub-accent-text)]" : "text-[color:var(--kub-muted)]"
            )}
          >
            <KubIcon name={icon} size={22} />
            <span className="text-[11px] font-semibold uppercase">{label}</span>
            {isActive && (
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-[var(--kub-cyan)] kub-glow-soft" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
