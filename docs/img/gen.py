"""Generates the .drawio files of the diagrams of the manual (visit-states, visit-actions, deployment, collection), to be edited in draw.io.

Run it from anywhere: python3 docs/img/gen.py — the files are written next to it. After editing one in draw.io, export it as SVG (File > Export as > SVG)
over the .svg of the same name; the manual shows the SVG. Running this again overwrites the .drawio files.
"""
from pathlib import Path
from xml.sax.saxutils import quoteattr

OUT = str(Path(__file__).resolve().parent) + "/"

class D:
    def __init__(s,name,w,h): s.name=name;s.w=w;s.h=h;s.c=[];s.n=2
    def box(s,x,y,w,h,title,sub,fill,stroke,tc,sc,dash=None,rr=12,fs=14,tag=None,label_only=False):
        i=tag or f"n{s.n}";s.n+=1
        v=f'<b>{title}</b>'+(f'<br><font style="font-size:11px" color="{sc}">{sub}</font>' if sub else '')
        st=(f'rounded=1;arcSize={rr};whiteSpace=wrap;html=1;fillColor={fill};strokeColor={stroke};strokeWidth=2;'
            f'fontColor={tc};fontSize={fs};'+(f'dashed=1;dashPattern={dash};' if dash else ''))
        s.c.append(f'<mxCell id="{i}" value={quoteattr(v)} style="{st}" vertex="1" parent="1"><mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>')
        return i
    def text(s,x,y,w,h,t,size=12,color="#64748b",bold=True,align="left"):
        i=f"n{s.n}";s.n+=1
        st=f'text;html=1;fontSize={size};fontColor={color};fontStyle={1 if bold else 0};align={align};verticalAlign=middle;spacingLeft=0;'
        s.c.append(f'<mxCell id="{i}" value={quoteattr(t)} style="{st}" vertex="1" parent="1"><mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>')
    def edge(s,a,b,label="",pts=None,exit=None,entry=None):
        pg=('<Array as="points">'+''.join(f'<mxPoint x="{x}" y="{y}"/>' for x,y in pts)+'</Array>') if pts else ''
        i=f"n{s.n}";s.n+=1
        st='edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;endFill=1;strokeColor=#475569;strokeWidth=2.5;fontSize=11;fontColor=#475569;labelBackgroundColor=#ffffff;'
        if exit: st+=f'exitX={exit[0]};exitY={exit[1]};exitDx=0;exitDy=0;'
        if entry: st+=f'entryX={entry[0]};entryY={entry[1]};entryDx=0;entryDy=0;'
        s.c.append(f'<mxCell id="{i}" value={quoteattr(label)} style="{st}" edge="1" parent="1" source="{a}" target="{b}"><mxGeometry relative="1" as="geometry">{pg}</mxGeometry></mxCell>')
    def save(s,fn):
        x=(f'<mxfile host="app.diagrams.net"><diagram name={quoteattr(s.name)} id="d1"><mxGraphModel dx="1000" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="{s.w}" pageHeight="{s.h}" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
           +''.join(s.c)+'</root></mxGraphModel></diagram></mxfile>')
        open(OUT+fn,'w').write(x)

GRAY=("#f1f5f9","#64748b","#334155","#475569"); AMB=("#fffbeb","#f59e0b","#92400e","#b45309")
GRN=("#ecfdf5","#10b981","#065f46","#047857"); RED=("#fef2f2","#ef4444","#991b1b","#b91c1c")
NOS=("#ffffff","#94a3b8","#475569","#64748b"); BLU=("#eff6ff","#2563eb","#1e3a8a","#1d4ed8")

# ---- actions: what can be done in a visit, by the state of the visit before it — as a drawio and as the svg the manual shows
STATE={"Deployed":AMB,"Collected":GRN,"Stolen":RED,"Not visited":GRAY,"No camera":NOS}
GROUPS=[
 (("No visit before",None),[("Installation","Deployed","site, camera, card: ready → active"),("Not visited","Not visited","no entity changes")]),
 (("Deployed","Collected"),[("Revision","Deployed","card collected → ready · left → active"),
   ("Revision + Desinstallation + Installation  (replacement)","Deployed","old camera, card → ready · new → active"),
   ("Revision + Desinstallation","No camera","site, camera, card → ready"),
   ("Revision + Desinstallation + Archive","No camera","camera, card → ready · site → archived")]),
 (("Deployed","Stolen"),[("Stolen","No camera","camera, card → archived · site → ready"),
   ("Stolen + Installation  (stolen and replaced)","Deployed","stolen ones archived · new → active"),
   ("Stolen + Archive","No camera","camera, card, site → archived")]),
 (("Deployed","Deployed"),[("Not visited","Not visited","no entity changes")]),
 (("No camera","final"),[("Installation","Deployed","site, camera, card: ready → active"),("Archive  (alone)","No camera","site → archived"),("Not visited","Not visited","no entity changes")]),
]
PITCH,GAP,TOP=34,12,100
def _layout():
    y=TOP;out=[]
    for head,rows in GROUPS:
        out.append((head,rows,y));y+=len(rows)*PITCH+GAP
    return out,y
