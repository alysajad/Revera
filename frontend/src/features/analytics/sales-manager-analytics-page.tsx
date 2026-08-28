"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { exportSalesManagerAnalytics, getSalesManagerAnalytics, sourceName, type ManagerAnalytics, type ManagerPerformanceRow, type ManagerRoleRow } from "@/lib/crm";
import { formatDate, formatDateTime } from "@/lib/dates";

const tabs = [
  ["overview", "Overview"],
  ["cre", "CRE"],
  ["ps", "PS/SO"],
  ["source", "Source"],
  ["ops", "Ops risks"],
] as const;

const metricFilters: Record<string, Record<string, string>> = {
  untouched: { status: "FRESH" },
  qualified: { status: "QUALIFIED" },
  booked: { sales_outcome: "BOOKED" },
  retailed: { sales_outcome: "RETAILED" },
  conversion: { sales_outcome: "RETAILED" },
};

function metricDelta(value?: number) {
  if (!value) return "0";
  return `${value > 0 ? "+" : ""}${value}`;
}

function leadHref(filters: Record<string, string>, extra: Record<string, string> = {}) {
  const params = new URLSearchParams({ ...filters, ...extra });
  return `/manager/leads${params.toString() ? `?${params}` : ""}`;
}

function RoleTable({ title, section, rows, filters, onExport }: { title: string; section: "cre" | "ps"; rows: ManagerRoleRow[]; filters: Record<string, string>; onExport: (section: string) => void }) {
  const router = useRouter();
  return <article className="panel manager-table-card"><header className="manager-card-head"><div><p className="eyebrow">{section === "cre" ? "LEAD HANDLING" : "SALES CONVERSION"}</p><h2>{title}</h2></div><button className="filter" onClick={() => onExport(section)}>Export CSV</button></header><div className="manager-table-scroll"><table className="sales-table manager-table"><thead><tr><th>Name</th><th>Total</th><th>Calls</th><th>Qualified</th><th>Booked</th><th>Retailed</th><th>Lost</th><th>Conv.</th><th>Last call</th></tr></thead><tbody>{rows.length ? rows.map(row => { const href = leadHref(filters, section === "cre" ? { cre: String(row.id) } : { ps: String(row.id) }); return <tr className="manager-clickable-row" key={row.id} role="link" tabIndex={0} onClick={() => router.push(href)} onKeyDown={event => { if (event.key === "Enter") router.push(href); }}><td><b>{row.name}</b><small>{row.email}</small></td><td>{row.total}</td><td>{row.calls}</td><td>{row.qualified}</td><td>{row.booked}</td><td>{row.retailed}</td><td>{row.lost}</td><td><span className="manager-rate">{row.conversion_rate}%</span></td><td>{formatDateTime(row.last_activity) || "-"}</td></tr>; }) : <tr><td colSpan={9} className="sales-empty">No users have branch activity in this period.</td></tr>}</tbody></table></div></article>;
}

function PerformanceTable({ title, section, labelKey, rows, filters, onExport }: { title: string; section: "source" | "models"; labelKey: "source" | "model"; rows: (ManagerPerformanceRow & Record<string, string | number>)[]; filters: Record<string, string>; onExport: (section: string) => void }) {
  const router = useRouter();
  return <article className="panel manager-table-card"><header className="manager-card-head"><div><p className="eyebrow">CONVERSION MIX</p><h2>{title}</h2></div><button className="filter" onClick={() => onExport(section)}>Export CSV</button></header><div className="manager-table-scroll"><table className="sales-table manager-table"><thead><tr><th>{labelKey === "source" ? "Source" : "Model"}</th><th>Total</th><th>Qualified</th><th>Booked</th><th>Retailed</th><th>Lost</th><th>Conv.</th></tr></thead><tbody>{rows.length ? rows.map(row => { const name = String(row[labelKey] || "Unknown"); const filter: Record<string, string> = labelKey === "source" ? { source: name } : { model: name }; const clickable = labelKey === "source" || name !== "Model not set"; const href = leadHref(filters, filter); return <tr className={clickable ? "manager-clickable-row" : ""} key={name} role={clickable ? "link" : undefined} tabIndex={clickable ? 0 : undefined} onClick={clickable ? () => router.push(href) : undefined} onKeyDown={clickable ? event => { if (event.key === "Enter") router.push(href); } : undefined}><td><b>{labelKey === "source" ? sourceName(name) : name}</b></td><td>{row.total}</td><td>{row.qualified}</td><td>{row.booked}</td><td>{row.retailed}</td><td>{row.lost}</td><td><span className="manager-rate">{row.conversion_rate}%</span></td></tr>; }) : <tr><td colSpan={7} className="sales-empty">No rows for this period.</td></tr>}</tbody></table></div></article>;
}

