// CivilCam Pro — AI helper (Firebase Cloud Function, 2nd gen)
// The app sends the signed-in engineer's Firebase ID token; the Anthropic API key
// stays here as a secret and never ships inside the app.
//
//   task: 'caption'  -> { text }     short factual description of one site photo
//   task: 'progress' -> { text }     what changed at one chainage across visits
//   task: 'search'   -> { filter }   turns a plain-words search into gallery filters

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');

admin.initializeApp();
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const MODEL_FAST = defineString('AI_MODEL_FAST', { default: 'claude-haiku-5-5' });
const MODEL_VISION = defineString('AI_MODEL_VISION', { default: 'claude-sonnet-5-5' });

function imageBlock(dataUrl) {
  const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
}

async function claude(model, system, content, maxTokens = 400) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY.value(),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] })
  });
  if (!r.ok) throw new Error('Anthropic API ' + r.status + ': ' + (await r.text()).slice(0, 300));
  const j = await r.json();
  return (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
}

const SITE_VOICE = 'You write for civil engineers preparing site photo reports for clients. ' +
  'Be factual and brief. Describe only what is visible. Do not guess names, quantities, ' +
  'measurements or causes you cannot see. Plain English, no headings, no bullet points.';

exports.ai = onRequest(
  { region: 'asia-south1', secrets: [ANTHROPIC_API_KEY], cors: true, memory: '512MiB', timeoutSeconds: 120 },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('POST only'); return; }
    try {
      const token = (req.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      await admin.auth().verifyIdToken(token);
    } catch (e) {
      res.status(401).json({ error: 'Sign in required' });
      return;
    }

    const b = req.body || {};
    try {
      if (b.task === 'caption') {
        const img = imageBlock(b.image);
        if (!img) { res.status(400).json({ error: 'No image' }); return; }
        const ctx = `Activity: ${b.activity || '-'}; Chainage: ${b.chainage || '-'}; Side: ${b.side || '-'}; Photo type: ${b.photoType || 'General'}.` +
          (b.existing ? ` The engineer already wrote: "${String(b.existing).slice(0, 500)}".` : '');
        const text = await claude(MODEL_VISION.value(), SITE_VOICE,
          [img, { type: 'text', text: `${ctx}\nWrite one or two sentences describing the work visible in this site photo, suitable as the photo's description in a progress report. Ignore the text stamp at the bottom of the image.` }], 200);
        res.json({ text });
        return;
      }

      if (b.task === 'progress') {
        const visits = (b.visits || []).slice(0, 6);
        const content = [];
        visits.forEach((v, i) => {
          const img = imageBlock(v.image);
          content.push({ type: 'text', text: `Visit ${i + 1} — ${v.date} — ${v.activity || ''}${v.description ? ' — engineer notes: ' + String(v.description).slice(0, 300) : ''}` });
          if (img) content.push(img);
        });
        content.push({ type: 'text', text: `These are photos of the same location (Chainage ${b.chainage}) of the project "${b.project || ''}", oldest first. In 3 to 5 sentences, describe how the work progressed between visits. Mention dates. If the photos do not clearly show a change, say so.` });
        const text = await claude(MODEL_VISION.value(), SITE_VOICE, content, 450);
        res.json({ text });
        return;
      }

      if (b.task === 'search') {
        const system = 'You convert a civil engineer\'s photo search into JSON filters. Reply with JSON only, no prose.';
        const prompt = `Today is ${b.today}. Known activities: ${(b.activities || []).join(', ')}. Known sides: ${(b.sides || []).join(', ')}.
Search: "${String(b.query || '').slice(0, 300)}"
Return a JSON object with any of these keys (omit unknown ones):
"activity" (a word from an activity name), "side" (exactly one of the known sides),
"chMid" (chainage in metres, e.g. 14 km -> 14000, 12+450 -> 12450), "chTol" (metres either side, default 250),
"dateFrom" and "dateTo" (YYYY-MM-DD), "text" (remaining words to match in descriptions, e.g. owner names).`;
        const raw = await claude(MODEL_FAST.value(), system, [{ type: 'text', text: prompt }], 200);
        let filter = {};
        try { filter = JSON.parse(raw.replace(/^```(?:json)?|```$/g, '').trim()); } catch (e) { filter = { text: b.query }; }
        res.json({ filter });
        return;
      }

      res.status(400).json({ error: 'Unknown task' });
    } catch (e) {
      console.error(e);
      res.status(502).json({ error: 'AI service error' });
    }
  }
);