LAY,ENDY=_layout()
H=ENDY+40
d=D("The actions of a visit",920,H)
d.text(30,22,600,28,"THE ACTIONS OF A VISIT, BY THE STATE OF THE VISIT BEFORE IT",15,"#2563eb")
HEADS=((30,"THE VISIT BEFORE"),(235,"ACTIONS OF THIS VISIT"),(550,"IT IS LEFT"),(670,"SITE, CAMERA AND CARD"))
for x,t in HEADS: d.text(x,62,300,24,t,11)
svg=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 {H}" width="920" height="{H}" role="img" aria-labelledby="t d" font-family="Inter, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif">',
 '  <title id="t">The actions of a visit</title>',
 '  <desc id="d">For each state of the visit before it — Deployed becoming Collected or Stolen, Deployed staying so, No camera, or no visit before — the actions a visit can do, the state it is left in and what it does to the cameras, the cards and the site.</desc>',
 '  <defs><marker id="a" viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="11" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#475569" /></marker></defs>',
 f'  <rect x="0" y="0" width="920" height="{H}" rx="18" fill="#ffffff" stroke="#d4d4d8" />',
 '  <text x="30" y="40" font-size="15" font-weight="700" fill="#2563eb" letter-spacing="1">THE ACTIONS OF A VISIT, BY THE STATE OF THE VISIT BEFORE IT</text>']
for x,t in HEADS: svg.append(f'  <text x="{x}" y="78" font-size="11" font-weight="700" fill="#64748b" letter-spacing="1">{t}</text>')
def chip_svg(x,y,w,name,dash=False,label=None):
    f,st,tc,_=STATE.get(name,GRAY)
    return (f'  <rect x="{x}" y="{y}" width="{w}" height="24" rx="8" fill="{f}" stroke="{st}" stroke-width="2"'+(' stroke-dasharray="4 3"' if dash else '')+' />'
            f'<text x="{x+w/2}" y="{y+16}" font-size="11.5" font-weight="700" fill="{tc}" text-anchor="middle">{label or name}</text>')
for (head,rows,y0) in LAY:
    h=len(rows)*PITCH-4; cy=y0+h/2
    svg.append(f'  <rect x="30" y="{y0}" width="190" height="{h}" rx="10" fill="#f8fafc" stroke="#e2e8f0" />')
    gid=d.box(30,y0,190,h,"","","#f8fafc","#e2e8f0","#334155","#475569",rr=10)
    if head[1] is None:
        svg.append(chip_svg(38,cy-12,174,"No visit before",True)); d.box(38,cy-12,174,24,"No visit before","",*GRAY[:1],"#94a3b8","#475569","#475569","4 3",rr=30,fs=11)
    elif head[1]=="final":
        svg.append(chip_svg(38,cy-12,174,"No camera",label="No camera · final state")); d.box(38,cy-12,174,24,"No camera · final state","",*STATE["No camera"][:3],STATE["No camera"][3],rr=30,fs=11)
    else:
        svg.append(chip_svg(38,cy-12,76,head[0])+chip_svg(136,cy-12,76,head[1])+f'<path d="M116 {cy} H134" stroke="#475569" stroke-width="2.5" fill="none" marker-end="url(#a)" />')
        c1=d.box(38,cy-12,76,24,head[0],"",*STATE[head[0]][:3],STATE[head[0]][3],rr=30,fs=11); c2=d.box(136,cy-12,76,24,head[1],"",*STATE[head[1]][:3],STATE[head[1]][3],rr=30,fs=11)
        d.edge(c1,c2)
    for i,(act,res,ent) in enumerate(rows):
        y=y0+i*PITCH; m=y+(PITCH-4)/2
        svg.append(f'  <path d="M220 {cy} H228 V{m} H235" stroke="#cbd5e1" stroke-width="1.5" fill="none" />')
        svg.append(f'  <rect x="235" y="{m-13}" width="300" height="26" rx="13" fill="#ffffff" stroke="#cbd5e1" /><text x="385" y="{m+4}" font-size="11.5" fill="#334155" text-anchor="middle">{act}</text>')
        svg.append(f'  <path d="M535 {m} H548" stroke="#475569" stroke-width="2.5" fill="none" marker-end="url(#a)" />')
        svg.append(chip_svg(550,m-12,105,res))
        svg.append(f'  <text x="670" y="{m+4}" font-size="10.5" fill="#475569">{ent}</text>')
        p=d.box(235,m-13,300,26,act.replace("  "," "),"","#ffffff","#cbd5e1","#334155","#475569",rr=50,fs=11)
        r=d.box(550,m-12,105,24,res,"",*STATE[res][:3],STATE[res][3],rr=30,fs=11)
        d.edge(p,r)
        d.text(670,m-10,230,20,ent,10.5,"#475569",False)
