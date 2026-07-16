require("dotenv").config();
const path = require("path");
const express = require("express");
const { MessagingResponse } = require("twilio").twiml;
const twilio = require("twilio");
const OpenAI = require("openai");
const db = require("./database");
const auth = require("./auth");
const assignments = require("./assignments");
const inventory = require("./inventory");
const fs = require("fs");
const rateLimit = require("express-rate-limit");

const app = express();
app.set("trust proxy", 1); // Render runs behind a proxy; needed for correct client IPs
app.use(express.urlencoded({ extended: false, limit: "25mb" }));
app.use(express.json({ limit: "25mb" }));

// Brute-force protection on login: max 8 attempts per 15 min per IP.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again in 15 minutes." },
});

// General API limiter: 300 requests/min per IP (generous; stops abuse/scraping).
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

// CORS Middleware - MUST be first
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Apply the general rate limiter to all API routes.
app.use("/api/", apiLimiter);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── FETCH LIVE DATA FROM DATABASE ────────────────────────────────────
async function getLiveContext() {
  try {
    const [projectsRes, ratesRes, companyRes] = await Promise.all([
      db.supabase.from('projects').select('*'),
      db.supabase.from('plot_rates_v2').select('*').limit(100),
      db.supabase.from('company_profile').select('*').single()
    ]);

    const projects = projectsRes.data || [];
    const rates = ratesRes.data || [];
    const company = companyRes.data || null;

    // Fetch units for each project (projects ≠ plots — different things entirely)
    for (const p of projects) {
      const { data: units } = await db.supabase.from("project_units").select("*").eq("project_id", p.id);
      p._units = units || [];
    }

    // Feature premium % (so the bot can quote feature-adjusted prices)
    let premiums = {};
    let featureDefs = [];
    try {
      premiums = await assignments.getFeaturePremiums();
      featureDefs = await assignments.getFeatureDefs();
    } catch (e) { /* non-critical */ }

    console.log("🔍 Fetched", projects.length, "projects,", rates.length, "plot rates");

    let context = `\n\n=== LIVE COMPANY DATA (Updated) ===\n`;

    // Company Profile
    if (company) {
      context += `\nCOMPANY: ${company.name}\n`;
      context += `About: ${company.about}\n`;
      context += `Website: ${company.website}\n`;
      context += `Phone: ${company.phone}\n`;
      context += `Email: ${company.email}\n`;
      context += `Address: ${company.address}\n`;
      if (company.knowledge) {
        context += `\n--- POLICIES & FAQ (answer these directly when asked — transfer charges, possession, process, etc.) ---\n${company.knowledge}\n`;
      }
    }

    // Projects
    if (projects.length > 0) {
      context += `\n--- PROJECTS (built developments — apartments/houses/shops for booking. These are NOT plots. Each project prices differently.) ---\n`;
      projects.forEach(p => {
        context += `\n🏢 ${p.name}\n`;
        if (p.location) context += `Location: ${p.location}\n`;
        if (p.description) context += `Description: ${p.description}\n`;
        if (p.status) context += `Status: ${p.status}\n`;
        if (p.brochure_url) context += `Brochure link (share when relevant): ${p.brochure_url}\n`;
        if (p.floor_map_url) context += `Floor map link (share when relevant): ${p.floor_map_url}\n`;

        const type = p.pricing_type || "consultant_only";
        const units = p._units || [];

        if (type === "consultant_only") {
          context += `PRICING: This is a themed project with amenity-based pricing. Do NOT quote numbers. Tell the client our senior sales consultant will share exact prices, and offer to connect them.\n`;
        } else if (type === "installment") {
          context += `PRICING TYPE: Installment houses. For each size, quote total, down payment, monthly and duration.\n`;
          if (units.length) {
            units.forEach(u => {
              let l = `  • ${u.unit_type || u.size || "Unit"}`;
              if (u.total_price) l += `: Total approx Rs ${(u.total_price/100000).toFixed(1)}L`;
              if (u.down_payment) l += `, Down payment ~Rs ${(u.down_payment/100000).toFixed(1)}L`;
              if (u.monthly) l += `, Monthly ~Rs ${(u.monthly/1000).toFixed(0)}k`;
              if (u.duration_months) l += ` for ${u.duration_months} months`;
              l += ` [${u.availability||"available"}]`;
              context += l + `\n`;
            });
          }
        } else if (type === "per_sqft") {
          context += `PRICING TYPE: Per square foot. Total = rate/sqft × size. Floors are the same rate; size drives the price.\n`;
          if (units.length) {
            units.forEach(u => {
              let l = `  • ${u.unit_type || "Unit"}`;
              if (u.sqft) l += `, ${u.sqft} sqft`;
              if (u.rate_per_sqft) {
                l += ` @ Rs ${u.rate_per_sqft.toLocaleString()}/sqft`;
                if (u.sqft) l += ` → approx Rs ${((u.rate_per_sqft*u.sqft)/100000).toFixed(1)}L total`;
              }
              l += ` [${u.availability||"available"}]`;
              context += l + `\n`;
            });
          }
          context += `When quoting, compute rate × size, present as approx, and confirm availability. Offer agent for booking.\n`;
        }
      });
    }

    // Plot Rates
    if (rates.length > 0) {
      context += `\n--- CURRENT PLOT RATES (BASE PRICES) ---\n`;
      const ratesByType = {};
      rates.forEach(r => {
        const key = `${r.sector}-${r.size}`;
        if (!ratesByType[key]) {
          ratesByType[key] = [];
        }
        // Note any features stored on this plot row
        let featTag = "";
        if (r.features && typeof r.features === "object") {
          const on = Object.entries(r.features).filter(([k, v]) => v).map(([k]) => k);
          if (on.length) featTag = ` [features: ${on.join(", ")}]`;
        }
        const subTag = r.sub_category ? ` [${r.sub_category}]` : "";
        const fmt = (v) => { let n = Number(v); while (n > 1e10) n = n/100000; return n >= 1e7 ? `${(n/1e7).toFixed(2)}Cr` : `${Math.round(n/1e5)}L`; };
        ratesByType[key].push(`Plot ${r.plot_no_from}-${r.plot_no_to}${subTag}: Rs ${fmt(r.min_price)} - ${fmt(r.max_price)}${featTag}`);
      });

      Object.entries(ratesByType).forEach(([key, values]) => {
        context += `\n${key}:\n`;
        values.forEach(v => context += `  ${v}\n`);
      });
    }

    // Feature premiums — how features adjust the base price
    if (Object.keys(premiums).length > 0) {
      context += `\n--- FEATURE PRICING RULES ---\n`;
      context += `These percentages are ADDED to a plot's BASE price when the plot has that feature. Multiple features add together.\n`;
      featureDefs.forEach(d => {
        if (d.key === "extra_land") {
          context += `• Extra Land: NOT a fixed %. If a plot has extra land, tell the client the extra land is sold separately and the price is decided at purchase — our team will guide them.\n`;
        } else {
          const pct = premiums[d.key] || 0;
          context += `• ${d.label}: +${pct}%\n`;
        }
      });
      context += `\nExample: a 20L base plot that is Corner (+10%) and Park Facing (+10%) = 20L + 20% = 24L.\n`;
      context += `When a client asks about a specific plot, check its [features] tag above and apply these % to give an accurate estimate. Always present it as an estimate and offer to connect them to an agent for the final price.\n`;
    }

    return context;
  } catch (err) {
    console.error("❌ Context error:", err.message);
    return '';
  }
}

