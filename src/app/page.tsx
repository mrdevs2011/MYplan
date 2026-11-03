"use client";

import { useState, useEffect, useCallback, useMemo, useRef, type FormEvent, type ChangeEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
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
} from "@/components/icons";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type TabType = "today" | "activities" | "notifications" | "analytics" | "profile" | "settings";

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

interface Activity {
  id: string;
  title: string;
  description: string | null;
  schedule_type: "daily" | "once";
  measurement_type: "check" | "count";
  target: number | null;
  unit: string | null;
  is_active: boolean;
  starts_on: string;
}

interface Occurrence {
  id: string;
  activity_id: string;
  due_date: string;
  status: "pending" | "completed";
}

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

const dateLabel = new Intl.DateTimeFormat("uz-UZ", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

export default function Home() {
  const router = useRouter();

  // Authentication & User State
  const [userId, setUserId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [accountName, setAccountName] = useState("");
  const [accountUsername, setAccountUsername] = useState("");
  const [userAge, setUserAge] = useState<string | number>("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // App Data
  const [activities, setActivities] = useState<Activity[]>([]);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [taskCounts, setTaskCounts] = useState<Record<string, number>>({});
  const [taskHistory, setTaskHistory] = useState<Record<string, number[]>>({});
  const [loadingData, setLoadingData] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  // Navigation & Tabs
  const [activeTab, setActiveTab] = useState<TabType>("today");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Settings states
  const [language, setLanguage] = useState<"uz" | "en" | "ru">("uz");
  const [theme, setTheme] = useState<"dark" | "light" | "system">("dark");
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Splash Screen States (Guaranteed 100% Logo Preload)
  const [splashReady, setSplashReady] = useState(false);
  const [splashFading, setSplashFading] = useState(false);

  // Multi-Account Management (Max 5 accounts)
  const [savedAccounts, setSavedAccounts] = useState<UserAccount[]>([]);

  // Notifications System (3-Day Read-Only History)
  const [notifications, setNotifications] = useState<MyPlanNotification[]>([]);
  const [activeToast, setActiveToast] = useState<MyPlanNotification | null>(null);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>("default");

  // PWA State
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isAppInstalled, setIsAppInstalled] = useState(false);

  // Floating Modal for Task Creation
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createTaskKind, setCreateTaskKind] = useState<"check" | "count">("check");
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newSchedule, setNewSchedule] = useState<"daily" | "once">("daily");
  const [countTarget, setCountTarget] = useState("");
  const [countUnit, setCountUnit] = useState("marta");
  const [debouncedCountError, setDebouncedCountError] = useState("");

  // Catalog Filters (Tab 2)
  const [catalogFilter, setCatalogFilter] = useState<"all" | "active" | "archived">("all");
  const [catalogSearch, setCatalogSearch] = useState("");

  // 10-Second Inactivity Collapse Logic for Counter Buttons
  // When a button becomes invisible (+10 or +5), it holds its space until 10 seconds of no interaction passes
  const [collapsedCounters, setCollapsedCounters] = useState<Record<string, boolean>>({});
  const counterTimersRef = useRef<Record<string, NodeJS.Timeout>>({});
  const [formattedToday, setFormattedToday] = useState("");

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

  // Load Workspace Data
  const loadWorkspace = useCallback(async (id: string) => {
    setLoadingData(true);
    const supabase = createClient();
    try {
      const [{ data: profile }, { data: activityRows, error: activityError }] = await Promise.all([
        supabase.from("profiles").select("username, full_name").eq("id", id).maybeSingle(),
        supabase
          .from("activities")
          .select("id,title,description,schedule_type,measurement_type,target,unit,is_active,starts_on")
          .eq("user_id", id)
          .order("created_at", { ascending: false }),
      ]);

      if (activityError) throw activityError;
      const acts = (activityRows || []) as Activity[];
      setActivities(acts);

      if (profile) {
        setAccountName(profile.full_name || profile.username || "");
        setAccountUsername(profile.username || "");
      }

      // Load today's occurrences
      const todayStr = today();
      const { data: occRows, error: occError } = await supabase
        .from("occurrences")
        .select("id,activity_id,due_date,status")
        .eq("user_id", id)
        .eq("due_date", todayStr);

      if (occError) throw occError;

      const existingOccs = (occRows || []) as Occurrence[];
      const missingActivities = acts.filter(
        (a) => a.is_active && !existingOccs.some((o) => o.activity_id === a.id)
      );

      if (missingActivities.length > 0) {
        const inserts = missingActivities.map((a) => ({
          user_id: id,
          activity_id: a.id,
          due_date: todayStr,
          status: "pending" as const,
        }));
        const { data: newOccs, error: insertError } = await supabase
          .from("occurrences")
          .insert(inserts)
          .select("id,activity_id,due_date,status");
        if (!insertError && newOccs) {
          setOccurrences([...existingOccs, ...(newOccs as Occurrence[])]);
        } else {
          setOccurrences(existingOccs);
        }
      } else {
        setOccurrences(existingOccs);
      }

      // Restore saved counts from local storage
      const initialCounts: Record<string, number> = {};
      existingOccs.forEach((occ) => {
        const saved = localStorage.getItem(`myplan_count_${occ.id}`);
        if (saved !== null) {
          initialCounts[occ.id] = parseInt(saved, 10) || 0;
        }
      });
      setTaskCounts(initialCounts);
    } catch (err) {
      console.error("Workspace loading error:", err);
    } finally {
      setLoadingData(false);
    }
  }, []);

  // Auth Initialization & Session Listener
  useEffect(() => {
    // 100% Guaranteed Splash Screen Preload
    if (typeof window !== "undefined") {
      const img = new window.Image();
      img.src = "/myplan-logo.png";
      const minTimer = new Promise((resolve) => setTimeout(resolve, 850));
      const imgLoaded = img.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
            img.onload = resolve;
            img.onerror = resolve;
          });

      void Promise.all([imgLoaded, minTimer]).then(() => {
        setSplashFading(true);
        setTimeout(() => setSplashReady(true), 350);
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
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        const currentId = session.user.id;
        const currentName = String(
          session.user.user_metadata?.full_name || session.user.user_metadata?.username || ""
        );
        const currentUsername = String(session.user.user_metadata?.username || "");
        const currentAge = session.user.user_metadata?.age || "";

        setUserId(currentId);
        setAccountName(currentName);
        setAccountUsername(currentUsername);
        setUserAge(currentAge);
        setAuthReady(true);
        void loadWorkspace(currentId);

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

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUserId(session.user.id);
        void loadWorkspace(session.user.id);
      } else {
        setUserId(null);
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

    if (typeof window !== "undefined") {
      if (
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone
      ) {
        setTimeout(() => setIsAppInstalled(true), 0);
      }
      window.addEventListener("beforeinstallprompt", handleBeforeInstall);
      window.addEventListener("appinstalled", handleAppInstalled);

      const savedTheme = (localStorage.getItem("myplan_theme") as "dark" | "light" | "system") || "dark";
      setTimeout(() => {
        setTheme(savedTheme);
        document.documentElement.setAttribute("data-theme", savedTheme);
      }, 0);

      const savedLang = (localStorage.getItem("myplan_lang") as "uz" | "en" | "ru") || "uz";
      setTimeout(() => {
        setLanguage(savedLang);
        setFormattedToday(dateLabel.format(new Date()));
      }, 0);

      // Notification History (3 days strictly, natural tone)
      const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      try {
        const rawNotifs = localStorage.getItem("myplan_notifications_history");
        let parsed: MyPlanNotification[] = rawNotifs ? JSON.parse(rawNotifs) : [];
        parsed = parsed.filter((n) => now - n.createdAt <= THREE_DAYS_MS);

        if (parsed.length === 0) {
          parsed = [
            {
              id: "notif-1",
              sender: "MyPlan Shaxsiy Yordamchisi",
              category: "daily",
              categoryLabel: "KUNLIK MARRA",
              title: "Bugungi kuningiz barakali bo‘lsin!",
              message:
                "Har bir yangi kun — yangi imkoniyat. Rejalaringizni aniq belgilang va birinchi vazifangizni boshlang.",
              createdAt: now - 1000 * 60 * 60 * 2,
              isRead: false,
            },
            {
              id: "notif-2",
              sender: "Intizom Kuzatuvchisi",
              category: "productivity",
              categoryLabel: "UNUMDORLIK",
              title: "Sanoqli vazifalaringiz monitoringi",
              message:
                "Kuningizdagi takrorlanuvchi amallarni bajargach, +10, +5 yoki +1 tugmalari orqali natijani qayd etishni unutmang.",
              createdAt: now - 1000 * 60 * 60 * 6,
              isRead: true,
            },
            {
              id: "notif-3",
              sender: "MyPlan Murabbiyi",
              category: "evening",
              categoryLabel: "KECHKI TAHLIL",
              title: "Kechagi unumdorlik xulosasi",
              message:
                "Kechagi barcha harakatlaringiz tizimda muhrlandi. Barqarorlik — eng katta yutuq kalitidir.",
              createdAt: now - 1000 * 60 * 60 * 26,
              isRead: true,
            },
            {
              id: "notif-4",
              sender: "MyPlan Tizimi",
              category: "streak",
              categoryLabel: "SHAXSIY O‘SISH",
              title: "Plan your day. Own your time.",
              message:
                "MyPlan platformasiga xush kelibsiz! Maqsadlaringiz sari intizomli qadam tashlayotganingizdan mamnunmiz.",
              createdAt: now - 1000 * 60 * 60 * 50,
              isRead: true,
            },
          ];
        }

        const withLabels = parsed.map((n) => {
          const diffHours = Math.round((now - n.createdAt) / (1000 * 60 * 60));
          let label = "Hozirgina";
          if (diffHours >= 1 && diffHours < 24) label = `${diffHours} soat oldin`;
          else if (diffHours >= 24) {
            const diffDays = Math.round(diffHours / 24);
            label = diffDays === 1 ? "Kecha" : `${diffDays} kun oldin`;
          }
          return { ...n, timeLabel: label };
        });

        localStorage.setItem("myplan_notifications_history", JSON.stringify(withLabels));
        setTimeout(() => setNotifications(withLabels), 0);

        const unread = withLabels.find((n) => !n.isRead);
        if (unread) {
          setTimeout(() => setActiveToast(unread), 2000);
        }
      } catch (err) {
        console.error("Notif init error:", err);
      }

      if ("Notification" in window) {
        setTimeout(() => setPushPermission(Notification.permission), 0);
      }
    }

    return () => {
      listener.subscription.unsubscribe();
      if (typeof window !== "undefined") {
        window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
        window.removeEventListener("appinstalled", handleAppInstalled);
      }
    };
  }, [loadWorkspace, router]);

  // Close modal on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && showCreateModal) {
        setShowCreateModal(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showCreateModal]);

  // PWA Install handler
  const handleInstallApp = async () => {
    if (!deferredPrompt) {
      alert("Ilovani brauzer menyusi orqali o‘rnatishingiz mumkin (Ulashish -> Bosh ekranga qo‘shish).");
      return;
    }
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setIsAppInstalled(true);
      setDeferredPrompt(null);
    }
  };

  // Toggle complete for normal checklist tasks (Tab 1 ONLY)
  async function toggleComplete(activity: Activity) {
    if (!userId) return;
    const occ = occurrences.find((item) => item.activity_id === activity.id);
    if (!occ) return;

    const nextStatus = occ.status === "completed" ? "pending" : "completed";
    setOccurrences((curr) =>
      curr.map((item) => (item.id === occ.id ? { ...item, status: nextStatus } : item))
    );

    if (activity.measurement_type === "count" && activity.target) {
      const newCount = nextStatus === "completed" ? activity.target : 0;
      setTaskCounts((prev) => ({ ...prev, [occ.id]: newCount }));
      localStorage.setItem(`myplan_count_${occ.id}`, String(newCount));
    }

    const supabase = createClient();
    await supabase.from("occurrences").update({ status: nextStatus }).eq("id", occ.id).eq("user_id", userId);
  }

  // Counter Increment (+1, +5, +10) with 10-Second Inactivity Collapse Logic
  async function incrementTaskCount(activity: Activity, occurrence: Occurrence, amount: number) {
    if (!userId) return;
    const current = taskCounts[occurrence.id] || 0;
    const target = activity.target || 0;
    const actualAdd = Math.min(amount, target - current);
    if (actualAdd <= 0) return;

    const next = current + actualAdd;

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

    setTaskCounts((prev) => ({ ...prev, [occurrence.id]: next }));
    setTaskHistory((prev) => ({
      ...prev,
      [occurrence.id]: [...(prev[occurrence.id] || []), actualAdd],
    }));

    if (typeof window !== "undefined") {
      localStorage.setItem(`myplan_count_${occurrence.id}`, String(next));
    }

    // Auto complete when target is reached
    if (next >= target && occurrence.status !== "completed") {
      setOccurrences((curr) =>
        curr.map((item) => (item.id === occurrence.id ? { ...item, status: "completed" } : item))
      );
      await createClient()
        .from("occurrences")
        .update({ status: "completed" })
        .eq("id", occurrence.id)
        .eq("user_id", userId);
    }
  }

  // Counter Undo: restores previous step, clears 10-second timer and restores button positions immediately
  async function undoTaskCount(activity: Activity, occurrence: Occurrence) {
    if (!userId) return;
    const history = taskHistory[occurrence.id] || [];
    if (history.length === 0) return;

    const lastAdd = history[history.length - 1];
    const newHistory = history.slice(0, -1);
    const current = taskCounts[occurrence.id] || 0;
    const next = Math.max(0, current - lastAdd);

    // Cancel 10s timer and un-collapse space immediately on undo
    if (counterTimersRef.current[occurrence.id]) {
      clearTimeout(counterTimersRef.current[occurrence.id]);
    }
    setCollapsedCounters((prev) => ({ ...prev, [occurrence.id]: false }));

    setTaskCounts((prev) => ({ ...prev, [occurrence.id]: next }));
    setTaskHistory((prev) => ({ ...prev, [occurrence.id]: newHistory }));

    if (typeof window !== "undefined") {
      localStorage.setItem(`myplan_count_${occurrence.id}`, String(next));
    }

    if (next < (activity.target || 0) && occurrence.status === "completed") {
      setOccurrences((curr) =>
        curr.map((item) => (item.id === occurrence.id ? { ...item, status: "pending" } : item))
      );
      await createClient()
        .from("occurrences")
        .update({ status: "pending" })
        .eq("id", occurrence.id)
        .eq("user_id", userId);
    }
  }

  // Archive activity
  async function archiveActivity(id: string, newActiveState = false) {
    if (!userId) return;
    const supabase = createClient();
    const { error } = await supabase.from("activities").update({ is_active: newActiveState }).eq("id", id).eq("user_id", userId);
    if (!error) {
      await loadWorkspace(userId);
    }
  }

  // Multi-Account Operations (Switch Account & Add Account, max 5)
  const switchAccount = (targetAccount: UserAccount) => {
    setUserId(targetAccount.id);
    setAccountName(targetAccount.fullName);
    setAccountUsername(targetAccount.username);
    setUserAge(targetAccount.age || "");
    const savedAvatar = typeof window !== "undefined" ? localStorage.getItem(`myplan_avatar_${targetAccount.id}`) : null;
    setAvatarUrl(savedAvatar || targetAccount.avatarUrl || null);
    if (typeof window !== "undefined") {
      localStorage.setItem("myplan_active_account_id", targetAccount.id);
    }
    void loadWorkspace(targetAccount.id);
  };

  const handleAddAccount = () => {
    if (savedAccounts.length >= 5) {
      alert("Maksimal 5 ta hisob chegarasiga yetildi.");
      return;
    }
    if (typeof window !== "undefined") {
      localStorage.setItem("myplan_add_account_intent", "true");
    }
    router.push("/login");
  };

  // Sign out (Switches to another connected account if present, or logs out to /login)
  async function handleSignOut() {
    try {
      if (typeof window !== "undefined") {
        const rawVault = localStorage.getItem("myplan_accounts_vault");
        const vault: UserAccount[] = rawVault ? JSON.parse(rawVault) : [];
        const remaining = vault.filter((acc) => acc.id !== userId);
        localStorage.setItem("myplan_accounts_vault", JSON.stringify(remaining));
        setSavedAccounts(remaining);

        if (remaining.length > 0) {
          const nextAcc = remaining[0];
          switchAccount(nextAcc);
          return;
        }
      }

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
    const updated = notifications.map((n) => (n.id === id ? { ...n, isRead: true } : n));
    setNotifications(updated);
    if (typeof window !== "undefined") {
      localStorage.setItem("myplan_notifications_history", JSON.stringify(updated));
    }
    if (activeToast?.id === id) {
      setActiveToast(null);
    }
  };

  const handleRequestPush = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      alert("Qurilmangizda push bildirishnomalari qo‘llab-quvvatlanmaydi.");
      return;
    }
    const perm = await Notification.requestPermission();
    setPushPermission(perm);
    if (perm === "granted") {
      new Notification("MyPlan Bildirishnomalari", {
        body: "Tabriklaymiz! Endi siz muhim eslatma va tavsiyalarni o‘z vaqtida qabul qilasiz.",
        icon: "/icon.png",
      });
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
        }
      }
    };
    reader.readAsDataURL(file);
  };

  // Create new activity
  async function createActivity(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!userId || !newTitle.trim()) return;

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

    setBusy(true);
    setMessage("");
    try {
      const supabase = createClient();
      const { error } = await supabase.from("activities").insert({
        user_id: userId,
        title: newTitle.trim(),
        description: newDescription.trim(),
        schedule_type: newSchedule,
        schedule_rule: {},
        measurement_type: createTaskKind,
        target: targetValue,
        unit: unitValue,
        starts_on: today(),
      });
      if (error) throw error;
      setNewTitle("");
      setNewDescription("");
      setCountTarget("");
      setCreateTaskKind("check");
      setShowCreateModal(false);
      await loadWorkspace(userId);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Faoliyatni saqlashda xatolik yuz berdi.");
    } finally {
      setBusy(false);
    }
  }

  // Theme change
  const handleThemeChange = (newTheme: "dark" | "light" | "system") => {
    setTheme(newTheme);
    localStorage.setItem("myplan_theme", newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
  };

  // Language change
  const handleLanguageChange = (newLang: "uz" | "en" | "ru") => {
    setLanguage(newLang);
    localStorage.setItem("myplan_lang", newLang);
  };

  // Calculations for Today's Execution
  const activeActivities = useMemo(() => activities.filter((a) => a.is_active), [activities]);
  const completedCount = useMemo(
    () => occurrences.filter((item) => item.status === "completed").length,
    [occurrences]
  );
  const percent = activeActivities.length ? Math.round((completedCount / activeActivities.length) * 100) : 0;

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

  const parsedTargetNum = parseInt(countTarget, 10);
  const isTargetInvalid = createTaskKind === "count" && (isNaN(parsedTargetNum) || parsedTargetNum < 2 || parsedTargetNum > 99999);
  const isSaveDisabled = busy || !newTitle.trim() || isTargetInvalid || Boolean(debouncedCountError);

  // Splash Screen: 100% Guaranteed Preload & Display before fade-out
  if (!authReady || !splashReady) {
    return (
      <main className={`loading-screen ${splashFading ? "is-fading-out" : ""}`} aria-busy="true" aria-label="MyPlan">
        <div className="loading-card">
          <Image
            className="loading-logo"
            src="/myplan-logo.png"
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
      {activeToast && (
        <aside className="floating-inapp-toast" role="alert" aria-live="polite">
          <div className="toast-left-wrap">
            <span className="toast-icon-badge">
              <IconBell className="icon-xs" />
            </span>
            <div className="toast-text-block">
              <span className="toast-title">{activeToast.title}</span>
              <p className="toast-msg">{activeToast.message}</p>
            </div>
          </div>
          <button
            type="button"
            className="toast-close-action"
            onClick={() => setActiveToast(null)}
            aria-label="Yopish"
          >
            <IconClose className="icon-xs" />
          </button>
        </aside>
      )}
      {/* Floating Modal for Task Creation (Popup Dialog) */}
      {showCreateModal && (
        <div
          className="floating-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowCreateModal(false);
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
                  <IconPlus className="icon-xs" /> YANGI REJA
                </span>
                <h3 id="modal-title">Yangi faoliyat qo‘shish</h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowCreateModal(false)}
                aria-label="Yopish"
                title="Yopish (Esc)"
              >
                <IconClose className="icon-sm" />
              </button>
            </div>

            {/* 2 Tabs: Bir martalik vs Sanoqli */}
            <div className="modal-tab-switch" role="tablist" aria-label="Vazifa turi">
              <button
                type="button"
                role="tab"
                aria-selected={createTaskKind === "check"}
                className={`modal-tab-btn ${createTaskKind === "check" ? "active" : ""}`}
                onClick={() => setCreateTaskKind("check")}
              >
                <IconCheck className="icon-sm" />
                <span>Bir martalik</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={createTaskKind === "count"}
                className={`modal-tab-btn ${createTaskKind === "count" ? "active" : ""}`}
                onClick={() => setCreateTaskKind("count")}
              >
                <IconHash className="icon-sm" />
                <span>Sanoqli maqsad</span>
              </button>
            </div>

            <form className="modal-form" onSubmit={createActivity}>
              <div className="form-group">
                <label htmlFor="modal-task-title">Faoliyat nomi *</label>
                <input
                  id="modal-task-title"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder={
                    createTaskKind === "check"
                      ? "Masalan: Kitob o‘qish yoki dori qabul qilish"
                      : "Masalan: Mashq bajarish yoki piyoda qadam bosish"
                  }
                  maxLength={160}
                  required
                  autoFocus
                />
              </div>

              {/* Sanoqli tab input */}
              {createTaskKind === "count" && (
                <div className="form-group count-target-group">
                  <label htmlFor="count-target">Kunlik rejalashtirilgan miqdor *</label>
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
                      placeholder="Masalan: 100"
                      maxLength={5}
                      required
                    />
                    <select
                      className="count-unit-select"
                      value={countUnit}
                      onChange={(e) => setCountUnit(e.target.value)}
                      title="O‘lchov birligi"
                    >
                      <option value="marta">marta</option>
                      <option value="ta">ta</option>
                      <option value="bet">bet</option>
                      <option value="qadam">qadam</option>
                      <option value="daqiqa">daqiqa</option>
                    </select>
                  </div>

                  {debouncedCountError && (
                    <p className="count-validation-error" role="alert">
                      ⚠️ {debouncedCountError}
                    </p>
                  )}
                  <p className="count-hint">Maksimal 5 xonali son (2 dan 99,999 gacha qabul qilinadi).</p>
                </div>
              )}

              <div className="form-group">
                <label htmlFor="modal-task-desc">Izoh (ixtiyoriy)</label>
                <input
                  id="modal-task-desc"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Qo‘shimcha eslatma yoki maqsad tafsiloti"
                  maxLength={250}
                />
              </div>

              <div className="form-group">
                <label htmlFor="modal-schedule">Takrorlanish tartibi</label>
                <select
                  id="modal-schedule"
                  value={newSchedule}
                  onChange={(e) => setNewSchedule(e.target.value as "daily" | "once")}
                >
                  <option value="daily">Har kuni takrorlansin</option>
                </select>
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-modal-cancel"
                  onClick={() => setShowCreateModal(false)}
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  className="btn-modal-submit"
                  disabled={isSaveDisabled}
                >
                  {busy ? "Saqlanmoqda…" : "Rejani saqlash"}
                </button>
              </div>
            </form>
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
                <Image className="brand-logo" src="/myplan-logo.png" alt="MyPlan" width={36} height={36} priority />
                <span className="brand-title">MyPlan</span>
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
              <Image className="brand-logo" src="/myplan-logo.png" alt="MyPlan" width={36} height={36} priority />
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
              setShowCreateModal(true);
              setMobileMenuOpen(false);
            }}
            aria-label="Yangi vazifa qo‘shish"
            title="Yangi vazifa qo‘shish"
          >
            <IconPlus className="icon-sm" />
            <span className="btn-add-text">Yangi reja</span>
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="sidebar-nav-group">
          <span className="nav-caption">ISH MAYDONI</span>
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
              <span className="nav-label">Bugungi reja</span>
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
              <span className="nav-label">Faoliyatlarim</span>
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
              <span className="nav-label">Bildirishnomalar</span>
              {unreadNotifsCount > 0 && <span className="nav-unread-pill">{unreadNotifsCount}</span>}
              {activeTab === "notifications" && <span className="active-indicator" />}
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
              <span className="nav-label">Statistika</span>
              {activeTab === "analytics" && <span className="active-indicator" />}
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
              <span className="nav-label">Profilim</span>
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
              <span className="nav-label">Sozlamalar</span>
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
              title="Ilovani o‘rnatish"
            >
              <IconDownload className="icon-sm" />
              <span className="btn-add-text">Ilovani o‘rnatish</span>
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
            title="Tizimdan chiqish"
          >
            <IconLogOut className="icon-sm" />
            <span className="logout-text">Chiqish</span>
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
          >
            <Image src="/myplan-logo.png" alt="MyPlan" width={28} height={28} priority />
            <span>MyPlan</span>
          </button>

          <button
            type="button"
            className="mobile-avatar-btn"
            onClick={() => setActiveTab("profile")}
            title="Profil"
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
        </header>

        <main className="content-container">
          {/* Header Bar Distinct for Each Tab */}
          <header className="page-header">
            <div className="header-text">
              {activeTab === "today" && (
                <>
                  <span className="page-kicker">
                    <IconSparkles className="icon-xs" /> KUNLIK AMALLAR
                  </span>
                  <h1 className="page-title">Bugungi reja</h1>
                  <p className="page-subtitle">Bugungi rejalaringiz monitoringi{formattedToday ? ` · ${formattedToday}` : ""}</p>
                </>
              )}
              {activeTab === "activities" && (
                <>
                  <span className="page-kicker">
                    <IconList className="icon-xs" /> TIZIMLI BOSHQARUV
                  </span>
                  <h1 className="page-title">Faoliyatlar katalogi</h1>
                  <p className="page-subtitle">Barcha rejalashtirilgan odatlar va faoliyatlaringiz ro‘yxati</p>
                </>
              )}
              {activeTab === "notifications" && (
                <>
                  <span className="page-kicker">
                    <IconBell className="icon-xs" /> BILDIRISHNOMALAR MARKAZI
                  </span>
                  <h1 className="page-title">Xabarlar va Eslatmalar</h1>
                  <p className="page-subtitle">So‘nggi 3 kunlik faoliyat xulosalari va tizim maslahatlari</p>
                </>
              )}
              {activeTab === "analytics" && (
                <>
                  <span className="page-kicker">
                    <IconBarChart className="icon-xs" /> TARAQQIYOT KO‘ZGUSI
                  </span>
                  <h1 className="page-title">Samaradorlik statistikasi</h1>
                  <p className="page-subtitle">Ko‘rsatkichlaringiz tahlili va shaxsiy unumdorlik dinamikasi</p>
                </>
              )}
              {activeTab === "profile" && (
                <>
                  <span className="page-kicker">
                    <IconUser className="icon-xs" /> SHAXSIY HISOB
                  </span>
                  <h1 className="page-title">Foydalanuvchi profili</h1>
                  <p className="page-subtitle">Shaxsiy hisob ma’lumotlari va xavfsizlik holati</p>
                </>
              )}
              {activeTab === "settings" && (
                <>
                  <span className="page-kicker">
                    <IconSettings className="icon-xs" /> TIZIM PARAMETRLARI
                  </span>
                  <h1 className="page-title">Ilova sozlamalari</h1>
                  <p className="page-subtitle">Interfeys tili, vizual mavzu va qulaylik parametrlarini boshqaring</p>
                </>
              )}
            </div>
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
              <section className="stats-grid" aria-label="Bugungi ko‘rsatkichlar">
                <article className="stat-card progress-card">
                  <div className="stat-header">
                    <span className="stat-tag">BUGUNGI NATIJA</span>
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
                    <strong className="text-lime">{completedCount}</strong> ta bajarildi ·{" "}
                    <strong>{Math.max(activeActivities.length - completedCount, 0)}</strong> ta qoldi
                  </p>
                </article>

                <article className="stat-card">
                  <div className="stat-header">
                    <span className="stat-tag">FAOL REJALAR</span>
                    <IconList className="stat-icon" />
                  </div>
                  <div className="stat-value-row">
                    <span className="stat-value">{activeActivities.length.toString().padStart(2, "0")}</span>
                  </div>
                  <p className="stat-footer">Bugun uchun belgilangan amallar</p>
                </article>

                <article className="stat-card">
                  <div className="stat-header">
                    <span className="stat-tag">YAKUNLANDI</span>
                    <IconTrendUp className="stat-icon text-lime" />
                  </div>
                  <div className="stat-value-row">
                    <span className="stat-value text-lime">{completedCount.toString().padStart(2, "0")}</span>
                  </div>
                  <p className="stat-footer">Muvaffaqiyatli yakunlangan amallar</p>
                </article>
              </section>

              {/* Tasks Execution List */}
              <section className="tasks-section">
                <div className="section-header-bar">
                  <div>
                    <span className="section-sub">KUNLIK VAZIFALAR</span>
                    <h2 className="section-heading">Amallar ijrosi</h2>
                  </div>
                </div>

                {loadingData ? (
                  <div className="empty-state-box">
                    <div className="loading-spinner" />
                    <p>Ma’lumotlar yangilanmoqda…</p>
                  </div>
                ) : activeActivities.length === 0 ? (
                  <div className="empty-state-box">
                    <div className="empty-icon-wrap">
                      <IconCalendar className="icon-lg" />
                    </div>
                    <h3>Bugun uchun faol vazifalar yo‘q</h3>
                    <p>Yangi vazifa qo‘shish uchun chap paneldagi (yoki pastdagi) <strong>+</strong> tugmasidan foydalaning.</p>
                  </div>
                ) : (
                  <div className="task-items-list">
                    {activeActivities.map((activity) => {
                      const occ = occurrences.find((o) => o.activity_id === activity.id);
                      const isDone = occ?.status === "completed";
                      const target = activity.target || 0;
                      const current = taskCounts[occ?.id || ""] ?? (isDone ? target : 0);
                      const remaining = Math.max(target - current, 0);

                      // 10s inactivity collapse state
                      const isSpaceCollapsed = Boolean(collapsedCounters[occ?.id || ""]);

                      return (
                        <article
                          key={activity.id}
                          className={`task-card ${isDone ? "is-completed" : ""}`}
                        >
                          <button
                            type="button"
                            className="checkbox-btn"
                            aria-label={isDone ? "Bajarilmadi deb belgilash" : "Bajarildi deb belgilash"}
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
                                    <strong>{current}</strong> / {target} {activity.unit || "marta"}
                                  </span>
                                  <span className="task-remaining-text">
                                    {isDone ? "Bajarildi" : `${remaining} ta qoldi`}
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
                                      {/* +10 Button */}
                                      <button
                                        type="button"
                                        className={`btn-counter-inc ${
                                          remaining >= 10 && !isDone
                                            ? "btn-visible"
                                            : isSpaceCollapsed
                                            ? "btn-hidden-collapsed"
                                            : "btn-hidden-hold-space"
                                        }`}
                                        onClick={() => void incrementTaskCount(activity, occ, 10)}
                                        title="10 ta qo‘shish"
                                      >
                                        +10
                                      </button>

                                      {/* +5 Button */}
                                      <button
                                        type="button"
                                        className={`btn-counter-inc ${
                                          remaining >= 5 && !isDone
                                            ? "btn-visible"
                                            : isSpaceCollapsed
                                            ? "btn-hidden-collapsed"
                                            : "btn-hidden-hold-space"
                                        }`}
                                        onClick={() => void incrementTaskCount(activity, occ, 5)}
                                        title="5 ta qo‘shish"
                                      >
                                        +5
                                      </button>

                                      {/* +1 Button */}
                                      <button
                                        type="button"
                                        className={`btn-counter-inc primary ${
                                          remaining >= 1 && !isDone
                                            ? "btn-visible"
                                            : isSpaceCollapsed
                                            ? "btn-hidden-collapsed"
                                            : "btn-hidden-hold-space"
                                        }`}
                                        onClick={() => void incrementTaskCount(activity, occ, 1)}
                                        title="1 ta qo‘shish"
                                      >
                                        +1
                                      </button>
                                    </div>

                                    {/* Undo Button */}
                                    {(taskHistory[occ.id]?.length || 0) > 0 && (
                                      <button
                                        type="button"
                                        className="btn-counter-undo"
                                        onClick={() => void undoTaskCount(activity, occ)}
                                        title="Oxirgi amalni qaytarish"
                                      >
                                        <IconUndo className="icon-xs" />
                                        <span>Qaytarish (-{taskHistory[occ.id].slice(-1)[0]})</span>
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}

                            <div className="task-meta">
                              <span className="schedule-badge daily">HAR KUNI</span>
                              {activity.measurement_type === "count" && (
                                <span className="task-kind-badge">
                                  <IconHash className="icon-xs" /> Sanoqli
                                </span>
                              )}
                            </div>
                          </div>
                        </article>
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
                <div className="section-header-bar">
                  <div>
                    <span className="section-sub">REJALAR BOSHQARUVI</span>
                    <h2 className="section-heading">Barcha faoliyatlar</h2>
                  </div>

                  {/* Filter Tabs */}
                  <div className="catalog-filters-bar">
                    <button
                      type="button"
                      className={`catalog-filter-btn ${catalogFilter === "all" ? "active" : ""}`}
                      onClick={() => setCatalogFilter("all")}
                    >
                      Barchasi ({activities.length})
                    </button>
                    <button
                      type="button"
                      className={`catalog-filter-btn ${catalogFilter === "active" ? "active" : ""}`}
                      onClick={() => setCatalogFilter("active")}
                    >
                      Faol ({activities.filter((a) => a.is_active).length})
                    </button>
                    <button
                      type="button"
                      className={`catalog-filter-btn ${catalogFilter === "archived" ? "active" : ""}`}
                      onClick={() => setCatalogFilter("archived")}
                    >
                      Arxivda ({activities.filter((a) => !a.is_active).length})
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
                    placeholder="Faoliyat nomi yoki tavsifi bo‘yicha qidirish…"
                  />
                  {catalogSearch && (
                    <button
                      type="button"
                      className="search-clear-btn"
                      onClick={() => setCatalogSearch("")}
                      aria-label="Tozalash"
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
                    <h3>Mos faoliyatlar topilmadi</h3>
                    <p>Qidiruv shartlarini o‘zgartirib ko‘ring yoki yangi faoliyat qo‘shing.</p>
                  </div>
                ) : (
                  <div className="catalog-cards-grid">
                    {filteredCatalogActivities.map((act) => (
                      <article key={act.id} className={`catalog-card ${!act.is_active ? "is-archived" : ""}`}>
                        <div className="catalog-card-header">
                          <span className={`status-pill ${act.is_active ? "active" : "archived"}`}>
                            {act.is_active ? "Faol" : "Arxivlangan"}
                          </span>
                          <span className="schedule-badge daily">HAR KUNI</span>
                        </div>

                        <h3 className="catalog-card-title">{act.title}</h3>
                        {act.description && (
                          <p className="catalog-card-desc">{act.description}</p>
                        )}

                        <div className="catalog-card-details">
                          <div className="detail-row">
                            <span className="detail-label">Turi:</span>
                            <span className="detail-value">
                              {act.measurement_type === "count"
                                ? `Sanoqli (${act.target} ${act.unit || "marta"})`
                                : "Oddiy belgilash"}
                            </span>
                          </div>
                          <div className="detail-row">
                            <span className="detail-label">Boshlangan:</span>
                            <span className="detail-value">{act.starts_on}</span>
                          </div>
                        </div>

                        <div className="catalog-card-actions">
                          <button
                            type="button"
                            className={`btn-catalog-archive ${!act.is_active ? "unarchive" : ""}`}
                            onClick={() => void archiveActivity(act.id, !act.is_active)}
                          >
                            <IconArchive className="icon-xs" />
                            <span>{act.is_active ? "Arxivlash" : "Faollashtirish"}</span>
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
                    <span className="section-sub">SO‘NGGI 3 KUNLIK ARXIV</span>
                    <h2 className="section-heading">Bildirishnomalar tarixi ({notifications.length})</h2>
                  </div>
                  <div className="notifications-immutable-badge">
                    <IconShield className="icon-xs" /> O‘zgartirib bo‘lmaydi (Read-only)
                  </div>
                </div>

                <div className="notifications-policy-banner">
                  <IconSparkles className="icon-sm text-lime" />
                  <p>
                    Ushbu bildirishnomalar sizning unumdorligingizni oshirish uchun shaxsiy yordamchi
                    tomonidan tabiiy shakllantiriladi va so‘nggi 3 kunlik xronologik tarix sifatida saqlanadi.
                  </p>
                </div>

                <div className="notifications-timeline">
                  {notifications.map((notif) => (
                    <article
                      key={notif.id}
                      className={`notification-card ${notif.isRead ? "is-read" : "is-unread"}`}
                      onClick={() => markNotificationAsRead(notif.id)}
                    >
                      <div className="notification-card-header">
                        <div className="notif-header-left">
                          <span className="sender-avatar-badge">M</span>
                          <span className="sender-name-text">{notif.sender}</span>
                          <span className={`notification-category-tag ${notif.category}`}>
                            {notif.categoryLabel}
                          </span>
                        </div>
                        <span className="notification-time-tag">
                          {notif.timeLabel || "Yaqinda"}
                        </span>
                      </div>

                      <div className="notification-content">
                        <h4 className="notification-item-title">{notif.title}</h4>
                        <p className="notification-item-message">{notif.message}</p>
                      </div>

                      <div className="notification-card-footer">
                        {!notif.isRead ? (
                          <span className="status-unread-pill">
                            <span className="pulse-dot-sm" /> Yangi
                          </span>
                        ) : (
                          <span className="status-read-pill">
                            <IconCheck className="icon-xs" /> O‘qilgan
                          </span>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          )}

          {/* TAB 3: STATISTIKA */}
          {activeTab === "analytics" && (
            <div key="tab-analytics" className="tab-pane-container">
              <section className="analytics-view">
                <div className="section-header-bar">
                  <div>
                    <span className="section-sub">TARAQQIYOT KO‘ZGUSI</span>
                    <h2 className="section-heading">Samaradorlik statistikasi</h2>
                  </div>
                </div>

                <div className="stats-grid">
                  <article className="stat-card progress-card">
                    <div className="stat-header">
                      <span className="stat-tag">BUGUNGI UNUMDORLIK</span>
                      <IconTarget className="stat-icon" />
                    </div>
                    <div className="stat-value-row">
                      <span className="stat-value">{percent}</span>
                      <span className="stat-unit">%</span>
                    </div>
                    <div className="progress-bar-track">
                      <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
                    </div>
                    <p className="stat-footer">{completedCount} ta amal muvaffaqiyatli yakunlandi</p>
                  </article>

                  <article className="stat-card">
                    <div className="stat-header">
                      <span className="stat-tag">JAMI FAOLIYATLAR</span>
                      <IconList className="stat-icon" />
                    </div>
                    <div className="stat-value-row">
                      <span className="stat-value">{activities.length.toString().padStart(2, "0")}</span>
                    </div>
                    <p className="stat-footer">Tizimga kiritilgan jami rejalar</p>
                  </article>

                  <article className="stat-card">
                    <div className="stat-header">
                      <span className="stat-tag">FAOL REJALAR</span>
                      <IconTrendUp className="stat-icon text-lime" />
                    </div>
                    <div className="stat-value-row">
                      <span className="stat-value text-lime">{activeActivities.length.toString().padStart(2, "0")}</span>
                    </div>
                    <p className="stat-footer">Hozirda ijro etilayotgan maqsadlar</p>
                  </article>
                </div>

                <div className="analytics-insight-card">
                  <div className="insight-badge">
                    <IconSparkles className="icon-xs" /> TAVSIYA
                  </div>
                  <h3>Barqarorlik — muvaffaqiyat kaliti</h3>
                  <p>
                    Rejalaringizni har kuni bir xil vaqtda bajarishga odatlaning. Hatto kichik 1% lik
                    yutuq ham bir yil ichida 37 barobar kattaroq natijaga aylanadi.
                  </p>
                </div>
              </section>
            </div>
          )}

          {/* TAB 4: PROFIL (READ-ONLY) */}
          {activeTab === "profile" && (
            <div key="tab-profile" className="tab-pane-container">
              <section className="profile-view">
                <div className="section-header-bar">
                  <div>
                    <span className="section-sub">SHAXSIY HISOB</span>
                    <h2 className="section-heading">Foydalanuvchi ma’lumotlari</h2>
                  </div>
                </div>

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

                  <div className="profile-notice-box">
                    <IconShield className="icon-sm text-lime" />
                    <p>
                      <strong>Xavfsizlik eslatmasi:</strong> Shaxsiy hisob ma’lumotlaringiz xavfsizlikni
                      ta’minlash maqsadida faqat ko‘rish rejimida saqlanadi.
                    </p>
                  </div>

                  {/* Multi-Account Management (Switch Account & Add Account, max 5) */}
                  <div className="profile-accounts-block">
                    <div className="accounts-header-row">
                      <div>
                        <h4>Bog‘langan hisoblar</h4>
                        <p>Bitta qurilmada 5 tagacha profilni boshqaring va ularga tezda o‘ting</p>
                      </div>
                      <span className="accounts-count-badge">{savedAccounts.length} / 5 hisob</span>
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
                                  <IconCheck className="icon-xs" /> Faol profil
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className="btn-account-switch"
                                  onClick={() => switchAccount(acc)}
                                >
                                  O‘tish
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
                          <span>Yangi hisob qo‘shish ({savedAccounts.length}/5)</span>
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
                <div className="section-header-bar">
                  <div>
                    <span className="section-sub">TIZIM PARAMETRLARI</span>
                    <h2 className="section-heading">Ilova sozlamalari</h2>
                  </div>
                </div>

                <div className="settings-sections-list">
                  {/* Language Settings */}
                  <div className="settings-card">
                    <div className="settings-card-header">
                      <IconGlobe className="icon-sm text-lime" />
                      <div>
                        <h3>Interfeys tili</h3>
                        <p>Ilova interfeysi va barcha ko‘rsatkichlar tili</p>
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
                        <h3>Interfeys mavzusi</h3>
                        <p>Ko‘zga qulay ranglar palitrasi</p>
                      </div>
                    </div>
                    <div className="settings-options-grid">
                      <button
                        type="button"
                        className={`setting-choice-btn ${theme === "dark" ? "active" : ""}`}
                        onClick={() => handleThemeChange("dark")}
                      >
                        <IconMoon className="icon-xs" />
                        <span>Qorong‘i rejim</span>
                        {theme === "dark" && <IconCheck className="icon-xs text-lime" />}
                      </button>
                      <button
                        type="button"
                        className={`setting-choice-btn ${theme === "light" ? "active" : ""}`}
                        onClick={() => handleThemeChange("light")}
                      >
                        <IconSun className="icon-xs" />
                        <span>Yorug‘ rejim</span>
                        {theme === "light" && <IconCheck className="icon-xs text-lime" />}
                      </button>
                      <button
                        type="button"
                        className={`setting-choice-btn ${theme === "system" ? "active" : ""}`}
                        onClick={() => handleThemeChange("system")}
                      >
                        <IconSettings className="icon-xs" />
                        <span>Tizim sozlamasi</span>
                        {theme === "system" && <IconCheck className="icon-xs text-lime" />}
                      </button>
                    </div>
                  </div>

                  {/* Sound & Notifications */}
                  <div className="settings-card">
                    <div className="settings-card-header">
                      <IconSparkles className="icon-sm text-lime" />
                      <div>
                        <h3>Bildirishnomalar va ovoz</h3>
                        <p>Amallarni bajarishdagi tovushli eslatmalar</p>
                      </div>
                    </div>
                    <div className="settings-toggle-row">
                      <span>Vazifa bajarilganda tovushli signal</span>
                      <button
                        type="button"
                        className={`toggle-switch-btn ${soundEnabled ? "on" : "off"}`}
                        onClick={() => setSoundEnabled((prev) => !prev)}
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
                        <h3>Push bildirishnomalar</h3>
                        <p>Qurilmangiz ekraniga muhim eslatma va tavsiyalar yetkazish</p>
                      </div>
                    </div>
                    <div className="settings-toggle-row">
                      <span>Brauzer bildirishnomalari</span>
                      <button
                        type="button"
                        className={`setting-choice-btn ${pushPermission === "granted" ? "active" : ""}`}
                        onClick={() => void handleRequestPush()}
                        style={{ width: "auto", padding: "8px 16px" }}
                      >
                        {pushPermission === "granted" ? "Ruxsat berilgan" : "Ruxsat berish"}
                      </button>
                    </div>
                  </div>

                  {/* PWA Section */}
                  <div className="settings-card">
                    <div className="settings-card-header">
                      <IconDownload className="icon-sm text-lime" />
                      <div>
                        <h3>Ilova va qurilma (PWA)</h3>
                        <p>MyPlan ilovasini to‘liq ekranli ilova sifatida ishlatish</p>
                      </div>
                    </div>
                    <div className="pwa-status-box">
                      {isAppInstalled ? (
                        <div className="pwa-installed-indicator">
                          <IconCheck className="icon-sm text-lime" />
                          <span>Ilova qurilmangizga o‘rnatilgan va mustaqil ishlamoqda.</span>
                        </div>
                      ) : (
                        <div className="pwa-install-action">
                          <p>MyPlan ilovasini smartfoningiz yoki kompyuteringiz bosh ekraniga o‘rnating.</p>
                          <button
                            type="button"
                            className="btn-pwa-install"
                            onClick={() => void handleInstallApp()}
                          >
                            <IconDownload className="icon-xs" />
                            <span>Ilovani o‘rnatish</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* Workspace Footer */}
          <footer className="app-footer">
            <div className="footer-left">
              <span className="footer-brand">MyPlan</span>
              <span className="footer-separator">•</span>
              <span className="footer-tagline">Plan your day. Own your time.</span>
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
            <span>Bugun</span>
          </button>

          <button
            type="button"
            className={`bottom-nav-item ${activeTab === "activities" ? "active" : ""}`}
            onClick={() => setActiveTab("activities")}
          >
            <IconList className="bottom-nav-icon" />
            <span>Katalog</span>
          </button>

          {/* Center Floating Plus Button */}
          <button
            type="button"
            className="bottom-nav-create"
            onClick={() => setShowCreateModal(true)}
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
            <span>Xabarlar</span>
            {unreadNotifsCount > 0 && <span className="mobile-unread-dot" />}
          </button>

          <button
            type="button"
            className={`bottom-nav-item ${activeTab === "profile" ? "active" : ""}`}
            onClick={() => setActiveTab("profile")}
          >
            <IconUser className="bottom-nav-icon" />
            <span>Profil</span>
          </button>
        </nav>
      </div>
    </div>
  );
}