note="A visit before that was not visited does not count: the one before it decides. After an Archive the site is closed: no visit follows."
svg.append(f'  <text x="30" y="{ENDY+22}" font-size="12" fill="#64748b">{note}</text>')
d.text(30,ENDY+10,860,24,note,12,"#64748b",False)
svg.append('</svg>\n')
open(OUT+"visit-actions.svg","w",encoding="utf-8").write("\n".join(svg))
d.save("visit-actions.drawio")

# ---- states
d=D("The states of a visit",920,420)
d.text(40,28,400,28,"THE STATES OF A VISIT",15,"#2563eb")
for x,t in ((40,"BEFORE IT IS REGISTERED"),(520,"WHAT THE VISIT DID"),(720,"WHEN A LATER VISIT…")):
    d.text(x,70,200,28,t)
pl=d.box(30,104,170,76,"Planned","not made yet",GRAY[0],"#94a3b8","#334155","#475569","6 5",fs=17)
un=d.box(30,300,170,76,"Unknown","nothing is known of it","#f5f3ff","#a78bfa","#5b21b6","#6d28d9","6 5",fs=17)
rg=d.box(262,210,116,68,"The visit is<br>registered","",*BLU[:1],"#2563eb","#1e3a8a","#1e3a8a",rr=50)
dp=d.box(470,104,170,76,"Deployed","a camera is out",*AMB,fs=17)
ns=d.box(470,214,170,68,"No camera","no camera is out",*NOS)
nv=d.box(470,316,170,76,"Not visited","it could not be made",*GRAY,fs=17)
co=d.box(720,104,170,76,"Collected","its card was collected",*GRN,fs=17)
st=d.box(720,222,170,76,"Stolen","no images to import",*RED,fs=17)
d.edge(pl,rg,"it is made",exit=(0.5,1),entry=(0,0.35),pts=[(115,222),(262,222)])
d.edge(un,rg,"it is filled in",exit=(0.5,0),entry=(0,0.65),pts=[(115,266),(262,266)])
d.edge(rg,dp,"left a camera",exit=(1,0.2),entry=(0,0.5),pts=[(455,224),(455,142)])
d.edge(rg,ns,"left no camera",exit=(1,0.5),entry=(0,0.5))
d.edge(rg,nv,"not revised",exit=(1,0.8),entry=(0,0.5),pts=[(455,265),(455,354)])
d.edge(dp,co,"collects its card",exit=(1,0.25),entry=(0,0.25))
d.edge(dp,st,"finds the camera stolen",exit=(1,0.75),entry=(0,0.5),pts=[(682,161),(682,260)])
d.save("visit-states.drawio")

BLUB=("#eff6ff","#2563eb","#1e3a8a","#1e40af")
# ---- deployment
d=D("A deployment",920,400)
d.text(40,28,800,28,"A DEPLOYMENT IS THE IMAGES BETWEEN TWO CONSECUTIVE VISITS",15,"#2563eb")
d.box(40,58,840,34,"One location — some GPS coordinates and a timezone — one camera","",GRAY[0],"#94a3b8","#334155","#475569",rr=50,fs=13)
d.text(40,108,300,28,"THE VISIT THAT LEFT THE CAMERA"); d.text(580,108,300,28,"THE NEXT VISIT",align="right")
v1=d.box(40,136,170,104,"Visit R0001","left the camera<br>and its card",*AMB,fs=17)
dep=d.box(240,128,460,120,"Deployment R0001-DONA_01","the images taken by the camera between the two visits,<br>set up with the same height, tilt, delay between triggers…",*BLUB,fs=14)
v2=d.box(710,136,170,104,"Visit R0002","collected<br>the card",*GRN,fs=17)
d.edge(v1,dep);d.edge(dep,v2)
d.text(40,268,200,28,"ITS STATE")
d.box(40,296,270,76,"Open","the camera is still out: the<br>card has not been collected",*AMB,dash="6 5",fs=15)
d.box(325,296,270,76,"Closed","the card is collected: its<br>images can be imported",*GRN,fs=15)
d.box(610,296,270,76,"Camera stolen","the deployment is closed<br>and has no images",*RED,fs=15)
d.save("deployment.drawio")

