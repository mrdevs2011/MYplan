import { adminClient, composeNotification, corsHeaders, json, safeTimeZone, scheduleAfterQuietHours, userClient } from "../_shared/notifications.ts";

const categories = ["daily", "streak", "productivity", "motivation", "evening", "system"] as const;
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const auth = userClient(req);
  const { data: { user }, error: authError } = await auth.auth.getUser();
  if (authError || !user) return json({ error: "Unauthorized" }, 401);
  const body = await req.json().catch(() => null);
  if (!body || !categories.includes(body.category)) return json({ error: "Invalid category" }, 400);
  const context = body.context && typeof body.context === "object" && !Array.isArray(body.context) ? body.context : {};
  if (JSON.stringify(context).length > 4000) return json({ error: "Context too large" }, 413);
  const admin = adminClient();
  const [{ data: profile, error: profileError }, { data: prefs, error: prefsError }] = await Promise.all([
    admin.from("profiles").select("language,timezone,notifications_enabled").eq("id", user.id).maybeSingle(),
    admin.from("notification_preferences").select("enabled,daily_limit,quiet_hours_enabled,quiet_hours_start,quiet_hours_end,category_settings").eq("user_id", user.id).maybeSingle(),
  ]);
  if (profileError || prefsError) return json({ error: "Could not load notification settings" }, 500);
  if (profile?.notifications_enabled === false || prefs?.enabled === false || (prefs?.category_settings && prefs.category_settings[body.category] === false)) {
    return json({ skipped: true, reason: "disabled" });
  }
  const since = new Date(Date.now() - 86400000).toISOString();
  const { count, error: countError } = await admin.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since);
  if (countError) return json({ error: "Could not check notification limit" }, 500);
  if ((count ?? 0) >= (prefs?.daily_limit ?? 3)) return json({ skipped: true, reason: "daily_limit" });
  const now = new Date();
  const scheduledAt = scheduleAfterQuietHours(
    now,
    safeTimeZone(profile?.timezone),
    prefs?.quiet_hours_enabled !== false,
    prefs?.quiet_hours_start || "22:00",
    prefs?.quiet_hours_end || "08:00",
  );
  const language: "uz" | "en" | "ru" = profile?.language === "en" || profile?.language === "ru" ? profile.language : "uz";
  const fallback = {
    uz: { title: "Kichik bir qadam tashla", message: "Rejangdagi eng muhim ishga 5 daqiqa ajrat. Kichik qadam ham oldinga siljishdir." },
    en: { title: "Take one small step", message: "Give your most important task five minutes. A small step is still progress." },
    ru: { title: "Сделай небольшой шаг", message: "Удели пять минут самой важной задаче. Даже маленький шаг — это движение вперёд." },
  };
  let copy = fallback[language];
  try { copy = await composeNotification({ language, category: body.category, context }); }
  catch (error) { console.warn("Ollama fallback:", error); }
  const url = typeof body.url === "string" && body.url.startsWith("/") && !body.url.startsWith("//") ? body.url.slice(0, 300) : "/";
  const { data: notification, error } = await admin.from("notifications").insert({
    user_id: user.id, category: body.category, title: copy.title, message: copy.message,
    data: { url }, dedupe_key: typeof body.dedupeKey === "string" ? body.dedupeKey.slice(0, 160) : null,
    scheduled_at: scheduledAt.toISOString(), expires_at: new Date(Date.now() + 3 * 86400000).toISOString(),
  }).select("id,category,title,message,created_at,read_at,data,scheduled_at").single();
  if (error?.code === "23505") return json({ skipped: true, reason: "duplicate" });
  if (error) return json({ error: "Could not save notification" }, 500);
  return json({ notification, scheduledAt: scheduledAt.toISOString() }, 201);
});
