"use client";

import { useCallback, useEffect, useState } from "react";
import { getLeadDetail, getMyDashboard, updateMyLead, type Lead, type LeadDetail, type LeadQualification, type SalesDashboard } from "@/lib/crm";

type Section = "fresh" | "followups" | "pending" | "qualified" | "walkin" | "won_lost";
type Draft = { status: string; category: string; sales_outcome: string; call_outcome: string; remarks: string; follow_up_at: string; qualification: LeadQualification };
type LeadFields = { name: string; phone: string; email: string; source: string; source_label: string; campaign: string; model_interest: string; city: string; branch: string; enquiry_date: string | null };

const sections: { key: Section; label: string; count: keyof SalesDashboard["summary"]; icon: string }[] = [
  { key: "fresh", label: "Fresh leads", count: "fresh", icon: "✦" },
  { key: "followups", label: "Follow-ups", count: "followups", icon: "◷" },
  { key: "pending", label: "Pending leads", count: "pending", icon: "!" },
  { key: "qualified", label: "Qualified leads", count: "qualified", icon: "◎" },
  { key: "walkin", label: "Walk-in leads", count: "walkin", icon: "↗" },
  { key: "won_lost", label: "Won / lost", count: "won_lost", icon: "◇" },
];
const statusLabels: Record<string, string> = { FRESH: "Fresh", RNR: "RNR", SWITCHED_OFF: "Switch off", CALLBACK: "Callback", QUALIFIED: "Qualified", UNQUALIFIED: "Unqualified", WALKIN: "Walk-in", WON: "Won", LOST: "Lost" };
const outcomeLabels: Record<string, string> = { CONNECTED: "Connected", NOT_CONNECTED: "Not connected" };
const callOutcomeLabels: Record<string, string> = { ...outcomeLabels, QUALIFIED: "Connected", PENDING: "Connected", LOST: "Connected" };
const statusOptions: Record<string, string[]> = { CONNECTED: ["CALLBACK", "QUALIFIED", "UNQUALIFIED"], NOT_CONNECTED: ["RNR", "SWITCHED_OFF"] };
const sourceOptions = [{ value: "META", label: "Meta Ads" }, { value: "WEBSITE", label: "Website" }, { value: "CARWALE", label: "CarWale" }, { value: "WALKIN", label: "Walk-in" }, { value: "CAMPAIGN", label: "Campaign" }, { value: "OTHER", label: "Other" }, { value: "UNKNOWN", label: "Unknown" }];
const modelOptions = ["R6 GT", "R7 City", "R8 Lite", "R8 Pro", "R9 Plus"];
const emptyQualification = (): LeadQualification => ({ variant: "", buying_timeline: "", finance_type: "", trade_in: null, test_drive: "", notes: "" });

function formatFollowUp(value: string | null) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Invalid date" : new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

const localDateTimeValue = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

function minimumFollowUpDate() {
  const date = new Date();
  date.setSeconds(0, 0);
  date.setMinutes(date.getMinutes() + 1);
  return localDateTimeValue(date);
}

const followUpStatuses = new Set(["CALLBACK", "WALKIN"]);

function progressState(callCount: number, index: number) {
  const currentStep = Math.min(callCount, 4);
  return index < currentStep ? "done" : index === currentStep ? "current" : "locked";
}

function draftFor(lead: LeadDetail): Draft {
  const { updated_at: _updatedAt, ...qualification } = lead.qualification || emptyQualification();
  const latestOutcome = lead.callHistory[0]?.outcome;
  const call_outcome = latestOutcome === "NOT_CONNECTED" ? "NOT_CONNECTED" : latestOutcome === "CONNECTED" || ["CALLBACK", "QUALIFIED", "UNQUALIFIED"].includes(lead.statusCode) ? "CONNECTED" : ["RNR", "SWITCHED_OFF"].includes(lead.statusCode) ? "NOT_CONNECTED" : "";
  return { status: lead.statusCode, category: lead.category || "WARM", sales_outcome: lead.salesOutcome || "PENDING", call_outcome, remarks: "", follow_up_at: "", qualification };
}

function leadFieldsFor(lead: LeadDetail): LeadFields {
  return { name: lead.name, phone: lead.phone, email: lead.email, source: lead.sourceCode, source_label: lead.sourceLabel, campaign: lead.campaign, model_interest: lead.model === "—" ? "" : lead.model, city: lead.city, branch: lead.branch, enquiry_date: lead.enquiryDate };
}

