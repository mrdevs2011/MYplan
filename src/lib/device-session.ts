import type { SupabaseClient } from "@supabase/supabase-js";

export interface UserDevice {
  id: string;
  user_id: string;
  session_token: string;
  device_name: string;
  device_type: "mobile" | "tablet" | "desktop";
  browser_name: string;
  os_name: string;
  ip_address?: string | null;
  is_active: boolean;
  last_active_at: string;
  created_at: string;
  revoked_at?: string | null;
}

const STORAGE_SESSION_TOKEN_KEY = "myplan_device_session_token";

/**
 * Har bir brauzer instansiyasi / qurilma uchun unikal session_token qaytaradi.
 * LocalStorage da saqlanadi, agar yo‘q bo‘lsa kriptografik xavfsiz generatsiya qilinadi.
 */
export function getOrCreateSessionToken(userId?: string): string {
  const base = getBrowserToken();
  // One row per (browser, account): several accounts can share this browser without
  // clashing on the unique session_token (the RLS policy rejects taking over another user's row).
  return userId ? `${base}:${userId}` : base;
}

function getBrowserToken(): string {
  if (typeof window === "undefined") return "server-session";
  try {
    let token = localStorage.getItem(STORAGE_SESSION_TOKEN_KEY);
    if (!token) {
      if (typeof crypto !== "undefined" && crypto.randomUUID) {
        token = `dev_${crypto.randomUUID()}`;
      } else {
        token = `dev_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      }
      localStorage.setItem(STORAGE_SESSION_TOKEN_KEY, token);
    }
    return token;
  } catch {
    return `dev_fallback_${Date.now()}`;
  }
}

/**
 * Brauzer userAgent orqali qurilma turi, operatsion tizimi va brauzerini aniqlaydi.
 */
export function detectDeviceInfo(): {
  deviceName: string;
  deviceType: "mobile" | "tablet" | "desktop";
  browserName: string;
  osName: string;
} {
  if (typeof window === "undefined") {
    return {
      deviceName: "Desktop Kompyuter",
      deviceType: "desktop",
      browserName: "Brauzer",
      osName: "Noma’lum OS",
    };
  }

  const ua = navigator.userAgent || "";
  let deviceType: "mobile" | "tablet" | "desktop" = "desktop";
  let osName = "Boshqa";
  let deviceName = "Noma’lum qurilma";
  let browserName = "Brauzer";

  // 1. Device Type & OS Detection
  const isIPad = /iPad/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isIPhone = /iPhone|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isTablet = isIPad || (/tablet|silk|playbook/i.test(ua) && !/mobile/i.test(ua));
  const isMobile = !isTablet && (isIPhone || isAndroid || /mobile|blackberry|iemobile|kindle/i.test(ua));

  if (isTablet) {
    deviceType = "tablet";
  } else if (isMobile) {
    deviceType = "mobile";
  } else {
    deviceType = "desktop";
  }

  if (isIPad) {
    osName = "iPadOS";
    deviceName = "Apple iPad";
  } else if (isIPhone) {
    osName = "iOS";
    deviceName = "Apple iPhone";
  } else if (isAndroid) {
    osName = "Android";
    deviceName = isTablet ? "Android Planshet" : "Android Smartfon";
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    osName = "macOS";
    deviceName = "Apple Mac";
  } else if (/Windows NT/i.test(ua)) {
    osName = "Windows";
    deviceName = "Windows PC";
  } else if (/Linux/i.test(ua)) {
    osName = "Linux";
    deviceName = "Linux Qurilma";
  }

  // 2. Browser Detection
  if (/Edg\//i.test(ua)) {
    const match = ua.match(/Edg\/([0-9.]+)/);
    browserName = `Microsoft Edge${match ? ` ${match[1].split(".")[0]}` : ""}`;
  } else if (/OPR\/|Opera\//i.test(ua)) {
    browserName = "Opera";
  } else if (/SamsungBrowser\//i.test(ua)) {
    browserName = "Samsung Internet";
  } else if (/Chrome\//i.test(ua)) {
    const match = ua.match(/Chrome\/([0-9.]+)/);
    browserName = `Google Chrome${match ? ` ${match[1].split(".")[0]}` : ""}`;
  } else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) {
    const match = ua.match(/Version\/([0-9.]+)/);
    browserName = `Apple Safari${match ? ` ${match[1].split(".")[0]}` : ""}`;
  } else if (/Firefox\//i.test(ua)) {
    const match = ua.match(/Firefox\/([0-9.]+)/);
    browserName = `Mozilla Firefox${match ? ` ${match[1].split(".")[0]}` : ""}`;
  }

  return { deviceName, deviceType, browserName, osName };
}

/**
 * Ushbu qurilma sessiyasini Supabase bazasiga ro‘yxatga oladi yoki yangilaydi (Active = true).
 */
export async function syncCurrentDeviceSession(
  supabase: SupabaseClient,
  userId: string
): Promise<UserDevice | null> {
  try {
    const sessionToken = getOrCreateSessionToken(userId);
    const info = detectDeviceInfo();

    // Adopt the pre-multi-account row (plain browser token) so it isn't left behind as a duplicate.
    await supabase
      .from("user_devices")
      .update({ session_token: sessionToken })
      .eq("session_token", getOrCreateSessionToken())
      .eq("user_id", userId);

    const payload = {
      user_id: userId,
      session_token: sessionToken,
      device_name: info.deviceName,
      device_type: info.deviceType,
      browser_name: info.browserName,
      os_name: info.osName,
      is_active: true,
      last_active_at: new Date().toISOString(),
      revoked_at: null,
    };

    const { data, error } = await supabase
      .from("user_devices")
      .upsert(payload, { onConflict: "session_token" })
      .select()
      .single();

    if (error) {
      console.warn("Device session sync warning:", error.message);
      return null;
    }
    return data as UserDevice;
  } catch (err) {
    console.error("Device session sync error:", err);
    return null;
  }
}

/**
 * Joriy qurilma sessiyasi faolmi yoki boshqa joydan chiqarib yuborilganmi (< 3ms tezlikda tekshiradi).
 * Agar session_token topilmasa yoki is_active bo‘lsa true qaytaradi; agar is_active === false bo‘lsa false qaytaradi.
 */
export async function checkDeviceSessionActive(
  supabase: SupabaseClient,
  userId?: string
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    const sessionToken = getOrCreateSessionToken(userId);
    const { data, error } = await supabase
      .from("user_devices")
      .select("is_active, revoked_at")
      .eq("session_token", sessionToken)
      .maybeSingle();

    if (error) {
      // Tarmoq yoki offline holatda foydalanuvchini bloklamaymiz
      return { allowed: true };
    }

    if (data && data.is_active === false) {
      return { allowed: false, reason: "Ushbu qurilma sessiyasi boshqa qurilmadan yakunlangan." };
    }

    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}

/**
 * Foydalanuvchining boshqa qurilmasini masofadan chiqarib yuborish (Logout).
 */
export async function revokeDeviceSession(
  supabase: SupabaseClient,
  deviceId: string
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("user_devices")
      .update({
        is_active: false,
        revoked_at: new Date().toISOString(),
      })
      .eq("id", deviceId);

    return !error;
  } catch {
    return false;
  }
}
