import { corsHeaders, json, userClient } from "../_shared/notifications.ts";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const supabase = userClient(req);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);
  const body = await req.json().catch(() => null);
  if (body?.action === "list") {
    const cutoff = new Date(Date.now() - 3 * 86400000).toISOString();
    const { data, error } = await supabase.from("notifications").select("id,category,title,message,created_at,read_at,data,scheduled_at")
      .gte("created_at", cutoff).lte("scheduled_at", new Date().toISOString()).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(100);
    return error ? json({ error: "Could not load notifications" }, 500) : json({ notifications: data ?? [] });
  }
  if (body?.action === "mark-read" && typeof body.id === "string" && typeof body.read === "boolean") {
    const { error } = await supabase.from("notifications").update({ read_at: body.read ? new Date().toISOString() : null }).eq("id", body.id);
    return error ? json({ error: "Could not update notification" }, 500) : json({ ok: true });
  }
  return json({ error: "Unknown action" }, 400);
});