// ─── BUILD INTELLIGENT SYSTEM PROMPT ──────────────────────────────────
async function buildSystemPrompt(client = {}) {
  const liveContext = await getLiveContext();
  console.log("📊 Live context length:", liveContext.length);
  console.log("📊 Context preview:", liveContext.substring(0, 200));

  // Tell the AI the current handoff state so it behaves naturally.
  let handoffNote = "";
  if (client.escalated) {
    handoffNote = `

⚠️ HANDOFF STATUS: This client has ALREADY been handed off to the human sales team.
- Keep helping them naturally: answer any questions about projects, plots, rates, locations, investment.
- A human agent will contact them separately — you may gently reassure them of this if relevant, but do NOT make them feel ignored or stuck.
- Do NOT write [ESCALATE] again for the same buying intent. Only write [ESCALATE] if the client raises a clearly NEW request that needs a human (e.g. a different property/deal, a scheduling change, or an explicit "transfer me again").
- Never repeat a robotic "team will contact you" line on every message. Continue the conversation like a knowledgeable assistant.`;
  }

  return `You are an intelligent, friendly sales assistant for Bodla Group — a leading real estate company in DHA Multan, Pakistan.

YOUR CORE ROLE:
- Understand what the client wants naturally (no keyword matching)
- Answer questions about projects, plots, rates, locations, investment
- Engage in natural conversation
- Provide accurate information from company database

🔒 CRITICAL PRICING RULES (never break these):
- NEVER reveal internal plot-number ranges or bands. Do NOT say things like "plots 6700 to 6850 are priced at...". The client only cares about THEIR plot — talk about that specific plot only.
- ALWAYS phrase any price as approximate: use "approx", "andazan", "estimate". Never give a fixed/final price.
- When you are given a RESOLVED PLOT block below, its features are already known — use them, do NOT ask the client whether the plot is corner/park-facing/etc.
- For exact/final price, offer to connect them with an agent.

🚫 PLOTS vs PROJECTS — NEVER MIX THESE (very important):
- PLOTS are empty land in DHA sectors (identified by sector + plot number), priced via sector rates + features. 
- PROJECTS are built developments (like One Destination) with apartments/shops/offices for booking, priced per unit type.
- These are COMPLETELY different products. NEVER apply plot logic to a project or project logic to a plot.
- Do NOT quote a project using plot pricing (sectors, plot numbers, corner/park premiums). Projects are priced by their unit types only.
- Do NOT quote a plot using project logic. 
- If a client asks about a project, use ONLY the PROJECTS data. If about a plot, use ONLY plot data. Never blend the two in one answer.
- If unclear whether they mean a plot or a project, ask them to clarify which one.

🗣️ LANGUAGE — MIRROR THE CLIENT EXACTLY:
- Reply in the SAME language and script the client used. This matters a lot.
- Client writes Roman-Urdu ("kya haal hai", "plot ka rate btayen") → reply in Roman-Urdu.
- Client writes real Urdu script ("مجھے پلاٹ کی قیمت بتائیں") → reply in Urdu script (e.g. "میں بالکل ٹھیک ہوں اور آپ کی مدد کے لیے تیار ہوں").
- Client writes English → reply in English.
- Client mixes English + Urdu → mirror that same mix naturally.
- If they switch language mid-conversation, switch with them immediately.
- Never reply in English to an Urdu-script message, and never reply in Urdu script to an English message.

🧠 CONVERSATION MEMORY:
- The conversation history is THIS client's own history only. Use it.
- Remember what they told you: budget, the plot they asked about, what they said they'd think over. Refer back naturally, like a dealer who knows his client.
- Never re-ask something they already answered. Never re-explain what you already told them.

🗣️ TALKING STYLE:
- Warm, natural, concise — like a helpful human salesperson, not a form.
- Avoid repeating the same sentence structure every reply. Vary your wording.
- Don't over-ask. If you already have the info (e.g. resolved plot features), just give the answer.
- Match the client's language (Urdu/Roman-Urdu/English) naturally.

👔 YOU ARE THE SALESPERSON (this defines your whole behavior):
- You ARE Bodla Group's expert sales representative. You are NOT a receptionist who forwards people to "the sales team".
- ANSWER THE QUESTION DIRECTLY AND SPECIFICALLY FIRST. Never dodge a question you can answer. Clients get frustrated by vague, general replies — they have told us this directly.
- After answering, ask ONE sharp, relevant follow-up that moves toward a decision (budget, purpose, timeline, cash vs installment, buy vs sell). Exactly ONE — not a list.
- Do NOT end with "I can connect you with our sales expert" as a default. That is a crutch. Only offer a human when the client shows real buying intent, wants to visit/negotiate/book, explicitly asks for a person, or you genuinely lack the data.

🎯 BE SPECIFIC, NOT GENERAL (clients complained about this directly):
- Bad (general): "Sector V has modern infrastructure, parks, good investment potential..."
- Good (specific): "Sector V 5 Marla is around 22–25 lakh. Corner plots add ~10%. Aap ka budget kya hai — main us ke hisaab se best plot batata hoon?"
- Never give a generic brochure-style list when the client asked something specific. Answer THEIR exact question with real numbers/facts from your data.
- If a client says "that's too general" or "be specific" — immediately give concrete numbers, a specific plot, or a specific next step. Never repeat the generic answer.
- Don't re-explain the same sector generically twice. If you already told them, go deeper or ask a qualifying question instead.

💰 WHEN YOU HAVE THE DATA, USE IT:
- If a RESOLVED PLOT block is given below, quote its price and features directly. Do NOT say "I don't have the pricing" when the data is right there.
- For transfer charges, possession, transfer process — if that info is in your context below, answer it directly. Only defer if it is genuinely not provided.
- Never invent facts you don't have. But never dodge facts you DO have.

🎣 DON'T LET THE CLIENT WALK AWAY:
- If a client loses interest or raises an objection ("police line nearby", "too expensive", "I'll look elsewhere"), engage like a salesperson: acknowledge, then offer a specific alternative or reframe. E.g. "Acha point — main aap ko us side se door, better located 5 Marla dikha deta hoon, thoda budget adjust ho to."
- Turn objections into the next question. Keep the conversation moving toward a visit, a call, or a specific option.

🤝 HANDOFF — only at the right moment, and like a closer:
- Hand off ONLY on real buying intent, a visit/booking request, negotiation, explicit ask for a person, or when you truly lack the data.
- When you do, be specific and urgent: "Hamara sales expert abhi aap ko call karta hai is plot ke liye" — a concrete next step, never a vague "team will contact you."

😐 EMOJIS: Use very sparingly (usually none). Too many emojis make you look like a bot, not a professional dealer.

YOUR BEHAVIOR:

🎯 INFORMATION STAGE:
Answer ALL questions about:
- Project details, features, amenities, locations
- Plot sizes, prices, payment plans
- Investment potential, market insights
- Company background, credentials
- Location benefits, nearby facilities

Provide detailed, helpful answers. Ask follow-up questions to understand their needs better.

⚡ ESCALATION STAGE:
ONLY escalate to human agent when client clearly expresses:
1. Intent to purchase/book: "book karna hai", "lena hai", "buy", "purchase", "finalize deal"
2. Request for meeting/visit: "visit karna chahta hoon", "office aana chahta hoon", "agent se milna hai"
3. Specific transaction help: "payment kaise hoti hai", "possession kab milega", "contract kaise banegi"
4. After answering multiple detailed questions and client shows serious buying intent

DO NOT escalate for:
- General project information questions
- Simple price/rate inquiries
- Location/amenity questions
- Company questions
- "Tell me more" requests

CONSIDER a handoff (soft) when:
- Client asks decision-level questions like "should I sell or keep?", "is it a good time to invest?", "which plot is better for me?" — these are high-intent. Answer helpfully and consultatively (without giving definitive financial guarantees), THEN offer a personal call from your sales expert to guide their specific decision.
- Client is comparing options seriously or hesitating — engage, then offer expert guidance as a concrete next step.

🧑‍💼 ACT LIKE A REAL SALESPERSON (very important):
You are not a form or an FAQ bot. You are a confident, warm sales consultant who wants to WIN the client.
- Do NOT end every message by deferring to the "sales team". That is a weak habit — avoid it. Keep the conversation yourself, answer confidently, and build interest.
- Mention connecting to a sales expert ONLY at the right moment (see below), not as filler in every reply.
- When a client hesitates or says "I'll look elsewhere / koi aur dekh leta hoon", DON'T let them go. Do what a good salesperson does: ask a smart question to understand their need, then redirect to a better option. ("Aap kis type ki investment soch rahe hain? Main aapko is se behtar option bhi dikha sakta hoon.")
- Stay engaged, guide the client, create gentle urgency, and move them toward a decision (a visit, a call, or a serious next step).
- Be genuinely helpful and knowledgeable so the client trusts you.

⚡ WHEN TO BRING IN A SALES EXPERT (escalate):
Escalate when the client reaches a DECISIVE moment — real buying signal, wants to book/visit/pay, is negotiating, or is about to walk away and a human could save the deal.
When you do, phrase it like a confident handoff that adds value and urgency, e.g.:
- "Is plot ke liye hamara sales expert abhi aapko call karta hai taake exact price aur best deal finalize ho sake."
- "Main aapki call hamare senior sales consultant ko transfer kar deta hoon, woh aapko personally guide karenge."
Then on a NEW LINE write exactly ONE tag:
- [ESCALATE:PLOT] — for plot buying/selling, plot rates, plot files, sectors, plot investment (Plot Trading team)
- [ESCALATE:PROJECT] — for projects, apartments, shops, bookings, installment plans (Project Sales team)
If unsure, use [ESCALATE:PLOT].

Do NOT escalate just because you answered a question. Only escalate at a genuine decisive moment. In normal Q&A, keep talking yourself.

YOUR STYLE:
- Warm, confident, natural — like an experienced human sales consultant, not a script.
- Vary your wording; never repeat the same closing line every message.
- Adapt to client's language (formal/casual/Urdu mix).
- Use real estate terminology naturally.
- Keep WhatsApp replies concise (2-4 lines), but persuasive.
- Be honest about data; never invent facts or prices.

${liveContext}
${handoffNote}

Remember: You have LIVE company data above. Use it to answer accurately. If client asks about something not in the data, acknowledge it professionally.`;
}

