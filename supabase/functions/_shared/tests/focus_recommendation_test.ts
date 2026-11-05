import { getRecommendedFocusActivity } from "../../../../src/lib/focus-recommendation.ts";

const activities = [
  { id: "custom", is_active: true, time_of_day: "custom_morning" },
  { id: "morning", is_active: true, time_of_day: "morning" },
  { id: "anytime", is_active: true, time_of_day: "anytime" },
];
const slots = [{ id: "custom_morning", label: "06:59 - 10:00" }];

Deno.test("custom time range is recommended only inside its exact interval", () => {
  const atNine = getRecommendedFocusActivity(activities, [], slots, 9 * 60);
  const atEleven = getRecommendedFocusActivity(activities, [], slots, 11 * 60);
  if (atNine?.id !== "custom") throw new Error("Custom task should be recommended at 09:00");
  if (atEleven?.id !== "morning") throw new Error("Expired custom task must not be recommended at 11:00");
});

Deno.test("all-day task is the fallback when no timed task matches", () => {
  const result = getRecommendedFocusActivity(activities, [], slots, 23 * 60 + 30);
  if (result?.id !== "anytime") throw new Error("All-day task should be the fallback");
});

Deno.test("timed task always outranks all-day task", () => {
  const result = getRecommendedFocusActivity(activities, [], slots, 8 * 60);
  if (result?.id !== "custom") throw new Error("Timed task must be prioritized over all-day task");
});

Deno.test("completed and inactive tasks are never recommended", () => {
  const result = getRecommendedFocusActivity(
    [{ id: "done", is_active: true, time_of_day: "anytime" }, { id: "off", is_active: false, time_of_day: "anytime" }],
    [{ activity_id: "done", status: "completed" }],
    [],
    12 * 60,
  );
  if (result !== null) throw new Error("Completed or inactive task was recommended");
});

Deno.test("custom ranges support overnight windows and exclusive end time", () => {
  const overnight = [{ id: "night", is_active: true, time_of_day: "night" }];
  const slots = [{ id: "night", label: "22:00–06:00" }];
  if (getRecommendedFocusActivity(overnight, [], slots, 23 * 60)?.id !== "night") throw new Error("Overnight range start failed");
  if (getRecommendedFocusActivity(overnight, [], slots, 5 * 60 + 59)?.id !== "night") throw new Error("Overnight range end failed");
  if (getRecommendedFocusActivity(overnight, [], slots, 6 * 60) !== null) throw new Error("End time must be exclusive");
});

Deno.test("expired custom window falls back to all-day instead of another expired timed task", () => {
  const result = getRecommendedFocusActivity(
    [activities[0], activities[2]],
    [],
    slots,
    11 * 60,
  );
  if (result?.id !== "anytime") throw new Error("Expired custom slot should fall back to all-day task");
});

Deno.test("custom range start is inclusive and end is exclusive", () => {
  const customOnly = [activities[0], activities[2]];
  if (getRecommendedFocusActivity(customOnly, [], slots, 6 * 60 + 59)?.id !== "custom") throw new Error("Range start should be included");
  if (getRecommendedFocusActivity(customOnly, [], slots, 10 * 60)?.id !== "anytime") throw new Error("Range end should be excluded");
});
