"use client";

import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  IconArrowRight,
  IconEye,
  IconEyeOff,
  IconShield,
  IconSparkles,
  IconCalendar,
  IconHash,
  IconBarChart,
  IconDownload,
} from "@/components/icons";
import { syncCurrentDeviceSession } from "@/lib/device-session";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function AuthView({ initialMode = "login" }: { initialMode?: "login" | "signup" }) {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">(initialMode);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [configured] = useState(isSupabaseConfigured());

  // PWA state
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isAppInstalled, setIsAppInstalled] = useState(false);

  // Debounced validations (2 seconds debounce)
  const [debouncedAgeError, setDebouncedAgeError] = useState("");
  const [debouncedPasswordError, setDebouncedPasswordError] = useState("");
  const [isAddingAccount, setIsAddingAccount] = useState(false);

  useEffect(() => {
    const addingIntent = typeof window !== "undefined" && localStorage.getItem("myplan_add_account_intent") === "true";
    setTimeout(() => setIsAddingAccount(addingIntent), 0);

    // Check if session already exists
    if (!configured) return;
    const supabase = createClient();
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user && !addingIntent) {
        router.replace("/");
      }
    });

    // PWA beforeinstallprompt handler
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

      if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
        navigator.serviceWorker.register("/sw.js").catch(() => {});
      }
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
        window.removeEventListener("appinstalled", handleAppInstalled);
      }
    };
  }, [configured, router]);

  // Debounced age validation (2 seconds)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (mode !== "signup" || !age) {
        setDebouncedAgeError("");
        return;
      }
      const parsed = parseInt(age, 10);
      if (age.length > 3 || parsed > 999) {
        setDebouncedAgeError("Iltimos, haqiqiy yosh qiymatini kiriting (maksimal 3 xonali son).");
      } else if (parsed > 122) {
        setDebouncedAgeError("Kiritilgan yosh qiymati haqiqatga mos kelmaydi. Iltimos, amaldagi yoshingizni kiriting.");
      } else if (parsed < 6 && age !== "") {
        setDebouncedAgeError("MyPlan tizimidan mustaqil foydalanish uchun foydalanuvchi kamida 6 yosh bo‘lishi lozim.");
      } else {
        setDebouncedAgeError("");
      }
    }, mode !== "signup" || !age ? 0 : 2000);
    return () => clearTimeout(timer);
  }, [age, mode]);

  // Debounced password validation (2 seconds)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!password) {
        setDebouncedPasswordError("");
        return;
      }
      if (password.length > 0 && password.length < 8) {
        setDebouncedPasswordError("Xavfsizlik talablariga muvofiq parol kamida 8 ta belgidan iborat bo‘lishi shart.");
      } else if (mode === "signup" && confirmPassword && password !== confirmPassword) {
        setDebouncedPasswordError("Kiritilgan tasdiqlash paroli asosiy parolga mos kelmadi. Iltimos, tekshirib qayta kiriting.");
      } else {
        setDebouncedPasswordError("");
      }
    }, !password ? 0 : 2000);
    return () => clearTimeout(timer);
  }, [password, confirmPassword, mode]);

  const switchMode = (newMode: "login" | "signup") => {
    setMode(newMode);
    setMessage("");
    if (typeof window !== "undefined") {
      window.history.pushState(null, "", `/${newMode}`);
    }
  };

  const handleInstallApp = async () => {
    if (!deferredPrompt) {
      alert("Bu brauzer MyPlan’ni bevosita o‘rnatish oynasini qo‘llab-quvvatlamaydi. Chrome yoki Edge’ning so‘nggi versiyasida ochib, manzil panelidagi o‘rnatish belgisidan foydalan.");
      return;
    }
    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      // Wait for the browser's appinstalled event before showing installed state.
      setDeferredPrompt(null);
    } catch (error) {
      console.error("MyPlan PWA installation failed:", error);
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMessage("");

    const normalizedUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(normalizedUsername)) {
      setMessage("Foydalanuvchi nomi 3 dan 24 tagacha belgidan iborat bo‘lishi lozim (lotin harflari, raqam va pastki chiziq).");
      return;
    }

    if (mode === "signup") {
      const parsedAge = parseInt(age, 10);
      if (age.length > 3 || parsedAge > 999) {
        setMessage("Iltimos, haqiqiy yosh qiymatini kiriting (maksimal 3 xonali son).");
        return;
      }
      if (isNaN(parsedAge) || parsedAge < 6) {
        setMessage("MyPlan tizimidan mustaqil foydalanish uchun foydalanuvchi kamida 6 yosh bo‘lishi lozim.");
        return;
      }
      if (parsedAge > 122) {
        setMessage("Kiritilgan yosh qiymati haqiqatga mos kelmaydi. Iltimos, amaldagi yoshingizni kiriting.");
        return;
      }
      if (password !== confirmPassword) {
        setMessage("Kiritilgan tasdiqlash paroli asosiy parolga mos kelmadi. Iltimos, tekshirib qayta kiriting.");
        return;
      }
    }

    if (password.length < 8) {
      setMessage("Xavfsizlik talablariga muvofiq parol kamida 8 ta belgidan iborat bo‘lishi shart.");
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
        const newUser = data.user;
        if (data.session && newUser) {
          if (typeof window !== "undefined") {
            void syncCurrentDeviceSession(supabase, newUser.id);
            localStorage.removeItem("myplan_add_account_intent");
            try {
              const rawVault = localStorage.getItem("myplan_accounts_vault");
              const vault = rawVault ? JSON.parse(rawVault) : [];
              const accountItem = {
                id: newUser.id,
                username: normalizedUsername,
                fullName: name.trim() || normalizedUsername,
                age: parseInt(age, 10) || null,
                addedAt: Date.now(),
              };
              const filtered = vault.filter((acc: { id: string }) => acc.id !== newUser.id);
              if (filtered.length >= 5) filtered.shift();
              filtered.push(accountItem);
              localStorage.setItem("myplan_accounts_vault", JSON.stringify(filtered));
              localStorage.setItem("myplan_active_account_id", newUser.id);
            } catch (err) {
              console.error(err);
            }
          }
          router.replace("/");
        } else {
          setMessage("Hisob yaratildi. Tizimga kirishingiz mumkin.");
          switchMode("login");
        }
      } else {
        const { data: signInData, error } = await supabase.auth.signInWithPassword({
          email: authEmail,
          password,
        });
        if (error) throw error;
        if (typeof window !== "undefined" && signInData.user) {
          localStorage.removeItem("myplan_add_account_intent");
          void syncCurrentDeviceSession(supabase, signInData.user.id);
          try {
            const rawVault = localStorage.getItem("myplan_accounts_vault");
            const vault = rawVault ? JSON.parse(rawVault) : [];
            const accountItem = {
              id: signInData.user.id,
              username: normalizedUsername,
              fullName: String(signInData.user.user_metadata?.full_name || normalizedUsername),
              age: signInData.user.user_metadata?.age || null,
              addedAt: Date.now(),
            };
            const filtered = vault.filter((acc: { id: string }) => acc.id !== signInData.user.id);
            if (filtered.length >= 5) filtered.shift();
            filtered.push(accountItem);
            localStorage.setItem("myplan_accounts_vault", JSON.stringify(filtered));
            localStorage.setItem("myplan_active_account_id", signInData.user.id);
          } catch (err) {
            console.error(err);
          }
        }
        router.replace("/");
      }
    } catch (error) {
      const rawMsg = error instanceof Error ? error.message : "";
      if (
        mode === "login" &&
        (rawMsg.toLowerCase().includes("invalid") ||
          rawMsg.toLowerCase().includes("credentials") ||
          rawMsg.toLowerCase().includes("not found"))
      ) {
        setMessage("Foydalanuvchi nomi yoki parol noto‘g‘ri kiritildi. Iltimos, ma’lumotlarni tekshirib qayta urinib ko‘ring.");
      } else if (
        rawMsg.toLowerCase().includes("already registered") ||
        rawMsg.toLowerCase().includes("exists")
      ) {
        setMessage("Ushbu foydalanuvchi nomi allaqachon ro‘yxatdan o‘tgan. Iltimos, boshqa nom tanlang.");
      } else {
        setMessage("Tizimga kirishda xatolik yuz berdi. Iltimos, ma’lumotlarni tekshirib qayta urinib ko‘ring.");
      }
    } finally {
      setBusy(false);
    }
  };

  const parsedAgeNum = parseInt(age, 10);
  const isAgeInvalid =
    mode === "signup" &&
    (age.trim() === "" ||
      isNaN(parsedAgeNum) ||
      parsedAgeNum < 6 ||
      parsedAgeNum > 122 ||
      age.length > 3);

  const isSubmitDisabled =
    busy ||
    !configured ||
    (mode === "signup" &&
      (isAgeInvalid ||
        Boolean(debouncedAgeError) ||
        password.length < 8 ||
        password !== confirmPassword)) ||
    (mode === "login" && (username.trim().length < 3 || password.length < 8));

  return (
    <div className="landing-layout auth-dedicated-layout">
      {/* Top Navigation Bar: Minimal & Corporate */}
      <header className="landing-navbar">
        <div className="navbar-container">
          <Link href="/" className="brand-link" aria-label="MyPlan bosh sahifasi">
            <Image
              className="brand-logo"
              src="/myplan-logo-transparent.png"
              alt="MyPlan"
              width={38}
              height={38}
              priority
            />
            <span className="brand-title">
              <span className="brand-my">My</span><span className="brand-plan">Plan</span>
            </span>
          </Link>

          <div className="navbar-right-actions">
            {!isAppInstalled && (
              <button
                type="button"
                className="btn-pwa-install-nav"
                onClick={handleInstallApp}
                title="Ilovani qurilmaga o‘rnatish"
              >
                <IconDownload className="icon-xs" />
                <span>Ilovani o‘rnatish</span>
              </button>
            )}

            <div className="brand-tagline-badge">
              <span>Plan your day. Own your time.</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Focus: Login / Signup Box Centered at the Very Top */}
      <main className="auth-main-wrapper">
        <section className="auth-hero-primary-section">
          <div className="auth-hero-centered-container">
            <div className="auth-glass-card auth-card-elevated">
              <div className="auth-card-top-bar">
                <span className="auth-badge">MYPLAN SHAXSIY HISOB</span>
                <span className="auth-security">
                  <IconShield className="icon-xs" /> XAVFSIZ VA MAXFIY
                </span>
              </div>

              {isAddingAccount && (
                <div className="add-account-intent-banner">
                  <div className="banner-text">
                    <strong>Yangi hisob qo‘shish rejimi (Maksimal 5 ta)</strong>
                    <p>Mavjud hisoblaringizga yangi profil ulanadi.</p>
                  </div>
                  <button
                    type="button"
                    className="btn-cancel-add-account"
                    onClick={() => {
                      if (typeof window !== "undefined") {
                        localStorage.removeItem("myplan_add_account_intent");
                      }
                      router.replace("/");
                    }}
                  >
                    Bekor qilish
                  </button>
                </div>
              )}

              <div className="auth-title-block">
                <h2>{mode === "login" ? "Tizimga kirish" : "Yangi hisob yaratish"}</h2>
                <p>
                  {mode === "login"
                    ? "Shaxsiy rejalaringizni davom ettirish uchun tizimga kiring."
                    : "Kuningizni samarali rejalashtirish uchun bepul ro‘yxatdan o‘ting."}
                </p>
              </div>

              {/* Mode Switcher Tabs */}
              <div className="auth-mode-toggle" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "login"}
                  className={`mode-btn ${mode === "login" ? "active" : ""}`}
                  onClick={() => switchMode("login")}
                >
                  Kirish
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "signup"}
                  className={`mode-btn ${mode === "signup" ? "active" : ""}`}
                  onClick={() => switchMode("signup")}
                >
                  Ro‘yxatdan o‘tish
                </button>
              </div>

              {/* Form Body */}
              <form className="auth-form-body" onSubmit={handleSubmit}>
                {mode === "signup" && (
                  <div className="input-group">
                    <label htmlFor="auth-name">Ism va familiya *</label>
                    <input
                      id="auth-name"
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Masalan: Sardor Aliyev"
                      maxLength={80}
                      required
                    />
                  </div>
                )}

                <div className="input-group">
                  <label htmlFor="auth-username">Foydalanuvchi nomi (Username) *</label>
                  <input
                    id="auth-username"
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Masalan: sardor_a"
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
                      type="text"
                      inputMode="numeric"
                      value={age}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, "").slice(0, 3);
                        setAge(val);
                      }}
                      placeholder="Masalan: 24"
                      maxLength={3}
                      required
                    />
                    {debouncedAgeError && (
                      <p className="auth-validation-error" role="alert">
                        {debouncedAgeError}
                      </p>
                    )}
                  </div>
                )}

                {/* Password input with toggle */}
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
                  {mode === "login" && debouncedPasswordError && (
                    <p className="auth-validation-error" role="alert">
                      {debouncedPasswordError}
                    </p>
                  )}
                </div>

                {/* Confirm Password (signup only) */}
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
                    {debouncedPasswordError && (
                      <p className="auth-validation-error" role="alert">
                        {debouncedPasswordError}
                      </p>
                    )}
                  </div>
                )}

                {message && (
                  <div className="auth-alert-message" role="status">
                    <span>{message}</span>
                  </div>
                )}

                {!configured && (
                  <div className="auth-alert-message warning">
                    <span>Supabase sozlanmagan. Tizim sozlamalarini tekshiring.</span>
                  </div>
                )}

                {mode === "signup" && (
                  <p className="auth-field-hint">
                    Foydalanuvchi nomi tizimga kirish uchun asosiy identifikator hisoblanadi.
                  </p>
                )}

                <button
                  className="btn-auth-submit"
                  type="submit"
                  disabled={isSubmitDisabled}
                >
                  <span>
                    {busy
                      ? "Iltimos, kuting…"
                      : mode === "login"
                        ? "Hisobga kirish"
                        : "Ro‘yxatdan o‘tishni yakunlash"}
                  </span>
                  <IconArrowRight className="icon-sm" />
                </button>
              </form>

              <div className="auth-terms-notice">
                <span>
                  Davom etish orqali siz MyPlan xizmatidan foydalanish qoidalariga rozilik bildirasiz.
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Onboarding Section Below Login Card: Full Enterprise Presentation */}
        <section className="onboarding-showcase-section">
          <div className="onboarding-container">
            <div className="onboarding-header-center">
              <span className="onboarding-badge">
                <IconSparkles className="icon-xs" /> MYPLAN METODOLOGIYASI
              </span>
              <h2 className="onboarding-title">Plan your day. Own your time.</h2>
              <p className="onboarding-subtitle">
                O‘z maqsadlaringizni aniq belgilang, har kungi qadamlaringizni kuzatib boring va
                kichik yutuqlaringizni barqaror buyuk natijalarga aylantiring.
              </p>
            </div>

            {/* Strategic Pillars */}
            <div className="pillars-grid">
              <div className="pillar-card">
                <div className="pillar-icon-wrap">
                  <IconCalendar className="icon-md" />
                </div>
                <h3>Kunlik tartib intizomi</h3>
                <p>
                  Har tong rejalaringizni aniq ko‘ring. Kun davomida bajarilgan ishlarni qayd etib,
                  chalg‘imasdan diqqatni eng muhim vazifalarga qarating.
                </p>
              </div>

              <div className="pillar-card">
                <div className="pillar-icon-wrap">
                  <IconHash className="icon-md" />
                </div>
                <h3>Sanoqli va odatli maqsadlar</h3>
                <p>
                  Faqat bir martalik ishlar emas, balki takrorlanuvchi amallarni (masalan, 100 ta
                  mashq, 50 bet kitob) interaktiv +1, +5, +10 tugmalari orqali hisoblang.
                </p>
              </div>

              <div className="pillar-card">
                <div className="pillar-icon-wrap">
                  <IconBarChart className="icon-md" />
                </div>
                <h3>Ko‘rsatkichlar tahlili</h3>
                <p>
                  O‘sishingizni raqamlarda ko‘ring. Haftalik va oylik ko‘rsatkichlar orqali shaxsiy
                  unumdorligingiz darajasini tahlil qiling.
                </p>
              </div>
            </div>

            {/* Step-by-Step Guide */}
            <div className="onboarding-steps-block">
              <h3 className="steps-title">Qanday ishlaydi? 3 ta oddiy qadam</h3>
              <div className="steps-row">
                <div className="step-item">
                  <div className="step-number">01</div>
                  <h4>Hisobingizni oching</h4>
                  <p>Bir necha soniyada shaxsiy parolingiz bilan xavfsiz hisob yarating.</p>
                </div>
                <div className="step-item">
                  <div className="step-number">02</div>
                  <h4>Rejalaringizni kiriting</h4>
                  <p>Kunlik yoki bir martalik, oddiy yoki sanoqli maqsadlarni belgilang.</p>
                </div>
                <div className="step-item">
                  <div className="step-number">03</div>
                  <h4>Natijani qayd eting</h4>
                  <p>Har kuni belgilab boring va unumdorligingiz ortishiga guvoh bo‘ling.</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Corporate Footer */}
      <footer className="landing-footer">
        <div className="footer-container">
          <Link href="/" className="footer-brand">
            <Image src="/myplan-logo-transparent.png" alt="MyPlan" width={32} height={32} priority />
            <span>MyPlan</span>
          </Link>
          <span className="footer-center-tag">PLAN YOUR DAY. OWN YOUR TIME.</span>
          <span className="footer-copyright">
            © 2026 MyPlan Inc. Barcha huquqlar himoyalangan.
          </span>
        </div>
      </footer>
    </div>
  );
}