// ─── CHECK IF SHOULD ESCALATE (+ which department) ────────────────────
// Returns null if no escalation, else 'PLOT' or 'PROJECT'.
function getEscalation(aiReply) {
  const m = aiReply.match(/\[ESCALATE(?::(PLOT|PROJECT))?\]/i);
  if (!m) return null;
  if (m[1]) return m[1].toUpperCase();
  // Plain [ESCALATE] with no dept → infer from content, default PLOT.
  const text = aiReply.toLowerCase();
  if (text.includes("project") || text.includes("apartment") || text.includes("booking") || text.includes("installment")) {
    return "PROJECT";
  }
  return "PLOT";
}

function shouldEscalate(aiReply) {
  return getEscalation(aiReply) !== null;
}

function cleanReply(text) {
  return text.replace(/\[ESCALATE(?::(?:PLOT|PROJECT))?\]/gi, "").trim();
}

// ─── SEND MESSAGE TO SALES AGENT ─────────────────────────────────────
async function notifyAgent(clientPhone, clientName, chatHistory) {
  const agentPhone = process.env.SALES_AGENT_WHATSAPP;
  const from = `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`;

  const header =
    `🔔 *New Lead — Bodla Bot*\n` +
    `*Client:* ${clientName || "Unknown"}\n` +
    `*Phone:* ${clientPhone}\n` +
    `*Follow-up needed*`;

  await twilioClient.messages.create({
    from,
    to: `whatsapp:${agentPhone}`,
    body: header,
  });

  const lines = chatHistory.map(
    (m) => `${m.role === "user" ? clientName || "Client" : "Bot"}: ${m.content}`
  );

  const LIMIT = 1400;
  let chunk = "*Chat Log:*\n";
  let chunkNum = 1;

  for (const line of lines) {
    if ((chunk + "\n" + line).length > LIMIT) {
      await twilioClient.messages.create({
        from,
        to: `whatsapp:${agentPhone}`,
        body: chunk,
      });
      chunkNum++;
      chunk = `*Chat Log (cont.):*\n${line}`;
    } else {
      chunk += "\n" + line;
    }
  }

  if (chunk.trim()) {
    await twilioClient.messages.create({
      from,
      to: `whatsapp:${agentPhone}`,
      body: chunk,
    });
  }
}

