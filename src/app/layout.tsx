import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#b4f04c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export const metadata: Metadata = {
  title: "MyPlan — Plan your day. Own your time.",
  description:
    "Shaxsiy rejalashtirish, unumdorlik va odatlarni barqaror rivojlantirish platformasi.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png", sizes: "512x512" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "MyPlan",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="uz" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var t = localStorage.getItem("myplan_theme") || "system";
                  var isLight = t === "light" || (t === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);
                  document.documentElement.setAttribute("data-theme", isLight ? "light" : "dark");
                } catch(e) {}
                try {
                  window.__myplanInstallPrompt = null;
                  window.addEventListener('beforeinstallprompt', function(e) {
                    e.preventDefault();
                    window.__myplanInstallPrompt = e;
                  });
                } catch(e) {}
              })();
            `,
          }}
        />
        <link rel="manifest" href="/manifest.json" />
        <link rel="preload" as="image" href="/myplan-logo-transparent.png" type="image/png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body>{children}</body>
    </html>
  );
}
