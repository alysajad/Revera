"use client";

import { useEffect, useState } from "react";
import { getAdminAnalytics, getOfficers, toOfficer, type Officer } from "@/lib/crm";

export function TeamPage() {
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    void Promise.all([getOfficers(), getAdminAnalytics()])
      .then(([records, analytics]) => setOfficers(records.map(record => toOfficer(record, analytics.officers.find(item => item.id === record.id)))))
      .catch(requestError => setError(requestError instanceof Error ? requestError.message : "Unable to load team."));
  }, []);
  return <section className="page"><div className="page-heading compact"><div><p className="eyebrow">YOUR CREW</p><h1>Team <span>on the road.</span></h1><p className="subtext">Live workload and conversion activity for active sales officers.</p></div></div>{error && <div className="empty-state">{error}</div>}<section className="team-grid">{officers.length ? officers.map(officer => <article className="team-card" key={officer.id}><header><span className={`avatar ${officer.color}`}>{officer.initials}</span><div><h2>{officer.name}</h2><small>Sales officer</small></div><em>ACTIVE</em></header><div className="team-numbers"><span>ASSIGNED<b>{officer.assigned}</b></span><span>CALLED<b>{officer.calls}</b></span><span>WON<b>{officer.won}</b></span></div></article>) : !error && <div className="empty-state">No active sales officers yet.</div>}</section></section>;
}
