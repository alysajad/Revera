import { officers } from "@/lib/crm";

export function TeamPage() {
  return <section className="page"><div className="page-heading compact"><div><p className="eyebrow">YOUR CREW</p><h1>Team <span>on the road.</span></h1><p className="subtext">Four active officers, 76 calls logged today.</p></div><button className="button primary">＋ Add officer</button></div><section className="team-grid">{officers.map(officer => <article className="team-card" key={officer.id}><header><span className={`avatar ${officer.color}`}>{officer.initials}</span><div><h2>{officer.name}</h2><small>Sales officer · Srinagar</small></div><em>ACTIVE</em></header><div className="team-numbers"><span>ASSIGNED<b>{officer.assigned}</b></span><span>CALLS TODAY<b>{officer.calls}</b></span><span>WON<b>{officer.won}</b></span></div></article>)}</section></section>;
}
