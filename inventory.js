// inventory.js — Plot Inventory: bulk import + bot plot resolution
const { createClient: createSupabaseClient } = require("@supabase/supabase-js");
const ws = require("ws");

const supabase = createSupabaseClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY,
  { realtime: { transport: ws } }
);

// Normalize a Yes/No-ish value to boolean.
function yesNo(v) {
  if (v === true) return true;
  if (!v) return false;
  const s = String(v).trim().toLowerCase();
  return s === "yes" || s === "y" || s === "1" || s === "true";
}

// Normalize road width like "40ft", "40", "Width_40ft" → "40ft" (or null).
function normRoadWidth(v) {
  if (!v) return null;
  const m = String(v).match(/(\d+)\s*ft/i) || String(v).match(/(\d+)/);
  return m ? `${m[1]}ft` : null;
}

// Build the feature map stored on each plot (keys match feature catalog).
function buildFeatureMap(row) {
  const f = {};
  if (row.corner) f.corner = true;
  if (row.park_face) f.park_facing = true;
  if (row.near_park) f.near_park = true;
  if (row.road_width) f.near_road = row.road_width; // select-type value
  return f;
}

// Map one raw sheet row (object keyed by header) to a plot_inventory record.
// Returns null if the row lacks the essentials (sector + plot no).
function mapRow(raw) {
  // Tolerant header lookup (case/space-insensitive).
  const get = (names) => {
    for (const n of names) {
      for (const k of Object.keys(raw)) {
        if (k.trim().toLowerCase() === n.toLowerCase()) return raw[k];
      }
    }
    return undefined;
  };

  const sector = get(["Sector"]);
  const plotNoRaw = get(["Plot No", "Plot No.", "PlotNo", "Plot Number"]);
  if (!sector || plotNoRaw === undefined || plotNoRaw === null || plotNoRaw === "") return null;

  const plotNo = parseInt(String(plotNoRaw).replace(/\D/g, ""), 10);
  if (Number.isNaN(plotNo)) return null;

  const rec = {
    phase: get(["Phase"]) || null,
    sector: String(sector).trim(),
    plot_no: plotNo,
    plot_type: get(["Plot Type"]) || null,
    plot_size: get(["Plot Size"]) || null,
    corner: yesNo(get(["Corner"])),
    park_face: yesNo(get(["Park Face", "Park Facing"])),
    near_park: yesNo(get(["Nearby Park", "Near Park"])),
    road_width: normRoadWidth(get(["Road Width"])),
    nearby_road: get(["Nearby Road"]) || null,
  };
  rec.features = buildFeatureMap(rec);
  return rec;
}

// Bulk import an array of raw rows. Upserts in batches (safe for 70k).
async function importRows(rawRows) {
  const records = [];
  let skipped = 0;
  for (const raw of rawRows) {
    const rec = mapRow(raw);
    if (rec) records.push(rec);
    else skipped++;
  }

  // Deduplicate on the conflict key (sector + plot_no + plot_size).
  // Later rows win. Track duplicates so we can report them.
  const seen = new Map();
  const duplicates = [];
  for (const rec of records) {
    const key = `${rec.sector}|${rec.plot_no}|${rec.plot_size || ""}`;
    if (seen.has(key)) {
      duplicates.push(`Sector ${rec.sector} Plot ${rec.plot_no}${rec.plot_size ? " (" + rec.plot_size + ")" : ""}`);
    }
    seen.set(key, rec); // last occurrence wins
  }
  const deduped = Array.from(seen.values());

  const BATCH = 500;
  let inserted = 0;
  const errors = [];
  for (let i = 0; i < deduped.length; i += BATCH) {
    const chunk = deduped.slice(i, i + BATCH);
    const { error } = await supabase
      .from("plot_inventory")
      .upsert(chunk, { onConflict: "sector,plot_no,plot_size" });
    if (error) {
      errors.push(`Batch ${Math.floor(i / BATCH)}: ${error.message}`);
    } else {
      inserted += chunk.length;
    }
  }
  return {
    total: rawRows.length,
    mapped: records.length,
    uniqueRows: deduped.length,
    inserted,
    skipped,
    duplicateCount: duplicates.length,
    duplicates: duplicates.slice(0, 20), // sample for display
    errors,
  };
}