// ─── MAIN WEBHOOK ────────────────────────────────────────────────────
// Validate that requests genuinely come from Twilio (unless explicitly disabled).
function validateTwilio(req, res, next) {
  if (process.env.VALIDATE_TWILIO === "false") return next(); // escape hatch for local testing
  const signature = req.headers["x-twilio-signature"];
  const url = `https://${req.headers.host}${req.originalUrl}`;
  const valid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    signature,
    url,
    req.body
  );
  if (!valid) {
    console.warn("⛔ Rejected webhook: invalid Twilio signature from", req.ip);
    return res.status(403).send("Forbidden");
  }
  next();
}

// In-memory dedup of recently processed message SIDs (Twilio retries on slow responses).
const _processedMsgs = new Map();
function alreadyProcessed(sid) {
  if (!sid) return false;
  const now = Date.now();
  // purge entries older than 5 min
  for (const [k, t] of _processedMsgs) if (now - t > 300000) _processedMsgs.delete(k);
  if (_processedMsgs.has(sid)) return true;
  _processedMsgs.set(sid, now);
  return false;
}

app.post("/webhook", validateTwilio, async (req, res) => {
console.log("🔔 WEBHOOK RECEIVED:", req.body.From, req.body.Body);

  const incomingMsg = req.body.Body?.trim();
  const clientPhone = req.body.From?.replace("whatsapp:", "");
  const profileName = req.body.ProfileName || null;
  const msgSid = req.body.MessageSid || req.body.SmsMessageSid;

  if (!incomingMsg || !clientPhone) {
    return res.status(400).send("Bad request");
  }

  // Guard against Twilio retrying the same message (causes double replies).
  if (alreadyProcessed(msgSid)) {
    console.log("⏭️ Duplicate message ignored:", msgSid);
    return res.type("text/xml").send(new MessagingResponse().toString());
  }

  const twiml = new MessagingResponse();

  try {
    // 1. Get or create client
    let client = await db.getClient(clientPhone);
    if (!client) {
      client = await db.createClient(clientPhone, profileName);
    } else if (!client.name && profileName) {
      await db.updateClientName(clientPhone, profileName);
      client.name = profileName;
    }

    // 2. Save incoming message
    await db.saveMessage(clientPhone, "user", incomingMsg);

    // NOTE: We intentionally do NOT short-circuit escalated clients with a
    // canned holding reply. This is an AI chatbot — it should keep answering
    // naturally even after handoff. The system prompt is told about the
    // handoff state so it won't re-escalate the same intent.

    // 4. Load chat history (capped, strictly this client's own messages)
    const history = await db.getChatHistory(clientPhone);

    // 4a. Returning-client detection: how long since their last message?
    let continuityNote = "";
    if (history.length > 0) {
      const last = history[history.length - 1];
      const gapMs = Date.now() - new Date(last.created_at).getTime();
      const gapHours = gapMs / 3600000;
      if (gapHours >= 6) {
        const when = gapHours >= 48
          ? `${Math.round(gapHours / 24)} days ago`
          : `${Math.round(gapHours)} hours ago`;
        continuityNote = `\n\n--- RETURNING CLIENT ---\n`;
        continuityNote += `This client last spoke with you ${when}. They are coming BACK, not starting fresh.\n`;
        continuityNote += `Greet them warmly like a salesperson who remembers them (e.g. "Kaise hain aap sir!"), and reference what you discussed last time from the conversation history above — the plot/option they were considering, or what they said they'd think about.\n`;
        continuityNote += `Example shape: "Kaise hain aap. Aap ke paas [X] ka option tha — phir kya socha aap ne? Ya koi aur options dekhein?"\n`;
        continuityNote += `Do NOT repeat a generic intro as if you've never met them. Pick up where you left off.\n`;
      }
    }

    // 4b. Try to resolve a specific plot the client mentioned (code first pass).
    let plotFacts = "";
    let mention = inventory.extractPlotMention(incomingMsg);
    // AI fallback: if we found a plot number but not the sector, or nothing clear,
    // and the message looks plot-related, let the AI extract.
    if ((!mention || !mention.confident) && /\b\d{2,6}\b|plot|پلاٹ|rate|قیمت|price/i.test(incomingMsg)) {
      try {
        const ext = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{
            role: "user",
            content: `Extract the DHA plot reference from this message. Reply ONLY as JSON {"sector":"<letter or null>","plot":<number or null>,"size":"<e.g. 5 Marla or null>"}. Message: "${incomingMsg}"`
          }],
          max_tokens: 60,
          temperature: 0,
        });
        const parsed = JSON.parse(ext.choices[0].message.content.replace(/```json|```/g, "").trim());
        if (parsed.plot) {
          mention = {
            sector: parsed.sector ? String(parsed.sector).toUpperCase() : (mention && mention.sector) || null,
            plotNo: parseInt(parsed.plot, 10),
            size: parsed.size || (mention && mention.size) || null,
            confident: !!parsed.sector,
          };
        }
      } catch (e) { /* extraction is best-effort */ }
    }

    if (mention && mention.sector && mention.plotNo) {
      try {
        const quote = await inventory.buildPlotQuote(
          mention.sector, mention.plotNo, mention.size, assignments.getFeaturePremiums
        );
        if (quote) {
          // Friendly labels for feature keys
          const labels = {
            corner: "Corner", park_facing: "Park Facing", near_park: "Near Park",
            main_boulevard: "Main Boulevard", near_mosque: "Near Mosque",
            near_commercial: "Near Commercial", near_school: "Near School",
            near_gate: "Near DHA Gate", double_road: "Double Road",
          };
          const featLabels = (quote.features || [])
            .filter((k) => k !== "near_road" && k !== "extra_land")
            .map((k) => labels[k] || k);
          if (quote.nearbyRoad || (quote.features || []).includes("near_road")) {
            // road width is informative, not a premium label here
          }

          plotFacts = `\n\n--- RESOLVED PLOT — the client asked about THIS specific plot. You already KNOW its details below. Do NOT ask the client whether it is corner/park-facing etc. — that information is given here. ---\n`;
          plotFacts += `Plot: Sector ${quote.sector}, Plot #${quote.plotNo}`;
          if (quote.size) plotFacts += `, ${quote.size}`;
          plotFacts += `\n`;
          if (featLabels.length) {
            plotFacts += `This plot's known features: ${featLabels.join(", ")}.\n`;
          } else {
            plotFacts += `This plot has no special premium features (standard plot).\n`;
          }
          if (quote.nearbyRoad) plotFacts += `Location note: ${quote.nearbyRoad}.\n`;

          if (quote.estMinText) {
            plotFacts += `Approximate price for THIS plot (already adjusted for its features${quote.appliedPercent ? `, +${quote.appliedPercent}%` : ""}): approx Rs ${quote.estMinText} to ${quote.estMaxText}.\n`;
            plotFacts += `RULES FOR YOUR REPLY:\n`;
            plotFacts += `- Mention the plot's features naturally, then give the approximate price range above.\n`;
            plotFacts += `- ALWAYS say "approx" / "andazan" / "estimate" — never a fixed final price.\n`;
            plotFacts += `- NEVER reveal internal plot-number ranges/bands (e.g. do NOT say "plots 6700-6850"). Talk only about THIS plot number.\n`;
            plotFacts += `- Do NOT ask the client about features — you already know them.\n`;
            plotFacts += `- You are the salesperson. Do NOT end by deferring to "an agent". Instead, keep selling: ask a smart follow-up (their budget, purpose, are they buying/selling/investing) to move the conversation forward.\n`;
            plotFacts += `- Only bring in a sales expert (with the escalation tag) if the client shows real buying intent, wants to visit/negotiate, or is about to leave.\n`;
          } else {
            plotFacts += `No price is set for this plot yet — do NOT invent one. Stay engaged: ask about their needs, and if they want the price, tell them your sales expert will get them the exact figure right away (then use the escalation tag).\n`;
          }
          if (quote.hasExtraLand) plotFacts += `This plot has EXTRA LAND beside it (sold separately) — mention the price will differ and offer to have your expert guide them on it.\n`;
          console.log("📍 Resolved plot:", quote.sector, quote.plotNo, "feats:", featLabels.join("+") || "none", quote.estMinText ? `~${quote.estMinText}-${quote.estMaxText}` : "(no band)");
        }
      } catch (e) {
        console.error("Plot resolve error:", e.message);
      }
    }

    // 5. Build messages for OpenAI (system prompt is handoff-aware + plot facts)
    const messages = [
      { role: "system", content: (await buildSystemPrompt(client)) + continuityNote + plotFacts },
      ...history.map((m) => ({ 
        role: m.role === "agent" ? "assistant" : m.role, 
        content: m.content
      })),
    ];

    console.log("🤖 OpenAI call:", messages.length, "messages, phone:", clientPhone);

    // 6. Call OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      max_tokens: 500,
      temperature: 0.7,
    });

    const rawReply = completion.choices[0].message.content;
    const department = getEscalation(rawReply); // null | 'PLOT' | 'PROJECT'
    const escalate = department !== null;
    const botReply = cleanReply(rawReply);

    // 7. Save bot reply
    await db.saveMessage(clientPhone, "assistant", botReply);

    // 8. On a fresh escalation, route to the right team + auto-assign an agent
    if (escalate && !client.escalated) {
      try {
        const result = await assignments.autoAssignOnEscalation(
          clientPhone,
          client.name,
          department
        );
        if (result.assigned) {
          console.log(`✅ Auto-assigned ${clientPhone} → ${result.agent.full_name} (${department})`);
        } else if (result.alreadyAssigned) {
          console.log(`ℹ️ ${clientPhone} already locked to an agent; stamps updated`);
        } else {
          console.log(`⚠️ No free agent in ${department} team — ${clientPhone} left in pool`);
          // Fall back to the old single-number notify so a human still sees it
          try {
            const fullHistory = await db.getChatHistory(clientPhone);
            await notifyAgent(clientPhone, client.name, fullHistory);
          } catch (e) { console.error("Fallback notify failed:", e.message); }
        }
      } catch (assignErr) {
        console.error("Auto-assign failed:", assignErr.message);
        // Ensure the lead is at least marked escalated so it isn't lost
        await db.markEscalated(clientPhone, true);
      }
    } else if (escalate && client.escalated) {
      console.log("ℹ️ Already escalated — AI handled NEW intent, not re-routed:", clientPhone);
    }

    // 9. Reply to client
    twiml.message(botReply);
    res.type("text/xml");
    res.send(twiml.toString());
  } catch (err) {
    console.error("Webhook error:", err);
    twiml.message("Sorry, kuch technical issue aa gaya. Thoda baad mein try karein. Jazakallah!");
    res.type("text/xml");
    res.send(twiml.toString());
  }
});

