const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

type Paginated<T> = { results: T[] };
type ApiLead = {
  id: number; name: string; phone: string; source: string; model_interest: string; city: string;
  enquiry_date: string | null; status: string; assigned_so: number | null; assigned_so_name: string; created_at: string;
};
type ApiOfficer = { id: number; first_name: string; last_name: string; email: string; phone: string; is_active: boolean };

export type Lead = {
  id: number; name: string; phone: string; source: string; model: string; city: string; enquiredAt: string;
  status: string; assignedSoId: number | null; assignedSoName: string;
};
export type Officer = { id: number; name: string; initials: string; color: "blue" | "green" | "violet" | "orange"; assigned: number; calls: number; qualified: number; won: number };
export type Metrics = { total_assigned: number; total_called: number; qualified: number; walkins: number; won: number; lost: number; conversion_rate: number };
export type Analytics = { summary: Metrics; source: { source: string; total: number; qualified: number; won: number }[]; officers: (Metrics & { id: number; name: string })[] };
export type CurrentUser = { id: number; first_name: string; last_name: string; email: string; role: "ADMIN" | "SO" };

let csrfToken = "";

async function csrf() {
  if (csrfToken) return csrfToken;
  const response = await fetch(`${API_URL}/api/auth/csrf/`, { credentials: "include" });
  const body = await response.json() as { csrfToken: string };
  csrfToken = body.csrfToken;
  return csrfToken;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = options.method?.toUpperCase() || "GET";
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) headers.set("X-CSRFToken", await csrf());
  const response = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: "include" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: string };
    throw new Error(body.detail || "The request could not be completed.");
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

const sourceNames: Record<string, string> = { META: "Meta Ads", WEBSITE: "Website", CARWALE: "CarWale", WALKIN: "Walk-in", CAMPAIGN: "Campaign", OTHER: "Other", UNKNOWN: "Unknown" };
const statusNames: Record<string, string> = { FRESH: "Fresh", RNR: "RNR", CALLBACK: "Callback", QUALIFIED: "Qualified", UNQUALIFIED: "Unqualified", WALKIN: "Walk-in", WON: "Won", LOST: "Lost" };
const colors: Officer["color"][] = ["blue", "green", "violet", "orange"];

export const sourceName = (source: string) => sourceNames[source] || source;
export const statusName = (status: string) => statusNames[status] || status;
export const sourceClass = (source: string) => sourceName(source).toLowerCase().replaceAll(" ", "-");
export const toLead = (lead: ApiLead): Lead => ({ ...lead, source: sourceName(lead.source), model: lead.model_interest || "—", enquiredAt: lead.enquiry_date || new Intl.DateTimeFormat("en", { day: "numeric", month: "short" }).format(new Date(lead.created_at)), status: statusName(lead.status), assignedSoId: lead.assigned_so, assignedSoName: lead.assigned_so_name });
export const toOfficer = (officer: ApiOfficer, metrics?: Metrics): Officer => ({ id: officer.id, name: `${officer.first_name} ${officer.last_name}`.trim() || officer.email, initials: `${officer.first_name[0] || ""}${officer.last_name[0] || ""}` || officer.email.slice(0, 2).toUpperCase(), color: colors[officer.id % colors.length], assigned: metrics?.total_assigned || 0, calls: metrics?.total_called || 0, qualified: metrics?.qualified || 0, won: metrics?.won || 0 });

export async function getLeads(query = "") { const data = await api<Paginated<ApiLead>>(`/api/leads/${query}`); return data.results.map(toLead); }
export async function getOfficers() { const data = await api<Paginated<ApiOfficer>>("/api/auth/sales-officers/"); return data.results; }
export const getAdminAnalytics = () => api<Analytics>("/api/analytics/admin/");
export const getMyAnalytics = () => api<Metrics>("/api/analytics/me/");
export const assignLead = (leadId: number, officerId: number) => api<Lead>(`/api/leads/${leadId}/assign/`, { method: "POST", body: JSON.stringify({ sales_officer_id: officerId }) });
export const autoAssignLeads = () => api<{ assigned: number }>("/api/leads/auto-assign/", { method: "POST", body: JSON.stringify({}) });
export const logCall = (leadId: number, payload: { status: string; remarks?: string; follow_up_at?: string }) => api<Lead>(`/api/leads/${leadId}/log-call/`, { method: "POST", body: JSON.stringify(payload) });
export const login = (email: string, password: string) => api<{ user: CurrentUser }>("/api/auth/login/", { method: "POST", body: JSON.stringify({ email, password }) });
export const logout = () => api<void>("/api/auth/logout/", { method: "POST" });
export const getCurrentUser = () => api<{ user: CurrentUser }>("/api/auth/me/");
export const uploadLeads = (file: File) => { const body = new FormData(); body.append("file", file); return api<UploadBatch>("/api/uploads/", { method: "POST", body }); };
export const getUpload = (id: number) => api<UploadBatch>(`/api/uploads/${id}/`);
export const resolveUploadDuplicates = (id: number, rows: { id: number; resolution: "SKIP" }[]) => api<{ detail: string; duplicates_found: number }>(`/api/uploads/${id}/resolve-duplicates/`, { method: "POST", body: JSON.stringify({ rows }) });
export const commitUpload = (id: number) => api<{ created: number; overwritten: number; skipped: number }>(`/api/uploads/${id}/commit/`, { method: "POST", body: JSON.stringify({}) });
export type UploadRow = { id: number; row_number: number; data: { name?: string }; normalized_phone: string; validation_error: string; duplicate_of: number | null; existing_name: string; existing_status: string; resolution: "PENDING" | "SKIP" | "OVERWRITE" | "IMPORT" };
export type UploadBatch = { id: number; status: "PARSING" | "READY" | "COMMITTED" | "FAILED"; total_rows: number; parsed_ok: number; duplicates_found: number; skipped: number; error_message: string; rows?: UploadRow[] };
