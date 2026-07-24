import Link from "next/link";
import { leads, sourceClass } from "@/lib/crm";

const route = [["Enquiries", 128, "100%"], ["Contacted", 95, "74%"], ["Qualified", 42, "33%"], ["Walk-in", 19, "15%"], ["Won", 11, "9%"]] as const;
const widths = [100, 74, 33, 15, 9];

export function AdminDashboard() {
  return <section className="page">
    <div className="page-heading"><div><p className="eyebrow">JULY PERFORMANCE</p><h1>Your showroom, <span>in motion.</span></h1><p className="subtext">24 new enquiries landed today. Five still need an owner.</p></div><div className="period"><button className="selected">This month</button><button>Last month</button><button aria-label="Pick a date">▣</button></div></div>
    <section className="metric-grid">
      <Metric label="New leads" value="128" detail="vs. 108 last month" accent="+18.4%" dark />
      <Metric label="Qualified" value="42" suffix="/128" detail="32.8% qualification rate" />
      <Metric label="Walk-ins booked" value="19" detail="8 visits scheduled this week" />
      <Metric label="Retail conversions" value="11" detail="₹10.7L pipeline closed" />
    </section>
    <section className="dashboard-grid">
      <article className="panel"><PanelHeading eyebrow="LEAD HEALTH" title="Conversion route" action="View report →" href="/analytics" /><div className="funnel">{route.map(([label, value, percentage], index) => <div className="funnel-row" key={label}><span>{label}</span><div className="progress"><i className={label === "Won" ? "won" : ""} style={{ width: `${widths[index]}%` }} /></div><b>{value}</b><small>{percentage}</small></div>)}</div><div className="panel-foot"><span><i className="signal" />Healthy pace</span><span>17 leads need attention</span></div></article>
      <article className="panel"><PanelHeading eyebrow="ACQUISITION" title="Where demand starts" /><div className="source-split"><div className="donut"><div><b>128</b><small>total leads</small></div></div><ul className="source-list"><li><i className="meta-ads" /><span>Meta ads</span><b>51</b><small>39.8%</small></li><li><i className="website" /><span>Website</span><b>32</b><small>25.0%</small></li><li><i className="carwale" /><span>CarWale</span><b>21</b><small>16.4%</small></li><li><i className="walk-in" /><span>Walk-in</span><b>24</b><small>18.8%</small></li></ul></div></article>
    </section>
    <section className="panel table-panel"><PanelHeading eyebrow="OPERATOR QUEUE" title="Leads waiting for a handoff" action="Assign leads →" href="/leads" /><div className="table-scroll"><table><thead><tr><th>Customer</th><th>Source</th><th>Model interest</th><th>Enquired</th><th>Signal</th><th /></tr></thead><tbody>{leads.slice(0, 5).map(lead => <tr key={lead.id}><td><b>{lead.name}</b><small>{lead.id} · {lead.phone}</small></td><td><span className={`badge ${sourceClass(lead.source)}`}>{lead.source}</span></td><td>{lead.model}</td><td>{lead.enquiredAt}</td><td><span className={`status ${lead.status.toLowerCase()}`}>{lead.status}</span></td><td><Link className="row-action" href={`/leads?lead=${lead.id}`}>Open →</Link></td></tr>)}</tbody></table></div></section>
  </section>;
}

function Metric({ label, value, suffix, detail, accent, dark }: { label: string; value: string; suffix?: string; detail: string; accent?: string; dark?: boolean }) {
  return <article className={`metric ${dark ? "metric-dark" : ""}`}><p>{label} {accent && <em>{accent}</em>}</p><strong>{value}{suffix && <small>{suffix}</small>}</strong><span>{detail}</span><div className="metric-mark" /></article>;
}

function PanelHeading({ eyebrow, title, action, href }: { eyebrow: string; title: string; action?: string; href?: string }) {
  return <header className="panel-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>{action && href && <Link href={href}>{action}</Link>}</header>;
}
