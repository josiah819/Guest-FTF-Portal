// The AI layer: type each submission, categorize it, grade urgency, write a
// one-line summary for staff. Pluggable provider, chosen in Settings → AI:
//   anthropic — Claude via ANTHROPIC_API_KEY (model editable)
//   openai    — any OpenAI-compatible endpoint (Ollama on an LXC, LM Studio,
//               vLLM…) via plain fetch; optional OPENAI_API_KEY for auth
//   keywords  — no AI at all
// Every AI failure degrades to the keyword classifier; a guest submit never
// waits on or fails because of this file.

const AnthropicSDK = require('@anthropic-ai/sdk');
const Anthropic = AnthropicSDK.Anthropic || AnthropicSDK.default || AnthropicSDK;
const { pool, getSettings } = require('./db');

const DEFAULT_ANTHROPIC_MODEL = process.env.AI_MODEL || 'claude-haiku-4-5-20251001';
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

const TYPES = ['issue', 'request', 'feedback', 'compliment'];
const URGENCIES = ['low', 'normal', 'high', 'safety'];

// ---------- keyword fallback ----------

const KEYWORDS = {
  maintenance:  ['broken', 'leak', 'leaking', 'fix', 'repair', 'shower', 'toilet', 'heat', 'heater', 'cold water', 'hot water', 'light', 'door', 'window', 'wifi', 'outlet', 'flicker', 'loose', 'crack'],
  housekeeping: ['clean', 'dirty', 'towel', 'blanket', 'sheets', 'soap', 'paper', 'garbage', 'trash', 'spill', 'mop', 'bug', 'wasp', 'mouse', 'smell'],
  food:         ['food', 'meal', 'breakfast', 'lunch', 'dinner', 'allergy', 'allergic', 'gluten', 'vegetarian', 'vegan', 'menu', 'snack', 'juice', 'coffee', 'kitchen'],
  program:      ['activity', 'program', 'schedule', 'ropes', 'climbing', 'archery', 'waterfront', 'canoe', 'campfire', 'session', 'instructor', 'game'],
  'lost-found': ['lost', 'found', 'left behind', 'missing', 'forgot', 'hoodie', 'phone', 'wallet', 'retainer', 'jacket'],
};

const SAFETY_WORDS = ['unsafe', 'danger', 'hazard', 'injury', 'injured', 'hurt', 'fire', 'smoke', 'gas', 'allerg', 'wasp', 'emergency', 'trip', 'fall', 'broken glass', 'exposed wire'];

const TYPE_HINTS = {
  compliment: ['thank', 'thanks', 'amazing', 'awesome', 'love', 'loved', 'incredible', 'unreal', 'fantastic', 'wonderful', 'great job', 'highlight', 'best', 'shout', 'kudos'],
  request:    ['could we', 'can we', 'could you', 'can you', 'please', 'we need', 'i need', 'would like', 'extra', 'any chance', 'looking for', 'may we', 'requesting'],
  feedback:   ['suggest', 'suggestion', 'idea', 'you should', 'wish', 'feedback', 'consider', 'it would be', 'ran late', 'too long', 'next time'],
};

function guessType(text) {
  if (SAFETY_WORDS.some(w => text.includes(w))) return 'issue';
  let best = 'issue', bestScore = 0;
  for (const type of ['compliment', 'request', 'feedback']) {
    const score = TYPE_HINTS[type].reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);
    if (score > bestScore) { best = type; bestScore = score; }
  }
  return best;
}

function keywordClassify(message, categories) {
  const text = message.toLowerCase();
  let best = null, bestScore = 0;
  for (const cat of categories) {
    const words = KEYWORDS[cat.slug] || [];
    const score = words.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);
    if (score > bestScore) { best = cat; bestScore = score; }
  }
  // Keywords are too crude to page people: cap at 'high', never 'safety'.
  const urgency = SAFETY_WORDS.some(w => text.includes(w)) ? 'high' : 'normal';
  return {
    type: guessType(text),
    categorySlug: best ? best.slug : 'other',
    urgency,
    summary: '',
    via: 'keywords',
    engine: 'keywords',
  };
}

