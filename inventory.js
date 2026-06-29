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

  const BATCH = 500;
  let inserted = 0;
  const errors = [];
  for (let i = 0; i < records.length; i += BATCH) {
    const chunk = records.slice(i, i + BATCH);
    const { error } = await supabase
      .from("plot_inventory")
      .upsert(chunk, { onConflict: "sector,plot_no,plot_size" });
    if (error) {
      errors.push(`Batch ${i / BATCH}: ${error.message}`);
    } else {
      inserted += chunk.length;
    }
  }
  return { total: rawRows.length, mapped: records.length, inserted, skipped, errors };
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

module.exports = {
  mapRow,
  importRows,
  resolvePlot,
  buildFeatureMap,
  normRoadWidth,
  yesNo,
};