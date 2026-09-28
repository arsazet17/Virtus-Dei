import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const ALLOWED_ORIGINS = new Set([
  "https://arsazet17.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
]);

function headers(origin: string) {
  return {
    "content-type": "application/json",
    "Access-Control-Allow-Origin": origin || "https://arsazet17.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
}

function json(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), { status, headers: headers(origin) });
}

function cleanNumbers(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 80))];
}

function columnOf(n: number) { return n % 10 === 0 ? 10 : n % 10; }
function validNumber(n: number) { return Number.isInteger(n) && n >= 1 && n <= 80; }
function roundShare(value: number) { return Number(value.toFixed(4)); }

function relationProfile(number: number, usable: any[], freq: Map<number, number>, factSet: Set<number>) {
  const total = usable.length || 1;
  const n1 = [number - 1, number + 1].filter(validNumber);
  const n2 = [number - 2, number + 2].filter(validNumber);
  const col = columnOf(number);
  const exactShots = usable.filter(s => s.nums.includes(number)).length;
  const neighbor1Shots = usable.filter(s => s.nums.some((v: number) => n1.includes(v))).length;
  const neighbor2Shots = usable.filter(s => s.nums.some((v: number) => n2.includes(v))).length;
  const sameColumnShots = usable.filter(s => s.nums.some((v: number) => v !== number && columnOf(v) === col)).length;
  const neighbor1Seen = n1.filter(n => freq.has(n));
  const neighbor2Seen = n2.filter(n => freq.has(n));
  const sameColumnSeen = [...freq.keys()]
    .filter(n => n !== number && columnOf(n) === col)
    .sort((a, b) => a - b);

  let tier = "cold";
  if (exactShots > 0) tier = "direct";
  else if (neighbor1Shots > 0) tier = "neighbor_1";
  else if (neighbor2Shots > 0) tier = "neighbor_2";
  else if (sameColumnShots > 0) tier = "same_column";

  return {
    number,
    hit: factSet.has(number),
    column: col,
    tier,
    exact_shots: exactShots,
    exact_share: roundShare(exactShots / total),
    neighbor1_shots: neighbor1Shots,
    neighbor1_share: roundShare(neighbor1Shots / total),
    neighbor1_numbers_seen: neighbor1Seen,
    neighbor2_shots: neighbor2Shots,
    neighbor2_share: roundShare(neighbor2Shots / total),
    neighbor2_numbers_seen: neighbor2Seen,
    same_column_shots: sameColumnShots,
    same_column_share: roundShare(sameColumnShots / total),
    same_column_numbers_seen: sameColumnSeen
  };
}

function buildRelationStats(profiles: any[]) {
  const tiers = ["direct", "neighbor_1", "neighbor_2", "same_column", "cold"];
  const tierCounts: Record<string, number> = {};
  const tierHits: Record<string, number> = {};
  for (const tier of tiers) {
    const rows = profiles.filter(p => p.tier === tier);
    tierCounts[tier] = rows.length;
    tierHits[tier] = rows.filter(p => p.hit).length;
  }

  const unseen = profiles.filter(p => p.exact_shots === 0);
  const signal = (predicate: (p: any) => boolean) => {
    const rows = unseen.filter(predicate);
    return { candidates: rows.length, hits: rows.filter(p => p.hit).length };
  };

  return {
    tier_counts: tierCounts,
    tier_hits: tierHits,
    unseen_total: unseen.length,
    unseen_hits: unseen.filter(p => p.hit).length,
    neighbor1_unseen: signal(p => p.neighbor1_shots > 0),
    neighbor2_unseen: signal(p => p.neighbor2_shots > 0),
    same_column_unseen: signal(p => p.same_column_shots > 0),
    cold_unseen: signal(p => p.neighbor1_shots === 0 && p.neighbor2_shots === 0 && p.same_column_shots === 0)
  };
}

