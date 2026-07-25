"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { assignFilteredLeads, assignLead, autoAssignLeads, commitUpload, createLead, getAdminAnalytics, getLeadsPage, getOfficers, getUpload, logCall, resolveUploadDuplicates, sourceClass, toLead, toOfficer, type Lead, type LeadFilters, type LeadInput, type Officer, type UploadBatch, uploadLeads } from "@/lib/crm";
import { formatDate, parseDate, parseDateTime } from "@/lib/dates";

const nextOutcomes: Record<string, { label: string; value: string }[]> = {
  Fresh: [{ label: "No response", value: "RNR" }, { label: "Schedule callback", value: "CALLBACK" }, { label: "Interested / Qualified", value: "QUALIFIED" }, { label: "Not interested", value: "UNQUALIFIED" }],
  RNR: [{ label: "Schedule callback", value: "CALLBACK" }, { label: "Interested / Qualified", value: "QUALIFIED" }, { label: "Not interested", value: "UNQUALIFIED" }],
  Callback: [{ label: "No response", value: "RNR" }, { label: "Interested / Qualified", value: "QUALIFIED" }, { label: "Book walk-in", value: "WALKIN" }, { label: "Not interested", value: "UNQUALIFIED" }],
  Qualified: [{ label: "Book walk-in", value: "WALKIN" }, { label: "Won (Sold)", value: "WON" }, { label: "Lost", value: "LOST" }],
  "Walk-in": [{ label: "Won (Sold)", value: "WON" }, { label: "Lost", value: "LOST" }],
};

const sources = [["META", "Meta Ads"], ["WEBSITE", "Website"], ["CARWALE", "CarWale"], ["WALKIN", "Walk-in"], ["CAMPAIGN", "Campaign"], ["OTHER", "Other"], ["UNKNOWN", "Unknown"]];
const models = ["R6 GT", "R7 City", "R8 Lite", "R8 Pro", "R9 Plus"];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emptyLead = (): LeadInput => ({ name: "", phone: "", email: "", source: "OTHER", source_label: "", campaign: "", model_interest: "", city: "", enquiry_date: formatDate(new Date()) });
const leadQuery = (officerMode: boolean, followUpsOnly: boolean, filters: LeadFilters, page: number, search: string) => {
  const params = new URLSearchParams();
  if (officerMode) { if (followUpsOnly) params.set("status", "CALLBACK"); }
  else { params.set("unassigned", "true"); params.set("page", String(page)); Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); }); }
  if (search) params.set("q", search);
  return `?${params.toString()}`;
};

function LeadPagination({ page, total, loading, onPageChange }: { page: number; total: number; loading: boolean; onPageChange: (page: number) => void }) {
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const first = total ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(page * pageSize, total);
  return <nav className="lead-pagination" aria-label="Lead pages"><span>Showing {first}–{last} of {total} leads</span><div><button className="filter" disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page">‹</button><b>Page {page} of {totalPages}</b><button className="filter" disabled={loading || page >= totalPages} onClick={() => onPageChange(page + 1)} aria-label="Next page">›</button></div></nav>;
}

