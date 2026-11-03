import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export default function Home() {
  const configured = isSupabaseConfigured();

  return (
    <main className="shell">
      <nav className="topbar">
        <Link className="brand" href="/" aria-label="MYPLAN bosh sahifa">
          <span className="brand-mark">M</span> MYPLAN
        </Link>
        <span className="top-note">YOUR PLAN. YOUR PACE.</span>
      </nav>

      <section className="hero">
        <div className="eyebrow"><span /> PERSONAL PROGRESS, REIMAGINED</div>
        <h1>Rejang — <span>o‘zingga mos.</span><br />Natijang — ko‘z oldingda.</h1>
        <p className="intro">
          Katta maqsadlarni kichik qadamlarga bo‘l. Har kuni oz-ozdan oldinga yur.
          MYPLAN jarayonni ham, natijani ham qadrlaydi.
        </p>
        <div className="preview-card">
          <div className="preview-head">
            <div><span className="muted-label">WORKSPACE</span><h2>Bugungi holat</h2></div>
            <span className="date-pill">MYPLAN / 01</span>
          </div>
          <div className="empty-state">
            <div className="empty-icon">＋</div>
            <h3>Bu yer sening maydoning.</h3>
            <p>Faoliyatlaringni yaratganingdan keyin ular shu yerda ko‘rinadi.</p>
          </div>
          <div className="preview-foot"><span>01 — START WITH YOURSELF</span><span>BUILD YOUR MOMENTUM ↗</span></div>
        </div>
      </section>

      <footer className="statusbar">
        <span><i className={configured ? "status-dot online" : "status-dot"} /> SUPABASE {configured ? "CONNECTED CONFIG" : "SETUP REQUIRED"}</span>
        <span>MYPLAN · EARLY BUILD</span>
      </footer>
    </main>
  );
}
