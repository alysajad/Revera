"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { getCurrentUser, logout, type CurrentUser } from "@/lib/crm";
import { formatDate } from "@/lib/dates";

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
  const [sessionConflict, setSessionConflict] = useState<CurrentUser | null>(null);
  useEffect(() => {
    void getCurrentUser().then(result => {
      const actual = result.user;
      if ((role === "Admin") !== (actual.role === "ADMIN")) {
        setSessionConflict(actual);
      } else {
        setUser(actual);
      }
    }).catch(() => router.replace("/")).finally(() => setCheckingAccess(false));
  }, [role, router]);
  const displayName = user ? `${user.first_name} ${user.last_name}`.trim() || user.email : "Sign in";
  const initials = user ? `${user.first_name[0] || ""}${user.last_name[0] || ""}` || user.email.slice(0, 2).toUpperCase() : "?";
  const signOut = async () => {
    try { await logout(); }
    finally { router.replace("/"); }
  };

  if (checkingAccess) return null;

  if (sessionConflict) {
    const actualRole = sessionConflict.role === "ADMIN" ? "Admin" : "Sales Officer";
    const actualHome = sessionConflict.role === "ADMIN" ? "/dashboard" : "/my-leads";
    const actualName = `${sessionConflict.first_name} ${sessionConflict.last_name}`.trim() || sessionConflict.email;
    return (
      <main className="page" style={{ maxWidth: "32rem", margin: "6rem auto", textAlign: "center" }}>
        <div className="panel" style={{ padding: "2rem", display: "grid", gap: "1rem" }}>
          <p className="eyebrow">SESSION CONFLICT</p>
          <h2 style={{ margin: 0 }}>Signed in as a different user</h2>
          <p className="subtext" style={{ margin: 0 }}>
            You signed in as <strong>{actualName}</strong> ({actualRole}) in another tab.
            That session replaced this one.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", marginTop: "0.5rem" }}>
            <button className="button primary" onClick={() => router.replace(actualHome)}>Continue as {actualRole}</button>
            <button className="button" onClick={() => void signOut()}>Sign in again</button>
          </div>
        </div>
      </main>
    );
  }

  return <div className={`app-shell ${role === "Sales officer" ? "sales-shell" : ""}`}>
    <aside className="sidebar">
      <Link className="brand" href={role === "Admin" ? "/dashboard" : "/my-leads"}><span className="brand-mark">R</span><span className="brand-word">revera<span>.</span></span></Link>
      <p className="workspace-label">{role === "Admin" ? "SALES CONTROL" : "MY WORKSPACE"}</p>
      <nav className="nav" aria-label="Main navigation">
        {links.map(([href, label, icon]) => <Link key={href} className={`nav-link ${pathname === href ? "active" : ""}`} href={href}><span>{icon}</span><b>{label}</b></Link>)}
      </nav>
      <div className="sidebar-footer">
        <Link className="support" href="#support"><span>?</span><p>Need a hand?<small>Open the operator guide</small></p></Link>
        <div className="user-card"><div className={`avatar ${role === "Admin" ? "orange" : "blue"}`}>{initials}</div><p><b>{displayName}</b><small>{user ? role : "Authenticate to continue"}</small></p><button onClick={() => void signOut()}>Sign out</button></div>
      </div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div><b>{role === "Admin" ? "Lead control" : "Leads pipeline"}</b><small>{new Intl.DateTimeFormat("en", { weekday: "long" }).format(new Date())}, {formatDate(new Date())}</small></div><div className="top-actions">{role === "Admin" && <button className="button primary" onClick={() => pathname === "/leads" ? window.dispatchEvent(new Event("revera:add-lead")) : router.push("/leads?addLead=1")}>＋ Add lead</button>}{role === "Sales officer" && <span className="sales-topbar-mark" aria-hidden="true">◌</span>}<button className="mobile-signout" onClick={() => void signOut()} aria-label="Sign out" title="Sign out">↪</button></div></header>
      {children}
    </main>
  </div>;
}