// Resolve a specific plot for the bot: features come from inventory,
// base price from the matching pricing band in plot_rates_v2.
async function resolvePlot(sector, plotNo, size = null) {
  // 1. Find the plot in inventory (its real features)
  let invQuery = supabase
    .from("plot_inventory")
    .select("*")
    .eq("sector", sector)
    .eq("plot_no", plotNo);
  if (size) invQuery = invQuery.eq("plot_size", size);
  const { data: invRows } = await invQuery;
  const plot = (invRows && invRows[0]) || null;

  // 2. Find the pricing band: a plot_rates_v2 row whose range contains plotNo
  let bandQuery = supabase
    .from("plot_rates_v2")
    .select("*")
    .eq("sector", sector)
    .lte("plot_no_from", plotNo)
    .gte("plot_no_to", plotNo);
  if (size) bandQuery = bandQuery.eq("size", size);
  const { data: bands } = await bandQuery;
  const band = (bands && bands[0]) || null;

  return { plot, band, found: !!plot || !!band };
}

// Try to extract sector + plot number from a free-text message (code first pass).
// Handles: "sector P plot 6744", "P block 6744", "plot no 6744 sector p", "P-6744"
function extractPlotMention(text) {
  if (!text) return null;
  const t = String(text);

  // Find a plot number (3-5 digits is typical for DHA)
  const plotMatch = t.match(/\b(?:plot|plt|پلاٹ)?\s*(?:no\.?|number|#)?\s*(\d{2,6})\b/i);
  // Find a sector letter (single A-Z, optionally with sub like P or M)
  const sectorMatch = t.match(/\b(?:sector|sec|block|بلاک|سیکٹر)\s*([A-Za-z])\b/i)
    || t.match(/\b([A-Za-z])\s*(?:sector|sec|block)\b/i)  // "P block"
    || t.match(/\b([A-Za-z])[-\s]*\d{2,6}\b/); // "P-6744" or "P 6744"

  if (!plotMatch) return null;
  const plotNo = parseInt(plotMatch[1], 10);
  const sector = sectorMatch ? sectorMatch[1].toUpperCase() : null;

  // Optional size hint
  let size = null;
  if (/\b5\s*marla\b/i.test(t)) size = "5 Marla";
  else if (/\b8\s*marla\b/i.test(t)) size = "8 Marla";
  else if (/\b10\s*marla\b/i.test(t)) size = "10 Marla";
  else if (/\b(1\s*kanal|kanal)\b/i.test(t)) size = "1 Kanal";

  return { sector, plotNo, size, confident: !!sector };
}

// Format a rupee amount into readable "X.X Lakh" / "X.XX Crore".
// Defensive: if a value looks like it was already stored in lakhs by mistake
// (absurdly large), it still renders sanely.
function formatPKR(rupees) {
  if (rupees == null || isNaN(rupees)) return null;
  let n = Number(rupees);
  // Sanity guard: DHA plot prices are < 100 crore (10,000,000,000 rupees).
  // If someone stored the value already in lakhs, n would be ~1e11+; scale it.
  while (n > 1e10) n = n / 100000;
  if (n >= 10000000) return `${(n / 10000000).toFixed(2)} Crore`;
  return `${Math.round(n / 100000)} Lakh`;
}

// Build a resolved quote object the bot can use in its reply.
// Applies feature premiums to the band price. Always meant to be quoted as approx/estimate.
async function buildPlotQuote(sector, plotNo, size, getFeaturePremiums) {
  const { plot, band } = await resolvePlot(sector, plotNo, size);
  if (!plot && !band) return null;

  let quote = { sector, plotNo, size: size || (plot && plot.plot_size) || null, plot, band };

  if (band) {
    const premiums = await getFeaturePremiums();
    const feats = (plot && plot.features) || (band.features) || {};
    let totalPct = 0;
    const applied = [];
    let extraLand = false;
    for (const [key, val] of Object.entries(feats)) {
      if (!val) continue;
      if (key === "extra_land") { extraLand = true; continue; }
      const pct = premiums[key] || 0;
      if (pct > 0) { totalPct += pct; applied.push({ key, pct }); }
    }
    const factor = 1 + totalPct / 100;
    // Work in raw rupees, format at the end (fixes the "1700000L" bug).
    const minR = Number(band.min_price) * factor;
    const maxR = Number(band.max_price) * factor;
    quote.estMinText = formatPKR(minR);
    quote.estMaxText = formatPKR(maxR);
    quote.baseMinText = formatPKR(band.min_price);
    quote.baseMaxText = formatPKR(band.max_price);
    quote.appliedPercent = totalPct;
    quote.appliedFeatures = applied;
    quote.subCategory = band.sub_category || null;
    quote.hasExtraLand = extraLand;
  }
  if (plot) {
    quote.features = Object.keys(plot.features || {});
    quote.nearbyRoad = plot.nearby_road || null;
  }
  return quote;
}

module.exports = {
  mapRow,
  importRows,
  resolvePlot,
  buildFeatureMap,
  normRoadWidth,
  yesNo,
  extractPlotMention,
  buildPlotQuote,
};