# ---- collection
d=D("A collection",920,436)
d.text(40,28,800,28,"A COLLECTION IS ALL THE DEPLOYMENTS OF A REVISION",15,"#2563eb")
d.box(266,62,218,278,"Collection R0001","all closed","#eff6ff","#bfdbfe","#1e3a8a","#475569",rr=5,fs=16)
d.box(516,62,218,278,"Collection R0002","2 closed, 2 open","#eff6ff","#bfdbfe","#1e3a8a","#475569",rr=5,fs=16)
d.c[-2:]=[c.replace('fontColor=','verticalAlign=top;spacingTop=8;fontColor=') for c in d.c[-2:]]
for i,s in enumerate(["WICP_02_001","WICP_02_002","WICP_02_003","WICP_02_004"]):
    y=166+i*48
    d.text(40,y-14,180,28,s,13,"#334155")
    d.box(278,y-14,204,28,f"R0001-{s}","",*GRN[:3],GRN[3],fs=11)
    op=i>=2
    d.box(528,y-14,204,28,f"R0002-{s}","",*(AMB if op else GRN),dash="5 4" if op else None,fs=11)
    for cx,pl in ((250,False),(500,False),(750,op)):
        d.box(cx-15,y-15,30,30,"" if pl else "✓","",
              *(("#f8fafc","#94a3b8","#94a3b8","#94a3b8") if pl else ("#dcfce7","#16a34a","#15803d","#15803d")),dash="4 4" if pl else None,rr=50,fs=14)
for x,t in ((250,"visits R0001"),(500,"visits R0002"),(750,"visits R0003")): d.text(x-60,348,120,24,t,12,"#64748b",align="center")
d.text(40,380,800,24,"closed deployment: the next visit has collected its card · open deployment (dashed): the card is still to be collected",12,"#475569",False)
d.text(40,412,840,24,"A deployment belongs to the revision of the visit that left the camera: R0001-WICP_02_001 is of R0001.",12,"#64748b",False)
d.save("collection.drawio")


# ---- the life of the entities: a location, a camera, an SD card — what it is, and the states it goes through
def _esc(t): return t.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
LC={"Planned":("#fffbeb","#f59e0b","#92400e","#b45309"),"Ready":("#eff6ff","#2563eb","#1e3a8a","#1d4ed8"),
    "Active":("#ecfdf5","#10b981","#065f46","#047857"),"Archived":("#f1f5f9","#64748b","#334155","#475569")}
