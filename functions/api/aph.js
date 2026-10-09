// Aphrite data API (Cloudflare Pages Functions + D1).
// Needs a D1 binding named DB. Password for the admin page: APHRITE_KEY, or ADMIN_KEY if that one is not set.
// GET  /api/aph            everything the site shows (a draw's map stays hidden until its countdown is almost over)
// POST /api/aph {action}   admin only: check, save, delete, draw, avatars
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const KINDS = { player: 1, team: 1, tour: 1, match: 1, news: 1, setting: 1, draw: 1 };
const REVEAL_EARLY = 1500;   // the map goes out this long before the countdown ends, so every screen has it in time
const DEFAULTS = { maps1v1: "Highrise, Kabuki, Arc, Courtyard", maps2v2: "Metro, Shipyard, District", countdown: 30 };
const norm = s => String(s == null ? "" : s).trim().toLowerCase();
const rid = () => [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, "0")).join("");
const str = (v, n = 200) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

async function setup(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS aph(kind TEXT, id TEXT, data TEXT, updated INTEGER, PRIMARY KEY(kind, id))").run();
}
async function all(db) {
  const { results } = await db.prepare("SELECT kind, id, data, updated FROM aph").all();
  const out = { player: [], team: [], tour: [], match: [], news: [], setting: [], draw: [] };
  for (const r of results || []) { if (!out[r.kind]) continue; try { out[r.kind].push({ id: r.id, ...JSON.parse(r.data) }); } catch {} }
  return out;
}
const settingsOf = rows => { const s = { ...DEFAULTS }; rows.forEach(r => { s[r.id] = r.v; }); return s; };

// what each kind of row may hold
function clean(kind, d) {
  if (kind === "player") return { name: str(d.name, 40), roblox: str(d.roblox, 40).replace(/^@/, ""), head: str(d.head, 300), body: str(d.body, 300) };
  if (kind === "team") return { name: str(d.name, 40), p1: str(d.p1, 40), p2: str(d.p2, 40), tag: str(d.tag, 4).toUpperCase(), color: /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(str(d.color)) ? str(d.color) : "" };
  if (kind === "tour") return { date: str(d.date, 40), name: str(d.name, 60), season: str(d.season, 30), prize: str(d.prize, 400), winner: str(d.winner, 80) };
  if (kind === "match") return { date: str(d.date, 40), season: str(d.season, 30), win: str(d.win, 80), lose: str(d.lose, 80), score: str(d.score, 12), tour: str(d.tour, 60), round: str(d.round, 12), map: str(d.map, 40) };
  if (kind === "news") return { date: str(d.date, 40), title: str(d.title, 120), text: str(d.text, 2000) };
  if (kind === "setting") return { v: str(d.v, 600) };
  return null;
}
function required(kind, d) {
  if (kind === "player") return d.name;
  if (kind === "team") return d.name && d.p1 && d.p2;
  if (kind === "tour") return d.name;
  if (kind === "match") return d.win && d.lose;
  if (kind === "news") return d.title;
  return true;
}

