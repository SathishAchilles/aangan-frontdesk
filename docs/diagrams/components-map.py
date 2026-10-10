"""Renders docs/diagrams/components-map.svg (swimlane: Trigger -> Input -> Context -> Processing -> AI -> Output).

Run: python3 docs/diagrams/components-map.py && rsvg-convert -z 1.5 docs/diagrams/components-map.svg -o docs/diagrams/components-map.png
"""
from html import escape
from pathlib import Path

W = 2000
LANE_W = 200
TOP = 118
HEAD_H = 46
COLS = ["Trigger", "Input", "Context", "Processing", "AI", "Output"]
COL_W = [255, 255, 300, 330, 290, 350]
COL_X = []
x = 20 + LANE_W
for w in COL_W:
    COL_X.append(x)
    x += w
GRID_RIGHT = x

LANES = [
    ("Caller", "phones the studio", 100),
    ("Telephony", "Vaani number now; Vobiz later", 100),
    ("Vaani AI", "live voice agent, English", 110),
    ("Vercel tools", "mid-call, < 1.5 s", 166),
    ("Vercel jobs", "webhooks, follow-ups", 160),
    ("Supabase", "aangan schema", 110),
    ("Cal.com", "booking", 100),
    ("Gemini", "post-call only", 100),
    ("Telegram", "staff only", 160),
    ("HubSpot", "CRM", 95),
    ("Designer /", "front desk", 160),
    ("Nikhil", "founder + admins", 110),
]
LANE_Y = {}
y = TOP + HEAD_H
for name, _sub, h in LANES:
    LANE_Y[name] = (y, h)
    y += h
GRID_BOTTOM = y

STYLE = {
    "ai": ("#EEEAFB", "#5B4BB7", "#2B1E73"),
    "out": ("#E4F4EC", "#2E8B62", "#14523A"),
    "esc": ("#FCEBD8", "#C27420", "#6E3D08"),
    "sys": ("#FFFFFF", "#5B6470", "#1F2328"),
    "build": ("#EFEBE3", "#8A8170", "#3D372C"),
    "cut": ("#FDECEC", "#C0392B", "#7B1D14"),
}

BOX_W = 0.86  # share of column width
boxes = {}


def box(key, lane, col, title, sub, kind="sys", slot=None, span=1.0):
    ly, lh = LANE_Y[lane]
    cx = COL_X[col]
    cw = COL_W[col] * span
    w = cw * BOX_W
    bx = cx + (cw - w) / 2
    h = 58
    if slot is None:
        by = ly + (lh - h) / 2
    else:
        by = ly + 14 + slot * (h + 16) + (8 if lh > 160 else 0)
    boxes[key] = dict(x=bx, y=by, w=w, h=h, title=title, sub=sub, kind=kind)


