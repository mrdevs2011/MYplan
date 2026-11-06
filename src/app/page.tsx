"use client";

import { useState, useEffect, useCallback, useMemo, useRef, type FormEvent, type ChangeEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import TimeTab from "@/components/time-tab";
import StatsTab from "@/components/stats-tab";
import { formatLongDate } from "@/lib/date-format";
import { EPOCH_STORAGE_KEY, PROD_CLEAN_SLATE_EPOCH, markCleanSlateEpoch } from "@/lib/epoch";
import { LifeSelect, type LifeSelectOption } from "@/components/life-select";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getRecommendedFocusActivity } from "@/lib/focus-recommendation";
import { formatCount, formatStep, formatTimeLeft, isMinuteUnit, roundAmount, stepsFor } from "@/lib/counter-steps";
import {
  EMPTY_PROFILE,
  buildHabitProfile,
  formatMinute,
  learnFormDefaults,
  orderByHabit,
  pickHabitualNow,
  type HabitEvent,
  type HabitProfile,
} from "@/lib/adaptive";
import {
  isPermanentWriteError,
  localProgressEvents,
  localStatuses,
  newEventId,
  nextBatch,
  readOutbox,
  reconcileCount,
  toLocalProgress,
  writeOutbox,
  ACK_PROGRESS_TTL_MS,
  type AckedWrite,
  type OutboxItem,
} from "@/lib/progress-sync";
import { translations, type Language } from "@/lib/translations";
import { PRESETS, ALL_WEEKDAYS, type Preset } from "@/lib/presets";
import {
  IconCheck,
  IconPlus,
  IconCalendar,
  IconList,
  IconArchive,
  IconLogOut,
  IconMenu,
  IconClose,
  IconChevronLeft,
  IconChevronRight,
  IconUser,
  IconBarChart,
  IconCamera,
  IconHash,
  IconUndo,
  IconSettings,
  IconGlobe,
  IconMoon,
  IconSun,
  IconDownload,
  IconSearch,
  IconFilter,
  IconTarget,
  IconTrendUp,
  IconShield,
  IconSparkles,
  IconBell,
  IconUserPlus,
  IconFlame,
  IconSunrise,
  IconWifiOff,
  IconSmartphone,
  IconTablet,
  IconLaptop,
  IconLock,
  IconKey,
  IconEdit,
  IconClock,
  IconAlertTriangle,
  IconAward,
  IconZap,
  IconPlay,
  IconPause,
  IconCheckCircle,
  IconRepeat,
  IconDumbbell,
  IconFootprints,
  IconMapPin,
  IconGlassWater,
  IconDroplet,
  IconBookOpen,
  IconLibrary,
  IconGraduationCap,
  IconMessageCircle,
  IconTimer,
  IconCalendarDays,
  IconFlag,
  IconPin,
  IconCircleDot,
} from "@/components/icons";
import {
  saveAccountSession,
  removeAccountSession,
  pruneAccountSessions,
  restoreAccountSession,
  revokeSessionToken,
} from "@/lib/account-sessions";
import {
  getOrCreateSessionToken,
  syncCurrentDeviceSession,
  checkDeviceSessionActive,
  revokeDeviceSession,
  type UserDevice,
} from "@/lib/device-session";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type TabType = "today" | "activities" | "notifications" | "analytics" | "time" | "profile" | "settings";

interface UserAccount {
  id: string;
  username: string;
  fullName: string;
  age?: string | number | null;
  avatarUrl?: string | null;
  addedAt: number;
}

interface MyPlanNotification {
  id: string;
  sender: string;
  category: "daily" | "streak" | "productivity" | "motivation" | "evening";
  categoryLabel: string;
  title: string;
  message: string;
  createdAt: number;
  timeLabel?: string;
  isRead: boolean;
}

type DurationPreset =
  | "unlimited"
  | "3_days"
  | "1_week"
  | "2_weeks"
  | "3_weeks"
  | "1_month"
  | "2_months"
  | "3_months"
  | "6_months"
  | "1_year"
  | "custom";

interface CustomTimeSlot {
  id: string;
  label: string;
}

type CustomDurationUnit = "kun" | "hafta" | "oy" | "yil";

interface Activity {
  id: string;
  title: string;
  description: string | null;
  schedule_type: "daily" | "once";
  time_of_day?: string;
  reminder_time?: string | null;
  schedule_rule?: {
    duration_label?: string;
    duration_days?: number | null;
    duration_preset?: string;
    weekdays?: number[];
  } | null;
  measurement_type: "check" | "count";
  target: number | null;
  unit: string | null;
  is_active: boolean;
  starts_on: string;
  ends_on?: string | null;
}

interface Occurrence {
  id: string;
  activity_id: string;
  period_start: string;
  period_end: string;
  status: "pending" | "completed";
}

const accountStorageKey = (userId: string, key: string) => `myplan_account_${userId}_${key}`;

/** Everything typed into the plan form. Stored on every change so nothing typed is ever lost. */
interface PlanDraft {
  editingId: string | null;
  kind: "check" | "count";
  title: string;
  description: string;
  schedule: "daily" | "once";
  target: string;
  unit: string;
  durationPreset: DurationPreset;
  customValue: string;
  customUnit: CustomDurationUnit;
  weekdays: number[];
  timeOfDay: string;
  reminder: string;
  savedAt: number;
}

const DRAFT_MAX_AGE_MS = 7 * 86_400_000;
const TAB_STORAGE_KEY = "myplan_active_tab";
const FORM_OPEN_STORAGE_KEY = "myplan_plan_form_open";
const WORKSPACE_REFRESH_MIN_GAP_MS = 30_000;
const HABIT_WINDOW_DAYS = 30;
const SWIPE_ACTION_THRESHOLD = 70;

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked or full: the app keeps working, it just remembers less.
  }
}

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

function playCompletionSound() {
  if (typeof window === "undefined") return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    // Luxury Ascending E-Maj9 shimmer chord (E5, G#5, B5, D#6)
    const notes = [659.25, 830.61, 987.77, 1244.51];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + idx * 0.06);

      gain.gain.setValueAtTime(0, now + idx * 0.06);
      gain.gain.linearRampToValueAtTime(0.14, now + idx * 0.06 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.45);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 0.46);
    });
  } catch {
    // Non-blocking fallback
  }
}

function playIncrementSound(amount: number = 1) {
  if (typeof window === "undefined") return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    // Pitch escalates harmonically based on count magnitude
    const baseFreq = amount >= 10 ? 587.33 : amount >= 5 ? 493.88 : 392.0; // D5, B4, G4
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.15, now + 0.09);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.09, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.14);
  } catch {
    // Non-blocking fallback
  }
}

