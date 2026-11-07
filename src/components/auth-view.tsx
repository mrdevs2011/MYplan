"use client";

import { saveAccountSession } from "@/lib/account-sessions";
import { markCleanSlateEpoch } from "@/lib/epoch";
import { useEffect, useRef, useState, type FormEvent } from "react";
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
import { authText } from "@/lib/auth-translations";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function AuthView({ initialMode = "login" }: { initialMode?: "login" | "signup" }) {
  const router = useRouter();
  // Before sign-in there is no account yet: the page follows the language chosen on this device.
  const [language, setLanguage] = useState("uz");
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        setLanguage(localStorage.getItem("myplan_lang") || "uz");
      } catch {
        // Storage can be blocked: stay on the default.
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  const a = authText(language);
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
  // True only when this page was opened by tapping "add account" inside the app. Read once: a page refresh loses it.
  const freshAddRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (freshAddRef.current === null && typeof window !== "undefined") {
      try {
        freshAddRef.current = sessionStorage.getItem("myplan_add_account_fresh") === "1";
        sessionStorage.removeItem("myplan_add_account_fresh");
      } catch {
        freshAddRef.current = true;
      }
    }
    const addingIntent = typeof window !== "undefined" && localStorage.getItem("myplan_add_account_intent") === "true";
    setTimeout(() => setIsAddingAccount(addingIntent), 0);
    if (addingIntent && typeof window !== "undefined") {
      const pendingAccountId = localStorage.getItem("myplan_switch_account_id");
      if (pendingAccountId) {
        try {
          const rawVault = localStorage.getItem("myplan_accounts_vault");
          const vault = rawVault ? JSON.parse(rawVault) as Array<{ id: string; username?: string }> : [];
          const target = vault.find((account) => account.id === pendingAccountId);
          if (target?.username) setTimeout(() => setUsername(target.username || ""), 0);
        } catch (error) {
          console.warn("Could not restore the selected account username:", error);
        }
      }
    }

    // Check if session already exists
    if (!configured) return;
    const supabase = createClient();
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user && !addingIntent) {
        router.replace("/");
      } else if (session?.user && addingIntent && freshAddRef.current === false) {
        // Refreshing (or re-opening) the add-account page while still signed in: go back to the app instead of
        // leaving the user on a login form for an account they did not ask to switch.
        localStorage.removeItem("myplan_add_account_intent");
        localStorage.removeItem("myplan_switch_account_id");
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
        setDebouncedAgeError(a.e_age_len);
      } else if (parsed > 122) {
        setDebouncedAgeError(a.e_age_big);
      } else if (parsed < 6 && age !== "") {
        setDebouncedAgeError(a.e_age_min);
      } else {
        setDebouncedAgeError("");
      }
    }, mode !== "signup" || !age ? 0 : 2000);
    return () => clearTimeout(timer);
  }, [age, mode, a]);

  // Debounced password validation (2 seconds)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!password) {
        setDebouncedPasswordError("");
        return;
      }
      if (password.length > 0 && password.length < 8) {
        setDebouncedPasswordError(a.e_pw_short);
      } else if (mode === "signup" && confirmPassword && password !== confirmPassword) {
        setDebouncedPasswordError(a.e_pw_match);
      } else {
        setDebouncedPasswordError("");
      }
    }, !password ? 0 : 2000);
    return () => clearTimeout(timer);
  }, [password, confirmPassword, mode, a]);

  const switchMode = (newMode: "login" | "signup") => {
    setMode(newMode);
    setMessage("");
    if (typeof window !== "undefined") {
      window.history.pushState(null, "", `/${newMode}`);
    }
  };

  const handleInstallApp = async () => {
    if (!deferredPrompt) {
      alert(a.install_unsupported);
      return;
    }
    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      // Wait for the browser's appinstalled event before showing installed state.
      setDeferredPrompt(null);
    } catch (error) {
      console.error("MyLife PWA installation failed:", error);
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMessage("");

    const normalizedUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,24}$/.test(normalizedUsername)) {
      setMessage(a.e_username);
      return;
    }

    if (mode === "signup") {
      const parsedAge = parseInt(age, 10);
      if (age.length > 3 || parsedAge > 999) {
        setMessage(a.e_age_len);
        return;
      }
      if (isNaN(parsedAge) || parsedAge < 6) {
        setMessage(a.e_age_min);
        return;
      }
      if (parsedAge > 122) {
        setMessage(a.e_age_big);
        return;
      }
      if (password !== confirmPassword) {
        setMessage(a.e_pw_match);
        return;
      }
    }

    if (password.length < 8) {
      setMessage(a.e_pw_short);
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
        markCleanSlateEpoch();
        const newUser = data.user;
        if (data.session && newUser) {
          saveAccountSession(data.session);
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
          setMessage(a.ok_created);
          switchMode("login");
        }
      } else {
        const { data: signInData, error } = await supabase.auth.signInWithPassword({
          email: authEmail,
          password,
        });
        if (error) throw error;
        markCleanSlateEpoch();
        if (typeof window !== "undefined" && signInData.user) {
          const expectedAccountId = localStorage.getItem("myplan_switch_account_id");
          if (expectedAccountId && signInData.user.id !== expectedAccountId) {
            await supabase.auth.signOut({ scope: "local" });
            setMessage(a.e_switch);
            return;
          }
          const { data: persistedSession, error: sessionError } = await supabase.auth.getSession();
          if (sessionError) throw sessionError;
          if (persistedSession.session?.user.id !== signInData.user.id) {
            await supabase.auth.signOut({ scope: "local" });
            throw new Error(a.e_session);
          }
          saveAccountSession(persistedSession.session);
          localStorage.removeItem("myplan_switch_account_id");
          localStorage.removeItem("myplan_add_account_intent");
          await syncCurrentDeviceSession(supabase, signInData.user.id);
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
        if (typeof window !== "undefined") {
          window.location.replace("/");
          return;
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
        setMessage(a.e_bad_cred);
      } else if (
        rawMsg.toLowerCase().includes("already registered") ||
        rawMsg.toLowerCase().includes("exists")
      ) {
        setMessage(a.e_taken);
      } else {
        setMessage(a.e_generic);
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
          <Link href="/" className="brand-link" aria-label={a.brand_aria}>
            <Image
              className="brand-logo"
              src="/myplan-logo-192.png" unoptimized
              alt="MyLife"
              width={38}
              height={38}
              priority
            />
            <span className="brand-title">
              <span className="brand-my">My</span><span className="brand-plan">Life</span>
            </span>
          </Link>

          <div className="navbar-right-actions">
            {!isAppInstalled && (
              <button
                type="button"
                className="btn-pwa-install-nav"
                onClick={handleInstallApp}
                title={a.install_title}
              >
                <IconDownload className="icon-xs" />
                <span>{a.install_btn}</span>
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
                <span className="auth-badge">MYLIFE SHAXSIY HISOB</span>
                <span className="auth-security">
                  <IconShield className="icon-xs" /> {a.secure_badge}
                </span>
              </div>

              {isAddingAccount && (
                <div className="add-account-intent-banner">
                  <div className="banner-text">
                    <strong>{a.add_banner_title}</strong>
                    <p>{a.add_banner_desc}</p>
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
                    {a.cancel}
                  </button>
                </div>
              )}

              <div className="auth-title-block">
                <h2>{mode === "login" ? a.title_login : a.title_signup}</h2>
                <p>
                  {mode === "login"
                    ? a.sub_login
                    : a.sub_signup}
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
                  {a.tab_login}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === "signup"}
                  className={`mode-btn ${mode === "signup" ? "active" : ""}`}
                  onClick={() => switchMode("signup")}
                >
                  {a.tab_signup}
                </button>
              </div>

              {/* Form Body */}
              <form className="auth-form-body" onSubmit={handleSubmit}>
                {mode === "signup" && (
                  <div className="input-group">
                    <label htmlFor="auth-name">{a.label_name}</label>
                    <input
                      id="auth-name"
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={a.ph_name}
                      maxLength={80}
                      required
                    />
                  </div>
                )}

                <div className="input-group">
                  <label htmlFor="auth-username">{a.label_username}</label>
                  <input
                    id="auth-username"
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={a.ph_username}
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
                    <label htmlFor="auth-age">{a.label_age}</label>
                    <input
                      id="auth-age"
                      type="text"
                      inputMode="numeric"
                      value={age}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, "").slice(0, 3);
                        setAge(val);
                      }}
                      placeholder={a.ph_age}
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
                  <label htmlFor="auth-password">{a.label_password}</label>
                  <div className="password-input-wrap">
                    <input
                      id="auth-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete={mode === "login" ? "current-password" : "new-password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={a.ph_password}
                      minLength={8}
                      required
                    />
                    <button
                      type="button"
                      className="eye-toggle-btn"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? a.pw_hide : a.pw_show}
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
                    <label htmlFor="auth-confirm-password">{a.label_confirm}</label>
                    <div className="password-input-wrap">
                      <input
                        id="auth-confirm-password"
                        type={showConfirmPassword ? "text" : "password"}
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder={a.ph_confirm}
                        minLength={8}
                        required
                      />
                      <button
                        type="button"
                        className="eye-toggle-btn"
                        onClick={() => setShowConfirmPassword((prev) => !prev)}
                        aria-label={showConfirmPassword ? a.pw_hide : a.pw_show}
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
                    <span>{a.no_supabase}</span>
                  </div>
                )}

                {mode === "signup" && (
                  <p className="auth-field-hint">
                    {a.username_hint}
                  </p>
                )}

                <button
                  className="btn-auth-submit"
                  type="submit"
                  disabled={isSubmitDisabled}
                >
                  <span>
                    {busy
                      ? a.wait
                      : mode === "login"
                        ? a.submit_login
                        : a.submit_signup}
                  </span>
                  <IconArrowRight className="icon-sm" />
                </button>
              </form>

              <div className="auth-terms-notice">
                <span>
                  {a.terms}
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
                <IconSparkles className="icon-xs" /> {a.method_badge}
              </span>
              <h2 className="onboarding-title">Plan your day. Own your time.</h2>
              <p className="onboarding-subtitle">
                {a.method_sub}
              </p>
            </div>

            {/* Strategic Pillars */}
            <div className="pillars-grid">
              <div className="pillar-card">
                <div className="pillar-icon-wrap">
                  <IconCalendar className="icon-md" />
                </div>
                <h3>{a.pillar1_t}</h3>
                <p>
                  {a.pillar1_d}
                </p>
              </div>

              <div className="pillar-card">
                <div className="pillar-icon-wrap">
                  <IconHash className="icon-md" />
                </div>
                <h3>{a.pillar2_t}</h3>
                <p>
                  {a.pillar2_d}
                </p>
              </div>

              <div className="pillar-card">
                <div className="pillar-icon-wrap">
                  <IconBarChart className="icon-md" />
                </div>
                <h3>{a.pillar3_t}</h3>
                <p>
                  {a.pillar3_d}
                </p>
              </div>
            </div>

            {/* Step-by-Step Guide */}
            <div className="onboarding-steps-block">
              <h3 className="steps-title">{a.steps_title}</h3>
              <div className="steps-row">
                <div className="step-item">
                  <div className="step-number">01</div>
                  <h4>{a.step1_t}</h4>
                  <p>{a.step1_d}</p>
                </div>
                <div className="step-item">
                  <div className="step-number">02</div>
                  <h4>{a.step2_t}</h4>
                  <p>{a.step2_d}</p>
                </div>
                <div className="step-item">
                  <div className="step-number">03</div>
                  <h4>{a.step3_t}</h4>
                  <p>{a.step3_d}</p>
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
            <Image src="/myplan-logo-192.png" unoptimized alt="MyLife" width={32} height={32} priority />
            <span>MyLife</span>
          </Link>
          <span className="footer-center-tag">PLAN YOUR DAY. OWN YOUR TIME.</span>
          <span className="footer-copyright">
            {a.copyright}
          </span>
        </div>
      </footer>
    </div>
  );
}
