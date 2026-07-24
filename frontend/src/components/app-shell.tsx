"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

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
  const links = role === "Admin" ? adminLinks : officerLinks;

  return <div className="app-shell">
    <aside className="sidebar">
      <Link className="brand" href={role === "Admin" ? "/dashboard" : "/my-leads"}><span className="brand-mark">R</span><span className="brand-word">revera<span>.</span></span></Link>
      <p className="workspace-label">{role === "Admin" ? "SALES CONTROL" : "MY WORKSPACE"}</p>
      <nav className="nav" aria-label="Main navigation">
        {links.map(([href, label, icon]) => <Link key={href} className={`nav-link ${pathname === href ? "active" : ""}`} href={href}><span>{icon}</span><b>{label}</b>{label === "Lead pool" && <em>24</em>}</Link>)}
      </nav>
      <div className="sidebar-footer">
        <Link className="support" href="#support"><span>?</span><p>Need a hand?<small>Open the operator guide</small></p></Link>
        <div className="user-card"><div className={`avatar ${role === "Admin" ? "orange" : "blue"}`}>{role === "Admin" ? "JM" : "AR"}</div><p><b>{role === "Admin" ? "Jin Malla" : "Arjun Raina"}</b><small>{role} · Srinagar</small></p><button aria-label="Account options">···</button></div>
      </div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div><b>{role === "Admin" ? "Lead control" : "My queue"}</b><small>Friday, 24 July</small></div><div className="top-actions"><Link className="role-link" href={role === "Admin" ? "/my-leads" : "/dashboard"}>{role === "Admin" ? "Sales officer view" : "Manager view"}</Link><button className="bell" aria-label="Notifications">♢<i>3</i></button>{role === "Admin" && <Link className="button primary" href="/leads">＋ Upload leads</Link>}</div></header>
      {children}
    </main>
  </div>;
}
