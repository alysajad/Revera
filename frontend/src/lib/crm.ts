const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
import { formatDate } from "@/lib/dates";

type Paginated<T> = { count?: number; next?: string | null; previous?: string | null; results: T[] };
type ApiLead = {
  id: number; name: string; phone: string; email: string; source: string; source_label: string; campaign: string; model_interest: string; city: string;
  branch: string; enquiry_date: string | null; status: string; category: string; sales_outcome: string; assigned_so: number | null; assigned_so_name: string; next_follow_up: string | null; call_count: number; qualification: LeadQualification | null; created_at: string;
};
type ApiOfficer = { id: number; first_name: string; last_name: string; email: string; phone: string; is_active: boolean };

export type Lead = {
  id: number; name: string; phone: string; source: string; sourceCode: string; model: string; city: string; enquiryDate: string | null; enquiredAt: string;
  branch: string; campaign: string; category: string; salesOutcome: string; nextFollowUp: string | null; callCount: number; statusCode: string; status: string; assignedSoId: number | null; assignedSoName: string;
};
export type LeadInput = { name: string; phone: string; email?: string; source: string; source_label?: string; campaign?: string; model_interest?: string; city?: string; enquiry_date?: string };
export type LeadFilters = { source?: string; model?: string; city?: string; source_label?: string; date_from?: string; date_to?: string };
export type LeadQualification = { variant: string; buying_timeline: string; finance_type: string; trade_in: boolean | null; test_drive: string; notes: string; updated_at?: string };
export type CallHistory = { id: number; status: string; outcome: string; remarks: string; so_name: string; created_at: string };
export type FollowUpHistory = { id: number; lead: number; customer: string; scheduled_for: string; resolved_at: string | null; notified_at: string | null };
export type LeadDetail = Lead & { email: string; sourceLabel: string; campaign: string; qualification: LeadQualification | null; callHistory: CallHistory[]; followUpHistory: FollowUpHistory[]; auditHistory: { event: string; before: Record<string, unknown>; after: Record<string, unknown>; actor: string; created_at: string }[] };
export type SalesDashboard = { summary: { total: number; fresh: number; followups: number; pending: number; qualified: number; walkin: number; won: number; lost: number; won_lost: number; untouched: number; called: number; scheduled: number }; section: string; results: Lead[] };
export type PersonalAnalytics = { range: string; summary: { total: number; assigned: number; qualified: number; booked: number; lost: number; retailed: number; conversion_rate: number }; status_counts: { status: string; count: number }[]; source: { source: string; total: number; qualified: number; booked: number; retailed: number }[]; models: { model_interest: string; total: number; qualified: number; booked: number }[]; monthly: { month: string; total: number; qualified: number; booked: number; retailed: number }[] };
export type Officer = { id: number; name: string; initials: string; color: "blue" | "green" | "violet" | "orange"; assigned: number; calls: number; qualified: number; won: number };
export type Metrics = { total_assigned: number; total_called: number; calls_today?: number; qualified: number; walkins: number; won: number; lost: number; conversion_rate: number };
export type Analytics = { summary: Metrics; source: { source: string; total: number; qualified: number; won: number }[]; officers: (Metrics & { id: number; name: string })[] };
export type CurrentUser = { id: number; first_name: string; last_name: string; email: string; role: "ADMIN" | "SO" };

let csrfToken = "";

function responseError(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") return fallback;
  if (typeof (body as { detail?: unknown }).detail === "string") return (body as { detail: string }).detail;
  const messages = Object.entries(body as Record<string, unknown>).flatMap(([field, value]) => {
    const label = field === "non_field_errors" ? "" : `${field}: `;
    return (Array.isArray(value) ? value : [value]).map(message => `${label}${String(message)}`);
  });
  return messages.join(" ") || fallback;
}