async function syncLearning(db: any) {
  const { data: rawTargets, error: targetError } = await db
    .from("screenshots")
    .select("target_draw_number")
    .eq("ocr_status", "verified")
    .not("target_draw_number", "is", null);
  if (targetError) throw targetError;

  const targets = [...new Set((rawTargets || []).map((r: any) => Number(r.target_draw_number)).filter(Number.isFinite))];
  if (!targets.length) return { synced: 0, targets: [] };

  const { data: draws, error: drawError } = await db
    .from("draws")
    .select("id,draw_number,result_numbers,draw_time,raw")
    .in("draw_number", targets);
  if (drawError) throw drawError;

  let synced = 0;
  const syncedTargets: number[] = [];

  for (const draw of draws || []) {
    const target = Number(draw.draw_number);
    const fact = cleanNumbers(draw.result_numbers);
    if (fact.length !== 20) continue;

    const { data: shots, error: shotsError } = await db
      .from("screenshots")
      .select("id,ocr_numbers,ocr_confidence,created_at")
      .eq("target_draw_number", target)
      .eq("ocr_status", "verified")
      .order("created_at", { ascending: true });
    if (shotsError) throw shotsError;

    const usable = (shots || [])
      .map((s: any) => ({ ...s, nums: cleanNumbers(s.ocr_numbers) }))
      .filter((s: any) => s.nums.length === 10);
    if (!usable.length) continue;

    const freq = new Map<number, number>();
    const colFreq = Array(11).fill(0);
    const pairFreq = new Map<string, number>();

    for (const shot of usable) {
      const nums = [...new Set<number>(shot.nums)].sort((a, b) => a - b);
      for (const n of nums) {
        freq.set(n, (freq.get(n) || 0) + 1);
        colFreq[columnOf(n)]++;
      }
      for (let i = 0; i < nums.length; i++) {
        for (let j = i + 1; j < nums.length; j++) {
          const key = `${nums[i]}-${nums[j]}`;
          pairFreq.set(key, (pairFreq.get(key) || 0) + 1);
        }
      }
    }

    const union = [...freq.keys()].sort((a, b) => a - b);
    const absent = Array.from({ length: 80 }, (_, i) => i + 1).filter(n => !freq.has(n));
    const threshold = usable.length >= 2 ? Math.max(2, Math.ceil(usable.length * 0.60)) : Infinity;
    const persistent = [...freq.entries()]
      .filter(([, count]) => count >= threshold)
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .map(([n]) => n);

    const factSet = new Set(fact);
    const unionSet = new Set(union);
    const persistentSet = new Set(persistent);
    const unionHits = fact.filter(n => unionSet.has(n));
    const persistentHits = fact.filter(n => persistentSet.has(n));
    const absentHits = fact.filter(n => !unionSet.has(n));
    const proposedMisses = union.filter(n => !factSet.has(n));

    const perShotHits = usable.map((shot: any) => {
      const matched = shot.nums.filter((n: number) => factSet.has(n));
      return { screenshot_id: shot.id, hits: matched.length, matched };
    });

    const numberFrequencies: Record<string, number> = {};
    for (const [n, count] of [...freq.entries()].sort((a, b) => a[0] - b[0])) numberFrequencies[String(n)] = count;

    const topPairs = [...pairFreq.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 60);
    const pairFrequencies: Record<string, number> = {};
    for (const [key, count] of topPairs) pairFrequencies[key] = count;

    const columnFrequencies: Record<string, number> = {};
    for (let c = 1; c <= 10; c++) columnFrequencies[String(c)] = colFreq[c];

    // v3: every number 1..80 gets a labelled relation profile. This is the
    // training base for future forecasts: no arbitrary weights are imposed here.
    const relationProfiles = Array.from({ length: 80 }, (_, i) => relationProfile(i + 1, usable, freq, factSet));
    const relationStats = buildRelationStats(relationProfiles);
    const missRelations = absentHits.map(n => relationProfiles[n - 1]);

    const features = {
      union_numbers: union,
      persistent_numbers: persistent,
      union_count: union.length,
      persistent_count: persistent.length,
      union_hit_count: unionHits.length,
      persistent_hit_count: persistentHits.length,
      absent_hit_count: absentHits.length,
      expected_union_hits: Number((union.length * 20 / 80).toFixed(2)),
      expected_persistent_hits: Number((persistent.length * 20 / 80).toFixed(2)),
      expected_absent_hits: Number((absent.length * 20 / 80).toFixed(2)),
      per_screenshot_hits: perShotHits,
      column_frequencies: columnFrequencies,
      threshold,
      relation_profiles: relationProfiles,
      relation_stats: relationStats
    };

    const conclusions = {
      fact_numbers: fact,
      offered_hit_numbers: unionHits,
      persistent_hit_numbers: persistentHits,
      absent_hit_numbers: absentHits,
      proposed_missed_numbers: proposedMisses,
      miss_relations: missRelations,
      status: "computed"
    };

    const comparisonRows = usable.map((shot: any) => {
      const matched = shot.nums.filter((n: number) => factSet.has(n));
      return {
        screenshot_id: shot.id,
        draw_id: draw.id,
        matched_numbers: matched,
        hit_count: matched.length,
        missed_draw_numbers: fact.filter(n => !shot.nums.includes(n)),
        analysis: {
          selected_numbers: shot.nums,
          expected_hits: 2.5,
          delta_vs_random_expectation: Number((matched.length - 2.5).toFixed(2)),
          model_version: "virtus-screen-learning-v3-relations"
        }
      };
    });

    const { error: cmpError } = await db
      .from("comparisons")
      .upsert(comparisonRows, { onConflict: "screenshot_id,draw_id" });
    if (cmpError) throw cmpError;

    const { error: learnError } = await db
      .from("learning_observations")
      .upsert({
        draw_id: draw.id,
        target_draw_number: target,
        screenshot_count: usable.length,
        number_frequencies: numberFrequencies,
        absent_numbers: absent,
        pair_frequencies: pairFrequencies,
        features,
        conclusions,
        model_version: "virtus-screen-learning-v3-relations"
      }, { onConflict: "draw_id" });
    if (learnError) throw learnError;

    synced++;
    syncedTargets.push(target);
  }

  return { synced, targets: syncedTargets, model_version: "virtus-screen-learning-v3-relations" };
}

