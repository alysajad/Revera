"use client";

import { useEffect, useState, FormEvent } from "react";
import { getUsers, createUser, disableUser, type CurrentUser } from "@/lib/crm";

export function TeamPage() {
  const [usersRaw, setUsers] = useState<CurrentUser[]>([]);
  const users = Array.isArray(usersRaw) ? usersRaw : ((usersRaw as any).results || []) as CurrentUser[];
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = () => {
    getUsers()
      .then(setUsers)
      .catch(err => setError(err instanceof Error ? err.message : "Failed to load users."));
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const form = e.currentTarget;
    const formData = new FormData(form);
    
    // Map UI roles to Backend roles
    const uiRole = formData.get("role") as string;
    let backendRole = "ADMIN";
    if (uiRole === "Marketing") backendRole = "CRE";
    if (uiRole === "Sales Manager") backendRole = "SO";
    if (uiRole === "Receptionist") backendRole = "RECEPTIONIST";

    const payload = {
      first_name: formData.get("firstName"),
      last_name: formData.get("lastName"),
      email: formData.get("email"),
      password: formData.get("password"),
      role: backendRole,
      is_active: true
    };

    try {
      await createUser(payload);
      form.reset();
      loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create user.");
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async (id: number) => {
    if (!confirm("Disable this user?")) return;
    try {
      await disableUser(id);
      loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disable user.");
    }
  };

  const displayRole = (role: string) => {
    if (role === "CRE") return "Marketing";
    if (role === "SO") return "Sales Manager";
    if (role === "RECEPTIONIST") return "Receptionist";
    return "Administrator";
  };

  return (
    <section className="page" style={{ maxWidth: "600px", margin: "0 auto", paddingBottom: "4rem" }}>
      <div className="page-heading compact">
        <div>
          <h1>Users <span>Administrator</span></h1>
        </div>
      </div>
      
      {error && <div className="empty-state">{error}</div>}

      <article className="panel" style={{ marginBottom: "2rem" }}>
        <header className="panel-heading">
          <h2>Create user</h2>
        </header>
        <form onSubmit={onSubmit}>
          <div className="form-grid">
            <label>Full name *
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input name="firstName" required placeholder="First name" style={{ flex: 1 }} />
                <input name="lastName" placeholder="Last name" style={{ flex: 1 }} />
              </div>
            </label>
          </div>
          <div className="form-grid" style={{ marginTop: "13px" }}>
            <label>Username *
              <input type="email" name="email" required placeholder="Email address" />
            </label>
          </div>
          <div className="form-grid" style={{ marginTop: "13px" }}>
            <label>Password (min 12 characters)
              <input type="password" name="password" required minLength={12} />
            </label>
            <label>Role *
              <select name="role" required>
                <option value="">Select...</option>
                <option value="Admin">Admin</option>
                <option value="Marketing">Marketing</option>
                <option value="Sales Manager">Sales Manager</option>
                <option value="Receptionist">Receptionist</option>
              </select>
            </label>
          </div>
          <button type="submit" className="button primary" disabled={loading} style={{ width: "100%", marginTop: "20px" }}>
            {loading ? "Creating..." : "Create user"}
          </button>
        </form>
      </article>

      <article className="panel">
        <header className="panel-heading">
          <h2>Users ({users.filter(u => u.is_active).length})</h2>
        </header>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "1rem" }}>
          {users.filter(u => u.is_active).map(user => (
            <li key={user.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "1rem", borderBottom: "1px solid var(--border)" }}>
              <div>
                <b style={{ display: "block" }}>{user.first_name} {user.last_name}</b>
                <small style={{ color: "var(--text-dim)" }}>@{user.email.split("@")[0]} · {displayRole(user.role)}</small>
              </div>
              <button className="button" onClick={() => handleDisable(user.id)}>Disable</button>
            </li>
          ))}
        </ul>
      </article>
    </section>
  );
}