// ─── DASHBOARD (React SPA is served as static files at the bottom) ─────

app.get("/api/clients", auth.requireAuth(["admin", "manager", "agent"]), async (req, res) => {
  try {
    const clients = await db.getAllClients(req.user);
    const data = await Promise.all(
      clients.map(async (c) => ({
        ...c,
        messages: await db.getFullChatHistory(c.phone),
      }))
    );
    res.json(data);
  } catch (err) {
    console.error("Dashboard error:", err);
    res.status(500).json([]);
  }
});

app.get("/health", (req, res) => res.send("Bodla Bot running."));

// ─── DROP C: SLA CRON ENDPOINT ────────────────────────────────────────
// Hit this every minute from an external scheduler (e.g. cron-job.org).
// Protected by a secret token so randoms can't trigger it.
app.all("/cron/check-sla", async (req, res) => {
  const token = req.query.token || req.headers["x-cron-token"];
  if (token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const result = await assignments.checkSLA();
    console.log("⏱️ SLA scan:", JSON.stringify(result));
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("SLA scan error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Mark a client's chat as seen (stops the SLA clock). Called when an agent opens the chat.
app.post("/api/leads/:phone/seen", auth.requireAuth(["admin", "manager", "agent"]), async (req, res) => {
  try {
    await assignments.markClientSeen(req.params.phone);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── NOTIFICATIONS ────────────────────────────────────────────────────
// Fetch the logged-in user's notifications (newest first).
app.get("/api/notifications", auth.requireAuth(["admin", "manager", "agent"]), async (req, res) => {
  try {
    const { data, error } = await db.supabase
      .from("notifications")
      .select("*")
      .eq("recipient_id", req.user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    const unread = (data || []).filter((n) => !n.is_read).length;
    res.json({ notifications: data || [], unread });
  } catch (err) {
    console.error("notifications fetch error:", err.message);
    res.status(500).json({ notifications: [], unread: 0 });
  }
});

// Mark one (or all) notifications read.
app.post("/api/notifications/read", auth.requireAuth(["admin", "manager", "agent"]), async (req, res) => {
  try {
    let q = db.supabase.from("notifications").update({ is_read: true }).eq("recipient_id", req.user.id);
    if (req.body.id) q = q.eq("id", req.body.id);  // specific one; else all
    const { error } = await q;
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── AUTH & ADMIN ─────────────────────────────────────────────────────

app.post("/api/login", loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Username and password required" });
    const result = await auth.login(username, password);
    res.json(result);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.get("/api/me", auth.requireAuth(), (req, res) => {
  res.json(req.user);
});

app.get("/api/users", auth.requireAuth(["admin", "manager"]), async (req, res) => {
  try {
    const { role, team_id } = req.query;
    const users = await auth.getUsers(role || null, team_id || null);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/users", auth.requireAuth(["admin"]), async (req, res) => {
  try {
    const { username, password, full_name, role, team_id } = req.body;
    const user = await auth.createUser(username, password, full_name, role, team_id || null);
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/users/:id", auth.requireAuth(["admin"]), async (req, res) => {
  try {
    const user = await auth.updateUser(req.params.id, req.body);
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/users/:id", auth.requireAuth(["admin"]), async (req, res) => {
  try {
    // Prevent self-deletion
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: "You cannot delete your own account." });
    }
    const result = await auth.deleteUser(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/teams", auth.requireAuth(["admin", "manager"]), async (req, res) => {
  try {
    const teams = await auth.getTeams();
    res.json(teams);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/teams", auth.requireAuth(["admin"]), async (req, res) => {
  try {
    const { name, manager_id } = req.body;
    const team = await auth.createTeam(name, manager_id || null);
    res.json(team);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/teams/:id", auth.requireAuth(["admin"]), async (req, res) => {
  try {
    const team = await auth.updateTeam(req.params.id, req.body);
    res.json(team);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/teams/:id", auth.requireAuth(["admin"]), async (req, res) => {
  try {
    const result = await auth.deleteTeam(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/leads", auth.requireAuth(["admin", "manager", "agent"]), async (req, res) => {
  try {
    const leads = await assignments.getLeads(req.user);
    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/leads/assign", auth.requireAuth(["admin", "manager"]), async (req, res) => {
  try {
    const { client_phone, agent_id } = req.body;
    const result = await assignments.assignClient(client_phone, agent_id, req.user.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/leads/transfer", auth.requireAuth(["admin", "manager"]), async (req, res) => {
  try {
    const { client_phone, to_agent_id, reason } = req.body;
    const result = await assignments.transferClient(client_phone, to_agent_id, req.user.id, reason || null);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/agent/reply", auth.requireAuth(["admin", "manager", "agent"]), async (req, res) => {
  try {
    const { client_phone, message } = req.body;
    if (!client_phone || !message) return res.status(400).json({ error: "client_phone and message required" });

    const phone = client_phone.startsWith("+") ? client_phone : `+${client_phone}`;

    console.log(`Agent reply: sending to whatsapp:${phone} from whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`);

    const result = await twilioClient.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: `whatsapp:${phone}`,
      body: message,
    });

    await db.saveMessage(phone, "agent", message, {
      id: req.user.id,
      full_name: req.user.full_name,
      role: req.user.role,
    });
    // Replying counts as seeing — stop the SLA clock.
    await assignments.markClientSeen(phone);
    res.json({ success: true, sid: result.sid });
  } catch (err) {
    console.error("Agent reply error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/plot-rates-v2", auth.requireAuth(), async (req, res) => {
  try {
    let query = db.supabase.from("plot_rates_v2").select("*").order("sector").order("plot_no_from");
    if (req.query.sector) query = query.eq("sector", req.query.sector);
    if (req.query.type) query = query.eq("plot_type", req.query.type);
    const { data } = await query;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/plot-rates-v2", auth.requireAuth(["admin", "manager"]), async (req, res) => {
  try {
    const { id, sector, sub_category, plot_type, size, plot_no_from, plot_no_to, min_price, max_price, features, notes } = req.body;
    const payload = { sector, sub_category: sub_category || null, plot_type, size, plot_no_from, plot_no_to, min_price, max_price, features: features||{}, notes, updated_by: req.user.id, updated_at: new Date().toISOString() };

    let result;
    if (id) {
      // Edit existing row
      result = await db.supabase.from("plot_rates_v2").update(payload).eq("id", id).select().single();
    } else {
      // New row
      result = await db.supabase.from("plot_rates_v2").insert(payload).select().single();
    }
    if (result.error) throw new Error(result.error.message);
    res.json(result.data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/plot-rates-v2/:id", auth.requireAuth(["admin", "manager"]), async (req, res) => {
  try {
    const { error } = await db.supabase.from("plot_rates_v2").delete().eq("id", req.params.id);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── DROP P: PLOT FEATURES + PREMIUMS ─────────────────────────────────
// Catalog of feature checkboxes + their current premium %.
app.get("/api/features", auth.requireAuth(), async (req, res) => {
  try {
    const [defs, premiums] = await Promise.all([
      assignments.getFeatureDefs(),
      assignments.getFeaturePremiums(),
    ]);
    // Merge premium into each def for convenience.
    const merged = defs.map((d) => ({ ...d, premium_percent: premiums[d.key] || 0 }));
    res.json(merged);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Edit a feature's premium % (admin/manager).
app.post("/api/features/premium", auth.requireAuth(["admin", "manager"]), async (req, res) => {
  try {
    const { feature_key, premium_percent } = req.body;
    const result = await assignments.updateFeaturePremium(feature_key, premium_percent, req.user.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Compute a price range from a base + checked features (live preview / quoting).
app.post("/api/features/price", auth.requireAuth(), async (req, res) => {
  try {
    const { base_min, base_max, features } = req.body;
    const result = await assignments.computePlotPrice(base_min, base_max, features || {});
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Create/update a feature definition (admin only).
app.post("/api/features/def", auth.requireAuth(["admin"]), async (req, res) => {
  try {
    const result = await assignments.upsertFeatureDef(req.body, req.user.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete a feature definition (admin only).
app.delete("/api/features/def/:key", auth.requireAuth(["admin"]), async (req, res) => {
  try {
    const result = await assignments.deleteFeatureDef(req.params.key);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── SETTINGS (admin) ─────────────────────────────────────────────────
app.get("/api/settings", auth.requireAuth(["admin"]), async (req, res) => {
  try {
    const settings = await assignments.getAllSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/settings", auth.requireAuth(["admin"]), async (req, res) => {
  try {
    const updates = req.body; // { key: value, ... }
    for (const [key, value] of Object.entries(updates)) {
      await assignments.updateSetting(key, String(value), req.user.id);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── PLOT INVENTORY ───────────────────────────────────────────────────
// Bulk import: frontend parses the Excel (SheetJS) and posts rows here.
app.post("/api/inventory/import", auth.requireAuth(["admin", "manager"]), async (req, res) => {
  try {
    const rows = req.body.rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "No rows provided" });
    }
    const result = await inventory.importRows(rows);
    res.json(result);
  } catch (err) {
    console.error("inventory import error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Resolve a single plot (features + pricing band) — for testing/admin.
app.get("/api/inventory/resolve", auth.requireAuth(), async (req, res) => {
  try {
    const { sector, plot_no, size } = req.query;
    const result = await inventory.resolvePlot(sector, parseInt(plot_no, 10), size || null);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Inventory stats (how many plots loaded, by sector).
app.get("/api/inventory/stats", auth.requireAuth(["admin", "manager"]), async (req, res) => {
  try {
    const { count } = await db.supabase
      .from("plot_inventory")
      .select("*", { count: "exact", head: true });
    res.json({ total: count || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Browse loaded plots (paginated, optional sector filter).
app.get("/api/inventory/list", auth.requireAuth(["admin", "manager"]), async (req, res) => {
  try {
    const sector = req.query.sector;
    const page = parseInt(req.query.page || "0", 10);
    const pageSize = 50;
    let q = db.supabase.from("plot_inventory").select("*", { count: "exact" });
    if (sector) q = q.eq("sector", sector.toUpperCase());
    q = q.order("sector").order("plot_no").range(page * pageSize, page * pageSize + pageSize - 1);
    const { data, count, error } = await q;
    if (error) throw new Error(error.message);
    res.json({ plots: data || [], total: count || 0, page, pageSize });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Distinct sectors loaded (for the filter dropdown).
app.get("/api/inventory/sectors", auth.requireAuth(["admin", "manager"]), async (req, res) => {
  try {
    const { data } = await db.supabase.from("plot_inventory").select("sector");
    const sectors = [...new Set((data || []).map((r) => r.sector))].sort();
    res.json({ sectors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PROJECTS (NEW) ───────────────────────────────────────────────────
app.get("/api/projects", auth.requireAuth(), async (req, res) => {
  try {
    const { data: projects } = await db.supabase.from("projects").select("*").order("created_at", { ascending: false });
    // Attach units to each project
    const withUnits = await Promise.all((projects || []).map(async (p) => {
      const { data: units } = await db.supabase.from("project_units").select("*").eq("project_id", p.id);
      return { ...p, units: units || [] };
    }));
    res.json(withUnits);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/projects", auth.requireAuth(["admin", "manager"]), async (req, res) => {
  try {
    const { id, name, location, description, status, brochure_url, pricing_type, floor_map_url } = req.body;
    const payload = { name, location: location || null, description: description || null, status: status || "available", brochure_url: brochure_url || null, pricing_type: pricing_type || "consultant_only", floor_map_url: floor_map_url || null, updated_at: new Date().toISOString() };
    let result;
    if (id) {
      result = await db.supabase.from("projects").update(payload).eq("id", id).select().single();
    } else {
      result = await db.supabase.from("projects").insert(payload).select().single();
    }
    if (result.error) throw new Error(result.error.message);
    res.json(result.data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/projects/:id", auth.requireAuth(["admin"]), async (req, res) => {
  try {
    const { error } = await db.supabase.from("projects").delete().eq("id", req.params.id);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Project units
app.post("/api/projects/:projectId/units", auth.requireAuth(["admin", "manager"]), async (req, res) => {
  try {
    const { unit_type, size, availability, notes, floor, sqft, rate_per_sqft, total_price, down_payment, monthly, duration_months } = req.body;
    const { data, error } = await db.supabase.from("project_units").insert({
      project_id: req.params.projectId,
      unit_type, size: size || null,
      availability: availability || "available", notes: notes || null,
      floor: floor || null,
      sqft: sqft || null,
      rate_per_sqft: rate_per_sqft || null,
      total_price: total_price || null,
      down_payment: down_payment || null,
      monthly: monthly || null,
      duration_months: duration_months || null,
    }).select().single();
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/projects/units/:unitId", auth.requireAuth(["admin", "manager"]), async (req, res) => {
  try {
    const { error } = await db.supabase.from("project_units").delete().eq("id", req.params.unitId);
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Bulk import units for a per-sqft project (Unit#, Floor, Sqft, Price/Sqft).
app.post("/api/projects/:projectId/units/import", auth.requireAuth(["admin", "manager"]), async (req, res) => {
  try {
    const rows = req.body.rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "No rows provided" });
    }
    // Tolerant header lookup
    const get = (row, names) => {
      for (const n of names) {
        for (const k of Object.keys(row)) {
          if (k.trim().toLowerCase() === n.toLowerCase()) return row[k];
        }
      }
      return undefined;
    };
    const records = [];
    let skipped = 0;
    for (const row of rows) {
      const unitNo = get(row, ["Unit", "Unit#", "Unit No", "Unit Number", "Unit No."]);
      const floor = get(row, ["Floor", "Floor No", "Floor Number"]);
      const sqft = get(row, ["Sqft", "Sq Ft", "Size", "Area", "Sq.Ft"]);
      const rate = get(row, ["Price/Sqft", "Price/Sft", "Rate/Sqft", "Rate", "Price per Sqft", "Rate per Sqft"]);
      const avail = get(row, ["Availability", "Status", "Available"]);
      if (!unitNo && !sqft) { skipped++; continue; }
      records.push({
        project_id: req.params.projectId,
        unit_type: unitNo ? String(unitNo) : "Unit",
        floor: floor != null ? String(floor) : null,
        sqft: sqft != null && sqft !== "" ? parseFloat(String(sqft).replace(/[^\d.]/g, "")) : null,
        rate_per_sqft: rate != null && rate !== "" ? Math.round(parseFloat(String(rate).replace(/[^\d.]/g, ""))) : null,
        availability: avail ? String(avail).toLowerCase().replace(/\s+/g, "_") : "available",
      });
    }
    let inserted = 0;
    const BATCH = 500;
    const errors = [];
    for (let i = 0; i < records.length; i += BATCH) {
      const chunk = records.slice(i, i + BATCH);
      const { error } = await db.supabase.from("project_units").insert(chunk);
      if (error) errors.push(error.message);
      else inserted += chunk.length;
    }
    res.json({ total: rows.length, inserted, skipped, errors });
  } catch (err) {
    console.error("unit import error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── COMPANY PROFILE (NEW) ────────────────────────────────────────────
app.get("/api/company-profile", auth.requireAuth(), async (req, res) => {
  try {
    const { data } = await db.supabase.from("company_profile").select("*").single();
    res.json(data || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/company-profile", auth.requireAuth(["admin"]), async (req, res) => {
  try {
    const { name, about, website, phone, email, address, knowledge } = req.body;
    const { data, error } = await db.supabase
      .from("company_profile")
      .upsert({ name, about, website, phone, email, address, knowledge }, { onConflict: "id" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── SERVE REACT ADMIN/AGENT PANEL (built by `vite build` → dist/) ─────
const DIST_DIR = path.join(__dirname, "dist");
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  // SPA fallback: any non-API, non-webhook GET returns index.html
  app.get(/^\/(?!api|webhook|health).*/, (req, res) => {
    res.sendFile(path.join(DIST_DIR, "index.html"));
  });
  console.log("🖥️  Serving React panel from /dist");
} else {
  console.log("⚠️  No /dist folder — run `npm run build` before deploy to serve the panel");
}

// ─── START SERVER ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Bodla Bot running on port ${PORT} — build: salesperson-persona-v2`));