function triggerHaptic(type: "light" | "medium" | "heavy" | "success" | "warning" = "light") {
  if (typeof window === "undefined" || !("vibrate" in navigator)) return;
  try {
    if (type === "light") navigator.vibrate(10);
    else if (type === "medium") navigator.vibrate(20);
    else if (type === "heavy") navigator.vibrate(35);
    else if (type === "success") navigator.vibrate([20, 50, 40]);
    else if (type === "warning") navigator.vibrate([30, 40, 20]);
  } catch {
    // Non-blocking fallback
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

type PushErrorKind = "dismissed" | "service" | "timeout" | "server" | "generic";

function classifyPushError(error: unknown): { kind: PushErrorKind; detail: string } {
  const e = error as { name?: string; message?: string } | null;
  const message = String(e?.message ?? error ?? "");
  const name = String(e?.name ?? "");
  if (message === "push-permission-dismissed") return { kind: "dismissed", detail: "" };
  if (message === "push-timeout" || message === "push-service-timeout" || /push service error|registration failed|AbortError/i.test(`${name} ${message}`)) {
    return { kind: message === "push-timeout" ? "timeout" : "service", detail: message };
  }
  if (/Functions|Failed to send a request|non-2xx|notification-/i.test(`${name} ${message}`)) return { kind: "server", detail: message };
  return { kind: "generic", detail: message.slice(0, 120) };
}

function urlBase64ToUint8Array(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function getLocalizedNotification(
  n: MyPlanNotification,
  t: Record<string, string>
): {
  title: string;
  message: string;
  sender: string;
  categoryLabel: string;
} {
  const labels: Record<MyPlanNotification["category"], string> = {
    daily: t.notif_cat_daily || n.categoryLabel,
    productivity: t.notif_cat_productivity || n.categoryLabel,
    streak: t.notif_cat_growth || n.categoryLabel,
    motivation: t.notif_cat_growth || n.categoryLabel,
    evening: t.notif_cat_evening || t.notif_cat_daily || n.categoryLabel,
  };
  return {
    // Keep the AI-authored copy intact; only UI chrome is localized here.
    title: n.title,
    message: n.message,
    sender: t.notif_sender_assistant || n.sender,
    categoryLabel: labels[n.category],
  };
}

function getNotificationTimeLabel(timestamp: number, language: Language) {
  // Spelled out by hand: many browsers have no `uz` Intl.RelativeTimeFormat data and print "-4 min".
  const diffMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  const hours = Math.floor(diffMinutes / 60);
  const days = Math.floor(hours / 24);
  const [value, unit] = diffMinutes < 1 ? [0, "now"] : diffMinutes < 60 ? [diffMinutes, "min"] : hours < 24 ? [hours, "h"] : [days, "d"];
  const labels = {
    uz: { now: "hozir", min: "daqiqa oldin", h: "soat oldin", d: "kun oldin" },
    ru: { now: "только что", min: "мин. назад", h: "ч. назад", d: "дн. назад" },
    en: { now: "just now", min: "min ago", h: "h ago", d: "d ago" },
  }[language];
  return unit === "now" ? labels.now : `${value} ${labels[unit as "min" | "h" | "d"]}`;
}

interface NotificationRow {
  id?: string;
  category?: string | null;
  title?: string | null;
  message?: string | null;
  created_at?: string | null;
  scheduled_at?: string | null;
  read_at?: string | null;
}

/**
 * The only door into the notification list. Realtime can deliver a row without its columns, and that used to
 * surface as an empty card and an empty toast. Anything without real text is refused here, on every path.
 */
function toNotification(row: NotificationRow | null | undefined): MyPlanNotification | null {
  const title = row?.title?.trim();
  const message = row?.message?.trim();
  if (!row?.id || !title || !message) return null;
  const parsed = row.created_at ? new Date(row.created_at).getTime() : NaN;
  const createdAt = Number.isFinite(parsed) ? parsed : Date.now();
  const language = ((typeof localStorage !== "undefined" && localStorage.getItem("myplan_lang")) || "uz") as Language;
  return {
    id: row.id,
    sender: "MYplan shaxsiy yordamchisi",
    category: (!row.category || row.category === "system" ? "daily" : row.category) as MyPlanNotification["category"],
    categoryLabel: (row.category || "system").toUpperCase(),
    title,
    message,
    createdAt,
    timeLabel: getNotificationTimeLabel(createdAt, language),
    isRead: Boolean(row.read_at),
  };
}

export default function Home() {
  const router = useRouter();

  // Authentication & User State
  const [userId, setUserId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [accountUsername, setAccountUsername] = useState("");
  const [userAge, setUserAge] = useState<string | number>("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // User Auth Timestamps & Session Security
  const [userLastSignInAt, setUserLastSignInAt] = useState<string>("");
  const [userCreatedAt, setUserCreatedAt] = useState<string>("");
  const [activeDevices, setActiveDevices] = useState<UserDevice[]>([]);

  // Profile Editing States
  const [editFullName, setEditFullName] = useState("");
  const [editAge, setEditAge] = useState<string | number>("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profileActionMsg, setProfileActionMsg] = useState("");
  const [passwordActionMsg, setPasswordActionMsg] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [currentTime, setCurrentTime] = useState<number>(0);

  // App Data
  const [activities, setActivities] = useState<Activity[]>([]);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const activitiesRef = useRef<Activity[]>([]);
  const occurrencesRef = useRef<Occurrence[]>([]);
  const workspaceUserRef = useRef<string | null>(null);
  const workspaceLoadSequenceRef = useRef(0);
  const offlineQueueProcessingRef = useRef(false);
  const workspaceHydratedRef = useRef<string | null>(null);
  const lastWorkspaceLoadRef = useRef(0);
  const bootedUserRef = useRef<string | null>(null);
  const ackedWritesRef = useRef<AckedWrite[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRetryDelayRef = useRef(2000);
  const progressRefreshTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // True while the person is editing their name/age: background data must not overwrite what they type.
  const profileFormDirtyRef = useRef(false);
  const [taskCounts, setTaskCounts] = useState<Record<string, number>>({});
  const taskCountsRef = useRef<Record<string, number>>({});
  const progressSyncVersionsRef = useRef(new Map<string, number>());
  const updateTaskCounts = useCallback((
    next: Record<string, number> | ((current: Record<string, number>) => Record<string, number>)
  ) => {
    const resolved = typeof next === "function" ? next(taskCountsRef.current) : next;
    taskCountsRef.current = resolved;
    setTaskCounts(resolved);
  }, []);
  const [taskHistory, setTaskHistory] = useState<Record<string, number[]>>({});
  const [loadingData, setLoadingData] = useState(false);
  // Learned once per session and then frozen: the list must never rearrange under a finger.
  const [habits, setHabits] = useState<HabitProfile>(EMPTY_PROFILE);

  useEffect(() => {
    activitiesRef.current = activities;
    occurrencesRef.current = occurrences;
  }, [activities, occurrences]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  // Navigation & Tabs
  const [activeTab, setActiveTab] = useState<TabType>("today");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Settings states
  const [language, setLanguage] = useState<Language>("uz");
  const [theme, setTheme] = useState<"dark" | "light" | "system">("system");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [autoArchiveDelay, setAutoArchiveDelay] = useState(7);

  const t = translations[language] || translations.uz;
  const timeLabels = { sec: t.step_sec, min: t.step_min };

  const durationPresets = useMemo(
    () => [
      { id: "unlimited" as const, label: t.preset_unlimited, days: null },
      { id: "1_week" as const, label: t.preset_1w, days: 7 },
      { id: "2_weeks" as const, label: t.preset_2w, days: 14 },
      { id: "3_weeks" as const, label: t.preset_3w, days: 21 },
      { id: "1_month" as const, label: t.preset_1m, days: 30 },
      { id: "2_months" as const, label: t.preset_2m, days: 60 },
      { id: "3_months" as const, label: t.preset_3m, days: 90 },
      { id: "6_months" as const, label: t.preset_6m, days: 180 },
      { id: "1_year" as const, label: t.preset_1y, days: 365 },
      { id: "custom" as const, label: t.preset_custom, days: 0 },
    ],
    [t]
  );

  const weekdaysList = useMemo(
    () => [
      { id: 1, short: t.day_mon_short, full: t.day_mon_full },
      { id: 2, short: t.day_tue_short, full: t.day_tue_full },
      { id: 3, short: t.day_wed_short, full: t.day_wed_full },
      { id: 4, short: t.day_thu_short, full: t.day_thu_full },
      { id: 5, short: t.day_fri_short, full: t.day_fri_full },
      { id: 6, short: t.day_sat_short, full: t.day_sat_full },
      { id: 7, short: t.day_sun_short, full: t.day_sun_full },
    ],
    [t]
  );

  // Splash Screen States (Guaranteed 100% Logo Preload)
  const [splashReady, setSplashReady] = useState(false);
  const [splashFading, setSplashFading] = useState(false);

  // Multi-Account Management (Max 5 accounts)
  const [savedAccounts, setSavedAccounts] = useState<UserAccount[]>([]);

  // Notifications System (3-Day Read-Only History)
  const [notifications, setNotifications] = useState<MyPlanNotification[]>([]);
  const notificationsRef = useRef<MyPlanNotification[]>([]);
  const toastedNotificationIdsRef = useRef<Set<string>>(new Set());
  const [activeToast, setActiveToast] = useState<MyPlanNotification | null>(null);
  // In-app toasts dismiss themselves: with many reminders a toast that waits for a tap would cover the header all day.
  useEffect(() => {
    if (!activeToast) return;
    const timer = setTimeout(() => setActiveToast(null), 6000);
    return () => clearTimeout(timer);
  }, [activeToast]);
  useEffect(() => { notificationsRef.current = notifications; }, [notifications]);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>("default");
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushChecked, setPushChecked] = useState(false);
  const [nagSnoozedUntil, setNagSnoozedUntil] = useState(0);
  const [nagNow, setNagNow] = useState(0);
  const [nagArmedAt, setNagArmedAt] = useState(0);
  const [nagError, setNagError] = useState<{ kind: PushErrorKind; detail: string } | null>(null);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const [overlayText, setOverlayText] = useState("");
  const pushSyncedUserRef = useRef<string | null>(null);

  // PWA State
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isAppInstalled, setIsAppInstalled] = useState(false);
  const [showInstallGuideModal, setShowInstallGuideModal] = useState(false);

  // Floating Modal for Task Creation & Editing
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [importingPresetId, setImportingPresetId] = useState<string | null>(null);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [createTaskKind, setCreateTaskKind] = useState<"check" | "count">("check");
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newSchedule, setNewSchedule] = useState<"daily" | "once">("daily");
  const [countTarget, setCountTarget] = useState("");
  const [countUnit, setCountUnit] = useState("marta");
  const [debouncedCountError, setDebouncedCountError] = useState("");

  // Muddat (Davomiylik) sozlamalari — default: "unlimited" (Cheksiz)
  const [durationPreset, setDurationPreset] = useState<DurationPreset>("unlimited");
  const [customDurationValue, setCustomDurationValue] = useState("");
  const [customDurationUnit, setCustomDurationUnit] = useState<CustomDurationUnit>("kun");
  const [debouncedDurationError, setDebouncedDurationError] = useState("");

  // Custom Time Slots
  const [customTimeSlots, setCustomTimeSlots] = useState<CustomTimeSlot[]>([]);
  const [showCustomTimeModal, setShowCustomTimeModal] = useState<boolean>(false);
  const [customTimeInput, setCustomTimeInput] = useState<string>("");
  const [customTimeError, setCustomTimeError] = useState<string>("");

  // Hafta kunlari sozlamasi (New modal)
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [todayDayOfWeek, setTodayDayOfWeek] = useState<number>(1);

  // Sanoqli hisoblagich bosqichlari (+10, +5, +1 va sozlamalardagi custom bosqichlar)
  const [counterSteps, setCounterSteps] = useState<number[]>([10, 5, 1]);
  const [newStepInput, setNewStepInput] = useState("");
  const [newStepError, setNewStepError] = useState("");

  // Pocket Companion: Streak & Momentum Engine
  const [streakCount, setStreakCount] = useState<number>(0);
  const [bestStreak, setBestStreak] = useState<number>(0);

  // Pocket Companion: Vaqt Zonalari (Morning, Afternoon, Evening, Anytime, Custom)
  const [activeTimeFilter, setActiveTimeFilter] = useState<string>("all");
  const [newTimeOfDay, setNewTimeOfDay] = useState<string>("anytime");
  const [newReminderTime, setNewReminderTime] = useState<string>("");

  // Pocket Companion: Offline-First Sync Queue
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);

  // Pocket Companion: Kechki 2-daqiqalik xulosa (Daily Wrap-up)
  const [showEveningReview, setShowEveningReview] = useState<boolean>(false);

  // Pocket Companion: Touch Gestures (Swipe to complete/undo)
  const [swipeState, setSwipeState] = useState<{ id: string | null; offset: number; action: "complete" | "undo" | null }>({
    id: null,
    offset: 0,
    action: null,
  });
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  // Zen Focus Mode States
  const [focusModalOpen, setFocusModalOpen] = useState(false);
  const [focusActivity, setFocusActivity] = useState<Activity | null>(null);
  const [focusModeType, setFocusModeType] = useState<"sprint" | "deep" | "pomodoro" | "count">("sprint");
  const [focusTimerSeconds, setFocusTimerSeconds] = useState(300);
  const [focusTimerInitial, setFocusTimerInitial] = useState(300);
  const [isFocusTimerRunning, setIsFocusTimerRunning] = useState(false);
  const [focusCelebration, setFocusCelebration] = useState(false);
  const [focusClockMinute, setFocusClockMinute] = useState<number | null>(null);

  // Keep time-window recommendations accurate while the app stays open.
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setFocusClockMinute(now.getHours() * 60 + now.getMinutes());
    };
    updateClock();
    const interval = window.setInterval(updateClock, 15_000);
    return () => window.clearInterval(interval);
  }, []);

  // Focus Timer interval effect
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isFocusTimerRunning && focusTimerSeconds > 0) {
      interval = setInterval(() => {
        setFocusTimerSeconds((prev) => {
          if (prev <= 1) {
            setIsFocusTimerRunning(false);
            if (soundEnabled) playCompletionSound();
            triggerHaptic("success");
            setFocusCelebration(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isFocusTimerRunning, focusTimerSeconds, soundEnabled]);

  const startFocusSession = useCallback((act: Activity) => {
    setFocusActivity(act);
    setFocusCelebration(false);
    if (act.measurement_type === "count") {
      setFocusModeType("count");
    } else {
      const remembered = userId
        ? readJson<Record<string, { seconds: number; mode: "sprint" | "deep" | "pomodoro" }>>(accountStorageKey(userId, "focus_choice"))?.[act.id]
        : undefined;
      setFocusModeType(remembered?.mode ?? "sprint");
      setFocusTimerSeconds(remembered?.seconds ?? 300);
      setFocusTimerInitial(remembered?.seconds ?? 300);
    }
    setIsFocusTimerRunning(false);
    setFocusModalOpen(true);
    triggerHaptic("medium");
  }, [userId]);

  const handleSelectFocusDuration = (seconds: number, mode: "sprint" | "deep" | "pomodoro" | "count") => {
    setFocusModeType(mode);
    setFocusTimerSeconds(seconds);
    setFocusTimerInitial(seconds);
    setIsFocusTimerRunning(false);
    triggerHaptic("light");
    if (userId && focusActivity && mode !== "count") {
      const key = accountStorageKey(userId, "focus_choice");
      writeJson(key, { ...(readJson<Record<string, unknown>>(key) || {}), [focusActivity.id]: { seconds, mode } });
    }
  };

  const completeFocusSession = async () => {
    if (!focusActivity) return;
    triggerHaptic("success");
    if (soundEnabled) playCompletionSound();
    setFocusCelebration(true);
    await toggleComplete(focusActivity);
    setTimeout(() => {
      setFocusModalOpen(false);
      setFocusCelebration(false);
    }, 1200);
  };

  // Debounce task count target in modal (2 seconds)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (createTaskKind !== "count" || !countTarget) {
        setDebouncedCountError("");
        return;
      }
      const val = parseInt(countTarget, 10);
      if (val === 0 || val === 1) {
        setDebouncedCountError("Sanoqli vazifalar uchun minimal miqdor 2 ta. Bir martalik ishlar uchun «Bir martalik» turini tanlang.");
      } else if (val > 99999 || countTarget.length > 5) {
        setDebouncedCountError("Maksimal belgilanishi mumkin bo‘lgan sanoq 99,999 tani tashkil etadi.");
      } else {
        setDebouncedCountError("");
      }
    }, createTaskKind !== "count" || !countTarget ? 0 : 2000);
    return () => clearTimeout(timer);
  }, [countTarget, createTaskKind]);

  // Debounce custom duration in modal (2 seconds)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (durationPreset !== "custom") {
        setDebouncedDurationError("");
        return;
      }
      if (!customDurationValue.trim()) {
        setDebouncedDurationError("Iltimos, muddat miqdorini kiriting.");
        return;
      }
      const val = parseInt(customDurationValue, 10);
      if (isNaN(val)) {
        setDebouncedDurationError("Iltimos, haqiqiy raqam kiriting.");
        return;
      }
      if (customDurationUnit === "kun") {
        if (val < 2) {
          setDebouncedDurationError(t.duration_error_min_days);
        } else if (val > 120) {
          setDebouncedDurationError(t.duration_error_max_days);
        } else {
          setDebouncedDurationError("");
        }
      } else if (customDurationUnit === "hafta") {
        if (val < 1 || val > 9) {
          setDebouncedDurationError(t.duration_error_weeks);
        } else {
          setDebouncedDurationError("");
        }
      } else if (customDurationUnit === "oy") {
        if (val < 1 || val > 9) {
          setDebouncedDurationError(t.duration_error_months);
        } else {
          setDebouncedDurationError("");
        }
      } else if (customDurationUnit === "yil") {
        if (val < 1 || val > 3) {
          setDebouncedDurationError(t.duration_error_years);
        } else {
          setDebouncedDurationError("");
        }
      }
    }, durationPreset !== "custom" || !customDurationValue ? 0 : 2000);
    return () => clearTimeout(timer);
  }, [
    durationPreset,
    customDurationValue,
    customDurationUnit,
    t.duration_error_min_days,
    t.duration_error_max_days,
    t.duration_error_weeks,
    t.duration_error_months,
    t.duration_error_years,
  ]);

  // Catalog Filters (Tab 2)
  const [catalogFilter, setCatalogFilter] = useState<"all" | "active" | "archived">("all");
  const [catalogSearch, setCatalogSearch] = useState("");

  // 10-Second Inactivity Collapse Logic for Counter Buttons
  const [collapsedCounters, setCollapsedCounters] = useState<Record<string, boolean>>({});
  const counterTimersRef = useRef<Record<string, NodeJS.Timeout>>({});
  const [formattedToday, setFormattedToday] = useState("");

  // Human-Centric Unit Formatter (Resolves localized display names)
  const formatUnit = useCallback(
    (unitStr?: string | null): string => {
      if (!unitStr) return t.unit_marta;
      const key = `unit_${unitStr}` as keyof typeof t;
      if (t[key] && typeof t[key] === "string") return t[key] as string;
      return unitStr;
    },
    [t]
  );

  // Durable write path: every change lands in the outbox first, then uploads in order (see progress-sync.ts).
  const pruneAckedWrites = useCallback(() => {
    const now = Date.now();
    ackedWritesRef.current = ackedWritesRef.current.filter((write) => now - write.at < ACK_PROGRESS_TTL_MS);
    return now;
  }, []);

  const processOfflineQueue = useCallback(async () => {
    if (typeof window === "undefined" || offlineQueueProcessingRef.current) return;
    if (!navigator.onLine) return;
    offlineQueueProcessingRef.current = true;
    let retryLater = false;
    try {
      const supabase = createClient();
      // Read locally: a network call here would delay every tap and fail exactly when the connection is weak.
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user.id;
      if (!uid) return;
      let maxBatch = 50;
      for (;;) {
        // Offline writes belong to the account that made them; never replay them under another session.
        const mine = readOutbox().filter((item) => item.payload?.user_id === uid);
        const batch = nextBatch(mine, maxBatch);
        if (batch.length === 0) break;

        let error: { code?: string; message?: string } | null = null;
        const head = batch[0];
        if (head.type === "progress_event") {
          // Stable ids make a retry after a lost response harmless: existing rows are simply skipped.
          const rows = batch.map(({ payload }) => ({
            id: payload.id,
            user_id: payload.user_id,
            occurrence_id: payload.occurrence_id,
            amount: payload.amount,
            note: payload.note,
          }));
          ({ error } = await supabase.from("progress_events").upsert(rows, { onConflict: "id", ignoreDuplicates: true }));
        } else if (head.type === "occurrence_status") {
          ({ error } = await supabase
            .from("occurrences")
            .update({ status: head.payload.status })
            .eq("id", head.payload.id)
            .eq("user_id", head.payload.user_id));
        } else if (head.type === "update_streak") {
          ({ error } = await supabase
            .from("profiles")
            .update({
              streak_count: head.payload.streak_count,
              best_streak: head.payload.best_streak,
              last_active_date: head.payload.last_active_date,
            })
            .eq("id", head.payload.user_id));
        }

        if (error && !isPermanentWriteError(error.code)) {
          retryLater = true;
          break;
        }
        if (error && batch.length > 1) {
          // One bad row must not sink the rest: retry the run one at a time to isolate it.
          maxBatch = 1;
          continue;
        }
        if (error) console.warn("Dropping a write the server can never accept:", error.message);

        const done = new Set(batch.map((item) => item.id));
        const now = pruneAckedWrites();
        for (const item of batch) {
          const progress = toLocalProgress(item);
          if (progress) ackedWritesRef.current.push({ at: now, progress });
          if (item.type === "occurrence_status" && typeof item.payload.id === "string") {
            ackedWritesRef.current.push({ at: now, status: { occurrenceId: item.payload.id, status: String(item.payload.status) } });
          }
        }
        const rest = readOutbox().filter((item) => !done.has(item.id));
        writeOutbox(rest);
        setPendingSyncCount(rest.length);

        const stillCompleted = localStatuses(rest, [], now).get(String(head.payload.id)) !== "pending";
        if (!error && head.notify && stillCompleted) {
          void supabase.functions.invoke("notification-compose", { body: head.notify })
            .then(({ error: notifyError }) => { if (notifyError) console.warn("Completion companion notification failed:", notifyError); })
            .catch((notifyError) => console.warn("Completion companion notification failed:", notifyError));
        }
      }
      flushRetryDelayRef.current = 2000;
    } catch (err) {
      console.warn("Sync paused, it will retry:", err);
      retryLater = true;
    } finally {
      offlineQueueProcessingRef.current = false;
    }
    if (retryLater) {
      const delay = flushRetryDelayRef.current;
      flushRetryDelayRef.current = Math.min(delay * 2, 30_000);
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(() => void processOfflineQueue(), delay);
    }
  }, [pruneAckedWrites]);

  const enqueueOfflineMutation = useCallback((mutation: Pick<OutboxItem, "type" | "payload" | "notify">) => {
    if (typeof window === "undefined") return;
    const queue = [
      ...readOutbox(),
      { ...mutation, id: `mut_${newEventId()}`, createdAt: Date.now() },
    ];
    writeOutbox(queue);
    setPendingSyncCount(queue.length);
    // A short pause lets a burst of taps travel as one request.
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => void processOfflineQueue(), 200);
  }, [processOfflineQueue]);

  // Timer to keep session countdowns and timestamps reactive (RAM & CPU optimized: only on profile/settings)
  useEffect(() => {
    if (activeTab !== "profile" && activeTab !== "settings") return;
    const initTimer = setTimeout(() => setCurrentTime(Date.now()), 0);
    const timer = setInterval(() => setCurrentTime(Date.now()), 60000);
    return () => {
      clearTimeout(initTimer);
      clearInterval(timer);
    };
  }, [activeTab]);

  // Clean up counter collapse timers on unmount to prevent leaks
  useEffect(() => {
    const timers = counterTimersRef.current;
    return () => {
      Object.values(timers).forEach((timer) => clearTimeout(timer));
    };
  }, []);

  const formatRemainingTime = useCallback((ms: number): string => {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0) {
      return `${hours} soat ${minutes} daqiqa`;
    }
    return `${Math.max(1, minutes)} daqiqa`;
  }, []);

  const formatDeviceTime = useCallback((isoString: string): string => {
    try {
      const ms = currentTime - new Date(isoString).getTime();
      const minutes = Math.floor(ms / (1000 * 60));
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);
      if (minutes < 2) return "Hozirgina faol";
      if (minutes < 60) return `${minutes} daqiqa oldin`;
      if (hours < 24) return `${hours} soat oldin`;
      return `${days} kun oldin`;
    } catch {
      return "Yaqinda faol";
    }
  }, [currentTime]);

  // Security Cooldown Calculations based on user login timestamp
  const loginTime = useMemo(() => {
    return userLastSignInAt ? new Date(userLastSignInAt).getTime() : currentTime;
  }, [userLastSignInAt, currentTime]);

  const accountCreatedTime = useMemo(() => {
    return userCreatedAt ? new Date(userCreatedAt).getTime() : currentTime;
  }, [userCreatedAt, currentTime]);

  // 1. Password Cooldown: kamida 24 soat (86,400,000 ms)
  const PASSWORD_COOLDOWN_MS = 24 * 60 * 60 * 1000;
  const timeSinceLogin = Math.max(0, currentTime - loginTime);
  const canChangePassword = timeSinceLogin >= PASSWORD_COOLDOWN_MS;
  const remainingPasswordMs = Math.max(0, PASSWORD_COOLDOWN_MS - timeSinceLogin);

  // 2. Name & Age Cooldown: kamida 3 soat (10,800,000 ms)
  const NAME_AGE_COOLDOWN_MS = 3 * 60 * 60 * 1000;
  const canChangeNameAge = timeSinceLogin >= NAME_AGE_COOLDOWN_MS;
  const remainingNameAgeMs = Math.max(0, NAME_AGE_COOLDOWN_MS - timeSinceLogin);

  // 3. Connected Devices Section: yangi ro'yxatdan o'tganlarga 24 soatdan so'ng ko'rinadi
  const isMatureAccount = (currentTime - accountCreatedTime) >= (24 * 60 * 60 * 1000);

  // Active Devices Loader
  const loadActiveDevices = useCallback(async (uid: string) => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("user_devices")
        .select("*")
        .eq("user_id", uid)
        .eq("is_active", true)
        .order("last_active_at", { ascending: false });
      if (!error && data) {
        setActiveDevices(data as UserDevice[]);
      }
    } catch (err) {
      console.error("loadActiveDevices error:", err);
    }
  }, []);

  // Revoke / Logout Remote Device
  const handleRevokeDevice = useCallback(async (deviceId: string) => {
    try {
      const supabase = createClient();
      const ok = await revokeDeviceSession(supabase, deviceId);
      if (ok) {
        setActiveDevices((prev) => prev.filter((d) => d.id !== deviceId));
        triggerHaptic("medium");
      }
    } catch (err) {
      console.error("handleRevokeDevice error:", err);
    }
  }, []);

  // Profile Information Save Handler (Name & Age)
  const handleSaveProfileInfo = async () => {
    setProfileActionMsg("");
    if (!canChangeNameAge) {
      setProfileActionMsg(
        `Ism va yoshni o‘zgartirish uchun yangi sessiyadan so‘ng kamida 3 soat o‘tishi shart (Qolgan: ${formatRemainingTime(remainingNameAgeMs)}).`
      );
      return;
    }
    const trimmedName = editFullName.trim();
    if (!trimmedName) {
      setProfileActionMsg("Iltimos, ism va familiyangizni kiriting.");
      return;
    }
    let parsedAge: number | null = null;
    if (editAge !== "" && editAge !== null && editAge !== undefined) {
      const num = Number(editAge);
      if (isNaN(num) || num < 6 || num > 122) {
        setProfileActionMsg("Yosh 6 dan 122 oralig‘ida bo‘lishi lozim.");
        return;
      }
      parsedAge = Math.floor(num);
    }

    setIsSavingProfile(true);
    try {
      const supabase = createClient();
      if (userId) {
        const { error: profileErr } = await supabase
          .from("profiles")
          .update({
            full_name: trimmedName,
            age: parsedAge,
          })
          .eq("id", userId);
        if (profileErr) throw profileErr;

        await supabase.auth.updateUser({
          data: {
            full_name: trimmedName,
            age: parsedAge,
          },
        });

        setAccountName(trimmedName);
        setUserAge(parsedAge || "");
        triggerHaptic("success");
        setProfileActionMsg(t.profile_saved_success);
        profileFormDirtyRef.current = false;

        // Update in accounts vault
        try {
          const rawVault = localStorage.getItem("myplan_accounts_vault");
          if (rawVault) {
            const vault: UserAccount[] = JSON.parse(rawVault);
            const updated = vault.map((a) =>
              a.id === userId ? { ...a, fullName: trimmedName, age: parsedAge } : a
            );
            localStorage.setItem("myplan_accounts_vault", JSON.stringify(updated));
            setSavedAccounts(updated);
          }
        } catch {}
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t.profile_save_error;
      setProfileActionMsg(msg);
    } finally {
      setIsSavingProfile(false);
    }
  };

  // Password Update Handler
  const handleUpdatePassword = async () => {
    setPasswordActionMsg("");
    if (!canChangePassword) {
      setPasswordActionMsg(
        `${t.profile_cooldown_24h} (${formatRemainingTime(remainingPasswordMs)}).`
      );
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      setPasswordActionMsg(t.profile_password_len_err);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordActionMsg(t.profile_password_match_err);
      return;
    }

    setIsUpdatingPassword(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) throw error;

      triggerHaptic("success");
      setPasswordActionMsg(t.password_updated_success);
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t.password_update_error;
      setPasswordActionMsg(msg);
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  // Load Workspace Data
  const loadWorkspace = useCallback(async (id: string) => {
    workspaceUserRef.current = id;
    const loadSequence = ++workspaceLoadSequenceRef.current;
    const isCurrentLoad = () => workspaceUserRef.current === id && workspaceLoadSequenceRef.current === loadSequence;
    lastWorkspaceLoadRef.current = Date.now();
    // Only the very first load may show a spinner. A refresh happens quietly behind what the person is doing.
    if (workspaceHydratedRef.current !== id) setLoadingData(true);
    const supabase = createClient();
    try {
      const [{ data: profile, error: profileError }, firstActivityResult] = await Promise.all([
        supabase
          .from("profiles")
          .select("username, full_name, age, avatar_url, streak_count, best_streak, last_active_date, language, counter_steps, sound_enabled, notifications_enabled, auto_archive_delay, created_at")
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("activities")
          .select("id,title,description,schedule_type,schedule_rule,measurement_type,target,unit,is_active,starts_on,ends_on,time_of_day,reminder_time")
          .eq("user_id", id)
          .order("created_at", { ascending: false }),
      ]);

      // reminder_time arrives with migration 012; until it is applied, fall back to the base columns
      // (Postgres 42703 = undefined_column) so the workspace never loads empty.
      let activityRows = firstActivityResult.data as Activity[] | null;
      let activityError = firstActivityResult.error;
      if (activityError?.code === "42703") {
        const retry = await supabase
          .from("activities")
          .select("id,title,description,schedule_type,schedule_rule,measurement_type,target,unit,is_active,starts_on,ends_on,time_of_day")
          .eq("user_id", id)
          .order("created_at", { ascending: false });
        activityRows = retry.data as Activity[] | null;
        activityError = retry.error;
      }

      if (profileError) throw profileError;
      if (activityError) throw activityError;
      if (!isCurrentLoad()) return;
      const acts = (activityRows || []) as Activity[];
      setActivities(acts);
      const savedSlots = localStorage.getItem(accountStorageKey(id, "custom_time_slots"));
      let accountSlots: CustomTimeSlot[] = [];
      if (savedSlots) {
        try {
          const parsedSlots: unknown = JSON.parse(savedSlots);
          if (Array.isArray(parsedSlots)) {
            accountSlots = parsedSlots.filter((slot): slot is CustomTimeSlot =>
              Boolean(slot && typeof slot.id === "string" && typeof slot.label === "string")
            );
          }
        } catch {
          localStorage.removeItem(accountStorageKey(id, "custom_time_slots"));
        }
      }
      setCustomTimeSlots(accountSlots);

      if (acts && acts.length > 0) {
        setCustomTimeSlots((prev) => {
          const map = new Map<string, string>(prev.map((s) => [s.id, s.label]));
          let changed = false;
          acts.forEach((a) => {
            if (a.time_of_day && !["morning", "afternoon", "evening", "anytime"].includes(a.time_of_day)) {
              if (!map.has(a.time_of_day)) {
                map.set(a.time_of_day, a.time_of_day.replace(/^custom_/, ""));
                changed = true;
              }
            }
          });
          if (!changed) return prev;
          const updated = Array.from(map.entries()).map(([id, label]) => ({ id, label }));
          if (typeof window !== "undefined") {
            localStorage.setItem(accountStorageKey(id, "custom_time_slots"), JSON.stringify(updated));
          }
          return updated;
        });
      }

      if (profile) {
        setAccountName(profile.full_name || profile.username || "");
        setAccountUsername(profile.username || "");
        if (!profileFormDirtyRef.current) {
          setEditFullName(profile.full_name || profile.username || "");
          setEditAge(profile.age ?? "");
        }
        setUserAge(profile.age ?? "");
        setUserCreatedAt(profile.created_at || "");
        setAvatarUrl(typeof profile.avatar_url === "string" && profile.avatar_url ? profile.avatar_url : null);
        if (!profile.avatar_url) localStorage.removeItem(`myplan_avatar_${id}`);
        setStreakCount(typeof profile.streak_count === "number" ? profile.streak_count : 0);
        setBestStreak(typeof profile.best_streak === "number" ? profile.best_streak : 0);

        const profileLanguage = profile.language === "en" || profile.language === "ru" ? profile.language : "uz";
        setLanguage(profileLanguage);
        localStorage.setItem("myplan_lang", profileLanguage);
        setFormattedToday(formatLongDate(profileLanguage));

        const validSteps = Array.isArray(profile.counter_steps)
          ? (profile.counter_steps as number[])
              .filter((n): n is number => typeof n === "number" && n >= 1 && n <= 99)
              .sort((a, b) => b - a)
          : [];
        const resolvedSteps = validSteps.length > 0 ? validSteps : [10, 5, 1];
        setCounterSteps(resolvedSteps);
        localStorage.setItem("myplan_counter_steps", JSON.stringify(resolvedSteps));

        const soundEnabledForAccount = typeof profile.sound_enabled === "boolean" ? profile.sound_enabled : true;
        const notificationsEnabledForAccount = typeof profile.notifications_enabled === "boolean" ? profile.notifications_enabled : true;
        setSoundEnabled(soundEnabledForAccount);
        setNotificationsEnabled(notificationsEnabledForAccount);
        localStorage.setItem("myplan_sound_enabled", String(soundEnabledForAccount));
        localStorage.setItem("myplan_notifications_enabled", String(notificationsEnabledForAccount));
        setAutoArchiveDelay(typeof profile.auto_archive_delay === "number" ? profile.auto_archive_delay : 7);
      }

      // Load today's occurrences using correct PostgreSQL schema
      const todayStr = today();
      const todayDay = new Date().getDay() === 0 ? 7 : new Date().getDay();

      const { data: occRows, error: occError } = await supabase
        .from("occurrences")
        .select("id,activity_id,period_start,period_end,status")
        .eq("user_id", id)
        .eq("period_start", todayStr);

      if (occError) throw occError;
      if (!isCurrentLoad()) return;

      let todayOccs = (occRows || []) as Occurrence[];

      // Only generate occurrence for activities scheduled on today's weekday
      const missingActivities = acts.filter((a) => {
        if (!a.is_active) return false;
        // One-time tasks get exactly one occurrence on their start date; never regenerate them daily.
        if (a.schedule_type === "once") {
          return a.starts_on === todayStr && !todayOccs.some((o) => o.activity_id === a.id);
        }
        const weekdays = a.schedule_rule?.weekdays;
        if (weekdays && Array.isArray(weekdays) && weekdays.length > 0 && !weekdays.includes(todayDay)) {
          return false;
        }
        return !todayOccs.some((o) => o.activity_id === a.id);
      });

      if (missingActivities.length > 0) {
        const inserts = missingActivities.map((a) => ({
          user_id: id,
          activity_id: a.id,
          period_start: todayStr,
          period_end: todayStr,
          status: "pending" as const,
        }));
        // Another tab or device may create the same rows at the same moment. Skipping duplicates and reading back
        // guarantees every plan keeps its row, otherwise its counter buttons would vanish.
        const { error: insertError } = await supabase
          .from("occurrences")
          .upsert(inserts, { onConflict: "activity_id,period_start", ignoreDuplicates: true });
        if (insertError) console.warn("Could not create today's occurrences:", insertError);
        const { data: freshOccs, error: freshError } = await supabase
          .from("occurrences")
          .select("id,activity_id,period_start,period_end,status")
          .eq("user_id", id)
          .eq("period_start", todayStr);
        if (!freshError && freshOccs) todayOccs = freshOccs as Occurrence[];
        if (!isCurrentLoad()) return;
      }

      // Server rows plus whatever this device has not seen acknowledged yet.
      const statusNow = localStatuses(readOutbox(), ackedWritesRef.current, Date.now());
      setOccurrences(todayOccs.map((occ) => {
        const local = statusNow.get(occ.id);
        return local ? { ...occ, status: local as Occurrence["status"] } : occ;
      }));

      const occIds = todayOccs.map((o) => o.id);
      const progressRows: { id: string; occurrence_id: string; amount: number }[] = [];
      let progressLoaded = true;
      try {
        for (let offset = 0; occIds.length > 0; offset += 1000) {
          const { data, error } = await supabase
            .from("progress_events")
            .select("id, occurrence_id, amount")
            .in("occurrence_id", occIds)
            .range(offset, offset + 999);
          if (error) throw error;
          const batch = (data || []) as typeof progressRows;
          progressRows.push(...batch);
          if (batch.length < 1000) break;
        }
      } catch (error) {
        progressLoaded = false;
        console.warn("Progress could not refresh; keeping the numbers on screen:", error);
      }

      if (!isCurrentLoad()) return;
      // Read after the last await, so a tap made during this load is included.
      const localEvents = localProgressEvents(readOutbox(), ackedWritesRef.current, Date.now());
      const initialCounts: Record<string, number> = {};
      todayOccs.forEach((occ) => {
        const act = acts.find((a) => a.id === occ.activity_id);
        const cap = act?.target ? act.target : Infinity;
        const rows = progressRows.filter((row) => row.occurrence_id === occ.id);
        const hasLocal = localEvents.some((event) => event.occurrenceId === occ.id);
        if (progressLoaded && (rows.length > 0 || hasLocal)) {
          initialCounts[occ.id] = reconcileCount(rows, localEvents, occ.id, cap);
          localStorage.setItem(`myplan_count_${occ.id}`, String(initialCounts[occ.id]));
        } else if (!progressLoaded) {
          const onScreen = taskCountsRef.current[occ.id];
          const saved = localStorage.getItem(`myplan_count_${occ.id}`);
          if (onScreen !== undefined) initialCounts[occ.id] = onScreen;
          else if (saved !== null) initialCounts[occ.id] = Math.min(Math.max(0, parseFloat(saved) || 0), cap);
        }
      });

      if (!isCurrentLoad()) return;
      updateTaskCounts(initialCounts);
      workspaceHydratedRef.current = id;
    } catch (err) {
      if (isCurrentLoad()) console.error("Workspace loading error:", err);
    } finally {
      if (isCurrentLoad()) setLoadingData(false);
    }
  }, [updateTaskCounts]);

  // Learns from the last month of real use. The result is stored for the next session rather than applied now,
  // so nothing on screen moves while the person is using it.
  const refreshHabits = useCallback(async (id: string) => {
    try {
      const supabase = createClient();
      const since = new Date(Date.now() - HABIT_WINDOW_DAYS * 86_400_000);
      const sinceDay = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-${String(since.getDate()).padStart(2, "0")}`;
      const [{ data: occRows, error: occError }, { data: eventRows, error: eventError }] = await Promise.all([
        supabase.from("occurrences").select("id,activity_id").eq("user_id", id).gte("period_start", sinceDay).limit(1000),
        supabase
          .from("progress_events")
          .select("occurrence_id,amount,note,recorded_at")
          .eq("user_id", id)
          .gte("recorded_at", since.toISOString())
          .order("recorded_at", { ascending: false })
          .limit(1000),
      ]);
      if (occError || eventError || !occRows || !eventRows) return;
      const activityByOccurrence = new Map((occRows as { id: string; activity_id: string }[]).map((row) => [row.id, row.activity_id]));
      const events: HabitEvent[] = [];
      for (const row of eventRows as { occurrence_id: string; amount: number; note: string | null; recorded_at: string }[]) {
        const activityId = activityByOccurrence.get(row.occurrence_id);
        if (!activityId) continue;
        const note = row.note || "";
        events.push({
          activityId,
          amount: Number(row.amount) || 0,
          at: new Date(row.recorded_at).getTime(),
          isStep: note.startsWith("+") || note.startsWith("Qaytarish"),
        });
      }
      const checkMinutes = readJson<Record<string, number[]>>(accountStorageKey(id, "check_minutes")) || {};
      writeJson(accountStorageKey(id, "habits"), buildHabitProfile(events, checkMinutes));
    } catch (error) {
      console.warn("Habits could not refresh:", error);
    }
  }, []);

  // Auth Initialization & Session Listener
  useEffect(() => {
    // Expose build info & banner in browser console
    if (typeof window !== "undefined") {
      (window as unknown as { myplanVersion: unknown }).myplanVersion = {
        version: "2.7.0",
        commit: "apex-v2.7-full-harmony",
        updatedAt: "2026-11-04 09:15",
        features: [
          "100% full translations across all 3 languages (Modal, Units, Weekdays, Presets, Actions, Headers)",
          "Pure Light Mode ecosystem for Modal, Inputs, Chips, Weekdays, Scroll masks & Dropdowns",
          "Zero mixed language everywhere in the app",
          "Exact 44px Undo circle button without text",
          "Top-aligned collapsed sidebar",
        ],
        status: "LATEST_VERSION_ACTIVE",
      };
      console.log(
        "%c MYPLAN ACTIVE %c v2.7.0 (LATEST) %c Full Light/Dark & Zero Mix Languages ",
        "background: #b4f04c; color: #000; font-weight: 800; padding: 4px 8px; border-radius: 4px 0 0 4px;",
        "background: #1e293b; color: #38bdf8; font-weight: 700; padding: 4px 8px;",
        "background: #0f172a; color: #a3e635; font-weight: 600; padding: 4px 8px; border-radius: 0 4px 4px 0;"
      );
    }

    // 100% Guaranteed Splash Screen Preload
    if (typeof window !== "undefined") {
      const img = new window.Image();
      img.src = "/myplan-logo-192.png";
      let splashSeen = false;
      try {
        splashSeen = sessionStorage.getItem("myplan_splash_seen") === "1";
        sessionStorage.setItem("myplan_splash_seen", "1");
      } catch {
        // first-load behaviour when storage is unavailable
      }
      const minTimer = new Promise((resolve) => setTimeout(resolve, splashSeen ? 0 : 600));
      const imgLoaded = img.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
            img.onload = resolve;
            img.onerror = resolve;
          });

      void Promise.all([imgLoaded, minTimer]).then(() => {
        setSplashFading(true);
        setTimeout(() => setSplashReady(true), splashSeen ? 120 : 350);
      });
    }

    if (!isSupabaseConfigured()) {
      setTimeout(() => {
        setAuthReady(true);
        router.replace("/login");
      }, 0);
      return;
    }

    const supabase = createClient();
    let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;
    let activeRealtimeUid: string | null = null;
    let authStateRevision = 0;
    let latestAuthEventUserId: string | null | undefined;
    let disposed = false;

    const refreshOccurrenceProgress = async (uid: string, occurrenceId: string) => {
      const syncVersion = (progressSyncVersionsRef.current.get(occurrenceId) || 0) + 1;
      progressSyncVersionsRef.current.set(occurrenceId, syncVersion);
      const rows: { id: string; amount: number }[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabase
          .from("progress_events")
          .select("id, amount")
          .eq("user_id", uid)
          .eq("occurrence_id", occurrenceId)
          .range(offset, offset + 999);
        if (error || !data) {
          console.warn("Realtime progress reconciliation failed:", error);
          return;
        }
        rows.push(...(data as { id: string; amount: number }[]));
        if (data.length < 1000) break;
      }
      if (
        activeRealtimeUid !== uid ||
        workspaceUserRef.current !== uid ||
        progressSyncVersionsRef.current.get(occurrenceId) !== syncVersion
      ) return;
      const occurrence = occurrencesRef.current.find((item) => item.id === occurrenceId);
      if (!occurrence) {
        void loadWorkspace(uid);
        return;
      }
      const activity = activitiesRef.current.find((item) => item.id === occurrence.activity_id);
      const cap = activity?.target && activity.target > 0 ? activity.target : Infinity;
      const localEvents = localProgressEvents(readOutbox(), ackedWritesRef.current, Date.now());
      const count = reconcileCount(rows, localEvents, occurrenceId, cap);
      updateTaskCounts((prev) => ({ ...prev, [occurrenceId]: count }));
      localStorage.setItem(`myplan_count_${occurrenceId}`, String(count));
    };

    // Starts a signed-in session exactly once. Supabase repeats auth events on every token refresh and tab focus;
    // tearing the workspace down for those is what made the screen jump while someone was working.
    const startWorkspace = (uid: string) => {
      if (bootedUserRef.current === uid) return;
      bootedUserRef.current = uid;
      profileFormDirtyRef.current = false;
      setHabits(readJson<HabitProfile>(accountStorageKey(uid, "habits")) || EMPTY_PROFILE);
      void loadWorkspace(uid);
      setupRealtime(uid);
      void syncCurrentDeviceSession(supabase, uid);
      void loadActiveDevices(uid);
      void refreshHabits(uid);
      void processOfflineQueue();
    };

    const setupRealtime = (uid: string) => {
      activeRealtimeUid = uid;
      if (realtimeChannel) {
        void supabase.removeChannel(realtimeChannel);
        realtimeChannel = null;
      }
      let hasSubscribedBefore = false;
      let needsResyncAfterReconnect = false;
      realtimeChannel = supabase
        .channel(`workspace-sync-${uid}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "activities", filter: `user_id=eq.${uid}` },
          (payload) => {
            if (activeRealtimeUid !== uid) return;
            if (payload.eventType === "INSERT") {
              const row = payload.new as Activity;
              setActivities((prev) => (prev.some((a) => a.id === row.id) ? prev : [row, ...prev]));
            } else if (payload.eventType === "UPDATE") {
              const row = payload.new as Activity;
              setActivities((prev) => prev.map((a) => (a.id === row.id ? row : a)));
            } else if (payload.eventType === "DELETE") {
              const row = payload.old as { id: string };
              setActivities((prev) => prev.filter((a) => a.id !== row.id));
            }
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "occurrences", filter: `user_id=eq.${uid}` },
          (payload) => {
            if (activeRealtimeUid !== uid) return;
            if (payload.eventType === "INSERT") {
              const row = payload.new as Occurrence;
              if (row.period_start !== today()) return;
              setOccurrences((prev) => (prev.some((o) => o.id === row.id) ? prev : [row, ...prev]));
            } else if (payload.eventType === "UPDATE") {
              const row = payload.new as Occurrence;
              // An echo of an older write from this device must not flip a checkbox back.
              const local = localStatuses(readOutbox(), ackedWritesRef.current, Date.now()).get(row.id);
              const next = local ? { ...row, status: local as Occurrence["status"] } : row;
              setOccurrences((prev) => prev.map((o) => (o.id === row.id ? next : o)));
            } else if (payload.eventType === "DELETE") {
              const row = payload.old as { id: string };
              setOccurrences((prev) => prev.filter((o) => o.id !== row.id));
            }
          }
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "progress_events", filter: `user_id=eq.${uid}` },
          async (payload) => {
            if (activeRealtimeUid !== uid) return;
            const event = payload.new as { id?: string; occurrence_id?: string };
            if (!event.occurrence_id) return;
            const occurrenceId = event.occurrence_id;
            // This device already shows its own taps; only another device's event needs a refresh.
            const ownEvents = localProgressEvents(readOutbox(), ackedWritesRef.current, Date.now());
            if (ownEvents.some((item) => item.id === event.id)) return;
            const timers = progressRefreshTimersRef.current;
            const pendingTimer = timers.get(occurrenceId);
            if (pendingTimer) clearTimeout(pendingTimer);
            timers.set(occurrenceId, setTimeout(() => {
              timers.delete(occurrenceId);
              void refreshOccurrenceProgress(uid, occurrenceId);
            }, 300));
          }
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${uid}` },
          (payload) => {
            if (activeRealtimeUid !== uid) return;
            const p = payload.new as Record<string, unknown>;
            if (p.language && typeof p.language === "string") {
              const l = p.language as Language;
              setLanguage(l);
              localStorage.setItem("myplan_lang", l);
              setFormattedToday(formatLongDate(l));
            }
            if (Array.isArray(p.counter_steps)) {
              const steps = (p.counter_steps as number[])
                .filter((n): n is number => typeof n === "number" && n >= 1 && n <= 99)
                .sort((a, b) => b - a);
              if (steps.length > 0) {
                setCounterSteps(steps);
                localStorage.setItem("myplan_counter_steps", JSON.stringify(steps));
              }
            }
            if (typeof p.streak_count === "number") setStreakCount(p.streak_count);
            if (typeof p.best_streak === "number") setBestStreak(p.best_streak);
            if (typeof p.sound_enabled === "boolean") {
              setSoundEnabled(p.sound_enabled);
              localStorage.setItem("myplan_sound_enabled", String(p.sound_enabled));
            }
            if (typeof p.notifications_enabled === "boolean") {
              setNotificationsEnabled(p.notifications_enabled);
              localStorage.setItem("myplan_notifications_enabled", String(p.notifications_enabled));
            }
            if (typeof p.auto_archive_delay === "number") setAutoArchiveDelay(p.auto_archive_delay);
            if (typeof p.full_name === "string") {
              setAccountName(p.full_name);
              if (!profileFormDirtyRef.current) setEditFullName(p.full_name);
            }
            if (typeof p.avatar_url === "string") {
              setAvatarUrl(p.avatar_url);
              localStorage.setItem(`myplan_avatar_${uid}`, p.avatar_url);
            } else if (p.avatar_url === null) {
              setAvatarUrl(null);
              localStorage.removeItem(`myplan_avatar_${uid}`);
            }
            if (typeof p.age === "number" || p.age === null) {
              setUserAge(p.age ?? "");
              if (!profileFormDirtyRef.current) setEditAge(p.age ?? "");
            }
            if (typeof p.username === "string") setAccountUsername(p.username);
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "user_devices", filter: `user_id=eq.${uid}` },
          (payload) => {
            if (activeRealtimeUid !== uid) return;
            const currentToken = getOrCreateSessionToken(uid);
            const updated = payload.new as { session_token?: string; is_active?: boolean } | null;
            if (
              payload.eventType === "UPDATE" &&
              updated?.session_token === currentToken &&
              updated?.is_active === false
            ) {
              const sb = createClient();
              removeAccountSession(uid);
              void sb.auth.signOut({ scope: "local" }).then(() => {
                if (typeof window !== "undefined") {
                  localStorage.removeItem("myplan_active_account_id");
                }
                setUserId(null);
                router.replace("/login");
              });
              return;
            }
            void loadActiveDevices(uid);
          }
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` },
          (payload) => {
            if (activeRealtimeUid !== uid) return;
            if (payload.eventType === "DELETE") {
              const row = payload.old as { id: string };
              setNotifications((prev) => prev.filter((item) => item.id !== row.id));
              return;
            }
            const row = payload.new as NotificationRow;
            if (!row?.id) return;
            const known = notificationsRef.current.some((item) => item.id === row.id);
            if (payload.eventType === "UPDATE" && known && "read_at" in row) {
              setNotifications((prev) => prev.map((item) => item.id === row.id ? { ...item, isRead: Boolean(row.read_at) } : item));
              return;
            }
            if (known) return;
            const show = (source: NotificationRow) => {
              const item = toNotification(source);
              if (!item) return;
              if (source.scheduled_at && new Date(source.scheduled_at).getTime() > Date.now()) return;
              setNotifications((prev) => prev.some((n) => n.id === item.id) ? prev : [item, ...prev].slice(0, 100));
              if (document.visibilityState === "visible" && !toastedNotificationIdsRef.current.has(item.id)) {
                toastedNotificationIdsRef.current.add(item.id);
                setActiveToast(item);
              }
            };
            if (row.title?.trim() && row.message?.trim()) {
              show(row);
              return;
            }
            // The event arrived without its text: read the real row instead of showing a blank.
            void supabase
              .from("notifications")
              .select("id,category,title,message,created_at,scheduled_at,read_at")
              .eq("id", row.id)
              .maybeSingle()
              .then(({ data }) => {
                if (activeRealtimeUid === uid && data) show(data as NotificationRow);
              });
          }
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            if (hasSubscribedBefore && needsResyncAfterReconnect) {
              needsResyncAfterReconnect = false;
              void loadWorkspace(uid);
              void loadActiveDevices(uid);
            }
            hasSubscribedBefore = true;
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            if (hasSubscribedBefore) needsResyncAfterReconnect = true;
            console.warn(`MYplan Realtime ${status}; waiting for automatic reconnect.`);
          }
        });
    };

    const initialAuthRevision = authStateRevision;
    void supabase.auth.getSession().then(async ({ data: { session } }) => {
      // An auth event that arrived after getSession started is authoritative.
      // Ignore this potentially stale snapshot instead of restoring an old account.
      if (
        disposed ||
        (authStateRevision !== initialAuthRevision && latestAuthEventUserId !== (session?.user.id ?? null))
      ) return;
      // Clean Production Start Epoch (Purge legacy test sessions so returning test users cleanly log out)
      if (typeof window !== "undefined") {
        const storedEpoch = localStorage.getItem(EPOCH_STORAGE_KEY);
        if (storedEpoch !== PROD_CLEAN_SLATE_EPOCH) {
          try {
            await supabase.auth.signOut({ scope: "local" });
          } catch {}
          // Remove every MYplan-owned browser value plus Supabase auth tokens.
          // Keep only the epoch marker written below so this purge runs once per release.
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key && (key.startsWith("myplan_") || key.startsWith("sb-"))) {
              localStorage.removeItem(key);
            }
          }
          for (let i = sessionStorage.length - 1; i >= 0; i--) {
            const key = sessionStorage.key(i);
            if (key && (key.startsWith("myplan_") || key.startsWith("sb-"))) {
              sessionStorage.removeItem(key);
            }
          }
          markCleanSlateEpoch();
          setUserId(null);
          setAuthReady(true);
          router.replace("/login");
          return;
        }
      }

      if (session?.user) {
        // Instant check if this device was revoked remotely
        const sessionCheck = await checkDeviceSessionActive(supabase, session.user.id);
        if (!sessionCheck.allowed) {
          removeAccountSession(session.user.id);
          await supabase.auth.signOut({ scope: "local" });
          if (typeof window !== "undefined") {
            localStorage.removeItem("myplan_active_account_id");
          }
          setUserId(null);
          setAuthReady(true);
          router.replace("/login");
          return;
        }

        const currentId = session.user.id;
        localStorage.setItem("myplan_active_account_id", currentId);
        saveAccountSession(session);
        const currentName = String(
          session.user.user_metadata?.full_name || session.user.user_metadata?.username || ""
        );
        const currentUsername = String(session.user.user_metadata?.username || "");
        const currentAge = session.user.user_metadata?.age || "";

        setUserId(currentId);
        setAccountName(currentName);
        setAccountUsername(currentUsername);
        setUserAge(currentAge);
        setEditFullName(currentName);
        if (currentAge) setEditAge(currentAge);
        setUserLastSignInAt(
          session.user.last_sign_in_at || session.user.created_at || new Date().toISOString()
        );
        setUserCreatedAt(session.user.created_at || new Date().toISOString());

        setAuthReady(true);
        startWorkspace(currentId);

        const savedAvatar = localStorage.getItem(`myplan_avatar_${currentId}`);
        if (savedAvatar) setAvatarUrl(savedAvatar);

        // Vault registration (up to 5 accounts)
        if (typeof window !== "undefined") {
          try {
            const rawVault = localStorage.getItem("myplan_accounts_vault");
            const vault: UserAccount[] = rawVault ? JSON.parse(rawVault) : [];
            const exists = vault.some((a) => a.id === currentId);
            if (!exists) {
              const updated = [
                ...vault.slice(0, 4),
                {
                  id: currentId,
                  username: currentUsername || "foydalanuvchi",
                  fullName: currentName || "Foydalanuvchi",
                  age: currentAge || null,
                  avatarUrl: savedAvatar,
                  addedAt: Date.now(),
                },
              ];
              localStorage.setItem("myplan_accounts_vault", JSON.stringify(updated));
              setSavedAccounts(updated);
            } else {
              setSavedAccounts(vault);
            }
          } catch (e) {
            console.error(e);
          }
        }
      } else {
        setAuthReady(true);
        router.replace("/login");
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      authStateRevision += 1;
      latestAuthEventUserId = session?.user.id ?? null;
      if (disposed) return;
      if (session?.user) {
        const nextUserId = session.user.id;
        saveAccountSession(session);
        // The getSession() path above runs the device check and starts the workspace.
        if (event === "INITIAL_SESSION") return;
        // Same person, new token: keep the saved tokens fresh and leave the screen alone.
        if (bootedUserRef.current === nextUserId) return;
        if (workspaceUserRef.current && workspaceUserRef.current !== nextUserId) {
          setActivities([]);
          setOccurrences([]);
          updateTaskCounts({});
          progressSyncVersionsRef.current.clear();
          setTaskHistory({});
          setNotifications([]);
          setActiveToast(null);
        }
        const currentName = String(
          session.user.user_metadata?.full_name || session.user.user_metadata?.username || ""
        );
        const currentUsername = String(session.user.user_metadata?.username || "");
        const currentAge = session.user.user_metadata?.age || "";
        if (typeof window !== "undefined") localStorage.setItem("myplan_active_account_id", nextUserId);
        setUserId(nextUserId);
        setAccountName(currentName);
        setAccountUsername(currentUsername);
        setUserAge(currentAge);
        setEditFullName(currentName);
        setEditAge(currentAge);
        setUserLastSignInAt(session.user.last_sign_in_at || session.user.created_at || new Date().toISOString());
        setUserCreatedAt(session.user.created_at || new Date().toISOString());
        setAuthReady(true);
        const savedAvatar = localStorage.getItem(`myplan_avatar_${nextUserId}`);
        setAvatarUrl(savedAvatar);
        setTimeout(() => {
          if (disposed) return;
          startWorkspace(nextUserId);
          try {
            const rawVault = localStorage.getItem("myplan_accounts_vault");
            const vault: UserAccount[] = rawVault ? JSON.parse(rawVault) : [];
            const existing = vault.find((account) => account.id === nextUserId);
            const updatedAccount: UserAccount = {
              id: nextUserId,
              username: currentUsername || existing?.username || "foydalanuvchi",
              fullName: currentName || existing?.fullName || "Foydalanuvchi",
              age: currentAge || existing?.age || null,
              avatarUrl: savedAvatar || existing?.avatarUrl || null,
              addedAt: existing?.addedAt || Date.now(),
            };
            const updatedVault = [...vault.filter((account) => account.id !== nextUserId), updatedAccount].slice(-5);
            localStorage.setItem("myplan_accounts_vault", JSON.stringify(updatedVault));
            setSavedAccounts(updatedVault);
          } catch (error) {
            console.warn("Account vault could not be synchronized:", error);
          }
        }, 0);
      } else {
        activeRealtimeUid = null;
        if (realtimeChannel) {
          void supabase.removeChannel(realtimeChannel);
          realtimeChannel = null;
        }
        workspaceUserRef.current = null;
        workspaceHydratedRef.current = null;
        bootedUserRef.current = null;
        workspaceLoadSequenceRef.current += 1;
        setUserId(null);
        setActivities([]);
        setOccurrences([]);
        updateTaskCounts({});
        progressSyncVersionsRef.current.clear();
        setTaskHistory({});
        setNotifications([]);
        setActiveToast(null);
        setLoadingData(false);
        if (typeof window !== "undefined") localStorage.removeItem("myplan_active_account_id");
        router.replace("/login");
      }
    });

    // PWA event listeners
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsAppInstalled(true);
      setDeferredPrompt(null);
    };

    const handleOnline = () => {
      setIsOnline(true);
      const uid = activeRealtimeUid;
      void processOfflineQueue().finally(() => {
        if (uid) void loadWorkspace(uid);
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible" || !activeRealtimeUid) return;
      void processOfflineQueue();
      // Hopping to another app and back is not a reason to reload; realtime already kept this screen current.
      if (Date.now() - lastWorkspaceLoadRef.current < WORKSPACE_REFRESH_MIN_GAP_MS) return;
      void loadWorkspace(activeRealtimeUid);
      void loadActiveDevices(activeRealtimeUid);
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type !== "MYPLAN_PUSH") return;
      const payload = event.data.payload as { id?: string; title?: string; body?: string; category?: string };
      const item = toNotification({ id: payload.id, category: payload.category, title: payload.title, message: payload.body });
      if (!item) return;
      if (!notificationsRef.current.some((notification) => notification.id === item.id)) {
        setNotifications((prev) => [item, ...prev].slice(0, 100));
      }
      if (!toastedNotificationIdsRef.current.has(item.id)) {
        toastedNotificationIdsRef.current.add(item.id);
        setActiveToast(item);
      }
    };

    let colorSchemeMedia: MediaQueryList | null = null;
    let handleSystemThemeChange: ((e: MediaQueryListEvent) => void) | null = null;

    if (typeof window !== "undefined") {
      if (
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone
      ) {
        setTimeout(() => setIsAppInstalled(true), 0);
      }
      window.addEventListener("beforeinstallprompt", handleBeforeInstall);
      window.addEventListener("appinstalled", handleAppInstalled);

      const savedTheme = (localStorage.getItem("myplan_theme") as "dark" | "light" | "system") || "system";
      setTimeout(() => {
        setTheme(savedTheme);
        if (savedTheme === "system") {
          const isLight = window.matchMedia("(prefers-color-scheme: light)").matches;
          document.documentElement.setAttribute("data-theme", isLight ? "light" : "dark");
        } else {
          document.documentElement.setAttribute("data-theme", savedTheme);
        }
      }, 0);

      colorSchemeMedia = window.matchMedia("(prefers-color-scheme: light)");
      handleSystemThemeChange = (e: MediaQueryListEvent) => {
        const cur = localStorage.getItem("myplan_theme") || "system";
        if (cur === "system") {
          document.documentElement.setAttribute("data-theme", e.matches ? "light" : "dark");
        }
      };
      colorSchemeMedia.addEventListener("change", handleSystemThemeChange);

      const currentD = new Date().getDay();
      setTimeout(() => setTodayDayOfWeek(currentD === 0 ? 7 : currentD), 0);

      // Notifications are loaded from Supabase; never synthesize fake history in the browser.
      const notificationClient = createClient();
      const notificationReadId = new URLSearchParams(window.location.search).get("notification_read");
      if (notificationReadId) {
        void notificationClient.functions.invoke("notifications", { body: { action: "mark-read", id: notificationReadId, read: true } })
          .then(({ error }) => { if (error) console.warn("Could not mark push notification as read:", error); });
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete("notification_read");
        window.history.replaceState({}, "", cleanUrl.toString());
      }
      void notificationClient.functions.invoke("notifications", { body: { action: "list" } })
        .then(({ data, error }) => {
          if (error || !data) return;
          const payload = data as { notifications?: Array<{ id: string; category: string; title: string; message: string; created_at: string; scheduled_at?: string; read_at: string | null }> };
          const rows = (payload.notifications || [])
            .filter((row) => !row.scheduled_at || new Date(row.scheduled_at).getTime() <= Date.now())
            .flatMap((row) => toNotification(row) ?? []);
          setNotifications((prev) => {
            const byId = new Map(prev.map((item) => [item.id, item]));
            const serverIds = new Set(rows.map((item) => item.id));
            const merged = rows.map((item) => byId.get(item.id) ?? item);
            for (const item of prev) {
              if (!serverIds.has(item.id) && Date.now() - item.createdAt < 3 * 86400000) merged.push(item);
            }
            return merged.sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
          });
        })
        .catch((error) => console.warn("Notification history could not load:", error));

      if ("Notification" in window) {
        setTimeout(() => setPushPermission(Notification.permission), 0);
      }

      // Online / Offline synchronization listeners
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
      document.addEventListener("visibilitychange", handleVisibilityChange);
      if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", handleServiceWorkerMessage);

      setTimeout(() => {
        setIsOnline(navigator.onLine);
        setPendingSyncCount(readOutbox().length);
        void processOfflineQueue();
      }, 0);

      // High-performance PWA service worker registration
      if (typeof window !== "undefined" && "serviceWorker" in navigator && process.env.NODE_ENV === "production") {
        void navigator.serviceWorker.register("/sw.js").then(async (registration) => {
          // Service Worker support does not guarantee that the browser implements Web Push.
          // In particular, some WebKit-based browsers expose serviceWorker but no pushManager.
          if (!registration || !("pushManager" in registration) || !registration.pushManager) {
            setPushSubscribed(false);
            setPushChecked(true);
            return;
          }
          const subscription = await registration.pushManager.getSubscription();
          setPushSubscribed(Boolean(subscription));
          setPushChecked(true);
        }).catch((error) => {
          console.warn("Service worker registration failed:", error);
          setPushChecked(true);
        });
      } else {
        setTimeout(() => setPushChecked(true), 0);
      }
    }

    const activeTimers = counterTimersRef.current;
    const progressTimers = progressRefreshTimersRef.current;
    return () => {
      disposed = true;
      bootedUserRef.current = null;
      progressTimers.forEach(clearTimeout);
      progressTimers.clear();
      listener.subscription.unsubscribe();
      if (realtimeChannel) {
        void supabase.removeChannel(realtimeChannel);
      }
      activeRealtimeUid = null;
      Object.values(activeTimers).forEach(clearTimeout);
      if (typeof window !== "undefined") {
        window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
        window.removeEventListener("appinstalled", handleAppInstalled);
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        if ("serviceWorker" in navigator) navigator.serviceWorker.removeEventListener("message", handleServiceWorkerMessage);
        if (colorSchemeMedia && handleSystemThemeChange) {
          colorSchemeMedia.removeEventListener("change", handleSystemThemeChange);
        }
      }
    };
  }, [loadWorkspace, refreshHabits, router, processOfflineQueue, loadActiveDevices, updateTaskCounts]);

  const handleAddCustomTimeSlot = useCallback(() => {
    const trimmed = customTimeInput.trim();
    if (!trimmed) {
      setCustomTimeError(t.field_required || "Vaqt nomini kiriting");
      return;
    }
    const id = `custom_${Date.now()}`;
    const newSlot: CustomTimeSlot = { id, label: trimmed };
    setCustomTimeSlots((prev) => {
      const updated = [...prev, newSlot];
      if (typeof window !== "undefined") {
        if (userId) localStorage.setItem(accountStorageKey(userId, "custom_time_slots"), JSON.stringify(updated));
      }
      return updated;
    });
    setNewTimeOfDay(id);
    setCustomTimeInput("");
    setCustomTimeError("");
    setShowCustomTimeModal(false);
    triggerHaptic("medium");
  }, [customTimeInput, t.field_required, userId]);

  const handleDeleteCustomTimeSlot = useCallback((id: string) => {
    setCustomTimeSlots((prev) => {
      const updated = prev.filter((s) => s.id !== id);
      if (typeof window !== "undefined") {
        if (userId) localStorage.setItem(accountStorageKey(userId, "custom_time_slots"), JSON.stringify(updated));
      }
      return updated;
    });
    setNewTimeOfDay((prev) => (prev === id ? "anytime" : prev));
    setActiveTimeFilter((prev) => (prev === id ? "all" : prev));
  }, [userId]);

  const applyPlanForm = useCallback((draft: Partial<PlanDraft>) => {
    setCreateTaskKind(draft.kind ?? "check");
    setNewTitle(draft.title ?? "");
    setNewDescription(draft.description ?? "");
    setNewSchedule(draft.schedule ?? "daily");
    setCountTarget(draft.target ?? "");
    setCountUnit(draft.unit ?? "marta");
    setDurationPreset(draft.durationPreset ?? "unlimited");
    setCustomDurationValue(draft.customValue ?? "");
    setCustomDurationUnit(draft.customUnit ?? "kun");
    setSelectedWeekdays(draft.weekdays ?? [1, 2, 3, 4, 5, 6, 7]);
    setNewTimeOfDay(draft.timeOfDay ?? "anytime");
    setNewReminderTime(draft.reminder ?? "");
    setDebouncedDurationError("");
    setDebouncedCountError("");
    setMessage("");
  }, []);

  const readPlanDraft = useCallback((editingId: string | null): PlanDraft | null => {
    if (!userId) return null;
    const draft = readJson<PlanDraft>(accountStorageKey(userId, "plan_draft"));
    if (!draft || draft.editingId !== editingId || Date.now() - draft.savedAt > DRAFT_MAX_AGE_MS) return null;
    return draft;
  }, [userId]);

  // Tapping outside, Esc and the phone's back button only hide the form. The text waits for the person's return.
  const closeCreateModal = useCallback(() => {
    setShowCreateModal(false);
    setEditingActivity(null);
  }, []);

  // Cancel and a successful save are the only two things that clear what was typed.
  const discardPlanForm = useCallback(() => {
    if (userId) {
      try {
        localStorage.removeItem(accountStorageKey(userId, "plan_draft"));
      } catch {
        // Nothing stored, nothing to clear.
      }
    }
    applyPlanForm({});
    closeCreateModal();
  }, [userId, applyPlanForm, closeCreateModal]);

  const openCreateModal = useCallback(() => {
    setEditingActivity(null);
    const draft = readPlanDraft(null);
    if (draft) {
      applyPlanForm(draft);
    } else {
      // A new plan starts from how this person usually sets plans up.
      const learned = learnFormDefaults(activitiesRef.current);
      const unit = learned.unit ?? "marta";
      const target = learned.targetByUnit[unit];
      applyPlanForm({
        kind: learned.kind,
        unit,
        target: learned.kind === "count" && target ? String(target) : "",
        timeOfDay: learned.timeOfDay,
        weekdays: learned.weekdays,
        durationPreset: learned.durationPreset as DurationPreset | undefined,
      });
    }
    setShowCreateModal(true);
  }, [applyPlanForm, readPlanDraft]);

  const openEditModal = useCallback((act: Activity) => {
    const label = act.schedule_rule?.duration_label?.match(/^(\d+) (kun|hafta|oy|yil)$/);
    applyPlanForm({
      kind: act.measurement_type,
      title: act.title,
      description: act.description || "",
      schedule: act.schedule_type || "daily",
      target: act.target ? String(act.target) : "",
      unit: act.unit || "marta",
      durationPreset: (act.schedule_rule?.duration_preset as DurationPreset | undefined) ?? "unlimited",
      customValue: label?.[1] ?? "",
      customUnit: (label?.[2] as CustomDurationUnit | undefined) ?? "kun",
      weekdays: Array.isArray(act.schedule_rule?.weekdays) ? act.schedule_rule.weekdays : undefined,
      timeOfDay: act.time_of_day || "anytime",
      reminder: act.reminder_time ? act.reminder_time.slice(0, 5) : "",
      ...(readPlanDraft(act.id) ?? {}),
    });
    setEditingActivity(act);
    setShowCreateModal(true);
  }, [applyPlanForm, readPlanDraft]);

  // Every keystroke is saved, so a reload, a crash or the phone killing the app costs nothing.
  useEffect(() => {
    if (!showCreateModal || !userId) return;
    const hasContent = Boolean(newTitle.trim() || newDescription.trim() || countTarget);
    if (!hasContent) return;
    writeJson(accountStorageKey(userId, "plan_draft"), {
      editingId: editingActivity?.id ?? null,
      kind: createTaskKind,
      title: newTitle,
      description: newDescription,
      schedule: newSchedule,
      target: countTarget,
      unit: countUnit,
      durationPreset,
      customValue: customDurationValue,
      customUnit: customDurationUnit,
      weekdays: selectedWeekdays,
      timeOfDay: newTimeOfDay,
      reminder: newReminderTime,
      savedAt: Date.now(),
    } satisfies PlanDraft);
  }, [
    showCreateModal, userId, editingActivity, createTaskKind, newTitle, newDescription, newSchedule, countTarget,
    countUnit, durationPreset, customDurationValue, customDurationUnit, selectedWeekdays, newTimeOfDay, newReminderTime,
  ]);

  // The session resumes where it stopped: same tab, and the form still open if it was open.
  const sessionRestoredRef = useRef(false);
  useEffect(() => {
    if (!userId || sessionRestoredRef.current) return;
    sessionRestoredRef.current = true;
    const timer = setTimeout(() => {
      try {
        const tab = sessionStorage.getItem(TAB_STORAGE_KEY) as TabType | null;
        if (tab) setActiveTab(tab);
        if (sessionStorage.getItem(FORM_OPEN_STORAGE_KEY) === "1" && readPlanDraft(null)) openCreateModal();
      } catch {
        // sessionStorage unavailable: start on the default tab
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [userId, readPlanDraft, openCreateModal]);
  useEffect(() => {
    if (!sessionRestoredRef.current) return;
    try {
      sessionStorage.setItem(TAB_STORAGE_KEY, activeTab);
      sessionStorage.setItem(FORM_OPEN_STORAGE_KEY, showCreateModal && !editingActivity ? "1" : "0");
    } catch {
      // not persisted: acceptable
    }
  }, [activeTab, showCreateModal, editingActivity]);

  // Esc closes the top layer only, and never while a dropdown inside the form is the thing being closed.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || !showCreateModal || document.querySelector(".life-select-popover")) return;
      if (showCustomTimeModal) setShowCustomTimeModal(false);
      else closeCreateModal();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showCreateModal, showCustomTimeModal, closeCreateModal]);

  // The phone's back button/gesture closes the open layer instead of leaving the app.
  const anyOverlayOpen =
    showCreateModal || focusModalOpen || showInstallGuideModal || showCustomTimeModal || showEveningReview || showPresetModal;
  const overlayHistoryRef = useRef(false);
  useEffect(() => {
    if (anyOverlayOpen && !overlayHistoryRef.current) {
      overlayHistoryRef.current = true;
      window.history.pushState({ myplanOverlay: true }, "", window.location.href);
    } else if (!anyOverlayOpen && overlayHistoryRef.current) {
      overlayHistoryRef.current = false;
      window.history.back();
    }
  }, [anyOverlayOpen]);
  useEffect(() => {
    const handlePopState = () => {
      if (!overlayHistoryRef.current) return;
      overlayHistoryRef.current = false;
      if (showCustomTimeModal) setShowCustomTimeModal(false);
      else if (showPresetModal) setShowPresetModal(false);
      else if (showInstallGuideModal) setShowInstallGuideModal(false);
      else if (showEveningReview) setShowEveningReview(false);
      else if (focusModalOpen) setFocusModalOpen(false);
      else closeCreateModal();
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [showCustomTimeModal, showPresetModal, showInstallGuideModal, showEveningReview, focusModalOpen, closeCreateModal]);

  // The "turn notifications on" prompt wakes exactly when it may (re)appear. No interval: a timer that
  // set state every few seconds re-rendered this whole page for nothing.
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const stored = Number(sessionStorage.getItem("myplan_nag_snooze_until") || 0);
        if (stored > Date.now()) setNagSnoozedUntil(stored);
      } catch {
        // sessionStorage unavailable: snooze simply is not remembered across reloads
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setNagNow(Date.now()), Math.max(0, Math.max(nagSnoozedUntil, nagArmedAt) - Date.now()) + 30);
    return () => clearTimeout(timer);
  }, [nagSnoozedUntil, nagArmedAt]);
  // Let the app appear first; the prompt follows a moment after the workspace has loaded.
  useEffect(() => {
    if (!userId || !pushChecked || loadingData || nagArmedAt !== 0) return;
    const timer = setTimeout(() => setNagArmedAt(Date.now() + 2500), 0);
    return () => clearTimeout(timer);
  }, [userId, pushChecked, loadingData, nagArmedAt]);

  const pushNagMode: "ask" | "denied" | "ios-install" | "unsupported" | null = (() => {
    if (typeof window === "undefined" || anyOverlayOpen || !pushChecked || !userId || loadingData || nagNow === 0 || nagArmedAt === 0 || nagNow < nagArmedAt) return null;
    if (process.env.NODE_ENV !== "production") return null;
    if (pushSubscribed && pushPermission === "granted") return null;
    if (nagNow < nagSnoozedUntil) return null;
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const supported = "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
    if (!supported) return isIOS && !isAppInstalled ? "ios-install" : "unsupported";
    return pushPermission === "denied" ? "denied" : "ask";
  })();

  // Scroll lock background when any modal is open so modal scrolls freely
  useEffect(() => {
    const isModalActive =
      showCreateModal ||
      focusModalOpen ||
      showInstallGuideModal ||
      showCustomTimeModal ||
      showEveningReview;
    if (typeof document !== "undefined") {
      if (isModalActive) {
        document.body.style.overflow = "hidden";
        document.documentElement.style.overflow = "hidden";
      } else {
        document.body.style.overflow = "";
        document.documentElement.style.overflow = "";
      }
    }
    return () => {
      if (typeof document !== "undefined") {
        document.body.style.overflow = "";
        document.documentElement.style.overflow = "";
      }
    };
  }, [showCreateModal, focusModalOpen, showInstallGuideModal, showCustomTimeModal, showEveningReview]);

  // PWA Install handler with full fallback guide modal
  const handleInstallApp = async () => {
    const promptEvent =
      deferredPrompt ||
      (typeof window !== "undefined"
        ? (window as unknown as { __myplanInstallPrompt?: BeforeInstallPromptEvent }).__myplanInstallPrompt
        : null);

    if (promptEvent) {
      try {
        await promptEvent.prompt();
        await promptEvent.userChoice;
        // The app is considered installed only after the browser confirms via appinstalled.
        setDeferredPrompt(null);
        (window as unknown as { __myplanInstallPrompt?: BeforeInstallPromptEvent }).__myplanInstallPrompt = undefined;
        return;
      } catch (e) {
        console.warn("PWA prompt error:", e);
      }
    }
    // Browsers without the install-prompt API (notably iOS Safari) do not allow
    // websites to trigger installation programmatically. Explain the limitation;
    // Never show a manual shortcut workflow or pretend installation succeeded.
    setShowInstallGuideModal(true);
  };

  // Toggle complete for normal checklist tasks (Tab 1 ONLY)
  async function toggleComplete(activity: Activity) {
    if (!userId) return;
    const occ = occurrences.find((item) => item.activity_id === activity.id);
    if (!occ) return;

    const nextStatus = occ.status === "completed" ? "pending" : "completed";
    triggerHaptic(nextStatus === "completed" ? "success" : "medium");

    setOccurrences((curr) =>
      curr.map((item) => (item.id === occ.id ? { ...item, status: nextStatus } : item))
    );

    if (nextStatus === "completed" && soundEnabled) {
      playCompletionSound();
    }

    // Ticking a counter task fills it to the target; un-ticking resets it. The change must also reach the cloud
    // as a progress event, otherwise a reload or another device shows the old number next to the new status.
    let countCorrection: Record<string, unknown> | null = null;
    if (activity.measurement_type === "count" && activity.target) {
      const before = Math.min(taskCountsRef.current[occ.id] || 0, activity.target);
      const newCount = nextStatus === "completed" ? activity.target : 0;
      updateTaskCounts((prev) => ({ ...prev, [occ.id]: newCount }));
      setTaskHistory((prev) => ({ ...prev, [occ.id]: [] }));
      localStorage.setItem(`myplan_count_${occ.id}`, String(newCount));
      if (newCount !== before) {
        countCorrection = {
          id: newEventId(),
          user_id: userId,
          occurrence_id: occ.id,
          amount: roundAmount(newCount - before),
          note: nextStatus === "completed" ? "Belgilandi (to‘ldirildi)" : "Belgi olib tashlandi",
        };
      }
    }

    if (countCorrection) enqueueOfflineMutation({ type: "progress_event", payload: countCorrection });
    enqueueOfflineMutation({
      type: "occurrence_status",
      payload: { id: occ.id, user_id: userId, status: nextStatus },
    });

    if (nextStatus === "completed" && activity.measurement_type === "check") {
      // Ticks carry no timestamp on the server, so the usual time of check plans is learned on this device.
      const key = accountStorageKey(userId, "check_minutes");
      const minutes = readJson<Record<string, number[]>>(key) || {};
      const now = new Date();
      minutes[activity.id] = [...(minutes[activity.id] || []), now.getHours() * 60 + now.getMinutes()].slice(-14);
      writeJson(key, minutes);
    }
  }

  // Counter Increment (+1, +5, +10...) with 10-Second Inactivity Collapse Logic
  async function incrementTaskCount(activity: Activity, occurrence: Occurrence, amount: number) {
    if (!userId) return;
    const target = activity.target || 0;
    const current = Math.min(taskCountsRef.current[occurrence.id] || 0, target > 0 ? target : Infinity);
    const actualAdd = roundAmount(target > 0 ? Math.min(amount, Math.max(0, target - current)) : amount);
    if (actualAdd <= 0) return;

    const next = roundAmount(target > 0 ? Math.min(current + actualAdd, target) : current + actualAdd);

    // Reset collapsed state so hidden buttons retain their space
    setCollapsedCounters((prev) => ({ ...prev, [occurrence.id]: false }));

    // Reset 10-second inactivity timer for this occurrence
    if (counterTimersRef.current[occurrence.id]) {
      clearTimeout(counterTimersRef.current[occurrence.id]);
    }
    counterTimersRef.current[occurrence.id] = setTimeout(() => {
      // 10 seconds of inactivity elapsed with no screen interaction: smoothly collapse the empty space
      setCollapsedCounters((prev) => ({ ...prev, [occurrence.id]: true }));
    }, 10000);

    updateTaskCounts((prev) => ({ ...prev, [occurrence.id]: next }));
    setTaskHistory((prev) => ({
      ...prev,
      [occurrence.id]: [...(prev[occurrence.id] || []), actualAdd],
    }));

    if (typeof window !== "undefined") {
      localStorage.setItem(`myplan_count_${occurrence.id}`, String(next));
    }

    // Auto complete when target is reached
    const reachedTarget = next >= target && occurrence.status !== "completed";
    triggerHaptic(reachedTarget ? "success" : "light");

    if (reachedTarget) {
      setOccurrences((curr) =>
        curr.map((item) => (item.id === occurrence.id ? { ...item, status: "completed" } : item))
      );
      if (soundEnabled) {
        playCompletionSound();
      }
    } else {
      if (soundEnabled) {
        playIncrementSound(actualAdd);
      }
    }

    // Durable first, uploaded after. One stable id per tap makes every retry safe.
    enqueueOfflineMutation({
      type: "progress_event",
      payload: { id: newEventId(), user_id: userId, occurrence_id: occurrence.id, amount: actualAdd, note: `+${actualAdd}` },
    });
    if (reachedTarget) {
      enqueueOfflineMutation({
        type: "occurrence_status",
        payload: { id: occurrence.id, user_id: userId, status: "completed" },
      });
    }
  }

  // Counter Undo: restores previous step, clears 10-second timer and restores button positions immediately
  async function undoTaskCount(activity: Activity, occurrence: Occurrence) {
    if (!userId) return;
    const history = taskHistory[occurrence.id] || [];
    if (history.length === 0) return;

    triggerHaptic("warning");
    const lastAdd = history[history.length - 1];
    const newHistory = history.slice(0, -1);
    const target = activity.target || 0;
    const current = Math.min(taskCountsRef.current[occurrence.id] || 0, target > 0 ? target : Infinity);
    const next = roundAmount(Math.max(0, current - lastAdd));

    // Cancel 10s timer and un-collapse space immediately on undo
    if (counterTimersRef.current[occurrence.id]) {
      clearTimeout(counterTimersRef.current[occurrence.id]);
    }
    setCollapsedCounters((prev) => ({ ...prev, [occurrence.id]: false }));

    updateTaskCounts((prev) => ({ ...prev, [occurrence.id]: next }));
    setTaskHistory((prev) => ({ ...prev, [occurrence.id]: newHistory }));

    if (typeof window !== "undefined") {
      localStorage.setItem(`myplan_count_${occurrence.id}`, String(next));
    }

    const needsStatusRevert = next < (activity.target || 0) && occurrence.status === "completed";
    if (needsStatusRevert) {
      setOccurrences((curr) =>
        curr.map((item) => (item.id === occurrence.id ? { ...item, status: "pending" } : item))
      );
    }

    enqueueOfflineMutation({
      type: "progress_event",
      payload: { id: newEventId(), user_id: userId, occurrence_id: occurrence.id, amount: -lastAdd, note: `Qaytarish (-${lastAdd})` },
    });
    if (needsStatusRevert) {
      enqueueOfflineMutation({
        type: "occurrence_status",
        payload: { id: occurrence.id, user_id: userId, status: "pending" },
      });
    }
  }

  // Archive activity
  async function archiveActivity(id: string, newActiveState = false) {
    if (!userId) return;
    const previous = activitiesRef.current.find((item) => item.id === id)?.is_active;
    setActivities((curr) => curr.map((item) => (item.id === id ? { ...item, is_active: newActiveState } : item)));
    const supabase = createClient();
    const { error } = await supabase.from("activities").update({ is_active: newActiveState }).eq("id", id).eq("user_id", userId);
    if (error) {
      setActivities((curr) => curr.map((item) => (item.id === id && previous !== undefined ? { ...item, is_active: previous } : item)));
      setMessage(t.save_failed_kept);
      return;
    }
    void loadWorkspace(userId);
  }

  // Multi-Account Operations (Switch Account & Add Account, max 5)
  const switchAccount = async (targetAccount: UserAccount) => {
    if (!targetAccount.id || targetAccount.id === userId || typeof window === "undefined" || switchingAccount) return;

    setSwitchingAccount(true);
    await processOfflineQueue(); // this account's last taps go up before its session is replaced
    const supabase = createClient();
    // The vault keeps a real Supabase session per account (see account-sessions.ts),
    // so switching restores that account's own tokens: no password prompt, and no
    // private data is shown unless Supabase accepts the stored refresh token.
    const restored = await restoreAccountSession(supabase, targetAccount.id);
    if (restored === "ok") {
      localStorage.setItem("myplan_active_account_id", targetAccount.id);
      // Full reload so no state from the previous account survives.
      window.location.replace("/");
      return;
    }
    if (restored === "retry") {
      // Transient failure: keep the saved session and let the user try again instead of asking for a password.
      setSwitchingAccount(false);
      alert(t.switch_retry);
      return;
    }

    // No usable saved session (expired/revoked): ask for that account's password.
    localStorage.setItem("myplan_switch_account_id", targetAccount.id);
    localStorage.setItem("myplan_add_account_intent", "true");
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) {
      localStorage.removeItem("myplan_switch_account_id");
      localStorage.removeItem("myplan_add_account_intent");
      console.error("Could not end the current account session:", error.message);
      setSwitchingAccount(false);
      return;
    }
    window.location.replace("/login");
  };

  const handleAddAccount = () => {
    if (savedAccounts.length >= 5) {
      alert("Maksimal 5 ta hisob chegarasiga yetildi.");
      return;
    }
    if (typeof window !== "undefined") {
      localStorage.setItem("myplan_add_account_intent", "true");
      try { sessionStorage.setItem("myplan_add_account_fresh", "1"); } catch { /* the form simply behaves as freshly opened */ }
    }
    // Immediate feedback: the login route can take a moment to arrive, so never leave the page looking frozen.
    setOverlayText(t.please_wait);
    setSwitchingAccount(true);
    router.push("/login");
  };

  // Sign out (Switches to another connected account if present, or logs out to /login)
  async function handleSignOut() {
    try {
      await processOfflineQueue();
      if (typeof window !== "undefined") {
        const rawVault = localStorage.getItem("myplan_accounts_vault");
        const vault: UserAccount[] = rawVault ? JSON.parse(rawVault) : [];
        const remaining = vault.filter((acc) => acc.id !== userId);
        localStorage.setItem("myplan_accounts_vault", JSON.stringify(remaining));
        setSavedAccounts(remaining);
        if (userId) removeAccountSession(userId);
        pruneAccountSessions(remaining.map((acc) => acc.id));

        if (remaining.length > 0) {
          const supabase = createClient();
          // Revoke the leaving account on the server first, then move on to the next one.
          const { data: current } = await supabase.auth.getSession();
          if (current.session) await revokeSessionToken(current.session.access_token);
          const nextAcc = remaining[0];
          await switchAccount({ ...nextAcc, id: nextAcc.id });
          return;
        }
      }

      setOverlayText(t.please_wait);
      setSwitchingAccount(true);
      const supabase = createClient();
      await supabase.auth.signOut();
      if (typeof window !== "undefined") {
        localStorage.removeItem("myplan_active_account_id");
      }
      setUserId(null);
      router.replace("/login");
    } catch (err) {
      console.error("Sign out error:", err);
    }
  }

  // Notification helpers
  const markNotificationAsRead = (id: string) => {
    setNotifications((current) => current.map((item) => item.id === id ? { ...item, isRead: true } : item));
    void createClient().functions.invoke("notifications", { body: { action: "mark-read", id, read: true } })
      .then(({ error }) => {
        if (!error) return;
        console.warn("Could not sync notification read state:", error);
        setNotifications((current) => current.map((item) => item.id === id ? { ...item, isRead: false } : item));
      })
      .catch((error) => {
        console.warn("Could not sync notification read state:", error);
        setNotifications((current) => current.map((item) => item.id === id ? { ...item, isRead: false } : item));
      });
    if (activeToast?.id === id) setActiveToast(null);
  };

  const pushErrorText = (error: { kind: PushErrorKind; detail: string }) =>
    error.kind === "dismissed" ? t.nag_err_dismissed
    : error.kind === "service" ? t.nag_err_service
    : error.kind === "timeout" ? t.nag_err_timeout
    : error.kind === "server" ? t.nag_err_server
    : `${t.nag_err_generic}${error.detail ? ` (${error.detail})` : ""}`;

  // Settings toggle: turns push off when this device is subscribed, otherwise runs the same enabling flow as the prompt.
  const handleRequestPush = async () => {
    if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      alert(t.nag_body_unsupported);
      return;
    }
    if (!window.isSecureContext) {
      alert("Push bildirishnomalari HTTPS orqali ishlaydi.");
      return;
    }
    if (pushBusy) return;
    setPushBusy(true);
    try {
      if (pushSubscribed) {
        const registration = await withTimeout(navigator.serviceWorker.ready, 10_000, "push-timeout");
        const existing = await registration.pushManager.getSubscription();
        if (existing) {
          const supabase = createClient();
          const { error } = await supabase.functions.invoke("notification-subscribe", { body: { action: "unsubscribe", endpoint: existing.endpoint } });
          if (error) throw new Error("notification-subscribe: obunani serverdan bekor qilib bo‘lmadi.");
          if (!(await existing.unsubscribe())) throw new Error("Brauzer obunasini bekor qilib bo‘lmadi.");
        }
        setPushSubscribed(false);
        return;
      }
      // Success shows a real OS notification, so no extra alert is needed.
      if (!(await enablePushForThisDevice(false)) && Notification.permission === "default") {
        alert(t.nag_err_dismissed);
      }
    } catch (error) {
      console.error("Push toggle failed:", error);
      alert(pushErrorText(classifyPushError(error)));
    } finally {
      setPushBusy(false);
    }
  };

  // Subscribe-only (never toggles off). `silent` = never open the browser permission dialog.
  // Also heals the server copy of the subscription and takes the device over when another
  // account on the same browser still owns the push endpoint.
  const enablePushForThisDevice = useCallback(async (silent = false): Promise<boolean> => {
    if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window) || !window.isSecureContext) return false;
    // Ask for permission FIRST, synchronously inside the click: Safari and Firefox drop the request
    // if anything is awaited before it (the user gesture is gone by then).
    let permission = Notification.permission;
    if (permission === "default" && !silent) permission = await Notification.requestPermission();
    setPushPermission(permission);
    if (permission === "default" && !silent) throw new Error("push-permission-dismissed");
    if (permission !== "granted") return false;
    // `navigator.serviceWorker.ready` never settles when no worker was registered, so register explicitly and cap the wait.
    const existing = await navigator.serviceWorker.getRegistration();
    const registrationPromise = existing?.active ? Promise.resolve(existing) : navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready);
    const registration = await withTimeout(registrationPromise, 10_000, "push-timeout");
    if (!registration.pushManager) return false;
    const supabase = createClient();
    const subscribeFresh = async () => {
      const { data: keyData, error: keyError } = await supabase.functions.invoke("notification-public-key", { body: {} });
      if (keyError || !keyData?.publicKey) throw new Error("notification-public-key: push kaliti serverda sozlanmagan.");
      return withTimeout(
        registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array((keyData as { publicKey: string }).publicKey) }),
        20_000,
        "push-service-timeout",
      );
    };
    let subscription = (await registration.pushManager.getSubscription()) ?? (await subscribeFresh());
    let { error } = await supabase.functions.invoke("notification-subscribe", { body: { ...subscription.toJSON(), userAgent: navigator.userAgent } });
    if (error && (error as { context?: Response }).context?.status === 409) {
      await subscription.unsubscribe().catch(() => false);
      subscription = await subscribeFresh();
      ({ error } = await supabase.functions.invoke("notification-subscribe", { body: { ...subscription.toJSON(), userAgent: navigator.userAgent } }));
    }
    if (error) {
      await subscription.unsubscribe().catch(() => false);
      throw error;
    }
    setPushSubscribed(true);
    if (!silent) {
      // Prove the whole chain works on this device: show a real OS notification right away.
      void registration.showNotification("MYplan", {
        body: t.nag_enabled_body,
        icon: "/pwa-192.png",
        badge: "/pwa-192.png",
        tag: "myplan-enabled",
      }).catch(() => undefined);
    }
    return true;
  }, [t.nag_enabled_body]);

  // Warm the login route so "add account" / sign-out navigate instantly.
  useEffect(() => {
    if (userId) router.prefetch("/login");
  }, [userId, router]);

  // Web standard: follow the browser's own notification permission (Permissions API). A grant made once, in the
  // browser or its site settings, is picked up live and remembered by the browser: the page never needs to ask again.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return;
    let status: PermissionStatus | null = null;
    let disposed = false;
    const apply = () => {
      if (status) setPushPermission(status.state === "prompt" ? "default" : (status.state as NotificationPermission));
    };
    navigator.permissions.query({ name: "notifications" as PermissionName }).then((result) => {
      if (disposed) return;
      status = result;
      apply();
      result.addEventListener("change", apply);
    }).catch(() => undefined);
    return () => {
      disposed = true;
      status?.removeEventListener("change", apply);
    };
  }, []);

  // Keep this device registered for the signed-in account: runs silently once per account while permission is granted.
  useEffect(() => {
    if (!userId || !pushChecked || process.env.NODE_ENV !== "production") return;
    if (pushPermission !== "granted") return;
    if (pushSyncedUserRef.current === userId) return;
    pushSyncedUserRef.current = userId;
    void enablePushForThisDevice(true).catch((error) => console.warn("Push re-sync failed:", error));
  }, [userId, pushChecked, pushPermission, enablePushForThisDevice]);

  const snoozeNag = () => {
    const until = Date.now() + 60_000;
    setNagSnoozedUntil(until);
    try {
      sessionStorage.setItem("myplan_nag_snooze_until", String(until));
    } catch {
      // not persisted: acceptable
    }
  };

  const handleNagEnable = async () => {
    if (pushBusy) return;
    setPushBusy(true);
    setNagError(null);
    try {
      const ok = await enablePushForThisDevice(false);
      // `false` here means permission was blocked: the dialog switches to the "blocked" instructions by itself.
      if (!ok && typeof Notification !== "undefined" && Notification.permission !== "denied") {
        setNagError({ kind: "generic", detail: "" });
      }
    } catch (error) {
      console.error("Push enable failed:", error);
      setNagError(classifyPushError(error));
    } finally {
      setPushBusy(false);
    }
  };

  const unreadNotifsCount = notifications.filter((n) => !n.isRead).length;

  // Avatar upload
  const handleAvatarChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setMessage("Rasm hajmi 2MB dan oshmasligi lozim.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (uploadEvent) => {
      const dataUrl = uploadEvent.target?.result as string;
      if (dataUrl) {
        setAvatarUrl(dataUrl);
        if (userId) {
          localStorage.setItem(`myplan_avatar_${userId}`, dataUrl);
          const supabase = createClient();
          void supabase.auth.updateUser({
            data: { avatar_url: dataUrl },
          });
          void supabase.from("profiles").update({ avatar_url: dataUrl }).eq("id", userId);
        }
      }
    };
    reader.readAsDataURL(file);
  };

  // Hafta kunlarini tanlash/o'chirish
  const toggleWeekday = (dayId: number) => {
    setSelectedWeekdays((prev) => {
      if (prev.includes(dayId)) {
        if (prev.length === 1) return prev; // kamida 1 kun bo'lishi kerak
        return prev.filter((d) => d !== dayId);
      } else {
        return [...prev, dayId].sort((a, b) => a - b);
      }
    });
  };

  // Sanoqli qadamlar (+10, +5, +1, +15...) boshqaruvi
  const handleAddCounterStep = () => {
    setNewStepError("");
    if (counterSteps.length >= 10) {
      setNewStepError("Maksimal 10 ta hisoblash qadami kiritish mumkin (limitga yetildi).");
      return;
    }
    const trimmed = newStepInput.trim();
    if (!trimmed) {
      setNewStepError("Iltimos, qadam miqdorini kiriting.");
      return;
    }
    const val = parseInt(trimmed, 10);
    if (isNaN(val) || val < 1 || val > 99) {
      setNewStepError("Qadam miqdori 1 dan 99 gacha bo‘lishi lozim.");
      return;
    }
    if (counterSteps.includes(val)) {
      setNewStepError(`Ushbu qadam (+${val}) allaqachon mavjud! Boshqa qiymat kiriting.`);
      return;
    }
    const updated = [...counterSteps, val].sort((a, b) => b - a);
    setCounterSteps(updated);
    localStorage.setItem("myplan_counter_steps", JSON.stringify(updated));
    setNewStepInput("");
    if (userId) {
      const supabase = createClient();
      void supabase.from("profiles").update({ counter_steps: updated }).eq("id", userId);
    }
  };

  const handleRemoveCounterStep = (stepToRemove: number) => {
    if (counterSteps.length <= 1) {
      setNewStepError("Kamida bitta hisoblash qadami qolishi shart.");
      return;
    }
    const updated = counterSteps.filter((s) => s !== stepToRemove);
    setCounterSteps(updated);
    localStorage.setItem("myplan_counter_steps", JSON.stringify(updated));
    setNewStepError("");
    if (userId) {
      const supabase = createClient();
      void supabase.from("profiles").update({ counter_steps: updated }).eq("id", userId);
    }
  };

  const handleResetCounterSteps = () => {
    const defaults = [10, 5, 1];
    setCounterSteps(defaults);
    localStorage.setItem("myplan_counter_steps", JSON.stringify(defaults));
    setNewStepError("");
    if (userId) {
      const supabase = createClient();
      void supabase.from("profiles").update({ counter_steps: defaults }).eq("id", userId);
    }
  };

  // Pocket Touch Gestures (Swipe to Complete & Quick Actions)
  const handleTouchStart = (taskId: string, e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) {
      touchStartRef.current = null;
      return;
    }
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    setSwipeState({ id: taskId, offset: 0, action: null });
  };

  const handleTouchMove = (taskId: string, e: React.TouchEvent) => {
    if (!touchStartRef.current || swipeState.id !== taskId) return;
    const touch = e.touches[0];
    const diffX = touch.clientX - touchStartRef.current.x;
    const diffY = touch.clientY - touchStartRef.current.y;

    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 12) {
      const clamped = Math.max(-90, Math.min(90, diffX));
      const action = clamped > SWIPE_ACTION_THRESHOLD ? "complete" : clamped < -SWIPE_ACTION_THRESHOLD ? "undo" : null;
      setSwipeState({ id: taskId, offset: clamped, action });
    }
  };

  const handleTouchEnd = (activity: Activity, occ: Occurrence | undefined) => {
    if (swipeState.id === activity.id && occ) {
      if (swipeState.action === "complete") {
        // Swiping right only completes; un-completing needs the checkbox or a left swipe.
        if (occ.status !== "completed") void toggleComplete(activity);
      } else if (swipeState.action === "undo" && activity.measurement_type === "count") {
        void undoTaskCount(activity, occ);
      }
    }
    setSwipeState({ id: null, offset: 0, action: null });
    touchStartRef.current = null;
  };

  const handleTouchCancel = () => {
    setSwipeState({ id: null, offset: 0, action: null });
    touchStartRef.current = null;
  };

  // Double-tapping a counter card adds the step this person actually uses most.
  const handleCardDoubleTap = (activity: Activity, occ: Occurrence | undefined) => {
    if (activity.measurement_type !== "count" || !occ || occ.status === "completed") return;
    const fallback = isMinuteUnit(activity.unit) ? 1 : counterSteps.length > 0 ? Math.min(...counterSteps) : 1;
    const step = habits.favoriteStep[activity.id] ?? fallback;
    void incrementTaskCount(activity, occ, step);
  };

  // Create new activity
  async function createActivity(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!userId || !newTitle.trim() || busy) return;

    let targetValue: number | null = null;
    let unitValue = "";

    if (createTaskKind === "count") {
      const parsed = parseInt(countTarget, 10);
      if (isNaN(parsed) || parsed === 0 || parsed === 1) {
        setMessage("Sanoqli vazifalar uchun minimal miqdor 2 ta. Bir martalik ishlar uchun «Bir martalik» turini tanlang.");
        return;
      }
      if (parsed > 99999) {
        setMessage("Maksimal belgilanishi mumkin bo‘lgan sanoq 99,999 tani tashkil etadi.");
        return;
      }
      targetValue = parsed;
      unitValue = countUnit.trim() || "marta";
    }

    let durationDays: number | null = null;
    let durationLabel: string = t.preset_unlimited;

    if (durationPreset === "custom") {
      const val = parseInt(customDurationValue, 10) || 1;
      durationLabel = `${val} ${customDurationUnit}`;
      if (customDurationUnit === "kun") durationDays = val;
      else if (customDurationUnit === "hafta") durationDays = val * 7;
      else if (customDurationUnit === "oy") durationDays = val * 30;
      else if (customDurationUnit === "yil") durationDays = val * 365;
    } else if (durationPreset === "unlimited") {
      durationDays = null;
      durationLabel = t.preset_unlimited;
    } else {
      const matched = durationPresets.find((p) => p.id === durationPreset);
      if (matched && matched.days !== null) {
        durationDays = matched.days;
        durationLabel = matched.label;
      }
    }

    // Fixing a typo must not push the deadline forward: an unchanged duration keeps its original end date.
    const keepsDeadline = editingActivity && (editingActivity.schedule_rule?.duration_label ?? null) === durationLabel;
    let endsOnStr: string | null = keepsDeadline ? editingActivity.ends_on ?? null : null;
    if (durationDays !== null && !keepsDeadline) {
      const startDate = new Date();
      const endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + durationDays);
      endsOnStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;
    }

    setBusy(true);
    setMessage("");
    try {
      const supabase = createClient();
      if (editingActivity) {
        const { error } = await supabase
          .from("activities")
          .update({
            title: newTitle.trim(),
            description: newDescription.trim(),
            schedule_type: newSchedule,
            time_of_day: newTimeOfDay,
            ...(editingActivity.reminder_time !== undefined || newReminderTime ? { reminder_time: /^\d{2}:\d{2}$/.test(newReminderTime) ? newReminderTime : null } : {}),
            schedule_rule: {
              ...(editingActivity.schedule_rule || {}),
              duration_label: durationLabel,
              duration_days: durationDays,
              duration_preset: durationPreset,
              weekdays: selectedWeekdays,
            },
            measurement_type: editingActivity.measurement_type,
            target: targetValue,
            unit: unitValue,
            ends_on: endsOnStr,
          })
          .eq("id", editingActivity.id)
          .eq("user_id", userId);
        if (error) throw error;
      } else {
        const { data: created, error } = await supabase.from("activities").insert({
          user_id: userId,
          title: newTitle.trim(),
          description: newDescription.trim(),
          schedule_type: newSchedule,
          time_of_day: newTimeOfDay,
          ...(/^\d{2}:\d{2}$/.test(newReminderTime) ? { reminder_time: newReminderTime } : {}),
          schedule_rule: {
            duration_label: durationLabel,
            duration_days: durationDays,
            duration_preset: durationPreset,
            weekdays: selectedWeekdays,
          },
          measurement_type: createTaskKind,
          target: targetValue,
          unit: unitValue,
          starts_on: today(),
          ends_on: endsOnStr,
        }).select().single();
        if (error) throw error;
        // Visible at once; its row for today follows from the quiet refresh below.
        if (created) {
          const row = created as Activity;
          setActivities((prev) => (prev.some((a) => a.id === row.id) ? prev : [row, ...prev]));
        }
      }

      discardPlanForm();
      void loadWorkspace(userId);
    } catch (err) {
      // The form stays open with everything still in it.
      console.warn("Plan could not be saved:", err);
      setMessage(t.save_failed_kept);
    } finally {
      setBusy(false);
    }
  }

  async function importPreset(preset: Preset) {
    if (!userId || importingPresetId) return;
    setImportingPresetId(preset.id);
    setMessage("");
    try {
      const supabase = createClient();
      const rows = preset.items.map((item) => ({
        user_id: userId,
        title: item.title[language],
        description: item.description?.[language] ?? "",
        schedule_type: "daily",
        time_of_day: item.timeOfDay,
        reminder_time: item.reminderTime ?? null,
        schedule_rule: {
          duration_label: t.preset_unlimited,
          duration_days: null,
          duration_preset: "unlimited",
          weekdays: item.weekdays ?? ALL_WEEKDAYS,
          preset_id: preset.id,
        },
        measurement_type: item.kind,
        target: item.kind === "count" ? item.target ?? null : null,
        unit: item.kind === "count" ? item.unit?.[language] ?? "" : "",
        starts_on: today(),
        ends_on: null,
      }));
      const { error } = await supabase.from("activities").insert(rows);
      if (error) throw error;
      setShowPresetModal(false);
      void loadWorkspace(userId);
      setMessage(`${t.preset_import_success}: ${preset.name[language]}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t.preset_import_error);
    } finally {
      setImportingPresetId(null);
    }
  }

  // Theme change
  const handleThemeChange = (newTheme: "dark" | "light" | "system") => {
    setTheme(newTheme);
    localStorage.setItem("myplan_theme", newTheme);
    if (newTheme === "system") {
      const isLight = window.matchMedia("(prefers-color-scheme: light)").matches;
      document.documentElement.setAttribute("data-theme", isLight ? "light" : "dark");
    } else {
      document.documentElement.setAttribute("data-theme", newTheme);
    }
  };

  // Language change
  const handleLanguageChange = (newLang: Language) => {
    setLanguage(newLang);
    localStorage.setItem("myplan_lang", newLang);
    setFormattedToday(formatLongDate(newLang));

    if (userId) {
      const supabase = createClient();
      void supabase.from("profiles").update({ language: newLang }).eq("id", userId);
    }
  };

  // Sound toggle
  const handleSoundToggle = (enabled: boolean) => {
    setSoundEnabled(enabled);
    localStorage.setItem("myplan_sound_enabled", String(enabled));
    if (userId) {
      const supabase = createClient();
      void supabase.from("profiles").update({ sound_enabled: enabled }).eq("id", userId);
    }
  };

  // Notifications toggle
  const handleNotificationsToggle = (enabled: boolean) => {
    setNotificationsEnabled(enabled);
    localStorage.setItem("myplan_notifications_enabled", String(enabled));
    if (userId) {
      const supabase = createClient();
      void supabase.from("profiles").update({ notifications_enabled: enabled }).eq("id", userId);
    }
  };

  // Calculations for Today's Execution (only tasks scheduled for today's weekday)
  const activeActivities = useMemo(() => {
    return activities.filter((a) => {
      if (!a.is_active) return false;
      const w = a.schedule_rule?.weekdays;
      if (w && Array.isArray(w) && w.length > 0) {
        return w.includes(todayDayOfWeek);
      }
      return true;
    });
  }, [activities, todayDayOfWeek]);
  const completedCount = useMemo(
    () => occurrences.filter((item) => item.status === "completed").length,
    [occurrences]
  );
  const percent = activeActivities.length
    ? Math.round(
        (activeActivities.reduce((total, activity) => {
          const occurrence = occurrences.find((item) => item.activity_id === activity.id);
          if (!occurrence) return total;
          if (activity.measurement_type === "count" && activity.target && activity.target > 0) {
            const count = taskCounts[occurrence.id] ?? (occurrence.status === "completed" ? activity.target : 0);
            return total + Math.min(Math.max(count, 0) / activity.target, 1);
          }
          return total + (occurrence.status === "completed" ? 1 : 0);
        }, 0) / activeActivities.length) * 100
      )
    : 0;

  const timeCounts = useMemo(() => {
    return {
      all: activeActivities.length,
      morning: activeActivities.filter((a) => a.time_of_day === "morning").length,
      afternoon: activeActivities.filter((a) => a.time_of_day === "afternoon").length,
      evening: activeActivities.filter((a) => a.time_of_day === "evening").length,
    };
  }, [activeActivities]);

  const displayedActivities = useMemo(() => {
    const ordered = orderByHabit(activeActivities, habits.usualMinute);
    if (activeTimeFilter === "all") return ordered;
    return ordered.filter((a) => a.time_of_day === activeTimeFilter);
  }, [activeActivities, activeTimeFilter, habits]);

  // Streak Verification: When all today's plans are completed, strengthen the chain!
  useEffect(() => {
    if (!userId || activeActivities.length === 0 || percent < 100) return;
    const todayStr = today();
    const storedDate = typeof window !== "undefined" ? localStorage.getItem(`myplan_last_streak_date_${userId}`) : null;
    if (storedDate === todayStr) return;

    const newStreak = streakCount + 1;
    const newBest = Math.max(bestStreak, newStreak);

    const timer = setTimeout(() => {
      setStreakCount(newStreak);
      setBestStreak(newBest);
      enqueueOfflineMutation({
        type: "update_streak",
        payload: { user_id: userId, streak_count: newStreak, best_streak: newBest, last_active_date: todayStr },
        // One warm word for finishing the whole day. A push after every single tick was just noise.
        notify: {
          category: "streak",
          dedupeKey: `day-complete:${todayStr}`,
          context: { event: "day_completed", streak: newStreak },
          url: "/",
        },
      });
    }, 0);

    if (typeof window !== "undefined") {
      localStorage.setItem(`myplan_last_streak_date_${userId}`, todayStr);
    }
    triggerHaptic("success");

    return () => clearTimeout(timer);
  }, [userId, percent, activeActivities.length, streakCount, bestStreak, enqueueOfflineMutation]);

  // Filtered Activities for Management Catalog (Tab 2)
  const filteredCatalogActivities = useMemo(() => {
    return activities.filter((act) => {
      if (catalogFilter === "active" && !act.is_active) return false;
      if (catalogFilter === "archived" && act.is_active) return false;
      if (catalogSearch.trim()) {
        const query = catalogSearch.toLowerCase();
        const matchesTitle = act.title.toLowerCase().includes(query);
        const matchesDesc = act.description?.toLowerCase().includes(query) ?? false;
        return matchesTitle || matchesDesc;
      }
      return true;
    });
  }, [activities, catalogFilter, catalogSearch]);

  // Exact time windows have priority; all-day tasks are fallback only.
  const recommendedFocusActivity = useMemo(() => {
    if (focusClockMinute === null) return null;
    const doneIds = new Set(occurrences.filter((item) => item.status === "completed").map((item) => item.activity_id));
    const pending = activeActivities.filter((activity) => !doneIds.has(activity.id));
    return (
      pickHabitualNow(pending, habits.usualMinute, focusClockMinute) ??
      getRecommendedFocusActivity(activeActivities, occurrences, customTimeSlots, focusClockMinute)
    );
  }, [activeActivities, occurrences, customTimeSlots, focusClockMinute, habits]);

  // Discipline Momentum Index (Consistency rolling calculation)
  const momentumScore = useMemo(() => {
    if (activeActivities.length === 0) return 100;
    const dailyRatio = percent;
    const streakBonus = Math.min(streakCount * 5, 25);
    return Math.min(100, Math.max(35, Math.round(dailyRatio * 0.75 + streakBonus)));
  }, [activeActivities.length, percent, streakCount]);

  // Executive Keyboard Shortcuts (N: New, F: Focus, 1-5: Tabs, Esc: Close)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = (target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) {
        if (e.key === "Escape") {
          target?.blur();
        }
        return;
      }

      if (e.key === "Escape") {
        // The plan form has its own Esc handling, which keeps sub-dialogs and typed text safe.
        if (showCreateModal) return;
        setFocusModalOpen(false);
        setShowInstallGuideModal(false);
        setShowEveningReview(false);
      } else if (anyOverlayOpen) {
        // A stray letter or digit must never reset or leave the dialog in front of the person.
        return;
      } else if ((e.key === "n" || e.key === "N") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        openCreateModal();
      } else if ((e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (recommendedFocusActivity) {
          e.preventDefault();
          startFocusSession(recommendedFocusActivity);
        }
      } else if (e.key >= "1" && e.key <= "5" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tabs: TabType[] = ["today", "activities", "notifications", "analytics", "profile"];
        const chosen = tabs[Number(e.key) - 1];
        if (chosen) {
          e.preventDefault();
          setActiveTab(chosen);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openCreateModal, startFocusSession, recommendedFocusActivity, anyOverlayOpen, showCreateModal]);

  // Focus Modal Active Details
  const focusOcc = useMemo(() => {
    if (!focusActivity) return null;
    return occurrences.find((o) => o.activity_id === focusActivity.id) || null;
  }, [focusActivity, occurrences]);

  const focusTarget = focusActivity?.target || 0;
  const focusRawCount = taskCounts[focusOcc?.id || ""] ?? (focusOcc?.status === "completed" ? focusTarget : 0);
  const focusCurrent = focusTarget > 0 ? Math.min(Math.max(0, focusRawCount), focusTarget) : Math.max(0, focusRawCount);
  const isFocusDone = focusOcc?.status === "completed" || (focusTarget > 0 && focusCurrent >= focusTarget);

  const focusMins = Math.floor(focusTimerSeconds / 60);
  const focusSecs = focusTimerSeconds % 60;
  const focusTimeFormatted = `${focusMins.toString().padStart(2, "0")}:${focusSecs.toString().padStart(2, "0")}`;
  const focusTimerProgress = focusTimerInitial > 0 ? focusTimerSeconds / focusTimerInitial : 0;
  const focusCircleRadius = 100;
  const focusCircumference = 2 * Math.PI * focusCircleRadius;
  const focusStrokeDashoffset = focusCircumference * (1 - focusTimerProgress);

  const isCustomDurationInvalid =
    durationPreset === "custom" &&
    (!customDurationValue.trim() ||
      isNaN(parseInt(customDurationValue, 10)) ||
      (customDurationUnit === "kun" &&
        (parseInt(customDurationValue, 10) < 2 || parseInt(customDurationValue, 10) > 120)) ||
      (customDurationUnit === "hafta" &&
        (parseInt(customDurationValue, 10) < 1 || parseInt(customDurationValue, 10) > 9)) ||
      (customDurationUnit === "oy" &&
        (parseInt(customDurationValue, 10) < 1 || parseInt(customDurationValue, 10) > 9)) ||
      (customDurationUnit === "yil" &&
        (parseInt(customDurationValue, 10) < 1 || parseInt(customDurationValue, 10) > 3)));

  const parsedTargetNum = parseInt(countTarget, 10);
  const isTargetInvalid = createTaskKind === "count" && (isNaN(parsedTargetNum) || parsedTargetNum < 2 || parsedTargetNum > 99999);
  const isSaveDisabled =
    busy ||
    !newTitle.trim() ||
    selectedWeekdays.length === 0 ||
    isTargetInvalid ||
    Boolean(debouncedCountError) ||
    isCustomDurationInvalid ||
    Boolean(debouncedDurationError);

  // Splash Screen: 100% Guaranteed Preload & Display before fade-out
  if (!authReady || !splashReady) {
    return (
      <main className={`loading-screen ${splashFading ? "is-fading-out" : ""}`} aria-busy="true" aria-label="MyPlan">
        <div className="loading-card">
          <Image
            className="loading-logo"
            src="/myplan-logo-192.png" unoptimized
            alt="MyPlan"
            width={96}
            height={96}
            priority
          />
        </div>
      </main>
    );
  }

  if (!userId) {
    return null; // Redirecting to /login
  }

  return (
    <div className={`app-layout ${sidebarOpen ? "sidebar-expanded" : "sidebar-collapsed"}`}>
      {/* Floating In-App Realtime Toast */}
      {activeToast && !showCreateModal && (() => {
        const locToast = getLocalizedNotification(activeToast, t);
        return (
          <aside className="floating-inapp-toast" role="alert" aria-live="polite">
            <div className="toast-left-wrap">
              <span className="toast-icon-badge">
                <IconBell className="icon-xs" />
              </span>
              <div className="toast-text-block">
                <span className="toast-title">{locToast.title}</span>
                <p className="toast-msg">{locToast.message}</p>
              </div>
            </div>
            <button
              type="button"
              className="toast-close-action"
              onClick={() => setActiveToast(null)}
              aria-label={t.focus_close || "Close"}
            >
              <IconClose className="icon-xs" />
            </button>
          </aside>
        );
      })()}
      {/* EXECUTIVE ZEN FOCUS MODE MODAL */}
      {focusModalOpen && focusActivity && (
        <div
          className="floating-modal-backdrop focus-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setFocusModalOpen(false);
              setIsFocusTimerRunning(false);
            }
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="floating-modal-box focus-modal-box">
            <div className="modal-header">
              <div>
                <span className="modal-badge">
                  <IconZap className="icon-xs" /> {t.focus_mode_title}
                </span>
                <h3 className="modal-title">{focusActivity.title}</h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => {
                  setFocusModalOpen(false);
                  setIsFocusTimerRunning(false);
                }}
                aria-label={t.focus_close}
              >
                <IconClose className="icon-sm" />
              </button>
            </div>

            <div className="focus-modal-content">
              <p className="focus-modal-desc">
                {focusActivity.description || t.focus_mode_sub}
              </p>

              {/* Duration Mode Switcher */}
              {focusActivity.measurement_type !== "count" && (
                <div className="focus-mode-switcher">
                  <button
                    type="button"
                    className={`focus-mode-chip ${focusModeType === "sprint" ? "active" : ""}`}
                    onClick={() => handleSelectFocusDuration(300, "sprint")}
                  >
                    {t.focus_sprint_5m}
                  </button>
                  <button
                    type="button"
                    className={`focus-mode-chip ${focusModeType === "deep" ? "active" : ""}`}
                    onClick={() => handleSelectFocusDuration(900, "deep")}
                  >
                    {t.focus_deep_15m}
                  </button>
                  <button
                    type="button"
                    className={`focus-mode-chip ${focusModeType === "pomodoro" ? "active" : ""}`}
                    onClick={() => handleSelectFocusDuration(1500, "pomodoro")}
                  >
                    {t.focus_pomodoro_25m}
                  </button>
                </div>
              )}

              {/* Main Focus Ring or Count Hub */}
              {focusActivity.measurement_type === "count" ? (
                <div className="focus-counter-hub">
                  <div className="focus-rep-display">
                    <span className="focus-rep-current">{formatCount(focusCurrent, focusActivity.unit, timeLabels)}</span>
                    <span className="focus-rep-sep">/</span>
                    <span className="focus-rep-target">{focusTarget}</span>
                    <span className="focus-rep-unit">{formatUnit(focusActivity.unit)}</span>
                  </div>

                  <div className="focus-counter-actions">
                    {focusOcc && (
                      <button
                        type="button"
                        className="btn-focus-big-tap"
                        disabled={isFocusDone}
                        onClick={() => {
                          if (focusOcc) void incrementTaskCount(focusActivity, focusOcc, 1);
                        }}
                      >
                        {formatStep(1, focusActivity.unit, timeLabels)}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="focus-ring-container">
                  <svg className="focus-svg-ring" width="240" height="240" viewBox="0 0 240 240">
                    <circle
                      className="focus-ring-bg"
                      cx="120"
                      cy="120"
                      r={focusCircleRadius}
                      strokeWidth="8"
                    />
                    <circle
                      className="focus-ring-progress"
                      cx="120"
                      cy="120"
                      r={focusCircleRadius}
                      strokeWidth="8"
                      strokeDasharray={focusCircumference}
                      strokeDashoffset={focusStrokeDashoffset}
                    />
                  </svg>
                  <div className="focus-timer-text-overlay">
                    <span className="focus-digital-timer">{focusTimeFormatted}</span>
                    <div className="focus-timer-controls">
                      <button
                        type="button"
                        className="btn-focus-ctrl primary"
                        onClick={() => {
                          setIsFocusTimerRunning((r) => !r);
                          triggerHaptic("medium");
                        }}
                      >
                        {isFocusTimerRunning ? (
                          <>
                            <IconPause className="icon-xs" />
                            <span>{t.focus_pause}</span>
                          </>
                        ) : (
                          <>
                            <IconPlay className="icon-xs" />
                            <span>{t.focus_resume}</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        className="btn-focus-ctrl secondary"
                        onClick={() => {
                          setFocusTimerSeconds(focusTimerInitial);
                          setIsFocusTimerRunning(false);
                          triggerHaptic("light");
                        }}
                      >
                        {t.focus_reset}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {focusCelebration && (
                <div className="focus-celebration-toast">
                  <IconAward className="icon-sm text-lime" />
                  <span>{t.focus_done_celebration}</span>
                </div>
              )}
            </div>

            <div className="focus-modal-footer">
              <button
                type="button"
                className="btn-complete-focus-session"
                onClick={() => void completeFocusSession()}
              >
                <IconCheck className="icon-sm" />
                <span>{t.focus_complete_btn}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Modal for Task Creation & Editing (Popup Dialog) */}
      {showCreateModal && (
        <div
          className="floating-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              closeCreateModal();
            }
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
        >
          <div className="floating-modal-box">
            <div className="modal-header">
              <div>
                <span className="modal-badge">
                  {editingActivity ? <IconEdit className="icon-xs" /> : <IconPlus className="icon-xs" />} {editingActivity ? t.edit_activity_kicker : t.modal_kicker}
                </span>
                <h3 id="modal-title">{editingActivity ? t.edit_activity_title : t.modal_title}</h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={closeCreateModal}
                aria-label={t.btn_cancel}
                title={`${t.btn_cancel} (Esc)`}
              >
                <IconClose className="icon-sm" />
              </button>
            </div>

            {/* 2 Tabs: Bir martalik vs Sanoqli — ONLY show when creating new task. In edit mode, hidden */}
            {!editingActivity && (
              <div className="modal-tab-switch" role="tablist" aria-label={t.modal_title}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={createTaskKind === "check"}
                  className={`modal-tab-btn ${createTaskKind === "check" ? "active" : ""}`}
                  onClick={() => setCreateTaskKind("check")}
                >
                  <IconCheck className="icon-sm" />
                  <span>{t.tab_single}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={createTaskKind === "count"}
                  className={`modal-tab-btn ${createTaskKind === "count" ? "active" : ""}`}
                  onClick={() => {
                    setCreateTaskKind("count");
                    if (!countTarget) {
                      const remembered = learnFormDefaults(activitiesRef.current).targetByUnit[countUnit];
                      if (remembered) setCountTarget(String(remembered));
                    }
                  }}
                >
                  <IconHash className="icon-sm" />
                  <span>{t.tab_countable}</span>
                </button>
              </div>
            )}

            <form className="modal-form" onSubmit={createActivity}>
              <div className="modal-form-scrollable">
                <div className="form-group">
                <label htmlFor="modal-task-title">{t.label_task_name}</label>
                <input
                  id="modal-task-title"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder={
                    createTaskKind === "check"
                      ? t.placeholder_task_single
                      : t.placeholder_task_count
                  }
                  maxLength={160}
                  required
                  autoFocus
                />
              </div>

              {/* Sanoqli tab input */}
              {createTaskKind === "count" && (
                <div className="form-group count-target-group">
                  <label htmlFor="count-target">{t.label_target_count}</label>
                  <div className="count-input-row">
                    <input
                      id="count-target"
                      type="text"
                      inputMode="numeric"
                      value={countTarget}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, "").slice(0, 5);
                        setCountTarget(val);
                      }}
                      placeholder={t.placeholder_count}
                      maxLength={5}
                      required
                    />
                    <LifeSelect
                      className="count-unit-select"
                      value={countUnit}
                      onChange={(unit) => {
                        setCountUnit(unit);
                        if (!countTarget) {
                          const remembered = learnFormDefaults(activitiesRef.current).targetByUnit[unit];
                          if (remembered) setCountTarget(String(remembered));
                        }
                      }}
                      ariaLabel={t.label_target_count}
                      options={[
                        { value: "marta", label: t.unit_marta, group: t.group_fitness_health, detail: "Mashq, odat va kundalik takrorlar", icon: <IconRepeat className="life-select-svg-icon" /> },
                        { value: "set", label: t.unit_set, group: t.group_fitness_health, detail: "Kuch mashqlari va trening setlari", icon: <IconDumbbell className="life-select-svg-icon" /> },
                        { value: "qadam", label: t.unit_qadam, group: t.group_fitness_health, detail: "Yurish va kunlik faollik", icon: <IconFootprints className="life-select-svg-icon" /> },
                        { value: "km", label: t.unit_km, group: t.group_fitness_health, detail: "Yugurish, yurish va masofa", icon: <IconMapPin className="life-select-svg-icon" /> },
                        { value: "stakan", label: t.unit_stakan, group: t.group_fitness_health, detail: "Suv ichish odati", icon: <IconGlassWater className="life-select-svg-icon" /> },
                        { value: "litr", label: t.unit_litr, group: t.group_fitness_health, detail: "Suyuqlik miqdori", icon: <IconDroplet className="life-select-svg-icon" /> },
                        { value: "kkal", label: t.unit_kkal, group: t.group_fitness_health, detail: "Energiya va ovqatlanish", icon: <IconFlame className="life-select-svg-icon" /> },
                        { value: "bet", label: t.unit_bet, group: t.group_study_mind, detail: "Kitob o'qish va mutolaa", icon: <IconBookOpen className="life-select-svg-icon" /> },
                        { value: "bob", label: t.unit_bob, group: t.group_study_mind, detail: "Kitob yoki kurs bo'limlari", icon: <IconLibrary className="life-select-svg-icon" /> },
                        { value: "dars", label: t.unit_dars, group: t.group_study_mind, detail: "Dars va o'quv mashg'ulotlari", icon: <IconGraduationCap className="life-select-svg-icon" /> },
                        { value: "soz", label: t.unit_soz, group: t.group_study_mind, detail: "Til o'rganish va lug'at", icon: <IconMessageCircle className="life-select-svg-icon" /> },
                        { value: "daqiqa", label: t.unit_daqiqa, group: t.group_time_focus, detail: "Diqqat va odat uchun vaqt", icon: <IconTimer className="life-select-svg-icon" /> },
                        { value: "soat", label: t.unit_soat, group: t.group_time_focus, detail: "Uzoq mashg'ulotlar", icon: <IconClock className="life-select-svg-icon" /> },
                        { value: "pomodoro", label: t.unit_pomodoro, group: t.group_time_focus, detail: "Fokus sessiyalari", icon: <IconTimer className="life-select-svg-icon" /> },
                        { value: "ta", label: t.unit_ta, group: t.group_time_focus, detail: "Vazifa va yakunlangan ishlar", icon: <IconCheckCircle className="life-select-svg-icon" /> },
                        { value: "rakat", label: t.unit_rakat, group: t.group_spiritual, detail: "Ibodat va namoz", icon: <IconMoon className="life-select-svg-icon" /> },
                        { value: "oyat", label: t.unit_oyat, group: t.group_spiritual, detail: "Qur'on mutolaasi", icon: <IconBookOpen className="life-select-svg-icon" /> },
                        { value: "tasbeh", label: t.unit_tasbeh, group: t.group_spiritual, detail: "Zikr va tasbeh", icon: <IconCircleDot className="life-select-svg-icon" /> },
                      ] satisfies LifeSelectOption[]}
                    />
                  </div>

                  {debouncedCountError && (
                    <p className="count-validation-error" role="alert">
                      <IconAlertTriangle className="icon-xs inline-icon" /> {debouncedCountError}
                    </p>
                  )}
                </div>
              )}

              <div className="form-group">
                <label htmlFor="modal-task-desc">{t.label_notes}</label>
                <input
                  id="modal-task-desc"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder={t.placeholder_notes}
                  maxLength={250}
                />
              </div>

              {/* Kunning vaqt zonasi (Time of Day) */}
              <div className="form-group time-of-day-picker-group">
                <div className="field-label-row">
                  <span>{t.label_time_of_day}</span>
                </div>
                <div className="time-of-day-grid" role="radiogroup" aria-label={t.label_time_of_day}>
                  <button
                    type="button"
                    className={`time-choice-btn ${newTimeOfDay === "morning" ? "active" : ""}`}
                    onClick={() => {
                      triggerHaptic("light");
                      setNewTimeOfDay("morning");
                    }}
                  >
                    <IconSunrise className="icon-xs" />
                    <span>{t.time_opt_morning}</span>
                  </button>
                  <button
                    type="button"
                    className={`time-choice-btn ${newTimeOfDay === "afternoon" ? "active" : ""}`}
                    onClick={() => {
                      triggerHaptic("light");
                      setNewTimeOfDay("afternoon");
                    }}
                  >
                    <IconSun className="icon-xs" />
                    <span>{t.time_opt_afternoon}</span>
                  </button>
                  <button
                    type="button"
                    className={`time-choice-btn ${newTimeOfDay === "evening" ? "active" : ""}`}
                    onClick={() => {
                      triggerHaptic("light");
                      setNewTimeOfDay("evening");
                    }}
                  >
                    <IconMoon className="icon-xs" />
                    <span>{t.time_opt_evening}</span>
                  </button>
                  <button
                    type="button"
                    className={`time-choice-btn ${newTimeOfDay === "anytime" ? "active" : ""}`}
                    onClick={() => {
                      triggerHaptic("light");
                      setNewTimeOfDay("anytime");
                    }}
                  >
                    <IconCalendar className="icon-xs" />
                    <span>{t.time_opt_anytime}</span>
                  </button>

                  {/* Foydalanuvchi yaratgan custom vaqt zonalari */}
                  {customTimeSlots.map((slot) => (
                    <div key={slot.id} className="custom-slot-chip-wrap">
                      <button
                        type="button"
                        className={`time-choice-btn custom-time-choice ${newTimeOfDay === slot.id ? "active" : ""}`}
                        onClick={() => {
                          triggerHaptic("light");
                          setNewTimeOfDay(slot.id);
                        }}
                        title={slot.label}
                      >
                        <IconClock className="icon-xs" />
                        <span className="truncate">{slot.label}</span>
                      </button>
                      <button
                        type="button"
                        className="custom-slot-del-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (typeof window !== "undefined" && window.confirm(t.time_custom_delete_confirm)) {
                            handleDeleteCustomTimeSlot(slot.id);
                          }
                        }}
                        title={t.btn_delete || "O‘chirish"}
                        aria-label={t.btn_delete || "O‘chirish"}
                      >
                        <IconClose className="icon-xs" />
                      </button>
                    </div>
                  ))}

                  {/* + Custom tugmasi (eng oxirida) */}
                  <button
                    type="button"
                    className="time-choice-btn add-custom-time-btn"
                    onClick={() => {
                      triggerHaptic("light");
                      setShowCustomTimeModal(true);
                    }}
                    title={t.time_opt_custom}
                  >
                    <IconPlus className="icon-xs" />
                    <span>{t.time_opt_custom}</span>
                  </button>
                </div>
              </div>

              {/* Eslatma vaqti (Reminder time) */}
              <div className="form-group reminder-time-group">
                <label htmlFor="modal-task-reminder" className="field-label-row">
                  <span>{t.label_reminder_time}</span>
                </label>
                <div className="custom-duration-input-row">
                  <input
                    id="modal-task-reminder"
                    type="time"
                    value={newReminderTime}
                    onChange={(e) => setNewReminderTime(e.target.value)}
                  />
                  {newReminderTime && (
                    <button type="button" className="time-choice-btn" onClick={() => setNewReminderTime("")}>
                      <span>{t.btn_clear_reminder}</span>
                    </button>
                  )}
                  {!newReminderTime && editingActivity && habits.usualMinute[editingActivity.id] !== undefined && (
                    <button
                      type="button"
                      className="time-choice-btn"
                      onClick={() => setNewReminderTime(formatMinute(habits.usualMinute[editingActivity.id]))}
                    >
                      <IconClock className="icon-xs" />
                      <span>{t.habit_usual_time} {formatMinute(habits.usualMinute[editingActivity.id])}</span>
                    </button>
                  )}
                </div>
                <small>{t.hint_reminder_time}</small>
              </div>

              {/* Muddat (Davomiylik) Tanlovi */}
              <div className="form-group duration-picker-group">
                <label className="field-label-row">
                  <span>{t.label_duration}</span>
                </label>

                <div className="duration-presets-grid" role="radiogroup" aria-label={t.label_duration}>
                  {durationPresets.map((preset) => {
                    const isSelected = durationPreset === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        className={`duration-preset-btn ${isSelected ? "active" : ""}`}
                        onClick={() => {
                          setDurationPreset(preset.id);
                          if (preset.id !== "custom") {
                            setDebouncedDurationError("");
                          }
                        }}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>

                {/* Sozlash (Custom Duration) */}
                {durationPreset === "custom" && (
                  <div className="custom-duration-container">
                    <label htmlFor="custom-duration-input" className="custom-duration-label">
                      {t.custom_duration_title}
                    </label>
                    <div className="custom-duration-input-row">
                      <input
                        id="custom-duration-input"
                        type="text"
                        inputMode="numeric"
                        value={customDurationValue}
                        onChange={(e) => {
                          let val = e.target.value.replace(/\D/g, "");
                          if (customDurationUnit === "kun") {
                            val = val.slice(0, 3);
                          } else if (customDurationUnit === "hafta" || customDurationUnit === "oy") {
                            val = val.replace(/[^1-9]/g, "").slice(0, 1);
                          } else if (customDurationUnit === "yil") {
                            val = val.replace(/[^1-3]/g, "").slice(0, 1);
                          }
                          setCustomDurationValue(val);
                        }}
                        placeholder="30"
                        maxLength={customDurationUnit === "kun" ? 3 : 1}
                        required
                        autoFocus
                      />

                      <LifeSelect
                        className="custom-duration-unit-select"
                        value={customDurationUnit}
                        onChange={(value) => {
                          const newUnit = value as CustomDurationUnit;
                          setCustomDurationUnit(newUnit);
                          if (newUnit === "hafta" || newUnit === "oy") {
                            setCustomDurationValue((prev) => prev.replace(/[^1-9]/g, "").slice(0, 1));
                          } else if (newUnit === "yil") {
                            setCustomDurationValue((prev) => prev.replace(/[^1-3]/g, "").slice(0, 1));
                          }
                        }}
                        ariaLabel={t.label_duration}
                        options={[
                          { value: "kun", label: t.unit_day, detail: "Qisqa muddatli reja", icon: <IconSun className="life-select-svg-icon" /> },
                          { value: "hafta", label: t.unit_week, detail: "Bir necha haftalik maqsad", icon: <IconCalendar className="life-select-svg-icon" /> },
                          { value: "oy", label: t.unit_month, detail: "Oylik odat va marafon", icon: <IconCalendarDays className="life-select-svg-icon" /> },
                          { value: "yil", label: t.unit_year, detail: "Uzoq muddatli maqsad", icon: <IconFlag className="life-select-svg-icon" /> },
                        ] satisfies LifeSelectOption[]}
                      />
                    </div>

                    {debouncedDurationError && (
                      <p className="duration-validation-error" role="alert">
                        <IconAlertTriangle className="icon-xs inline-icon" /> {debouncedDurationError}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Hafta kunlari */}
              <div className="form-group weekdays-picker-group">
                <div className="field-label-row">
                  <span>{t.label_weekdays}</span>
                </div>

                <div className="weekdays-presets-row">
                  <button
                    type="button"
                    className={`weekday-preset-chip ${selectedWeekdays.length === 7 ? "active" : ""}`}
                    onClick={() => setSelectedWeekdays([1, 2, 3, 4, 5, 6, 7])}
                  >
                    {t.chip_everyday}
                  </button>
                  <button
                    type="button"
                    className={`weekday-preset-chip ${
                      selectedWeekdays.length === 5 && selectedWeekdays.every((d) => d <= 5) ? "active" : ""
                    }`}
                    onClick={() => setSelectedWeekdays([1, 2, 3, 4, 5])}
                  >
                    {t.chip_workdays}
                  </button>
                  <button
                    type="button"
                    className={`weekday-preset-chip ${
                      selectedWeekdays.length === 2 &&
                      selectedWeekdays.includes(6) &&
                      selectedWeekdays.includes(7)
                        ? "active"
                        : ""
                    }`}
                    onClick={() => setSelectedWeekdays([6, 7])}
                  >
                    {t.chip_weekends}
                  </button>
                </div>

                <div className="weekdays-scroll-wrapper">
                  <div className="weekdays-scroll-container" role="group" aria-label={t.label_weekdays}>
                    {weekdaysList.map((day) => {
                      const isSelected = selectedWeekdays.includes(day.id);
                      return (
                        <button
                          key={day.id}
                          type="button"
                          className={`weekday-card ${isSelected ? "active" : ""}`}
                          onClick={() => toggleWeekday(day.id)}
                          aria-pressed={isSelected}
                          title={`${day.full} ${isSelected ? `(${t.status_planned})` : `(${t.status_rest})`}`}
                        >
                          <span className="weekday-card-short">{day.short}</span>
                          <span className="weekday-card-full">{day.full}</span>
                          <span className="weekday-card-status">
                            {isSelected ? t.status_planned : t.status_rest}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {selectedWeekdays.length === 0 && (
                  <p className="count-validation-error" role="alert">
                    <IconAlertTriangle className="icon-xs inline-icon" /> {t.error_min_weekday}
                  </p>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="modal-schedule">{t.label_recurrence}</label>
                <LifeSelect
                  id="modal-schedule"
                  className="schedule-select"
                  value={newSchedule}
                  onChange={(value) => setNewSchedule(value as "daily" | "once")}
                  ariaLabel={t.label_recurrence}
                  options={[
                    { value: "daily", label: t.opt_repeat_daily, detail: "Har kuni bajariladigan odat", icon: <IconRepeat className="life-select-svg-icon" /> },
                    { value: "once", label: t.opt_one_time, detail: "Bir marta bajariladigan vazifa", icon: <IconPin className="life-select-svg-icon" /> },
                  ]}
                />
              </div>
            </div>

            {message && (
              <p className="count-validation-error" role="alert">
                <IconAlertTriangle className="icon-xs inline-icon" /> {message}
              </p>
            )}

            <div className="modal-actions">
                <button
                  type="button"
                  className="btn-modal-cancel"
                  onClick={discardPlanForm}
                >
                  {t.btn_cancel}
                </button>
                <button
                  type="submit"
                  className="btn-modal-submit"
                  disabled={isSaveDisabled}
                >
                  {busy ? t.btn_saving : editingActivity ? t.btn_save_changes : t.btn_save_activity}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Custom Time Slot Dialog */}
      {showCustomTimeModal && (
        <div
          className="floating-modal-backdrop sub-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowCustomTimeModal(false);
              setCustomTimeInput("");
              setCustomTimeError("");
            }
          }}
        >
          <div className="floating-modal-box custom-time-dialog-box" role="dialog" aria-modal="true" aria-labelledby="custom-time-title">
            <div className="modal-header">
              <div>
                <span className="modal-badge">
                  <IconClock className="icon-xs" /> {t.time_opt_custom}
                </span>
                <h3 id="custom-time-title">{t.custom_time_modal_title}</h3>
                <p className="page-subtitle" style={{ marginTop: 4 }}>
                  {t.custom_time_modal_sub}
                </p>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => {
                  setShowCustomTimeModal(false);
                  setCustomTimeInput("");
                  setCustomTimeError("");
                }}
                aria-label={t.btn_cancel}
              >
                <IconClose className="icon-sm" />
              </button>
            </div>

            <div className="modal-form">
              <div className="form-group">
                <label htmlFor="custom-time-name-input">{t.custom_time_modal_title}</label>
                <input
                  id="custom-time-name-input"
                  value={customTimeInput}
                  onChange={(e) => {
                    setCustomTimeInput(e.target.value);
                    if (customTimeError) setCustomTimeError("");
                  }}
                  placeholder={t.custom_time_input_placeholder}
                  maxLength={50}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddCustomTimeSlot();
                    }
                  }}
                />
                {customTimeError && (
                  <p className="count-validation-error" role="alert">
                    <IconAlertTriangle className="icon-xs inline-icon" /> {customTimeError}
                  </p>
                )}
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-modal-cancel"
                  onClick={() => {
                    setShowCustomTimeModal(false);
                    setCustomTimeInput("");
                    setCustomTimeError("");
                  }}
                >
                  {t.btn_cancel}
                </button>
                <button
                  type="button"
                  className="btn-modal-submit"
                  onClick={handleAddCustomTimeSlot}
                  disabled={!customTimeInput.trim()}
                >
                  <IconPlus className="icon-xs" />
                  <span>{t.custom_time_modal_add}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Preset Import Modal */}
      {showPresetModal && (
        <div
          className="floating-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget && !importingPresetId) setShowPresetModal(false);
          }}
        >
          <div className="floating-modal-box" role="dialog" aria-modal="true" aria-labelledby="preset-modal-title">
            <div className="modal-header">
              <div>
                <span className="modal-badge">
                  <IconLibrary className="icon-xs" /> {t.preset_btn}
                </span>
                <h3 id="preset-modal-title">{t.preset_modal_title}</h3>
                <p className="page-subtitle" style={{ marginTop: 4 }}>{t.preset_modal_sub}</p>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowPresetModal(false)}
                disabled={!!importingPresetId}
                aria-label={t.btn_cancel}
              >
                <IconClose className="icon-sm" />
              </button>
            </div>

            <div className="install-guide-list">
              {PRESETS.map((preset) => (
                <div key={preset.id} className="install-guide-item">
                  <div className="install-guide-info" style={{ flex: 1 }}>
                    <h4>
                      {preset.name[language]} · {preset.items.length} {t.preset_items_count}
                    </h4>
                    <p>{preset.description[language]}</p>
                    <p style={{ opacity: 0.7 }}>{preset.items.map((i) => i.title[language]).join(" · ")}</p>
                  </div>
                  <button
                    type="button"
                    className="btn-primary-action"
                    disabled={!!importingPresetId}
                    onClick={() => void importPreset(preset)}
                  >
                    {importingPresetId === preset.id ? t.preset_importing : t.preset_import}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* PWA Install Guide Modal */}
      {switchingAccount && (
        <div className="switching-overlay" role="status" aria-live="polite">
          <Image className="loading-logo" src="/myplan-logo-192.png" unoptimized alt="MyPlan" width={72} height={72} priority />
          <span className="switching-spinner" aria-hidden="true" />
          <p>{overlayText || t.switching_account}</p>
        </div>
      )}

      {pushNagMode && (
        // A small card in the corner: it never dims, blocks or locks the page behind it.
        <aside className="push-nag-card" role="status" aria-live="polite" aria-labelledby="push-nag-title">
          <div className="push-nag-head">
            <span className="push-nag-bell"><IconBell className="icon-sm" /></span>
            <h3 id="push-nag-title">{t.nag_title}</h3>
          </div>
          <p id="push-nag-body" className="push-nag-body">
            {pushNagMode === "ask" ? t.nag_body_ask : pushNagMode === "denied" ? t.nag_body_denied : pushNagMode === "ios-install" ? t.nag_body_ios : t.nag_body_unsupported}
          </p>
          {nagError && <p className="push-nag-error" role="alert">{pushErrorText(nagError)}</p>}
          <div className="push-nag-actions">
            {pushNagMode === "ask" && (
              <button type="button" className="btn-modal-submit" disabled={pushBusy} onClick={() => void handleNagEnable()}>
                {pushBusy ? t.nag_enabling : nagError ? t.nag_retry : t.nag_btn_enable}
              </button>
            )}
            {pushNagMode === "ios-install" && (
              <button type="button" className="btn-modal-submit" onClick={() => void handleInstallApp()}>
                {t.btn_install_app}
              </button>
            )}
            <button type="button" className="btn-modal-cancel" onClick={snoozeNag}>
              {t.nag_btn_later}
            </button>
          </div>
        </aside>
      )}

      {showInstallGuideModal && (
        <div
          className="floating-modal-backdrop sub-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowInstallGuideModal(false);
          }}
        >
          <div className="floating-modal-box install-guide-modal-box" role="dialog" aria-modal="true" aria-labelledby="pwa-guide-title">
            <div className="modal-header">
              <div>
                <span className="modal-badge">
                  <IconDownload className="icon-xs" /> PWA
                </span>
                <h3 id="pwa-guide-title">{t.setting_pwa_title}</h3>
                <p className="page-subtitle" style={{ marginTop: 4 }}>
                  {t.setting_pwa_sub}
                </p>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowInstallGuideModal(false)}
                aria-label={t.btn_cancel}
              >
                <IconClose className="icon-sm" />
              </button>
            </div>

            <div className="install-guide-list">
              <div className="install-guide-item">
                <div className="install-guide-icon">
                  <IconSmartphone className="icon-md" />
                </div>
                <div className="install-guide-info">
                  <h4>{t.install_chrome_title}</h4>
                  <p>{t.install_chrome_desc}</p>
                </div>
              </div>

              <div className="install-guide-item">
                <div className="install-guide-icon">
                  <IconTablet className="icon-md" />
                </div>
                <div className="install-guide-info">
                  <h4>{t.install_safari_title}</h4>
                  <p>{t.install_safari_desc}</p>
                </div>
              </div>

              <div className="install-guide-item">
                <div className="install-guide-icon">
                  <IconLaptop className="icon-md" />
                </div>
                <div className="install-guide-info">
                  <h4>{t.install_desktop_title}</h4>
                  <p>{t.install_desktop_desc}</p>
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-modal-submit w-full"
                onClick={() => setShowInstallGuideModal(false)}
              >
                {t.btn_got_it}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Kechki xulosa (Evening Review Modal) */}
      {showEveningReview && (
        <div
          className="floating-modal-backdrop"
          onClick={() => setShowEveningReview(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="evening-review-title"
        >
          <div
            className="floating-modal-box evening-review-modal-box"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="modal-badge">
                  <IconMoon className="icon-xs" /> {t.evening_modal_badge}
                </span>
                <h3 id="evening-review-title">{t.evening_modal_title}</h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowEveningReview(false)}
                aria-label={t.btn_cancel}
              >
                <IconClose className="icon-xs" />
              </button>
            </div>

            <div className="evening-review-body">
              <div className="evening-banner-visual">
                <div className={`streak-flame-icon-wrap large ${streakCount > 0 ? "active-fire" : ""}`}>
                  <IconFlame className="icon-fire" />
                </div>
                <div className="evening-banner-text">
                  <h4>{percent === 100 ? t.evening_banner_100 : `${percent}% ${t.completed}`}</h4>
                  <p>
                    {percent === 100
                      ? t.evening_banner_sub_100
                      : percent >= 70
                      ? t.evening_banner_sub_70
                      : t.evening_banner_sub_low}
                  </p>
                </div>
              </div>

              <div className="evening-stats-grid">
                <div className="evening-stat-item">
                  <span className="stat-sub">{t.stat_total_plans}</span>
                  <span className="stat-num">{activeActivities.length}</span>
                </div>
                <div className="evening-stat-item highlight">
                  <span className="stat-sub">{t.stat_completed}</span>
                  <span className="stat-num">{completedCount}</span>
                </div>
                <div className="evening-stat-item">
                  <span className="stat-sub">{t.left}</span>
                  <span className="stat-num">{Math.max(activeActivities.length - completedCount, 0)}</span>
                </div>
                <div className="evening-stat-item flame">
                  <span className="stat-sub">{t.streak_label}</span>
                  <span className="stat-num">{streakCount} {t.streak_days}</span>
                </div>
              </div>

              <div className="evening-quote-card">
                <IconSparkles className="icon-xs" />
                <span>
                  &ldquo;{t.footer_tagline}&rdquo;
                </span>
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-modal-submit w-full"
                onClick={() => {
                  triggerHaptic("success");
                  setShowEveningReview(false);
                  setMessage(t.evening_toast);
                }}
              >
                {t.evening_modal_btn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Drawer Backdrop */}
      {mobileMenuOpen && (
        <div
          className="mobile-backdrop"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar (Desktop Leftbar + Mobile Drawer) */}
      <aside
        className={`app-sidebar ${mobileMenuOpen ? "mobile-open" : ""}`}
        onClick={(e) => {
          const target = e.target as HTMLElement | null;
          if (target?.closest("button, a, input, [role='button']")) {
            return;
          }
          if (!sidebarOpen && typeof window !== "undefined" && window.innerWidth > 768) {
            setSidebarOpen(true);
          }
        }}
        title={!sidebarOpen ? "Sidebarni ochish uchun bosing" : undefined}
        aria-label="Asosiy navigatsiya"
      >
        {/* Sidebar Header: Logo & Toggle */}
        <div className="sidebar-header">
          {sidebarOpen ? (
            <>
              <button
                type="button"
                className="sidebar-brand-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveTab("today");
                  setMobileMenuOpen(false);
                }}
                aria-label="Bosh sahifa"
              >
                <Image className="brand-logo" src="/myplan-logo-192.png" unoptimized alt="MyPlan" width={34} height={34} priority />
                <span className="brand-title">
                  <span className="brand-my">My</span><span className="brand-plan">Plan</span>
                </span>
              </button>
              <button
                type="button"
                className="sidebar-collapse-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setSidebarOpen(false);
                }}
                aria-label="Sidebarni ixchamlash"
                title="Sidebarni ixchamlash"
              >
                <IconChevronLeft className="icon-sm" />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="sidebar-collapsed-logo-trigger"
              onClick={(e) => {
                e.stopPropagation();
                setSidebarOpen(true);
              }}
              aria-label="Sidebarni ochish"
              title="Sidebarni ochish"
            >
              <Image className="brand-logo" src="/myplan-logo-192.png" unoptimized alt="MyPlan" width={36} height={36} priority />
              <span className="collapsed-open-hint" aria-hidden="true">
                <IconChevronRight className="icon-sm" />
              </span>
            </button>
          )}

          {/* Mobile close button */}
          <button
            type="button"
            className="mobile-close-btn"
            onClick={(e) => {
              e.stopPropagation();
              setMobileMenuOpen(false);
            }}
            aria-label="Menyuni yopish"
          >
            <IconClose className="icon-sm" />
          </button>
        </div>

        {/* Action Button: Closed da +, Opened da + Vazifa */}
        <div className="sidebar-action-wrap">
          <button
            type="button"
            className="sidebar-add-task-btn"
            onClick={(e) => {
              e.stopPropagation();
              openCreateModal();
              setMobileMenuOpen(false);
            }}
            aria-label={t.btn_new_plan}
            title={t.btn_new_plan}
          >
            <IconPlus className="icon-sm" />
            <span className="btn-add-text">{t.btn_new_plan}</span>
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="sidebar-nav-group">
          <span className="nav-caption">{t.workspace_caption}</span>
          <nav className="nav-links">
            <button
              type="button"
              className={`nav-item ${activeTab === "today" ? "active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setActiveTab("today");
                setMobileMenuOpen(false);
              }}
            >
              <IconCalendar className="nav-icon" />
              <span className="nav-label">{t.tab_today}</span>
              {activeTab === "today" && <span className="active-indicator" />}
            </button>

            <button
              type="button"
              className={`nav-item ${activeTab === "activities" ? "active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setActiveTab("activities");
                setMobileMenuOpen(false);
              }}
            >
              <IconList className="nav-icon" />
              <span className="nav-label">{t.tab_activities}</span>
              {activeTab === "activities" && <span className="active-indicator" />}
            </button>

            <button
              type="button"
              className={`nav-item ${activeTab === "notifications" ? "active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setActiveTab("notifications");
                setMobileMenuOpen(false);
              }}
            >
              <IconBell className="nav-icon" />
              <span className="nav-label">{t.tab_notifications}</span>
              {unreadNotifsCount > 0 && <span className="nav-unread-pill">{unreadNotifsCount}</span>}
              {activeTab === "notifications" && unreadNotifsCount === 0 && <span className="active-indicator" />}
            </button>

            <button
              type="button"
              className={`nav-item ${activeTab === "analytics" ? "active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setActiveTab("analytics");
                setMobileMenuOpen(false);
              }}
            >
              <IconBarChart className="nav-icon" />
              <span className="nav-label">{t.tab_analytics}</span>
              {activeTab === "analytics" && <span className="active-indicator" />}
            </button>

            <button
              type="button"
              className={`nav-item ${activeTab === "time" ? "active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setActiveTab("time");
                setMobileMenuOpen(false);
              }}
            >
              <IconClock className="nav-icon" />
              <span className="nav-label">{t.tab_time}</span>
              {activeTab === "time" && <span className="active-indicator" />}
            </button>

            <button
              type="button"
              className={`nav-item ${activeTab === "profile" ? "active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setActiveTab("profile");
                setMobileMenuOpen(false);
              }}
            >
              <IconUser className="nav-icon" />
              <span className="nav-label">{t.tab_profile}</span>
              {activeTab === "profile" && <span className="active-indicator" />}
            </button>

            <button
              type="button"
              className={`nav-item ${activeTab === "settings" ? "active" : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setActiveTab("settings");
                setMobileMenuOpen(false);
              }}
            >
              <IconSettings className="nav-icon" />
              <span className="nav-label">{t.tab_settings}</span>
              {activeTab === "settings" && <span className="active-indicator" />}
            </button>
          </nav>
        </div>

        {/* PWA Install Button in Leftbar (Visible only until app is installed) */}
        {!isAppInstalled && (
          <div className="sidebar-pwa-wrap">
            <button
              type="button"
              className="sidebar-pwa-btn"
              onClick={(e) => {
                e.stopPropagation();
                void handleInstallApp();
              }}
              title={t.btn_install_app}
            >
              <IconDownload className="icon-sm" />
              <span className="btn-add-text">{t.btn_install_app}</span>
            </button>
          </div>
        )}

        {/* Sidebar Footer (Profile + Logout) */}
        <div className="sidebar-footer">
          <button
            type="button"
            className="user-profile-card-btn"
            onClick={(e) => {
              e.stopPropagation();
              setActiveTab("profile");
              setMobileMenuOpen(false);
            }}
            title="Profilni ko‘rish"
          >
            <div className="user-avatar">
              {avatarUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={avatarUrl} alt="Avatar" className="avatar-img" />
              ) : (
                (accountName || "M").slice(0, 1).toUpperCase()
              )}
            </div>
            <div className="user-info">
              <span className="user-name" title={accountName || "Foydalanuvchi"}>
                {accountName || "Foydalanuvchi"}
              </span>
              <span className="user-tag">@{accountUsername || "username"}</span>
            </div>
          </button>

          <button
            type="button"
            className="logout-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              void handleSignOut();
            }}
            title={t.logout}
          >
            <IconLogOut className="icon-sm" />
            <span className="logout-text">{t.logout}</span>
          </button>
        </div>
      </aside>

      {/* Main Workspace Wrapper */}
      <div className="main-wrapper">
        {/* Top Navbar on Mobile & Tablet */}
        <header className="mobile-topbar">
          <button
            type="button"
            className="mobile-menu-trigger"
            onClick={() => {
              setMobileMenuOpen(true);
              setSidebarOpen(true);
            }}
            aria-label="Menyuni ochish"
          >
            <IconMenu className="icon-md" />
          </button>

          <button
            type="button"
            className="mobile-brand-btn"
            onClick={() => setActiveTab("today")}
            aria-label="Bosh sahifa"
          >
            <Image className="brand-logo" src="/myplan-logo-192.png" unoptimized alt="MyPlan" width={32} height={32} priority />
            <span className="brand-title">
              <span className="brand-my">My</span><span className="brand-plan">Plan</span>
            </span>
          </button>

          <div className="mobile-topbar-actions">
            {!isOnline && (
              <span className="offline-status-pill compact" title={t.offline_pill_desc}>
                <IconWifiOff className="icon-xs" />
                <span>{t.offline_pill}</span>
              </span>
            )}
            <button
              type="button"
              className="mobile-avatar-btn"
              onClick={() => setActiveTab("profile")}
              title={t.tab_profile}
            >
              <div className="mobile-user-avatar">
                {avatarUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={avatarUrl} alt="Avatar" className="avatar-img" />
                ) : (
                  (accountName || "M").slice(0, 1).toUpperCase()
                )}
              </div>
            </button>
          </div>
        </header>

        <main className={`content-container ${activeTab === "time" ? "is-time" : ""}`}>
          {/* Header Bar Distinct for Each Tab */}
          <header className="page-header">
            <div className="header-text">
              {activeTab === "today" && (
                <>
                  <span className="page-kicker">
                    <IconSparkles className="icon-xs" /> {t.today_kicker}
                  </span>
                  <h1 className="page-title">{t.today_title}</h1>
                  <p className="page-subtitle">{formattedToday || t.today_title}</p>
                </>
              )}
              {activeTab === "activities" && (
                <>
                  <span className="page-kicker">
                    <IconList className="icon-xs" /> {t.catalog_kicker}
                  </span>
                  <h1 className="page-title">{t.catalog_title}</h1>
                  <p className="page-subtitle">{t.catalog_sub}</p>
                </>
              )}
              {activeTab === "notifications" && (
                <>
                  <span className="page-kicker">
                    <IconBell className="icon-xs" /> {t.notif_kicker}
                  </span>
                  <h1 className="page-title">{t.notif_title}</h1>
                  <p className="page-subtitle">{t.notif_sub}</p>
                </>
              )}
              {activeTab === "analytics" && (
                <>
                  <span className="page-kicker">
                    <IconBarChart className="icon-xs" /> {t.analytics_kicker}
                  </span>
                  <h1 className="page-title">{t.analytics_title}</h1>
                  <p className="page-subtitle">{t.analytics_sub}</p>
                </>
              )}
              {activeTab === "time" && (
                <>
                  <span className="page-kicker">
                    <IconClock className="icon-xs" /> {t.clk_kicker}
                  </span>
                  <h1 className="page-title">{t.clk_title}</h1>
                  <p className="page-subtitle">{t.clk_sub}</p>
                </>
              )}
              {activeTab === "profile" && (
                <>
                  <span className="page-kicker">
                    <IconUser className="icon-xs" /> {t.profile_kicker}
                  </span>
                  <h1 className="page-title">{t.profile_title}</h1>
                  <p className="page-subtitle">{t.profile_sub}</p>
                </>
              )}
              {activeTab === "settings" && (
                <>
                  <span className="page-kicker">
                    <IconSettings className="icon-xs" /> {t.settings_kicker}
                  </span>
                  <h1 className="page-title">{t.settings_title}</h1>
                  <p className="page-subtitle">{t.settings_sub}</p>
                </>
              )}
            </div>

            {!isOnline && (
              <div className="offline-status-pill desktop" title={t.offline_pill_desc}>
                <IconWifiOff className="icon-xs" />
                <span>{t.offline_pill} ({pendingSyncCount})</span>
              </div>
            )}
          </header>

          {/* Toast Notification */}
          {message && (
            <div className="status-toast" role="status">
              <span>{message}</span>
              <button
                type="button"
                className="toast-close"
                onClick={() => setMessage("")}
                aria-label="Yopish"
              >
                <IconClose className="icon-xs" />
              </button>
            </div>
          )}

          {/* TAB 1: BUGUNGI REJA (EXECUTION ONLY) */}
          {activeTab === "today" && (
            <div key="tab-today" className="tab-pane-container">
              {/* POCKET STREAK & MOMENTUM ENGINE BANNER */}
              <section className="pocket-streak-banner" aria-label="Ketma-ketlik seriyasi">
                <div className="streak-left">
                  <div className={`streak-flame-icon-wrap ${streakCount > 0 ? "active-fire" : ""}`}>
                    <IconFlame className="icon-fire" />
                  </div>
                  <div className="streak-info">
                    <div className="streak-title-row">
                      <span className="streak-label">{t.streak_label}</span>
                      {bestStreak > 0 && (
                        <span className="best-streak-tag">{t.best_record}: {bestStreak} kun</span>
                      )}
                    </div>
                    <div className="streak-number-row">
                      <span className="streak-number">{streakCount}</span>
                      <span className="streak-days-text">{t.streak_days}</span>
                    </div>
                    <div className="streak-shield-badge">
                      <IconAward className="icon-xs" />
                      <span>{t.streak_shield_label}: <strong>{t.streak_shield_active}</strong></span>
                      <span className="dot-separator">•</span>
                      <span>{t.momentum_index_label}: <strong>{momentumScore}%</strong></span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className="btn-evening-review-trigger"
                  onClick={() => {
                    triggerHaptic("medium");
                    setShowEveningReview(true);
                  }}
                  title={t.evening_review_btn}
                >
                  <IconSparkles className="icon-xs" />
                  <span>{t.evening_review_btn}</span>
                </button>
              </section>

              <section className="stats-grid" aria-label="Bugungi ko‘rsatkichlar">
                <article className="stat-card progress-card">
                  <div className="stat-header">
                    <span className="stat-tag">{t.stat_result}</span>
                    <IconTarget className="stat-icon" />
                  </div>
                  <div className="stat-value-row">
                    <span className="stat-value">{percent}</span>
                    <span className="stat-unit">%</span>
                  </div>
                  <div className="progress-bar-track">
                    <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
                  </div>
                  <p className="stat-footer">
                    <strong className="text-lime">{completedCount}</strong> {t.completed} ·{" "}
                    <strong>{Math.max(activeActivities.length - completedCount, 0)}</strong> {t.left}
                  </p>
                </article>

                <article className="stat-card">
                  <div className="stat-header">
                    <span className="stat-tag">{t.stat_active}</span>
                    <IconList className="stat-icon" />
                  </div>
                  <div className="stat-value-row">
                    <span className="stat-value">{activeActivities.length.toString().padStart(2, "0")}</span>
                  </div>
                </article>

                <article className="stat-card">
                  <div className="stat-header">
                    <span className="stat-tag">{t.stat_completed}</span>
                    <IconTrendUp className="stat-icon text-lime" />
                  </div>
                  <div className="stat-value-row">
                    <span className="stat-value text-lime">{completedCount.toString().padStart(2, "0")}</span>
                  </div>
                </article>
              </section>

              {/* SMART NEXT PRIORITY FOCUS SPOTLIGHT BANNER */}
              {recommendedFocusActivity && (
                <section className="focus-spotlight-card" aria-label="Navbatdagi tavsiya">
                  <div className="focus-spotlight-left">
                    <div className="focus-spotlight-badge">
                      <IconZap className="icon-xs" />
                      <span>{t.focus_next_spotlight}</span>
                    </div>
                    <h3 className="focus-spotlight-title">{recommendedFocusActivity.title}</h3>
                    {recommendedFocusActivity.description ? (
                      <p className="focus-spotlight-desc">{recommendedFocusActivity.description}</p>
                    ) : (
                      <p className="focus-spotlight-desc">
                        {recommendedFocusActivity.measurement_type === "count"
                          ? `${recommendedFocusActivity.target} ${formatUnit(recommendedFocusActivity.unit)} ${t.tab_countable.toLowerCase()}`
                          : t.tab_single}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn-focus-spotlight-start"
                    onClick={() => startFocusSession(recommendedFocusActivity)}
                  >
                    <IconZap className="icon-xs" />
                    <span>{t.focus_start_btn}</span>
                  </button>
                </section>
              )}

              {/* Tasks Execution List */}
              <section className="tasks-section">
                <div className="section-header-bar">
                  <div>
                    <span className="section-sub">{t.today_kicker}</span>
                    <h2 className="section-heading">{t.tasks_execution}</h2>
                  </div>
                </div>

                {/* Time of Day Filter Bar (Pocket Zone Navigation) */}
                <div className="time-of-day-filter-bar" role="tablist" aria-label="Kun qismlari bo‘yicha saralash">
                  <button
                    type="button"
                    className={`time-filter-chip ${activeTimeFilter === "all" ? "active" : ""}`}
                    onClick={() => {
                      triggerHaptic("light");
                      setActiveTimeFilter("all");
                    }}
                  >
                    <span>{t.filter_all}</span>
                    <span className="chip-count">{timeCounts.all}</span>
                  </button>
                  <button
                    type="button"
                    className={`time-filter-chip ${activeTimeFilter === "morning" ? "active" : ""}`}
                    onClick={() => {
                      triggerHaptic("light");
                      setActiveTimeFilter("morning");
                    }}
                  >
                    <IconSunrise className="icon-xs" />
                    <span>{t.filter_morning}</span>
                    <span className="chip-count">{timeCounts.morning}</span>
                  </button>
                  <button
                    type="button"
                    className={`time-filter-chip ${activeTimeFilter === "afternoon" ? "active" : ""}`}
                    onClick={() => {
                      triggerHaptic("light");
                      setActiveTimeFilter("afternoon");
                    }}
                  >
                    <IconSun className="icon-xs" />
                    <span>{t.filter_afternoon}</span>
                    <span className="chip-count">{timeCounts.afternoon}</span>
                  </button>
                  <button
                    type="button"
                    className={`time-filter-chip ${activeTimeFilter === "evening" ? "active" : ""}`}
                    onClick={() => {
                      triggerHaptic("light");
                      setActiveTimeFilter("evening");
                    }}
                  >
                    <IconMoon className="icon-xs" />
                    <span>{t.filter_evening}</span>
                    <span className="chip-count">{timeCounts.evening}</span>
                  </button>

                  {/* Custom time slots in filter bar */}
                  {customTimeSlots.map((slot) => {
                    const count = activeActivities.filter((a) => a.time_of_day === slot.id).length;
                    return (
                      <button
                        key={slot.id}
                        type="button"
                        className={`time-filter-chip ${activeTimeFilter === slot.id ? "active" : ""}`}
                        onClick={() => {
                          triggerHaptic("light");
                          setActiveTimeFilter(slot.id);
                        }}
                      >
                        <IconClock className="icon-xs" />
                        <span>{slot.label}</span>
                        <span className="chip-count">{count}</span>
                      </button>
                    );
                  })}
                </div>

                {loadingData ? (
                  <div className="empty-state-box">
                    <div className="loading-spinner" />
                    <p>{t.loading_workspace || "Ma’lumotlar yuklanmoqda…"}</p>
                  </div>
                ) : activeActivities.length === 0 ? (
                  <div className="empty-state-box">
                    <div className="empty-icon-wrap">
                      <IconCalendar className="icon-lg" />
                    </div>
                    <h3>{t.no_tasks_today}</h3>
                    <p>{t.no_tasks_sub}</p>
                  </div>
                ) : displayedActivities.length === 0 ? (
                  <div className="empty-state-box">
                    <div className="empty-icon-wrap">
                      <IconCalendar className="icon-lg" />
                    </div>
                    <h3>{t.no_tasks_filter}</h3>
                    <p>{t.no_tasks_filter_sub}</p>
                  </div>
                ) : (
                  <div className="task-items-list">
                    {displayedActivities.map((activity) => {
                      const occ = occurrences.find((o) => o.activity_id === activity.id);
                      const isDone = occ?.status === "completed";
                      const target = activity.target || 0;
                      const rawCount = taskCounts[occ?.id || ""] ?? (isDone ? target : 0);
                      const current = target > 0 ? Math.min(Math.max(0, rawCount), target) : Math.max(0, rawCount);
                      const remaining = roundAmount(Math.max(target - current, 0));
                      const steps = stepsFor(activity.unit, counterSteps);

                      // 10s inactivity collapse state
                      // Space is held only right after a tap, so buttons never shift under a finger; otherwise it is released.
                      const isSpaceCollapsed = collapsedCounters[occ?.id || ""] !== false;
                      const offset = swipeState?.id === activity.id ? swipeState.offset : 0;

                      return (
                        <div
                          key={activity.id}
                          className="task-card-swipe-wrap"
                          onTouchStart={(e) => handleTouchStart(activity.id, e)}
                          onTouchMove={(e) => handleTouchMove(activity.id, e)}
                          onTouchEnd={() => handleTouchEnd(activity, occ)}
                          onTouchCancel={handleTouchCancel}
                          onDoubleClick={(e) => {
                            // Rapid taps on the +N / checkbox / undo buttons must not trigger the card shortcut.
                            if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) return;
                            handleCardDoubleTap(activity, occ);
                          }}
                        >
                          {/* Swipe background action reveal */}
                          <div
                            className="swipe-bg swipe-bg-complete"
                            style={{ opacity: Math.min(Math.max(offset, 0) / 50, 1) }}
                            aria-hidden="true"
                          >
                            <IconCheck className="icon-md" />
                            <span>{t.done}</span>
                          </div>
                          <div
                            className="swipe-bg swipe-bg-undo"
                            style={{ opacity: Math.min(Math.max(-offset, 0) / 50, 1) }}
                            aria-hidden="true"
                          >
                            <IconUndo className="icon-md" />
                            <span>{t.undo}</span>
                          </div>

                          <article
                            className={`task-card ${isDone ? "is-completed" : ""}`}
                            style={{
                              transform: offset !== 0 ? `translateX(${offset}px)` : undefined,
                              transition: offset === 0 ? "transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)" : "none",
                            }}
                          >
                            <button
                              type="button"
                              className="checkbox-btn"
                              aria-label={isDone ? t.action_mark_pending : t.action_mark_complete}
                              onClick={() => void toggleComplete(activity)}
                            >
                              {isDone && <IconCheck className="checkbox-icon" />}
                            </button>

                            <div className="task-content">
                              <h4 className="task-title">{activity.title}</h4>
                              {activity.description && (
                                <p className="task-description">{activity.description}</p>
                              )}

                              {/* Sanoqli progress & Fading Increment Buttons with 10s inactivity collapse */}
                              {activity.measurement_type === "count" && target > 0 && (
                                <div className="task-count-progress-wrap">
                                  <div className="task-count-info-row">
                                    <span className="task-count-text">
                                      <strong>{formatCount(current, activity.unit, timeLabels)}</strong> / {target} {formatUnit(activity.unit)}
                                    </span>
                                    <span className="task-remaining-text">
                                      {isDone
                                        ? t.done
                                        : isMinuteUnit(activity.unit)
                                        ? `${formatTimeLeft(remaining, timeLabels)} ${t.step_left}`
                                        : `${remaining} ${t.stat_remaining_footer}`}
                                    </span>
                                  </div>
                                  <div className="task-mini-progress-track">
                                    <div
                                      className="task-mini-progress-fill"
                                      style={{ width: `${Math.min((current / target) * 100, 100)}%` }}
                                    />
                                  </div>

                                  {/* Increment buttons (+10, +5, +1) + Undo */}
                                  {occ && (
                                    <div className="count-actions-row">
                                      <div className="count-buttons-cluster">
                                        {steps
                                          .slice()
                                          .sort((a, b) => b - a)
                                          .map((step) => {
                                            const smallestStep = Math.min(...steps);
                                            const anyStepFits = steps.some((st) => st <= remaining);
                                            const isVisible =
                                              !isDone && (step <= remaining || (!anyStepFits && step === smallestStep));
                                            return (
                                              <button
                                                key={step}
                                                type="button"
                                                className={`btn-counter-inc ${step === (habits.favoriteStep[activity.id] ?? 1) ? "primary" : ""} ${
                                                  isVisible
                                                    ? "btn-visible"
                                                    : isSpaceCollapsed
                                                    ? "btn-hidden-collapsed"
                                                    : "btn-hidden-hold-space"
                                                }`}
                                                onClick={() => void incrementTaskCount(activity, occ, step)}
                                                title={formatStep(step, activity.unit, timeLabels)}
                                              >
                                                {formatStep(step, activity.unit, timeLabels)}
                                              </button>
                                            );
                                          })}
                                        {/* The amount this person usually logs in one sitting, as a single tap */}
                                        {!isDone &&
                                          habits.usualChunk[activity.id] !== undefined &&
                                          habits.usualChunk[activity.id] <= remaining &&
                                          !steps.includes(habits.usualChunk[activity.id]) && (
                                            <button
                                              type="button"
                                              className="btn-counter-inc primary btn-visible"
                                              onClick={() => void incrementTaskCount(activity, occ, habits.usualChunk[activity.id])}
                                              title={formatStep(habits.usualChunk[activity.id], activity.unit, timeLabels)}
                                            >
                                              {formatStep(habits.usualChunk[activity.id], activity.unit, timeLabels)}
                                            </button>
                                          )}
                                      </div>

                                      {/* Undo Button - ALWAYS ON THE RIGHT SIDE */}
                                      {(taskHistory[occ.id]?.length || 0) > 0 && (
                                        <button
                                          type="button"
                                          className="btn-counter-undo"
                                          onClick={() => void undoTaskCount(activity, occ)}
                                          title={`${t.undo} (${formatStep(taskHistory[occ.id].slice(-1)[0], activity.unit, timeLabels).replace("+", "-")})`}
                                          aria-label={t.undo}
                                        >
                                          <IconUndo className="icon-sm" />
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}

                              <div className="task-meta">
                                <span className="schedule-badge daily">{t.badge_daily}</span>
                                {activity.time_of_day === "morning" && (
                                  <span className="schedule-badge time-badge morning">
                                    <IconSunrise className="icon-xs" /> {t.filter_morning}
                                  </span>
                                )}
                                {activity.time_of_day === "afternoon" && (
                                  <span className="schedule-badge time-badge afternoon">
                                    <IconSun className="icon-xs" /> {t.filter_afternoon}
                                  </span>
                                )}
                                {activity.time_of_day === "evening" && (
                                  <span className="schedule-badge time-badge evening">
                                    <IconMoon className="icon-xs" /> {t.filter_evening}
                                  </span>
                                )}
                                {activity.time_of_day && !["morning", "afternoon", "evening", "anytime"].includes(activity.time_of_day) && (
                                  <span className="schedule-badge time-badge custom">
                                    <IconClock className="icon-xs" />{" "}
                                    {customTimeSlots.find((s) => s.id === activity.time_of_day)?.label || activity.time_of_day}
                                  </span>
                                )}
                                {activity.schedule_rule?.duration_label && (
                                  <span className="schedule-badge duration">
                                    {activity.schedule_rule.duration_label.toUpperCase()}
                                  </span>
                                )}
                                {activity.measurement_type === "count" && (
                                  <span className="task-kind-badge">
                                    <IconHash className="icon-xs" /> {t.tab_countable}
                                  </span>
                                )}
                              </div>
                            </div>
                          </article>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          )}

          {/* TAB 2: FAOLIYATLARIM (MANAGEMENT & CATALOG ONLY — NO EXECUTION HERE!) */}
          {activeTab === "activities" && (
            <div key="tab-activities" className="tab-pane-container">
              <section className="activities-container">
                <div className="section-header-bar catalog-header-bar">
                  <button
                    type="button"
                    className="catalog-filter-btn preset-open-btn"
                    onClick={() => setShowPresetModal(true)}
                  >
                    <IconLibrary className="icon-xs" /> {t.preset_btn}
                  </button>
                  {/* Filter Tabs */}
                  <div className="catalog-filters-bar">
                    <button
                      type="button"
                      className={`catalog-filter-btn ${catalogFilter === "all" ? "active" : ""}`}
                      onClick={() => setCatalogFilter("all")}
                    >
                      {t.filter_all} ({activities.length})
                    </button>
                    <button
                      type="button"
                      className={`catalog-filter-btn ${catalogFilter === "active" ? "active" : ""}`}
                      onClick={() => setCatalogFilter("active")}
                    >
                      {t.tab_active_plans} ({activities.filter((a) => a.is_active).length})
                    </button>
                    <button
                      type="button"
                      className={`catalog-filter-btn ${catalogFilter === "archived" ? "active" : ""}`}
                      onClick={() => setCatalogFilter("archived")}
                    >
                      {t.tab_archived_plans} ({activities.filter((a) => !a.is_active).length})
                    </button>
                  </div>
                </div>

                {/* Search Bar */}
                <div className="catalog-search-wrap">
                  <IconSearch className="search-icon icon-sm" />
                  <input
                    type="text"
                    className="catalog-search-input"
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                    placeholder={t.catalog_search_placeholder}
                  />
                  {catalogSearch && (
                    <button
                      type="button"
                      className="search-clear-btn"
                      onClick={() => setCatalogSearch("")}
                      aria-label={t.btn_cancel}
                    >
                      <IconClose className="icon-xs" />
                    </button>
                  )}
                </div>

                {filteredCatalogActivities.length === 0 ? (
                  <div className="empty-state-box">
                    <div className="empty-icon-wrap">
                      <IconFilter className="icon-lg" />
                    </div>
                    <h3>{t.catalog_empty_filter_title}</h3>
                    <p>{t.catalog_empty_filter_sub}</p>
                  </div>
                ) : (
                  <div className="catalog-cards-grid">
                    {filteredCatalogActivities.map((act) => (
                      <article key={act.id} className={`catalog-card ${!act.is_active ? "is-archived" : ""}`}>
                        <div className="catalog-card-header">
                          <span className={`status-pill ${act.is_active ? "active" : "archived"}`}>
                            {act.is_active ? t.status_active : t.status_archived}
                          </span>
                          <span className="schedule-badge daily">{t.badge_daily}</span>
                        </div>

                        <h3 className="catalog-card-title">{act.title}</h3>
                        {act.description && (
                          <p className="catalog-card-desc">{act.description}</p>
                        )}

                        <div className="catalog-card-details">
                          <div className="detail-row">
                            <span className="detail-label">{t.detail_type_label}</span>
                            <span className="detail-value">
                              {act.measurement_type === "count"
                                ? `${t.tab_countable} (${act.target} ${formatUnit(act.unit)})`
                                : t.detail_single_check}
                            </span>
                          </div>
                          {act.schedule_rule?.duration_label && (
                            <div className="detail-row">
                              <span className="detail-label">{t.detail_duration_label}</span>
                              <span className="detail-value text-lime">{act.schedule_rule.duration_label}</span>
                            </div>
                          )}
                          {act.schedule_rule?.weekdays && act.schedule_rule.weekdays.length > 0 && (
                            <div className="detail-row">
                              <span className="detail-label">{t.detail_days_label}</span>
                              <span className="detail-value text-lime">
                                {act.schedule_rule.weekdays.length === 7
                                  ? t.everyday_label
                                  : act.schedule_rule.weekdays
                                      .map((id) => weekdaysList.find((w) => w.id === id)?.short || id)
                                      .join(", ")}
                              </span>
                            </div>
                          )}
                          <div className="detail-row">
                            <span className="detail-label">{t.detail_started_label}</span>
                            <span className="detail-value">{act.starts_on}</span>
                          </div>
                        </div>

                        <div className="catalog-card-actions">
                          <button
                            type="button"
                            className="btn-catalog-edit"
                            onClick={() => openEditModal(act)}
                          >
                            <IconEdit className="icon-xs" />
                            <span>{t.btn_edit}</span>
                          </button>
                          <button
                            type="button"
                            className={`btn-catalog-archive ${!act.is_active ? "unarchive" : ""}`}
                            onClick={() => void archiveActivity(act.id, !act.is_active)}
                          >
                            <IconArchive className="icon-xs" />
                            <span>{act.is_active ? t.btn_archive : t.btn_restore}</span>
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {/* TAB: BILDIRISHNOMALAR (SO‘NGGI 3 KUNLIK TARIX — O‘CHIRIB BO‘LMAYDI) */}
          {activeTab === "notifications" && (
            <div key="tab-notifications" className="tab-pane-container">
              <section className="notifications-view">
                <div className="section-header-bar">
                  <div>
                    <span className="section-sub">{t.notif_archive_badge}</span>
                    <h2 className="section-heading">{t.notif_history_title} ({notifications.length})</h2>
                  </div>
                  <div className="notifications-immutable-badge">
                    <IconShield className="icon-xs" /> {t.notif_read_only}
                  </div>
                </div>

                <div className="notifications-policy-banner">
                  <IconSparkles className="icon-sm text-lime" />
                  <p>
                    {t.notif_policy_text}
                  </p>
                </div>

                <div className="notifications-timeline">
                  {notifications.map((notif) => {
                    const loc = getLocalizedNotification(notif, t);
                    return (
                      <article
                        key={notif.id}
                        className={`notification-card ${notif.isRead ? "is-read" : "is-unread"}`}
                        onClick={() => markNotificationAsRead(notif.id)}
                      >
                        <div className="notification-card-header">
                          <div className="notif-header-left">
                            <span className="sender-avatar-badge">M</span>
                            <span className="sender-name-text">{loc.sender}</span>
                            <span className={`notification-category-tag ${notif.category}`}>
                              {loc.categoryLabel}
                            </span>
                          </div>
                          <span className="notification-time-tag">
                            {notif.timeLabel || t.time_just_now || "Yaqinda"}
                          </span>
                        </div>

                        <div className="notification-content">
                          <h4 className="notification-item-title">{loc.title}</h4>
                          <p className="notification-item-message">{loc.message}</p>
                        </div>

                        <div className="notification-card-footer">
                        {!notif.isRead ? (
                          <span className="status-unread-pill">
                            <span className="pulse-dot-sm" /> {t.notif_status_new}
                          </span>
                        ) : (
                          <span className="status-read-pill">
                            <IconCheck className="icon-xs" /> {t.notif_status_read}
                          </span>
                        )}
                      </div>
                    </article>
                  );
                })}
                </div>
              </section>
            </div>
          )}

          {/* TAB 3: STATISTIKA */}
          {activeTab === "analytics" && (
            <div key="tab-analytics" className="tab-pane-container">
              <StatsTab
                userId={userId}
                language={language}
                activities={activities}
                liveToday={occurrences.map((o) => ({ activity_id: o.activity_id, status: o.status }))}
                todayKey={today()}
                refreshKey={completedCount}
              />
            </div>
          )}

          {/* TAB 4: PROFIL (READ-ONLY) */}
          {activeTab === "time" && (
            <div key="tab-time" className="tab-pane-container time-pane">
              <TimeTab t={t} language={language} scope={userId || "guest"} soundEnabled={soundEnabled} />
            </div>
          )}

          {activeTab === "profile" && (
            <div key="tab-profile" className="tab-pane-container">
              <section className="profile-view">
                <div className="profile-card-container">
                  <div className="profile-avatar-block">
                    <div className="profile-large-avatar-wrap">
                      {avatarUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={avatarUrl} alt="Profil rasmi" className="profile-large-avatar" />
                      ) : (
                        <div className="profile-avatar-placeholder">
                          {(accountName || "M").slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <label htmlFor="avatar-file-input" className="avatar-upload-overlay" title="Rasm yuklash / almashtirish">
                        <IconCamera className="icon-sm" />
                        <span>Rasm</span>
                        <input
                          id="avatar-file-input"
                          type="file"
                          accept="image/*"
                          onChange={handleAvatarChange}
                          style={{ display: "none" }}
                        />
                      </label>
                    </div>

                    <div className="profile-header-meta">
                      <h3>{accountName || "Foydalanuvchi"}</h3>
                      <p className="profile-username">@{accountUsername || "username"}</p>
                      <span className="profile-status-pill">
                        <IconShield className="icon-xs" /> Shaxsiy hisob faol
                      </span>
                    </div>
                  </div>

                  <div className="profile-details-grid">
                    <div className="profile-info-item">
                      <span className="info-label">Ism va familiya</span>
                      <p className="info-value">{accountName || "Kiritilmagan"}</p>
                    </div>

                    <div className="profile-info-item">
                      <span className="info-label">Foydalanuvchi nomi</span>
                      <p className="info-value">@{accountUsername || "kiritilmagan"}</p>
                    </div>

                    <div className="profile-info-item">
                      <span className="info-label">Yoshingiz</span>
                      <p className="info-value">{userAge ? `${userAge} yosh` : "Ko‘rsatilmagan"}</p>
                    </div>

                    <div className="profile-info-item">
                      <span className="info-label">Jami faoliyatlar</span>
                      <p className="info-value text-lime">{activities.length} ta</p>
                    </div>
                  </div>

                  {/* Shaxsiy ma'lumotlar (Ism va Yosh) tahrirlash */}
                  <div className="profile-edit-section">
                    <div className="profile-section-title-row">
                      <h4>
                        <IconEdit className="icon-xs text-lime" />
                        <span>Ism va yoshni tahrirlash</span>
                      </h4>
                      {!canChangeNameAge ? (
                        <span className="security-badge locked" title="Yangi sessiyadan so‘ng 3 soat o‘tishi shart">
                          <IconLock className="icon-xs" />
                          <span>3 soatlik himoya: {formatRemainingTime(remainingNameAgeMs)} qoldi</span>
                        </span>
                      ) : (
                        <span className="security-badge unlocked">
                          <IconCheck className="icon-xs" />
                          <span>Tahrirlash mumkin</span>
                        </span>
                      )}
                    </div>

                    <p className="security-hint-text">
                      {!canChangeNameAge
                        ? "Xavfsizlik qoidasi: hisobga yangi kirilganda ism va yoshni o‘zgartirish uchun kamida 3 soat o‘tishi shart. Ushbu vaqt tugagach tahrirlash avtomatik ochiladi."
                        : "Profil ma’lumotlaringizni yangilang va saqlash tugmasini bosing."}
                    </p>

                    <div className="profile-form-grid">
                      <div className="profile-form-field">
                        <label htmlFor="input-edit-fullname">{t.profile_name_label}</label>
                        <input
                          id="input-edit-fullname"
                          type="text"
                          className="profile-input"
                          value={editFullName}
                          onChange={(e) => {
                            profileFormDirtyRef.current = true;
                            setEditFullName(e.target.value);
                          }}
                          placeholder="To‘liq ismingiz"
                          disabled={!canChangeNameAge || isSavingProfile}
                          maxLength={60}
                        />
                      </div>

                      <div className="profile-form-field">
                        <label htmlFor="input-edit-age">{t.profile_age_label}</label>
                        <input
                          id="input-edit-age"
                          type="number"
                          className="profile-input"
                          value={editAge}
                          onChange={(e) => {
                            profileFormDirtyRef.current = true;
                            setEditAge(e.target.value);
                          }}
                          placeholder="Yoshingiz (masalan: 22)"
                          disabled={!canChangeNameAge || isSavingProfile}
                          min={6}
                          max={122}
                        />
                      </div>
                    </div>

                    {profileActionMsg && (
                      <p className="profile-feedback-msg">{profileActionMsg}</p>
                    )}

                    <div className="profile-form-actions">
                      <button
                        type="button"
                        className="btn-save-profile"
                        onClick={handleSaveProfileInfo}
                        disabled={!canChangeNameAge || isSavingProfile}
                      >
                        <IconCheck className="icon-xs" />
                        <span>{isSavingProfile ? "Saqlanmoqda..." : t.profile_save_btn}</span>
                      </button>
                    </div>
                  </div>

                  {/* Parolni yangilash */}
                  <div className="profile-edit-section">
                    <div className="profile-section-title-row">
                      <h4>
                        <IconKey className="icon-xs text-lime" />
                        <span>{t.profile_password_btn}</span>
                      </h4>
                      {!canChangePassword ? (
                        <span className="security-badge locked" title={t.profile_cooldown_24h}>
                          <IconLock className="icon-xs" />
                          <span>{t.profile_cooldown_badge}: {formatRemainingTime(remainingPasswordMs)}</span>
                        </span>
                      ) : (
                        <span className="security-badge unlocked">
                          <IconCheck className="icon-xs" />
                          <span>{t.profile_password_ready}</span>
                        </span>
                      )}
                    </div>

                    <p className="security-hint-text">
                      {!canChangePassword
                        ? t.profile_password_hint_locked
                        : t.profile_password_hint_ready}
                    </p>

                    <div className="profile-form-grid">
                      <div className="profile-form-field">
                        <label htmlFor="input-new-password">{t.profile_password_label}</label>
                        <input
                          id="input-new-password"
                          type="password"
                          className="profile-input"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder={!canChangePassword ? t.profile_password_placeholder_locked : t.profile_password_placeholder_new}
                          disabled={!canChangePassword || isUpdatingPassword}
                          autoComplete="new-password"
                        />
                      </div>

                      <div className="profile-form-field">
                        <label htmlFor="input-confirm-password">{t.profile_confirm_password_label}</label>
                        <input
                          id="input-confirm-password"
                          type="password"
                          className="profile-input"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder={!canChangePassword ? t.profile_password_placeholder_locked : t.profile_password_placeholder_confirm}
                          disabled={!canChangePassword || isUpdatingPassword}
                          autoComplete="new-password"
                        />
                      </div>
                    </div>

                    {passwordActionMsg && (
                      <p className="profile-feedback-msg">{passwordActionMsg}</p>
                    )}

                    <div className="profile-form-actions">
                      <button
                        type="button"
                        className="btn-save-profile"
                        onClick={handleUpdatePassword}
                        disabled={!canChangePassword || isUpdatingPassword}
                      >
                        <IconKey className="icon-xs" />
                        <span>{isUpdatingPassword ? "..." : t.profile_password_btn}</span>
                      </button>
                    </div>
                  </div>

                  {/* Multi-Account Management (Switch Account & Add Account, max 5) */}
                  <div className="profile-accounts-block">
                    <div className="accounts-header-row">
                      <div>
                        <h4>{t.profile_accounts_title}</h4>
                        <p>{t.profile_accounts_sub}</p>
                      </div>
                      <span className="accounts-count-badge">{savedAccounts.length} / 5 {t.profile_accounts_badge_unit}</span>
                    </div>

                    <div className="accounts-list">
                      {savedAccounts.map((acc) => {
                        const isCurrent = acc.id === userId;
                        return (
                          <div
                            key={acc.id}
                            className={`account-row ${isCurrent ? "is-current-account" : ""}`}
                          >
                            <div className="account-row-left">
                              <div className="account-avatar-sm">
                                {acc.fullName.slice(0, 1).toUpperCase()}
                              </div>
                              <div className="account-info-sm">
                                <span className="account-fullname">{acc.fullName}</span>
                                <span className="account-username-tag">@{acc.username}</span>
                              </div>
                            </div>

                            <div className="account-row-actions">
                              {isCurrent ? (
                                <span className="current-account-pill">
                                  <IconCheck className="icon-xs" /> {t.status_active}
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className="btn-account-switch"
                                  onClick={() => switchAccount(acc)}
                                >
                                  {t.switch_account || "O‘tish"}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {savedAccounts.length < 5 && (
                        <button
                          type="button"
                          className="btn-add-account-action"
                          onClick={handleAddAccount}
                        >
                          <IconUserPlus className="icon-xs" />
                          <span>{t.add_account} ({savedAccounts.length}/5)</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* TAB 5: SOZLAMALAR (NEW!) */}
          {activeTab === "settings" && (
            <div key="tab-settings" className="tab-pane-container">
              <section className="settings-view">
                <div className="settings-sections-list">
                  {/* Language Settings */}
                  <div className="settings-card">
                    <div className="settings-card-header">
                      <IconGlobe className="icon-sm text-lime" />
                      <div>
                        <h3>{t.setting_language}</h3>
                      </div>
                    </div>
                    <div className="settings-options-grid">
                      <button
                        type="button"
                        className={`setting-choice-btn ${language === "uz" ? "active" : ""}`}
                        onClick={() => handleLanguageChange("uz")}
                      >
                        <span>O‘zbekcha</span>
                        {language === "uz" && <IconCheck className="icon-xs text-lime" />}
                      </button>
                      <button
                        type="button"
                        className={`setting-choice-btn ${language === "en" ? "active" : ""}`}
                        onClick={() => handleLanguageChange("en")}
                      >
                        <span>English</span>
                        {language === "en" && <IconCheck className="icon-xs text-lime" />}
                      </button>
                      <button
                        type="button"
                        className={`setting-choice-btn ${language === "ru" ? "active" : ""}`}
                        onClick={() => handleLanguageChange("ru")}
                      >
                        <span>Русский</span>
                        {language === "ru" && <IconCheck className="icon-xs text-lime" />}
                      </button>
                    </div>
                  </div>

                  {/* Theme Settings */}
                  <div className="settings-card">
                    <div className="settings-card-header">
                      <IconMoon className="icon-sm text-lime" />
                      <div>
                        <h3>{t.setting_appearance}</h3>
                      </div>
                    </div>
                    <div className="settings-options-grid">
                      <button
                        type="button"
                        className={`setting-choice-btn ${theme === "system" ? "active" : ""}`}
                        onClick={() => handleThemeChange("system")}
                      >
                        <IconSettings className="icon-xs" />
                        <span>{t.theme_system}</span>
                        {theme === "system" && <IconCheck className="icon-xs text-lime" />}
                      </button>
                      <button
                        type="button"
                        className={`setting-choice-btn ${theme === "dark" ? "active" : ""}`}
                        onClick={() => handleThemeChange("dark")}
                      >
                        <IconMoon className="icon-xs" />
                        <span>{t.theme_dark}</span>
                        {theme === "dark" && <IconCheck className="icon-xs text-lime" />}
                      </button>
                      <button
                        type="button"
                        className={`setting-choice-btn ${theme === "light" ? "active" : ""}`}
                        onClick={() => handleThemeChange("light")}
                      >
                        <IconSun className="icon-xs" />
                        <span>{t.theme_light}</span>
                        {theme === "light" && <IconCheck className="icon-xs text-lime" />}
                      </button>
                    </div>
                  </div>

                  {/* Sound & Notifications */}
                  <div className="settings-card">
                    <div className="settings-card-header">
                      <IconSparkles className="icon-sm text-lime" />
                      <div>
                        <h3>{t.setting_sounds}</h3>
                      </div>
                    </div>
                    <div className="settings-toggle-row">
                      <span>{t.setting_sounds}</span>
                      <button
                        type="button"
                        className={`toggle-switch-btn ${soundEnabled ? "on" : "off"}`}
                        onClick={() => handleSoundToggle(!soundEnabled)}
                        aria-label="Tovushni yoqish yoki o‘chirish"
                      >
                        <span className="toggle-slider" />
                      </button>
                    </div>
                  </div>

                  {/* Push Notifications Settings */}
                  <div className="settings-card">
                    <div className="settings-card-header">
                      <IconBell className="icon-sm text-lime" />
                      <div>
                        <h3>{t.setting_notifs}</h3>
                      </div>
                    </div>
                    <div className="settings-toggle-row">
                      <span>{t.setting_notifs}</span>
                      <button
                        type="button"
                        className={`toggle-switch-btn ${notificationsEnabled ? "on" : "off"}`}
                        onClick={() => handleNotificationsToggle(!notificationsEnabled)}
                        aria-label="Bildirishnomalarni yoqish yoki o‘chirish"
                      >
                        <span className="toggle-slider" />
                      </button>
                    </div>
                    <div className="settings-toggle-row">
                      <span>Brauzer bildirishnomalari</span>
                      <button
                        type="button"
                        className={`setting-choice-btn ${pushSubscribed ? "active" : ""}`}
                        onClick={() => void handleRequestPush()}
                        disabled={pushBusy}
                        style={{ width: "auto", padding: "8px 16px" }}
                      >
                        {pushBusy ? "Kutilmoqda…" : pushSubscribed ? "O‘chirish" : pushPermission === "granted" ? "Yoqish" : "Ruxsat berish"}
                      </button>
                    </div>
                  </div>

                  {/* Connected Devices (Ulangan qurilmalar) - Faqat ro'yxatdan o'tganiga 24 soat bo'lgan foydalanuvchilarga ko'rinadi */}
                  {isMatureAccount && (
                    <div className="settings-card connected-devices-card">
                      <div className="settings-card-header">
                        <IconLaptop className="icon-sm text-lime" />
                        <div className="step-header-text">
                          <div className="step-title-row">
                            <h3>{t.devices_title}</h3>
                            <span className="step-count-badge">
                              {activeDevices.length} ta faol qurilma
                            </span>
                          </div>
                          <p>{t.devices_sub}</p>
                        </div>
                      </div>

                      <div className="devices-list">
                        {activeDevices.map((dev) => {
                          const isCurrent = dev.session_token === getOrCreateSessionToken(userId ?? undefined);
                          return (
                            <div
                              key={dev.id}
                              className={`device-item-card ${isCurrent ? "is-current-device" : ""}`}
                            >
                              <div className="device-item-left">
                                <div className="device-icon-wrap">
                                  {dev.device_type === "mobile" ? (
                                    <IconSmartphone className="icon-md text-lime" />
                                  ) : dev.device_type === "tablet" ? (
                                    <IconTablet className="icon-md text-lime" />
                                  ) : (
                                    <IconLaptop className="icon-md text-lime" />
                                  )}
                                </div>
                                <div className="device-info-col">
                                  <div className="device-name-row">
                                    <strong className="device-title">{dev.device_name}</strong>
                                    {isCurrent ? (
                                      <span className="device-current-badge">
                                        <span className="status-dot green" /> {t.devices_current}
                                      </span>
                                    ) : (
                                      <span className="device-active-badge">
                                        <span className="status-dot green" /> {t.devices_active_badge}
                                      </span>
                                    )}
                                  </div>
                                  <div className="device-meta-row">
                                    <span className="device-meta-tag">{dev.os_name}</span>
                                    <span className="device-meta-divider">•</span>
                                    <span className="device-meta-tag">{dev.browser_name}</span>
                                    <span className="device-meta-divider">•</span>
                                    <span className="device-meta-time">
                                      {formatDeviceTime(dev.last_active_at)}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div className="device-item-actions">
                                {!isCurrent ? (
                                  <button
                                    type="button"
                                    className="btn-revoke-device"
                                    onClick={() => handleRevokeDevice(dev.id)}
                                    title="Sessiyani yakunlash (chiqarib yuborish)"
                                    aria-label="Sessiyani yakunlash"
                                  >
                                    <IconLogOut className="icon-xs" />
                                    <span className="btn-revoke-text">{t.devices_revoke}</span>
                                  </button>
                                ) : (
                                  <span className="this-device-indicator">Ushbu brauzer</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Sanoqli hisoblagich bosqichlari (+ tugmalari) */}
                  <div className="settings-card counter-steps-manage-card">
                    <div className="settings-card-header">
                      <IconHash className="icon-sm text-lime" />
                      <div className="step-header-text">
                        <div className="step-title-row">
                          <h3>{t.setting_counter}</h3>
                          <span className="step-count-badge">{counterSteps.length} / 10 ta</span>
                        </div>
                        <p>{t.setting_counter_sub}</p>
                      </div>
                    </div>

                    <div className="step-pills-row">
                      {counterSteps
                        .slice()
                        .sort((a, b) => b - a)
                        .map((step) => (
                          <div key={step} className="step-pill">
                            <span className="step-pill-val">+{step}</span>
                            <button
                              type="button"
                              className="btn-delete-step"
                              onClick={() => handleRemoveCounterStep(step)}
                              title={`+${step} qadamini o‘chirish`}
                              aria-label={`+${step} qadamini o‘chirish`}
                            >
                              <IconClose className="icon-xs" />
                            </button>
                          </div>
                        ))}
                    </div>

                    {/* Yangi qadam qo'shish */}
                    <div className="step-add-container">
                      <div className="step-add-row">
                        <div className="step-input-wrap">
                          <span className="step-input-prefix">+</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            className="step-number-input"
                            value={newStepInput}
                            onChange={(e) => {
                              const val = e.target.value.replace(/\D/g, "").slice(0, 2);
                              setNewStepInput(val);
                              setNewStepError("");
                            }}
                            placeholder={counterSteps.length >= 10 ? "Limitga yetildi" : "Masalan: 15"}
                            maxLength={2}
                            disabled={counterSteps.length >= 10}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleAddCounterStep();
                              }
                            }}
                          />
                        </div>
                        <button
                          type="button"
                          className="btn-add-step"
                          onClick={handleAddCounterStep}
                          disabled={counterSteps.length >= 10}
                        >
                          <IconPlus className="icon-xs" />
                          <span>{t.btn_add}</span>
                        </button>
                        <button
                          type="button"
                          className="btn-reset-steps"
                          onClick={handleResetCounterSteps}
                          title="Standart (+10, +5, +1) qadamlarni tiklash"
                        >
                          {t.btn_reset}
                        </button>
                      </div>

                      {newStepError && (
                        <p className="step-validation-error" role="alert">
                          <IconAlertTriangle className="icon-xs inline-icon" /> {newStepError}
                        </p>
                      )}
                      {counterSteps.length >= 10 ? (
                        <p className="step-limit-notice">
                          <IconCheck className="icon-xs inline-icon" /> Maksimal 10 ta hisoblash qadami kiritildi. Yangi qo‘shish uchun mavjudlaridan birini o‘chiring.
                        </p>
                      ) : (
                        <p className="step-hint">
                          {t.step_hint} (Maksimal 10 ta qadam).
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Auto-archive setting */}
                  <div className="settings-card">
                    <div className="settings-card-header">
                      <IconArchive className="icon-sm text-lime" />
                      <div>
                        <h3>Arxivlash tartibi</h3>
                        <p>Tugallangan rejalarni avtomatik arxivlash ({autoArchiveDelay} kun)</p>
                      </div>
                    </div>
                  </div>

                  {/* PWA Section */}
                  <div className="settings-card">
                    <div className="settings-card-header">
                      <IconDownload className="icon-sm text-lime" />
                      <div>
                        <h3>{t.settings_pwa_title}</h3>
                      </div>
                    </div>
                    <div className="pwa-status-box">
                      <div className="pwa-install-action">
                        <button
                          type="button"
                          className={`btn-pwa-install${isAppInstalled ? " is-installed" : ""}`}
                          onClick={() => void handleInstallApp()}
                          disabled={isAppInstalled}
                          aria-live="polite"
                        >
                          {isAppInstalled ? <IconCheck className="icon-xs" /> : <IconDownload className="icon-xs" />}
                          <span>{isAppInstalled ? t.settings_pwa_installed : t.btn_install_app}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* Workspace Footer */}
          <footer className={`app-footer ${activeTab === "time" ? "is-hidden-time" : ""}`}>
            <div className="footer-left">
              <span className="footer-brand">MyPlan</span>
              <span className="footer-separator">•</span>
              <span className="footer-tagline">{t.footer_tagline}</span>
            </div>
            <div className="footer-right">
              <span>© 2026 MyPlan Inc.</span>
            </div>
          </footer>
        </main>

        {/* Mobile & Tablet Bottom Navigation Bar */}
        <nav className="mobile-bottom-nav" aria-label="Mobil navigatsiya">
          <button
            type="button"
            className={`bottom-nav-item ${activeTab === "today" ? "active" : ""}`}
            onClick={() => setActiveTab("today")}
          >
            <IconCalendar className="bottom-nav-icon" />
            <span>{t.tab_today}</span>
          </button>

          {/* The catalog is not in the bottom bar: it lives in the side menu (burger). */}
          <button
            type="button"
            className={`bottom-nav-item ${activeTab === "time" ? "active" : ""}`}
            onClick={() => setActiveTab("time")}
          >
            <IconClock className="bottom-nav-icon" />
            <span>{t.tab_time}</span>
          </button>

          {/* Center Floating Plus Button */}
          <button
            type="button"
            className="bottom-nav-create"
            onClick={openCreateModal}
            aria-label="Vazifa qo‘shish"
            title="Vazifa qo‘shish"
          >
            <IconPlus className="icon-md" />
          </button>

          <button
            type="button"
            className={`bottom-nav-item ${activeTab === "notifications" ? "active" : ""}`}
            onClick={() => setActiveTab("notifications")}
          >
            <IconBell className="bottom-nav-icon" />
            <span>{t.tab_notifications}</span>
            {unreadNotifsCount > 0 && <span className="mobile-unread-dot" />}
          </button>

          <button
            type="button"
            className={`bottom-nav-item ${activeTab === "profile" ? "active" : ""}`}
            onClick={() => setActiveTab("profile")}
          >
            <IconUser className="bottom-nav-icon" />
            <span>{t.tab_profile}</span>
          </button>
        </nav>
      </div>
    </div>
  );
}