export function LeadDesk({ officerMode = false, followUpsOnly = false }: { officerMode?: boolean; followUpsOnly?: boolean }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [outcome, setOutcome] = useState("");
  const [remarks, setRemarks] = useState("");
  const [followUpAt, setFollowUpAt] = useState("");
  const [savingCall, setSavingCall] = useState(false);
  const [addingLead, setAddingLead] = useState(false);
  const [creatingLead, setCreatingLead] = useState(false);
  const [newLead, setNewLead] = useState<LeadInput>(emptyLead);
  const [draggedOfficerId, setDraggedOfficerId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const [upload, setUpload] = useState<UploadBatch | null>(null);
  const [uploading, setUploading] = useState(false);
  const [checkingUpload, setCheckingUpload] = useState(false);
  const [importingUpload, setImportingUpload] = useState(false);
  const [submittedLead, setSubmittedLead] = useState<string | null>(null);
  const [filters, setFilters] = useState<LeadFilters>({});
  const [activeFilters, setActiveFilters] = useState<LeadFilters>({});
  const [bulkOfficerId, setBulkOfficerId] = useState("");
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [page, setPage] = useState(1);
  const [searchFilter, setSearchFilter] = useState("");
  const [totalLeads, setTotalLeads] = useState(0);
  const supportLoaded = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const queryString = leadQuery(officerMode, followUpsOnly, activeFilters, page, searchFilter);
      if (officerMode) { const result = await getLeadsPage(queryString); setLeads(result.results); setTotalLeads(result.count); }
      else {
        if (!supportLoaded.current) {
          const [pool, officerRecords, analytics] = await Promise.all([getLeadsPage(queryString), getOfficers(), getAdminAnalytics()]);
          setLeads(pool.results); setTotalLeads(pool.count);
          setOfficers(officerRecords.map(officer => toOfficer(officer, analytics.officers.find(item => item.id === officer.id))));
          supportLoaded.current = true;
        } else {
          const pool = await getLeadsPage(queryString);
          setLeads(pool.results); setTotalLeads(pool.count);
        }
      }
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to load CRM data."); }
    finally { setLoading(false); }
  }, [activeFilters, followUpsOnly, officerMode, page, searchFilter]);

  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);
  useEffect(() => { const timer = window.setTimeout(() => { setPage(1); setSearchFilter(query.trim()); }, 250); return () => window.clearTimeout(timer); }, [query]);
  useEffect(() => { const timer = window.setTimeout(() => { setPage(1); setActiveFilters(current => JSON.stringify(current) === JSON.stringify(filters) ? current : { ...filters }); }, 250); return () => window.clearTimeout(timer); }, [filters]);
  useEffect(() => {
    const open = () => setAddingLead(true);
    window.addEventListener("revera:add-lead", open);
    if (!officerMode && new URLSearchParams(window.location.search).get("addLead") === "1") { open(); window.history.replaceState({}, "", "/leads"); }
    return () => window.removeEventListener("revera:add-lead", open);
  }, [officerMode]);

  const visible = useMemo(() => leads.filter(lead => `${lead.name} ${lead.phone}`.toLowerCase().includes(query.toLowerCase())), [leads, query]);
  const needsAppointment = ["CALLBACK", "WALKIN"].includes(outcome);

  const assign = async (lead: Lead, officerId: number) => {
    const previousLeads = leads;
    const previousOfficers = officers;
    setLeads(current => current.filter(item => item.id !== lead.id));
    setOfficers(current => current.map(officer => officer.id === officerId ? { ...officer, assigned: officer.assigned + 1 } : officer));
    try { await assignLead(lead.id, officerId); setNotice(`${lead.name} assigned.`); }
    catch (requestError) { setLeads(previousLeads); setOfficers(previousOfficers); setError(requestError instanceof Error ? requestError.message : "Assignment failed."); }
    finally { setDropTargetId(null); }
  };

  const autoAssign = async () => {
    try { const result = await autoAssignLeads(); setNotice(`${result.assigned} leads assigned.`); await refresh(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Auto-assignment failed."); }
  };

  const bulkAssign = async () => {
    const officer = officers.find(item => item.id === Number(bulkOfficerId));
    if (!officer || !leads.length || bulkAssigning) return;
    if (!window.confirm(`Assign all leads matching these filters to ${officer.name}?`)) return;
    setBulkAssigning(true); setError("");
    try { const result = await assignFilteredLeads(officer.id, activeFilters); setNotice(`${result.assigned} leads assigned to ${officer.name}.`); setBulkOfficerId(""); await refresh(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Bulk assignment failed."); }
    finally { setBulkAssigning(false); }
  };

  const saveCall = async () => {
    if (!activeLead || !outcome || savingCall) return;
    const scheduledFor = followUpAt ? parseDateTime(followUpAt) : null;
    if (needsAppointment && !scheduledFor) { setError("Enter the appointment as DD/MM/YYYY HH:MM."); return; }
    if (scheduledFor && new Date(scheduledFor) <= new Date()) { setError("Choose a future appointment time."); return; }
    setSavingCall(true);
    try {
      await logCall(activeLead.id, { status: outcome, remarks, ...(scheduledFor ? { follow_up_at: scheduledFor } : {}) });
      setNotice(`Call log saved for ${activeLead.name}.`); setActiveLead(null); setRemarks(""); setFollowUpAt(""); await refresh();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Call log could not be saved."); }
    finally { setSavingCall(false); }
  };

  const openLead = (lead: Lead) => {
    setActiveLead(lead); setOutcome(nextOutcomes[lead.status]?.[0]?.value || ""); setRemarks(""); setFollowUpAt(""); setSavingCall(false); setError("");
  };

  const saveLead = async () => {
    if (officerMode || creatingLead) return;
    const email = newLead.email?.trim() || "";
    if (email && !emailPattern.test(email)) { setError("Enter a valid email address, such as name@example.com."); return; }
    const enquiryDate = parseDate(newLead.enquiry_date || "");
    if (!enquiryDate) { setError("Enter the enquiry date as DD/MM/YYYY."); return; }
    const today = parseDate(formatDate(new Date()));
    if (today && enquiryDate > today) { setError("Enquiry date cannot be in the future."); return; }
    setCreatingLead(true); setError("");
    try {
      const lead = await createLead({ ...newLead, email, enquiry_date: enquiryDate });
      setLeads(current => [toLead(lead), ...current]);
      setAddingLead(false); setNewLead(emptyLead()); setSubmittedLead(lead.name);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Lead could not be added."); }
    finally { setCreatingLead(false); }
  };

  const selectFile = async (file?: File) => {
    if (!file) return;
    setUploading(true); setError("");
    try { const batch = await uploadLeads(file); setUpload(batch); setNotice("File received. Check import when parsing finishes."); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Upload failed."); }
    finally { setUploading(false); }
  };
  const checkUpload = async () => {
    if (!upload || checkingUpload) return;
    setCheckingUpload(true);
    try {
      const summary = await getUpload(upload.id);
      setUpload(summary.duplicates_found > 0 && summary.status === "READY" ? await getUpload(upload.id, true) : summary);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to check import."); }
    finally { setCheckingUpload(false); }
  };
  const removeDuplicates = async (rowIds: number[]) => {
    if (!upload || !rowIds.length) return;
    try {
      await resolveUploadDuplicates(upload.id, rowIds.map(id => ({ id, resolution: "SKIP" })));
      setUpload(await getUpload(upload.id, true));
      setNotice(`${rowIds.length} duplicate ${rowIds.length === 1 ? "row removed" : "rows removed"} from this import.`);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Duplicate rows could not be removed."); }
  };
  const importUpload = async () => {
    if (!upload || importingUpload) return;
    setImportingUpload(true); setError("");
    try {
      const result = await commitUpload(upload.id);
      setUpload(null); setNotice(`${result.created} leads imported. Assign them from the pool.`);
      setLoading(true);
      const pageResult = await getLeadsPage(leadQuery(false, false, activeFilters, page, searchFilter));
      setLeads(pageResult.results); setTotalLeads(pageResult.count);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Import failed."); }
    finally { setImportingUpload(false); setLoading(false); }
  };
  const duplicateRows = upload?.rows?.filter(row => row.duplicate_of && row.resolution === "PENDING") || [];
  const importableRows = upload?.rows ? upload.rows.filter(row => !row.validation_error && row.resolution !== "SKIP").length : upload?.parsed_ok;
  const heading = followUpsOnly ? "Follow-ups" : officerMode ? "My queue" : "Assignment desk";

  return <section className="page">
    <div className="page-heading compact"><div><p className="eyebrow">{heading.toUpperCase()}</p><h1>{officerMode ? <>Keep the <span>promise.</span></> : <>Move leads to the <span>right rider.</span></>}</h1><p className="subtext">{officerMode ? "Your assigned conversations and follow-ups." : "Upload leads, then hand them to an active sales officer."}</p></div>{!officerMode && <button className="button primary" onClick={autoAssign} disabled={!leads.length}>↻ Auto assign {leads.length} leads</button>}</div>
    <section className="lead-toolbar"><label className="search"><span>⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name or phone" /></label>{!officerMode && <><button className="button primary" onClick={() => { setError(""); setAddingLead(true); }}>＋ Add lead</button><label className="button filter">{uploading ? "Uploading…" : "Upload Excel"}<input hidden type="file" accept=".xlsx,.csv" onChange={event => void selectFile(event.target.files?.[0])} /></label></>}<button className="filter" onClick={() => void refresh()}>Refresh</button></section>
    {!officerMode && <section className="panel lead-filters"><div className="lead-filters-grid"><label>Source<select value={filters.source || ""} onChange={event => setFilters(current => ({ ...current, source: event.target.value || undefined }))}><option value="">All sources</option>{sources.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Model<input value={filters.model || ""} onChange={event => setFilters(current => ({ ...current, model: event.target.value || undefined }))} placeholder="Any model" /></label><label>City<input value={filters.city || ""} onChange={event => setFilters(current => ({ ...current, city: event.target.value || undefined }))} placeholder="Any city" /></label><label>Source detail<input value={filters.source_label || ""} onChange={event => setFilters(current => ({ ...current, source_label: event.target.value || undefined }))} placeholder="Google, OEM, or campaign" /></label><label>From<input type="date" value={filters.date_from || ""} onChange={event => setFilters(current => ({ ...current, date_from: event.target.value || undefined }))} /></label><label>To<input type="date" value={filters.date_to || ""} onChange={event => setFilters(current => ({ ...current, date_to: event.target.value || undefined }))} /></label></div><footer className="lead-filters-actions"><span>{Object.values(activeFilters).filter(Boolean).length ? "Filtered unassigned leads" : "All unassigned leads"}</span><div><button className="filter" onClick={() => { setFilters({}); setActiveFilters({}); }}>Clear</button><button className="filter" onClick={() => setActiveFilters({ ...filters })}>Apply filters</button><select className="filter" aria-label="Assign filtered leads to" value={bulkOfficerId} onChange={event => setBulkOfficerId(event.target.value)}><option value="">Assign to…</option>{officers.map(officer => <option key={officer.id} value={officer.id}>{officer.name}</option>)}</select><button className="button primary" onClick={() => void bulkAssign()} disabled={!bulkOfficerId || !leads.length || bulkAssigning}>{bulkAssigning ? "Assigning…" : "Assign matching leads"}</button></div></footer></section>}
    {upload && <section className="panel" style={{ padding: "1rem", marginBottom: "1rem" }}><b>Import: {upload.status === "PARSING" ? "Checking file…" : upload.status}</b><span> · {importableRows}/{upload.total_rows} rows ready to import</span>{upload.duplicates_found > 0 && <span> · {upload.duplicates_found} duplicates need review</span>}<div style={{ display: "inline-flex", gap: ".5rem", marginLeft: "1rem" }}><button className="filter" disabled={checkingUpload || uploading} onClick={() => void checkUpload()}>{checkingUpload ? "Checking…" : "Check import"}</button>{upload.status === "READY" && !duplicateRows.length && upload.duplicates_found === 0 && <button className="button primary" disabled={importingUpload} onClick={() => void importUpload()}>{importingUpload ? "Importing…" : "Import leads"}</button>}</div>{duplicateRows.length > 0 && <div style={{ marginTop: "1rem" }}><p className="subtext">Duplicates already exist in the CRM. Remove them from this import to keep the existing lead.</p><button className="filter" onClick={() => void removeDuplicates(duplicateRows.map(row => row.id))}>Remove all duplicates</button><div style={{ display: "grid", gap: ".5rem", marginTop: ".75rem" }}>{duplicateRows.map(row => <div key={row.id} className="lead-summary"><b>Row {row.row_number} · {row.data.name || "Unnamed lead"}</b><span>Matches {row.existing_name || "existing lead"}</span><small>{row.normalized_phone} · Current status: {row.existing_status}</small><button className="row-action" onClick={() => void removeDuplicates([row.id])}>Remove duplicate</button></div>)}</div></div>}{upload.error_message && <p className="subtext">{upload.error_message}</p>}</section>}
    {error && <div className="empty-state">{error}</div>}
    <section className={officerMode ? "lead-layout one-column" : "lead-layout"}>
      <article className="panel lead-pool"><header className="panel-heading"><div><p className="eyebrow">{officerMode ? "ACTIVE LEADS" : "UNASSIGNED"}</p><h2>{loading ? "Loading leads…" : `${leads.length} leads in pool`}</h2></div></header><div className="lead-list">{!loading && visible.length ? visible.map(lead => <div className={`lead-row ${dropTargetId === lead.id ? "drop-target" : ""}`} key={lead.id} onDragOver={event => { if (!officerMode) { event.preventDefault(); setDropTargetId(lead.id); } }} onDragLeave={() => setDropTargetId(null)} onDrop={event => { event.preventDefault(); const officerId = Number(event.dataTransfer.getData("application/revera-officer")) || draggedOfficerId; if (officerId) void assign(lead, officerId); setDraggedOfficerId(null); }}>{!officerMode && <span className="drag-slot">↓</span>}<div><b>{lead.name}</b><small>{lead.phone} · #{lead.id}</small></div><span className={`badge ${sourceClass(lead.source)}`}>{lead.source}</span><span className="model">{lead.model}</span><span className={`status ${lead.status.toLowerCase().replaceAll(" ", "-")}`}>{lead.status}</span><button className="row-action" onClick={() => openLead(lead)}>{officerMode ? "Log call →" : "Open →"}</button></div>) : !loading && <div className="empty-state">No leads match this view.</div>}</div></article>
      {!officerMode && <aside className="officer-rail"><header><p className="eyebrow">ACTIVE SALES OFFICERS</p><span>Drag a card to a lead row</span></header>{officers.map(officer => <div className={`officer-card ${draggedOfficerId === officer.id ? "dragging" : ""}`} key={officer.id} draggable onDragStart={event => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/revera-officer", String(officer.id)); setDraggedOfficerId(officer.id); }} onDragEnd={() => { setDraggedOfficerId(null); setDropTargetId(null); }}><span className={`avatar ${officer.color}`}>{officer.initials}</span><span><b>{officer.name}</b><small>Sales officer</small></span><span className="officer-load"><small>LEAD LOAD</small><b>{officer.assigned}</b><small>CALLS TODAY</small><b>{officer.calls}</b></span></div>)}</aside>}
    </section>
    {!officerMode && <LeadPagination page={page} total={totalLeads} loading={loading} onPageChange={setPage} />}
    {notice && <div className="toast" role="status">{notice}<button aria-label="Dismiss" onClick={() => setNotice("")}>×</button></div>}
    {addingLead && <div className="modal-layer" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="add-lead-title"><button className="modal-close" onClick={() => setAddingLead(false)} aria-label="Close">×</button><p className="eyebrow">LEAD INTAKE</p><h2 id="add-lead-title">Add a lead</h2><form className="lead-form" onSubmit={event => { event.preventDefault(); void saveLead(); }}><div className="form-grid"><label>Full name<input required maxLength={160} value={newLead.name} onChange={event => setNewLead(current => ({ ...current, name: event.target.value }))} placeholder="Customer name" /></label><label>Phone number<input required inputMode="numeric" pattern="[0-9]{10}" maxLength={10} value={newLead.phone} onChange={event => setNewLead(current => ({ ...current, phone: event.target.value.replace(/\D/g, "") }))} placeholder="10-digit mobile number" /></label></div><div className="form-grid"><label>Email<input type="email" inputMode="email" pattern={emailPattern.source} title="Use a complete email such as name@example.com" value={newLead.email} onChange={event => setNewLead(current => ({ ...current, email: event.target.value }))} placeholder="name@example.com" /></label><label>City<input maxLength={100} value={newLead.city} onChange={event => setNewLead(current => ({ ...current, city: event.target.value }))} placeholder="City" /></label></div><div className="form-grid"><label>Lead source<select value={newLead.source} onChange={event => setNewLead(current => ({ ...current, source: event.target.value }))}>{sources.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Enquiry date<input required type="text" inputMode="numeric" pattern="\d{2}/\d{2}/\d{4}" value={newLead.enquiry_date} onChange={event => setNewLead(current => ({ ...current, enquiry_date: event.target.value }))} placeholder="DD/MM/YYYY" /></label></div><div className="form-grid"><label>Vehicle interest<input list="vehicle-options" maxLength={100} value={newLead.model_interest} onChange={event => setNewLead(current => ({ ...current, model_interest: event.target.value }))} placeholder="Choose or type a model" /><datalist id="vehicle-options">{models.map(model => <option key={model} value={model} />)}</datalist></label><label>Campaign<input maxLength={160} value={newLead.campaign} onChange={event => setNewLead(current => ({ ...current, campaign: event.target.value }))} placeholder="Campaign name" /></label></div><label>Source detail<input maxLength={100} value={newLead.source_label} onChange={event => setNewLead(current => ({ ...current, source_label: event.target.value }))} placeholder="Ad set, partner, referral, or other detail" /></label>{error && <p className="form-error" role="alert">{error}</p>}<p className="subtext">New leads start as Fresh and appear unassigned, ready to hand to a sales officer.</p><footer><button type="button" className="filter" onClick={() => setAddingLead(false)}>Cancel</button><button className="button primary" disabled={creatingLead}>{creatingLead ? "Adding…" : "Add lead"}</button></footer></form></section></div>}
    {submittedLead && <div className="modal-layer" role="presentation"><section className="modal success-modal" role="dialog" aria-modal="true" aria-labelledby="submitted-title"><button className="modal-close" onClick={() => setSubmittedLead(null)} aria-label="Close">×</button><div className="success-mark" aria-hidden="true">✓</div><p className="eyebrow">LEAD SUBMITTED</p><h2 id="submitted-title">Thank you, lead submitted.</h2><p className="subtext">{submittedLead} is now in the unassigned pool, ready for a sales officer.</p><button className="button primary" onClick={() => setSubmittedLead(null)}>Done</button></section></div>}
    {activeLead && <div className="modal-layer" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="call-title"><button className="modal-close" onClick={() => setActiveLead(null)} aria-label="Close">×</button><p className="eyebrow">CALL LOG</p><h2 id="call-title">Update {activeLead.name}</h2><div className="lead-summary"><b>#{activeLead.id} · {activeLead.model}</b><span>{activeLead.source} lead</span><small>{activeLead.phone} · {activeLead.city || "—"}</small></div>{nextOutcomes[activeLead.status]?.length ? <><div className="form-grid"><label>Next outcome<select value={outcome} onChange={event => { setOutcome(event.target.value); if (!["CALLBACK", "WALKIN"].includes(event.target.value)) setFollowUpAt(""); }}>{nextOutcomes[activeLead.status].map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>{needsAppointment && <label>{outcome === "WALKIN" ? "Walk-in appointment" : "Follow-up time"}<input required type="text" inputMode="numeric" value={followUpAt} onChange={event => setFollowUpAt(event.target.value)} placeholder="DD/MM/YYYY HH:MM" /></label>}</div><label>Remarks<textarea maxLength={500} value={remarks} onChange={event => setRemarks(event.target.value)} placeholder="Add a clear note from the conversation" /></label><footer><button className="filter" onClick={() => setActiveLead(null)}>Cancel</button><button className="button primary" disabled={savingCall || (needsAppointment && !followUpAt) || !outcome} onClick={() => void saveCall()}>{savingCall ? "Saving…" : "Save call log"}</button></footer></> : <p className="subtext">This lead is closed. Reopen it before recording another outcome.</p>}</section></div>}
  </section>;
}
