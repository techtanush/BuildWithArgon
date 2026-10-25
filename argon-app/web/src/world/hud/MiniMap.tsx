// OWNER: mahin
import type { Manifest } from '../../shared/contracts';
export function MiniMap({ manifest, position, yaw, onOpen }: {
    manifest: Manifest;
    position: [
        number,
        number
    ];
    yaw: number;
    onOpen: () => void;
}) { const nodes = new Map(manifest.roads.nodes.map(n => [n.id, n.pos])); const scale = .39, map = (n: number) => 100 + n * scale; return <button className="city-minimap" onClick={onOpen} aria-label="Open city minimap"><svg viewBox="0 0 200 200" role="img" aria-label="Street grid with your current position"><rect width="200" height="200" rx="6" fill="#242e2d"/><rect x="191" width="9" height="200" fill="#507e87"/>{manifest.roads.edges.map(([a, b], i) => { const p = nodes.get(a), q = nodes.get(b); return p && q ? <line key={i} x1={map(p[0])} y1={map(p[1])} x2={map(q[0])} y2={map(q[1])} stroke="#76817c" strokeWidth="2.5"/> : null; })}{manifest.buildings.map(b => <rect key={b.building_id} x={map(b.plot_center[0]) - 3} y={map(b.plot_center[1]) - 3} width="6" height="6" fill={b.color} rx="1"/>)}<path d="M0,-6 L4,5 L0,3 L-4,5 Z" transform={`translate(${map(position[0])} ${map(position[1])}) rotate(${-yaw * 180 / Math.PI})`} fill="#f2d27e" stroke="#fff6d5" strokeWidth="1"/><text x="10" y="16" fill="#c1c8bc" fontSize="8">N ↑</text></svg><span>CITY MAP <kbd>M</kbd></span></button>; }
