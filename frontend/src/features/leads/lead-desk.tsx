"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { assignFilteredLeads, assignFilteredPsLeads, assignLead, assignPsLead, autoAssignLeads, commitUpload, createLead, getAdminAnalytics, getCres, getLeadDetail, getLeadsPage, getOfficers, getUpload, logCall, resolveUploadDuplicates, sourceClass, statusName, toLead, toOfficer, updateMyLead, type CallHistory, type Lead, type LeadDetail, type LeadFilters, type LeadInput, type LeadQualification, type Officer, type UploadBatch, uploadLeads } from "@/lib/crm";
import { formatDate, parseDate } from "@/lib/dates";

const statusLabels: Record<string, string> = { FRESH: "Fresh", RNR: "RNR", SWITCHED_OFF: "Switch off", CALLBACK: "Callback", PENDING: "Pending", QUALIFIED: "Qualified", UNQUALIFIED: "Unqualified", WALKIN: "Walk-in", WON: "Won", LOST: "Lost" };
const outcomeLabels: Record<string, string> = { CONNECTED: "Connected", NO_RESPONSE: "No response", CALLBACK: "Callback", QUALIFIED: "Qualified", WRONG_NUMBER: "Wrong number" };

function formatCallDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function localDateTimeValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function followUpOptions() {
  const now = new Date();
  const slot = (label: string, offsetMs: number) => {
    const date = new Date(now.getTime() + offsetMs);
    return { label, value: date.toISOString() };
  };
  const atHour = (label: string, daysAhead: number, hour: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() + daysAhead);
    date.setHours(hour, 0, 0, 0);
    if (date <= now) return null;
    return { label, value: date.toISOString() };
  };
  return [
    slot("In 30 minutes", 30 * 60_000),
    slot("In 1 hour", 60 * 60_000),
    slot("In 2 hours", 2 * 60 * 60_000),
    slot("In 4 hours", 4 * 60 * 60_000),
    atHour("Tomorrow 10:00 AM", 1, 10),
    atHour("Tomorrow 2:00 PM", 1, 14),
    atHour("Day after 10:00 AM", 2, 10),
  ].filter(Boolean) as { label: string; value: string }[];
}

const nextOutcomes: Record<string, { label: string; value: string }[]> = {
  Fresh: [{ label: "No response", value: "RNR" }, { label: "Schedule callback", value: "CALLBACK" }, { label: "Interested / Qualified", value: "QUALIFIED" }, { label: "Not interested", value: "UNQUALIFIED" }],
  RNR: [{ label: "Schedule callback", value: "CALLBACK" }, { label: "Interested / Qualified", value: "QUALIFIED" }, { label: "Not interested", value: "UNQUALIFIED" }],
  Callback: [{ label: "No response", value: "RNR" }, { label: "Interested / Qualified", value: "QUALIFIED" }, { label: "Book walk-in", value: "WALKIN" }, { label: "Not interested", value: "UNQUALIFIED" }],
  Qualified: [{ label: "Book walk-in", value: "WALKIN" }, { label: "Won (Sold)", value: "WON" }, { label: "Lost", value: "LOST" }],
  "Walk-in": [{ label: "Won (Sold)", value: "WON" }, { label: "Lost", value: "LOST" }],
};

const adminOutcomeOptions = [
  { label: "RNR", value: "RNR", callOutcome: "RNR", salesOutcome: "PENDING" },
  { label: "Switch off", value: "SWITCHED_OFF", callOutcome: "SWITCHED_OFF", salesOutcome: "PENDING" },
  { label: "Call me back", value: "CALLBACK", callOutcome: "CALLBACK", salesOutcome: "PENDING" },
  { label: "Booked Follow-up", value: "PENDING", callOutcome: "PENDING", salesOutcome: "PENDING" },
  { label: "Retailed", value: "WON", callOutcome: "", salesOutcome: "RETAILED" },
  { label: "Lost", value: "LOST", callOutcome: "LOST", salesOutcome: "LOST" },
];