// the photo and the full skin of a Roblox user
async function roblox(user) {
  if (!user) return { head: "", body: "" };
  try {
    const u = await fetch("https://users.roblox.com/v1/usernames/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ usernames: [user], excludeBannedUsers: false }) });
    const id = ((await u.json()).data || [])[0]?.id; if (!id) return { head: "", body: "" };
    const pic = async kind => { const r = await fetch(`https://thumbnails.roblox.com/v1/users/${kind}?userIds=${id}&size=${kind === "avatar" ? "420x420" : "150x150"}&format=Png&isCircular=false`); return ((await r.json()).data || [])[0]?.imageUrl || ""; };
    const [head, body] = await Promise.all([pic("avatar-headshot"), pic("avatar")]);
    return { head, body };
  } catch { return { head: "", body: "" }; }
}

// pick the map now; everyone sees it when the countdown ends
async function draw(db, d) {
  const data = await all(db), S = settingsOf(data.setting);
  const teams = {}; data.team.forEach(t => teams[norm(t.name)] = [t.p1, t.p2]);
  const size = side => (teams[norm(side)] || String(side).split(/\s*(?:&|\+|\/)\s*/).filter(Boolean)).length;
  const a = str(d.a, 80), b = str(d.b, 80); if (!a || !b) return { error: "Choose both teams or players." };
  const mode = d.mode === "1v1" || d.mode === "2v2" ? d.mode : (size(a) > 1 || size(b) > 1 ? "2v2" : "1v1");
  const pool = String(mode === "2v2" ? S.maps2v2 : S.maps1v1).split(/\s*,\s*/).filter(Boolean);
  if (!pool.length) return { error: `No ${mode} map in the settings.` };
  // a map not played yet in this tournament, until every map has been used
  const done = data.draw.filter(x => norm(x.tour) === norm(d.tour) && x.mode === mode).map(x => norm(x.map));
  let fresh = pool.filter(m => !done.includes(norm(m))); if (!fresh.length) fresh = pool;
  const r = crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32, map = fresh[Math.floor(r * fresh.length)];
  const delay = Math.max(5, Math.min(120, Number(S.countdown) || 30)), at = Date.now() + delay * 1000;
  const row = { at, tour: str(d.tour, 60), round: str(d.round, 12), a, b, mode, map, pool: pool.join(", ") };
  await db.prepare("INSERT INTO aph(kind, id, data, updated) VALUES('draw', ?, ?, ?)").bind(String(at), JSON.stringify(row), Date.now()).run();
  return { ok: true, map, delay, mode, at };
}

export async function onRequest({ request, env }) {
  if (!env.DB) return json({ error: "The database is not connected yet." }, 503);
  const db = env.DB; await setup(db);
  if (request.method === "GET") {
    const data = await all(db), now = Date.now();
    data.draw = data.draw.map(x => (now >= x.at - REVEAL_EARLY ? x : { ...x, map: "" }));   // a map nobody may know yet
    data.setting = settingsOf(data.setting);
    return json({ ok: true, now, ...data });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body = {}; try { body = await request.json(); } catch {}
  const KEY = env.APHRITE_KEY || env.ADMIN_KEY;
  if (!KEY) return json({ error: "No password is set for the admin page yet (APHRITE_KEY in Cloudflare)." }, 503);
  if (str(request.headers.get("x-admin-key"), 200) !== KEY) { await new Promise(r => setTimeout(r, 600)); return json({ error: "Wrong password." }, 401); }
  const a = body.action;
  if (a === "check") return json({ ok: true });
  if (a === "save") {
    const kind = body.kind; if (!KINDS[kind] || kind === "draw") return json({ error: "Unknown kind" }, 400);
    const d = clean(kind, body.data || {}); if (!required(kind, d)) return json({ error: "Some fields are missing." }, 400);
    if (kind === "player" && d.roblox && (body.refresh || !d.head)) Object.assign(d, await roblox(d.roblox));
    const id = kind === "setting" ? str(body.id, 40) : (str(body.id, 40) || rid());
    await db.prepare("INSERT INTO aph(kind, id, data, updated) VALUES(?, ?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET data = excluded.data, updated = excluded.updated").bind(kind, id, JSON.stringify(d), Date.now()).run();
    return json({ ok: true, id, data: d });
  }
  if (a === "delete") {
    if (!KINDS[body.kind]) return json({ error: "Unknown kind" }, 400);
    await db.prepare("DELETE FROM aph WHERE kind = ? AND id = ?").bind(body.kind, str(body.id, 40)).run();
    return json({ ok: true });
  }
  if (a === "draw") { const r = await draw(db, body.data || {}); return json(r, r.error ? 400 : 200); }
  if (a === "avatars") {   // look every player up again on Roblox, after skin changes
    const { results } = await db.prepare("SELECT id, data FROM aph WHERE kind = 'player'").all(); let n = 0;
    for (const r of results || []) { const d = JSON.parse(r.data); if (!d.roblox) continue; Object.assign(d, await roblox(d.roblox)); n++;
      await db.prepare("UPDATE aph SET data = ?, updated = ? WHERE kind = 'player' AND id = ?").bind(JSON.stringify(d), Date.now(), r.id).run(); }
    return json({ ok: true, n });
  }
  if (a === "import") {   // bring the rows over from the old Google Sheet, once
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 3000) : []; let n = 0;
    for (const r of rows) { if (!KINDS[r.kind] || r.kind === "setting" || r.kind === "draw") continue; const d = clean(r.kind, r.data || {}); if (!required(r.kind, d)) continue;
      await db.prepare("INSERT OR REPLACE INTO aph(kind, id, data, updated) VALUES(?, ?, ?, ?)").bind(r.kind, rid(), JSON.stringify(d), Date.now()).run(); n++; }
    return json({ ok: true, n });
  }
  return json({ error: "Unknown action" }, 400);
}