export function SalesManagerAnalyticsPage() {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number][0]>("overview");
  const [range, setRange] = useState("mtd");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [source, setSource] = useState("");
  const [model, setModel] = useState("");
  const [cre, setCre] = useState("");
  const [ps, setPs] = useState("");
  const [data, setData] = useState<ManagerAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const params = useMemo(() => ({ range, ...(range === "custom" && dateFrom ? { date_from: dateFrom } : {}), ...(range === "custom" && dateTo ? { date_to: dateTo } : {}), ...(source ? { source } : {}), ...(model ? { model } : {}), ...(cre ? { cre } : {}), ...(ps ? { ps } : {}) }), [cre, dateFrom, dateTo, model, ps, range, source]);
  const drilldownFilters = useMemo<Record<string, string>>(() => ({ range, ...(data?.date_from ? { date_from: String(data.date_from) } : {}), ...(data?.date_to ? { date_to: String(data.date_to) } : {}), ...(source ? { source } : {}), ...(model ? { model } : {}), ...(cre ? { cre } : {}), ...(ps ? { ps } : {}) }), [cre, data?.date_from, data?.date_to, model, ps, range, source]);
  const load = useCallback(async () => { setLoading(true); setError(""); try { setData(await getSalesManagerAnalytics(params)); } catch (err) { setError(err instanceof Error ? err.message : "Unable to load sales manager analytics."); } finally { setLoading(false); } }, [params]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const sources = data?.source.map(row => row.source) || [];
  const models = data?.models.map(row => row.model).filter(modelName => modelName !== "Model not set") || [];
  const maxFunnel = Math.max(...(data?.funnel.map(item => item.count) || [1]));
  const exportSection = (section: string) => void exportSalesManagerAnalytics(section, params).catch(err => setError(err instanceof Error ? err.message : "Export failed."));
  const currentStateBuckets: { label: string; count: number; filter: Record<string, string> }[] = data ? [
    { label: "Callback", count: data.status.find(row => row.status === "CALLBACK")?.count || 0, filter: { status: "CALLBACK" } },
    { label: "Pending", count: data.status.find(row => row.status === "PENDING")?.count || 0, filter: { status: "PENDING" } },
    { label: "Qualified", count: data.status.find(row => row.status === "QUALIFIED")?.count || 0, filter: { status: "QUALIFIED" } },
    { label: "Lost / Unqualified", count: data.status.filter(row => ["LOST", "UNQUALIFIED"].includes(row.status)).reduce((total, row) => total + row.count, 0), filter: { status_group: "lost_or_unqualified" } },
  ] : [];

  return <section className="page manager-page">
    <div className="sales-hero manager-hero"><div><p className="eyebrow">SALES MANAGER</p><h1>Branch analytics <span>{data?.branch || ""}</span></h1><p className="subtext">Full branch visibility across lead intake, CRE handling, PS/SO conversion, follow-up load, and lost-lead risk.</p></div><div className="sales-hero-actions"><select className="filter" value={range} onChange={event => setRange(event.target.value)}><option value="mtd">MTD vs previous MTD</option><option value="today">Today</option><option value="custom">Date range</option><option value="all">All time</option></select>{range === "custom" && <><input className="filter" value={dateFrom} onChange={event => setDateFrom(event.target.value)} placeholder="DD/MM/YYYY" /><input className="filter" value={dateTo} onChange={event => setDateTo(event.target.value)} placeholder="DD/MM/YYYY" /></>}<button className="filter" onClick={() => void load()}>Refresh</button></div></div>
    {error && <div className="empty-state">{error}</div>}
    {loading && !data ? <div className="panel sales-analytics-loading">Loading branch analytics...</div> : data && <>
      <section className="manager-filter-bar panel"><label>Source<select value={source} onChange={event => setSource(event.target.value)}><option value="">All sources</option>{sources.map(item => <option value={item} key={item}>{sourceName(item)}</option>)}</select></label><label>Model<select value={model} onChange={event => setModel(event.target.value)}><option value="">All models</option>{models.map(item => <option value={item} key={item}>{item}</option>)}</select></label><label>CRE<select value={cre} onChange={event => setCre(event.target.value)}><option value="">All CRE</option>{data.cre.map(row => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label><label>PS/SO<select value={ps} onChange={event => setPs(event.target.value)}><option value="">All PS/SO</option>{data.ps.map(row => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label></section>
      <section className="sales-metrics manager-metrics">{[["Total leads", data.summary.total, "total"], ["Untouched", data.summary.untouched, "untouched"], ["Qualified", data.summary.qualified, "qualified"], ["Booked", data.summary.booked, "booked"], ["Retailed", data.summary.retailed, "retailed"], ["Lead to retail", `${data.summary.lead_to_retail_rate}%`, "conversion"]].map(([label, value, key]) => <Link className="sales-metric manager-metric" key={key} href={leadHref(drilldownFilters, metricFilters[String(key)] || {})}><span>{label}</span><strong>{value}</strong><small>{key === "conversion" ? `${data.summary.qualified_to_booked_rate}% qualified to booked` : data.range === "mtd" ? `${metricDelta(data.summary.delta?.[String(key)] as number)} vs prev MTD` : "Selected period"}</small></Link>)}</section>
      <nav className="sales-tabs manager-tabs" aria-label="Analytics sections">{tabs.map(([key, label]) => <button key={key} className={activeTab === key ? "active" : ""} onClick={() => setActiveTab(key)}>{label}</button>)}</nav>
      {activeTab === "overview" && <section className="manager-overview-grid"><article className="panel manager-funnel"><header className="manager-card-head"><div><p className="eyebrow">FUNNEL LEAKAGE</p><h2>Lead to retail path</h2></div><Link className="filter" href={leadHref(drilldownFilters)}>Open leads</Link></header>{data.funnel.map(item => <div className="manager-funnel-row" key={item.key}><span>{item.label}</span><div><i style={{ width: `${Math.max(3, (item.count / maxFunnel) * 100)}%` }} /></div><b>{item.count}</b><small>{item.rate}%</small></div>)}</article><article className="panel manager-risk-card"><p className="eyebrow">OPS RISKS</p><h2>Needs attention</h2><div className="manager-risk-list"><Link href={leadHref(drilldownFilters, { status: "FRESH", risk: "stale" })}><b>{data.summary.stale_untouched}</b><span>stale untouched leads</span></Link><Link href={leadHref(drilldownFilters, { followup: "overdue" })}><b>{data.followups.overdue}</b><span>overdue follow-ups</span></Link><Link href={leadHref(drilldownFilters, { flagged: "true" })}><b>{data.summary.flagged}</b><span>flagged to manager</span></Link><Link href={leadHref(drilldownFilters, { status_group: "lost_or_unqualified" })}><b>{data.summary.lost}</b><span>lost or unqualified</span></Link></div></article></section>}
      {activeTab === "cre" && <RoleTable title="CRE performance" section="cre" rows={data.cre} filters={drilldownFilters} onExport={exportSection} />}
      {activeTab === "ps" && <RoleTable title="PS/SO performance" section="ps" rows={data.ps} filters={drilldownFilters} onExport={exportSection} />}
      {activeTab === "source" && <section className="manager-two-col"><PerformanceTable title="Source conversion" section="source" labelKey="source" rows={data.source} filters={drilldownFilters} onExport={exportSection} /><PerformanceTable title="Model conversion" section="models" labelKey="model" rows={data.models} filters={drilldownFilters} onExport={exportSection} /></section>}
      {activeTab === "ops" && <section className="manager-two-col"><article className="panel manager-table-card"><header className="manager-card-head"><div><p className="eyebrow">CURRENT PIPELINE</p><h2>Current lead states</h2></div></header><div className="manager-list">{currentStateBuckets.map(row => <Link href={leadHref(drilldownFilters, row.filter)} key={row.label}><span>{row.label}</span><b>{row.count}</b></Link>)}</div></article><article className="panel manager-table-card"><header className="manager-card-head"><div><p className="eyebrow">STALE LEADS</p><h2>Oldest untouched</h2></div><button className="filter" onClick={() => exportSection("stale_leads")}>Export CSV</button></header><div className="manager-list">{data.stale_leads.length ? data.stale_leads.map(row => <Link href={leadHref(drilldownFilters, { status: "FRESH", risk: "stale", q: row.phone })} key={row.id}><span>{row.name}<small>{sourceName(row.source)} - {row.model_interest || "Model not set"} - {formatDate(row.created_at)}</small></span><b>#{String(row.id).padStart(6, "0")}</b></Link>) : <p className="subtext">No stale untouched leads.</p>}</div></article></section>}
    </>}
  </section>;
}
