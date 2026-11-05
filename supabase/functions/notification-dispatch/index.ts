import webpush from "npm:web-push@3.6.7";
import { adminClient, composeNotificationBatch, corsHeaders, isCronAuthorized, json, localClock, safeTimeZone, scheduleAfterQuietHours } from "../_shared/notifications.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" || !isCronAuthorized(req)) return json({ error: "Unauthorized" }, 401);
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY"), privateKey = Deno.env.get("VAPID_PRIVATE_KEY"), subject = Deno.env.get("VAPID_SUBJECT");
  const pushConfigured = Boolean(publicKey && privateKey && subject);
  if (pushConfigured) webpush.setVapidDetails(subject!, publicKey!, privateKey!);
  const admin = adminClient(), now = new Date(), nowIso = now.toISOString();
  const profiles: Array<{ id: string; language: string | null; timezone: string | null; notifications_enabled: boolean }> = [];
  for (let offset = 0; ; offset += 500) {
    const { data: page, error: profileError } = await admin.from("profiles")
      .select("id,language,timezone,notifications_enabled")
      .eq("notifications_enabled", true).order("id").range(offset, offset + 499);
    if (profileError) return json({ error: "Could not load profiles" }, 500);
    profiles.push(...(page ?? []));
    if (!page || page.length < 500) break;
  }
  let generated = 0;
  const allCandidates: Array<{
    userId: string; category: string; dedupeKey: string; language: "uz" | "en" | "ru";
    context: Record<string, unknown>; fallback: { title: string; message: string }; scheduledAt: string;
  }> = [];
  // Process in small batches so a slow AI provider cannot exhaust the Edge Function runtime.
  for (let offset = 0; offset < (profiles ?? []).length; offset += 10) {
    const batch = (profiles ?? []).slice(offset, offset + 10);
    const results = await Promise.allSettled(batch.map(async (profile) => {
      const zone = safeTimeZone(profile.timezone), clock = localClock(now, zone);
      const period = clock.minutes >= 480 && clock.minutes < 540 ? "morning" : clock.minutes >= 1230 && clock.minutes < 1290 ? "evening" : null;
      if (!period) return null;
      const category = period === "morning" ? "daily" : "evening", dedupeKey = `${period}:${clock.date}`;
      const [prefsResult, countResult, tasksResult] = await Promise.all([
        admin.from("notification_preferences").select("enabled,daily_limit,category_settings,quiet_hours_enabled,quiet_hours_start,quiet_hours_end").eq("user_id", profile.id).maybeSingle(),
        admin.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", profile.id).gte("created_at", new Date(now.getTime() - 86400000).toISOString()),
        admin.from("activities").select("id").eq("user_id", profile.id).eq("is_active", true).limit(30),
      ]);
      if (prefsResult.error || countResult.error || tasksResult.error) throw new Error("Could not load notification context");
      const prefs = prefsResult.data, count = countResult.count, taskRows = tasksResult.data ?? [];
      if (prefs?.enabled === false || prefs?.category_settings?.[category] === false || (count ?? 0) >= (prefs?.daily_limit ?? 3) || taskRows.length === 0) return null;
      const { data: existing, error: existingError } = await admin.from("notifications").select("id").eq("user_id", profile.id).eq("dedupe_key", dedupeKey).maybeSingle();
      if (existingError) throw existingError;
      if (existing) return null;
      const { data: occurrences, error: occurrencesError } = await admin.from("occurrences").select("activity_id,status").eq("user_id", profile.id).eq("period_start", clock.date);
      if (occurrencesError) throw occurrencesError;
      const completed = (occurrences ?? []).filter((x) => x.status === "completed").length;
      const language: "uz" | "en" | "ru" = profile.language === "en" || profile.language === "ru" ? profile.language : "uz";
      const context = { localDate: clock.date, activeTaskCount: taskRows.length, completedTaskCount: completed, pendingTaskCount: (occurrences ?? []).filter((x) => x.status === "pending").length, timeOfDay: period };
      const fallback = period === "morning"
        ? { uz: { title: "Xayrli tong!", message: `Bugun ${taskRows.length} ta faol rejang bor. Eng muhimidan boshlasang kifoya.` }, en: { title: "Good morning!", message: `You have ${taskRows.length} active plans today. Start with the most important one.` }, ru: { title: "Доброе утро!", message: `Сегодня у тебя ${taskRows.length} активных планов. Начни с самого важного.` } }
        : { uz: { title: "Kuning qanday o‘tdi?", message: "Bugungi ishlaringni xotirjam ko‘rib chiq va ertangi kun uchun bitta muhim qadamni belgilab qo‘y." }, en: { title: "How did your day go?", message: "Review what you did today and choose one useful step for tomorrow." }, ru: { title: "Как прошёл день?", message: "Спокойно вспомни сегодняшний день и выбери один полезный шаг на завтра." } };
      const scheduledAt = scheduleAfterQuietHours(
        now,
        zone,
        prefs?.quiet_hours_enabled !== false,
        prefs?.quiet_hours_start || "22:00",
        prefs?.quiet_hours_end || "08:00",
      ).toISOString();
      return { userId: profile.id, category, dedupeKey, language, context, fallback: fallback[language], scheduledAt };
    }));
    const candidates = results.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
    allCandidates.push(...candidates);
    for (const result of results) if (result.status === "rejected") console.error("Companion generation failed:", result.reason);
  }
  const missingTemplates = new Map<string, { language: "uz" | "en" | "ru"; category: string }>();
  for (const candidate of allCandidates) {
    const key = `${candidate.language}:${candidate.category}`;
    if (!missingTemplates.has(key)) missingTemplates.set(key, { language: candidate.language, category: candidate.category });
  }
  let aiTemplates = new Map<string, { title: string; message: string }>();
  if (missingTemplates.size) {
    try {
      aiTemplates = await composeNotificationBatch(Array.from(missingTemplates, ([id, value]) => ({
        id, language: value.language, category: value.category,
        context: { timeOfDay: value.category === "daily" ? "morning" : "evening", style: "brief, encouraging, non-repetitive" },
      })));
    } catch (error) { console.warn("Ollama template fallback:", error); }
  }
  const inserted = await Promise.allSettled(allCandidates.map(async (candidate) => {
    const template = aiTemplates.get(`${candidate.language}:${candidate.category}`);
    const prefix = candidate.category === "daily"
      ? { uz: `Bugun ${candidate.context.activeTaskCount} ta faol rejang bor.`, en: `You have ${candidate.context.activeTaskCount} active plans today.`, ru: `Сегодня у тебя ${candidate.context.activeTaskCount} активных планов.` }
      : { uz: `Bugun ${candidate.context.completedTaskCount} ta vazifani bajarding.`, en: `You completed ${candidate.context.completedTaskCount} tasks today.`, ru: `Сегодня ты выполнил(а) ${candidate.context.completedTaskCount} задач.` };
    const copy = template
      ? { title: template.title, message: `${prefix[candidate.language]} ${template.message}`.slice(0, 500) }
      : candidate.fallback;
    const { error } = await admin.from("notifications").insert({
      user_id: candidate.userId, category: candidate.category, title: copy.title, message: copy.message,
      data: { url: "/" }, dedupe_key: candidate.dedupeKey, scheduled_at: candidate.scheduledAt,
      expires_at: new Date(now.getTime() + 3 * 86400000).toISOString(),
    });
    if (error && error.code !== "23505") throw error;
    return !error;
  }));
  generated = inserted.filter((result) => result.status === "fulfilled" && result.value).length;
  for (const result of inserted) if (result.status === "rejected") console.error("Notification insert failed:", result.reason);
  if (!pushConfigured) return json({ ok: true, generated, pushConfigured: false, processed: 0, pushSent: 0, failed: 0 });
  const { data: due, error } = await admin.rpc("claim_due_notifications", { p_limit: 100 });
  if (error) return json({ error: "Could not claim due notifications" }, 500);
  let pushSent = 0, failed = 0;
  for (const notification of due ?? []) {
    const [prefsResult, profileResult, subsResult] = await Promise.all([
      admin.from("notification_preferences").select("enabled,push_enabled,category_settings").eq("user_id", notification.user_id).maybeSingle(),
      admin.from("profiles").select("notifications_enabled").eq("id", notification.user_id).maybeSingle(),
      admin.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("user_id", notification.user_id).eq("is_active", true),
    ]);
    if (prefsResult.error || profileResult.error || subsResult.error) {
      failed++;
      await admin.from("notifications").update({ dispatch_locked_until: null }).eq("id", notification.id);
      continue;
    }
    const prefs = prefsResult.data, profile = profileResult.data, subs = subsResult.data;
    if (profile?.notifications_enabled === false || prefs?.enabled === false || prefs?.push_enabled !== true || prefs?.category_settings?.[notification.category] === false || !subs?.length) {
      await admin.from("notifications").update({ sent_at: nowIso, dispatch_locked_until: null }).eq("id", notification.id);
      continue;
    }
    let deliveryLookupFailed = false;
    let deliveryPersistenceFailed = false;
    for (const sub of subs) {
      const { data: prev, error: prevError } = await admin.from("notification_deliveries").select("status,attempts,next_attempt_at").eq("notification_id", notification.id).eq("subscription_id", sub.id).maybeSingle();
      if (prevError) { deliveryLookupFailed = true; failed++; break; }
      if (prev?.status === "sent" || prev?.status === "dead" || (prev?.next_attempt_at && new Date(prev.next_attempt_at).getTime() > now.getTime())) continue;
      const attempts = prev?.attempts ?? 0;
      if (attempts >= 5) {
        const { error: deadError } = await admin.from("notification_deliveries").upsert({ notification_id: notification.id, subscription_id: sub.id, status: "dead", attempts, updated_at: nowIso }, { onConflict: "notification_id,subscription_id" });
        if (deadError) { deliveryPersistenceFailed = true; failed++; break; }
        continue;
      }
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify({ id: notification.id, title: notification.title, body: notification.message, category: notification.category, url: notification.data?.url || "/" }), { TTL: 86400, urgency: "normal" });
        pushSent++;
        const [subscriptionUpdate, deliveryUpdate] = await Promise.all([
          admin.from("push_subscriptions").update({ last_success_at: nowIso }).eq("id", sub.id),
          admin.from("notification_deliveries").upsert({ notification_id: notification.id, subscription_id: sub.id, status: "sent", attempts: attempts + 1, sent_at: nowIso, next_attempt_at: nowIso, last_error: null, updated_at: nowIso }, { onConflict: "notification_id,subscription_id" }),
        ]);
        if (subscriptionUpdate.error || deliveryUpdate.error) {
          console.error("Push sent but delivery receipt could not be persisted", notification.id, sub.id, subscriptionUpdate.error || deliveryUpdate.error);
          deliveryPersistenceFailed = true;
          failed++;
          break;
        }
      } catch (err) {
        failed++;
        const code = Number((err as { statusCode?: number })?.statusCode || 0), permanent = code === 404 || code === 410;
        const [subscriptionUpdate, deliveryUpdate] = await Promise.all([
          admin.from("push_subscriptions").update({ is_active: !permanent, last_error_at: nowIso }).eq("id", sub.id),
          admin.from("notification_deliveries").upsert({ notification_id: notification.id, subscription_id: sub.id, status: permanent ? "dead" : "failed", attempts: attempts + 1, next_attempt_at: new Date(now.getTime() + Math.min(60 * 2 ** attempts, 3600) * 1000).toISOString(), last_error: String(err).slice(0, 500), updated_at: nowIso }, { onConflict: "notification_id,subscription_id" }),
        ]);
        if (subscriptionUpdate.error || deliveryUpdate.error) {
          console.error("Push failure receipt could not be persisted", notification.id, sub.id, subscriptionUpdate.error || deliveryUpdate.error);
          deliveryPersistenceFailed = true;
          break;
        }
      }
    }
    if (deliveryLookupFailed) {
      await admin.from("notifications").update({ dispatch_locked_until: null }).eq("id", notification.id);
      continue;
    }
    // Keep the claim lock until it expires if the provider result could not be recorded.
    // This avoids an immediate duplicate push when delivery may already have succeeded.
    if (deliveryPersistenceFailed) continue;
    const { count: pending, error: pendingError } = await admin.from("notification_deliveries").select("id", { count: "exact", head: true }).eq("notification_id", notification.id).in("status", ["pending", "failed"]);
    if (pendingError) {
      failed++;
      await admin.from("notifications").update({ dispatch_locked_until: null }).eq("id", notification.id);
      continue;
    }
    if ((pending ?? 0) === 0) {
      await admin.from("notifications").update({ sent_at: nowIso, dispatch_locked_until: null }).eq("id", notification.id);
    } else {
      await admin.from("notifications").update({ dispatch_locked_until: null }).eq("id", notification.id);
    }
  }
  await admin.from("notifications").delete().lte("expires_at", nowIso);
  return json({ ok: true, generated, pushConfigured: true, processed: due?.length ?? 0, pushSent, failed });
});