// ---------- shared prompt ----------

function buildSystem(orgName) {
  return (
    `You triage guest feedback for ${orgName || 'Muskoka Woods'}, a youth camp and retreat centre in Ontario. ` +
    'Decide what kind of note it is, categorize it, grade its urgency, and write a one-line summary for the staff dashboard. ' +
    'Type rules: "compliment" is pure praise; "request" asks for something; "feedback" is a suggestion or observation; ' +
    '"issue" reports something wrong. ' +
    'Urgency rules: "safety" only for physical safety risks (hazards, injuries, severe allergies, fire/electrical); ' +
    '"high" for things degrading a guest\'s stay right now (no hot water, missed dietary need); ' +
    '"normal" for routine requests and issues; "low" for minor notes, general feedback and compliments.'
  );
}

function buildUserContent(message, type, locationName, categories) {
  const catList = categories.map(c => `- ${c.slug}: ${c.name}`).join('\n');
  return (
    `Categories:\n${catList}\n\n` +
    (type ? `Guest-selected type: ${type}\n` : '') +
    `Location: ${locationName || 'not given'}\n` +
    `Message: """${message}"""`
  );
}

function resultSchema(slugs) {
  return {
    type: 'object',
    properties: {
      type: { type: 'string', enum: TYPES },
      category_slug: { type: 'string', enum: slugs },
      urgency: { type: 'string', enum: URGENCIES },
      summary: { type: 'string', description: 'One sentence, max 120 chars, for the staff dashboard.' },
    },
    required: ['type', 'category_slug', 'urgency', 'summary'],
    additionalProperties: false,
  };
}

// Models don't always behave: clamp every field to its enum before use.
function sanitize(data, categories) {
  const slugs = new Set(categories.map(c => c.slug));
  return {
    type: TYPES.includes(data.type) ? data.type : 'issue',
    categorySlug: slugs.has(data.category_slug) ? data.category_slug : 'other',
    urgency: URGENCIES.includes(data.urgency) ? data.urgency : 'normal',
    summary: typeof data.summary === 'string' ? data.summary.slice(0, 200) : '',
  };
}

// ---------- Anthropic provider ----------

async function anthropicClassify({ message, type, locationName, categories, model, orgName, timeoutMs }) {
  const response = await client.messages.create(
    {
      model,
      max_tokens: 1024,
      system: buildSystem(orgName),
      messages: [{ role: 'user', content: buildUserContent(message, type, locationName, categories) }],
      output_config: {
        format: { type: 'json_schema', schema: resultSchema(categories.map(c => c.slug)) },
      },
    },
    { timeout: timeoutMs || 20000, maxRetries: 1 }
  );
  const text = response.content.find(b => b.type === 'text')?.text || '{}';
  return { ...sanitize(JSON.parse(text), categories), via: 'ai', engine: model };
}

// ---------- OpenAI-compatible provider (Ollama, LM Studio, vLLM…) ----------

// Both http://host:11434 and http://host:11434/v1 should work.
function normalizeBaseUrl(url) {
  const u = (url || '').trim().replace(/\/+$/, '');
  return /\/v1$/.test(u) ? u : `${u}/v1`;
}

