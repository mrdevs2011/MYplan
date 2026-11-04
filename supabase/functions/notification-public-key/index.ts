import { corsHeaders, json } from "../_shared/notifications.ts";
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const key = Deno.env.get("VAPID_PUBLIC_KEY");
  return key ? json({ publicKey: key }) : json({ error: "Push is not configured" }, 503);
});
