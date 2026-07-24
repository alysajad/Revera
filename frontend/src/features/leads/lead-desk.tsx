"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { assignLead, autoAssignLeads, commitUpload, getAdminAnalytics, getLeads, getOfficers, getUpload, logCall, resolveUploadDuplicates, sourceClass, toOfficer, type Lead, type Officer, type UploadBatch, uploadLeads } from "@/lib/crm";

const nextOutcomes: Record<string, { label: string; value: string }[]> = {
  Fresh: [{ label: "No response", value: "RNR" }, { label: "Schedule callback", value: "CALLBACK" }, { label: "Interested / Qualified", value: "QUALIFIED" }, { label: "Not interested", value: "UNQUALIFIED" }],
  RNR: [{ label: "Schedule callback", value: "CALLBACK" }, { label: "Interested / Qualified", value: "QUALIFIED" }, { label: "Not interested", value: "UNQUALIFIED" }],
  Callback: [{ label: "No response", value: "RNR" }, { label: "Interested / Qualified", value: "QUALIFIED" }, { label: "Book walk-in", value: "WALKIN" }, { label: "Not interested", value: "UNQUALIFIED" }],
  Qualified: [{ label: "Book walk-in", value: "WALKIN" }, { label: "Won (Sold)", value: "WON" }, { label: "Lost", value: "LOST" }],
  "Walk-in": [{ label: "Won (Sold)", value: "WON" }, { label: "Lost", value: "LOST" }],
};

