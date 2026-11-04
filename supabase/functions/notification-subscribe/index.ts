import { adminClient, corsHeaders, isTrustedPushEndpoint, json, userClient } from "../_shared/notifications.ts";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "DELETE") return json({ error: "Method not allowed" }, 405);
  const auth = userClient(req);
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);
  const body = await req.json().catch(() => null);
  if (!body || typeof body.endpoint !== "string" || body.endpoint.length > 4096) return json({ error: "Invalid endpoint" }, 400);
  const isUnsubscribe = req.method === "DELETE" || body.action === "unsubscribe";
  const admin = adminClient();
  const { data: existingSubscription, error: lookupError } = await admin.from("push_subscriptions").select("id,user_id").eq("endpoint", body.endpoint).maybeSingle();
  if (lookupError) return json({ error: "Could not verify existing subscription" }, 500);
  if (existingSubscription && existingSubscription.user_id !== user.id) {
    if (isUnsubscribe) return json({ ok: true, localOnly: true });
    return json({ error: "Subscription belongs to another account" }, 409);
  }
  if (isUnsubscribe) {
    const { error } = await admin.from("push_subscriptions").delete().eq("user_id", user.id).eq("endpoint", body.endpoint);
    if (error) return json({ error: "Could not remove subscription" }, 500);
    const { count: remaining, error: countError } = await admin.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("is_active", true);
    if (countError) return json({ error: "Subscription removed but remaining devices could not be checked" }, 500);
    if ((remaining ?? 0) === 0) {
      const { error: prefError } = await admin.from("notification_preferences").upsert({ user_id: user.id, push_enabled: false, updated_at: new Date().toISOString() });
      if (prefError) return json({ error: "Subscription removed but preferences failed" }, 500);
    }
    return json({ ok: true });
  }
  if (!isTrustedPushEndpoint(body.endpoint)) return json({ error: "Unsupported push endpoint" }, 400);
  if (typeof body.keys?.p256dh !== "string" || !/^[A-Za-z0-9_-]{80,100}$/.test(body.keys.p256dh)
    || typeof body.keys?.auth !== "string" || !/^[A-Za-z0-9_-]{20,30}$/.test(body.keys.auth)) {
    return json({ error: "Invalid subscription keys" }, 400);
  }
  const { error } = await admin.from("push_subscriptions").upsert({
    user_id: user.id, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth,
    user_agent: typeof body.userAgent === "string" ? body.userAgent.slice(0, 500) : "",
    is_active: true, updated_at: new Date().toISOString(),
  }, { onConflict: "endpoint" });
  if (error) return json({ error: "Could not save subscription" }, 500);
  const { error: prefError } = await admin.from("notification_preferences").upsert({ user_id: user.id, enabled: true, push_enabled: true, updated_at: new Date().toISOString() });
  if (prefError) return json({ error: "Subscription saved but preferences failed" }, 500);
  return json({ ok: true });
});