// Models behind json_object mode (or ignoring it) still wrap JSON in prose or
// fences sometimes — cut out the outermost object before parsing.
function parseLooseJson(text) {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('response contained no JSON object');
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function openaiChat({ baseUrl, model, system, user, timeoutMs }) {
  const url = `${normalizeBaseUrl(baseUrl)}/chat/completions`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Ollama ignores auth; some proxies require a non-empty bearer.
      Authorization: `Bearer ${process.env.OPENAI_API_KEY || 'ollama'}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
      stream: false,
    }),
    signal: AbortSignal.timeout(timeoutMs || 20000),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`${resp.status} ${resp.statusText} from ${url}${body ? ` — ${body.slice(0, 200)}` : ''}`);
  }
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('empty completion from local model');
  return text;
}

async function openaiClassify({ message, type, locationName, categories, baseUrl, model, orgName, timeoutMs }) {
  const system =
    buildSystem(orgName) +
    ' Respond with ONLY a JSON object with keys "type" (issue|request|feedback|compliment), ' +
    `"category_slug" (one of: ${categories.map(c => c.slug).join(', ')}), ` +
    '"urgency" (low|normal|high|safety), and "summary" (one sentence, max 120 chars). No prose, no markdown fences.';
  const text = await openaiChat({
    baseUrl, model, system,
    user: buildUserContent(message, type, locationName, categories),
    timeoutMs,
  });
  return { ...sanitize(parseLooseJson(text), categories), via: 'ai', engine: model };
}

// ---------- dispatch ----------

function providerFor(aiCfg) {
  const provider = aiCfg?.provider || 'anthropic';
  if (provider === 'keywords') return { provider };
  if (provider === 'openai') {
    return {
      provider,
      baseUrl: aiCfg.openaiBaseUrl,
      model: aiCfg.openaiModel,
      ready: !!(aiCfg.openaiBaseUrl && aiCfg.openaiModel),
      whyNot: 'Local AI endpoint needs a base URL and model in Settings → AI.',
    };
  }
  return {
    provider: 'anthropic',
    model: aiCfg?.anthropicModel || DEFAULT_ANTHROPIC_MODEL,
    ready: !!client,
    whyNot: 'ANTHROPIC_API_KEY is not set on the server.',
  };
}

async function runClassify(aiCfg, ctx) {
  const p = providerFor(aiCfg);
  if (p.provider === 'keywords') return null;
  if (!p.ready) throw new Error(p.whyNot);
  if (p.provider === 'openai') {
    return openaiClassify({ ...ctx, baseUrl: p.baseUrl, model: p.model });
  }
  return anthropicClassify({ ...ctx, model: p.model });
}

// Fire-and-forget: never blocks or fails the guest's submit.
async function classifySubmission(submissionId, { message, type, locationName, guestChoseCategory, guestChoseUrgency, guestChoseType }) {
  try {
    const settings = await getSettings();
    const { rows: categories } = await pool.query(
      'SELECT id, slug, name, department_id FROM categories WHERE active ORDER BY sort');
    if (!categories.length) return;

    const ctx = {
      message,
      type: guestChoseType ? type : '',
      locationName,
      categories,
      orgName: settings.general?.orgName,
    };

    let result = null;
    try {
      result = await runClassify(settings.ai, ctx);
    } catch (err) {
      console.warn(`[ai] classification failed (${err.message}) — using keyword fallback`);
    }
    if (!result) result = keywordClassify(message, categories);

    const cat = categories.find(c => c.slug === result.categorySlug) ||
                categories.find(c => c.slug === 'other') || categories[0];

    const sets = ['ai_processed = true'];
    const params = [];
    let i = 1;
    sets.push(`triage_via = $${i++}`); params.push(result.via);
    if (result.summary) { sets.push(`ai_summary = $${i++}`); params.push(result.summary); }
    // Respect explicit guest choices; AI only fills the gaps.
    if (!guestChoseCategory && cat) {
      sets.push(`category_id = $${i++}`); params.push(cat.id);
      sets.push(`department_id = $${i++}`); params.push(cat.department_id);
    }
    if (!guestChoseUrgency && result.urgency) { sets.push(`urgency = $${i++}`); params.push(result.urgency); }
    if (!guestChoseType && result.type) { sets.push(`type = $${i++}`); params.push(result.type); }
    params.push(submissionId);
    await pool.query(`UPDATE submissions SET ${sets.join(', ')} WHERE id = $${i}`, params);

    const parts = [];
    if (!guestChoseCategory) parts.push(`routed to ${cat.name}`);
    if (!guestChoseType) parts.push(`type ${result.type}`);
    if (!guestChoseUrgency) parts.push(`urgency ${result.urgency}`);
    const detail = `Triage (${result.engine}): ${parts.length ? parts.join(', ') : 'summary added'}`;
    await pool.query(
      `INSERT INTO submission_events (submission_id, kind, detail) VALUES ($1,'ai',$2)`,
      [submissionId, detail]);
  } catch (err) {
    console.error('[ai] classification pipeline error:', err.message);
  }
}

// Settings → AI "test connection": classify a canned message with the chosen
// (possibly unsaved) provider config. Long timeout — Ollama cold-loads models.
async function testClassify(overrideCfg) {
  const settings = await getSettings();
  const aiCfg = { ...settings.ai, ...(overrideCfg || {}) };
  const { rows: categories } = await pool.query(
    'SELECT id, slug, name, department_id FROM categories WHERE active ORDER BY sort');
  if (!categories.length) throw new Error('No active categories to classify into.');

  const ctx = {
    message: 'The shower in cabin 3 only runs cold water no matter how long we wait.',
    type: '',
    locationName: 'Cabin 3',
    categories,
    orgName: settings.general?.orgName,
    timeoutMs: 45000,
  };

  const started = Date.now();
  const p = providerFor(aiCfg);
  const result = (p.provider === 'keywords')
    ? keywordClassify(ctx.message, categories)
    : await runClassify(aiCfg, ctx);
  return {
    via: result.via,
    engine: result.engine,
    provider: p.provider,
    latencyMs: Date.now() - started,
    result: { type: result.type, category: result.categorySlug, urgency: result.urgency, summary: result.summary },
  };
}

// ---------- dashboard insights ----------

const INSIGHTS_SYSTEM =
  'You analyze guest feedback operations for a youth camp and retreat centre. ' +
  'Given aggregate stats and recent raw submissions, produce 3 to 5 short, concrete, actionable insights ' +
  'for the operations team. Mention specific locations, categories or trends when the data supports it. ' +
  'No fluff, no restating raw numbers without interpretation.';

function insightsUser(stats, recentMessages) {
  return `Aggregate stats (last 30 days):\n${JSON.stringify(stats, null, 2)}\n\nRecent submissions:\n` +
    recentMessages.map(m => `- [${m.type}/${m.urgency}] (${m.category || 'uncategorized'} @ ${m.location || '?'}) ${m.message}`).join('\n');
}

async function generateInsights(stats, recentMessages) {
  const settings = await getSettings();
  const p = providerFor(settings.ai);

  if (p.provider === 'keywords' || !p.ready) {
    return {
      available: false,
      insights: ['AI insights need an AI provider — pick Anthropic or a local endpoint under Settings → AI.'],
    };
  }

  if (p.provider === 'openai') {
    const text = await openaiChat({
      baseUrl: p.baseUrl,
      model: p.model,
      system: INSIGHTS_SYSTEM + ' Respond with ONLY a JSON object: {"insights": ["...", ...]}. No prose, no markdown fences.',
      user: insightsUser(stats, recentMessages),
      timeoutMs: 45000,
    });
    const data = parseLooseJson(text);
    const insights = Array.isArray(data.insights) ? data.insights.filter(x => typeof x === 'string') : [];
    if (!insights.length) throw new Error('local model returned no insights');
    return { available: true, insights: insights.slice(0, 6) };
  }

  const response = await client.messages.create(
    {
      model: p.model,
      max_tokens: 2048,
      system: INSIGHTS_SYSTEM,
      messages: [{ role: 'user', content: insightsUser(stats, recentMessages) }],
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: { insights: { type: 'array', items: { type: 'string' } } },
            required: ['insights'],
            additionalProperties: false,
          },
        },
      },
    },
    { timeout: 30000, maxRetries: 1 }
  );
  const text = response.content.find(b => b.type === 'text')?.text || '{"insights":[]}';
  return { available: true, insights: JSON.parse(text).insights.slice(0, 6) };
}

module.exports = { classifySubmission, generateInsights, testClassify, aiEnabled: () => !!client };