XS=[30,270,510,750]; BW=140
def lifecycle(fn,title,top,subs,labels,back,note,site=False,star=True):
    """top: (left, relation, right) boxes of what it is; subs: what each state means (2 lines each); labels: the label on each of the three arrows; back: the label of the way back."""
    import textwrap
    lines=textwrap.wrap(note,115)
    H=380+18*len(lines); svg=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 {H}" width="920" height="{H}" role="img" aria-labelledby="t d" font-family="Inter, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif">',
      f'  <title id="t">{_esc(title)}</title>', f'  <desc id="d">{_esc(note)}</desc>',
      '  <defs><marker id="a" viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="11" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#475569" /></marker></defs>',
      f'  <rect x="0" y="0" width="920" height="{H}" rx="18" fill="#ffffff" stroke="#d4d4d8" />',
      f'  <text x="30" y="40" font-size="15" font-weight="700" fill="#2563eb" letter-spacing="1">{_esc(title.upper())}</text>']
    d=D(title,920,H); d.text(30,22,800,28,title.upper(),15,"#2563eb")
    # what it is
    (l1,l2),rel,(r1,r2)=top
    svg.append(f'  <rect x="30" y="64" width="260" height="76" rx="12" fill="#f8fafc" stroke="#94a3b8" stroke-width="2" /><text x="160" y="95" font-size="15" font-weight="700" fill="#334155" text-anchor="middle">{_esc(l1)}</text><text x="160" y="117" font-size="11.5" fill="#475569" text-anchor="middle">{_esc(l2)}</text>')
    svg.append(f'  <rect x="630" y="64" width="260" height="76" rx="12" fill="#f8fafc" stroke="#94a3b8" stroke-width="2" /><text x="760" y="95" font-size="15" font-weight="700" fill="#334155" text-anchor="middle">{_esc(r1)}</text><text x="760" y="117" font-size="11.5" fill="#475569" text-anchor="middle">{_esc(r2)}</text>')
    svg.append(f'  <path d="M292 102 H628" stroke="#475569" stroke-width="2.5" fill="none" marker-end="url(#a)" />')
    for i,line in enumerate(rel):
        svg.append(f'  <text x="460" y="{77+i*15}" font-size="11.5" fill="#475569" text-anchor="middle"><tspan>{_esc(line)}</tspan></text>')
    a=d.box(30,64,260,76,l1,l2,"#f8fafc","#94a3b8","#334155","#475569",fs=15); b=d.box(630,64,260,76,r1,r2,"#f8fafc","#94a3b8","#334155","#475569",fs=15); d.edge(a,b,"<br>".join(rel))
    svg.append(f'  <text x="30" y="160" font-size="12" font-weight="700" fill="#64748b" letter-spacing="1">ITS STATES</text>')
    d.text(30,146,300,24,"ITS STATES",12)
    ids=[]
    for x,(name,sub) in zip(XS,subs):
        f,st,tc,sc=LC[name]
        svg.append(f'  <rect x="{x}" y="196" width="{BW}" height="90" rx="12" fill="{f}" stroke="{st}" stroke-width="2" /><text x="{x+BW/2}" y="226" font-size="17" font-weight="700" fill="{tc}" text-anchor="middle">{name}</text>')
        for i,line in enumerate(sub): svg.append(f'  <text x="{x+BW/2}" y="{248+i*15}" font-size="11" fill="{sc}" text-anchor="middle">{_esc(line)}</text>')
        ids.append(d.box(x,196,BW,90,name,"<br>".join(sub),f,st,tc,sc,fs=17))
    for i,lab in enumerate(labels):
        x1=XS[i]+BW; x2=XS[i+1]; w=len(lab)*5.6+22
        svg.append(f'  <path d="M{x1} 241 H{x2}" stroke="#475569" stroke-width="2.5" fill="none" marker-end="url(#a)" />')
        svg.append(f'  <rect x="{(x1+x2)/2-w/2}" y="204" width="{w}" height="20" rx="10" fill="#ffffff" stroke="#cbd5e1" /><text x="{(x1+x2)/2}" y="218" font-size="11" fill="#475569" text-anchor="middle">{_esc(lab)}</text>')
        d.edge(ids[i],ids[i+1],lab)
    # Settings can archive from any state: the way from Planned over the others
    xa=XS[0]+BW/2; xb=XS[3]+BW/2; lab="by settings *" if star else "by settings"; w=len(lab)*5.6+22
    svg.append(f'  <path d="M{xa} 196 V190 Q{xa} 178 {xa+12} 178 H{xb-12} Q{xb} 178 {xb} 190 V194" stroke="#475569" stroke-width="2.5" fill="none" marker-end="url(#a)" />')
    svg.append(f'  <rect x="{(xa+xb)/2-w/2}" y="168" width="{w}" height="20" rx="10" fill="#ffffff" stroke="#cbd5e1" /><text x="{(xa+xb)/2}" y="182" font-size="11" fill="#475569" text-anchor="middle">{lab}</text>')
    d.edge(ids[0],ids[3],lab,exit=(0.5,0),entry=(0.5,0),pts=[(xa,178),(xb,178)])
    if site:   # a ready site is archived by settings too, and goes back to planned by settings
        xr=XS[1]+BW/2
        svg.append(f'  <path d="M{xr} 196 V178" stroke="#475569" stroke-width="2.5" fill="none" />')
        svg.append(f'  <path d="M{XS[1]} 268 H{XS[0]+BW}" stroke="#475569" stroke-width="2.5" fill="none" marker-end="url(#a)" />')
        svg.append(f'  <rect x="{(XS[0]+BW+XS[1])/2-40}" y="258" width="80" height="20" rx="10" fill="#ffffff" stroke="#cbd5e1" /><text x="{(XS[0]+BW+XS[1])/2}" y="272" font-size="11" fill="#475569" text-anchor="middle">{"by settings *" if star else "by settings"}</text>')
        d.edge(ids[1],ids[0],"by settings *" if star else "by settings",exit=(0,0.8),entry=(1,0.8))
    # the way back, from Active to Ready
    x1=XS[2]+BW/2; x2=XS[1]+BW/2; w=len(back)*5.6+22
    svg.append(f'  <path d="M{x1} 286 V318 Q{x1} 330 {x1-12} 330 H{x2+12} Q{x2} 330 {x2} 318 V288" stroke="#475569" stroke-width="2.5" fill="none" marker-end="url(#a)" />')
    svg.append(f'  <rect x="{(x1+x2)/2-w/2}" y="320" width="{w}" height="20" rx="10" fill="#ffffff" stroke="#cbd5e1" /><text x="{(x1+x2)/2}" y="334" font-size="11" fill="#475569" text-anchor="middle">{_esc(back)}</text>')
    d.edge(ids[2],ids[1],back,exit=(0.5,1),entry=(0.5,1),pts=[(x1,330),(x2,330)])
    for i,line in enumerate(lines):
        svg.append(f'  <text x="30" y="{372+i*18}" font-size="12" fill="#64748b">{_esc(line)}</text>'); d.text(30,360+i*18,860,24,line,12,"#64748b",False)
    svg.append('</svg>\n')
    open(OUT+fn+".svg","w",encoding="utf-8").write("\n".join(svg)); d.save(fn+".drawio")