function LeadEditPanel({ fields, onChange, onClose, onSave, saving }: { fields: LeadFields; onChange: (fields: LeadFields) => void; onClose: () => void; onSave: () => void; saving: boolean }) {
  const update = (field: keyof LeadFields, value: string | null) => onChange({ ...fields, [field]: value });
  return <div className="modal-layer sales-edit-layer" role="presentation"><section className="modal sales-detail-modal sales-edit-modal" role="dialog" aria-modal="true" aria-labelledby="sales-edit-title"><header className="sales-detail-header"><div><p className="eyebrow">CUSTOMER INFORMATION</p><h2 id="sales-edit-title">Edit lead details</h2><p className="subtext">Update the customer record saved in Revera.</p></div><button className="modal-close" onClick={onClose} aria-label="Close">×</button></header><div className="sales-detail-scroll"><section className="sales-form-card"><div className="sales-form-grid"><label>Full name<input required value={fields.name} onChange={event => update("name", event.target.value)} /></label><label>Phone number<input required type="tel" inputMode="numeric" pattern="[0-9]{10}" maxLength={10} value={fields.phone} onChange={event => update("phone", event.target.value.replace(/\D/g, "").slice(0, 10))} /></label><label>Email<input type="email" value={fields.email} onChange={event => update("email", event.target.value)} /></label><label>Lead source<select value={fields.source} onChange={event => update("source", event.target.value)}>{sourceOptions.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label>Source detail<input value={fields.source_label} onChange={event => update("source_label", event.target.value)} /></label><label>Campaign<input value={fields.campaign} onChange={event => update("campaign", event.target.value)} /></label><label>Vehicle / model<input list="vehicle-edit-options" value={fields.model_interest} onChange={event => update("model_interest", event.target.value)} /><datalist id="vehicle-edit-options">{modelOptions.map(model => <option value={model} key={model} />)}</datalist></label><label>City<input value={fields.city} onChange={event => update("city", event.target.value)} /></label><label>Branch<input value={fields.branch} onChange={event => update("branch", event.target.value)} /></label><label>Enquiry date<input type="date" max={localDateTimeValue(new Date()).slice(0, 10)} value={fields.enquiry_date || ""} onChange={event => update("enquiry_date", event.target.value || null)} /></label></div></section></div><footer className="sales-detail-footer"><button className="filter" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving || !fields.name.trim() || fields.phone.length !== 10} onClick={onSave}>{saving ? "Saving…" : "Save details"}</button></footer></section></div>;
}

