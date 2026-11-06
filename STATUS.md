# AI Context — MyLife (repo: MYplan)

## Oxirgi holat
- Sana: 2026-11-06
- Nima qilindi: ilova nomi MyLife; tasbeh (float + tab), realtime `user_state` (taymer, sekundomer, tasbeh, mavzu, maxsus zonalar);
  to'liq offline (snapshot, navbat, SW); bir brauzerdagi barcha akkauntlar uchun push; offline/online to'qnashuvlarini hal qilish.
- Hozirgi muammo/blocker: `sql/015_occurrence_status_time.sql` bazaga qo'llanishi kerak (kod usiz ham ishlaydi, himoya bor).
- Keyingi qadam: 015 ni qo'llash; haqiqiy qurilmalarda offline/realtime sinovi.

## Muhim fayllar
- `src/app/page.tsx` — asosiy ilova, navbat (outbox) protsessori, snapshot
- `src/lib/progress-sync.ts` — outbox, overlay, remap; `src/lib/patch.ts` — faqat o'zgargan maydonlar
- `src/lib/use-synced-state.ts` — realtime `user_state` hook (LWW + ixtiyoriy merge)
- `src/lib/push-accounts.ts` — barcha saqlangan akkauntlar uchun push
- `public/sw.js` — offline kesh strategiyasi
- `sql/` va `supabase/migrations/` — sxema (013–015 yangi)

## Eslatmalar (arxitektura, qarorlar, "buni qilma" kabi)
- `supabase db push` ishlatma: masofaviy migratsiya tarixi bo'sh. Yangi SQL: `supabase db query --linked -f sql/NNN_*.sql`.
- Saqlash kalitlari `myplan_*` o'zgarmaydi (nomni o'zgartirish sessiyalarni yo'qotadi).
- Push obunasi (akkaunt, brauzer endpoint) juftligiga tegishli; ruxsat brauzer darajasida.
- To'qnashuv qoidalari: progress hodisalari qo'shiladi; holat — oxirgi o'zgartirgan yutadi (`status_changed_at`);
  reja tahriri — faqat o'zgargan maydonlar; maxsus zonalar — birlashtiriladi; taymer/tasbeh/mavzu — oxirgi yozuv yutadi.