async function history(db: any, limit = 160) {
  const safeLimit = Math.min(300, Math.max(20, Number(limit) || 160));
  const { data: screenshots, error: screenshotError } = await db
    .from("screenshots")
    .select("id,target_draw_number,original_path,marked_path,captured_at,received_at,ocr_numbers,ocr_confidence,ocr_status,created_at")
    .order("created_at", { ascending: false })
    .limit(safeLimit);
  if (screenshotError) throw screenshotError;

  const paths = (screenshots || []).map((s: any) => s.original_path).filter(Boolean);
  const urlByPath = new Map<string, string>();
  if (paths.length) {
    const { data: signed, error: signedError } = await db.storage
      .from("virtus-screenshots")
      .createSignedUrls(paths, 3600);
    if (!signedError) {
      for (const item of signed || []) if (item.path && item.signedUrl) urlByPath.set(item.path, item.signedUrl);
    }
  }

  const normalized = (screenshots || []).map((s: any) => ({
    id: s.id,
    target_draw_number: Number(s.target_draw_number),
    original_path: s.original_path,
    image_url: urlByPath.get(s.original_path) || null,
    captured_at: s.captured_at,
    received_at: s.received_at,
    ocr_numbers: cleanNumbers(s.ocr_numbers),
    ocr_confidence: s.ocr_confidence == null ? null : Number(s.ocr_confidence),
    ocr_status: s.ocr_status,
    created_at: s.created_at
  }));

  const { data: learning, error: learningError } = await db
    .from("learning_observations")
    .select("target_draw_number,screenshot_count,number_frequencies,absent_numbers,pair_frequencies,features,conclusions,model_version,created_at")
    .order("target_draw_number", { ascending: false })
    .limit(120);
  if (learningError) throw learningError;

  return { screenshots: normalized, learning: learning || [] };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ ok: false, error: "origin not allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(origin) });
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405, origin);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(url, serviceRole, { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "history");

    if (action === "sync") {
      const result = await syncLearning(db);
      return json({ ok: true, ...result }, 200, origin);
    }

    if (action === "correct") {
      const screenshotId = String(body?.screenshot_id || "");
      const numbers = cleanNumbers(body?.numbers);
      if (!screenshotId || numbers.length !== 10) return json({ ok: false, error: "screenshot_id and exactly 10 unique numbers are required" }, 400, origin);
      const { error } = await db.from("screenshots").update({
        ocr_numbers: numbers,
        ocr_confidence: 100,
        ocr_status: "verified"
      }).eq("id", screenshotId);
      if (error) throw error;
      await syncLearning(db);
      return json({ ok: true, numbers }, 200, origin);
    }

    if (action === "history") {
      const data = await history(db, body?.limit);
      return json({ ok: true, ...data }, 200, origin);
    }

    if (action === "sync_history") {
      const sync = await syncLearning(db);
      const data = await history(db, body?.limit);
      return json({ ok: true, sync, ...data }, 200, origin);
    }

    return json({ ok: false, error: "unknown action" }, 400, origin);
  } catch (error) {
    return json({ ok: false, error: String((error as any)?.message ?? error) }, 500, origin);
  }
});
