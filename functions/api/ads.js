// Trade board API (Cloudflare Pages Functions + D1).
// Needs a D1 binding named DB. Optional: ADMIN_KEY (moderation), SALT (IP hashing).
const DAY = 864e5, TTL = 2 * DAY, MAX_ITEMS = 8, MAX_NOTE = 160, REPORTS_TO_HIDE = 3;
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const KEY_RE = /^[\p{L}\p{N} &:'’.\-]{1,40}\|[\p{L}\p{N} \-]{1,30}$/u;
const LINK_RE = /(https?:|www\.|discord\.gg|discord\.com\/invite|\.(com|net|org|gg|io|xyz|ru|ly)\b)/i;

async function setup(db) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS ads(id TEXT PRIMARY KEY, created INTEGER, user TEXT, has TEXT, wants TEXT, offers INTEGER, note TEXT, ip TEXT, token TEXT, reports INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0)"),
    db.prepare("CREATE TABLE IF NOT EXISTS reports(ad TEXT, ip TEXT, PRIMARY KEY(ad, ip))"),
    db.prepare("CREATE INDEX IF NOT EXISTS ads_created ON ads(created)"),
  ]);
}
async function ipHash(request, env) {
  const ip = request.headers.get("cf-connecting-ip") || "0";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode((env.SALT || "liner-board") + ip));
  return [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join("");
}
const rid = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, "0")).join("");
function cleanItems(list) {
  if (!Array.isArray(list)) return null;
  const out = {};
  for (const it of list.slice(0, 40)) {
    if (!it || typeof it.k !== "string" || !KEY_RE.test(it.k)) return null;
    const q = Math.floor(Number(it.q));
    if (!(q >= 1 && q <= 99)) return null;
    out[it.k] = Math.min(99, (out[it.k] || 0) + q);
  }
  const arr = Object.entries(out).map(([k, q]) => ({ k, q }));
  return arr.length > MAX_ITEMS ? null : arr;
}
const pub = r => ({ id: r.id, created: r.created, user: r.user, has: JSON.parse(r.has), wants: JSON.parse(r.wants), offers: !!r.offers, note: r.note });

export async function onRequest({ request, env }) {
  if (!env.DB) return json({ error: "The trade board is not set up yet." }, 503);
  const db = env.DB, url = new URL(request.url), now = Date.now();
  await setup(db);
  await db.prepare("DELETE FROM ads WHERE created < ?").bind(now - TTL).run();

  if (request.method === "GET") {
    const { results } = await db.prepare("SELECT * FROM ads WHERE hidden = 0 ORDER BY created DESC LIMIT 300").all();
    return json({ ads: results.map(pub), ttl: TTL });
  }

  let body = {};
  try { body = await request.json(); } catch { return json({ error: "Bad request." }, 400); }

  if (request.method === "POST" && body.action === "report") {
    const ip = await ipHash(request, env);
    const ad = await db.prepare("SELECT id FROM ads WHERE id = ?").bind(String(body.id || "")).first();
    if (!ad) return json({ error: "This trade no longer exists." }, 404);
    const r = await db.prepare("INSERT OR IGNORE INTO reports(ad, ip) VALUES(?, ?)").bind(ad.id, ip).run();
    if (r.meta.changes) await db.prepare("UPDATE ads SET reports = reports + 1, hidden = CASE WHEN reports + 1 >= ? THEN 1 ELSE hidden END WHERE id = ?").bind(REPORTS_TO_HIDE, ad.id).run();
    return json({ ok: true });
  }

  if (request.method === "POST") {
    if (body.website) return json({ ok: true, id: "x", token: "x" }); // bot trap
    const user = String(body.user || "").trim();
    if (!/^[\w.]{2,32}$/.test(user)) return json({ error: "Enter your Discord username (letters, numbers, dots or underscores)." }, 400);
    const has = cleanItems(body.has), wants = cleanItems(body.wants);
    if (!has || !wants) return json({ error: `Up to ${MAX_ITEMS} different skins per side.` }, 400);
    const offers = body.offers ? 1 : 0;
    if (!has.length && !wants.length) return json({ error: "Add at least one skin." }, 400);
    if (!wants.length && !offers && !has.length) return json({ error: "Add at least one skin." }, 400);
    const note = String(body.note || "").replace(/\s+/g, " ").trim().slice(0, MAX_NOTE);
    if (LINK_RE.test(note) || LINK_RE.test(user)) return json({ error: "Links are not allowed. People can DM you on Discord." }, 400);
    const ip = await ipHash(request, env);
    const recent = await db.prepare("SELECT COUNT(*) AS n, MAX(created) AS last FROM ads WHERE ip = ? AND created > ?").bind(ip, now - 6 * 36e5).first();
    if (recent && recent.last && now - recent.last < 120e3) return json({ error: "Please wait 2 minutes before posting again." }, 429);
    if (recent && recent.n >= 3) return json({ error: "You can post up to 3 trades every 6 hours." }, 429);
    const id = rid(8), token = rid(16);
    await db.prepare("INSERT INTO ads(id, created, user, has, wants, offers, note, ip, token) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(id, now, user, JSON.stringify(has), JSON.stringify(wants), offers, note, ip, token).run();
    return json({ ok: true, id, token });
  }

  if (request.method === "DELETE") {
    const id = String(body.id || "");
    const admin = env.ADMIN_KEY && body.admin && body.admin === env.ADMIN_KEY;
    const r = admin
      ? await db.prepare("DELETE FROM ads WHERE id = ?").bind(id).run()
      : await db.prepare("DELETE FROM ads WHERE id = ? AND token = ?").bind(id, String(body.token || "")).run();
    if (!r.meta.changes) return json({ error: admin === false && body.admin ? "Wrong admin key." : "Could not delete this trade." }, 403);
    return json({ ok: true });
  }
  return json({ error: "Method not allowed." }, 405);
}