const localDateTime = () => {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
};

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
  const [draggedOfficerId, setDraggedOfficerId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const [upload, setUpload] = useState<UploadBatch | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const leadQuery = officerMode ? (followUpsOnly ? "?status=CALLBACK" : "") : "?unassigned=true";
      if (officerMode) setLeads(await getLeads(leadQuery));
      else {
        const [pool, officerRecords, analytics] = await Promise.all([getLeads(leadQuery), getOfficers(), getAdminAnalytics()]);
        setLeads(pool);
        setOfficers(officerRecords.map(officer => toOfficer(officer, analytics.officers.find(item => item.id === officer.id))));
      }
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to load CRM data."); }
    finally { setLoading(false); }
  }, [followUpsOnly, officerMode]);

  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);
  const visible = useMemo(() => leads.filter(lead => `${lead.name} ${lead.phone}`.toLowerCase().includes(query.toLowerCase())), [leads, query]);

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
  const saveCall = async () => {
    if (!activeLead || !outcome) return;
    try {
      await logCall(activeLead.id, { status: outcome, remarks, ...(followUpAt ? { follow_up_at: new Date(followUpAt).toISOString() } : {}) });
      setNotice(`Call log saved for ${activeLead.name}.`); setActiveLead(null); setRemarks(""); setFollowUpAt(""); await refresh();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Call log could not be saved."); }
  };
  const openLead = (lead: Lead) => {
    setActiveLead(lead); setOutcome(nextOutcomes[lead.status]?.[0]?.value || ""); setRemarks(""); setFollowUpAt(""); setError("");
  };
  const selectFile = async (file?: File) => {
    if (!file) return;
    try { const batch = await uploadLeads(file); setUpload(batch); setNotice("File received. Check import when parsing finishes."); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Upload failed."); }
  };
  const checkUpload = async () => { if (upload) try { setUpload(await getUpload(upload.id)); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to check import."); } };
  const removeDuplicates = async (rowIds: number[]) => {
    if (!upload || !rowIds.length) return;
    try {
      await resolveUploadDuplicates(upload.id, rowIds.map(id => ({ id, resolution: "SKIP" })));
      setUpload(await getUpload(upload.id));
      setNotice(`${rowIds.length} duplicate ${rowIds.length === 1 ? "row removed" : "rows removed"} from this import.`);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Duplicate rows could not be removed."); }
  };
  const importUpload = async () => { if (upload) try { const result = await commitUpload(upload.id); setNotice(`${result.created} leads imported. Assign them from the pool.`); setUpload(null); await refresh(); } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Import failed."); } };
  const duplicateRows = upload?.rows?.filter(row => row.duplicate_of && row.resolution === "PENDING") || [];
  const importableRows = upload?.rows ? upload.rows.filter(row => !row.validation_error && row.resolution !== "SKIP").length : upload?.parsed_ok;

  const heading = followUpsOnly ? "Follow-ups" : officerMode ? "My queue" : "Assignment desk";
  return <section className="page">
    <div className="page-heading compact"><div><p className="eyebrow">{heading.toUpperCase()}</p><h1>{officerMode ? <>Keep the <span>promise.</span></> : <>Move leads to the <span>right rider.</span></>}</h1><p className="subtext">{officerMode ? "Your assigned conversations and follow-ups." : "Upload leads, then hand them to an active sales officer."}</p></div>{!officerMode && <button className="button primary" onClick={autoAssign} disabled={!leads.length}>↻ Auto assign {leads.length} leads</button>}</div>
    <section className="lead-toolbar"><label className="search"><span>⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name or phone" /></label>{!officerMode && <label className="button filter">Upload Excel<input hidden type="file" accept=".xlsx,.csv" onChange={event => void selectFile(event.target.files?.[0])} /></label>}<button className="filter" onClick={() => void refresh()}>Refresh</button></section>
    {upload && <section className="panel" style={{ padding: "1rem", marginBottom: "1rem" }}><b>Import: {upload.status}</b><span> · {importableRows}/{upload.total_rows} rows ready to import</span>{upload.duplicates_found > 0 && <span> · {upload.duplicates_found} duplicates need review</span>}<div style={{ display: "inline-flex", gap: ".5rem", marginLeft: "1rem" }}><button className="filter" onClick={() => void checkUpload()}>Check import</button>{upload.status === "READY" && !duplicateRows.length && upload.duplicates_found === 0 && <button className="button primary" onClick={() => void importUpload()}>Import leads</button>}</div>{duplicateRows.length > 0 && <div style={{ marginTop: "1rem" }}><p className="subtext">Duplicates already exist in the CRM. Remove them from this import to keep the existing lead.</p><button className="filter" onClick={() => void removeDuplicates(duplicateRows.map(row => row.id))}>Remove all duplicates</button><div style={{ display: "grid", gap: ".5rem", marginTop: ".75rem" }}>{duplicateRows.map(row => <div key={row.id} className="lead-summary"><b>Row {row.row_number} · {row.data.name || "Unnamed lead"}</b><span>Matches {row.existing_name || "existing lead"}</span><small>{row.normalized_phone} · Current status: {row.existing_status}</small><button className="row-action" onClick={() => void removeDuplicates([row.id])}>Remove duplicate</button></div>)}</div></div>}{upload.error_message && <p className="subtext">{upload.error_message}</p>}</section>}
    {error && <div className="empty-state">{error}</div>}
    <section className={officerMode ? "lead-layout one-column" : "lead-layout"}>
      <article className="panel lead-pool"><header className="panel-heading"><div><p className="eyebrow">{officerMode ? "ACTIVE LEADS" : "UNASSIGNED"}</p><h2>{loading ? "Loading leads…" : `${leads.length} leads in pool`}</h2></div></header><div className="lead-list">{!loading && visible.length ? visible.map(lead => <div className={`lead-row ${dropTargetId === lead.id ? "drop-target" : ""}`} key={lead.id} onDragOver={event => { if (!officerMode) { event.preventDefault(); setDropTargetId(lead.id); } }} onDragLeave={() => setDropTargetId(null)} onDrop={event => { event.preventDefault(); const officerId = Number(event.dataTransfer.getData("application/revera-officer")) || draggedOfficerId; if (officerId) void assign(lead, officerId); setDraggedOfficerId(null); }}>{!officerMode && <span className="drag-slot">↓</span>}<div><b>{lead.name}</b><small>{lead.phone} · #{lead.id}</small></div><span className={`badge ${sourceClass(lead.source)}`}>{lead.source}</span><span className="model">{lead.model}</span><span className={`status ${lead.status.toLowerCase().replaceAll(" ", "-")}`}>{lead.status}</span><button className="row-action" onClick={() => openLead(lead)}>{officerMode ? "Log call →" : "Open →"}</button></div>) : !loading && <div className="empty-state">No leads match this view.</div>}</div></article>
      {!officerMode && <aside className="officer-rail"><header><p className="eyebrow">ACTIVE SALES OFFICERS</p><span>Drag a card to a lead row</span></header>{officers.map(officer => <div className={`officer-card ${draggedOfficerId === officer.id ? "dragging" : ""}`} key={officer.id} draggable onDragStart={event => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/revera-officer", String(officer.id)); setDraggedOfficerId(officer.id); }} onDragEnd={() => { setDraggedOfficerId(null); setDropTargetId(null); }}><span className={`avatar ${officer.color}`}>{officer.initials}</span><span><b>{officer.name}</b><small>Sales officer</small></span><span className="officer-load"><small>LEAD LOAD</small><b>{officer.assigned}</b><small>CALLS TODAY</small><b>{officer.calls}</b></span></div>)}</aside>}
    </section>
    {notice && <div className="toast" role="status">{notice}<button aria-label="Dismiss" onClick={() => setNotice("")}>×</button></div>}
    {activeLead && <div className="modal-layer" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="call-title"><button className="modal-close" onClick={() => setActiveLead(null)} aria-label="Close">×</button><p className="eyebrow">CALL LOG</p><h2 id="call-title">Update {activeLead.name}</h2><div className="lead-summary"><b>#{activeLead.id} · {activeLead.model}</b><span>{activeLead.source} lead</span><small>{activeLead.phone} · {activeLead.city || "—"}</small></div>{nextOutcomes[activeLead.status]?.length ? <><div className="form-grid"><label>Next outcome<select value={outcome} onChange={event => { setOutcome(event.target.value); if (!["CALLBACK", "WALKIN"].includes(event.target.value)) setFollowUpAt(""); }}>{nextOutcomes[activeLead.status].map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>{["CALLBACK", "WALKIN"].includes(outcome) && <label>{outcome === "WALKIN" ? "Walk-in appointment" : "Follow-up time"}<input type="datetime-local" required min={localDateTime()} value={followUpAt} onChange={event => setFollowUpAt(event.target.value)} /></label>}</div><label>Remarks<textarea maxLength={500} value={remarks} onChange={event => setRemarks(event.target.value)} placeholder="Add a clear note from the conversation" /></label><footer><button className="filter" onClick={() => setActiveLead(null)}>Cancel</button><button className="button primary" disabled={(["CALLBACK", "WALKIN"].includes(outcome) && !followUpAt) || !outcome} onClick={() => void saveCall()}>Save call log</button></footer></> : <p className="subtext">This lead is closed. Reopen it before recording another outcome.</p>}</section></div>}
  </section>;
}
