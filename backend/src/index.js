const express = require('express');
const fs = require('fs');
const { migrateAndSeed, pool } = require('./db');

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/uploads';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
// Unguessable random filenames act as capability URLs for guest photos.
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', index: false }));

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.use('/api/public', require('./routes/public'));
app.use('/api/admin', require('./routes/admin'));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Photo is too large (8 MB max).' });
  }
  console.error('[error]', err);
  res.status(500).json({ error: 'Something went wrong on our end.' });
});

const PORT = parseInt(process.env.PORT, 10) || 4000;

async function start() {
  // Postgres may still be waking up on first boot; retry briefly.
  for (let attempt = 1; attempt <= 20; attempt++) {
    try {
      await migrateAndSeed();
      break;
    } catch (err) {
      if (attempt === 20) throw err;
      console.log(`[boot] database not ready (${err.message}) — retry ${attempt}/20`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  app.listen(PORT, () => console.log(`[boot] WoodsVoice API listening on :${PORT}`));
}

start().catch(err => {
  console.error('[boot] fatal:', err);
  process.exit(1);
});