from location_gen import generate as generate_location
generate_location()
lifecycle("camera","The life of a camera",
  (("A site","where the camera is put up"),["has one camera","at a time"],("A camera","its id, its model, its settings")),
  [("Planned",["only in Settings:","not in the app"]),("Ready",["available,","not in the field"]),("Active",["put up","at a site"]),("Archived",["lost, stolen","or broken"])],
  ["by settings","Installation","Stolen"],"Desinstallation",
  "A camera that is put up is active: only a visit makes a camera active, and only a visit takes it out of active (a Desinstallation, or a Stolen visit). Archived is final: it never goes back.",site=True,star=False)
lifecycle("sd-card","The life of an SD card",
  (("A camera","at a site"),["holds one card,","until it is collected"],("An SD card","its label, its brand, its capacity")),
  [("Planned",["only in Settings:","not in the app"]),("Ready",["free: in no","camera"]),("Active",["in a camera","in the field"]),("Archived",["lost, stolen","or broken"])],
  ["by settings","left in a camera","stolen"],"collected",
  "A card in a camera is active: only a visit makes a card active (it leaves it in a camera), and only a visit takes it out of active (it collects it). Stolen with its camera, it is archived for good.",site=True,star=False)

# ---- the workflow: from defining a study to uploading its collections
def workflow():
    W,H=920,510
    BANDS=[(60,"1 · THE STUDY",BLU),(210,"2 · THE FIELD WORK",AMB),(360,"3 · THE IMAGES",GRN)]
    BOXES=[  # (band, x, w, title, sub lines)
     (0,30,148,"Research project",["what, where, who and how"]),(0,210,148,"Trappers",["who, and their roles"]),
     (0,390,148,"Locations",["where the cameras go"]),(0,570,148,"Cameras",["created in the app"]),(0,750,148,"SD cards",["created in the app"]),
     (1,30,280,"Visit",["one trip to one location: install,","revise, take away…"]),(1,342,280,"Revision",["the visits to all the locations","of a research project"]),
     (2,30,250,"Deployment",["the images of a collected SD card,","at a location, in some conditions"]),(2,312,250,"Collection",["all the deployments","of a revision"]),(2,594,296,"Upload",["to Trapper, or to the portals","of camera trapping to come"])]
    svg=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-labelledby="t d" font-family="Inter, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif">',
     '  <title id="t">The workflow</title>',
     '  <desc id="d">First the study is defined: the research project, its trappers and their roles, the locations, the cameras and the SD cards. Then the locations are visited, and the visits to all of them are a revision. The SD cards collected give deployments; those of a revision are a collection, and the collections are uploaded.</desc>',
     '  <defs><marker id="a" viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="11" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#475569" /></marker></defs>',
     f'  <rect x="0" y="0" width="{W}" height="{H}" rx="18" fill="#ffffff" stroke="#d4d4d8" />',
     '  <text x="30" y="40" font-size="15" font-weight="700" fill="#2563eb" letter-spacing="1">THE WORKFLOW, FROM THE STUDY TO THE UPLOAD</text>']
    d=D("The workflow",W,H); d.text(30,22,800,28,"THE WORKFLOW, FROM THE STUDY TO THE UPLOAD",15,"#2563eb")
    for y,t,(f,st,tc,sc) in BANDS:
        svg.append(f'  <rect x="20" y="{y}" width="880" height="120" rx="14" fill="{f}" fill-opacity="0.45" stroke="{st}" stroke-dasharray="5 4" /><text x="36" y="{y+22}" font-size="11" font-weight="700" fill="{sc}" letter-spacing="1">{t}</text>')
        d.box(20,y,880,120,"","",f,st,tc,sc,dash="5 4",rr=6)
        d.text(36,y+8,260,24,t,11,sc)
    ids=[]
    for b,x,w,t,sub in BOXES:
        y0,_,(f,st,tc,sc)=BANDS[b]; y=y0+36
        svg.append(f'  <rect x="{x}" y="{y}" width="{w}" height="70" rx="12" fill="#ffffff" stroke="{st}" stroke-width="2" /><text x="{x+w/2}" y="{y+26}" font-size="15" font-weight="700" fill="{tc}" text-anchor="middle">{_esc(t)}</text>')
        for i,l in enumerate(sub): svg.append(f'  <text x="{x+w/2}" y="{y+45+i*14}" font-size="11" fill="{sc}" text-anchor="middle">{_esc(l)}</text>')
        ids.append(d.box(x,y,w,70,t,"<br>".join(sub),"#ffffff",st,tc,sc,fs=15))
    def arrow(path,a,b,label=None,lx=None,ly=None,**kw):
        svg.append(f'  <path d="{path}" stroke="#475569" stroke-width="2.5" fill="none" marker-end="url(#a)" />')
        if label:
            w=len(label)*5.6+22
            svg.append(f'  <rect x="{lx-w/2}" y="{ly-10}" width="{w}" height="20" rx="10" fill="#ffffff" stroke="#cbd5e1" /><text x="{lx}" y="{ly+4}" font-size="11" fill="#475569" text-anchor="middle">{_esc(label)}</text>')
        d.edge(ids[a],ids[b],label or "",**kw)
    for a,b in ((0,1),(1,2),(2,3),(3,4)):
        x1=BOXES[a][1]+BOXES[a][2]; arrow(f"M{x1} 131 H{BOXES[b][1]-2}",a,b)
    arrow("M824 166 V195 H240 V244",4,5,"everything is ready",547,195,exit=(0.5,1),entry=(0.75,0),pts=[(824,195),(240,195)])
    x1=BOXES[5][1]+BOXES[5][2]; arrow(f"M{x1} 281 H{BOXES[6][1]-2}",5,6)
    arrow("M482 316 V345 H230 V394",6,7,"the SD cards collected",366,345,exit=(0.5,1),entry=(0.8,0),pts=[(482,345),(230,345)])
    for a,b in ((7,8),(8,9)):
        x1=BOXES[a][1]+BOXES[a][2]; arrow(f"M{x1} 431 H{BOXES[b][1]-2}",a,b)
    svg.append('</svg>\n')
    open(OUT+"workflow.svg","w",encoding="utf-8").write("\n".join(svg)); d.save("workflow.drawio")