# Caller
box("call", "Caller", 0, "Calls studio number", "Any hour, day or night")
box("voice", "Caller", 1, "Caller's voice", "English · caller ID · time")
box("heard", "Caller", 5, "Slot confirmed on the call", "Day, time and type read back", "out")
# Telephony
box("number", "Telephony", 1, "Studio number forwarded", "Vaani-provisioned → Vobiz SIP")
box("transfer", "Telephony", 5, "Warm transfer", "Office hours only, to front desk", "esc")
# Vaani
box("agent", "Vaani AI", 4, "Answers, asks, books (live)", "Greeting: AI + recorded · agent.md", "ai")
box("speak", "Vaani AI", 5, "Speaks tool lines verbatim", "Question · close · booking · callback", "out")
# Vercel tools
box("lookup", "Vercel tools", 2, "lookup_caller", "IST time · office open · history", slot=0)
box("cut", "Vercel tools", 2, "CUT: no price quoting", "Inside the gate · floors never spoken", "cut", slot=1)
box("gate", "Vercel tools", 3, "evaluate_enquiry → gate", "5 criteria · no score · 5 outcomes", slot=0)
box("slots", "Vercel tools", 3, "get_slots · book_slot", "Constraints · designer round-robin", slot=1)
# Vercel jobs
box("vwebhook", "Vercel jobs", 0, "Call-ended webhook", "Vaani events · token", slot=0)
box("cwebhook", "Vercel jobs", 0, "Cal.com webhook", "Booking created / moved / cancelled", slot=1)
box("handler", "Vercel jobs", 3, "Inbox + handler", "Verify · dedupe · route · retry", slot=0)
box("followups", "Vercel jobs", 3, "/followups", "Reminders · escalations · callbacks", slot=1)
# Supabase
box("cron", "Supabase", 0, "pg_cron every 2 min", "via pg_net")
box("rules", "Supabase", 2, "Rules context", "Settings · localities · festivals")
box("log", "Supabase", 3, "Call + cost log", "Evidence · outcomes · eval runs")
# Cal.com
box("avail", "Cal.com", 2, "Availability", "Studio · site · principal visit")
box("booking", "Cal.com", 5, "Booking", "Phone-only, no email needed", "out")
# Gemini
box("note", "Gemini", 4, "Extract + handoff note", "Never re-decides the outcome", "ai")
# Telegram
box("button", "Telegram", 0, "Button press", "Accept · Done · Won · Lost → inbox", slot=0)
box("handoff", "Telegram", 5, "Handoff note [Accept]", "Designers' group, everything asked", "out", slot=0)
box("alerts", "Telegram", 5, "Tasks + urgent alerts", "Front desk · founder", "esc", slot=1)
# HubSpot
box("crm", "HubSpot", 5, "Contact · deal · nurture", "Meeting Booked → Won / Lost", "out")
# People
box("accepts", "Designer /", 5, "Designer accepts", "Calls with full context", "out", slot=0)
box("callback", "Designer /", 5, "Front-desk callback", "Promised time, tracked", "esc", slot=1)
# Nikhil
box("settings", "Nikhil", 2, "Settings (admin)", "Range-checked · audited · replay")
box("dash", "Nikhil", 5, "Dashboard", "Generated + cost · per designer · Quality", "out")

def A(key, side, d=0.0):
    b = boxes[key]
    if side == "r":
        return (b["x"] + b["w"], b["y"] + b["h"] / 2 + d)
    if side == "l":
        return (b["x"], b["y"] + b["h"] / 2 + d)
    if side == "t":
        return (b["x"] + b["w"] / 2 + d, b["y"])
    return (b["x"] + b["w"] / 2 + d, b["y"] + b["h"])


def cy(key, d=0.0):
    b = boxes[key]
    return b["y"] + b["h"] / 2 + d


def cx(key, d=0.0):
    b = boxes[key]
    return b["x"] + b["w"] / 2 + d


B = {k: v for k, v in boxes.items()}
tools_top = LANE_Y["Vercel tools"][0]
cal_bottom = LANE_Y["Cal.com"][0] + LANE_Y["Cal.com"][1]
R = GRID_RIGHT
edges = []  # (points, label, label_segment, dashed, color)


def E(points, label="", seg=None, dashed=False, color="#3A3F45"):
    edges.append((points, label, seg, dashed, color))


