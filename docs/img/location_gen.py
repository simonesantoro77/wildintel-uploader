"""Generate the location lifecycle diagram as SVG and editable draw.io."""
from pathlib import Path
from xml.sax.saxutils import quoteattr

OUT = Path(__file__).resolve().parent
WIDTH, HEIGHT = 960, 550
boxes = [
    ("planned", "Planned", "Only in Settings", 30, "#fffbeb", "#f59e0b", "#92400e"),
    ("pending", "Pending", "Not started yet", 260, "#f5f3ff", "#8b5cf6", "#5b21b6"),
    ("ready", "Ready", "Started; no camera", 490, "#eff6ff", "#2563eb", "#1e3a8a"),
    ("active", "Active", "Camera in the field", 720, "#ecfdf5", "#10b981", "#065f46"),
]


def generate():
    svg = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" viewBox="0 0 {WIDTH} {HEIGHT}" role="img" aria-labelledby="title description" font-family="Inter, Segoe UI, sans-serif">',
        '<title id="title">The life of a location</title>',
        '<desc id="description">Planned, pending, ready, active and archived states, with transitions by settings or visits. Archived is final.</desc>',
        '<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="#475569"/></marker></defs>',
        '<rect width="960" height="550" rx="18" fill="#fff" stroke="#d4d4d8"/>',
        '<text x="30" y="40" font-size="15" font-weight="700" fill="#2563eb" letter-spacing="1">THE LIFE OF A LOCATION</text>',
        '<text x="30" y="68" font-size="13" fill="#475569">A site with coordinates, a timezone and a summer-time setting.</text>',
    ]
    cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>']

    def vertex(id, value, x, y, w, h, style):
        cells.append(f'<mxCell id="{id}" value={quoteattr(value)} style={quoteattr(style)} vertex="1" parent="1"><mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>')

    def edge(id, source, target, label, points=(), style=""):
        coords = "".join(f'<mxPoint x="{x}" y="{y}"/>' for x, y in points)
        path = f'<Array as="points">{coords}</Array>' if coords else ""
        base = "edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;strokeColor=#475569;strokeWidth=2;labelBackgroundColor=#ffffff;fontSize=11;"
        cells.append(f'<mxCell id="{id}" value={quoteattr(label)} style={quoteattr(base + style)} edge="1" parent="1" source="{source}" target="{target}"><mxGeometry relative="1" as="geometry">{path}</mxGeometry></mxCell>')

    for id, title, sub, x, fill, stroke, color in boxes:
        svg += [
            f'<rect x="{x}" y="190" width="160" height="80" rx="12" fill="{fill}" stroke="{stroke}" stroke-width="2"/>',
            f'<text x="{x + 80}" y="222" text-anchor="middle" font-size="17" font-weight="700" fill="{color}">{title}</text>',
            f'<text x="{x + 80}" y="245" text-anchor="middle" font-size="12" fill="{color}">{sub}</text>',
        ]
        vertex(id, f"<b>{title}</b><br><font style='font-size:12px'>{sub}</font>", x, 190, 160, 80,
               f"rounded=1;whiteSpace=wrap;html=1;fillColor={fill};strokeColor={stroke};strokeWidth=2;fontColor={color};fontSize=17;")

    svg += [
        '<path d="M190 230 H255" fill="none" stroke="#475569" stroke-width="2" marker-end="url(#arrow)"/>',
        '<path d="M420 230 H485" fill="none" stroke="#475569" stroke-width="2" marker-end="url(#arrow)"/>',
        '<path d="M650 230 H715" fill="none" stroke="#475569" stroke-width="2" marker-end="url(#arrow)"/>',
        '<text x="225" y="208" text-anchor="middle" font-size="11" fill="#475569">Settings</text>',
        '<text x="455" y="202" text-anchor="middle" font-size="11" fill="#475569">Site start</text>',
        '<text x="455" y="217" text-anchor="middle" font-size="11" fill="#475569">or Settings</text>',
        '<text x="685" y="208" text-anchor="middle" font-size="11" fill="#475569">Install</text>',
        '<path d="M340 190 V132 H800 V185" fill="none" stroke="#475569" stroke-width="2" marker-end="url(#arrow)"/>',
        '<rect x="463" y="119" width="215" height="24" rx="8" fill="#fff"/>',
        '<text x="570" y="136" text-anchor="middle" font-size="12" fill="#475569">Site start + Installation</text>',
        '<path d="M800 270 V313 H625 V275" fill="none" stroke="#475569" stroke-width="2" marker-end="url(#arrow)"/>',
        '<rect x="632" y="300" width="160" height="25" rx="8" fill="#fff"/>',
        '<text x="712" y="317" text-anchor="middle" font-size="11" fill="#475569">Camera removed or stolen</text>',
        '<path d="M340 270 V345 H110 V275" fill="none" stroke="#475569" stroke-width="2" marker-end="url(#arrow)"/>',
        '<path d="M570 270 V345 H340" fill="none" stroke="#475569" stroke-width="2"/>',
        '<rect x="248" y="332" width="184" height="25" rx="8" fill="#fff"/>',
        '<text x="340" y="349" text-anchor="middle" font-size="12" fill="#475569">Settings: return to Planned *</text>',
        '<rect x="365" y="405" width="230" height="65" rx="12" fill="#f1f5f9" stroke="#64748b" stroke-width="2"/>',
        '<text x="480" y="433" text-anchor="middle" font-size="17" font-weight="700" fill="#334155">Archived</text>',
        '<text x="480" y="453" text-anchor="middle" font-size="12" fill="#475569">Out of use for good</text>',
        '<text x="480" y="380" text-anchor="middle" font-size="12" fill="#475569">Archive: Settings * from any state, or an Archive visit</text>',
        '<path d="M480 388 V400" fill="none" stroke="#475569" stroke-width="2" marker-end="url(#arrow)"/>',
        '<text x="30" y="502" font-size="12" fill="#64748b">* Settings can mark a site Planned or Archived only when no camera is out and no visit is still due.</text>',
        '<text x="30" y="522" font-size="12" fill="#64748b">Settings can also change non-archived states subject to visit history. Archived is final.</text>',
        '</svg>',
    ]
    vertex("archived", "<b>Archived</b><br><font style='font-size:12px'>Out of use for good</font>", 365, 405, 230, 65,
           "rounded=1;whiteSpace=wrap;html=1;fillColor=#f1f5f9;strokeColor=#64748b;strokeWidth=2;fontColor=#334155;fontSize=17;")
    edge("planned-pending", "planned", "pending", "Settings")
    edge("pending-ready", "pending", "ready", "Site start or Settings")
    edge("ready-active", "ready", "active", "Installation")
    edge("pending-active", "pending", "active", "Site start + Installation", [(340, 132), (800, 132)],
         "exitX=0.5;exitY=0;entryX=0.5;entryY=0;")
    edge("active-ready", "active", "ready", "Camera removed or stolen", [(800, 313), (625, 313)],
         "exitX=0.5;exitY=1;entryX=0.84;entryY=1;")
    edge("pending-planned", "pending", "planned", "Settings *", [(340, 345), (110, 345)],
         "exitX=0.5;exitY=1;entryX=0.5;entryY=1;")
    edge("ready-planned", "ready", "planned", "Settings *", [(570, 365), (110, 365)],
         "exitX=0.5;exitY=1;entryX=0.5;entryY=1;")
    for id in ("planned", "pending", "ready", "active"):
        edge(f"{id}-archived", id, "archived", "Settings * or Archive visit" if id == "active" else "Settings *")
    vertex("note", "* Planned or Archived only when no camera is out and no visit is still due. Settings may change other non-archived states subject to visit history. Archived is final.",
           30, 485, 900, 45, "text;html=1;whiteSpace=wrap;align=left;fontSize=12;fontColor=#64748b;")
    drawio = f'<mxfile host="app.diagrams.net"><diagram name="The life of a location" id="location"><mxGraphModel dx="1000" dy="600" grid="1" gridSize="10" page="1" pageWidth="{WIDTH}" pageHeight="{HEIGHT}"><root>{"".join(cells)}</root></mxGraphModel></diagram></mxfile>'
    (OUT / "location.svg").write_text("\n".join(svg) + "\n", encoding="utf-8")
    (OUT / "location.drawio").write_text(drawio, encoding="utf-8")


if __name__ == "__main__":
    generate()