workflow()

# ---- the states of a research project and of a trapper: boxes in a row, the way forward, the ways back, and what archives from any state
LC["Finished"]=LC["Ready"]; LC["Inactive"]=LC["Planned"]; LC["Not uploaded"]=LC["Planned"]; LC["Uploaded"]=LC["Active"]
def states(fn,title,xs,subs,fwd,backs,arch_label,note):
    """subs: (name, 2 lines) for each state; fwd: the label of each arrow to the next; backs: (from, to, label) of the ways back; arch_label: the arc from the first state to the last."""
    import textwrap
    lines=textwrap.wrap(note,115); H=310+18*len(lines); Y=110
    svg=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 {H}" width="920" height="{H}" role="img" aria-labelledby="t d" font-family="Inter, \'Segoe UI\', Roboto, Helvetica, Arial, sans-serif">',
      f'  <title id="t">{_esc(title)}</title>', f'  <desc id="d">{_esc(note)}</desc>',
      '  <defs><marker id="a" viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="11" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#475569" /></marker></defs>',
      f'  <rect x="0" y="0" width="920" height="{H}" rx="18" fill="#ffffff" stroke="#d4d4d8" />',
      f'  <text x="30" y="40" font-size="15" font-weight="700" fill="#2563eb" letter-spacing="1">{_esc(title.upper())}</text>']
    d=D(title,920,H); d.text(30,22,800,28,title.upper(),15,"#2563eb")
    ids=[]
    def pill(x,y,lab):
        w=len(lab)*5.6+22
        svg.append(f'  <rect x="{x-w/2}" y="{y-10}" width="{w}" height="20" rx="10" fill="#ffffff" stroke="#cbd5e1" /><text x="{x}" y="{y+4}" font-size="11" fill="#475569" text-anchor="middle">{_esc(lab)}</text>')
    for x,(name,sub) in zip(xs,subs):
        f,st,tc,sc=LC[name]
        svg.append(f'  <rect x="{x}" y="{Y}" width="{BW}" height="90" rx="12" fill="{f}" stroke="{st}" stroke-width="2" /><text x="{x+BW/2}" y="{Y+30}" font-size="17" font-weight="700" fill="{tc}" text-anchor="middle">{name}</text>')
        for i,l in enumerate(sub): svg.append(f'  <text x="{x+BW/2}" y="{Y+52+i*15}" font-size="11" fill="{sc}" text-anchor="middle">{_esc(l)}</text>')
        ids.append(d.box(x,Y,BW,90,name,"<br>".join(sub),f,st,tc,sc,fs=17))
    for i,lab in enumerate(fwd):
        x1=xs[i]+BW; x2=xs[i+1]
        svg.append(f'  <path d="M{x1} {Y+45} H{x2}" stroke="#475569" stroke-width="2.5" fill="none" marker-end="url(#a)" />'); pill((x1+x2)/2,Y+34,lab); d.edge(ids[i],ids[i+1],lab)
    if arch_label:
        xa=xs[0]+BW/2; xb=xs[-1]+BW/2
        svg.append(f'  <path d="M{xa} {Y} V{Y-8} Q{xa} {Y-20} {xa+12} {Y-20} H{xb-12} Q{xb} {Y-20} {xb} {Y-8} V{Y-4}" stroke="#475569" stroke-width="2.5" fill="none" marker-end="url(#a)" />'); pill((xa+xb)/2,Y-20,arch_label)
        d.edge(ids[0],ids[-1],arch_label,exit=(0.5,0),entry=(0.5,0),pts=[(xa,Y-20),(xb,Y-20)])
    for a,b,lab in backs:
        x1=xs[a]+BW/2-(20 if b<a and any(bb[1]==a for bb in backs) is False else 0); x1=xs[a]+BW/2-20; x2=xs[b]+BW/2+20 if b<a else xs[b]+BW/2
        y=Y+90
        svg.append(f'  <path d="M{x1} {y} V{y+22} Q{x1} {y+34} {x1-12} {y+34} H{x2+12} Q{x2} {y+34} {x2} {y+22} V{y+2}" stroke="#475569" stroke-width="2.5" fill="none" marker-end="url(#a)" />'); pill((x1+x2)/2,y+34,lab)
        d.edge(ids[a],ids[b],lab,exit=(0.36,1),entry=(0.64 if True else 0.5,1),pts=[(x1,y+34),(x2,y+34)])
    for i,l in enumerate(lines):
        svg.append(f'  <text x="30" y="{Y+170+i*18}" font-size="12" fill="#64748b">{_esc(l)}</text>'); d.text(30,Y+158+i*18,860,24,l,12,"#64748b",False)
    svg.append('</svg>\n')
    open(OUT+fn+".svg","w",encoding="utf-8").write("\n".join(svg)); d.save(fn+".drawio")

