"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Language } from "@/lib/translations";
import {
  HISTORY_DAYS,
  addDays,
  computeStats,
  heatLevel,
  weekdayOf,
  type StatActivity,
  type StatEvent,
  type StatOccurrence,
  type StatOccurrenceWithId,
  type StatsResult,
} from "@/lib/stats";

type SubTab = "overview" | "activity" | "tasks" | "goals" | "analysis";
const SUBTABS: SubTab[] = ["overview", "activity", "tasks", "goals", "analysis"];

interface StatsTabProps {
  userId: string | null;
  language: Language;
  activities: StatActivity[];
  /** Statuses held in memory right now (fresher than the database for today). */
  liveToday: { activity_id: string; status: StatOccurrence["status"] }[];
  todayKey: string;
  /** Changes whenever the user completes something, so the numbers refresh without a reload. */
  refreshKey: number;
}

const WEEKDAYS: Record<Language, { short: string[]; full: string[] }> = {
  uz: { short: ["Du", "Se", "Chor", "Pay", "Ju", "Sha", "Yak"], full: ["Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba", "Yakshanba"] },
  en: { short: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], full: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] },
  ru: { short: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"], full: ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"] },
};

const L = {
  uz: {
    tabs: { overview: "Umumiy", activity: "Faollik", tasks: "Vazifalar", goals: "Maqsadlar", analysis: "Tahlil" },
    loading: "Statistika yuklanmoqda…", retry: "Qayta urinish", failed: "Statistikani yuklab bo‘lmadi.",
    empty: "Hali faol vazifa yo‘q. Vazifa qo‘shing va statistika shu yerda paydo bo‘ladi.",
    today: "Bugun", doneOf: "{a} / {b} bajarildi", avg7: "7 kunlik o‘rtacha", avg30: "30 kunlik o‘rtacha", vsPrev: "o‘tgan haftaga nisbatan",
    streak: "Mukammal kunlar ketma-ketligi", streakSub: "Rekord: {n} kun", days: "kun", perfect30: "Mukammal kunlar (30 kun)", perfectSub: "Hamma vazifa bajarilgan kunlar",
    total90: "Jami bajarilgan (90 kun)", totalSub: "Vazifa belgilandi", noData: "Ma’lumot yo‘q",
    insights: "Xulosalar", dailyResult: "Kunlik natija", range7: "7 kun", range30: "30 kun", heatmap: "Faollik xaritasi (12 hafta)", less: "Kam", more: "Ko‘p",
    tasksTitle: "Vazifalar reytingi (30 kun)", bestTasks: "Eng barqaror", needAttention: "E’tibor kerak", streakChip: "{n} kun ketma-ket", doneCount: "{a}/{b} kun",
    goalsTitle: "Sanoqli maqsadlar (7 kun)", weekOf: "{a} / {b} {u}", noCounters: "Sanoqli maqsadli vazifa yo‘q.",
    prayerTitle: "Namoz intizomi (30 kun)", prayerSub: "{a} / {b} kun hamma namoz o‘qilgan", prayerStreak: "Hozirgi ketma-ketlik: {n} kun",
    weekdayTitle: "Hafta kunlari bo‘yicha", slotTitle: "Kun vaqti bo‘yicha",
    slots: { morning: "Tong", afternoon: "Kunduz", evening: "Kechqurun", anytime: "Kun davomida", custom: "Maxsus" },
    insBestDay: "Eng kuchli kuningiz: {d} ({p}%).", insWorstDay: "Eng zaif kun: {d} ({p}%).",
    insUp: "Bu hafta o‘tgan haftadan {n}% yaxshiroq.", insDown: "Bu hafta o‘tgan haftadan {n}% pastroq.", insSame: "Bu hafta o‘tgan haftadagidek.",
    insBestTask: "Eng barqaror vazifa: {t} ({p}%).", insWorstTask: "Eng ko‘p tushib qolayotgani: {t} ({p}%).", insPrayer: "Namoz intizomi: {p}% (30 kun).", insBestSlot: "Eng yaxshi vaqt: {s} ({p}%).",
    unit: { soz: "so‘z" } as Record<string, string>,
  },
  en: {
    tabs: { overview: "Overview", activity: "Activity", tasks: "Tasks", goals: "Goals", analysis: "Insights" },
    loading: "Loading statistics…", retry: "Try again", failed: "Could not load statistics.",
    empty: "No active tasks yet. Add a task and your statistics will appear here.",
    today: "Today", doneOf: "{a} / {b} done", avg7: "7-day average", avg30: "30-day average", vsPrev: "vs last week",
    streak: "Perfect-day streak", streakSub: "Best: {n} days", days: "days", perfect30: "Perfect days (30 days)", perfectSub: "Every task completed",
    total90: "Total completed (90 days)", totalSub: "Tasks checked off", noData: "No data",
    insights: "Highlights", dailyResult: "Daily result", range7: "7 days", range30: "30 days", heatmap: "Activity map (12 weeks)", less: "Less", more: "More",
    tasksTitle: "Task ranking (30 days)", bestTasks: "Most consistent", needAttention: "Needs attention", streakChip: "{n}-day streak", doneCount: "{a}/{b} days",
    goalsTitle: "Counter goals (7 days)", weekOf: "{a} / {b} {u}", noCounters: "No tasks with a counter goal.",
    prayerTitle: "Prayer discipline (30 days)", prayerSub: "{a} / {b} days with every prayer done", prayerStreak: "Current streak: {n} days",
    weekdayTitle: "By day of week", slotTitle: "By time of day",
    slots: { morning: "Morning", afternoon: "Afternoon", evening: "Evening", anytime: "All day", custom: "Custom" },
    insBestDay: "Your strongest day: {d} ({p}%).", insWorstDay: "Weakest day: {d} ({p}%).",
    insUp: "This week is {n}% better than last week.", insDown: "This week is {n}% lower than last week.", insSame: "This week matches last week.",
    insBestTask: "Most consistent task: {t} ({p}%).", insWorstTask: "Most often missed: {t} ({p}%).", insPrayer: "Prayer discipline: {p}% (30 days).", insBestSlot: "Best time of day: {s} ({p}%).",
    unit: { soz: "words" } as Record<string, string>,
  },
  ru: {
    tabs: { overview: "Обзор", activity: "Активность", tasks: "Задачи", goals: "Цели", analysis: "Анализ" },
    loading: "Загрузка статистики…", retry: "Повторить", failed: "Не удалось загрузить статистику.",
    empty: "Пока нет активных задач. Добавьте задачу, и статистика появится здесь.",
    today: "Сегодня", doneOf: "{a} / {b} выполнено", avg7: "Среднее за 7 дней", avg30: "Среднее за 30 дней", vsPrev: "к прошлой неделе",
    streak: "Серия идеальных дней", streakSub: "Рекорд: {n} дн.", days: "дн.", perfect30: "Идеальные дни (30 дней)", perfectSub: "Выполнены все задачи",
    total90: "Всего выполнено (90 дней)", totalSub: "Отмечено задач", noData: "Нет данных",
    insights: "Выводы", dailyResult: "Результат по дням", range7: "7 дней", range30: "30 дней", heatmap: "Карта активности (12 недель)", less: "Меньше", more: "Больше",
    tasksTitle: "Рейтинг задач (30 дней)", bestTasks: "Самые стабильные", needAttention: "Нужно внимание", streakChip: "серия {n} дн.", doneCount: "{a}/{b} дн.",
    goalsTitle: "Цели со счётчиком (7 дней)", weekOf: "{a} / {b} {u}", noCounters: "Нет задач со счётчиком.",
    prayerTitle: "Дисциплина намаза (30 дней)", prayerSub: "{a} / {b} дн. выполнены все намазы", prayerStreak: "Текущая серия: {n} дн.",
    weekdayTitle: "По дням недели", slotTitle: "По времени суток",
    slots: { morning: "Утро", afternoon: "День", evening: "Вечер", anytime: "Весь день", custom: "Своё" },
    insBestDay: "Самый сильный день: {d} ({p}%).", insWorstDay: "Самый слабый день: {d} ({p}%).",
    insUp: "Эта неделя на {n}% лучше прошлой.", insDown: "Эта неделя на {n}% ниже прошлой.", insSame: "Эта неделя такая же, как прошлая.",
    insBestTask: "Самая стабильная задача: {t} ({p}%).", insWorstTask: "Чаще всего пропускается: {t} ({p}%).", insPrayer: "Дисциплина намаза: {p}% (30 дней).", insBestSlot: "Лучшее время суток: {s} ({p}%).",
    unit: { soz: "слов" } as Record<string, string>,
  },
} as const;