E([A("call", "r"), A("voice", "l")])
E([A("call", "b"), (cx("call"), cy("number")), A("number", "l")], "PSTN", 0)
E([A("voice", "r"), (cx("agent"), cy("voice")), A("agent", "t")], "speech", 0)
E([A("number", "r"), (COL_X[4], cy("number")), (COL_X[4], cy("agent", -10)), A("agent", "l", -10)], "audio", 0)
E([A("agent", "r"), A("speak", "l")])
E([A("speak", "t"), A("transfer", "b")], "transfer_call", 0)
E([A("agent", "l", 12), (cx("vwebhook"), cy("agent", 12)), A("vwebhook", "t")], "call ends", 0, dashed=True)
E([(B["agent"]["x"] + 24, B["agent"]["y"] + B["agent"]["h"]), (B["agent"]["x"] + 24, tools_top + 6), (cx("lookup"), tools_top + 6), A("lookup", "t")], "first, silently", 1)
E([A("agent", "b"), (cx("agent"), cy("gate")), A("gate", "r")], "after each fact", 1)
E([A("agent", "b", 46), (cx("agent", 46), cy("slots", -10)), A("slots", "r", -10)], "book on call", 1)
E([A("rules", "r"), (COL_X[3] - 12, cy("rules")), (COL_X[3] - 12, cy("gate", 12)), A("gate", "l", 12)], "rules", 0, dashed=True)
E([A("slots", "l"), (COL_X[3] + 10, cy("slots")), (COL_X[3] + 10, cy("avail")), A("avail", "r")], "", 1)
E([A("slots", "r", 12), (cx("booking"), cy("slots", 12)), A("booking", "t")], "book", 0)
E([A("booking", "r"), (R + 18, cy("booking")), (R + 18, cy("heard")), A("heard", "r")], "confirmed", 1, dashed=True)
E([A("transfer", "r"), (R + 42, cy("transfer")), (R + 42, cy("callback")), A("callback", "r")], "no answer", 1, dashed=True, color="#C27420")
E([A("vwebhook", "r", -10), A("handler", "l", -10)], "events", 0)
E([A("cwebhook", "r", -10), (COL_X[1] + 120, cy("cwebhook", -10)), (COL_X[1] + 120, cy("handler", 12)), A("handler", "l", 12)])
E([A("cron", "r"), (COL_X[1] + 40, cy("cron")), (COL_X[1] + 40, cy("followups", 12)), A("followups", "l", 12)], "every 2 min", 2)
E([A("handler", "r"), (COL_X[4] - 12, cy("handler")), (COL_X[4] - 12, cy("log")), A("log", "r")], "", 1)
E([A("handler", "r", 14), (cx("note", -15), cy("handler", 14)), A("note", "t", -15)], "transcript", 1)
E([A("handler", "r", -14), (COL_X[5] - 10, cy("handler", -14)), (COL_X[5] - 10, cy("crm")), A("crm", "l")], "contact / deal", 1)
E([A("note", "r"), (COL_X[5] + 8, cy("note")), (COL_X[5] + 8, cy("handoff")), A("handoff", "l")], "note", 1)
E([A("followups", "r"), (COL_X[5] + 16, cy("followups")), (COL_X[5] + 16, cy("alerts")), A("alerts", "l")], "nudges · escalations", 0)
E([A("handoff", "r"), (R - 14, cy("handoff")), (R - 14, cy("accepts")), A("accepts", "r")], "Accept", 1)
E([A("alerts", "r"), (R - 4, cy("alerts")), (R - 4, cy("callback")), A("callback", "r")])
E([A("log", "b"), (cx("log"), cy("dash")), A("dash", "l")], "dashboard reads", 0, dashed=True)
E([A("settings", "l"), (COL_X[2] + 10, cy("settings")), (COL_X[2] + 10, cy("rules")), A("rules", "l")], "edits", 1)


out = []
H = GRID_BOTTOM + 230
W = GRID_RIGHT + 130
out.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="Helvetica, Arial, sans-serif">')
out.append('<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#3A3F45"/></marker>'
           '<marker id="arrRed" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#C0392B"/></marker>'
           '<marker id="arrOrange" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#C27420"/></marker></defs>')
out.append(f'<rect width="{W}" height="{H}" fill="#FFFFFF"/>')
out.append(f'<text x="20" y="48" font-size="30" font-weight="700" fill="#1F2328">Aangan Studio · Phone enquiry components map</text>')
out.append(f'<text x="20" y="80" font-size="16" fill="#5B6470">Inbound phone only · the gate decides during the call · Telegram never contacts callers · no SMS, no email</text>')

