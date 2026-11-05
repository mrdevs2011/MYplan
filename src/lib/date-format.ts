import type { Language } from "@/lib/translations";

const UZ_WEEKDAYS = ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"];
const UZ_MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];

/** "5-noyabr, payshanba" / "Thursday, November 5" / "четверг, 5 ноября". Uzbek is spelled out by hand because many browsers ship no `uz` Intl data and print "M11 5, Thu". */
export function formatLongDate(language: Language, date: Date = new Date()): string {
  if (language === "uz") return `${date.getDate()}-${UZ_MONTHS[date.getMonth()]}, ${UZ_WEEKDAYS[date.getDay()]}`;
  const locale = language === "ru" ? "ru-RU" : "en-US";
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(date);
}