type Widen<T> = T extends string ? string : T extends Record<string, unknown> ? { [K in keyof T]: Widen<T[K]> } : T;
type Dict = Widen<(typeof L)["uz"]>;

const fill = (template: string, vars: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
const tone = (pct: number | null) => (pct === null ? "none" : pct >= 80 ? "good" : pct >= 50 ? "mid" : "low");

async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

function Ring({ pct, size = 96, label }: { pct: number | null; size?: number; label: string }) {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const value = pct ?? 0;
  return (
    <div className="st-ring" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${pct === null ? "—" : `${pct}%`}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} className="st-ring-track" />
        {value > 0 && <circle cx={size / 2} cy={size / 2} r={r} className={`st-ring-fill st-tone-${tone(pct)}`} strokeDasharray={`${(c * value) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
      </svg>
      <span className="st-ring-value">{pct === null ? "—" : `${pct}%`}</span>
    </div>
  );
}

function buildInsights(s: StatsResult, d: Dict, language: Language): string[] {
  const out: string[] = [];
  const names = WEEKDAYS[language].full;
  const ranked = s.weekdays.filter((w) => w.pct !== null && w.samples >= 2).sort((a, b) => (b.pct as number) - (a.pct as number));
  if (ranked.length >= 2) {
    out.push(fill(d.insBestDay, { d: names[ranked[0].weekday - 1], p: ranked[0].pct as number }));
    const worst = ranked[ranked.length - 1];
    if (worst.weekday !== ranked[0].weekday && (ranked[0].pct as number) - (worst.pct as number) >= 10) out.push(fill(d.insWorstDay, { d: names[worst.weekday - 1], p: worst.pct as number }));
  }
  if (s.avg7 !== null && s.prevAvg7 !== null) {
    const diff = s.avg7 - s.prevAvg7;
    out.push(Math.abs(diff) < 2 ? d.insSame : diff > 0 ? fill(d.insUp, { n: diff }) : fill(d.insDown, { n: Math.abs(diff) }));
  }
  const rated = s.tasks.filter((t) => t.pct !== null && t.expected >= 3);
  if (rated.length >= 2) {
    out.push(fill(d.insBestTask, { t: rated[0].title, p: rated[0].pct as number }));
    const worst = rated[rated.length - 1];
    if (worst.id !== rated[0].id && (worst.pct as number) < 70) out.push(fill(d.insWorstTask, { t: worst.title, p: worst.pct as number }));
  }
  if (s.prayers?.avg !== null && s.prayers) out.push(fill(d.insPrayer, { p: s.prayers.avg as number }));
  const bestSlot = [...s.slots].filter((x) => x.pct !== null).sort((a, b) => (b.pct as number) - (a.pct as number))[0];
  if (bestSlot && s.slots.length >= 2) out.push(fill(d.insBestSlot, { s: d.slots[bestSlot.slot], p: bestSlot.pct as number }));
  return out.slice(0, 6);
}

export default function StatsTab({ userId, language, activities, liveToday, todayKey, refreshKey }: StatsTabProps) {
  const d: Dict = L[language] ?? L.uz;
  const weekdayNames = WEEKDAYS[language] ?? WEEKDAYS.uz;
  const [sub, setSub] = useState<SubTab>("overview");
  const [range, setRange] = useState<7 | 30>(7);
  const [data, setData] = useState<{ occurrences: StatOccurrenceWithId[]; events: StatEvent[] } | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const supabase = createClient();
      const from = addDays(todayKey, -(HISTORY_DAYS - 1));
      const eventsFrom = new Date(Date.now() - 9 * 86_400_000).toISOString();
      const [occurrences, events] = await Promise.all([
        fetchAll<StatOccurrenceWithId>((a, b) => supabase.from("occurrences").select("id,activity_id,period_start,status").eq("user_id", userId).gte("period_start", from).order("period_start").range(a, b)),
        fetchAll<StatEvent>((a, b) => supabase.from("progress_events").select("occurrence_id,amount").eq("user_id", userId).gte("recorded_at", eventsFrom).order("recorded_at").range(a, b)),
      ]);
      setData({ occurrences, events });
      setError(false);
    } catch (e) {
      console.warn("Statistics could not be loaded:", e);
      setError(true);
    }
  }, [userId, todayKey]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load, refreshKey, attempt]);

  const activeActivities = useMemo(() => activities.filter((a) => a.is_active), [activities]);
  const stats = useMemo(
    () => (data ? computeStats({ activities, occurrences: data.occurrences, events: data.events, liveToday, todayKey }) : null),
    [data, activities, liveToday, todayKey],
  );
  const insights = useMemo(() => (stats ? buildInsights(stats, d, language) : []), [stats, d, language]);

  if (activeActivities.length === 0) return <div className="st"><p className="st-empty">{d.empty}</p></div>;
  if (error && !stats) {
    return (
      <div className="st">
        <div className="st-empty">
          <p>{d.failed}</p>
          <button type="button" className="st-retry" onClick={() => { setError(false); setAttempt((n) => n + 1); }}>{d.retry}</button>
        </div>
      </div>
    );
  }
  if (!stats) return <div className="st"><p className="st-empty" aria-busy="true">{d.loading}</p></div>;

  const trend = stats.avg7 !== null && stats.prevAvg7 !== null ? stats.avg7 - stats.prevAvg7 : null;
  const bars = (range === 7 ? stats.last7 : stats.last30);
  const bestTasks = stats.tasks.filter((t) => t.pct !== null && t.expected >= 3).slice(0, 3);
  const needAttention = [...stats.tasks].filter((t) => t.pct !== null && t.expected >= 3 && (t.pct as number) < 70).sort((a, b) => (a.pct as number) - (b.pct as number)).slice(0, 3);
  const unitLabel = (u: string) => d.unit[u] ?? u;

  return (
    <div className="st">
      <div className="st-tabs" role="tablist" aria-label={d.tabs[sub]}>
        {SUBTABS.map((id) => (
          <button key={id} type="button" role="tab" aria-selected={sub === id} className={`st-tab ${sub === id ? "active" : ""}`} onClick={(e) => { setSub(id); e.currentTarget.scrollIntoView?.({ inline: "center", block: "nearest", behavior: "smooth" }); }}>
            {d.tabs[id]}
          </button>
        ))}
      </div>

      <div className="st-grid">
        {/* ---------------- OVERVIEW ---------------- */}
        <section className="st-sec st-sec-overview" data-active={sub === "overview"}>
          <div className="st-kpis">
            <article className="st-card st-kpi st-kpi-ring">
              <Ring pct={stats.today.pct} label={d.today} />
              <div>
                <span className="st-kpi-label">{d.today}</span>
                <strong className="st-kpi-big">{stats.today.pct === null ? "—" : `${stats.today.pct}%`}</strong>
                <span className="st-kpi-sub">{fill(d.doneOf, { a: stats.today.done, b: stats.today.expected })}</span>
              </div>
            </article>
            <article className="st-card st-kpi">
              <span className="st-kpi-label">{d.avg7}</span>
              <strong className={`st-kpi-big st-text-${tone(stats.avg7)}`}>{stats.avg7 === null ? "—" : `${stats.avg7}%`}</strong>
              <span className={`st-kpi-sub ${trend === null ? "" : trend >= 0 ? "st-up" : "st-down"}`}>
                {trend === null ? d.noData : `${trend >= 0 ? "+" : "−"}${Math.abs(trend)}% ${d.vsPrev}`}
              </span>
            </article>
            <article className="st-card st-kpi">
              <span className="st-kpi-label">{d.avg30}</span>
              <strong className={`st-kpi-big st-text-${tone(stats.avg30)}`}>{stats.avg30 === null ? "—" : `${stats.avg30}%`}</strong>
              <span className="st-kpi-sub">{stats.last30.filter((x) => x.pct !== null).length} {d.days}</span>
            </article>
            <article className="st-card st-kpi">
              <span className="st-kpi-label">{d.streak}</span>
              <strong className="st-kpi-big">{stats.streak.current} <small>{d.days}</small></strong>
              <span className="st-kpi-sub">{fill(d.streakSub, { n: stats.streak.best })}</span>
            </article>
            <article className="st-card st-kpi">
              <span className="st-kpi-label">{d.perfect30}</span>
              <strong className="st-kpi-big">{stats.perfectDays30}</strong>
              <span className="st-kpi-sub">{d.perfectSub}</span>
            </article>
            <article className="st-card st-kpi">
              <span className="st-kpi-label">{d.total90}</span>
              <strong className="st-kpi-big">{stats.totalDone}</strong>
              <span className="st-kpi-sub">{d.totalSub}</span>
            </article>
          </div>
          {insights.length > 0 && (
            <article className="st-card st-insights">
              <h3 className="st-title">{d.insights}</h3>
              <ul>{insights.map((line) => <li key={line}>{line}</li>)}</ul>
            </article>
          )}
        </section>

        {/* ---------------- ACTIVITY ---------------- */}
        <section className="st-sec st-sec-activity" data-active={sub === "activity"}>
          <div className="st-two">
            <article className="st-card">
              <div className="st-card-head">
                <h3 className="st-title">{d.dailyResult}</h3>
                <div className="st-seg" role="group" aria-label={d.dailyResult}>
                  {([7, 30] as const).map((r) => (
                    <button key={r} type="button" className={range === r ? "active" : ""} aria-pressed={range === r} onClick={() => setRange(r)}>{r === 7 ? d.range7 : d.range30}</button>
                  ))}
                </div>
              </div>
              <div className={`st-bars ${range === 30 ? "dense" : ""}`} role="img" aria-label={d.dailyResult}>
                {bars.map((day, i) => {
                  const isToday = day.date === todayKey;
                  const dayNum = Number(day.date.slice(8));
                  return (
                    <div key={day.date} className={`st-bar-col ${isToday ? "today" : ""}`} title={`${day.date}: ${day.done}/${day.expected}`}>
                      <span className="st-bar-value">{day.pct === null ? "" : `${day.pct}`}</span>
                      <div className="st-bar-track"><div className={`st-bar-fill st-bg-${tone(day.pct)}`} style={{ height: `${day.pct ?? 0}%` }} /></div>
                      <span className="st-bar-label">{range === 7 ? weekdayNames.short[weekdayOf(day.date) - 1] : i % 5 === 0 || isToday ? dayNum : ""}</span>
                    </div>
                  );
                })}
              </div>
            </article>
            <article className="st-card">
              <h3 className="st-title">{d.heatmap}</h3>
              <div className="st-heat-wrap">
                <div className="st-heat-days" aria-hidden="true">{[0, 2, 4].map((i) => <span key={i} style={{ gridRow: i + 1 }}>{weekdayNames.short[i]}</span>)}</div>
                <div className="st-heat" role="img" aria-label={d.heatmap}>
                  {stats.heatmap.map((col, ci) => (
                    <div key={ci} className="st-heat-col">
                      {col.map((cell, ri) => (
                        <span key={ri} className={`st-heat-cell lv${cell ? heatLevel(cell.pct) : 0} ${cell ? "" : "future"} ${cell?.date === todayKey ? "today" : ""}`} title={cell ? `${cell.date}: ${cell.done}/${cell.expected}` : undefined} />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <div className="st-legend" aria-hidden="true">
                <span>{d.less}</span>{[0, 1, 2, 3, 4].map((l) => <span key={l} className={`st-heat-cell lv${l}`} />)}<span>{d.more}</span>
              </div>
            </article>
          </div>
        </section>

        {/* ---------------- TASKS ---------------- */}
        <section className="st-sec st-sec-tasks" data-active={sub === "tasks"}>
          <article className="st-card">
            <h3 className="st-title">{d.tasksTitle}</h3>
            {(bestTasks.length > 0 || needAttention.length > 0) && (
              <div className="st-chips">
                {bestTasks.length > 0 && <div><span className="st-chip-label st-text-good">{d.bestTasks}</span>{bestTasks.map((t) => <span key={t.id} className="st-chip">{t.title}</span>)}</div>}
                {needAttention.length > 0 && <div><span className="st-chip-label st-text-low">{d.needAttention}</span>{needAttention.map((t) => <span key={t.id} className="st-chip">{t.title}</span>)}</div>}
              </div>
            )}
            <ol className="st-tasklist">
              {stats.tasks.map((t, i) => (
                <li key={t.id}>
                  <span className="st-rank">{i + 1}</span>
                  <div className="st-task-main">
                    <div className="st-task-row"><strong title={t.title}>{t.title}</strong><span className={`st-task-pct st-text-${tone(t.pct)}`}>{t.pct === null ? "—" : `${t.pct}%`}</span></div>
                    <div className="st-meter"><div className={`st-meter-fill st-bg-${tone(t.pct)}`} style={{ width: `${t.pct ?? 0}%` }} /></div>
                    <div className="st-task-meta"><span>{fill(d.doneCount, { a: t.done, b: t.expected })}</span>{t.streak >= 2 && <span className="st-streak-chip">{fill(d.streakChip, { n: t.streak })}</span>}</div>
                  </div>
                </li>
              ))}
            </ol>
          </article>
        </section>

        {/* ---------------- GOALS ---------------- */}
        <section className="st-sec st-sec-goals" data-active={sub === "goals"}>
          {stats.prayers && (
            <article className="st-card st-prayer">
              <h3 className="st-title">{d.prayerTitle}</h3>
              <div className="st-prayer-row">
                <Ring pct={stats.prayers.avg} size={84} label={d.prayerTitle} />
                <div>
                  <p>{fill(d.prayerSub, { a: stats.prayers.perfectDays, b: stats.prayers.trackedDays })}</p>
                  <p className="st-muted">{fill(d.prayerStreak, { n: stats.prayers.current })} · {fill(d.streakSub, { n: stats.prayers.best })}</p>
                </div>
              </div>
            </article>
          )}
          <article className="st-card">
            <h3 className="st-title">{d.goalsTitle}</h3>
            {stats.counters.length === 0 ? <p className="st-muted">{d.noCounters}</p> : (
              <ul className="st-counters">
                {stats.counters.map((c) => {
                  const pct = c.weekGoal > 0 ? Math.min(100, Math.round((c.weekTotal / c.weekGoal) * 100)) : 0;
                  const max = Math.max(c.target, ...c.week, 1);
                  return (
                    <li key={c.id}>
                      <div className="st-task-row"><strong title={c.title}>{c.title}</strong><span className={`st-task-pct st-text-${tone(pct)}`}>{pct}%</span></div>
                      <div className="st-meter"><div className={`st-meter-fill st-bg-${tone(pct)}`} style={{ width: `${pct}%` }} /></div>
                      <div className="st-task-meta"><span>{fill(d.weekOf, { a: Math.round(c.weekTotal), b: Math.round(c.weekGoal), u: unitLabel(c.unit) })}</span></div>
                      <div className="st-mini" aria-hidden="true">
                        {c.week.map((v, i) => (
                          <div key={i} className="st-mini-col" title={`${addDays(todayKey, -(6 - i))}: ${v}`}>
                            <div className="st-mini-track"><div className={`st-mini-fill ${v >= c.target ? "full" : ""}`} style={{ height: `${Math.min(100, (v / max) * 100)}%` }} /></div>
                            <span>{weekdayNames.short[weekdayOf(addDays(todayKey, -(6 - i))) - 1]}</span>
                          </div>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </article>
        </section>

        {/* ---------------- ANALYSIS ---------------- */}
        <section className="st-sec st-sec-analysis" data-active={sub === "analysis"}>
          <div className="st-two">
            <article className="st-card">
              <h3 className="st-title">{d.weekdayTitle}</h3>
              <ul className="st-hbars">
                {stats.weekdays.map((w) => (
                  <li key={w.weekday}>
                    <span className="st-hbar-label">{weekdayNames.short[w.weekday - 1]}</span>
                    <div className="st-meter"><div className={`st-meter-fill st-bg-${tone(w.pct)}`} style={{ width: `${w.pct ?? 0}%` }} /></div>
                    <span className="st-hbar-value">{w.pct === null ? "—" : `${w.pct}%`}</span>
                  </li>
                ))}
              </ul>
            </article>
            <article className="st-card">
              <h3 className="st-title">{d.slotTitle}</h3>
              {stats.slots.length === 0 ? <p className="st-muted">{d.noData}</p> : (
                <ul className="st-hbars">
                  {stats.slots.map((s) => (
                    <li key={s.slot}>
                      <span className="st-hbar-label wide">{d.slots[s.slot]}</span>
                      <div className="st-meter"><div className={`st-meter-fill st-bg-${tone(s.pct)}`} style={{ width: `${s.pct ?? 0}%` }} /></div>
                      <span className="st-hbar-value">{s.pct === null ? "—" : `${s.pct}%`}</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </div>
        </section>
      </div>
    </div>
  );
}