# header
out.append(f'<rect x="20" y="{TOP}" width="{GRID_RIGHT - 20}" height="{HEAD_H}" fill="#2D3A45"/>')
out.append(f'<text x="{20 + LANE_W / 2}" y="{TOP + 30}" font-size="18" font-weight="700" fill="#FFFFFF" text-anchor="middle">Lane</text>')
for i, name in enumerate(COLS):
    out.append(f'<text x="{COL_X[i] + COL_W[i] / 2}" y="{TOP + 30}" font-size="18" font-weight="700" fill="#FFFFFF" text-anchor="middle">{name}</text>')

# lanes
for i, (name, sub, h) in enumerate(LANES):
    ly, lh = LANE_Y[name]
    out.append(f'<rect x="{20 + LANE_W}" y="{ly}" width="{GRID_RIGHT - 20 - LANE_W}" height="{lh}" fill="{"#F5F7F9" if i % 2 == 0 else "#EDF0F3"}"/>')
    out.append(f'<rect x="20" y="{ly}" width="{LANE_W}" height="{lh}" fill="#E1E6EB"/>')
    out.append(f'<text x="{20 + LANE_W / 2}" y="{ly + lh / 2 - 2}" font-size="17" font-weight="700" fill="#1F2328" text-anchor="middle">{escape(name)}</text>')
    out.append(f'<text x="{20 + LANE_W / 2}" y="{ly + lh / 2 + 18}" font-size="13" fill="#5B6470" text-anchor="middle">{escape(sub)}</text>')
    out.append(f'<line x1="20" y1="{ly}" x2="{GRID_RIGHT}" y2="{ly}" stroke="#D3D9DF"/>')
for cx in COL_X[1:]:
    out.append(f'<line x1="{cx}" y1="{TOP + HEAD_H}" x2="{cx}" y2="{GRID_BOTTOM}" stroke="#C9D0D6" stroke-dasharray="4 5"/>')
out.append(f'<rect x="20" y="{TOP}" width="{GRID_RIGHT - 20}" height="{GRID_BOTTOM - TOP}" fill="none" stroke="#C9D0D6"/>')

# edges under boxes
labels = [(COL_X[3] + 10, cy("avail") - 46, "slots", "#3A3F45"), (COL_X[4] - 12, cy("log") - 40, "writes", "#3A3F45")]
for pts, label, seg, dashed, color in edges:
    d = "M" + " L".join(f"{px:.1f},{py:.1f}" for px, py in pts)
    marker = "arrRed" if color == "#C0392B" else "arrOrange" if color == "#C27420" else "arr"
    dash = ' stroke-dasharray="6 5"' if dashed else ""
    out.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="1.8"{dash} marker-end="url(#{marker})"/>')
    if label:
        i = seg if seg is not None else 0
        (x1, y1), (x2, y2) = pts[i], pts[i + 1]
        labels.append(((x1 + x2) / 2, (y1 + y2) / 2, label, color))

for key, b in boxes.items():
    fill, stroke, ink = STYLE[b["kind"]]
    dash = ' stroke-dasharray="7 4"' if b["kind"] == "cut" else ""
    out.append(f'<rect x="{b["x"]:.1f}" y="{b["y"]:.1f}" width="{b["w"]:.1f}" height="{b["h"]}" rx="8" fill="{fill}" stroke="{stroke}" stroke-width="{2.2 if b["kind"] == "cut" else 1.6}"{dash}/>')
    out.append(f'<text x="{b["x"] + b["w"] / 2:.1f}" y="{b["y"] + 24:.1f}" font-size="15.5" font-weight="700" fill="{ink}" text-anchor="middle">{escape(b["title"])}</text>')
    out.append(f'<text x="{b["x"] + b["w"] / 2:.1f}" y="{b["y"] + 44:.1f}" font-size="12.5" fill="{stroke}" text-anchor="middle">{escape(b["sub"])}</text>')

