"use client";

import { useCallback, useEffect, useState } from "react";
import { getLeadDetail, getMyDashboard, updateMyLead, type LeadDetail, type LeadQualification, type SalesDashboard } from "@/lib/crm";

type Section = "fresh" | "followups" | "pending" | "qualified" | "walkin" | "won_lost";
type FreshSubfilter = "untouched" | "called" | "scheduled";
type Draft = {
  status: string; category: string; sales_outcome: string; call_outcome: string; remarks: string; follow_up_at: string;
  model_interest: string; city: string; profession: string; custom_location: string; lost_reason: string; pending_reason: string; trade_in_note: string;
  qualification: LeadQualification;
};
type LeadFields = { name: string; phone: string; email: string; source: string; source_label: string; campaign: string; model_interest: string; city: string; branch: string; enquiry_date: string | null };

const sections: { key: Section; label: string; count: keyof SalesDashboard["summary"]; icon: string }[] = [
  { key: "fresh", label: "Fresh leads", count: "fresh", icon: "✦" },
  { key: "followups", label: "Follow-ups", count: "followups", icon: "◷" },
  { key: "pending", label: "Pending leads", count: "pending", icon: "!" },
  { key: "qualified", label: "Qualified leads", count: "qualified", icon: "◎" },
  { key: "walkin", label: "Walk-in leads", count: "walkin", icon: "↗" },
  { key: "won_lost", label: "Won / lost", count: "won_lost", icon: "◇" },
];
const statusLabels: Record<string, string> = { FRESH: "Fresh", RNR: "RNR", SWITCHED_OFF: "Switch off", CALLBACK: "Callback", PENDING: "Pending", QUALIFIED: "Qualified", UNQUALIFIED: "Unqualified", WALKIN: "Walk-in", WON: "Won", LOST: "Lost" };
const outcomeLabels: Record<string, string> = { QUALIFIED: "Qualified", LOST: "Lost", PENDING: "Pending" };
const statusOptions: Record<string, string[]> = { QUALIFIED: ["QUALIFIED"], LOST: ["LOST"], PENDING: ["PENDING"] };
const sourceOptions = [{ value: "META", label: "Meta Ads" }, { value: "WEBSITE", label: "Website" }, { value: "CARWALE", label: "CarWale" }, { value: "WALKIN", label: "Walk-in" }, { value: "CAMPAIGN", label: "Campaign" }, { value: "OTHER", label: "Other" }, { value: "UNKNOWN", label: "Unknown" }];
const modelOptions = ["R6 GT", "R7 City", "R8 Lite", "R8 Pro", "R9 Plus"];
const variantOptions = ["R8 Pro", "R8 Lite", "R7 City", "R6 GT"];
const professionOptions = ["Salaried", "Business", "Self Employed", "Doctor", "Govt Employee"];
const locationOptions = ["Kochi", "Kozhikode", "Kadar", "Thrissur", "Trivandrum", "Kannur"];
const buyingPlanOptions = ["Immediate", "1–2 Months", "2–3 Months", "Greater than 3 months"];
const financeOptions = ["Inhouse", "Outright"];
const testDriveOptions = ["No", "Home Test Drive", "Showroom visit"];
const tradeInOptions = ["Yes", "Additional", "Buying for first time"];
const lostReasons = ["Invalid Number", "Wrong Number", "Just enquired", "Service", "Insurance", "Internal", "Used car", "No Response", "Mock Call", "Plan Dropped", "DSA Enq", "BH Registration", "Existing Enq", "Duplicate Lead", "Not interested", "Did not enquire", "Lost to co-dealer", "Lost to competition", "Low Budget", "Out of Territory", "Not Eligible", "Job Enquiry"];
const pendingReasons = ["RNR", "DND", "Not Reachable", "Switched Off", "Busy", "Disconnecting the call", "Temporary out of Service", "Call me back", "Incoming call facility not available", "Out of Network", "Plan Postponed"];
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

const minimumFollowUpDay = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return localDateTimeValue(date).slice(0, 10);
};

const followUpIso = (value: string) => value ? new Date(`${value}T09:00:00`).toISOString() : null;

function progressState(callCount: number, index: number) {
  const currentStep = Math.min(callCount, 4);
  return index < currentStep ? "done" : index === currentStep ? "current" : "locked";
}

