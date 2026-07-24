"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthTransition } from "@/components/auth-transition";
import { login } from "@/lib/crm";

export function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setLoading(true); setError("");
    try { const result = await login(email, password); router.push(result.user.role === "ADMIN" ? "/dashboard" : "/my-leads"); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to sign in."); }
    finally { setLoading(false); }
  };
  if (loading) return <AuthTransition stage="signin" />;
  return <main className="page" style={{ maxWidth: "32rem", margin: "4rem auto" }}><div className="page-heading compact"><div><p className="eyebrow">REVERA CRM</p><h1>Welcome <span>back.</span></h1><p className="subtext">Sign in with the account created by your administrator.</p></div></div><form className="panel" style={{ padding: "1.5rem", display: "grid", gap: "1rem" }} onSubmit={submit}><label>Email<input type="email" value={email} onChange={event => setEmail(event.target.value)} required autoComplete="email" /></label><label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} required autoComplete="current-password" /></label>{error && <p className="subtext">{error}</p>}<button className="button primary" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</button></form></main>;
}
