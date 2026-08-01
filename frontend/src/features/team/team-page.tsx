"use client";

import { useEffect, useState } from "react";
import { getAdminAnalytics, getCres, getOfficers, toOfficer, type Officer } from "@/lib/crm";

export function TeamPage() {
  const [cres, setCres] = useState<Officer[]>([]);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    void Promise.all([getCres(), getOfficers(), getAdminAnalytics()])
      .then(([creRecords, officerRecords, analytics]) => {
        setCres(creRecords.map(record => toOfficer(record, analytics.cre.find(item => item.id === record.id))));
        setOfficers(officerRecords.map(record => toOfficer(record, analytics.officers.find(item => item.id === record.id))));
      })
      .catch(requestError => setError(requestError instanceof Error ? requestError.message : "Unable to load team."));
  }, []);
  const card = (officer: Officer, role: string) => <article className="team-card" key={`${role}-${officer.id}`}><header><span className={`avatar ${officer.color}`}>{officer.initials}</span><div><h2>{officer.name}</h2><small>{role}</small></div><em>ACTIVE</em></header><div className="team-numbers"><span>ASSIGNED<b>{officer.assigned}</b></span><span>CALLED<b>{officer.calls}</b></span><span>WON<b>{officer.won}</b></span></div></article>;
  return <section className="page"><div className="page-heading compact"><div><p className="eyebrow">YOUR CREW</p><h1>Team <span>on the road.</span></h1><p className="subtext">Live workload and conversion activity for CRE and PS/SO users.</p></div></div>{error && <div className="empty-state">{error}</div>}<p className="eyebrow">CRE</p><section className="team-grid">{cres.length ? cres.map(officer => card(officer, "CRE")) : !error && <div className="empty-state">No active CRE users yet.</div>}</section><p className="eyebrow" style={{ marginTop: "1.5rem" }}>PS/SO</p><section className="team-grid">{officers.length ? officers.map(officer => card(officer, "PS/SO")) : !error && <div className="empty-state">No active PS/SO users yet.</div>}</section></section>;
}