for lx, ly, label, color in labels:
    width = 7.2 * len(label) + 12
    out.append(f'<rect x="{lx - width / 2:.1f}" y="{ly - 10:.1f}" width="{width:.1f}" height="19" rx="4" fill="#FFFFFF" stroke="#D3D9DF" stroke-width="0.8"/>')
    out.append(f'<text x="{lx:.1f}" y="{ly + 4:.1f}" font-size="12.5" font-weight="600" fill="{color if color != "#3A3F45" else "#3A3F45"}" text-anchor="middle">{escape(label)}</text>')

# build strip
by = GRID_BOTTOM + 22
out.append(f'<rect x="20" y="{by}" width="{GRID_RIGHT - 20}" height="70" fill="#F7F4EF" stroke="#D8D1C4"/>')
out.append(f'<text x="{20 + LANE_W / 2}" y="{by + 32}" font-size="17" font-weight="700" fill="#3D372C" text-anchor="middle">GitHub</text>')
out.append(f'<text x="{20 + LANE_W / 2}" y="{by + 52}" font-size="13" fill="#5B6470" text-anchor="middle">build only, not runtime</text>')
strip = [("Code · prompts · rules · gold data", 260), ("CI: lint · types · tests · evals", 640), ("Deploy to Vercel (sin1)", 1020), ("vaani-sync pushes prompt after evals pass", 1430)]
for i, (text, sx) in enumerate(strip):
    out.append(f'<rect x="{sx}" y="{by + 14}" width="330" height="42" rx="8" fill="#EFEBE3" stroke="#8A8170"/>')
    out.append(f'<text x="{sx + 165}" y="{by + 40}" font-size="14" font-weight="600" fill="#3D372C" text-anchor="middle">{escape(text)}</text>')
    if i < len(strip) - 1:
        out.append(f'<path d="M{sx + 330},{by + 35} L{strip[i + 1][1]},{by + 35}" stroke="#8A8170" stroke-width="1.8" marker-end="url(#arr)"/>')

# legend + notes
ly = by + 100
items = [("ai", "AI step"), ("out", "Output"), ("esc", "Escalation / person"), ("sys", "System step"), ("build", "Build / deploy"), ("cut", "The Cut (removed)")]
lx = 20
for kind, label in items:
    fill, stroke, _ink = STYLE[kind]
    out.append(f'<rect x="{lx}" y="{ly}" width="22" height="16" rx="4" fill="{fill}" stroke="{stroke}"{" stroke-dasharray=\"4 3\"" if kind == "cut" else ""}/>')
    out.append(f'<text x="{lx + 30}" y="{ly + 13}" font-size="14" fill="#1F2328">{label}</text>')
    lx += 60 + 8.4 * len(label)
out.append(f'<path d="M{lx + 10},{ly + 8} L{lx + 50},{ly + 8}" stroke="#3A3F45" stroke-width="1.8" stroke-dasharray="6 5" marker-end="url(#arr)"/>')
out.append(f'<text x="{lx + 58}" y="{ly + 13}" font-size="14" fill="#1F2328">Asynchronous</text>')
notes = [
    "The Cut: per-sq-ft quoting is not built (pricing.md: no number may be quoted). Price floors live only inside the gate's budget check; there is no setting to enable quoting.",
    "Outcomes: QUALIFIED / QUALIFIED_WITH_NOTES (book + handoff) · NOT_QUALIFIED (close politely) · NEEDS_HUMAN (callback) · NOT_ENQUIRY (existing client or message).",
    "Extension: WhatsApp and the web form join at the Input column; everything from the inbox handler onward stays the same.",
]
for i, note in enumerate(notes):
    out.append(f'<text x="20" y="{ly + 44 + i * 22}" font-size="14" fill="#3A3F45">{escape(note)}</text>')
out.append("</svg>")

Path(__file__).with_name("components-map.svg").write_text("\n".join(out) + "\n")
print("wrote", Path(__file__).with_name("components-map.svg"))
