import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MYPLAN — Rejang o‘zingga mos bo‘lsin",
  description:
    "Faoliyatlaringni rejalashtir, o‘sishingni kuzat va natijalaringni ko‘r.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="uz">
      <body>{children}</body>
    </html>
  );
}
