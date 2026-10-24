// Fonction serveur appelée toutes les 5 min par pg_cron (header x-cron-secret).
// 1) livre les mots arrivés à échéance (8h chez l'apprenant) et notifie l'apprenant ;
// 2) rappelle à 20h (heure locale) à celui qui n'a pas encore choisi.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false }, db: { schema: "mdj" } });

type Person = { id: string; name: string; learns: "fr" | "zh"; lang: "fr" | "zh"; tz: string; deliver_hour: number; remind_hour: number };
type Round = { id: string; learner: string; deliver_at: string; proposals: string[]; chosen: string | null; chosen_by: string | null; delivered_at: string | null; reminded_at: string | null };
type Word = { id: string; fr: string; zh: string; pinyin: string; en: string };
type Sub = { id: string; person_id: string; endpoint: string; p256dh: string; auth: string };

const T = {
  fr: {
    todayTitle: "Ton mot du jour",
    todayBody: (w: Word, by: string) => `${w.zh} (${w.pinyin}) — ${w.fr}. ${by}`,
    chosenBy: (n: string) => `Choisi par ${n}.`,
    auto: "Choisi au hasard.",
    remindTitle: (n: string) => `Le mot de ${n} pour demain`,
    remindBody: (n: string) => `Tu n'as pas encore choisi le mot que ${n} apprendra demain.`,
  },
  zh: {
    todayTitle: "今天的单词",
    todayBody: (w: Word, by: string) => `${w.fr} — ${w.zh}。${by}`,
    chosenBy: (n: string) => `${n}选的。`,
    auto: "随机选择。",
    remindTitle: (n: string) => `${n}明天的单词`,
    remindBody: (n: string) => `你还没有选${n}明天要学的单词哦。`,
  },
};

function localHour(d: Date, tz: string): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(d);
  return Number(h) % 24;
}

async function sendTo(personId: string, subs: Sub[], payload: Record<string, unknown>) {
  let sent = 0;
  for (const s of subs.filter((x) => x.person_id === personId)) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload), { TTL: 6 * 3600, urgency: "high" });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      console.error("push failed", s.endpoint.slice(0, 40), code, (e as Error).message);
      if (code === 404 || code === 410) await admin.from("push_subscriptions").delete().eq("id", s.id);
    }
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
  }
  const now = new Date();
  const summary: string[] = [];
  const { data: peopleData, error: pe } = await admin.from("people").select("*");
  if (pe) throw pe;
  const people = new Map((peopleData as Person[]).map((p) => [p.id, p]));
  const { data: subsData } = await admin.from("push_subscriptions").select("*");
  const subs = (subsData ?? []) as Sub[];

  // 1) Livraisons
  const { data: delivered, error: de } = await admin.rpc("deliver_due");
  if (de) throw de;
  for (const r of (delivered ?? []) as Round[]) {
    const learner = people.get(r.learner)!;
    const partner = people.get(r.learner === "matis" ? "stella" : "matis")!;
    const { data: w } = await admin.from("words").select("*").eq("id", r.chosen!).single();
    const t = T[learner.lang];
    const by = r.chosen_by === "auto" ? t.auto : t.chosenBy(partner.name);
    const title = t.todayTitle;
    const body = t.todayBody(w as Word, by);
    const sent = await sendTo(learner.id, subs, { title, body, tag: `word-${r.id}`, url: "./" });
    await admin.from("notifications_log").insert({ person_id: learner.id, kind: "word", title, body, sent });
    summary.push(`livré ${learner.name}: ${(w as Word).fr} (${sent})`);
  }

  // 2) Rappels à celui qui doit choisir
  const { data: openRounds } = await admin.from("rounds").select("*").is("delivered_at", null).is("chosen", null).is("reminded_at", null);
  for (const r of (openRounds ?? []) as Round[]) {
    const chooser = people.get(r.learner === "matis" ? "stella" : "matis")!;
    const learner = people.get(r.learner)!;
    const h = localHour(now, chooser.tz);
    const msToDeliver = new Date(r.deliver_at).getTime() - now.getTime();
    if (h < chooser.remind_hour || msToDeliver < 30 * 60 * 1000) continue;
    const t = T[chooser.lang];
    const title = t.remindTitle(learner.name);
    const body = t.remindBody(learner.name);
    const sent = await sendTo(chooser.id, subs, { title, body, tag: `remind-${r.id}`, url: "./" });
    await admin.from("rounds").update({ reminded_at: now.toISOString() }).eq("id", r.id);
    await admin.from("notifications_log").insert({ person_id: chooser.id, kind: "remind", title, body, sent });
    summary.push(`rappel ${chooser.name} (${sent})`);
  }

  return new Response(JSON.stringify({ ok: true, summary }), { headers: { "Content-Type": "application/json" } });
});
