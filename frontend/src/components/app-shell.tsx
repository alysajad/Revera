"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { getCurrentUser, type CurrentUser } from "@/lib/crm";

type AppShellProps = { children: ReactNode; role: "Admin" | "Sales officer" };

const adminLinks = [
  ["/dashboard", "Overview", "⌁"],
  ["/leads", "Lead pool", "◫"],
  ["/team", "Team", "◎"],
  ["/analytics", "Insights", "◔"],
] as const;
const officerLinks = [
  ["/my-leads", "My queue", "◫"],
  ["/follow-ups", "Follow-ups", "◷"],
  ["/my-analytics", "My results", "◔"],
] as const;

export function AppShell({ children, role }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const links = role === "Admin" ? adminLinks : officerLinks;
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [checkingAccess, setCheckingAccess] = useState(true);
  useEffect(() => {
    void getCurrentUser().then(result => {
      setUser(result.user);
      if ((role === "Admin") !== (result.user.role === "ADMIN")) router.replace(result.user.role === "ADMIN" ? "/dashboard" : "/my-leads");
    }).catch(() => router.replace("/")).finally(() => setCheckingAccess(false));
  }, [role, router]);
  const displayName = user ? `${user.first_name} ${user.last_name}`.trim() || user.email : "Sign in";
  const initials = user ? `${user.first_name[0] || ""}${user.last_name[0] || ""}` || user.email.slice(0, 2).toUpperCase() : "?";

  if (checkingAccess || (user && ((role === "Admin") !== (user.role === "ADMIN")))) return null;

  return <div className="app-shell">
    <aside className="sidebar">
      <Link className="brand" href={role === "Admin" ? "/dashboard" : "/my-leads"}><span className="brand-mark">R</span><span className="brand-word">revera<span>.</span></span></Link>
      <p className="workspace-label">{role === "Admin" ? "SALES CONTROL" : "MY WORKSPACE"}</p>
      <nav className="nav" aria-label="Main navigation">
        {links.map(([href, label, icon]) => <Link key={href} className={`nav-link ${pathname === href ? "active" : ""}`} href={href}><span>{icon}</span><b>{label}</b></Link>)}
      </nav>
      <div className="sidebar-footer">
        <Link className="support" href="#support"><span>?</span><p>Need a hand?<small>Open the operator guide</small></p></Link>
        <Link className="user-card" href="/"><div className={`avatar ${role === "Admin" ? "orange" : "blue"}`}>{initials}</div><p><b>{displayName}</b><small>{user ? role : "Authenticate to continue"}</small></p></Link>
      </div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div><b>{role === "Admin" ? "Lead control" : "My queue"}</b><small>{new Intl.DateTimeFormat("en", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}</small></div><div className="top-actions">{role === "Admin" && <Link className="button primary" href="/leads">＋ Upload leads</Link>}</div></header>
      {children}
    </main>
  </div>;
}