function draftFor(lead: LeadDetail): Draft {
  const { updated_at: _updatedAt, ...qualification } = lead.qualification || emptyQualification();
  const latestOutcome = lead.callHistory[0]?.outcome;
  const call_outcome = ["PENDING", "QUALIFIED", "LOST"].includes(latestOutcome || "") ? latestOutcome : lead.statusCode === "PENDING" ? "PENDING" : lead.statusCode === "QUALIFIED" ? "QUALIFIED" : lead.statusCode === "LOST" ? "LOST" : "";
  return { status: lead.statusCode, category: lead.category || "WARM", sales_outcome: lead.salesOutcome || "PENDING", call_outcome, remarks: "", follow_up_at: "", model_interest: lead.model === "—" ? "" : lead.model, city: lead.city, profession: "", custom_location: "", lost_reason: "", pending_reason: "", trade_in_note: "", qualification };
}

function leadFieldsFor(lead: LeadDetail): LeadFields {
  return { name: lead.name, phone: lead.phone, email: lead.email, source: lead.sourceCode, source_label: lead.sourceLabel, campaign: lead.campaign, model_interest: lead.model === "—" ? "" : lead.model, city: lead.city, branch: lead.branch, enquiry_date: lead.enquiryDate };
}

function ChoiceRow({ options, value, onChange }: { options: string[]; value: string; onChange: (value: string) => void }) {
  return <div className="sales-choice-row">{options.map(option => <button type="button" className={value === option ? "chosen" : ""} onClick={() => onChange(option)} key={option}>{option}</button>)}</div>;
}

function LeadEditPanel({ fields, onChange, onClose, onSave, saving }: { fields: LeadFields; onChange: (fields: LeadFields) => void; onClose: () => void; onSave: () => void; saving: boolean }) {
  const update = (field: keyof LeadFields, value: string | null) => onChange({ ...fields, [field]: value });
  return <div className="modal-layer sales-edit-layer" role="presentation"><section className="modal sales-detail-modal sales-edit-modal" role="dialog" aria-modal="true" aria-labelledby="sales-edit-title"><header className="sales-detail-header"><div><p className="eyebrow">CUSTOMER INFORMATION</p><h2 id="sales-edit-title">Edit lead details</h2><p className="subtext">Update the customer record saved in Revera.</p></div><button className="modal-close" onClick={onClose} aria-label="Close">×</button></header><div className="sales-detail-scroll"><section className="sales-form-card"><div className="sales-form-grid"><label>Full name<input required value={fields.name} onChange={event => update("name", event.target.value)} /></label><label>Phone number<input required type="tel" inputMode="numeric" pattern="[0-9]{10}" maxLength={10} value={fields.phone} onChange={event => update("phone", event.target.value.replace(/\D/g, "").slice(0, 10))} /></label><label>Email<input type="email" value={fields.email} onChange={event => update("email", event.target.value)} /></label><label>Lead source<select value={fields.source} onChange={event => update("source", event.target.value)}>{sourceOptions.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label><label>Source detail<input value={fields.source_label} onChange={event => update("source_label", event.target.value)} /></label><label>Campaign<input value={fields.campaign} onChange={event => update("campaign", event.target.value)} /></label><label>Vehicle / model<input list="vehicle-edit-options" value={fields.model_interest} onChange={event => update("model_interest", event.target.value)} /><datalist id="vehicle-edit-options">{modelOptions.map(model => <option value={model} key={model} />)}</datalist></label><label>City<input value={fields.city} onChange={event => update("city", event.target.value)} /></label><label>Branch<input value={fields.branch} onChange={event => update("branch", event.target.value)} /></label><label>Enquiry date<input type="date" max={localDateTimeValue(new Date()).slice(0, 10)} value={fields.enquiry_date || ""} onChange={event => update("enquiry_date", event.target.value || null)} /></label></div></section></div><footer className="sales-detail-footer"><button className="filter" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving || !fields.name.trim() || fields.phone.length !== 10} onClick={onSave}>{saving ? "Saving…" : "Save details"}</button></footer></section></div>;
}

