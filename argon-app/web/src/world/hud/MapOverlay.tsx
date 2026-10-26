// OWNER: mahin
import { useMemo, useState } from "react";
import type { Manifest, ManifestBuilding } from "../../shared/contracts";
const departmentName = (b: ManifestBuilding) =>
  b.department_id === "chief-of-staff" ? "Executive HQ" :
  b.department_id === "growth" ? "Growth & Marketing" : b.department_name;
const labelLines = (name: string) => {
  const lines: string[] = [];
  for (const word of name.split(" ")) {
    if (!lines.length || (lines[lines.length - 1] + " " + word).length > 15) lines.push(word);
    else lines[lines.length - 1] += " " + word;
  }
  return lines;
};
export function MapOverlay({
  manifest,
  position,
  onTravel,
  onRace,
  onClose,
}: {
  manifest: Manifest;
  position: [number, number];
  onTravel: (id: string) => void;
  onRace: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ManifestBuilding | null>(null);
  const departments = useMemo(() => manifest.buildings.filter((b) => {
    const people = manifest.npcs.filter(n => n.department_id === b.department_id);
    return (!selected || selected.department_id === b.department_id) &&
      [departmentName(b), b.department_name, b.department_id, ...people.map(n => n.display_name + " " + n.title)]
        .join(" ").toLowerCase().includes(query.trim().toLowerCase());
  }).sort((a, b) => {
    const priority = (id: string) => id === "engineering" ? 0 : id === "growth" ? 1 : 2;
    return priority(a.department_id) - priority(b.department_id);
  }), [manifest, query, selected]);
  const executive=manifest.buildings.find(b=>b.department_id==="chief-of-staff");
  const executiveLead=manifest.npcs.find(n=>n.department_id==="chief-of-staff"&&n.is_lead);
  const urban=manifest.roads.nodes.some(n=>n.id.startsWith("J:"));
  const scale=urban?1.12:1.65;
  const map = (x: number) => x * scale + 300;
  const nodes=new Map(manifest.roads.nodes.map(n=>[n.id,n.pos]));
  // Keep readable labels within the map, separating nearby department plots.
  const labels = manifest.buildings.map(b => ({ b, x: Math.max(62, Math.min(538, map(b.plot_center[0]))), y: Math.max(32, Math.min(568, map(b.plot_center[1]))) }));
  for (let pass = 0; pass < 40; pass++) {
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i], b = labels[j], dx = b.x - a.x, dy = b.y - a.y;
      if (Math.abs(dx) < 120 && Math.abs(dy) < 54) {
        if (120 - Math.abs(dx) < 54 - Math.abs(dy)) {
          const shift = (120 - Math.abs(dx)) / 2 + 1;
          a.x -= (dx >= 0 ? 1 : -1) * shift; b.x += (dx >= 0 ? 1 : -1) * shift;
        } else {
          const shift = (54 - Math.abs(dy)) / 2 + 1;
          a.y -= (dy >= 0 ? 1 : -1) * shift; b.y += (dy >= 0 ? 1 : -1) * shift;
        }
        for (const p of [a,b]) { p.x = Math.max(62, Math.min(538,p.x)); p.y = Math.max(32, Math.min(568,p.y)); }
      }
    }
  }
  return (
    <div
      className="world-modal map-modal"
      role="dialog"
      aria-modal="true"
      aria-label="City directory"
    >
      <header>
        <div>
          <span className="eyebrow">YCBF / DEPARTMENT DIRECTORY</span>
          <h2>Explore the city</h2>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close map"
        >
          ×
        </button>
      </header>
      <div className="map-layout">
        <div className="town-map">
          <svg
            viewBox="0 0 600 600"
            role="img"
            aria-label="Map of thirteen department buildings"
          >
            <rect width="600" height="600" rx="10" fill="#d9d8ce" />
            {urban&&<><rect x="558" y="0" width="42" height="600" fill="#87b7c3"/><text x="580" y="300" transform="rotate(90 580 300)" textAnchor="middle" fill="#3b6e7c" fontSize="10" letterSpacing="3">THE BAY</text><rect x={map(10)} y={map(10)} width={52*scale} height={52*scale} fill="#afbd9d"/></>}
            {manifest.roads.edges.map(([a,b],i)=>{const p=nodes.get(a),q=nodes.get(b);return p&&q?<line key={i} x1={map(p[0])} y1={map(p[1])} x2={map(q[0])} y2={map(q[1])} stroke="#f8f5e9" strokeWidth={urban?12:8}/>:null;})}
            <text x="30" y="35" fill="#66736e" fontSize="12">N ↑</text>
            {urban&&<><text x="74" y="88" fill="#757b70" fontSize="10" letterSpacing="2">PACIFIC HEIGHTS</text><text x="355" y="88" fill="#757b70" fontSize="10" letterSpacing="2">DOWNTOWN</text><text x="220" y="540" fill="#757b70" fontSize="10" letterSpacing="2">YCBF QUARTER</text></>}
            {labels.map(({b,x,y}) => {
              const lines = labelLines(departmentName(b));
              return <g key={b.department_id}>
                <line x1={map(b.plot_center[0])} y1={map(b.plot_center[1])} x2={x} y2={y} stroke="#536557" strokeWidth="1.5" />
                <g role="button" tabIndex={0} aria-label={`Select ${departmentName(b)}`}
                  aria-pressed={selected?.department_id === b.department_id}
                  onClick={() => { setSelected(b); setQuery(""); }}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(b); setQuery(""); } }}
                  className="map-building">
                  <title>{departmentName(b)}</title>
                  <rect x={x - 58} y={y - 24} width="116" height="48" rx="8"
                    fill={selected?.department_id === b.department_id ? "#29382f" : "#fffdf4"}
                    stroke={b.color} strokeWidth="3" />
                  <text x={x} y={y - (lines.length - 1) * 8 + 5} textAnchor="middle"
                    fill={selected?.department_id === b.department_id ? "white" : "#20352b"} fontSize="14" fontWeight="700">
                    {lines.map((line, i) => <tspan key={i} x={x} dy={i ? 16 : 0}>{line}</tspan>)}
                  </text>
                </g>
              </g>;
            })}
            {!urban&&<circle cx="300" cy="300" r="48" fill="#f4f0df" stroke="#b8b9a3" />}
            <text
              x={map(manifest.plaza.fountain.pos[0])}
              y={map(manifest.plaza.fountain.pos[2])+3}
              textAnchor="middle"
              fill="#535c48"
              fontSize="9"
            >
              SQUARE
            </text>
            <circle
              cx={map(position[0])}
              cy={map(position[1])}
              r="7"
              fill="#cf653c"
              stroke="white"
              strokeWidth="3"
            />
          </svg>
          {executive&&executiveLead&&<button className="primary-button" onClick={()=>onTravel(executiveLead.agent_id)}>Enter Executive HQ · Conference room</button>}
          <div className="map-caption">
            <span>13 DEPARTMENTS / CONNECTED BY STREETS</span>
            <span>
              Your position <i />
            </span>
          </div>
          <button
            onClick={() => {
              setSelected(null);
              setQuery("");
            }}
            className="text-button"
          >
            Show all departments
          </button>
        </div>
        <section className="directory">
          <label className="search-label">
            <span>Search departments or people</span>
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected(null);
              }}
              placeholder="Try engineering, marketing, or a name…"
            />
          </label>
          <div className="directory-title">
            {selected ? departmentName(selected) : "Departments in YCBF"}
            <span>{departments.length} departments</span>
          </div>
          <div className="directory-list">
            {departments.map(b => {
              const lead = manifest.npcs.find(n => n.department_id === b.department_id && n.is_lead);
              return <article className={`directory-person directory-department${b.department_id === "engineering" || b.department_id === "growth" ? " department-featured" : ""}`} key={b.department_id} data-department={b.department_id} aria-label={departmentName(b)}>
                <div className="department-swatch" style={{background: b.color}} aria-hidden="true" />
                <div>
                  <strong>{departmentName(b)}</strong>
                  {lead && <small>Lead: {lead.display_name} · {lead.title}</small>}
                  <div className="person-actions">
                    <button disabled={!lead} aria-label={`Go to ${departmentName(b)}`} onClick={() => lead && onTravel(lead.agent_id)}>Go to department <span aria-hidden="true">↗</span></button>
                    <button disabled={!lead} aria-label={`Race to ${departmentName(b)}`} onClick={() => lead && onRace(lead.agent_id)}>Race there</button>
                  </div>
                </div>
              </article>;
            })}
            {!departments.length && <p className="empty-state">No matching departments. Try another department or person’s name.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