export function SalesWorkspace({ followUpsOnly = false }: { followUpsOnly?: boolean }) {
  const [section, setSection] = useState<Section>(followUpsOnly ? "followups" : "fresh");
  const [range, setRange] = useState("all");
  const [category, setCategory] = useState("");
  const [source, setSource] = useState("");
  const [query, setQuery] = useState("");
  const [dashboard, setDashboard] = useState<SalesDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [editingLead, setEditingLead] = useState(false);
  const [leadFields, setLeadFields] = useState<LeadFields | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true); setError("");
    try { setDashboard(await getMyDashboard({ section, range, ...(category ? { category } : {}), ...(source ? { source } : {}), ...(query ? { q: query } : {}) })); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to load your leads."); }
    finally { setLoading(false); }
  }, [category, query, range, section, source]);

  useEffect(() => { const timer = window.setTimeout(() => void loadDashboard(), query ? 250 : 0); return () => window.clearTimeout(timer); }, [loadDashboard, query]);

  const openLead = async (lead: Lead) => {
    setDetailLoading(true); setError("");
    try { const fullLead = await getLeadDetail(lead.id); setDetail(fullLead); setDraft(draftFor(fullLead)); setLeadFields(leadFieldsFor(fullLead)); setEditingLead(false); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to open this lead."); }
    finally { setDetailLoading(false); }
  };

  const save = async () => {
    if (!detail || !draft || saving) return;
    if (draft.call_outcome && !draft.status) {
      setNotice("Choose a lead status for this call outcome.");
      return;
    }
    const followUp = draft.follow_up_at ? new Date(draft.follow_up_at) : null;
    if (followUpStatuses.has(draft.status) && !followUp) {
      setNotice("Choose a follow-up date and time for this status.");
      return;
    }
    if (followUp && (Number.isNaN(followUp.getTime()) || followUp.getTime() <= Date.now())) {
      setNotice("Choose a future follow-up date and time.");
      return;
    }
    setSaving(true); setError("");
    try {
      const updated = await updateMyLead(detail.id, { ...draft, qualification: draft.status === "QUALIFIED" ? draft.qualification : undefined, follow_up_at: followUp ? followUp.toISOString() : null });
      setDetail(updated); setDraft(draftFor(updated)); setNotice("Lead updated and follow-up history saved."); await loadDashboard();
    } catch (requestError) { const message = requestError instanceof Error ? requestError.message : "Lead update could not be saved."; setError(message); setNotice(message); }
    finally { setSaving(false); }
  };

  const saveLeadFields = async () => {
    if (!detail || !leadFields || saving) return;
    setSaving(true); setError("");
    try {
      const updated = await updateMyLead(detail.id, leadFields);
      setDetail(updated); setLeadFields(leadFieldsFor(updated)); setEditingLead(false); setNotice("Customer details updated."); await loadDashboard();
    } catch (requestError) { const message = requestError instanceof Error ? requestError.message : "Customer details could not be saved."; setError(message); setNotice(message); }
    finally { setSaving(false); }
  };

  const summary = dashboard?.summary;
  const selectCallOutcome = (call_outcome: string) => setDraft(current => current ? { ...current, call_outcome, status: statusOptions[call_outcome]?.includes(current.status) ? current.status : "", follow_up_at: "" } : current);
  const selectStatus = (status: string) => setDraft(current => current ? { ...current, status, follow_up_at: status === "CALLBACK" ? current.follow_up_at : "" } : current);
  const selectSalesOutcome = (sales_outcome: string) => setDraft(current => current ? { ...current, sales_outcome } : current);

  return <section className="page sales-workspace">
    <div className="sales-hero"><div><p className="eyebrow">MY WORKSPACE</p><h1>My queue</h1><p className="subtext">Today, {new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date())}</p></div><div className="sales-hero-actions"><button className="filter" onClick={() => void loadDashboard()}>↻ Refresh</button><a className="button primary" href="/my-analytics">View analytics →</a></div></div>
    <section className="sales-hero-banner"><div><p className="eyebrow">THE NEXT MOVE</p><h2>Every lead deserves a next move.</h2><p>Stay on top of your queue and guide every customer to their perfect ride.</p></div><div className="sales-hero-art" aria-hidden="true"><span>REVERA</span><i>↗</i></div></section>
    <section className="sales-metrics">{[{label:"Fresh leads", value:summary?.fresh ?? 0, tone:"blue"}, {label:"Follow-ups", value:summary?.followups ?? 0, tone:"yellow"}, {label:"Pending leads", value:summary?.pending ?? 0, tone:"orange"}, {label:"Qualified leads", value:summary?.qualified ?? 0, tone:"green"}, {label:"Won leads", value:summary?.won ?? 0, tone:"mint"}, {label:"Lost leads", value:summary?.lost ?? 0, tone:"red"}].map(metric => <article className={`sales-metric ${metric.tone}`} key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong><small>Assigned to you</small></article>)}</section>
    <nav className="sales-tabs" aria-label="Lead status views">{sections.map(item => <button key={item.key} className={section === item.key ? "active" : ""} onClick={() => setSection(item.key)}><i>{item.icon}</i><span>{item.label}</span><b>{summary?.[item.count] ?? 0}</b></button>)}</nav>
    <section className="panel sales-table-panel"><header className="sales-table-heading"><div><p className="eyebrow">{sections.find(item => item.key === section)?.label.toUpperCase()}</p><h2>{loading ? "Loading your pipeline…" : `${dashboard?.results.length ?? 0} leads in this view`}</h2></div><div className="sales-filters"><select aria-label="Date range" value={range} onChange={event => setRange(event.target.value)}><option value="all">All time</option><option value="today">Today</option><option value="mtd">Month to date</option></select><select aria-label="Lead category" value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option><option value="HOT">Hot</option><option value="WARM">Warm</option><option value="COLD">Cold</option></select><select aria-label="Lead source" value={source} onChange={event => setSource(event.target.value)}><option value="">All sources</option><option value="META">Meta Ads</option><option value="WEBSITE">Website</option><option value="CARWALE">CarWale</option><option value="CAMPAIGN">Campaign</option><option value="OTHER">Other</option></select><label className="sales-search">⌕<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name, phone, model" /></label></div></header><div className="sales-subfilters">{section === "fresh" ? <><button className="selected">✦ Untouched <b>{summary?.untouched ?? 0}</b></button><button>☎ Called <b>{summary?.called ?? 0}</b></button><button>◷ Follow-up <b>{summary?.scheduled ?? 0}</b></button></> : section === "pending" ? <><span>Lead category</span><button className={!category ? "selected" : ""} onClick={() => setCategory("")}>All</button><button className={category === "HOT" ? "selected hot" : "hot"} onClick={() => setCategory("HOT")}>Hot</button><button className={category === "WARM" ? "selected warm" : "warm"} onClick={() => setCategory("WARM")}>Warm</button><button className={category === "COLD" ? "selected cold" : "cold"} onClick={() => setCategory("COLD")}>Cold</button></> : <span>{summary?.total ?? 0} assigned leads in your workspace</span>}</div><div className="sales-table-scroll"><table className="sales-table"><thead><tr><th>Action</th><th>Status</th><th>Customer name</th><th>Mobile no.</th><th>Source</th></tr></thead><tbody>{loading ? <tr><td colSpan={5} className="sales-empty">Loading…</td></tr> : dashboard?.results.length ? dashboard.results.map(lead => <tr key={lead.id} onClick={() => void openLead(lead)}><td><button className="sales-row-action" onClick={event => { event.stopPropagation(); void openLead(lead); }}>↗ Open</button></td><td><span className={`sales-status ${lead.statusCode.toLowerCase()}`}>{lead.status}</span></td><td><b>{lead.name}</b><small>#{String(lead.id).padStart(6, "0")}</small></td><td>{lead.phone}</td><td>{lead.source}</td><td>{lead.model}</td><td>{lead.campaign || "—"}</td><td>{lead.branch || "—"}</td></tr>) : <tr><td colSpan={10} className="sales-empty"><strong>No leads in this view.</strong><span>New assignments and follow-ups will appear here automatically.</span></td></tr>}</tbody></table></div></section>
    {editingLead && leadFields && <LeadEditPanel fields={leadFields} onChange={setLeadFields} onClose={() => setEditingLead(false)} onSave={() => void saveLeadFields()} saving={saving} />}
    {notice && <div className="toast" role="status">{notice}<button aria-label="Dismiss" onClick={() => setNotice("")}>×</button></div>}
    {detailLoading && <div className="modal-layer"><section className="modal sales-loading-modal"><span className="sales-spinner" /><p>Opening lead history…</p></section></div>}
    {detail && draft && <div className="modal-layer" role="presentation"><section className="modal sales-detail-modal" role="dialog" aria-modal="true" aria-labelledby="sales-detail-title"><header className="sales-detail-header"><div><p className="eyebrow">LEAD DETAIL · #{String(detail.id).padStart(6, "0")}</p><h2 id="sales-detail-title">Update {detail.name}</h2><p className="subtext">Customer information, qualification, and call history.</p></div><button className="modal-close" onClick={() => setDetail(null)} aria-label="Close">×</button></header><div className="sales-detail-scroll">{error && <p className="form-error" role="alert">{error}</p>}<section className="sales-info-card"><h3>Customer information <button type="button" className="row-action" onClick={() => { setLeadFields(leadFieldsFor(detail)); setEditingLead(true); }}>Edit fields</button></h3><div className="sales-info-grid"><span><small>Name</small><b>{detail.name}</b></span><span><small>Phone</small><b>{detail.phone}</b></span><span><small>Email</small><b>{detail.email || "—"}</b></span><span><small>Source</small><b>{detail.source}</b></span><span><small>Source detail</small><b>{detail.sourceLabel || "—"}</b></span><span><small>Model</small><b>{detail.model}</b></span><span><small>City</small><b>{detail.city || "—"}</b></span><span><small>Enquiry date</small><b>{detail.enquiredAt}</b></span><span><small>Campaign</small><b>{detail.campaign || "—"}</b></span><span><small>Branch</small><b>{detail.branch || "—"}</b></span></div><div className="sales-detail-meta"><span>Category <b className={`category-pill ${draft.category.toLowerCase()}`}>{draft.category}</b></span></div></section><section className="sales-form-card"><h3>Lead progress</h3><div className="sales-stepper">{["F1", "F2", "F3", "F4", "F5"].map((step, index) => <span className={progressState(detail.callCount, index)} key={step}>{index < Math.min(detail.callCount, 4) ? "✓" : index === Math.min(detail.callCount, 4) ? "○" : "▣"} {step}</span>)}</div><div className="sales-form-grid"><label>Next follow-up date<input type="datetime-local" min={minimumFollowUpDate()} step="60" value={draft.follow_up_at} onChange={event => setDraft({ ...draft, follow_up_at: event.target.value })} /></label><label>Call outcome<select value={draft.call_outcome} onChange={event => selectCallOutcome(event.target.value)}><option value="">Select outcome</option>{Object.entries(outcomeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div><label className="sales-full-label">Remarks<textarea value={draft.remarks} onChange={event => setDraft({ ...draft, remarks: event.target.value })} placeholder="Add call remarks for the next person who opens this lead." /></label>{draft.call_outcome && <><h4>Lead status</h4><div className="sales-choice-row">{statusOptions[draft.call_outcome].map(status => <button type="button" className={draft.status === status ? "chosen" : ""} onClick={() => selectStatus(status)} key={status}>{statusLabels[status]}</button>)}</div></>}<h4>Sales outcome</h4><div className="sales-choice-row sales-outcomes">{[["BOOKED", "Booked"], ["RETAILED", "Retailed"], ["LOST", "Lost"], ["PENDING", "Pending"]].map(([value, label]) => <button type="button" className={draft.sales_outcome === value ? "chosen" : ""} onClick={() => selectSalesOutcome(value)} key={value}>{label}</button>)}</div></section>{draft.status === "QUALIFIED" && <section className="sales-form-card"><h3>Qualification details</h3><div className="sales-form-grid"><label>Variant<input value={draft.qualification.variant} onChange={event => setDraft({ ...draft, qualification: { ...draft.qualification, variant: event.target.value } })} placeholder="Variant / trim" /></label><label>Buying timeline<select value={draft.qualification.buying_timeline} onChange={event => setDraft({ ...draft, qualification: { ...draft.qualification, buying_timeline: event.target.value } })}><option value="">Select timeline</option><option>Immediate</option><option>1–2 months</option><option>3–6 months</option><option>Just exploring</option></select></label><label>Finance<select value={draft.qualification.finance_type} onChange={event => setDraft({ ...draft, qualification: { ...draft.qualification, finance_type: event.target.value } })}><option value="">Select finance</option><option>In-house</option><option>Bank finance</option><option>Self funded</option></select></label><label>Trade-in<select value={draft.qualification.trade_in === null ? "" : String(draft.qualification.trade_in)} onChange={event => setDraft({ ...draft, qualification: { ...draft.qualification, trade_in: event.target.value === "" ? null : event.target.value === "true" } })}><option value="">Not discussed</option><option value="true">Yes</option><option value="false">No</option></select></label><label>Test drive<select value={draft.qualification.test_drive} onChange={event => setDraft({ ...draft, qualification: { ...draft.qualification, test_drive: event.target.value } })}><option value="">Not discussed</option><option>Requested</option><option>Completed</option><option>Not interested</option></select></label></div><label className="sales-full-label">Qualification notes<textarea value={draft.qualification.notes} onChange={event => setDraft({ ...draft, qualification: { ...draft.qualification, notes: event.target.value } })} /></label></section>}<section className="sales-history"><h3>History</h3>{detail.callHistory.length ? detail.callHistory.map(call => <div className="sales-history-row" key={`call-${call.id}`}><span className="history-dot" /><div><b>{callOutcomeLabels[call.outcome] || statusLabels[call.status] || call.status}</b><small>{call.remarks || "No remarks"} · {call.so_name || "You"}</small></div><time>{formatFollowUp(call.created_at)}</time></div>) : <p className="subtext">No calls recorded yet.</p>}{detail.followUpHistory.length ? detail.followUpHistory.map(followUp => <div className="sales-history-row" key={`follow-${followUp.id}`}><span className="history-dot follow" /><div><b>Follow-up {followUp.resolved_at ? "completed" : "scheduled"}</b><small>{formatFollowUp(followUp.scheduled_for)}</small></div><time>{followUp.resolved_at ? "Resolved" : "Open"}</time></div>) : null}</section></div><footer className="sales-detail-footer"><button className="filter" onClick={() => setDetail(null)}>Close</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save follow-up"}</button></footer></section></div>}
  </section>;
}
