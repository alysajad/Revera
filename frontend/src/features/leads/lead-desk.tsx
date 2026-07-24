"use client";

import { useMemo, useState } from "react";
import { leads as initialLeads, officers as initialOfficers, sourceClass, type Lead } from "@/lib/crm";

export function LeadDesk({ officerMode = false }: { officerMode?: boolean }) {
  const [leads, setLeads] = useState(initialLeads);
  const [officers, setOfficers] = useState(initialOfficers);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [outcome, setOutcome] = useState("Callback");
  const [draggedOfficerId, setDraggedOfficerId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const visible = useMemo(() => leads.filter(lead => `${lead.name} ${lead.phone}`.toLowerCase().includes(query.toLowerCase())), [leads, query]);
  const assign = (lead: Lead, officerId: string) => {
    const officer = officers.find(item => item.id === officerId);
    if (!officer) return;
    setOfficers(current => current.map(item => item.id === officer.id ? { ...item, assigned: item.assigned + 1 } : item));
    setLeads(current => current.filter(item => item.id !== lead.id));
    setNotice(`${lead.name} assigned to ${officer.name}.`);
    setDropTargetId(null);
  };
  const autoAssign = () => {
    const count = leads.length;
    setOfficers(current => current.map((officer, index) => ({ ...officer, assigned: officer.assigned + Math.floor(count / current.length) + (index < count % current.length ? 1 : 0) })));
    setLeads([]);
    setNotice(`${count} leads assigned across four active officers.`);
  };
  const saveCall = () => {
    if (!activeLead) return;
    setLeads(current => current.map(lead => lead.id === activeLead.id ? { ...lead, status: outcome === "Interested / Qualified" ? "Qualified" : outcome === "Walk-in Booked" ? "Walk-in" : outcome === "Won (Sold)" ? "Won" : outcome === "Lost" ? "Lost" : "Callback" } : lead));
    setNotice(`Call log saved for ${activeLead.name}.`);
    setActiveLead(null);
  };

  return <section className="page">
    <div className="page-heading compact"><div><p className="eyebrow">{officerMode ? "MY QUEUE" : "ASSIGNMENT DESK"}</p><h1>{officerMode ? <>Keep the <span>promise.</span></> : <>Move leads to the <span>right rider.</span></>}</h1><p className="subtext">{officerMode ? "Four callbacks are due before 3:00 PM." : "Select leads, then assign them directly or use round robin."}</p></div>{!officerMode && <button className="button primary" onClick={autoAssign} disabled={!leads.length}>↻ Auto assign {leads.length} leads</button>}</div>
    <section className="lead-toolbar"><label className="search"><span>⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name or phone" /></label><button className="filter">Source: All ▾</button>{!officerMode && <p>Drag an officer onto a lead to assign it.</p>}</section>
    <section className={officerMode ? "lead-layout one-column" : "lead-layout"}>
      <article className="panel lead-pool"><header className="panel-heading"><div><p className="eyebrow">{officerMode ? "ACTIVE LEADS" : "UNASSIGNED"}</p><h2>{leads.length} leads in pool</h2></div></header><div className="lead-list">{visible.length ? visible.map(lead => <div className={`lead-row ${dropTargetId === lead.id ? "drop-target" : ""}`} key={lead.id} onDragOver={event => { if (!officerMode) { event.preventDefault(); setDropTargetId(lead.id); } }} onDragLeave={() => setDropTargetId(null)} onDrop={event => { event.preventDefault(); const officerId = event.dataTransfer.getData("application/revera-officer") || draggedOfficerId; if (officerId) assign(lead, officerId); setDraggedOfficerId(null); }}>{!officerMode && <span className="drag-slot">↓</span>}<div><b>{lead.name}</b><small>{lead.phone} · {lead.id}</small></div><span className={`badge ${sourceClass(lead.source)}`}>{lead.source}</span><span className="model">{lead.model}</span><span className={`status ${lead.status.toLowerCase()}`}>{lead.status}</span><button className="row-action" onClick={() => setActiveLead(lead)}>{officerMode ? "Log call →" : "Open →"}</button></div>) : <div className="empty-state">No leads match this view.</div>}</div></article>
      {!officerMode && <aside className="officer-rail"><header><p className="eyebrow">ACTIVE SALES OFFICERS</p><span>Drag a card to a lead row</span></header>{officers.map(officer => <div className={`officer-card ${draggedOfficerId === officer.id ? "dragging" : ""}`} key={officer.id} draggable onDragStart={event => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/revera-officer", officer.id); setDraggedOfficerId(officer.id); }} onDragEnd={() => { setDraggedOfficerId(null); setDropTargetId(null); }}><span className={`avatar ${officer.color}`}>{officer.initials}</span><span><b>{officer.name}</b><small>Sales officer</small></span><span className="officer-load"><small>LEAD LOAD</small><b>{officer.assigned}</b><small>CALLS TODAY</small><b>{officer.calls}</b></span></div>)}</aside>}
    </section>
    {notice && <div className="toast" role="status">{notice}<button aria-label="Dismiss" onClick={() => setNotice("")}>×</button></div>}
    {activeLead && <div className="modal-layer" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="call-title"><button className="modal-close" onClick={() => setActiveLead(null)} aria-label="Close">×</button><p className="eyebrow">CALL LOG</p><h2 id="call-title">Update {activeLead.name}</h2><div className="lead-summary"><b>{activeLead.id} · {activeLead.model}</b><span>{activeLead.source} lead</span><small>{activeLead.phone} · {activeLead.city}</small></div><div className="form-grid"><label>Call outcome<select value={outcome} onChange={event => setOutcome(event.target.value)}><option>Callback</option><option>RNR</option><option>Interested / Qualified</option><option>Walk-in Booked</option><option>Won (Sold)</option><option>Lost</option></select></label><label>Follow-up date<input type="datetime-local" defaultValue="2026-07-24T11:30" /></label></div><label>Remarks<textarea maxLength={500} placeholder="Add a clear note from the conversation" /></label><footer><button className="filter" onClick={() => setActiveLead(null)}>Cancel</button><button className="button primary" onClick={saveCall}>Save call log</button></footer></section></div>}
  </section>;
}
