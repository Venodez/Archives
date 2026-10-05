// Live visitor counter: each open tab pings every ~45 s; "online" = seen in the last 100 s.
const WINDOW = 100e3;
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export async function onRequest({ request, env }) {
  if (!env.DB) return json({ online: null }, 503);
  const db = env.DB, now = Date.now();
  await db.prepare("CREATE TABLE IF NOT EXISTS live(sid TEXT PRIMARY KEY, seen INTEGER)").run();
  if (request.method === "POST") {
    let sid = "";
    try { sid = String((await request.json()).sid || ""); } catch {}
    if (/^[a-f0-9]{16,32}$/.test(sid)) await db.prepare("INSERT INTO live(sid, seen) VALUES(?, ?) ON CONFLICT(sid) DO UPDATE SET seen = excluded.seen").bind(sid, now).run();
    if (Math.random() < 0.1) await db.prepare("DELETE FROM live WHERE seen < ?").bind(now - WINDOW).run();
  }
  const r = await db.prepare("SELECT COUNT(*) AS n FROM live WHERE seen >= ?").bind(now - WINDOW).first();
  return json({ online: r ? r.n : 0 });
}
