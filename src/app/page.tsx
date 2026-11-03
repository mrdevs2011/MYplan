"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
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
  IconArrowRight,
  IconSparkles,
  IconTarget,
  IconTrendUp,
  IconClock,
  IconShield,
  IconEye,
  IconEyeOff,
  IconUser,
  IconBarChart,
  IconCamera,
  IconHash,
} from "@/components/icons";

type Mode = "login" | "signup";
type TabType = "today" | "activities" | "analytics" | "profile";

type Activity = {
  id: string;
  title: string;
  description: string;
  schedule_type: "daily" | "once";
  measurement_type: "check" | "count";
  target: number | null;
  unit: string;
  is_active: boolean;
  starts_on: string;
};
type Occurrence = { id: string; activity_id: string; status: "pending" | "completed" | "skipped" };

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const dateLabel = new Intl.DateTimeFormat("uz-UZ", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export default function Home() {
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(() => !isSupabaseConfigured());
  const [accountName, setAccountName] = useState("");
  const [accountUsername, setAccountUsername] = useState("");
  const [userAge, setUserAge] = useState<string | number>("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [taskCounts, setTaskCounts] = useState<Record<string, number>>({});
  const [loadingData, setLoadingData] = useState(false);

  // Floating modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createTaskKind, setCreateTaskKind] = useState<"check" | "count">("check");
  const [countTarget, setCountTarget] = useState("");
  const [countUnit, setCountUnit] = useState("marta");

  // Sidebar & Navigation
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>("today");

  // New task fields
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newSchedule, setNewSchedule] = useState<"daily" | "once">("daily");
  const [configured] = useState(isSupabaseConfigured());

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
          .eq("is_active", true)
          .order("created_at", { ascending: false }),
      ]);
      if (activityError) throw activityError;

      const storedAvatar = typeof window !== "undefined" ? localStorage.getItem(`myplan_avatar_${id}`) : null;
      if (storedAvatar) {
        setAvatarUrl(storedAvatar);
      }

      setAccountName(String(profile?.full_name || profile?.username || "MYPLAN user"));
      setAccountUsername(String(profile?.username || ""));

      const rows = (activityRows ?? []) as Activity[];
      setActivities(rows);
      if (rows.length) {
        const day = today();
        const scheduled = rows.filter((item) => item.starts_on <= day);
        const oneTimeIds = scheduled.filter((item) => item.schedule_type === "once").map((item) => item.id);
        let alreadyScheduled = new Set<string>();
        if (oneTimeIds.length) {
          const { data: prior, error: priorError } = await supabase
            .from("occurrences")
            .select("activity_id")
            .in("activity_id", oneTimeIds);
          if (priorError) throw priorError;
          alreadyScheduled = new Set((prior ?? []).map((item: { activity_id: string }) => item.activity_id));
        }
        const eligible = scheduled.filter((item) => item.schedule_type === "daily" || !alreadyScheduled.has(item.id));
        if (eligible.length) {
          const { error: occurrenceError } = await supabase.from("occurrences").upsert(
            eligible.map((item) => ({
              user_id: id,
              activity_id: item.id,
              period_start: day,
              period_end: day,
              target: item.target,
              status: "pending",
            })),
            { onConflict: "activity_id,period_start", ignoreDuplicates: true },
          );
          if (occurrenceError) throw occurrenceError;
        }
        const { data: occurrenceRows, error: occurrenceReadError } = await supabase
          .from("occurrences")
          .select("id,activity_id,status")
          .eq("user_id", id)
          .eq("period_start", day);
        if (occurrenceReadError) throw occurrenceReadError;
        const occList = (occurrenceRows ?? []) as Occurrence[];
        setOccurrences(occList);

        // Load cached counts for count-based activities
        if (typeof window !== "undefined") {
          const counts: Record<string, number> = {};
          for (const occ of occList) {
            const act = rows.find((a) => a.id === occ.activity_id);
            if (act && act.measurement_type === "count") {
              const saved = localStorage.getItem(`myplan_count_${occ.id}`);
              if (saved !== null) {
                counts[occ.id] = parseInt(saved, 10) || 0;
              } else if (occ.status === "completed") {
                counts[occ.id] = act.target || 0;
              } else {
                counts[occ.id] = 0;
              }
            }
          }
          setTaskCounts(counts);
        }
      } else {
        setOccurrences([]);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ma’lumotlarni yuklashda xatolik.");
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (!configured) return;
    let active = true;
    const supabase = createClient();
    const applySession = (session: Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"]) => {
      if (!active) return;
      const user = session?.user;
      setUserId(user?.id ?? null);
      if (user) {
        setAccountName(String(user.user_metadata?.full_name || user.user_metadata?.username || "Do‘stim"));
        setAccountUsername(String(user.user_metadata?.username || ""));
        setUserAge(user.user_metadata?.age || "");
        if (user.user_metadata?.avatar_url) {
          setAvatarUrl(user.user_metadata.avatar_url);
        }
      } else {
        setActivities([]);
        setOccurrences([]);
        setAccountName("");
        setAccountUsername("");
        setUserAge("");
        setAvatarUrl(null);
      }
      setAuthReady(true);
    };

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session);
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setMessage("Sessiyani tekshirishda xatolik: " + error.message);
      applySession(data.session);
    }).catch((error: unknown) => {
      if (!active) return;
      setMessage(error instanceof Error ? error.message : "Sessiyani tekshirishda xatolik.");
      applySession(null);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [configured]);

  useEffect(() => {
    if (!userId) return;
    const id = userId;
    void Promise.resolve().then(() => loadWorkspace(id));
  }, [userId, loadWorkspace]);

  // Profile avatar upload handler
  const handleAvatarChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setMessage("Rasm hajmi 2MB dan kichik bo‘lishi kerak.");
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const normalizedUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(normalizedUsername)) {
      setMessage("Username 3–24 ta belgidan iborat bo‘lsin: lotin harflari, raqam va _.");
      return;
    }

    if (mode === "signup") {
      const parsedAge = parseInt(age, 10);
      if (isNaN(parsedAge) || parsedAge < 6 || parsedAge > 120) {
        setMessage("Iltimos, haqiqiy yoshingizni kiriting (6 dan 120 gacha).");
        return;
      }
      if (password !== confirmPassword) {
        setMessage("Kiritilgan parollar bir-biriga mos kelmadi. Iltimos, qayta tekshiring.");
        return;
      }
    }

    if (password.length < 8) {
      setMessage("Parol kamida 8 ta belgidan iborat bo‘lishi kerak.");
      return;
    }

    setBusy(true);
    try {
      const supabase = createClient();
      const authEmail = `${normalizedUsername}@users.myplan.invalid`;
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: authEmail,
          password,
          options: {
            data: {
              username: normalizedUsername,
              full_name: name.trim(),
              age: parseInt(age, 10) || null,
            },
          },
        });
        if (error) throw error;
        if (data.session && data.user) {
          setUserId(data.user.id);
          setAccountName(name.trim() || normalizedUsername);
          setAccountUsername(normalizedUsername);
          setUserAge(age);
        } else {
          setMessage("Hisob yaratish yakunlanmadi: Supabase Email confirmation sozlamasini tekshir.");
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email: authEmail, password });
        if (error) throw error;
        setUserId(data.user.id);
        setAccountName(String(data.user.user_metadata?.full_name || data.user.user_metadata?.username || normalizedUsername));
        setAccountUsername(String(data.user.user_metadata?.username || normalizedUsername));
        setUserAge(data.user.user_metadata?.age || "");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Noma’lum xatolik yuz berdi.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    const { error } = await createClient().auth.signOut();
    if (error) setMessage(error.message);
    else {
      setUserId(null);
      setActivities([]);
      setOccurrences([]);
      setMessage("");
      setMobileMenuOpen(false);
      setAvatarUrl(null);
    }
  }

  // Create Activity: supports "check" and "count" with 5-digit max & 0/1 disallowed
  async function createActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId || !newTitle.trim()) return;

    let targetValue: number | null = null;
    let unitValue = "";

    if (createTaskKind === "count") {
      const parsed = parseInt(countTarget, 10);
      if (isNaN(parsed) || parsed === 0 || parsed === 1 || parsed > 99999) {
        setMessage("Sanoq 2 dan 99999 gacha bo‘lishi shart.");
        return;
      }
      targetValue = parsed;
      unitValue = countUnit.trim() || "marta";
    }

    setBusy(true);
    setMessage("");
    try {
      const { error } = await createClient()
        .from("activities")
        .insert({
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
      setNewSchedule("daily");
      setShowCreateModal(false);
      await loadWorkspace(userId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Faoliyat yaratilmadi.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleComplete(activity: Activity) {
    if (!userId) return;
    const occurrence = occurrences.find((item) => item.activity_id === activity.id);
    if (!occurrence) return;
    const nextStatus = occurrence.status === "completed" ? "pending" : "completed";
    setOccurrences((current) =>
      current.map((item) => (item.id === occurrence.id ? { ...item, status: nextStatus } : item))
    );

    if (activity.measurement_type === "count") {
      const nextCount = nextStatus === "completed" ? (activity.target || 0) : 0;
      setTaskCounts((prev) => ({ ...prev, [occurrence.id]: nextCount }));
      if (typeof window !== "undefined") {
        localStorage.setItem(`myplan_count_${occurrence.id}`, String(nextCount));
      }
    }

    const { error } = await createClient()
      .from("occurrences")
      .update({ status: nextStatus })
      .eq("id", occurrence.id)
      .eq("user_id", userId);
    if (error) {
      setMessage(error.message);
      await loadWorkspace(userId);
    }
  }

  // Increment counter for "count" activity (+1, +5, +10)
  async function incrementTaskCount(activity: Activity, occurrence: Occurrence, amount: number) {
    if (!userId) return;
    const current = taskCounts[occurrence.id] || 0;
    const target = activity.target || 0;
    const next = Math.min(current + amount, target);

    setTaskCounts((prev) => ({ ...prev, [occurrence.id]: next }));
    if (typeof window !== "undefined") {
      localStorage.setItem(`myplan_count_${occurrence.id}`, String(next));
    }

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

  async function archiveActivity(id: string) {
    if (!userId) return;
    const { error } = await createClient().from("activities").update({ is_active: false }).eq("id", id).eq("user_id", userId);
    if (error) setMessage(error.message);
    else await loadWorkspace(userId);
  }

  const completedCount = useMemo(
    () => occurrences.filter((item) => item.status === "completed").length,
    [occurrences]
  );
  const percent = activities.length ? Math.round((completedCount / activities.length) * 100) : 0;

  // Validation for countTarget (0 and 1 disallowed, max 99999)
  const parsedTargetNum = parseInt(countTarget, 10);
  const isTargetZeroOrOne = countTarget.trim() !== "" && (parsedTargetNum === 0 || parsedTargetNum === 1);
  const isTargetEmpty = createTaskKind === "count" && (countTarget.trim() === "" || isNaN(parsedTargetNum) || parsedTargetNum < 2);
  const isSaveDisabled = busy || !newTitle.trim() || (createTaskKind === "count" && (isTargetZeroOrOne || isTargetEmpty));

  if (!authReady) {
    return (
      <main className="loading-screen" aria-busy="true" aria-label="MYPLAN yuklanmoqda">
        <div className="loading-card">
          <Image className="loading-logo" src="/myplan-logo.png" alt="MYPLAN" width={52} height={52} priority />
          <div className="loading-spinner" />
          <p>Hisobing tekshirilmoqda…</p>
        </div>
      </main>
    );
  }

  if (userId) {
    return (
      <div className={`app-layout ${sidebarOpen ? "sidebar-expanded" : "sidebar-collapsed"}`}>
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
                  <h3 id="modal-title">Yangi vazifa qo‘shish</h3>
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

              {/* 2 Ta Tab: Bir martalik vs Sanoqli */}
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
                  <span>Sanoqli</span>
                </button>
              </div>

              <form className="modal-form" onSubmit={createActivity}>
                <div className="form-group">
                  <label htmlFor="modal-task-title">Vazifa nomi *</label>
                  <input
                    id="modal-task-title"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder={
                      createTaskKind === "check"
                        ? "Masalan: Kitob o‘qish yoki dori ichish"
                        : "Masalan: Otjimaniye qilish yoki qadam tashlash"
                    }
                    maxLength={160}
                    required
                    autoFocus
                  />
                </div>

                {/* Sanoqli tab maydoni: 5 xona max, 0 va 1 taqiqlangan */}
                {createTaskKind === "count" && (
                  <div className="form-group count-target-group">
                    <label htmlFor="count-target">Bajarilish sanog‘i (Nechta qilinadi?) *</label>
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
                        title="Birlik"
                      >
                        <option value="marta">marta</option>
                        <option value="ta">ta</option>
                        <option value="bet">bet</option>
                        <option value="qadam">qadam</option>
                        <option value="daqiqa">daqiqa</option>
                      </select>
                    </div>

                    {isTargetZeroOrOne && (
                      <p className="count-validation-error" role="alert">
                        ⚠️ 0 yoki 1 raqami kiritish mumkin emas. Kuniga 1 marta bajariladigan ishlar uchun yuqoridagi &ldquo;Bir martalik&rdquo; tabiga o‘ting.
                      </p>
                    )}
                    <p className="count-hint">Maksimal 5 xonali son (2 dan 99999 gacha qabul qilinadi).</p>
                  </div>
                )}

                <div className="form-group">
                  <label htmlFor="modal-task-desc">Izoh (ixtiyoriy)</label>
                  <input
                    id="modal-task-desc"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder="Qo‘shimcha eslatma yoki maqsad"
                    maxLength={500}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="modal-task-schedule">Takrorlanish tartibi</label>
                  <select
                    id="modal-task-schedule"
                    value={newSchedule}
                    onChange={(e) => setNewSchedule(e.target.value as "daily" | "once")}
                  >
                    <option value="daily">Har kuni (Daily habit)</option>
                    <option value="once">Bir martalik (One-off task)</option>
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
                    {busy ? "Saqlanmoqda…" : "Vazifani saqlash"}
                    <IconArrowRight className="icon-sm" />
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Mobile Backdrop Overlay for Drawer */}
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
          aria-label="Asosiy navigatsiya"
        >
          {/* Sidebar Top: Logo & Toggle */}
          <div className="sidebar-header">
            {sidebarOpen ? (
              <>
                <a href="#workspace" className="sidebar-brand" onClick={() => setMobileMenuOpen(false)}>
                  <Image className="brand-logo" src="/myplan-logo.png" alt="MYPLAN" width={36} height={36} priority />
                  <span className="brand-title">MYPLAN</span>
                </a>
                <button
                  type="button"
                  className="sidebar-collapse-btn"
                  onClick={() => setSidebarOpen(false)}
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
                onClick={() => setSidebarOpen(true)}
                aria-label="Sidebarni ochish"
                title="Sidebarni ochish"
              >
                <Image className="brand-logo" src="/myplan-logo.png" alt="MYPLAN" width={36} height={36} priority />
                <span className="collapsed-open-hint" aria-hidden="true">
                  <IconChevronRight className="icon-sm" />
                </span>
              </button>
            )}

            {/* Mobile close button */}
            <button
              type="button"
              className="mobile-close-btn"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Menyuni yopish"
            >
              <IconClose className="icon-sm" />
            </button>
          </div>

          {/* Quick Action Button in Leftbar: Closed da +, Opened da + Vazifa */}
          <div className="sidebar-action-wrap">
            <button
              type="button"
              className="sidebar-add-task-btn"
              onClick={() => {
                setShowCreateModal(true);
                setMobileMenuOpen(false);
              }}
              aria-label="Yangi vazifa qo‘shish"
              title="Yangi vazifa qo‘shish"
            >
              <IconPlus className="icon-sm" />
              <span className="btn-add-text">Vazifa</span>
            </button>
          </div>

          {/* Navigation Tabs in Sidebar */}
          <div className="sidebar-nav-group">
            <span className="nav-caption">ISH MAYDONI</span>
            <nav className="nav-links">
              <button
                type="button"
                className={`nav-item ${activeTab === "today" ? "active" : ""}`}
                onClick={() => {
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
                onClick={() => {
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
                className={`nav-item ${activeTab === "analytics" ? "active" : ""}`}
                onClick={() => {
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
                onClick={() => {
                  setActiveTab("profile");
                  setMobileMenuOpen(false);
                }}
              >
                <IconUser className="nav-icon" />
                <span className="nav-label">Profilim</span>
                {activeTab === "profile" && <span className="active-indicator" />}
              </button>
            </nav>
          </div>

          {/* Sidebar Footer (Profile + Logout) */}
          <div className="sidebar-footer">
            <button
              type="button"
              className="user-profile-card-btn"
              onClick={() => {
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
                <span className="user-name" title={accountName || "MYPLAN user"}>
                  {accountName || "MYPLAN user"}
                </span>
                <span className="user-tag">Shaxsiy hisob</span>
              </div>
            </button>

            <button
              type="button"
              className="logout-action-btn"
              onClick={signOut}
              title="Tizimdan chiqish"
            >
              <IconLogOut className="icon-sm" />
              <span className="logout-text">Chiqish</span>
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="main-wrapper">
          {/* Top Navbar on Mobile & Small Screens */}
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

            <div className="mobile-brand">
              <Image src="/myplan-logo.png" alt="MYPLAN" width={28} height={28} priority />
              <span>MYPLAN</span>
            </div>

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

          <main className="content-container" id="workspace">
            {/* Header Greeting & Header Navigation Tabs */}
            <header className="page-header">
              <div className="header-text">
                <span className="page-kicker">
                  <IconSparkles className="icon-xs" /> SHAXSIY MAYDONING
                </span>
                <h1 className="page-title">
                  Salom, <span className="highlight">{(accountName || "do‘stim").split(" ")[0]}</span>
                </h1>
                <p className="page-subtitle">Bugun o‘zing uchun yana bir muhim qadam tashla. · {dateLabel.format(new Date())}</p>
              </div>

              {/* Header Quick Tab Bar */}
              <div className="header-tab-bar" role="tablist">
                <button
                  type="button"
                  className={`header-tab-btn ${activeTab === "today" ? "active" : ""}`}
                  onClick={() => setActiveTab("today")}
                >
                  <IconCalendar className="icon-xs" />
                  <span>Bugun</span>
                </button>
                <button
                  type="button"
                  className={`header-tab-btn ${activeTab === "activities" ? "active" : ""}`}
                  onClick={() => setActiveTab("activities")}
                >
                  <IconList className="icon-xs" />
                  <span>Faoliyatlar</span>
                </button>
                <button
                  type="button"
                  className={`header-tab-btn ${activeTab === "analytics" ? "active" : ""}`}
                  onClick={() => setActiveTab("analytics")}
                >
                  <IconBarChart className="icon-xs" />
                  <span>Statistika</span>
                </button>
                <button
                  type="button"
                  className={`header-tab-btn ${activeTab === "profile" ? "active" : ""}`}
                  onClick={() => setActiveTab("profile")}
                >
                  <IconUser className="icon-xs" />
                  <span>Profil</span>
                </button>
              </div>
            </header>

            {/* Notification / Status Message */}
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

            {/* TAB 1: BUGUNGI REJA */}
            {activeTab === "today" && (
              <>
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
                      <strong>{Math.max(activities.length - completedCount, 0)}</strong> ta qoldi
                    </p>
                  </article>

                  <article className="stat-card">
                    <div className="stat-header">
                      <span className="stat-tag">FAOLIYATLAR</span>
                      <IconList className="stat-icon" />
                    </div>
                    <div className="stat-value-row">
                      <span className="stat-value">{activities.length.toString().padStart(2, "0")}</span>
                    </div>
                    <p className="stat-footer">Faol belgilangan rejalaring</p>
                  </article>

                  <article className="stat-card">
                    <div className="stat-header">
                      <span className="stat-tag">BUGUN BAJARILDI</span>
                      <IconTrendUp className="stat-icon text-lime" />
                    </div>
                    <div className="stat-value-row">
                      <span className="stat-value text-lime">{completedCount.toString().padStart(2, "0")}</span>
                    </div>
                    <p className="stat-footer">Muvaffaqiyatli yakunlangan ishlar</p>
                  </article>
                </section>

                <section className="activities-container">
                  <div className="section-header-bar">
                    <div>
                      <span className="section-sub">BUGUNGI KUN TARTIBI</span>
                      <h2 className="section-heading">Bugungi vazifalar</h2>
                    </div>

                    <button
                      type="button"
                      className="btn-primary-action"
                      onClick={() => setShowCreateModal(true)}
                    >
                      <IconPlus className="icon-sm" />
                      <span>+ Yangi vazifa</span>
                    </button>
                  </div>

                  {loadingData ? (
                    <div className="loading-state-card">
                      <div className="loading-spinner" />
                      <p>Rejalaringiz yuklanmoqda…</p>
                    </div>
                  ) : activities.length === 0 ? (
                    <div className="empty-state-box">
                      <div className="empty-icon-wrap">
                        <IconTarget className="icon-lg" />
                      </div>
                      <h3>Hozircha hech qanday vazifa yo‘q</h3>
                      <p>
                        Katta natijalar har kuni qilinadigan kichik qadamlardan boshlanadi.
                        Birinchi maqsadingizni belgilang!
                      </p>
                      <button
                        type="button"
                        className="btn-empty-create"
                        onClick={() => setShowCreateModal(true)}
                      >
                        <IconPlus className="icon-sm" />
                        <span>Birinchi vazifangizni yarating</span>
                      </button>
                    </div>
                  ) : (
                    <div className="task-items-list">
                      {activities.map((activity) => {
                        const occurrence = occurrences.find((item) => item.activity_id === activity.id);
                        const done = occurrence?.status === "completed";
                        const target = activity.target || 0;
                        const current = taskCounts[occurrence?.id || ""] ?? (done ? target : 0);
                        const remaining = Math.max(target - current, 0);

                        return (
                          <article
                            className={`task-card ${done ? "is-completed" : ""}`}
                            key={activity.id}
                          >
                            <button
                              type="button"
                              className="checkbox-btn"
                              aria-label={done ? "Bajarilmadi deb belgilash" : "Bajarildi deb belgilash"}
                              onClick={() => void toggleComplete(activity)}
                            >
                              {done && <IconCheck className="checkbox-icon" />}
                            </button>

                            <div className="task-content">
                              <h4 className="task-title">{activity.title}</h4>
                              {activity.description && (
                                <p className="task-description">{activity.description}</p>
                              )}

                              {/* Sanoqli vazifa bo'lsa progress bar va hisoblagich ko'rinadi */}
                              {activity.measurement_type === "count" && target > 0 && (
                                <div className="task-count-progress-wrap">
                                  <div className="task-count-info-row">
                                    <span className="task-count-text">
                                      <strong>{current}</strong> / {target} {activity.unit || "marta"}
                                    </span>
                                    <span className="task-remaining-text">
                                      {done ? "Bajarildi" : `${remaining} ta qoldi`}
                                    </span>
                                  </div>
                                  <div className="task-mini-progress-track">
                                    <div
                                      className="task-mini-progress-fill"
                                      style={{ width: `${Math.min((current / target) * 100, 100)}%` }}
                                    />
                                  </div>

                                  {/* +10, +5, +1 tugmalari: qolgan son yetarli bo'lganda ko'rinadi */}
                                  {!done && remaining > 0 && occurrence && (
                                    <div className="count-buttons-cluster">
                                      {remaining >= 10 && (
                                        <button
                                          type="button"
                                          className="btn-counter-inc"
                                          onClick={() => void incrementTaskCount(activity, occurrence, 10)}
                                          title="10 ta qo‘shish"
                                        >
                                          +10
                                        </button>
                                      )}
                                      {remaining >= 5 && (
                                        <button
                                          type="button"
                                          className="btn-counter-inc"
                                          onClick={() => void incrementTaskCount(activity, occurrence, 5)}
                                          title="5 ta qo‘shish"
                                        >
                                          +5
                                        </button>
                                      )}
                                      {remaining >= 1 && (
                                        <button
                                          type="button"
                                          className="btn-counter-inc primary"
                                          onClick={() => void incrementTaskCount(activity, occurrence, 1)}
                                          title="1 ta qo‘shish"
                                        >
                                          +1
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}

                              <div className="task-meta">
                                <span className={`schedule-badge ${activity.schedule_type}`}>
                                  {activity.schedule_type === "daily" ? "HAR KUNI" : "BIR MARTALIK"}
                                </span>
                                {activity.measurement_type === "count" && (
                                  <span className="task-kind-badge">
                                    <IconHash className="icon-xs" /> Sanoqli
                                  </span>
                                )}
                                {done && (
                                  <span className="status-badge done">
                                    <IconCheck className="icon-xs" /> Bajarildi
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="task-actions">
                              <button
                                type="button"
                                className="btn-archive"
                                onClick={() => void archiveActivity(activity.id)}
                                title="Faoliyatni arxivlash"
                                aria-label="Faoliyatni arxivlash"
                              >
                                <IconArchive className="icon-sm" />
                              </button>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>
              </>
            )}

            {/* TAB 2: BARCHA FAOLIYATLAR */}
            {activeTab === "activities" && (
              <section className="activities-container">
                <div className="section-header-bar">
                  <div>
                    <span className="section-sub">BARCHA FAOLIYATLARINGIZ</span>
                    <h2 className="section-heading">Faol rejalar ro‘yxati</h2>
                  </div>

                  <button
                    type="button"
                    className="btn-primary-action"
                    onClick={() => setShowCreateModal(true)}
                  >
                    <IconPlus className="icon-sm" />
                    <span>+ Yangi vazifa</span>
                  </button>
                </div>

                {activities.length === 0 ? (
                  <div className="empty-state-box">
                    <div className="empty-icon-wrap">
                      <IconList className="icon-lg" />
                    </div>
                    <h3>Faoliyatlar ro‘yxati bo‘sh</h3>
                    <p>O‘zingiz uchun doimiy odatlar yoki bir martalik rejalarni kiritishni boshlang.</p>
                    <button
                      type="button"
                      className="btn-empty-create"
                      onClick={() => setShowCreateModal(true)}
                    >
                      <IconPlus className="icon-sm" />
                      <span>Yangi vazifa yaratish</span>
                    </button>
                  </div>
                ) : (
                  <div className="task-items-list">
                    {activities.map((activity) => {
                      const occurrence = occurrences.find((item) => item.activity_id === activity.id);
                      const done = occurrence?.status === "completed";
                      const target = activity.target || 0;
                      const current = taskCounts[occurrence?.id || ""] ?? (done ? target : 0);
                      const remaining = Math.max(target - current, 0);

                      return (
                        <article
                          className={`task-card ${done ? "is-completed" : ""}`}
                          key={activity.id}
                        >
                          <button
                            type="button"
                            className="checkbox-btn"
                            aria-label={done ? "Bajarilmadi deb belgilash" : "Bajarildi deb belgilash"}
                            onClick={() => void toggleComplete(activity)}
                          >
                            {done && <IconCheck className="checkbox-icon" />}
                          </button>

                          <div className="task-content">
                            <h4 className="task-title">{activity.title}</h4>
                            {activity.description && (
                              <p className="task-description">{activity.description}</p>
                            )}

                            {activity.measurement_type === "count" && target > 0 && (
                              <div className="task-count-progress-wrap">
                                <div className="task-count-info-row">
                                  <span className="task-count-text">
                                    <strong>{current}</strong> / {target} {activity.unit || "marta"}
                                  </span>
                                  <span className="task-remaining-text">
                                    {done ? "Bajarildi" : `${remaining} ta qoldi`}
                                  </span>
                                </div>
                                <div className="task-mini-progress-track">
                                  <div
                                    className="task-mini-progress-fill"
                                    style={{ width: `${Math.min((current / target) * 100, 100)}%` }}
                                  />
                                </div>
                              </div>
                            )}

                            <div className="task-meta">
                              <span className={`schedule-badge ${activity.schedule_type}`}>
                                {activity.schedule_type === "daily" ? "HAR KUNI" : "BIR MARTALIK"}
                              </span>
                              {activity.measurement_type === "count" && (
                                <span className="task-kind-badge">
                                  <IconHash className="icon-xs" /> Sanoqli
                                </span>
                              )}
                              <span className="meta-date">
                                Boshlangan: {activity.starts_on}
                              </span>
                            </div>
                          </div>

                          <div className="task-actions">
                            <button
                              type="button"
                              className="btn-archive"
                              onClick={() => void archiveActivity(activity.id)}
                              title="Faoliyatni arxivlash"
                              aria-label="Faoliyatni arxivlash"
                            >
                              <IconArchive className="icon-sm" />
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {/* TAB 3: STATISTIKA & TAHLIL */}
            {activeTab === "analytics" && (
              <section className="analytics-view">
                <div className="section-header-bar">
                  <div>
                    <span className="section-sub">TARAQQIYOTINGIZ KO‘ZGUSI</span>
                    <h2 className="section-heading">Samaradorlik statistikasi</h2>
                  </div>
                </div>

                <div className="stats-grid">
                  <article className="stat-card progress-card">
                    <div className="stat-header">
                      <span className="stat-tag">BUGUNGI SAMARADORLIK</span>
                      <IconTarget className="stat-icon" />
                    </div>
                    <div className="stat-value-row">
                      <span className="stat-value">{percent}</span>
                      <span className="stat-unit">%</span>
                    </div>
                    <div className="progress-bar-track">
                      <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
                    </div>
                    <p className="stat-footer">{completedCount} ta vazifa muvaffaqiyatli yakunlandi</p>
                  </article>

                  <article className="stat-card">
                    <div className="stat-header">
                      <span className="stat-tag">DOIMIY ODATHON</span>
                      <IconClock className="stat-icon text-lime" />
                    </div>
                    <div className="stat-value-row">
                      <span className="stat-value">
                        {activities.filter((a) => a.schedule_type === "daily").length.toString().padStart(2, "0")}
                      </span>
                    </div>
                    <p className="stat-footer">Har kungi takrorlanuvchi rejalaringiz</p>
                  </article>

                  <article className="stat-card">
                    <div className="stat-header">
                      <span className="stat-tag">BIR MARTALIK MAQSADLAR</span>
                      <IconSparkles className="stat-icon text-lime" />
                    </div>
                    <div className="stat-value-row">
                      <span className="stat-value">
                        {activities.filter((a) => a.schedule_type === "once").length.toString().padStart(2, "0")}
                      </span>
                    </div>
                    <p className="stat-footer">Maxsus vazifalar soni</p>
                  </article>
                </div>

                <div className="analytics-tips-card">
                  <div className="tip-badge">
                    <IconSparkles className="icon-xs" /> TAVSIYA
                  </div>
                  <h3>Barqarorlik — muvaffaqiyat kaliti</h3>
                  <p>
                    Rejalaringizni har kuni bir xil vaqtda bajarishga odatlaning. Hatto kichik 1% lik
                    yutuq ham bir yil ichida 37 barobar kattaroq natijaga aylanadi.
                  </p>
                </div>
              </section>
            )}

            {/* TAB 4: MENING PROFILIM (READ-ONLY + PROFILE PIC) */}
            {activeTab === "profile" && (
              <section className="profile-view">
                <div className="section-header-bar">
                  <div>
                    <span className="section-sub">SHAXSIY HISOBINGIZ</span>
                    <h2 className="section-heading">Foydalanuvchi profili</h2>
                  </div>
                </div>

                <div className="profile-card-container">
                  {/* Avatar Upload Block */}
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

                  {/* Read-Only Information Fields */}
                  <div className="profile-details-grid">
                    <div className="profile-info-item">
                      <span className="info-label">Ism va familiya</span>
                      <p className="info-value">{accountName || "Kiritilmagan"}</p>
                    </div>

                    <div className="profile-info-item">
                      <span className="info-label">Foydalanuvchi nomi (Username)</span>
                      <p className="info-value font-mono">@{accountUsername || "username"}</p>
                    </div>

                    <div className="profile-info-item">
                      <span className="info-label">Yoshi</span>
                      <p className="info-value">{userAge ? `${userAge} yosh` : "Belgilanmagan"}</p>
                    </div>

                    <div className="profile-info-item">
                      <span className="info-label">Hisob darajasi</span>
                      <p className="info-value text-lime">MYPLAN Standart (Himoyalangan)</p>
                    </div>

                    <div className="profile-info-item">
                      <span className="info-label">Faol rejalaringiz</span>
                      <p className="info-value">{activities.length} ta vazifa</p>
                    </div>

                    <div className="profile-info-item">
                      <span className="info-label">Bugungi natija</span>
                      <p className="info-value text-lime">{percent}% bajarildi</p>
                    </div>
                  </div>

                  <div className="profile-notice-box">
                    <IconShield className="icon-sm text-lime" />
                    <p>
                      <strong>Xavfsizlik eslatmasi:</strong> Shaxsiy hisob ma’lumotlaringiz (ism, username va yosh)
                      xavfsizlikni ta’minlash maqsadida faqat ko‘rish rejimida saqlanadi.
                    </p>
                  </div>
                </div>
              </section>
            )}

            {/* Workspace Footer */}
            <footer className="app-footer">
              <div className="footer-left">
                <span className="footer-brand">MYPLAN</span>
                <span className="footer-separator">•</span>
                <span className="footer-tagline">YOUR PLAN. YOUR PACE.</span>
              </div>
              <div className="footer-right">
                <span>© {new Date().getFullYear()} Shaxsiy rejalashtirish tizimi</span>
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
              <span>Faoliyatlar</span>
            </button>

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
              className={`bottom-nav-item ${activeTab === "analytics" ? "active" : ""}`}
              onClick={() => setActiveTab("analytics")}
            >
              <IconBarChart className="bottom-nav-icon" />
              <span>Statistika</span>
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

  // Landing & Authentication View
  return (
    <div className="landing-layout">
      {/* Top Navigation */}
      <header className="landing-navbar">
        <div className="navbar-container">
          <a href="#top" className="brand-link" aria-label="MYPLAN bosh sahifa">
            <Image className="brand-logo" src="/myplan-logo.png" alt="MYPLAN" width={42} height={42} priority />
            <span className="brand-title">MYPLAN</span>
          </a>

          <nav className="landing-nav-links">
            <a href="#features" className="landing-nav-item">IMKONIYATLAR</a>
            <a href="#how" className="landing-nav-item">QANDAY ISHLAYDI</a>
            <a href="#auth" className="btn-nav-cta">
              BOSHLASH <IconArrowRight className="icon-xs" />
            </a>
          </nav>
        </div>
      </header>

      {/* Hero & Auth Section */}
      <section className="hero-section" id="top">
        <div className="hero-container">
          {/* Left Column: Value Proposition */}
          <div className="hero-content">
            <div className="hero-badge">
              <span className="pulse-dot" />
              SHAXSIY RIVOJLANISH PLATFORMASI
            </div>

            <h1 className="hero-headline">
              Rejangni tuz.<br />
              <span className="hero-accent">O‘zingni</span> o‘stir.
            </h1>

            <p className="hero-description">
              Maqsadlaringni aniq rejalashtir, har kungi qadamingni kuzat va kichik yutuqlaringni
              barqaror katta natijaga aylantir.
            </p>

            <div className="hero-highlights">
              <div className="highlight-pill">
                <span className="pill-number">01</span>
                <span>Rejalaring bir joyda</span>
              </div>
              <div className="highlight-pill">
                <span className="pill-number">02</span>
                <span>Taraqqiyoting ko‘z oldingda</span>
              </div>
              <div className="highlight-pill">
                <span className="pill-number">03</span>
                <span>O‘z sur’atingda rivojlan</span>
              </div>
            </div>
          </div>

          {/* Right Column: Auth Card */}
          <div className="hero-auth-pane" id="auth">
            <div className="auth-glass-card">
              <div className="auth-card-top-bar">
                <span className="auth-badge">MYPLAN ACCOUNT</span>
                <span className="auth-security">
                  <IconShield className="icon-xs" /> PRIVATE SPACE
                </span>
              </div>

              <div className="auth-title-block">
                <h2>
                  {mode === "login"
                    ? "Yana ko‘rishganimizdan xursandmiz."
                    : "O‘z yo‘lingni boshlagin."}
                </h2>
                <p>
                  {mode === "login"
                    ? "Davom etish uchun hisobingga kir."
                    : "Bir necha soniyada bepul hisob yarat."}
                </p>
              </div>

              {/* Mode Switcher Tabs */}
              <div className="auth-mode-toggle" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "login"}
                  className={`mode-btn ${mode === "login" ? "active" : ""}`}
                  onClick={() => {
                    setMode("login");
                    setMessage("");
                  }}
                >
                  Kirish
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "signup"}
                  className={`mode-btn ${mode === "signup" ? "active" : ""}`}
                  onClick={() => {
                    setMode("signup");
                    setMessage("");
                  }}
                >
                  Ro‘yxatdan o‘tish
                </button>
              </div>

              {/* Auth Form */}
              <form className="auth-form-body" onSubmit={submit}>
                {mode === "signup" && (
                  <div className="input-group">
                    <label htmlFor="auth-name">Ismingiz *</label>
                    <input
                      id="auth-name"
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Ismingiz va familiyangiz"
                      maxLength={80}
                      required
                    />
                  </div>
                )}

                <div className="input-group">
                  <label htmlFor="auth-username">Username *</label>
                  <input
                    id="auth-username"
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="masalan: mrdevs"
                    minLength={3}
                    maxLength={24}
                    pattern="[A-Za-z0-9_]{3,24}"
                    spellCheck={false}
                    autoCapitalize="none"
                    required
                  />
                </div>

                {mode === "signup" && (
                  <div className="input-group">
                    <label htmlFor="auth-age">Yoshingiz *</label>
                    <input
                      id="auth-age"
                      type="number"
                      min={6}
                      max={120}
                      value={age}
                      onChange={(e) => setAge(e.target.value)}
                      placeholder="Masalan: 21"
                      required
                    />
                  </div>
                )}

                {/* Password input with eye toggle */}
                <div className="input-group">
                  <label htmlFor="auth-password">Parol *</label>
                  <div className="password-input-wrap">
                    <input
                      id="auth-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete={mode === "login" ? "current-password" : "new-password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Kamida 8 ta belgi"
                      minLength={8}
                      required
                    />
                    <button
                      type="button"
                      className="eye-toggle-btn"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? "Parolni yashirish" : "Parolni ko‘rsatish"}
                      tabIndex={-1}
                    >
                      {showPassword ? <IconEyeOff className="icon-sm" /> : <IconEye className="icon-sm" />}
                    </button>
                  </div>
                </div>

                {/* Confirm Password input with eye toggle (signup only) */}
                {mode === "signup" && (
                  <div className="input-group">
                    <label htmlFor="auth-confirm-password">Parolni tasdiqlash *</label>
                    <div className="password-input-wrap">
                      <input
                        id="auth-confirm-password"
                        type={showConfirmPassword ? "text" : "password"}
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Parolni qayta kiriting"
                        minLength={8}
                        required
                      />
                      <button
                        type="button"
                        className="eye-toggle-btn"
                        onClick={() => setShowConfirmPassword((prev) => !prev)}
                        aria-label={showConfirmPassword ? "Parolni yashirish" : "Parolni ko‘rsatish"}
                        tabIndex={-1}
                      >
                        {showConfirmPassword ? <IconEyeOff className="icon-sm" /> : <IconEye className="icon-sm" />}
                      </button>
                    </div>
                  </div>
                )}

                {message && (
                  <div className="auth-alert-message" role="status">
                    <span>{message}</span>
                  </div>
                )}

                {!configured && (
                  <div className="auth-alert-message warning">
                    <span>Supabase sozlanmagan. Environment qiymatlarini tekshiring.</span>
                  </div>
                )}

                {mode === "signup" && (
                  <p className="auth-field-hint">
                    Username login nomingiz bo‘ladi. Email talab qilinmaydi.
                  </p>
                )}

                <button
                  className="btn-auth-submit"
                  type="submit"
                  disabled={busy || !configured}
                >
                  <span>
                    {busy
                      ? "KUTILMOQDA…"
                      : mode === "login"
                      ? "Hisobga kirish"
                      : "Bepul hisob yaratish"}
                  </span>
                  <IconArrowRight className="icon-sm" />
                </button>
              </form>

              <p className="auth-terms-notice">
                Davom etish orqali foydalanish shartlari va xavfsizlik qoidalariga rozilik bildirasiz.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="features-section" id="features">
        <div className="section-inner">
          <div className="section-badge">01 — IMKONIYATLAR</div>
          <div className="section-title-wrap">
            <h2 className="section-main-title">
              Tartib — erkinlikning<br />
              <span className="text-lime">boshlanishi.</span>
            </h2>
            <p className="section-intro-text">
              MYPLAN kunlaringizni murakkablashtirish uchun emas, fikringizni jamlash va aniq maqsad
              sari oldinga yurishingiz uchun yaratilgan.
            </p>
          </div>

          <div className="features-cards-grid">
            <article className="feature-item-card">
              <div className="card-top-icon">
                <IconCalendar className="icon-md text-lime" />
                <span className="card-number">01</span>
              </div>
              <h3>Bugungi reja</h3>
              <p>
                Bugun bajarishingiz kerak bo‘lgan eng muhim ishlarni aniq va chalg‘imasdan bir
                joyda ko‘ring.
              </p>
            </article>

            <article className="feature-item-card">
              <div className="card-top-icon">
                <IconClock className="icon-md text-lime" />
                <span className="card-number">02</span>
              </div>
              <h3>Vaqt nazorati</h3>
              <p>
                Har kungi va bir martalik odatlaringizni tartibga soling, o‘z vaqtingizning chinakam
                egasiga aylaning.
              </p>
            </article>

            <article className="feature-item-card">
              <div className="card-top-icon">
                <IconTrendUp className="icon-md text-lime" />
                <span className="card-number">03</span>
              </div>
              <h3>O‘sish statistikasi</h3>
              <p>
                Har kungi foizli progress orqali natijalaringizni real vaqtda kuzating va to‘xtamasdan
                oldinga qadam bosing.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* How it works Section */}
      <section className="how-it-works-section" id="how">
        <div className="section-inner">
          <div className="how-split-container">
            <div className="how-intro-block">
              <div className="section-badge">02 — QANDAY ISHLAYDI</div>
              <h2 className="section-main-title">
                Kichik qadamlar.<br />
                <span className="text-lime">Katta o‘zgarishlar.</span>
              </h2>
              <p className="section-intro-text">
                Murakkab jadvallarga hojat yo‘q. Oddiy 3 ta qadam bilan hayotingizga tizimli tartib olib kiring.
              </p>
            </div>

            <div className="how-steps-list">
              <div className="step-card">
                <div className="step-badge">01</div>
                <div className="step-info">
                  <h4>Hisob yarating</h4>
                  <p>Faqat username, ism, yosh va parol bilan bir zumda o‘z shaxsiy xonangizga ega bo‘ling.</p>
                </div>
              </div>

              <div className="step-card">
                <div className="step-badge">02</div>
                <div className="step-info">
                  <h4>Faoliyatlaringizni kiriting</h4>
                  <p>Har kungi muhim vazifa va odatlaringizni modal orqali osongina ro‘yxatga qo‘shing.</p>
                </div>
              </div>

              <div className="step-card">
                <div className="step-badge">03</div>
                <div className="step-info">
                  <h4>Har kuni oz-ozdan oldinga yuring</h4>
                  <p>Vazifalarni bajargan sari ko‘tariladigan statistika bilan o‘zingizni ilhomlantiring.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Landing Footer */}
      <footer className="landing-footer">
        <div className="footer-container">
          <a href="#top" className="footer-brand">
            <Image src="/myplan-logo.png" alt="MYPLAN" width={36} height={36} priority />
            <span>MYPLAN</span>
          </a>

          <span className="footer-center-tag">YOUR PLAN. YOUR PACE.</span>

          <a href="#auth" className="footer-back-to-top">
            BOSHLASH <IconArrowRight className="icon-xs" />
          </a>
        </div>
      </footer>
    </div>
  );
}
