import { isTrustedPushEndpoint, localClock, safeTimeZone, scheduleAfterQuietHours } from "./notifications.ts";

Deno.test("localClock uses the requested timezone", () => {
  const value = localClock(new Date("2026-11-04T03:15:00.000Z"), "Asia/Tashkent");
  if (value.date !== "2026-11-04" || value.minutes !== 495) {
    throw new Error(`Unexpected Tashkent clock: ${JSON.stringify(value)}`);
  }
});

Deno.test("localClock handles date rollover in another timezone", () => {
  const value = localClock(new Date("2026-11-04T23:30:00.000Z"), "Pacific/Auckland");
  if (value.date !== "2026-11-05") throw new Error(`Unexpected Auckland date: ${value.date}`);
});


Deno.test("invalid timezone safely falls back to Tashkent", () => {
  if (safeTimeZone("Mars/Olympus") !== "Asia/Tashkent") throw new Error("Invalid timezone was not normalized");
});

Deno.test("only trusted HTTPS push providers are accepted", () => {
  if (!isTrustedPushEndpoint("https://fcm.googleapis.com/fcm/send/example")) throw new Error("FCM endpoint rejected");
  if (isTrustedPushEndpoint("http://fcm.googleapis.com/fcm/send/example")) throw new Error("HTTP endpoint accepted");
  if (isTrustedPushEndpoint("https://127.0.0.1/admin")) throw new Error("Local endpoint accepted");
  if (isTrustedPushEndpoint("https://attacker.example/push")) throw new Error("Untrusted host accepted");
});

Deno.test("quiet hours delay notification until the user's local end time", () => {
  const now = new Date("2026-11-04T18:30:00.000Z"); // 23:30 in Tashkent
  const scheduled = scheduleAfterQuietHours(now, "Asia/Tashkent", true, "22:00", "08:00");
  const clock = localClock(scheduled, "Asia/Tashkent");
  if (clock.minutes !== 480 || clock.date !== "2026-11-05") throw new Error(`Unexpected quiet-hour release: ${JSON.stringify(clock)}`);
});

Deno.test("quiet hours do not delay daytime notifications", () => {
  const now = new Date("2026-11-04T07:00:00.000Z"); // 12:00 in Tashkent
  const scheduled = scheduleAfterQuietHours(now, "Asia/Tashkent", true, "22:00", "08:00");
  if (scheduled.getTime() !== now.getTime()) throw new Error("Daytime notification was delayed");
});

Deno.test("disabled or equal quiet-hour bounds do not delay notifications", () => {
  const now = new Date("2026-11-04T18:30:00.000Z");
  if (scheduleAfterQuietHours(now, "Asia/Tashkent", false, "22:00", "08:00") !== now) throw new Error("Disabled quiet hours changed schedule");
  if (scheduleAfterQuietHours(now, "Asia/Tashkent", true, "08:00", "08:00") !== now) throw new Error("Equal bounds should mean no quiet period");
});
