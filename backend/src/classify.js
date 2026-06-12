// The AI layer: categorize each submission, grade urgency, write a one-line
// summary for staff. Uses the Claude API when ANTHROPIC_API_KEY is present;
// falls back to a keyword classifier so the app is fully functional without it.

const AnthropicSDK = require('@anthropic-ai/sdk');
const Anthropic = AnthropicSDK.Anthropic || AnthropicSDK.default || AnthropicSDK;
const { pool } = require('./db');

const MODEL = process.env.AI_MODEL || 'claude-opus-4-8';
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

const KEYWORDS = {
  maintenance:  ['broken', 'leak', 'leaking', 'fix', 'repair', 'shower', 'toilet', 'heat', 'heater', 'cold water', 'hot water', 'light', 'door', 'window', 'wifi', 'outlet', 'flicker', 'loose', 'crack'],
  housekeeping: ['clean', 'dirty', 'towel', 'blanket', 'sheets', 'soap', 'paper', 'garbage', 'trash', 'spill', 'mop', 'bug', 'wasp', 'mouse', 'smell'],
  food:         ['food', 'meal', 'breakfast', 'lunch', 'dinner', 'allergy', 'allergic', 'gluten', 'vegetarian', 'vegan', 'menu', 'snack', 'juice', 'coffee', 'kitchen'],
  program:      ['activity', 'program', 'schedule', 'ropes', 'climbing', 'archery', 'waterfront', 'canoe', 'campfire', 'session', 'instructor', 'game'],
  'lost-found': ['lost', 'found', 'left behind', 'missing', 'forgot', 'hoodie', 'phone', 'wallet', 'retainer', 'jacket'],
};

const SAFETY_WORDS = ['unsafe', 'danger', 'hazard', 'injury', 'injured', 'hurt', 'fire', 'smoke', 'gas', 'allerg', 'wasp', 'emergency', 'trip', 'fall', 'broken glass', 'exposed wire'];

function keywordClassify(message, categories) {
  const text = message.toLowerCase();
  let best = null, bestScore = 0;
  for (const cat of categories) {
    const words = KEYWORDS[cat.slug] || [];
    const score = words.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);
    if (score > bestScore) { best = cat; bestScore = score; }
  }
  const urgency = SAFETY_WORDS.some(w => text.includes(w)) ? 'high' : 'normal';
  return {
    categorySlug: best ? best.slug : 'other',
    urgency,
    summary: '',
    via: 'keywords',
  };
}

async function aiClassify(message, type, locationName, categories) {
  const slugs = categories.map(c => c.slug);
  const catList = categories.map(c => `- ${c.slug}: ${c.name}`).join('\n');
  const response = await client.messages.create(
    {
      model: MODEL,
      max_tokens: 1024,
      system:
        'You triage guest feedback for Muskoka Woods, a youth camp and retreat centre in Ontario. ' +
        'Categorize each submission, grade its urgency, and write a one-line summary for the staff dashboard. ' +
        'Urgency rules: "safety" only for physical safety risks (hazards, injuries, severe allergies, fire/electrical); ' +
        '"high" for things degrading a guest\'s stay right now (no hot water, missed dietary need); ' +
        '"normal" for routine requests and issues; "low" for minor notes, general feedback and compliments.',
      messages: [{
        role: 'user',
        content:
          `Categories:\n${catList}\n\n` +
          `Submission type: ${type}\n` +
          `Location: ${locationName || 'not given'}\n` +
          `Message: """${message}"""`,
      }],
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              category_slug: { type: 'string', enum: slugs },
              urgency: { type: 'string', enum: ['low', 'normal', 'high', 'safety'] },
              summary: { type: 'string', description: 'One sentence, max 120 chars, for the staff dashboard.' },
            },
            required: ['category_slug', 'urgency', 'summary'],
            additionalProperties: false,
          },
        },
      },
    },
    { timeout: 20000, maxRetries: 1 }
  );
  const text = response.content.find(b => b.type === 'text')?.text || '{}';
  const data = JSON.parse(text);
  return {
    categorySlug: data.category_slug,
    urgency: data.urgency,
    summary: (data.summary || '').slice(0, 200),
    via: 'claude',
  };
}

// Fire-and-forget: never blocks or fails the guest's submit.
async function classifySubmission(submissionId, { message, type, locationName, guestChoseCategory, guestChoseUrgency }) {
  try {
    const { rows: categories } = await pool.query(
      'SELECT id, slug, name, department_id FROM categories WHERE active ORDER BY sort');
    if (!categories.length) return;

    let result;
    if (client) {
      try {
        result = await aiClassify(message, type, locationName, categories);
      } catch (err) {
        console.warn(`[ai] Claude classification failed (${err.message}) — using keyword fallback`);
        result = keywordClassify(message, categories);
      }
    } else {
      result = keywordClassify(message, categories);
    }

    const cat = categories.find(c => c.slug === result.categorySlug) ||
                categories.find(c => c.slug === 'other') || categories[0];

    const sets = ['ai_processed = true'];
    const params = [];
    let i = 1;
    if (result.summary) { sets.push(`ai_summary = $${i++}`); params.push(result.summary); }
    // Respect explicit guest choices; AI only fills the gaps.
    if (!guestChoseCategory && cat) {
      sets.push(`category_id = $${i++}`); params.push(cat.id);
      sets.push(`department_id = $${i++}`); params.push(cat.department_id);
    }
    if (!guestChoseUrgency && result.urgency) { sets.push(`urgency = $${i++}`); params.push(result.urgency); }
    params.push(submissionId);
    await pool.query(`UPDATE submissions SET ${sets.join(', ')} WHERE id = $${i}`, params);

    const detail = guestChoseCategory
      ? `Triage (${result.via}): summary added`
      : `Triage (${result.via}): routed to ${cat.name}, urgency ${result.urgency}`;
    await pool.query(
      `INSERT INTO submission_events (submission_id, kind, detail) VALUES ($1,'ai',$2)`,
      [submissionId, detail]);
  } catch (err) {
    console.error('[ai] classification pipeline error:', err.message);
  }
}

// Dashboard "AI insights": short bullets over recent activity. Requires an API key.
async function generateInsights(stats, recentMessages) {
  if (!client) {
    return { available: false, insights: ['AI insights need an Anthropic API key. Add ANTHROPIC_API_KEY to your .env and restart.'] };
  }
  const response = await client.messages.create(
    {
      model: MODEL,
      max_tokens: 2048,
      system:
        'You analyze guest feedback operations for Muskoka Woods, a youth camp and retreat centre. ' +
        'Given aggregate stats and recent raw submissions, produce 3 to 5 short, concrete, actionable insights ' +
        'for the operations team. Mention specific locations, categories or trends when the data supports it. ' +
        'No fluff, no restating raw numbers without interpretation.',
      messages: [{
        role: 'user',
        content: `Aggregate stats (last 30 days):\n${JSON.stringify(stats, null, 2)}\n\nRecent submissions:\n` +
          recentMessages.map(m => `- [${m.type}/${m.urgency}] (${m.category || 'uncategorized'} @ ${m.location || '?'}) ${m.message}`).join('\n'),
      }],
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              insights: { type: 'array', items: { type: 'string' } },
            },
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

module.exports = { classifySubmission, generateInsights, aiEnabled: () => !!client };
