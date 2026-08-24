"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { getCurrentUser, logout, type CurrentUser } from "@/lib/crm";
import { formatDate } from "@/lib/dates";

type AppShellProps = { children: ReactNode; role: "Admin" | "Sales officer" | "Receptionist" };

const adminLinks = [
  ["/analytics", "Analytics", "◱"],
  ["/team", "Users", "◬"],
  ["/lists", "Lists", "▤"],
  ["/leads", "All leads", "▦"],
] as const;
const officerLinks = [
  ["/my-leads", "My queue", "◫"],
  ["/follow-ups", "Follow-ups", "◷"],
  ["/complaints", "Complaints", "⚑"],
  ["/my-analytics", "My results", "◔"],
] as const;
const receptionistLinks = [
  ["/capture", "Capture Lead", "＋"],
  ["/receptionist-dashboard", "Dashboard", "◱"],
] as const;

export function AppShell({ children, role }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const links = role === "Admin" ? adminLinks : role === "Sales officer" ? officerLinks : receptionistLinks;
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [sessionConflict, setSessionConflict] = useState<CurrentUser | null>(null);
  useEffect(() => {
    void getCurrentUser().then(result => {
      const actual = result.user;
      let actualRoleType = "Sales officer";
      if (actual.role === "ADMIN") actualRoleType = "Admin";
      if (actual.role === "RECEPTIONIST") actualRoleType = "Receptionist";
      if (role !== actualRoleType) {
        setSessionConflict(actual);
      } else {
        setUser(actual);
      }
    }).catch(() => router.replace("/")).finally(() => setCheckingAccess(false));
  }, [role, router]);
  const displayName = user ? `${user.first_name} ${user.last_name}`.trim() || user.email : "Sign in";
  const initials = user ? `${user.first_name[0] || ""}${user.last_name[0] || ""}` || user.email.slice(0, 2).toUpperCase() : "?";
  const workspaceRole = user?.role === "CRE" ? "CRE" : user?.role === "SO" ? "PS/SO" : user?.role === "RECEPTIONIST" ? "Receptionist" : role;
  const shellRoleClass = role === "Sales officer" ? user?.role === "SO" ? "ps-shell" : "cre-shell" : role === "Receptionist" ? "receptionist-shell" : "";
  const signOut = async () => {
    try { await logout(); }
    finally { router.replace("/"); }
  };

  if (checkingAccess) return null;

  if (sessionConflict) {
    const actualRole = sessionConflict.role === "ADMIN" ? "Admin" : sessionConflict.role === "RECEPTIONIST" ? "Receptionist" : sessionConflict.role === "CRE" ? "CRE" : "PS/SO";
    const actualHome = sessionConflict.role === "ADMIN" ? "/dashboard" : sessionConflict.role === "RECEPTIONIST" ? "/capture" : "/my-leads";
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

  const homeHref = role === "Admin" ? "/dashboard" : role === "Receptionist" ? "/capture" : "/my-leads";

  return <div className={`app-shell ${role === "Sales officer" ? "sales-shell" : ""} ${shellRoleClass}`}>
    <aside className="sidebar">
      <Link className="brand" href={homeHref}><span className="brand-mark">R</span><span className="brand-word">river<span>.</span></span></Link>
      <p className="workspace-label">{role === "Admin" ? "SALES CONTROL" : `${workspaceRole} WORKSPACE`}</p>
      <nav className="nav" aria-label="Main navigation">
        {links.map(([href, label, icon]) => <Link key={href} className={`nav-link ${pathname === href ? "active" : ""}`} href={href}><span>{icon}</span><b>{label}</b></Link>)}
      </nav>
      <div className="sidebar-footer">
        <Link className="support" href="#support"><span>?</span><p>Need a hand?<small>Open the operator guide</small></p></Link>
        <div className="user-card"><div className={`avatar ${role === "Admin" ? "orange" : "blue"}`}>{initials}</div><p><b>{displayName}</b><small>{user ? workspaceRole : "Authenticate to continue"}</small></p><button onClick={() => void signOut()}>Sign out</button></div>
      </div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div><b>{role === "Admin" ? "Lead control" : role === "Receptionist" ? "Front Desk" : `${workspaceRole} pipeline`}</b><small>{new Intl.DateTimeFormat("en", { weekday: "long" }).format(new Date())}, {formatDate(new Date())}</small></div><div className="top-actions">{role === "Admin" && <button className="button primary" onClick={() => pathname === "/leads" ? window.dispatchEvent(new Event("river:add-lead")) : router.push("/leads?addLead=1")}>＋ Add lead</button>}{role === "Sales officer" && <span className="sales-topbar-mark" aria-hidden="true">◌</span>}<button className="mobile-signout" onClick={() => void signOut()} aria-label="Sign out" title="Sign out">↪</button></div></header>
      {children}
    </main>
  </div>;
}