const sources = [["META", "Meta Ads"], ["WEBSITE", "Website"], ["CARWALE", "CarWale"], ["WALKIN", "Walk-in"], ["CAMPAIGN", "Campaign"], ["OTHER", "Other"], ["UNKNOWN", "Unknown"]];
const models = ["R6 GT", "R7 City", "R8 Lite", "R8 Pro", "R9 Plus"];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emptyLead = (): LeadInput => ({ name: "", phone: "", email: "", source: "OTHER", source_label: "", campaign: "", model_interest: "", city: "", enquiry_date: formatDate(new Date()) });
const leadQuery = (officerMode: boolean, followUpsOnly: boolean, filters: LeadFilters, page: number, search: string, assignmentView = "fresh") => {
  const params = new URLSearchParams();
  if (officerMode) { if (followUpsOnly) params.set("status", "CALLBACK"); }
  else { params.set(assignmentView === "qualified" ? "ps_unassigned" : "unassigned", "true"); params.set("page", String(page)); Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); }); }
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
  const [creUsers, setCreUsers] = useState<Officer[]>([]);
  const [psUsers, setPsUsers] = useState<Officer[]>([]);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState<any>(null);
  const [assignmentView, setAssignmentView] = useState<"fresh" | "qualified">("fresh");
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [leadDetail, setLeadDetail] = useState<LeadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [remarks, setRemarks] = useState("");
  const [followUpAt, setFollowUpAt] = useState("");
  const [testDrive, setTestDrive] = useState("");
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
  const assignmentUsers = assignmentView === "fresh" ? creUsers : psUsers;

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const queryString = leadQuery(officerMode, followUpsOnly, activeFilters, page, searchFilter, assignmentView);
      if (officerMode) { const result = await getLeadsPage(queryString); setLeads(result.results); setTotalLeads(result.count); }
      else {
        if (!supportLoaded.current) {
          const [pool, creRecords, psRecords, analyticsResult] = await Promise.all([getLeadsPage(queryString), getCres(), getOfficers(), getAdminAnalytics()]);
          setLeads(pool.results); setTotalLeads(pool.count);
          setCreUsers(creRecords.map(officer => toOfficer(officer, analyticsResult.cre.find(item => item.id === officer.id))));
          setPsUsers(psRecords.map(officer => toOfficer(officer, analyticsResult.officers.find(item => item.id === officer.id))));
          setAnalytics(analyticsResult);
          supportLoaded.current = true;
        } else {
          const pool = await getLeadsPage(queryString);
          setLeads(pool.results); setTotalLeads(pool.count);
        }
      }
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to load CRM data."); }
    finally { setLoading(false); }
  }, [activeFilters, assignmentView, followUpsOnly, officerMode, page, searchFilter]);

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
  const needsAppointment = ["CALLBACK", "WALKIN", "PENDING"].includes(outcome);

  const assign = async (lead: Lead, officerId: number) => {
    const previousLeads = leads;
    const previousUsers = assignmentUsers;
    const setUsers = assignmentView === "fresh" ? setCreUsers : setPsUsers;
    setLeads(current => current.filter(item => item.id !== lead.id));
    setUsers(current => current.map(officer => officer.id === officerId ? { ...officer, assigned: officer.assigned + 1 } : officer));
    try { await (assignmentView === "fresh" ? assignLead : assignPsLead)(lead.id, officerId); setNotice(`${lead.name} assigned to ${assignmentView === "fresh" ? "CRE" : "PS/SO"}.`); }
    catch (requestError) { setLeads(previousLeads); setUsers(previousUsers); setError(requestError instanceof Error ? requestError.message : "Assignment failed."); }
    finally { setDropTargetId(null); }
  };

  const autoAssign = async () => {
    try { const result = await autoAssignLeads(); setNotice(`${result.assigned} leads assigned.`); await refresh(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Auto-assignment failed."); }
  };

  const bulkAssign = async () => {
    const officer = assignmentUsers.find(item => item.id === Number(bulkOfficerId));
    if (!officer || !leads.length || bulkAssigning) return;
    if (!window.confirm(`Assign all leads matching these filters to ${officer.name}?`)) return;
    setBulkAssigning(true); setError("");
    try { const result = await (assignmentView === "fresh" ? assignFilteredLeads : assignFilteredPsLeads)(officer.id, activeFilters); setNotice(`${result.assigned} leads assigned to ${officer.name}.`); setBulkOfficerId(""); await refresh(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Bulk assignment failed."); }
    finally { setBulkAssigning(false); }
  };

  const saveCall = async () => {
    if (!activeLead || !outcome || savingCall) return;
    if (needsAppointment && !followUpAt) { setError("Select a follow-up time."); return; }
    setSavingCall(true);
    try {
      const normalizedFollowUpAt = followUpAt ? new Date(followUpAt).toISOString() : "";
      if (!officerMode && leadDetail) {
        const selectedOutcome = adminOutcomeOptions.find(item => item.value === outcome);
        await updateMyLead(activeLead.id, {
          status: outcome,
          remarks,
          ...(selectedOutcome?.callOutcome ? { call_outcome: selectedOutcome.callOutcome } : {}),
          ...(selectedOutcome?.salesOutcome ? { sales_outcome: selectedOutcome.salesOutcome } : {}),
          ...(normalizedFollowUpAt ? { follow_up_at: normalizedFollowUpAt } : {}),
          ...(testDrive ? { qualification: { variant: leadDetail.qualification?.variant || "", buying_timeline: leadDetail.qualification?.buying_timeline || "", finance_type: leadDetail.qualification?.finance_type || "", trade_in: leadDetail.qualification?.trade_in ?? null, test_drive: testDrive, notes: leadDetail.qualification?.notes || "" } } : {}),
        });
      } else {
        await logCall(activeLead.id, { status: outcome, remarks, ...(normalizedFollowUpAt ? { follow_up_at: normalizedFollowUpAt } : {}) });
      }
      setNotice(`Call log saved for ${activeLead.name}.`); setActiveLead(null); setLeadDetail(null); setRemarks(""); setFollowUpAt(""); setTestDrive(""); await refresh();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Call log could not be saved."); }
    finally { setSavingCall(false); }
  };

  const openLead = async (lead: Lead) => {
    const initialOutcome = officerMode ? nextOutcomes[lead.status]?.[0]?.value || "" : lead.statusCode === "WON" ? "WON" : ["LOST", "UNQUALIFIED"].includes(lead.statusCode) ? "LOST" : lead.statusCode === "PENDING" || lead.nextFollowUp ? "PENDING" : "";
    setActiveLead(lead); setOutcome(initialOutcome); setRemarks(""); setFollowUpAt(localDateTimeValue(lead.nextFollowUp)); setTestDrive(""); setSavingCall(false); setError("");
    if (!officerMode) {
      setDetailLoading(true);
      try { const detail = await getLeadDetail(lead.id); setLeadDetail(detail); setFollowUpAt(localDateTimeValue(detail.nextFollowUp)); setTestDrive(detail.qualification?.test_drive || ""); }
      catch { /* detail fetch failed, modal still works with basic data */ }
      finally { setDetailLoading(false); }
    }
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
      const pageResult = await getLeadsPage(leadQuery(false, false, activeFilters, page, searchFilter, assignmentView));
      setLeads(pageResult.results); setTotalLeads(pageResult.count);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Import failed."); }
    finally { setImportingUpload(false); setLoading(false); }
  };
  const duplicateRows = upload?.rows?.filter(row => row.duplicate_of && row.resolution === "PENDING") || [];
  const importableRows = upload?.rows ? upload.rows.filter(row => !row.validation_error && row.resolution !== "SKIP").length : upload?.parsed_ok;
  const targetLabel = assignmentView === "fresh" ? "CRE" : "PS/SO";
  const poolLabel = assignmentView === "fresh" ? "Fresh lead pool" : "Qualified handoff pool";
  const heading = followUpsOnly ? "Follow-ups" : officerMode ? "My queue" : "Assignment desk";

  return <section className="page">
    <div className="page-heading compact"><div><p className="eyebrow">{heading.toUpperCase()}</p><h1>{officerMode ? <>Keep the <span>promise.</span></> : <>All <span>leads.</span></>}</h1><p className="subtext">{officerMode ? "Your assigned conversations and follow-ups." : "Manage and assign all leads in the CRM."}</p></div>{!officerMode && assignmentView === "fresh" && <button className="button primary" onClick={autoAssign} disabled={!leads.length}>↻ Auto assign {leads.length} leads</button>}</div>
    {!officerMode && analytics?.summary && (
      <section className="sales-metrics" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
        <article className="sales-metric blue">
          <span>ALL LEADS</span>
          <strong>{analytics.summary.total_assigned || 0}</strong>
          <small>Total managed leads</small>
        </article>
        <article className="sales-metric mint">
          <span>BOOKED</span>
          <strong>{analytics.summary.walkins || 0}</strong>
          <small>Appointments scheduled</small>
        </article>
        <article className="sales-metric green">
          <span>RETAILED</span>
          <strong>{analytics.summary.won || 0}</strong>
          <small>Successfully closed</small>
        </article>
        <article className="sales-metric red">
          <span>LOST</span>
          <strong>{analytics.summary.lost || 0}</strong>
          <small>Dropped leads</small>
        </article>
      </section>
    )}
    <section className="lead-toolbar"><label className="search" style={{ flex: 1 }}><span>⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by name or mobile..." /></label>{!officerMode && <><label className="button filter" style={{ color: "#2e5bbf", borderColor: "#2e5bbf", background: "rgba(46,91,191,0.1)" }}>{uploading ? "Uploading…" : "Bulk Upload"}<input hidden type="file" accept=".xlsx,.csv" onChange={event => void selectFile(event.target.files?.[0])} /></label><button className="button primary" onClick={() => { setError(""); setAddingLead(true); }}>＋ Add lead</button></>}</section>
    {!officerMode && <section className="panel lead-filters"><div className="lead-filters-grid"><label>Source<select value={filters.source || ""} onChange={event => setFilters(current => ({ ...current, source: event.target.value || undefined }))}><option value="">All sources</option>{sources.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Model<input value={filters.model || ""} onChange={event => setFilters(current => ({ ...current, model: event.target.value || undefined }))} placeholder="Any model" /></label><label>City<input value={filters.city || ""} onChange={event => setFilters(current => ({ ...current, city: event.target.value || undefined }))} placeholder="Any city" /></label><label>Source detail<input value={filters.source_label || ""} onChange={event => setFilters(current => ({ ...current, source_label: event.target.value || undefined }))} placeholder="Google, OEM, or campaign" /></label><label>From<input type="date" value={filters.date_from || ""} onChange={event => setFilters(current => ({ ...current, date_from: event.target.value || undefined }))} /></label><label>To<input type="date" value={filters.date_to || ""} onChange={event => setFilters(current => ({ ...current, date_to: event.target.value || undefined }))} /></label></div><footer className="lead-filters-actions"><span>{Object.values(activeFilters).filter(Boolean).length ? `Filtered ${poolLabel.toLowerCase()}` : `All ${poolLabel.toLowerCase()}`}</span><div><button className="filter" onClick={() => { setFilters({}); setActiveFilters({}); }}>Clear</button><button className="filter" onClick={() => setActiveFilters({ ...filters })}>Apply filters</button><select className="filter" aria-label={`Assign filtered leads to ${targetLabel}`} value={bulkOfficerId} onChange={event => setBulkOfficerId(event.target.value)}><option value="">Assign to {targetLabel}…</option>{assignmentUsers.map(officer => <option key={officer.id} value={officer.id}>{officer.name}</option>)}</select><button className="button primary" onClick={() => void bulkAssign()} disabled={!bulkOfficerId || !leads.length || bulkAssigning}>{bulkAssigning ? "Assigning…" : "Assign matching leads"}</button></div></footer></section>}
    {upload && <section className="panel" style={{ padding: "1rem", marginBottom: "1rem" }}><b>Import: {upload.status === "PARSING" ? "Checking file…" : upload.status}</b><span> · {importableRows}/{upload.total_rows} rows ready to import</span>{upload.duplicates_found > 0 && <span> · {upload.duplicates_found} duplicates need review</span>}<div style={{ display: "inline-flex", gap: ".5rem", marginLeft: "1rem" }}><button className="filter" disabled={checkingUpload || uploading} onClick={() => void checkUpload()}>{checkingUpload ? "Checking…" : "Check import"}</button>{upload.status === "READY" && !duplicateRows.length && upload.duplicates_found === 0 && <button className="button primary" disabled={importingUpload} onClick={() => void importUpload()}>{importingUpload ? "Importing…" : "Import leads"}</button>}</div>{duplicateRows.length > 0 && <div style={{ marginTop: "1rem" }}><p className="subtext">Duplicates already exist in the CRM. Remove them from this import to keep the existing lead.</p><button className="filter" onClick={() => void removeDuplicates(duplicateRows.map(row => row.id))}>Remove all duplicates</button><div style={{ display: "grid", gap: ".5rem", marginTop: ".75rem" }}>{duplicateRows.map(row => <div key={row.id} className="lead-summary"><b>Row {row.row_number} · {row.data.name || "Unnamed lead"}</b><span>Matches {row.existing_name || "existing lead"}</span><small>{row.normalized_phone} · Current status: {row.existing_status}</small><button className="row-action" onClick={() => void removeDuplicates([row.id])}>Remove duplicate</button></div>)}</div></div>}{upload.error_message && <p className="subtext">{upload.error_message}</p>}</section>}
    {error && <div className="empty-state">{error}</div>}
    <section className={officerMode ? "lead-layout one-column" : "lead-layout"}>
      <article className="panel lead-pool"><header className="panel-heading"><div><p className="eyebrow">{officerMode ? "ACTIVE LEADS" : poolLabel.toUpperCase()}</p><h2>{loading ? "Loading leads…" : `${leads.length} leads in pool`}</h2></div></header><div className="lead-list">{!loading && visible.length ? visible.map(lead => <div className={`lead-row ${dropTargetId === lead.id ? "drop-target" : ""}`} key={lead.id} onDragOver={event => { if (!officerMode) { event.preventDefault(); setDropTargetId(lead.id); } }} onDragLeave={() => setDropTargetId(null)} onDrop={event => { event.preventDefault(); const officerId = Number(event.dataTransfer.getData("application/revera-officer")) || draggedOfficerId; if (officerId) void assign(lead, officerId); setDraggedOfficerId(null); }}>{!officerMode && <span className="drag-slot">↓</span>}<div><b>{lead.name}</b><small>{lead.phone} · #{lead.id}</small></div><span className={`badge ${sourceClass(lead.source)}`}>{lead.source}</span><span className="model">{lead.model}</span><span className={`status ${lead.status.toLowerCase().replaceAll(" ", "-")}`}>{lead.status}</span>{!officerMode && <select className="mobile-assign" aria-label={`Assign ${lead.name} to ${targetLabel}`} value="" onChange={event => { const officerId = Number(event.target.value); if (officerId) void assign(lead, officerId); }}><option value="">Assign to {targetLabel}…</option>{assignmentUsers.map(officer => <option key={officer.id} value={officer.id}>{officer.name}</option>)}</select>}<button className="row-action" onClick={() => openLead(lead)}>{officerMode ? "Log call →" : "Open →"}</button></div>) : !loading && <div className="empty-state">No leads match this view.</div>}</div></article>
      {!officerMode && <aside className="officer-rail"><header><p className="eyebrow">ACTIVE {targetLabel}</p><span>Drag a card to a lead row</span></header>{assignmentUsers.map(officer => <div className={`officer-card ${draggedOfficerId === officer.id ? "dragging" : ""}`} key={officer.id} draggable onDragStart={event => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/revera-officer", String(officer.id)); setDraggedOfficerId(officer.id); }} onDragEnd={() => { setDraggedOfficerId(null); setDropTargetId(null); }}><span className={`avatar ${officer.color}`}>{officer.initials}</span><span><b>{officer.name}</b><small>{targetLabel}</small></span><span className="officer-load"><small>LEAD LOAD</small><b>{officer.assigned}</b><small>CALLS TODAY</small><b>{officer.calls}</b></span></div>)}</aside>}
    </section>
    {!officerMode && <LeadPagination page={page} total={totalLeads} loading={loading} onPageChange={setPage} />}
    {notice && <div className="toast" role="status">{notice}<button aria-label="Dismiss" onClick={() => setNotice("")}>×</button></div>}
    {addingLead && <div className="modal-layer" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="add-lead-title"><button className="modal-close" onClick={() => setAddingLead(false)} aria-label="Close">×</button><p className="eyebrow">LEAD INTAKE</p><h2 id="add-lead-title">Add a lead</h2><form className="lead-form" onSubmit={event => { event.preventDefault(); void saveLead(); }}><div className="form-grid"><label>Full name<input required maxLength={160} value={newLead.name} onChange={event => setNewLead(current => ({ ...current, name: event.target.value }))} placeholder="Customer name" /></label><label>Phone number<input required inputMode="numeric" pattern="[0-9]{10}" maxLength={10} value={newLead.phone} onChange={event => setNewLead(current => ({ ...current, phone: event.target.value.replace(/\D/g, "") }))} placeholder="10-digit mobile number" /></label><label>Email<input type="email" inputMode="email" pattern={emailPattern.source} title="Use a complete email such as name@example.com" value={newLead.email} onChange={event => setNewLead(current => ({ ...current, email: event.target.value }))} placeholder="name@example.com" /></label><label>City<input maxLength={100} value={newLead.city} onChange={event => setNewLead(current => ({ ...current, city: event.target.value }))} placeholder="City" /></label><label>Lead source<select value={newLead.source} onChange={event => setNewLead(current => ({ ...current, source: event.target.value }))}>{sources.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Enquiry date<input required type="text" inputMode="numeric" pattern="\d{2}/\d{2}/\d{4}" value={newLead.enquiry_date} onChange={event => setNewLead(current => ({ ...current, enquiry_date: event.target.value }))} placeholder="DD/MM/YYYY" /></label><label>Vehicle interest<input list="vehicle-options" maxLength={100} value={newLead.model_interest} onChange={event => setNewLead(current => ({ ...current, model_interest: event.target.value }))} placeholder="Choose or type a model" /><datalist id="vehicle-options">{models.map(model => <option key={model} value={model} />)}</datalist></label><label>Campaign<input maxLength={160} value={newLead.campaign} onChange={event => setNewLead(current => ({ ...current, campaign: event.target.value }))} placeholder="Campaign name" /></label></div><label style={{ marginTop: "13px" }}>Source detail<input maxLength={100} value={newLead.source_label} onChange={event => setNewLead(current => ({ ...current, source_label: event.target.value }))} placeholder="Ad set, partner, referral, or other detail" /></label>{error && <p className="form-error" role="alert">{error}</p>}<p className="subtext">New leads start as Fresh and appear unassigned, ready to hand to CRE.</p><footer><button type="button" className="filter" onClick={() => setAddingLead(false)}>Cancel</button><button className="button primary" disabled={creatingLead}>{creatingLead ? "Adding…" : "Add lead"}</button></footer></form></section></div>}
    {submittedLead && <div className="modal-layer" role="presentation"><section className="modal success-modal" role="dialog" aria-modal="true" aria-labelledby="submitted-title"><button className="modal-close" onClick={() => setSubmittedLead(null)} aria-label="Close">×</button><div className="success-mark" aria-hidden="true">✓</div><p className="eyebrow">LEAD SUBMITTED</p><h2 id="submitted-title">Thank you, lead submitted.</h2><p className="subtext">{submittedLead} is now in the unassigned pool, ready for CRE assignment.</p><button className="button primary" onClick={() => setSubmittedLead(null)}>Done</button></section></div>}
    {activeLead && !officerMode && <div className="modal-layer admin-follow-up-layer" role="presentation"><section className="modal sales-detail-modal admin-follow-up-modal" role="dialog" aria-modal="true" aria-labelledby="call-title" style={{ maxWidth: "44rem" }}>
      <header className="sales-detail-header"><div><p className="eyebrow">LEAD UPDATE</p><h2 id="call-title">✎ Update Follow-up</h2><p className="subtext">Update the follow-up status and details for this lead.</p></div><button className="modal-close" onClick={() => { setActiveLead(null); setLeadDetail(null); }} aria-label="Close">×</button></header>
      <div className="sales-detail-scroll">
        {error && <p className="form-error" role="alert">{error}</p>}
        <section className="sales-info-card admin-customer-card">
          <h3>Customer information</h3>
          <div className="sales-info-grid">
            <span><small>Customer name</small><b>{activeLead.name}</b></span>
            <span><small>Mobile</small><b>{activeLead.phone}</b></span>
            <span><small>Model</small><b>{activeLead.model}</b></span>
            <span><small>Variant</small><b>{leadDetail?.qualification?.variant || "—"}</b></span>
            <span><small>Buying plan</small><b>{leadDetail?.qualification?.buying_timeline || "—"}</b></span>
            <span><small>Finance</small><b>{leadDetail?.qualification?.finance_type || "—"}</b></span>
          </div>
          <div className="sales-detail-meta"><span>Trade-in <b>{leadDetail?.qualification?.trade_in === true ? "Yes" : leadDetail?.qualification?.trade_in === false ? "No" : "—"}</b></span><span>Category <b className={`category-pill ${activeLead.category?.toLowerCase() || "warm"}`}>{activeLead.category || "WARM"}</b></span></div>
        </section>
        {(detailLoading || leadDetail?.callHistory.length) ? <section className="sales-form-card admin-call-history">
          <h3>Call history</h3>
          {detailLoading ? <p className="subtext">Loading call history…</p> : <div className="admin-history-list">{leadDetail?.callHistory.map((call, index) => <div className="sales-history-row" key={`call-${call.id}`}><div><b>Call #{leadDetail.callHistory.length - index} · {call.so_name || "Admin"}</b><small>{call.remarks || "No remarks"}</small>{call.outcome && <span className="admin-history-outcome">{call.outcome}</span>}</div><time>{formatCallDate(call.created_at)}</time></div>)}</div>}
        </section> : null}
        <section className="sales-form-card admin-call-card">
          <h3>Call remarks {leadDetail ? `(Call #${leadDetail.callHistory.length + 1})` : ""}</h3>
          <label className="sales-full-label"><textarea maxLength={500} value={remarks} onChange={event => setRemarks(event.target.value)} placeholder="Enter your call remarks…" /></label>
          <div className="admin-follow-up-grid">
            <div><h4>Call outcome</h4><div className="sales-choice-row admin-outcome-row">{adminOutcomeOptions.map(item => <button type="button" className={outcome === item.value ? "chosen" : ""} onClick={() => { setOutcome(item.value); if (!["CALLBACK", "WALKIN", "PENDING"].includes(item.value)) setFollowUpAt(""); }} key={item.value}>{item.label}</button>)}</div></div>
            <label className="admin-follow-up-date"><span><b>Next follow-up date</b>{needsAppointment ? " *" : ""}</span><input type="datetime-local" required={needsAppointment} min={localDateTimeValue(new Date().toISOString())} value={followUpAt} onChange={event => setFollowUpAt(event.target.value)} /></label>
            <div><h4>Test drive</h4><label className="admin-checkbox-card"><input type="checkbox" checked={testDrive === "Completed"} onChange={event => setTestDrive(event.target.checked ? "Completed" : "")} /> <span>Mark test drive as done</span></label></div>
          </div>
        </section>
      </div>
      <footer className="sales-detail-footer"><button className="filter" onClick={() => { setActiveLead(null); setLeadDetail(null); }}>Cancel</button><button className="button primary" disabled={savingCall || (needsAppointment && !followUpAt) || !outcome} onClick={() => void saveCall()}>{savingCall ? "Saving…" : "Update Follow-up"}</button></footer>
    </section></div>}
    {activeLead && officerMode && <div className="modal-layer" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="call-title-so"><button className="modal-close" onClick={() => setActiveLead(null)} aria-label="Close">×</button><p className="eyebrow">CALL LOG</p><h2 id="call-title-so">Update {activeLead.name}</h2><div className="lead-summary"><b>#{activeLead.id} · {activeLead.model}</b><span>{activeLead.source} lead</span><small>{activeLead.phone} · {activeLead.city || "—"}</small></div>{nextOutcomes[activeLead.status]?.length ? <><div className="form-grid"><label>Next outcome<select value={outcome} onChange={event => { setOutcome(event.target.value); if (!["CALLBACK", "WALKIN"].includes(event.target.value)) setFollowUpAt(""); }}>{nextOutcomes[activeLead.status].map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>{needsAppointment && <label>{outcome === "WALKIN" ? "Walk-in appointment" : "Follow-up time"}<select required value={followUpAt} onChange={event => setFollowUpAt(event.target.value)}><option value="">Select time</option>{followUpOptions().map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></label>}</div><label>Remarks<textarea maxLength={500} value={remarks} onChange={event => setRemarks(event.target.value)} placeholder="Add a clear note from the conversation" /></label><footer><button className="filter" onClick={() => setActiveLead(null)}>Cancel</button><button className="button primary" disabled={savingCall || (needsAppointment && !followUpAt) || !outcome} onClick={() => void saveCall()}>{savingCall ? "Saving…" : "Save call log"}</button></footer></> : <p className="subtext">This lead is closed. Reopen it before recording another outcome.</p>}</section></div>}
  </section>;
}
