# MYplan

Next.js + Supabase kunlik reja ilovasi (PWA). Deploy: Vercel.

## Komandalar
- `npm run dev` — dev server
- `npm run build` — build (push oldidan tekshir)
- `npm run lint`, `npm test`

## Qoidalar
- Foydalanuvchiga **o'zbek tilida** javob ber.
- Faqat so'ralgan vazifani qil. Keraksiz refaktor va qo'shimcha feature qo'shma.
- Kerakli fayllarnigina o'qi; `.next/`, `node_modules/` ga kirma.
- Commit va `main` ga push faqat men so'raganda. Push oldidan `npm run build` o'tishi shart.
- Mobil, planshet va desktop layout buzilmasligi kerak.
- Siyosat: "gray" (kulrang) holatlar va keraksiz splash bo'lmasin.

## Maxfiylik
- Kalit va tokenlarni (`SUPABASE_SERVICE_ROLE_KEY`, `.env.local`) hech qachon chatga yozma, commit qilma.
- DB ga yozishdan oldin nimani o'zgartirishingni ayt; foydalanuvchi ma'lumotini o'chirishdan oldin so'ra.

## Ma'lumot
- Holat va rejalar: `STATUS.md`, `docs/`.
