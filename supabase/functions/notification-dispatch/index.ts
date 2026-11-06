import webpush from "npm:web-push@3.6.7";
import { ACTIVE_WINDOW_MS, dueStageIds, dueSummaryTime, learnUsualMinutes, planReminderMinutes, reminderSlot, shouldRemind, type ProgressPoint, type StageId } from "../_shared/reminders.ts";
import { adminClient, composeNotificationBatch, corsHeaders, isCronAuthorized, isQuietTime, json, localClock, safeTimeZone, scheduleAfterQuietHours } from "../_shared/notifications.ts";

// Habits change slowly and this runs every minute, so each warm instance reuses what it learned for an hour.
const HABIT_CACHE_MS = 60 * 60_000;
const habitCache = new Map<string, { at: number; usual: Map<string, number> }>();

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
        admin.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", profile.id).in("category", ["daily", "evening"]).gte("created_at", new Date(now.getTime() - 86400000).toISOString()),
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
      const context = { localDate: clock.date, activeTaskCount: taskRows.length, completedTaskCount: completed, remainingTaskCount: Math.max(0, taskRows.length - completed), pendingTaskCount: (occurrences ?? []).filter((x) => x.status === "pending").length, timeOfDay: period };
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
      : (() => {
        const done = candidate.context.completedTaskCount, left = candidate.context.remainingTaskCount as number;
        return {
          uz: `Bugun ${done} ta vazifani bajarding${left > 0 ? `, ${left} tasi qoldi` : ""}.`,
          en: `You completed ${done} tasks today${left > 0 ? `, ${left} left` : ""}.`,
          ru: `Сегодня выполнено задач: ${done}${left > 0 ? `, осталось ${left}` : ""}.`,
        };
      })();
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
  // ---- Per-task reminder engine ---------------------------------------------------
  // A reminder fires when it can help, and stays silent otherwise (see shouldRemind):
  //   - a time the person chose is honoured; everything else follows when they really start that plan,
  //     falling back to an even spread across its time-of-day window
  //   - nothing interrupts someone who is logging progress right now, and nothing unchosen breaks quiet hours
  //   - plans due in the same half hour arrive as one notification, and a counter shows what is actually left
  type ReminderTask = {
    id: string; user_id: string; title: string; measurement_type: string; target: number | null; unit: string | null;
    schedule_type: string; schedule_rule: { weekdays?: number[] } | null; starts_on: string; ends_on: string | null;
    time_of_day: string | null; created_at: string; reminder_time?: string | null;
  };
  const baseColumns = "id,user_id,title,measurement_type,target,unit,schedule_type,schedule_rule,starts_on,ends_on,time_of_day,created_at";
  let reminders = 0;
  const taskRowsAll: ReminderTask[] = [];
  let hasReminderColumn = true;
  for (let offset = 0; offset < profiles.length; offset += 25) {
    const ids = profiles.slice(offset, offset + 25).map((profile) => profile.id);
    let result: { data: unknown[] | null; error: { code?: string } | null } = await admin.from("activities").select(`${baseColumns},reminder_time`).in("user_id", ids).eq("is_active", true);
    if (result.error?.code === "42703") { // migration 012 not applied yet: ladder still works with derived times
      hasReminderColumn = false;
      result = await admin.from("activities").select(baseColumns).in("user_id", ids).eq("is_active", true);
    }
    if (result.error) { console.error("Could not load tasks for reminders:", result.error); break; }
    taskRowsAll.push(...((result.data ?? []) as ReminderTask[]));
  }
  if (!hasReminderColumn) console.warn("activities.reminder_time is missing; using derived reminder times only");
  const tasksByUser = new Map<string, ReminderTask[]>();
  for (const row of taskRowsAll) tasksByUser.set(row.user_id, [...(tasksByUser.get(row.user_id) ?? []), row]);
  const reminderResults = await Promise.allSettled(profiles.filter((profile) => tasksByUser.has(profile.id)).map(async (profile) => {
    const clock = localClock(now, safeTimeZone(profile.timezone));
    const weekday = ((new Date(`${clock.date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    const today = (tasksByUser.get(profile.id) ?? []).filter((task) => {
      if (task.starts_on > clock.date || (task.ends_on && task.ends_on < clock.date)) return false;
      if (task.schedule_type === "once") return task.starts_on === clock.date;
      const weekdays = task.schedule_rule?.weekdays;
      return !Array.isArray(weekdays) || weekdays.length === 0 || weekdays.includes(weekday);
    });
    if (!today.length) return 0;
    const zone = safeTimeZone(profile.timezone);
    let habit = habitCache.get(profile.id);
    if (!habit || now.getTime() - habit.at > HABIT_CACHE_MS) {
      const since = new Date(now.getTime() - 30 * 86400000);
      const [habitEvents, habitOccurrences] = await Promise.all([
        admin.from("progress_events").select("occurrence_id,amount,recorded_at").eq("user_id", profile.id).gt("amount", 0).gte("recorded_at", since.toISOString()).order("recorded_at", { ascending: false }).limit(1000),
        admin.from("occurrences").select("id,activity_id").eq("user_id", profile.id).gte("period_start", localClock(since, zone).date).limit(1000),
      ]);
      if (habitEvents.error || habitOccurrences.error) throw new Error("Could not load habit history");
      const activityOf = new Map((habitOccurrences.data ?? []).map((row) => [row.id, row.activity_id]));
      const points: ProgressPoint[] = [];
      for (const row of habitEvents.data ?? []) {
        const activityId = activityOf.get(row.occurrence_id);
        if (!activityId) continue;
        const local = localClock(new Date(row.recorded_at), zone);
        points.push({ activityId, date: local.date, minute: local.minutes });
      }
      habit = { at: now.getTime(), usual: learnUsualMinutes(points) };
      habitCache.set(profile.id, habit);
    }
    const at = planReminderMinutes(today, habit.usual);
    const dueStages: Array<{ task: ReminderTask; stage: { id: StageId } }> = [];
    for (const task of today) for (const id of dueStageIds(at.get(task.id)!, clock.minutes)) dueStages.push({ task, stage: { id } });
    const summaryTime = dueSummaryTime(clock.minutes);
    if (!dueStages.length && summaryTime === undefined) return 0;
    const [prefsResult, occResult, nudgeResult, latestResult] = await Promise.all([
      admin.from("notification_preferences").select("enabled,category_settings,quiet_hours_enabled,quiet_hours_start,quiet_hours_end").eq("user_id", profile.id).maybeSingle(),
      admin.from("occurrences").select("id,activity_id,status").eq("user_id", profile.id).eq("period_start", clock.date),
      admin.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", profile.id).eq("category", "productivity").gte("created_at", new Date(now.getTime() - clock.minutes * 60_000).toISOString()),
      admin.from("progress_events").select("recorded_at").eq("user_id", profile.id).order("recorded_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (prefsResult.error || occResult.error || nudgeResult.error || latestResult.error) throw new Error("Could not load reminder context");
    if (prefsResult.data?.enabled === false || prefsResult.data?.category_settings?.productivity === false) return 0;
    const finished = new Set((occResult.data ?? []).filter((occ) => occ.status !== "pending").map((occ) => occ.activity_id));
    const isActiveNow = Boolean(latestResult.data && now.getTime() - new Date(latestResult.data.recorded_at).getTime() < ACTIVE_WINDOW_MS);
    const isQuiet = prefsResult.data?.quiet_hours_enabled !== false && isQuietTime(clock.minutes, prefsResult.data?.quiet_hours_start || "22:00", prefsResult.data?.quiet_hours_end || "08:00");
    const occurrenceIds = (occResult.data ?? []).map((occ) => occ.id);
    const doneByActivity = new Map<string, number>();
    if (occurrenceIds.length) {
      const { data: todayEvents, error: todayError } = await admin.from("progress_events").select("occurrence_id,amount").in("occurrence_id", occurrenceIds);
      if (todayError) throw todayError;
      const activityOf = new Map((occResult.data ?? []).map((occ) => [occ.id, occ.activity_id]));
      for (const row of todayEvents ?? []) {
        const activityId = activityOf.get(row.occurrence_id);
        if (activityId) doneByActivity.set(activityId, (doneByActivity.get(activityId) ?? 0) + Number(row.amount));
      }
    }
    const language: "uz" | "en" | "ru" = profile.language === "en" || profile.language === "ru" ? profile.language : "uz";
    const expiresAt = new Date(now.getTime() + 3 * 86400000).toISOString();
    const rows: Array<Record<string, unknown>> = [];
    // A chosen time keeps its exact minute. Other plans due in the same half hour share one notification,
    // which lists all of them up front, so none is swallowed by the shared dedupe key.
    const groups = new Map<string, { stage: StageId; group: string; tasks: ReminderTask[] }>();
    let nudgesToday = nudgeResult.count ?? 0;
    for (const { task, stage } of dueStages) {
      if (finished.has(task.id)) continue;
      const hasChosenTime = Boolean(task.reminder_time);
      const base = at.get(task.id)!;
      // A time learned from the person's own mornings is not an intrusion, even inside default quiet hours.
      const quietForTask = isQuiet && !(stage.id === "due" && habit.usual.has(task.id));
      if (!shouldRemind({ stage: stage.id, hasChosenTime, isQuiet: quietForTask, isActiveNow, nudgesToday })) continue;
      const group = hasChosenTime ? `at${base}` : `slot${reminderSlot(base)}`;
      const key = `${stage.id}:${group}`;
      const existing = groups.get(key);
      if (existing) {
        if (!existing.tasks.includes(task)) existing.tasks.push(task);
        continue;
      }
      const tasks = hasChosenTime
        ? [task]
        : today.filter((other) => !other.reminder_time && !finished.has(other.id) && reminderSlot(at.get(other.id)!) === reminderSlot(base));
      groups.set(key, { stage: stage.id, group, tasks });
      if (!hasChosenTime) nudgesToday += 1;
    }
    for (const { stage, group, tasks } of groups.values()) {
      const dedupe = `task-${stage}:${group}:${clock.date}`;
      const data = { url: "/", kind: "task-reminder", stage, ...(tasks.length === 1 ? { activityId: tasks[0].id } : {}) };
      if (tasks.length > 1) {
        const names = tasks.slice(0, 3).map((task) => task.title).join(", ");
        const more = tasks.length > 3 ? ` +${tasks.length - 3}` : "";
        rows.push({
          user_id: profile.id, category: "productivity",
          title: { uz: `${tasks.length} ta reja vaqti`, en: `${tasks.length} plans are due`, ru: `Пора: планов ${tasks.length}` }[language],
          message: `${names}${more}`.slice(0, 500), data, dedupe_key: dedupe, scheduled_at: nowIso, expires_at: expiresAt,
        });
        continue;
      }
      const task = tasks[0];
      const target = task.measurement_type === "count" && task.target ? Number(task.target) : 0;
      const done = Math.max(0, doneByActivity.get(task.id) ?? 0);
      const unit = task.unit ? ` ${task.unit}` : "";
      const progress = target > 0 && done > 0
        ? { uz: `${done}/${target}${unit}. Yana ${target - done} qoldi.`, en: `${done}/${target}${unit}. ${target - done} to go.`, ru: `${done}/${target}${unit}. Осталось ${target - done}.` }[language]
        : null;
      const goal = target > 0 ? `${target}${unit}` : "";
      const copy = progress ?? {
        pre: { uz: "10 daqiqadan keyin vaqti.", en: "Starts in 10 minutes.", ru: "Через 10 минут." },
        due: { uz: `Vaqti keldi${goal ? `. Maqsad: ${goal}` : ""}.`, en: `It's time${goal ? `. Goal: ${goal}` : ""}.`, ru: `Пора${goal ? `. Цель: ${goal}` : ""}.` },
        late1: { uz: "Hali kutib turibdi. Bugun ulgurasan.", en: "Still waiting for you. There's time today.", ru: "Всё ещё ждёт. Сегодня успеешь." },
      }[stage][language];
      rows.push({
        user_id: profile.id, category: "productivity", title: task.title.slice(0, 120), message: copy,
        data, dedupe_key: dedupe, scheduled_at: nowIso, expires_at: expiresAt,
      });
    }
    if (summaryTime !== undefined) {
      const left = today.filter((task) => !finished.has(task.id)).length;
      if (left > 0 && !isActiveNow && !isQuiet) {
        rows.push({
          user_id: profile.id, category: "productivity",
          title: { uz: "Bajarilmagan vazifalar", en: "Unfinished tasks", ru: "Невыполненные задачи" }[language],
          message: { uz: `Bugun ${left} ta vazifa ochiq turibdi. Bittasini tanlab, yopib qo‘y.`, en: `${left} tasks are still open today. Close one now.`, ru: `Сегодня не выполнено задач: ${left}. Закрой одну прямо сейчас.` }[language],
          data: { url: "/", kind: "task-reminder", stage: "summary" },
          dedupe_key: `pending-summary:${summaryTime}:${clock.date}`, scheduled_at: nowIso, expires_at: expiresAt,
        });
      }
    }
    if (!rows.length) return 0;
    const { data: created, error: insertError } = await admin.from("notifications")
      .upsert(rows, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true }).select("id");
    if (insertError) throw insertError;
    return created?.length ?? 0;
  }));
  for (const result of reminderResults) {
    if (result.status === "fulfilled") reminders += result.value;
    else console.error("Task reminder failed:", result.reason);
  }
  generated += reminders;
  if (!pushConfigured) return json({ ok: true, generated, reminders, pushConfigured: false, processed: 0, pushSent: 0, failed: 0 });
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
    // A stale "it's time" is useless: reminders expire at the push service after 30 minutes and use high urgency.
    const isTaskReminder = notification.data?.kind === "task-reminder";
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
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify({ id: notification.id, title: notification.title, body: notification.message, category: notification.category, url: notification.data?.url || "/", kind: notification.data?.kind || null, activityId: notification.data?.activityId || null }), isTaskReminder ? { TTL: 1800, urgency: "high" } : { TTL: 10800, urgency: "normal" });
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
  return json({ ok: true, generated, reminders, pushConfigured: true, processed: due?.length ?? 0, pushSent, failed });
});