async function csrf() {
  if (csrfToken) return csrfToken;
  const response = await fetch(`${API_URL}/api/auth/csrf/`, { credentials: "include" });
  const body = await response.json().catch(() => ({})) as { csrfToken?: string };
  if (!response.ok || !body.csrfToken) throw new Error(responseError(body, `Unable to initialize security (${response.status}).`));
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
    const body = await response.json().catch(() => ({}));
    throw new Error(responseError(body, `The request could not be completed (${response.status}).`));
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

const sourceNames: Record<string, string> = { META: "Meta Ads", WEBSITE: "Website", CARWALE: "CarWale", WALKIN: "Walk-in", CAMPAIGN: "Campaign", OTHER: "Other", UNKNOWN: "Unknown" };
const statusNames: Record<string, string> = { FRESH: "Fresh", RNR: "RNR", SWITCHED_OFF: "Switch off", CALLBACK: "Callback", QUALIFIED: "Qualified", UNQUALIFIED: "Unqualified", WALKIN: "Walk-in", WON: "Won", LOST: "Lost" };
const colors: Officer["color"][] = ["blue", "green", "violet", "orange"];

export const sourceName = (source: string) => sourceNames[source] || source;
export const statusName = (status: string) => statusNames[status] || status;
export const sourceClass = (source: string) => sourceName(source).toLowerCase().replaceAll(" ", "-");
export const toLead = (lead: ApiLead): Lead => ({ ...lead, source: sourceName(lead.source), sourceCode: lead.source, model: lead.model_interest || "—", enquiryDate: lead.enquiry_date, enquiredAt: formatDate(lead.enquiry_date || lead.created_at), statusCode: lead.status, status: statusName(lead.status), category: lead.category, salesOutcome: lead.sales_outcome, nextFollowUp: lead.next_follow_up, callCount: lead.call_count, assignedSoId: lead.assigned_so, assignedSoName: lead.assigned_so_name });
const toLeadDetail = (lead: ApiLead & { call_history: CallHistory[]; follow_up_history: FollowUpHistory[]; audit_history: LeadDetail["auditHistory"] }): LeadDetail => ({ ...toLead(lead), email: lead.email, sourceLabel: lead.source_label, campaign: lead.campaign, qualification: lead.qualification, callHistory: lead.call_history, followUpHistory: lead.follow_up_history, auditHistory: lead.audit_history });
export const toOfficer = (officer: ApiOfficer, metrics?: Metrics): Officer => ({ id: officer.id, name: `${officer.first_name} ${officer.last_name}`.trim() || officer.email, initials: `${officer.first_name[0] || ""}${officer.last_name[0] || ""}` || officer.email.slice(0, 2).toUpperCase(), color: colors[officer.id % colors.length], assigned: metrics?.total_assigned || 0, calls: metrics?.calls_today || 0, qualified: metrics?.qualified || 0, won: metrics?.won || 0 });

export async function getLeadsPage(query = "") { const data = await api<Paginated<ApiLead>>(`/api/leads/${query}`); return { count: data.count ?? data.results.length, next: data.next ?? null, previous: data.previous ?? null, results: data.results.map(toLead) }; }
export async function getLeads(query = "") { return (await getLeadsPage(query)).results; }
export async function getMyDashboard(params: Record<string, string>) { const query = new URLSearchParams(params).toString(); const data = await api<{ summary: SalesDashboard["summary"]; section: string; results: ApiLead[] }>(`/api/leads/my-dashboard/${query ? `?${query}` : ""}`); return { ...data, results: data.results.map(toLead) }; }
export async function getLeadDetail(id: number) { const data = await api<ApiLead & { call_history: CallHistory[]; follow_up_history: FollowUpHistory[]; audit_history: LeadDetail["auditHistory"] }>(`/api/leads/${id}/`); return toLeadDetail(data); }
export async function updateMyLead(id: number, payload: { name?: string; phone?: string; email?: string; source?: string; source_label?: string; campaign?: string; model_interest?: string; city?: string; branch?: string; enquiry_date?: string | null; status?: string; category?: string; sales_outcome?: string; remarks?: string; call_outcome?: string; follow_up_at?: string | null; qualification?: LeadQualification }) { const data = await api<ApiLead & { call_history: CallHistory[]; follow_up_history: FollowUpHistory[]; audit_history: LeadDetail["auditHistory"] }>(`/api/leads/${id}/so-update/`, { method: "PATCH", body: JSON.stringify(payload) }); return toLeadDetail(data); }
export const createLead = (payload: LeadInput) => api<ApiLead>("/api/leads/", { method: "POST", body: JSON.stringify(payload) });
export async function getOfficers() { const data = await api<Paginated<ApiOfficer>>("/api/auth/sales-officers/"); return data.results; }
export const getAdminAnalytics = () => api<Analytics>("/api/analytics/admin/");
export const getMyAnalytics = () => api<Metrics>("/api/analytics/me/");
export async function getMyAnalyticsDashboard(range = "mtd", dateFrom = "", dateTo = "") { const query = new URLSearchParams({ range, ...(dateFrom ? { date_from: dateFrom } : {}), ...(dateTo ? { date_to: dateTo } : {}) }).toString(); return api<PersonalAnalytics>(`/api/analytics/me/?${query}`); }
export async function exportMyAnalytics() { const response = await fetch(`${API_URL}/api/analytics/me/export/`, { credentials: "include" }); if (!response.ok) throw new Error("Analytics export could not be created."); const link = document.createElement("a"); link.href = URL.createObjectURL(await response.blob()); link.download = "revera-my-analytics.csv"; link.click(); URL.revokeObjectURL(link.href); }
export const assignLead = (leadId: number, officerId: number) => api<Lead>(`/api/leads/${leadId}/assign/`, { method: "POST", body: JSON.stringify({ sales_officer_id: officerId }) });
export const assignFilteredLeads = (officerId: number, filters: LeadFilters) => api<{ assigned: number }>("/api/leads/bulk-assign/", { method: "POST", body: JSON.stringify({ sales_officer_id: officerId, filters }) });
export const autoAssignLeads = () => api<{ assigned: number }>("/api/leads/auto-assign/", { method: "POST", body: JSON.stringify({}) });
export const logCall = (leadId: number, payload: { status: string; remarks?: string; follow_up_at?: string }) => api<Lead>(`/api/leads/${leadId}/log-call/`, { method: "POST", body: JSON.stringify(payload) });
export const login = (email: string, password: string) => api<{ user: CurrentUser }>("/api/auth/login/", { method: "POST", body: JSON.stringify({ email, password }) });
export const logout = () => api<void>("/api/auth/logout/", { method: "POST" });
export const getCurrentUser = () => api<{ user: CurrentUser }>("/api/auth/me/");
export const uploadLeads = (file: File) => { const body = new FormData(); body.append("file", file); return api<UploadBatch>("/api/uploads/", { method: "POST", body }); };
export const getUpload = (id: number, includeRows = false) => api<UploadBatch>(`/api/uploads/${id}/${includeRows ? "?include_rows=true" : ""}`);
export const resolveUploadDuplicates = (id: number, rows: { id: number; resolution: "SKIP" }[]) => api<{ detail: string; duplicates_found: number }>(`/api/uploads/${id}/resolve-duplicates/`, { method: "POST", body: JSON.stringify({ rows }) });
export const commitUpload = (id: number) => api<{ created: number; overwritten: number; skipped: number }>(`/api/uploads/${id}/commit/`, { method: "POST", body: JSON.stringify({}) });
export type UploadRow = { id: number; row_number: number; data: { name?: string }; normalized_phone: string; validation_error: string; duplicate_of: number | null; existing_name: string; existing_status: string; resolution: "PENDING" | "SKIP" | "OVERWRITE" | "IMPORT" };
export type UploadBatch = { id: number; status: "PARSING" | "READY" | "COMMITTED" | "FAILED"; total_rows: number; parsed_ok: number; duplicates_found: number; skipped: number; error_message: string; rows?: UploadRow[] };