states("research-project","The life of a research project",[30,270,510,750],
  [("Planned",["being prepared:","no visits yet"]),("Active",["the study","is running"]),("Finished",["the fieldwork","is over"]),("Archived",["out of use","for good"])],
  ["by settings","by settings","by settings"],[(2,1,"reopen"),(1,0,"only with no visits")],"by settings, from any state",
  "Only a project with no visits goes back to planned. A finished project is not offered when a deployment is imported, but can be reopened. Archived is final: nothing in it can be changed, and it never goes back.")
states("trapper","The life of a trapper",[110,390,670],
  [("Active",["goes to the field:","suggested in the visits"]),("Inactive",["no longer goes:","not suggested"]),("Archived",["out of use","for good"])],
  ["by settings"],[(1,0,"by settings")],"by settings, from any state",
  "An inactive trapper keeps what it did: its visits and roles still say who it is. Archived is final: it never goes back.")

states("upload","The life of a deployment, in an upload",[200,580],
  [("Not uploaded",["created here, not yet","in the portal"]),("Uploaded",["in the portal:","the day is kept"])],
  ["an upload ends well"],[],None,
  "It is said for each portal: a deployment can be uploaded to one and not to another. A rehearse, only preparing the files, or an upload that fails leave it as it was.")

LC["Open"]=LC["Planned"]; LC["Closed"]=LC["Active"]; LC["Camera stolen"]=("#fef2f2","#ef4444","#991b1b","#b91c1c")
states("deployment-states","The life of a deployment",[40,390,740],
  [("Open",["the camera is out:","card to be collected"]),("Closed",["card collected:","images can be imported"]),("Camera stolen",["closed:","it has no images"])],
  ["next visit: card collected"],[],"next visit: camera found stolen",
  "A deployment is open from the visit that leaves the camera until the next visit to the site, and it is closed by what that visit finds. Closed and Camera stolen are final.")
