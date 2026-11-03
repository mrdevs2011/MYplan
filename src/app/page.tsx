"use client";

import { FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

type Mode = "login" | "signup";

export default function Home() {
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [signedInUsername, setSignedInUsername] = useState<string | null>(null);
  const [configured] = useState(isSupabaseConfigured());

  useEffect(() => {
    if (!configured) return;
    let active = true;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (active && data.user) setSignedInUsername(String(data.user.user_metadata?.username ?? "MYPLAN foydalanuvchisi"));
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setSignedInUsername(session?.user ? String(session.user.user_metadata?.username ?? "MYPLAN foydalanuvchisi") : null);
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, [configured]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const normalizedUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(normalizedUsername)) {
      setMessage("Username 3–24 ta belgidan iborat bo‘lsin: faqat lotin harflari, raqam va _.");
      return;
    }
    setBusy(true);
    try {
      const supabase = createClient();
      // Supabase password auth requires an email/phone. MYPLAN maps usernames to
      // a reserved, non-deliverable internal address; users never see or enter it.
      const authEmail = `${normalizedUsername}@users.myplan.invalid`;
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: authEmail,
          password,
          options: { data: { username: normalizedUsername, full_name: name.trim() } },
        });
        if (error) throw error;
        if (data.session && data.user) setSignedInUsername(normalizedUsername);
        else setMessage("Ro‘yxatdan o‘tish so‘rovi qabul qilindi, ammo sessiya yaratilmadi. Supabase’da Email confirmation o‘chirilganini tekshir.");
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email: authEmail, password });
        if (error) throw error;
        setSignedInUsername(String(data.user.user_metadata?.username ?? normalizedUsername));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Noma’lum xatolik yuz berdi.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setSignedInUsername(null);
      setMessage("Hisobdan chiqding.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Hisobdan chiqishda xatolik yuz berdi.");
    }
  }

  return (
    <main className="site-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="MYPLAN bosh sahifa"><Image className="brand-logo" src="/myplan-logo.png" alt="" width={44} height={44} priority /><span>MYPLAN</span></a>
        <nav className="top-links"><a href="#features">IMKONIYATLAR</a><a href="#how">QANDAY ISHLAYDI</a><a href="#auth">BOSHLASH ↗</a></nav>
      </header>

      <section className="auth-hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow"><i /> SHAXSIY RIVOJLANISH MAYDONING</div>
          <h1>Rejangni tuz.<br /><span>O‘zingni</span> o‘stir.</h1>
          <p className="hero-intro">Maqsadlaringni aniq rejalashtir, har kungi qadamingni kuzat va kichik yutuqlaringni katta natijaga aylantir.</p>
          <div className="hero-points"><span><b>01</b> Rejalaring bir joyda</span><span><b>02</b> Taraqqiyoting ko‘z oldingda</span><span><b>03</b> O‘z sur’atingda rivojlan</span></div>
        </div>

        <section className="auth-card" id="auth" aria-label="Hisobga kirish">
          <div className="auth-card-top"><span className="tiny-label">MYPLAN ACCOUNT</span><span className="secure-mark">● PRIVATE SPACE</span></div>
          {signedInUsername ? (
            <div className="signed-in"><div className="success-icon">✓</div><h2>Xush kelibsan!</h2><p className="auth-sub">@{signedInUsername}</p><p className="auth-message">Hisobingga muvaffaqiyatli kirding.</p><button className="primary-button" onClick={signOut}>Hisobdan chiqish <span>↗</span></button></div>
          ) : (
            <>
              <div className="auth-heading"><h2>{mode === "login" ? "Yana ko‘rishganimizdan xursandmiz." : "O‘z yo‘lingni boshlagin."}</h2><p className="auth-sub">{mode === "login" ? "Davom etish uchun hisobingga kir." : "Bir necha soniyada bepul hisob yarat."}</p></div>
              <div className="auth-tabs" role="tablist" aria-label="Kirish yoki ro‘yxatdan o‘tish"><button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setMessage(""); }}>Login</button><button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setMessage(""); }}>Sign up</button></div>
              <form className="auth-form" onSubmit={submit}>
                {mode === "signup" && <label>Isming<input autoComplete="name" value={name} onChange={e => setName(e.target.value)} placeholder="Isming va familiyang" maxLength={80} required /></label>}
                <label>Username<input type="text" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} placeholder="masalan: mrdevs" minLength={3} maxLength={24} pattern="[A-Za-z0-9_]{3,24}" spellCheck={false} autoCapitalize="none" required /></label>
                <label>Parol<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="Kamida 8 ta belgi" minLength={8} required /></label>
                {message && <p className="auth-message" role="status">{message}</p>}
                {!configured && <p className="auth-message">Supabase sozlanmagan. Environment qiymatlarini tekshir.</p>}
                {mode === "signup" && <p className="auth-hint">Username keyinchalik o‘zgarmas login nomi sifatida ishlatiladi. Email talab qilinmaydi.</p>}
                <button className="primary-button" type="submit" disabled={busy || !configured}>{busy ? "KUTILMOQDA…" : mode === "login" ? "Hisobga kirish" : "Bepul hisob yaratish"}<span>↗</span></button>
              </form>
              <p className="auth-terms">Davom etish orqali foydalanish shartlariga rozilik bildirasan.</p>
            </>
          )}
        </section>

      </section>

      <section className="feature-section" id="features"><div className="section-kicker">01 — IMKONIYATLAR</div><div className="section-heading"><h2>Tartib — erkinlikning<br /><span>boshlanishi.</span></h2><p>MYPLAN kunlaringni murakkablashtirish uchun emas, fikringni jamlash va oldinga yurishing uchun yaratilmoqda.</p></div><div className="feature-grid"><article><span>01 / TODAY</span><h3>Bugungi reja</h3><p>Bugun bajarishing kerak bo‘lgan ishlarni bir joyda ko‘r.</p></article><article><span>02 / CALENDAR</span><h3>Vaqt nazorati</h3><p>Rejalaring va bajarilgan ishlaringni kalendarda kuzat.</p></article><article><span>03 / PROGRESS</span><h3>O‘sish statistikasi</h3><p>Natijalaringni ko‘r, odatlaringni tahlil qil va davom et.</p></article></div></section>
      <section className="how-section" id="how"><div className="section-kicker">02 — QANDAY ISHLAYDI</div><h2>Kichik qadamlar.<br /><span>Katta o‘zgarishlar.</span></h2><div className="steps"><p><b>01</b> Hisob yarat</p><p><b>02</b> Maqsad va faoliyatlaringni belgilab ol</p><p><b>03</b> Har kuni oz-ozdan oldinga yur</p></div></section>
      <footer className="footer"><a className="brand" href="#top" aria-label="MYPLAN bosh sahifa"><Image className="brand-logo" src="/myplan-logo.png" alt="" width={44} height={44} priority /><span>MYPLAN</span></a><span>YOUR PLAN. YOUR PACE.</span><a href="#auth">BOSHLASH ↑</a></footer>
    </main>
  );
}
