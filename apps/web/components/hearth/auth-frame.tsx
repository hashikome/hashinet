import Link from "next/link";
import type { ReactNode } from "react";
import { Mark } from "./icons";

export const SUPPORT_EMAIL = "support@hashikome.com";

/** The signed-out frame: one panel on the night, the ember's ring behind it. Simple, as Cloudflare's. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="auth">
      <svg className="auth-fire" viewBox="0 0 32 32" aria-hidden="true">
        <path
          d="M22.6 6.2A12 12 0 1 0 27.8 14"
          fill="none"
          strokeWidth={1.6}
          strokeLinecap="round"
        />
        <circle cx="26.4" cy="8.4" r="1.6" />
      </svg>
      <div className="auth-panel">
        <div className="auth-form">
          <div className="auth-mark">
            <Mark size={30} />
          </div>
          {children}
        </div>
      </div>
      <footer className="auth-legal">
        <span>© {new Date().getFullYear()} Shikome Technology Limited</span>
        <nav className="auth-links-row" aria-label="Legal and feedback">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <a href={`mailto:${SUPPORT_EMAIL}?subject=Feedback%20on%20HashiNet`}>Send feedback</a>
        </nav>
      </footer>
    </main>
  );
}
