import type { Language } from "./translations";

/**
 * Built-in activity presets (collections). Presets are defined in code; a signed-in
 * user can import one into their own workspace, after which every imported activity
 * is a normal, fully editable/deletable activity.
 */

type LocalizedText = Record<Language, string>;

export interface PresetItem {
  title: LocalizedText;
  description?: LocalizedText;
  /** "check" = simple tick, "count" = measurable (target must be >= 2). */
  kind: "check" | "count";
  target?: number;
  unit?: LocalizedText;
  timeOfDay: "morning" | "afternoon" | "evening" | "anytime";
  /** Local reminder time "HH:MM"; omitted = no reminder. */
  reminderTime?: string;
  /** ISO weekdays 1..7 (Mon..Sun); omitted = every day. */
  weekdays?: number[];
}

export interface Preset {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  items: PresetItem[];
}

export const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

export const PRESETS: Preset[] = [
  {
    id: "health",
    name: { uz: "Salomatlik", en: "Health", ru: "Здоровье" },
    description: {
      uz: "Kunlik jismoniy faollik va sog‘lom odatlar.",
      en: "Daily physical activity and healthy habits.",
      ru: "Ежедневная физическая активность и здоровые привычки.",
    },
    items: [
      {
        title: { uz: "Push-ups (yerdan turish)", en: "Push-ups", ru: "Отжимания" },
        kind: "count",
        target: 50,
        unit: { uz: "marta", en: "reps", ru: "раз" },
        timeOfDay: "morning",
      },
      {
        title: { uz: "Pull-ups (turnikda tortilish)", en: "Pull-ups", ru: "Подтягивания" },
        kind: "count",
        target: 50,
        unit: { uz: "marta", en: "reps", ru: "раз" },
        timeOfDay: "morning",
      },
      {
        title: { uz: "Squats (cho‘qqayish)", en: "Squats", ru: "Приседания" },
        kind: "count",
        target: 100,
        unit: { uz: "marta", en: "reps", ru: "раз" },
        timeOfDay: "morning",
      },
      {
        title: { uz: "Suv ichish", en: "Drink water", ru: "Пить воду" },
        kind: "count",
        target: 8,
        unit: { uz: "stakan", en: "glasses", ru: "стаканов" },
        timeOfDay: "anytime",
      },
      {
        title: { uz: "Piyoda yurish", en: "Walk", ru: "Прогулка" },
        kind: "count",
        target: 8000,
        unit: { uz: "qadam", en: "steps", ru: "шагов" },
        timeOfDay: "afternoon",
      },
    ],
  },
  {
    id: "prayer",
    name: { uz: "Namoz", en: "Prayer", ru: "Намаз" },
    description: {
      uz: "Besh vaqt namoz — har bir vaqt alohida vazifa.",
      en: "The five daily prayers — each as its own task.",
      ru: "Пять ежедневных молитв — каждая как отдельная задача.",
    },
    items: [
      { title: { uz: "Bomdod namozi", en: "Fajr prayer", ru: "Фаджр" }, kind: "check", timeOfDay: "morning" },
      { title: { uz: "Peshin namozi", en: "Dhuhr prayer", ru: "Зухр" }, kind: "check", timeOfDay: "afternoon" },
      { title: { uz: "Asr namozi", en: "Asr prayer", ru: "Аср" }, kind: "check", timeOfDay: "afternoon" },
      { title: { uz: "Shom namozi", en: "Maghrib prayer", ru: "Магриб" }, kind: "check", timeOfDay: "evening" },
      { title: { uz: "Xufton namozi", en: "Isha prayer", ru: "Иша" }, kind: "check", timeOfDay: "evening" },
    ],
  },
  {
    id: "study",
    name: { uz: "O‘qish va rivojlanish", en: "Study & growth", ru: "Учёба и развитие" },
    description: {
      uz: "Kitob, til o‘rganish va kunlik rejalashtirish.",
      en: "Reading, language practice and daily planning.",
      ru: "Чтение, изучение языка и ежедневное планирование.",
    },
    items: [
      {
        title: { uz: "Kitob o‘qish", en: "Read a book", ru: "Чтение книги" },
        kind: "count",
        target: 20,
        unit: { uz: "bet", en: "pages", ru: "страниц" },
        timeOfDay: "evening",
      },
      {
        title: { uz: "Til o‘rganish", en: "Language practice", ru: "Изучение языка" },
        kind: "check",
        timeOfDay: "afternoon",
      },
      {
        title: { uz: "Ertangi kunni rejalashtirish", en: "Plan tomorrow", ru: "Планирование завтрашнего дня" },
        kind: "check",
        timeOfDay: "evening",
      },
    ],
  },
];
