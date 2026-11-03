"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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
} from "@/components/icons";

type Mode = "login" | "signup";
type Activity = {
  id: string;
  title: string;
  description: string;
  schedule_type: "daily" | "once";
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
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(() => !isSupabaseConfigured());
  const [accountName, setAccountName] = useState("");
  const [activities, setActivities] = useState<Activity[]>([]);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"today" | "activities">("today");
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newSchedule, setNewSchedule] = useState<"daily" | "once">("daily");
  const [configured] = useState(isSupabaseConfigured());

  const loadWorkspace = useCallback(async (id: string) => {
    setLoadingData(true);
    const supabase = createClient();
    try {
      const [{ data: profile }, { data: activityRows, error: activityError }] = await Promise.all([
        supabase.from("profiles").select("username, full_name").eq("id", id).maybeSingle(),
        supabase
          .from("activities")
          .select("id,title,description,schedule_type,target,unit,is_active,starts_on")
          .eq("user_id", id)
          .eq("is_active", true)
          .order("created_at", { ascending: false }),
      ]);
      if (activityError) throw activityError;
      setAccountName(String(profile?.full_name || profile?.username || "MYPLAN user"));
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
        setOccurrences((occurrenceRows ?? []) as Occurrence[]);
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
      if (user) setAccountName(String(user.user_metadata?.full_name || user.user_metadata?.username || "Do‘stim"));
      else {
        setActivities([]);
        setOccurrences([]);
        setAccountName("");
      }
      // This is the routing decision point: authenticated -> workspace, otherwise -> login.
      setAuthReady(true);
    };
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session);
    });
    // Read the persisted session explicitly as well; don't depend only on the initial event.
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const normalizedUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(normalizedUsername)) {
      setMessage("Username 3–24 ta belgidan iborat bo‘lsin: lotin harflari, raqam va _.");
      return;
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
          options: { data: { username: normalizedUsername, full_name: name.trim() } },
        });
        if (error) throw error;
        if (data.session && data.user) {
          setUserId(data.user.id);
          setAccountName(name.trim() || normalizedUsername);
        } else {
          setMessage("Hisob yaratish yakunlanmadi: Supabase Email confirmation sozlamasini tekshir.");
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email: authEmail, password });
        if (error) throw error;
        setUserId(data.user.id);
        setAccountName(String(data.user.user_metadata?.full_name || data.user.user_metadata?.username || normalizedUsername));
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
    }
  }

  async function createActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId || !newTitle.trim()) return;
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
          measurement_type: "check",
          starts_on: today(),
        });
      if (error) throw error;
      setNewTitle("");
      setNewDescription("");
      setNewSchedule("daily");
      setShowCreate(false);
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
        {/* Mobile Backdrop Overlay */}
        {mobileMenuOpen && (
          <div
            className="mobile-backdrop"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Sidebar (Desktop + Mobile Drawer) */}
        <aside
          className={`app-sidebar ${mobileMenuOpen ? "mobile-open" : ""}`}
          aria-label="Asosiy navigatsiya"
        >
          {/* Sidebar Top: Logo & Toggle */}
          <div className="sidebar-header">
            <a href="#workspace" className="sidebar-brand" onClick={() => setMobileMenuOpen(false)}>
              <Image className="brand-logo" src="/myplan-logo.png" alt="MYPLAN" width={36} height={36} priority />
              <span className="brand-title">MYPLAN</span>
            </a>
            {/* Desktop collapse toggle */}
            <button
              type="button"
              className="sidebar-collapse-btn"
              onClick={() => setSidebarOpen((prev) => !prev)}
              aria-label={sidebarOpen ? "Sidebarni ixchamlash" : "Sidebarni kengaytirish"}
              title={sidebarOpen ? "Sidebarni ixchamlash" : "Sidebarni kengaytirish"}
            >
              {sidebarOpen ? <IconChevronLeft className="icon-sm" /> : <IconChevronRight className="icon-sm" />}
            </button>
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

          {/* Navigation Links */}
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
            </nav>
          </div>

          {/* Sidebar User Profile & Logout */}
          <div className="sidebar-footer">
            <div className="user-profile-card">
              <div className="user-avatar">
                {(accountName || "M").slice(0, 1).toUpperCase()}
              </div>
              <div className="user-info">
                <span className="user-name" title={accountName || "MYPLAN user"}>
                  {accountName || "MYPLAN user"}
                </span>
                <span className="user-tag">Shaxsiy hisob</span>
              </div>
            </div>

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
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Menyuni ochish"
            >
              <IconMenu className="icon-md" />
            </button>

            <div className="mobile-brand">
              <Image src="/myplan-logo.png" alt="MYPLAN" width={28} height={28} priority />
              <span>MYPLAN</span>
            </div>

            <div className="mobile-user-avatar" title={accountName || "Foydalanuvchi"}>
              {(accountName || "M").slice(0, 1).toUpperCase()}
            </div>
          </header>

          <main className="content-container" id="workspace">
            {/* Header Greeting & Date */}
            <header className="page-header">
              <div className="header-text">
                <span className="page-kicker">
                  <IconSparkles className="icon-xs" /> SHAXSIY MAYDONING
                </span>
                <h1 className="page-title">
                  Salom, <span className="highlight">{(accountName || "do‘stim").split(" ")[0]}</span>
                </h1>
                <p className="page-subtitle">Bugun o‘zing uchun yana bir muhim qadam tashla.</p>
              </div>

              <div className="date-pill">
                <IconClock className="icon-xs" />
                <span>{dateLabel.format(new Date())}</span>
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

            {/* Overview / Stats Grid */}
            {activeTab === "today" && (
              <section className="stats-grid" aria-label="Bugungi ko‘rsatkichlar">
                {/* Main Progress Card */}
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

                {/* Total Activities */}
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

                {/* Today Completed */}
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
            )}

            {/* Activities Section */}
            <section className="activities-container">
              <div className="section-header-bar">
                <div>
                  <span className="section-sub">
                    {activeTab === "today" ? "BUGUNGI KUN TARTIBI" : "BARCHA FAOLIYATLARING"}
                  </span>
                  <h2 className="section-heading">
                    {activeTab === "today" ? "Bugungi vazifalar" : "Barcha faoliyatlarim"}
                  </h2>
                </div>

                <button
                  type="button"
                  className={`btn-primary-action ${showCreate ? "active" : ""}`}
                  onClick={() => setShowCreate((v) => !v)}
                >
                  {showCreate ? (
                    <>
                      <IconClose className="icon-sm" />
                      <span>Bekor qilish</span>
                    </>
                  ) : (
                    <>
                      <IconPlus className="icon-sm" />
                      <span>Yangi vazifa</span>
                    </>
                  )}
                </button>
              </div>

              {/* Create Activity Form */}
              {showCreate && (
                <form className="create-activity-box" onSubmit={createActivity}>
                  <div className="create-box-header">
                    <h3>Yangi vazifa qo‘shish</h3>
                    <p>O‘z maqsadingni nomla va takrorlanish tartibini belgilang.</p>
                  </div>

                  <div className="create-inputs-grid">
                    <div className="form-group field-title">
                      <label htmlFor="task-title">Vazifa nomi *</label>
                      <input
                        id="task-title"
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        placeholder="Masalan: 20 bet kitob o‘qish"
                        maxLength={160}
                        required
                        autoFocus
                      />
                    </div>

                    <div className="form-group field-desc">
                      <label htmlFor="task-desc">Izoh (ixtiyoriy)</label>
                      <input
                        id="task-desc"
                        value={newDescription}
                        onChange={(e) => setNewDescription(e.target.value)}
                        placeholder="Qo‘shimcha eslatma yoki maqsad"
                        maxLength={500}
                      />
                    </div>

                    <div className="form-group field-schedule">
                      <label htmlFor="task-schedule">Takrorlanish</label>
                      <select
                        id="task-schedule"
                        value={newSchedule}
                        onChange={(e) => setNewSchedule(e.target.value as "daily" | "once")}
                      >
                        <option value="daily">Har kuni</option>
                        <option value="once">Bir martalik</option>
                      </select>
                    </div>
                  </div>

                  <div className="create-box-actions">
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setShowCreate(false)}
                    >
                      Yopish
                    </button>
                    <button
                      type="submit"
                      className="btn-submit-task"
                      disabled={busy || !newTitle.trim()}
                    >
                      {busy ? "Saqlanmoqda…" : "Vazifani saqlash"}
                      <IconArrowRight className="icon-sm" />
                    </button>
                  </div>
                </form>
              )}

              {/* Activities Content */}
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
                    onClick={() => setShowCreate(true)}
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
                          <div className="task-meta">
                            <span className={`schedule-badge ${activity.schedule_type}`}>
                              {activity.schedule_type === "daily" ? "HAR KUNI" : "BIR MARTALIK"}
                            </span>
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

          {/* Mobile Bottom Navigation Bar */}
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
              className="bottom-nav-create"
              onClick={() => setShowCreate((v) => !v)}
              aria-label="Vazifa qo‘shish"
            >
              <IconPlus className="icon-md" />
            </button>

            <button
              type="button"
              className={`bottom-nav-item ${activeTab === "activities" ? "active" : ""}`}
              onClick={() => setActiveTab("activities")}
            >
              <IconList className="bottom-nav-icon" />
              <span>Faoliyatlar</span>
            </button>
          </nav>
        </div>
      </div>
    );
  }

  // Landing / Authentication View
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
                    <label htmlFor="auth-name">Ismingiz</label>
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
                  <label htmlFor="auth-username">Username</label>
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

                <div className="input-group">
                  <label htmlFor="auth-password">Parol</label>
                  <input
                    id="auth-password"
                    type="password"
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Kamida 8 ta belgi"
                    minLength={8}
                    required
                  />
                </div>

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
                  <p>Faqat username va parol bilan bir zumda o‘z shaxsiy xonangizga ega bo‘ling.</p>
                </div>
              </div>

              <div className="step-card">
                <div className="step-badge">02</div>
                <div className="step-info">
                  <h4>Faoliyatlaringizni kiriting</h4>
                  <p>Har kungi muhim vazifa va odatlaringizni ro‘yxatga qo‘shing.</p>
                </div>
              </div>

              <div className="step-card">
                <div className="step-badge">03</div>
                <div className="step-info">
                  <h4>Har kuni oz-ozdan oldinga yuring</h4>
                  <p>Vazifalarni bajargan sari belgilanib boradigan natija bilan o‘zingizni rag‘batlantiring.</p>
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