export function SalesWorkspace({ followUpsOnly = false }: { followUpsOnly?: boolean }) {
  const [section, setSection] = useState<Section>(followUpsOnly ? "followups" : "fresh");
  const [freshSubfilter, setFreshSubfilter] = useState<FreshSubfilter>("untouched");
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
    try { setDashboard(await getMyDashboard({ section, range, ...(section === "fresh" ? { subfilter: freshSubfilter } : {}), ...(category ? { category } : {}), ...(source ? { source } : {}), ...(query ? { q: query } : {}) })); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to load your leads."); }
    finally { setLoading(false); }
  }, [category, freshSubfilter, query, range, section, source]);

  useEffect(() => { const timer = window.setTimeout(() => void loadDashboard(), query ? 250 : 0); return () => window.clearTimeout(timer); }, [loadDashboard, query]);

  const openLead = async (lead: { id: number }) => {
    setDetailLoading(true); setError("");
    try { const fullLead = await getLeadDetail(lead.id); setDetail(fullLead); setDraft(draftFor(fullLead)); setLeadFields(leadFieldsFor(fullLead)); setEditingLead(false); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to open this lead."); }
    finally { setDetailLoading(false); }
  };

  const save = async () => {
    if (!detail || !draft || saving) return;
    if (!draft.call_outcome) return setNotice("Choose Qualified, Lost, or Pending.");
    if (draft.call_outcome === "QUALIFIED" && (!draft.model_interest || !draft.qualification.variant || !draft.qualification.buying_timeline || !draft.qualification.finance_type || !draft.qualification.notes.trim())) return setNotice("Complete model, variant, buying plan, finance, and qualification notes.");
    if (draft.call_outcome === "LOST" && (!draft.lost_reason || !draft.remarks.trim())) return setNotice("Choose a lost reason and add remarks.");
    if (draft.call_outcome === "PENDING" && (!draft.pending_reason || !draft.remarks.trim() || !draft.follow_up_at)) return setNotice("Choose a pending reason, add remarks, and set follow-up date.");
    const followUpAt = draft.call_outcome === "PENDING" ? followUpIso(draft.follow_up_at) : null;
    if (draft.call_outcome === "PENDING" && (!followUpAt || new Date(followUpAt).getTime() <= Date.now())) return setNotice("Choose a future follow-up date.");

    setSaving(true); setError("");
    try {
      const notes = ["Qualified lead", draft.profession && `Profession: ${draft.profession}`, (draft.city || draft.custom_location) && `Location: ${draft.custom_location || draft.city}`, draft.trade_in_note && `Trade in: ${draft.trade_in_note}`, draft.qualification.notes.trim()].filter(Boolean).join("\n");
      const remarks = draft.call_outcome === "LOST" ? `Lost reason: ${draft.lost_reason}\n${draft.remarks}` : draft.call_outcome === "PENDING" ? `Pending reason: ${draft.pending_reason}\n${draft.remarks}` : draft.qualification.notes;
      const updated = await updateMyLead(detail.id, {
        call_outcome: draft.call_outcome,
        status: statusOptions[draft.call_outcome][0],
        category: draft.category,
        sales_outcome: draft.call_outcome === "LOST" ? "LOST" : "PENDING",
        remarks,
        follow_up_at: followUpAt,
        model_interest: draft.call_outcome === "QUALIFIED" ? draft.model_interest : undefined,
        city: draft.call_outcome === "QUALIFIED" ? draft.custom_location || draft.city : undefined,
        qualification: draft.call_outcome === "QUALIFIED" ? { ...draft.qualification, trade_in: draft.trade_in_note === "Yes" ? true : draft.trade_in_note ? false : null, notes } : undefined,
      });
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
  const selectCallOutcome = (call_outcome: string) => setDraft(current => current ? { ...current, call_outcome, status: statusOptions[call_outcome]?.[0] || "", follow_up_at: "" } : current);
  const choose = <K extends keyof Draft>(field: K, value: Draft[K]) => setDraft(current => current ? { ...current, [field]: value } : current);
  const chooseQualification = (field: keyof LeadQualification, value: string | boolean | null) => setDraft(current => current ? { ...current, qualification: { ...current.qualification, [field]: value } } : current);
  const submitLabel = draft?.call_outcome === "QUALIFIED" ? "Qualify Lead" : draft?.call_outcome === "LOST" ? "Mark as Lost" : draft?.call_outcome === "PENDING" ? "Mark as Pending" : "Save follow-up";

  return <section className="page sales-workspace">
    <div className="sales-hero"><div><p className="eyebrow">MY WORKSPACE</p><h1>My queue</h1><p className="subtext">Today, {new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date())}</p></div><div className="sales-hero-actions"><button className="filter" onClick={() => void loadDashboard()}>↻ Refresh</button><a className="button primary" href="/my-analytics">View analytics →</a></div></div>
    <section className="sales-hero-banner"><div><p className="eyebrow">THE NEXT MOVE</p><h2>Every lead deserves a next move.</h2><p>Stay on top of your queue and guide every customer to their perfect ride.</p></div><div className="sales-hero-art" aria-hidden="true"><span>REVERA</span><i>↗</i></div></section>
    <section className="sales-metrics">{[{label:"Fresh leads", value:summary?.fresh ?? 0, tone:"blue"}, {label:"Follow-ups", value:summary?.followups ?? 0, tone:"yellow"}, {label:"Pending leads", value:summary?.pending ?? 0, tone:"orange"}, {label:"Qualified leads", value:summary?.qualified ?? 0, tone:"green"}, {label:"Won leads", value:summary?.won ?? 0, tone:"mint"}, {label:"Lost leads", value:summary?.lost ?? 0, tone:"red"}].map(metric => <article className={`sales-metric ${metric.tone}`} key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong><small>Assigned to you</small></article>)}</section>
    <nav className="sales-tabs" aria-label="Lead status views">{sections.map(item => <button key={item.key} className={section === item.key ? "active" : ""} onClick={() => setSection(item.key)}><i>{item.icon}</i><span>{item.label}</span><b>{summary?.[item.count] ?? 0}</b></button>)}</nav>
    <section className="panel sales-table-panel"><header className="sales-table-heading"><div><p className="eyebrow">{sections.find(item => item.key === section)?.label.toUpperCase()}</p><h2>{loading ? "Loading your pipeline…" : `${dashboard?.results.length ?? 0} leads in this view`}</h2></div><div className="sales-filters"><select aria-label="Date range" value={range} onChange={event => setRange(event.target.value)}><option value="all">All time</option><option value="today">Today</option><option value="mtd">Month to date</option></select><select aria-label="Lead category" value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option><option value="HOT">Hot</option><option value="WARM">Warm</option><option value="COLD">Cold</option></select><select aria-label="Lead source" value={source} onChange={event => setSource(event.target.value)}><option value="">All sources</option><option value="META">Meta Ads</option><option value="WEBSITE">Website</option><option value="CARWALE">CarWale</option><option value="CAMPAIGN">Campaign</option><option value="OTHER">Other</option></select><label className="sales-search">⌕<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name, phone, model" /></label></div></header><div className="sales-subfilters">{section === "fresh" ? <><button className={freshSubfilter === "untouched" ? "selected" : ""} onClick={() => setFreshSubfilter("untouched")}>✦ Untouched <b>{summary?.untouched ?? 0}</b></button><button className={freshSubfilter === "called" ? "selected" : ""} onClick={() => setFreshSubfilter("called")}>☎ Called <b>{summary?.called ?? 0}</b></button><button className={freshSubfilter === "scheduled" ? "selected" : ""} onClick={() => setFreshSubfilter("scheduled")}>◷ Follow-up <b>{summary?.scheduled ?? 0}</b></button></> : section === "pending" ? <><span>Lead category</span><button className={!category ? "selected" : ""} onClick={() => setCategory("")}>All</button><button className={category === "HOT" ? "selected hot" : "hot"} onClick={() => setCategory("HOT")}>Hot</button><button className={category === "WARM" ? "selected warm" : "warm"} onClick={() => setCategory("WARM")}>Warm</button><button className={category === "COLD" ? "selected cold" : "cold"} onClick={() => setCategory("COLD")}>Cold</button></> : <span>{summary?.total ?? 0} assigned leads in your workspace</span>}</div><div className="sales-table-scroll"><table className="sales-table"><thead><tr><th>Action</th><th>Status</th><th>Customer name</th><th>Mobile no.</th><th>Source</th></tr></thead><tbody>{loading ? <tr><td colSpan={5} className="sales-empty">Loading…</td></tr> : dashboard?.results.length ? dashboard.results.map(lead => <tr key={lead.id} onClick={() => void openLead(lead)}><td><button className="sales-row-action" onClick={event => { event.stopPropagation(); void openLead(lead); }}>↗ Open</button></td><td><span className={`sales-status ${lead.statusCode.toLowerCase()}`}>{lead.status}</span></td><td><b>{lead.name}</b><small>#{String(lead.id).padStart(6, "0")}</small></td><td>{lead.phone}</td><td>{lead.source}</td></tr>) : <tr><td colSpan={5} className="sales-empty"><strong>No leads in this view.</strong><span>New assignments and follow-ups will appear here automatically.</span></td></tr>}</tbody></table></div></section>

    {editingLead && leadFields && <LeadEditPanel fields={leadFields} onChange={setLeadFields} onClose={() => setEditingLead(false)} onSave={() => void saveLeadFields()} saving={saving} />}
    {notice && <div className="toast" role="status">{notice}<button aria-label="Dismiss" onClick={() => setNotice("")}>×</button></div>}
    {detailLoading && <div className="modal-layer"><section className="modal sales-loading-modal"><span className="sales-spinner" /><p>Opening lead history…</p></section></div>}
    {detail && draft && <div className="modal-layer" role="presentation"><section className="modal sales-detail-modal" role="dialog" aria-modal="true" aria-labelledby="sales-detail-title">
      <header className="sales-detail-header"><div><p className="eyebrow">LEAD DETAIL · #{String(detail.id).padStart(6, "0")}</p><h2 id="sales-detail-title">Update {detail.name}</h2><p className="subtext">Customer information and call history.</p></div><button className="modal-close" onClick={() => setDetail(null)} aria-label="Close">×</button></header>
      <div className="sales-detail-scroll">
        {error && <p className="form-error" role="alert">{error}</p>}
        <section className="sales-info-card"><h3>Customer information <button type="button" className="row-action" onClick={() => { setLeadFields(leadFieldsFor(detail)); setEditingLead(true); }}>Edit fields</button></h3><div className="sales-info-grid"><span><small>Name</small><b>{detail.name}</b></span><span><small>Phone</small><b>{detail.phone}</b></span><span><small>Email</small><b>{detail.email || "—"}</b></span><span><small>Source</small><b>{detail.source}</b></span><span><small>Source detail</small><b>{detail.sourceLabel || "—"}</b></span><span><small>Model</small><b>{detail.model}</b></span><span><small>City</small><b>{detail.city || "—"}</b></span><span><small>Enquiry date</small><b>{detail.enquiredAt}</b></span><span><small>Campaign</small><b>{detail.campaign || "—"}</b></span><span><small>Branch</small><b>{detail.branch || "—"}</b></span></div><div className="sales-detail-meta"><span>Category <b className={`category-pill ${draft.category.toLowerCase()}`}>{draft.category}</b></span><span>Calls <b>{detail.callCount}</b></span></div></section>
        <section className="sales-form-card sales-outcome-card"><h3>Lead Status Update</h3><div className="sales-stepper">{["F1", "F2", "F3", "F4", "F5"].map((step, index) => <span className={progressState(detail.callCount, index)} key={step}>{index < Math.min(detail.callCount, 4) ? "✓" : index === Math.min(detail.callCount, 4) ? "○" : "▣"} {step}</span>)}</div><div className="sales-choice-row sales-status-update">{Object.entries(outcomeLabels).map(([value, label]) => <button type="button" className={draft.call_outcome === value ? `chosen ${value.toLowerCase()}` : value.toLowerCase()} onClick={() => selectCallOutcome(value)} key={value}>{value === "QUALIFIED" ? "✓" : value === "LOST" ? "×" : "◷"} {label}</button>)}</div></section>

        {draft.call_outcome === "QUALIFIED" && <section className="sales-outcome-grid">
          <article className="sales-branch-card"><h3>Model Interested</h3><label>Vehicle model *<select value={draft.model_interest} onChange={event => choose("model_interest", event.target.value)}><option value="">Select model</option>{modelOptions.map(model => <option value={model} key={model}>{model}</option>)}</select></label></article>
          <article className="sales-branch-card"><h3>Variant</h3><label>Variant *<select value={draft.qualification.variant} onChange={event => chooseQualification("variant", event.target.value)}><option value="">Select Variant</option>{variantOptions.map(option => <option value={option} key={option}>{option}</option>)}</select></label></article>
          <article className="sales-branch-card"><h3>Customer Details</h3><label>Profession</label><ChoiceRow options={professionOptions} value={draft.profession} onChange={value => choose("profession", value)} /><label>Location<select value={draft.city} onChange={event => choose("city", event.target.value)}><option value="">Select location</option>{locationOptions.map(option => <option value={option} key={option}>{option}</option>)}</select></label><input value={draft.custom_location} onChange={event => choose("custom_location", event.target.value)} placeholder="Or type a custom location" /></article>
          <article className="sales-branch-card"><h3>Purchase Planning</h3><label>Buying Plan *</label><ChoiceRow options={buyingPlanOptions} value={draft.qualification.buying_timeline} onChange={value => chooseQualification("buying_timeline", value)} /></article>
          <article className="sales-branch-card"><h3>Finance Options</h3><label>Finance Option *</label><ChoiceRow options={financeOptions} value={draft.qualification.finance_type} onChange={value => chooseQualification("finance_type", value)} /></article>
          <article className="sales-branch-card"><h3>Test Drive</h3><label>Test Drive Type</label><ChoiceRow options={testDriveOptions} value={draft.qualification.test_drive} onChange={value => chooseQualification("test_drive", value)} /></article>
          <article className="sales-branch-card"><h3>Trade In</h3><label>Trade In</label><ChoiceRow options={tradeInOptions} value={draft.trade_in_note} onChange={value => choose("trade_in_note", value)} /></article>
          <article className="sales-branch-card"><h3>Qualification Notes</h3><label>Remarks *<textarea value={draft.qualification.notes} onChange={event => chooseQualification("notes", event.target.value)} placeholder="Add qualification notes" /></label></article>
          <article className="sales-branch-card"><h3>Lead Category</h3><label>Lead Category</label><ChoiceRow options={["HOT", "WARM", "COLD"]} value={draft.category} onChange={value => choose("category", value)} /></article>
        </section>}

        {draft.call_outcome === "LOST" && <section className="sales-branch-card sales-single-branch lost"><h3>Lead Lost Reason</h3><label>Reason for Loss</label><ChoiceRow options={lostReasons} value={draft.lost_reason} onChange={value => choose("lost_reason", value)} /><label>Remarks *<textarea value={draft.remarks} onChange={event => choose("remarks", event.target.value)} placeholder="Add reason/remark for loss" /></label><p className="sales-warning">△ Lead will be marked as lost and moved to won/lost leads section after update.</p></section>}

        {draft.call_outcome === "PENDING" && <section className="sales-outcome-grid">
          <article className="sales-branch-card sales-single-branch"><h3>Pending Reason</h3><label>Pending Status</label><ChoiceRow options={pendingReasons} value={draft.pending_reason} onChange={value => choose("pending_reason", value)} /><label>Remark for Pending Reason *<textarea value={draft.remarks} onChange={event => choose("remarks", event.target.value)} placeholder="Enter detailed remark for this pending reason..." /></label></article>
          <article className="sales-branch-card sales-single-branch"><h3>Follow Up Details</h3><label>Follow Up Date *<input type="date" min={minimumFollowUpDay()} value={draft.follow_up_at} onChange={event => choose("follow_up_at", event.target.value)} /></label><small>Lead will be moved to the correct follow-up section after update.</small></article>
        </section>}

        <section className="sales-history"><h3>History</h3>{detail.callHistory.length ? detail.callHistory.map(call => <div className="sales-history-row" key={`call-${call.id}`}><span className="history-dot" /><div><b>{outcomeLabels[call.outcome] || statusLabels[call.status] || call.status}</b><small>{call.remarks || "No remarks"} · {call.so_name || "You"}</small></div><time>{formatFollowUp(call.created_at)}</time></div>) : <p className="subtext">No calls recorded yet.</p>}{detail.followUpHistory.length ? detail.followUpHistory.map(followUp => <div className="sales-history-row" key={`follow-${followUp.id}`}><span className="history-dot follow" /><div><b>Follow-up {followUp.resolved_at ? "completed" : "scheduled"}</b><small>{formatFollowUp(followUp.scheduled_for)}</small></div><time>{followUp.resolved_at ? "Resolved" : "Open"}</time></div>) : null}</section>
      </div>
      <footer className="sales-detail-footer"><button className="filter" onClick={() => setDetail(null)}>Close</button><button className={`button primary ${draft.call_outcome.toLowerCase()}`} disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : submitLabel}</button></footer>
    </section></div>}
  </section>;
}
