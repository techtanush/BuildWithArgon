// OWNER: mahin
import { useMemo, useState } from "react";
import type { Manifest, ManifestBuilding } from "../../shared/contracts";
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
  const agents = useMemo(
    () =>
      manifest.npcs.filter((n) => {
        const b = manifest.buildings.find(
          (b) => b.building_id === n.building_id,
        );
        return (
          (!selected || n.building_id === selected.building_id) &&
          `${n.display_name} ${n.title} ${n.department_id} ${b?.name ?? "plaza"}`
            .toLowerCase()
            .includes(query.toLowerCase())
        );
      }),
    [manifest, query, selected],
  );
  const urban=manifest.roads.nodes.some(n=>n.id.startsWith("J:"));
  const scale=urban?1.12:1.65;
  const map = (x: number) => x * scale + 300;
  const nodes=new Map(manifest.roads.nodes.map(n=>[n.id,n.pos]));
  return (
    <div
      className="world-modal map-modal"
      role="dialog"
      aria-modal="true"
      aria-label="City directory"
    >
      <header>
        <div>
          <span className="eyebrow">FOUNDRY / CITY DIRECTORY</span>
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
            {urban&&<><text x="74" y="88" fill="#757b70" fontSize="10" letterSpacing="2">PACIFIC HEIGHTS</text><text x="355" y="88" fill="#757b70" fontSize="10" letterSpacing="2">DOWNTOWN</text><text x="220" y="540" fill="#757b70" fontSize="10" letterSpacing="2">FOUNDRY QUARTER</text></>}
            {manifest.buildings.map((b) => (
              <g key={b.department_id}>
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`Select ${b.name}`}
                  onClick={() => setSelected(b)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") setSelected(b);
                  }}
                  className="map-building"
                >
                  <rect
                    x={map(b.plot_center[0]) - 19}
                    y={map(b.plot_center[1]) - 19}
                    width="38"
                    height="38"
                    rx="6"
                    fill={
                      selected?.department_id === b.department_id
                        ? "#29382f"
                        : b.color
                    }
                    stroke="#fffdf4"
                    strokeWidth="3"
                  />
                  <text
                    x={map(b.plot_center[0])}
                    y={map(b.plot_center[1]) + 4}
                    textAnchor="middle"
                    fill="white"
                    fontSize="11"
                  >
                    {b.code}
                  </text>
                </g>
              </g>
            ))}
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
            Show everyone
          </button>
        </div>
        <section className="directory">
          <label className="search-label">
            <span>Search people or departments</span>
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected(null);
              }}
              placeholder="Try Priya, engineering, research…"
            />
          </label>
          <div className="directory-title">
            {selected?.name ?? "Everyone in Foundry"}
            <span>{agents.length} people</span>
          </div>
          <div className="directory-list">
            {agents.map((n) => (
              <article className="directory-person" key={n.agent_id}>
                <div
                  className="person-initial"
                  style={{
                    background:
                      manifest.buildings.find(
                        (b) => b.department_id === n.department_id,
                      )?.color ?? "#b49b56",
                  }}
                >
                  {n.display_name[0]}
                </div>
                <div>
                  <strong>{n.display_name}</strong>
                  <small>{n.title}</small>
                  <div className="person-actions">
                    <button onClick={() => onTravel(n.agent_id)}>
                      Take me there <span>↗</span>
                    </button>
                    {n.agent_id !== manifest.plaza.concierge.agent_id && (
                      <button onClick={() => onRace(n.agent_id)}>
                        Race there
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
            {!agents.length && (
              <p className="empty-state">
                No matching people. Try another name or department.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
