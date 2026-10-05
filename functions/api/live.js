// Live visitor counter. One id per browser (shared by all its tabs); at most 3 ids per network.
// "Online" = pinged in the last 100 s.
const WINDOW = 100e3, PER_IP = 3;
const EXTRA = 10; // added to the number shown on the site
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
async function ipHash(request, env) {
  const ip = request.headers.get("cf-connecting-ip") || "0";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode((env.SALT || "liner-live") + ip));
  return [...new Uint8Array(buf)].slice(0, 10).map(b => b.toString(16).padStart(2, "0")).join("");
}
export async function onRequest({ request, env }) {
  if (!env.DB) return json({ online: null }, 503);
  const db = env.DB, now = Date.now();
  await db.prepare("CREATE TABLE IF NOT EXISTS live2(sid TEXT PRIMARY KEY, ip TEXT, seen INTEGER)").run();
  if (request.method === "POST") {
    let sid = "";
    try { sid = String((await request.json()).sid || ""); } catch {}
    if (/^[a-f0-9]{16,32}$/.test(sid)) {
      const ip = await ipHash(request, env);
      const known = await db.prepare("SELECT sid FROM live2 WHERE sid = ?").bind(sid).first();
      const n = known ? 0 : (await db.prepare("SELECT COUNT(*) AS n FROM live2 WHERE ip = ? AND seen >= ?").bind(ip, now - WINDOW).first()).n;
      if (known || n < PER_IP) await db.prepare("INSERT INTO live2(sid, ip, seen) VALUES(?, ?, ?) ON CONFLICT(sid) DO UPDATE SET seen = excluded.seen, ip = excluded.ip").bind(sid, ip, now).run();
    }
    if (Math.random() < 0.1) await db.prepare("DELETE FROM live2 WHERE seen < ?").bind(now - WINDOW).run();
  }
  const r = await db.prepare("SELECT COUNT(*) AS n FROM live2 WHERE seen >= ?").bind(now - WINDOW).first();
  return json({ online: (r ? r.n : 0) + EXTRA });
}
