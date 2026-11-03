"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

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
  const [accountName, setAccountName] = useState("");
  const [activities, setActivities] = useState<Activity[]>([]);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
        supabase.from("activities").select("id,title,description,schedule_type,target,unit,is_active,starts_on").eq("user_id", id).eq("is_active", true).order("created_at", { ascending: false }),
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
          const { data: prior, error: priorError } = await supabase.from("occurrences").select("activity_id").in("activity_id", oneTimeIds);
          if (priorError) throw priorError;
          alreadyScheduled = new Set((prior ?? []).map((item: { activity_id: string }) => item.activity_id));
        }
        const eligible = scheduled.filter((item) => item.schedule_type === "daily" || !alreadyScheduled.has(item.id));
        if (eligible.length) {
          const { error: occurrenceError } = await supabase.from("occurrences").upsert(
            eligible.map((item) => ({ user_id: id, activity_id: item.id, period_start: day, period_end: day, target: item.target, status: "pending" })),
            { onConflict: "activity_id,period_start", ignoreDuplicates: true },
          );
          if (occurrenceError) throw occurrenceError;
        }
        const { data: occurrenceRows, error: occurrenceReadError } = await supabase.from("occurrences").select("id,activity_id,status").eq("user_id", id).eq("period_start", day);
        if (occurrenceReadError) throw occurrenceReadError;
        setOccurrences((occurrenceRows ?? []) as Occurrence[]);
      } else setOccurrences([]);
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
    supabase.auth.getUser().then(({ data }) => {
      if (active && data.user) {
        setUserId(data.user.id);
        setAccountName(String(data.user.user_metadata?.full_name || data.user.user_metadata?.username || "Do‘stim"));
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      const user = session?.user;
      setUserId(user?.id ?? null);
      if (user) setAccountName(String(user.user_metadata?.full_name || user.user_metadata?.username || "Do‘stim"));
      else { setActivities([]); setOccurrences([]); setAccountName(""); }
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, [configured]);

  useEffect(() => {
    if (!userId) return;
    const id = userId;
    void Promise.resolve().then(() => loadWorkspace(id));
  }, [userId, loadWorkspace]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    const normalizedUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(normalizedUsername)) { setMessage("Username 3–24 ta belgidan iborat bo‘lsin: lotin harflari, raqam va _."); return; }
    if (password.length < 8) { setMessage("Parol kamida 8 ta belgidan iborat bo‘lishi kerak."); return; }
    setBusy(true);
    try {
      const supabase = createClient();
      const authEmail = `${normalizedUsername}@users.myplan.invalid`;
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email: authEmail, password, options: { data: { username: normalizedUsername, full_name: name.trim() } } });
        if (error) throw error;
        if (data.session && data.user) { setUserId(data.user.id); setAccountName(name.trim() || normalizedUsername); }
        else setMessage("Hisob yaratish yakunlanmadi: Supabase Email confirmation sozlamasini tekshir.");
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email: authEmail, password });
        if (error) throw error;
        setUserId(data.user.id); setAccountName(String(data.user.user_metadata?.full_name || data.user.user_metadata?.username || normalizedUsername));
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Noma’lum xatolik yuz berdi."); }
    finally { setBusy(false); }
  }

  async function signOut() {
    const { error } = await createClient().auth.signOut();
    if (error) setMessage(error.message);
    else { setUserId(null); setActivities([]); setOccurrences([]); setMessage(""); }
  }

  async function createActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId || !newTitle.trim()) return;
    setBusy(true); setMessage("");
    try {
      const { error } = await createClient().from("activities").insert({ user_id: userId, title: newTitle.trim(), description: newDescription.trim(), schedule_type: newSchedule, schedule_rule: {}, measurement_type: "check", starts_on: today() });
      if (error) throw error;
      setNewTitle(""); setNewDescription(""); setNewSchedule("daily"); setShowCreate(false);
      await loadWorkspace(userId);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Faoliyat yaratilmadi."); }
    finally { setBusy(false); }
  }

  async function toggleComplete(activity: Activity) {
    if (!userId) return;
    const occurrence = occurrences.find((item) => item.activity_id === activity.id);
    if (!occurrence) return;
    const nextStatus = occurrence.status === "completed" ? "pending" : "completed";
    setOccurrences((current) => current.map((item) => item.id === occurrence.id ? { ...item, status: nextStatus } : item));
    const { error } = await createClient().from("occurrences").update({ status: nextStatus }).eq("id", occurrence.id).eq("user_id", userId);
    if (error) { setMessage(error.message); await loadWorkspace(userId); }
  }

  async function archiveActivity(id: string) {
    if (!userId) return;
    const { error } = await createClient().from("activities").update({ is_active: false }).eq("id", id).eq("user_id", userId);
    if (error) setMessage(error.message); else await loadWorkspace(userId);
  }

  const completedCount = useMemo(() => occurrences.filter((item) => item.status === "completed").length, [occurrences]);
  const percent = activities.length ? Math.round((completedCount / activities.length) * 100) : 0;

  if (userId) return (
    <main className={`workspace-shell${sidebarOpen ? "" : " sidebar-collapsed"}`}>
      <aside className="workspace-sidebar" onClick={() => { if (!sidebarOpen) setSidebarOpen(true); }} aria-label="Asosiy navigatsiya">
        <div className={`sidebar-brand-row${sidebarOpen ? "" : " sidebar-brand-collapsed"}`}><a className="brand" href="#workspace" aria-label="MYPLAN"><Image className="brand-logo" src="/myplan-logo.png" alt="" width={40} height={40} priority /><span>MYPLAN</span></a>{sidebarOpen && <button className="sidebar-toggle" type="button" onClick={() => setSidebarOpen(false)} aria-label="Sidebarni yopish" aria-expanded="true" title="Sidebarni yopish">‹</button>}{!sidebarOpen && <button className="sidebar-logo-reveal" type="button" onClick={() => setSidebarOpen(true)} aria-label="MYPLAN sidebarni ochish" aria-expanded="false" title="Sidebarni ochish"><Image className="sidebar-reveal-logo" src="/myplan-logo.png" alt="" width={40} height={40} priority /><span className="sidebar-reveal-name">MYPLAN</span><span className="sidebar-reveal-close" aria-hidden="true">‹</span></button>}</div>
        <div className="side-caption"><span>ISH MAYDONI</span></div>
        <button type="button" className={`side-link${activeTab === "today" ? " active" : ""}`} onClick={() => setActiveTab("today")} aria-current={activeTab === "today" ? "page" : undefined}><span className="side-icon">◷</span><span className="side-label">Bugungi reja</span></button>
        <button type="button" className={`side-link${activeTab === "activities" ? " active" : ""}`} onClick={() => setActiveTab("activities")} aria-current={activeTab === "activities" ? "page" : undefined}><span className="side-icon">▤</span><span className="side-label">Faoliyatlarim</span></button>
        <div className="sidebar-bottom"><div className="profile-chip"><div className="avatar">{(accountName || "M").slice(0, 1).toUpperCase()}</div><div className="profile-details"><strong>{accountName || "MYPLAN user"}</strong><small>Shaxsiy hisob</small></div></div><button className="logout-button" onClick={signOut}><span>Chiqish ↗</span></button></div>
      </aside>
      <section className="workspace-main" id="workspace">
        <header className="workspace-top"><div><span className="section-kicker">SHAXSIY MAYDONING</span><h1>Salom, <span>{(accountName || "do‘stim").split(" ")[0]}.</span></h1><p>Bugun o‘zing uchun nimadir qil.</p></div><div className="today-date">{dateLabel.format(new Date())}</div></header>
        {message && <p className="workspace-message" role="status">{message}</p>}
        {activeTab === "today" && <section className="overview-grid" id="today"><article className="overview-card progress-card"><div className="card-eyebrow">BUGUNGI NATIJA</div><div className="progress-number">{percent}<span>%</span></div><div className="progress-track"><i style={{ width: `${percent}%` }} /></div><p>{completedCount} ta bajarildi · {Math.max(activities.length - completedCount, 0)} ta qoldi</p></article><article className="overview-card"><div className="card-eyebrow">FAOLIYATLAR</div><div className="metric-number">{activities.length.toString().padStart(2, "0")}</div><p>Faol rejalaring</p></article><article className="overview-card"><div className="card-eyebrow">BUGUN</div><div className="metric-number">{completedCount.toString().padStart(2, "0")}</div><p>Bajarilgan ishlar</p></article></section>}
        <section className="activities-section" id="activities"><div className="section-title-row"><div><span className="section-kicker">{activeTab === "today" ? "BUGUNGI REJA" : "SENING BARCHA FAOLIYATLARING"}</span><h2>{activeTab === "today" ? "Bugungi vazifalar" : "Faoliyatlarim"}</h2></div><button className="add-button" onClick={() => setShowCreate((value) => !value)}>{showCreate ? "Yopish −" : "+ Yangi vazifa"}</button></div>
          {showCreate && <form className="create-form" onSubmit={createActivity}><label>Vazifa nomi<input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Masalan: 20 bet kitob o‘qish" maxLength={160} required /></label><label>Izoh <input value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Ixtiyoriy izoh" maxLength={500} /></label><label>Takrorlanish<select value={newSchedule} onChange={(e) => setNewSchedule(e.target.value as "daily" | "once")}><option value="daily">Har kuni</option><option value="once">Bir martalik</option></select></label><button className="add-button" type="submit" disabled={busy}>{busy ? "Saqlanmoqda…" : "Saqlash ↗"}</button></form>}
          {loadingData ? <div className="empty-state">Rejalaring yuklanmoqda…</div> : activities.length === 0 ? <div className="empty-state"><div className="empty-symbol">✳</div><h3>Bu yer hali bo‘sh.</h3><p>Birinchi vazifangni qo‘sh. Katta natija kichik qadamdan boshlanadi.</p><button className="add-button" onClick={() => setShowCreate(true)}>+ Birinchi vazifani yarat</button></div> : <div className="activity-list">{activities.map((activity) => { const occurrence = occurrences.find((item) => item.activity_id === activity.id); const done = occurrence?.status === "completed"; return <article className={`activity-item${done ? " is-done" : ""}`} key={activity.id}><button className="complete-button" aria-label={done ? "Bajarilmadi deb belgilash" : "Bajarildi deb belgilash"} onClick={() => void toggleComplete(activity)}>{done ? "✓" : ""}</button><div className="activity-copy"><strong>{activity.title}</strong>{activity.description && <p>{activity.description}</p>}<small>{activity.schedule_type === "daily" ? "HAR KUNI" : "BIR MARTALIK"}</small></div><button className="archive-button" onClick={() => void archiveActivity(activity.id)} title="Faoliyatni arxivlash" aria-label="Faoliyatni arxivlash">•••</button></article>; })}</div>}
        </section>
        <footer className="workspace-footer">MYPLAN <span>YOUR PLAN. YOUR PACE.</span></footer>
      </section>
    </main>
  );

  return (
    <main className="site-shell">
      <header className="topbar"><a className="brand" href="#top" aria-label="MYPLAN bosh sahifa"><Image className="brand-logo" src="/myplan-logo.png" alt="" width={44} height={44} priority /><span>MYPLAN</span></a><nav className="top-links"><a href="#features">IMKONIYATLAR</a><a href="#how">QANDAY ISHLAYDI</a><a href="#auth">BOSHLASH ↗</a></nav></header>
      <section className="auth-hero" id="top"><div className="hero-copy"><div className="eyebrow"><i /> SHAXSIY RIVOJLANISH MAYDONING</div><h1>Rejangni tuz.<br /><span>O‘zingni</span> o‘stir.</h1><p className="hero-intro">Maqsadlaringni aniq rejalashtir, har kungi qadamingni kuzat va kichik yutuqlaringni katta natijaga aylantir.</p><div className="hero-points"><span><b>01</b> Rejalaring bir joyda</span><span><b>02</b> Taraqqiyoting ko‘z oldingda</span><span><b>03</b> O‘z sur’atingda rivojlan</span></div></div>
        <section className="auth-card" id="auth" aria-label="Hisobga kirish"><div className="auth-card-top"><span className="tiny-label">MYPLAN ACCOUNT</span><span className="secure-mark">● PRIVATE SPACE</span></div><div className="auth-heading"><h2>{mode === "login" ? "Yana ko‘rishganimizdan xursandmiz." : "O‘z yo‘lingni boshlagin."}</h2><p className="auth-sub">{mode === "login" ? "Davom etish uchun hisobingga kir." : "Bir necha soniyada bepul hisob yarat."}</p></div><div className="auth-tabs" role="tablist" aria-label="Kirish yoki ro‘yxatdan o‘tish"><button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setMessage(""); }}>Login</button><button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setMessage(""); }}>Sign up</button></div><form className="auth-form" onSubmit={submit}>{mode === "signup" && <label>Isming<input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Isming va familiyang" maxLength={80} required /></label>}<label>Username<input type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="masalan: mrdevs" minLength={3} maxLength={24} pattern="[A-Za-z0-9_]{3,24}" spellCheck={false} autoCapitalize="none" required /></label><label>Parol<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Kamida 8 ta belgi" minLength={8} required /></label>{message && <p className="auth-message" role="status">{message}</p>}{!configured && <p className="auth-message">Supabase sozlanmagan. Environment qiymatlarini tekshir.</p>}{mode === "signup" && <p className="auth-hint">Username login noming bo‘ladi. Email talab qilinmaydi.</p>}<button className="primary-button" type="submit" disabled={busy || !configured}>{busy ? "KUTILMOQDA…" : mode === "login" ? "Hisobga kirish" : "Bepul hisob yaratish"}<span>↗</span></button></form><p className="auth-terms">Davom etish orqali foydalanish shartlariga rozilik bildirasan.</p></section>
      </section>
      <section className="feature-section" id="features"><div className="section-kicker">01 — IMKONIYATLAR</div><div className="section-heading"><h2>Tartib — erkinlikning<br /><span>boshlanishi.</span></h2><p>MYPLAN kunlaringni murakkablashtirish uchun emas, fikringni jamlash va oldinga yurishing uchun yaratilmoqda.</p></div><div className="feature-grid"><article><span>01 / TODAY</span><h3>Bugungi reja</h3><p>Bugun bajarishing kerak bo‘lgan ishlarni bir joyda ko‘r.</p></article><article><span>02 / CALENDAR</span><h3>Vaqt nazorati</h3><p>Rejalaring va bajarilgan ishlaringni kalendarda kuzat.</p></article><article><span>03 / PROGRESS</span><h3>O‘sish statistikasi</h3><p>Natijalaringni ko‘r, odatlaringni tahlil qil va davom et.</p></article></div></section>
      <section className="how-section" id="how"><div className="section-kicker">02 — QANDAY ISHLAYDI</div><h2>Kichik qadamlar.<br /><span>Katta o‘zgarishlar.</span></h2><div className="steps"><p><b>01</b> Hisob yarat</p><p><b>02</b> Maqsad va faoliyatlaringni belgilab ol</p><p><b>03</b> Har kuni oz-ozdan oldinga yur</p></div></section>
      <footer className="footer"><a className="brand" href="#top" aria-label="MYPLAN bosh sahifa"><Image className="brand-logo" src="/myplan-logo.png" alt="" width={44} height={44} priority /><span>MYPLAN</span></a><span>YOUR PLAN. YOUR PACE.</span><a href="#auth">BOSHLASH ↑</a></footer>
    </main>
  );
}
