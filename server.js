const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'arigatou2024';
const EVENTS_DIR = path.join(UPLOADS_DIR, 'events');

if (!fs.existsSync(EVENTS_DIR)) fs.mkdirSync(EVENTS_DIR, { recursive: true });

// ---- 認証 ----
function adminAuth(req, res, next) {
  const pw = req.headers['x-admin-password'];
  if (pw !== ADMIN_PASSWORD) return res.status(401).json({ error: '認証失敗' });
  next();
}

// ---- イベントディレクトリ ----
function eventDir(id) { return path.join(EVENTS_DIR, id); }
function eventExists(id) { return /^[a-z0-9]{6}$/.test(id) && fs.existsSync(eventDir(id)); }

// ---- オフセット ----
function getOffset(id) {
  try { return JSON.parse(fs.readFileSync(path.join(eventDir(id), '_offset.json'), 'utf8')).offset || 0; } catch { return 0; }
}
function setOffset(id, n) {
  fs.writeFileSync(path.join(eventDir(id), '_offset.json'), JSON.stringify({ offset: n }));
}

// ---- ページ配信 ----
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/event/:id', (req, res) => {
  if (!eventExists(req.params.id)) return res.status(404).send('イベントが見つかりません');
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ---- 管理者認証確認 ----
app.get('/admin/verify', adminAuth, (req, res) => res.json({ ok: true }));

// ---- イベント一覧（管理者） ----
app.get('/admin/events', adminAuth, (req, res) => {
  const events = fs.readdirSync(EVENTS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const id = d.name;
      const metaPath = path.join(eventDir(id), '_meta.json');
      let name = id, createdAt = null;
      try { ({ name, createdAt } = JSON.parse(fs.readFileSync(metaPath, 'utf8'))); } catch {}
      const count = fs.readdirSync(eventDir(id)).filter(f => f.endsWith('.wav')).length;
      return { id, name, createdAt, count, offset: getOffset(id) };
    })
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  res.json(events);
});

// ---- イベント作成（管理者） ----
app.post('/admin/events', adminAuth, (req, res) => {
  const name = (req.body.name || '').trim().slice(0, 50);
  if (!name) return res.status(400).json({ error: 'イベント名を入力してください' });
  const id = Math.random().toString(36).slice(2, 8);
  fs.mkdirSync(eventDir(id));
  fs.writeFileSync(path.join(eventDir(id), '_meta.json'), JSON.stringify({ name, createdAt: new Date().toISOString() }));
  res.json({ success: true, id, name });
});

// ---- イベント削除（管理者） ----
app.delete('/admin/events/:id', adminAuth, (req, res) => {
  const id = path.basename(req.params.id);
  if (!eventExists(id)) return res.status(404).json({ error: 'Not found' });
  fs.rmSync(eventDir(id), { recursive: true });
  res.json({ success: true });
});

// ---- イベント情報（公開） ----
app.get('/event-info/:id', (req, res) => {
  const id = path.basename(req.params.id);
  if (!eventExists(id)) return res.status(404).json({ error: 'Not found' });
  try {
    const { name } = JSON.parse(fs.readFileSync(path.join(eventDir(id), '_meta.json'), 'utf8'));
    res.json({ name });
  } catch { res.json({ name: id }); }
});

// ---- 録音アップロード ----
app.post('/upload/:id', (req, res) => {
  const id = path.basename(req.params.id);
  if (!eventExists(id)) return res.status(404).json({ error: 'イベントが見つかりません' });
  const storage = multer.diskStorage({
    destination: eventDir(id),
    filename: (req, file, cb) => cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}.wav`)
  });
  multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }).single('audio')(req, res, (err) => {
    if (err || !req.file) return res.status(400).json({ error: 'アップロード失敗' });
    const name = (req.body.name || '').trim().slice(0, 30);
    const deleteToken = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    fs.writeFileSync(path.join(eventDir(id), req.file.filename.replace('.wav', '.json')), JSON.stringify({ name, deleteToken }));
    res.json({ success: true, filename: req.file.filename, deleteToken });
  });
});

// ---- 録音一覧 ----
app.get('/list/:id', (req, res) => {
  const id = path.basename(req.params.id);
  if (!eventExists(id)) return res.status(404).json({ error: 'Not found' });
  const dir = eventDir(id);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.wav')).sort();
  res.json(files.map((f, i) => {
    const jsonPath = path.join(dir, f.replace('.wav', '.json'));
    let name = '';
    try { if (fs.existsSync(jsonPath)) name = JSON.parse(fs.readFileSync(jsonPath, 'utf8')).name || ''; } catch {}
    return { index: i + 1, filename: f, timestamp: parseInt(f.split('_')[0]), name };
  }));
});

// ---- オフセット取得（公開）・設定（管理者） ----
app.get('/offset/:id', (req, res) => {
  const id = path.basename(req.params.id);
  res.json({ offset: getOffset(id) });
});
app.post('/admin/offset/:id', adminAuth, (req, res) => {
  const id = path.basename(req.params.id);
  if (!eventExists(id)) return res.status(404).json({ error: 'Not found' });
  const n = parseInt(req.body.offset);
  if (isNaN(n) || n < 0) return res.status(400).json({ error: '無効な値です' });
  setOffset(id, n);
  res.json({ success: true, offset: n });
});

// ---- WAVダウンロード（管理者） ----
app.get('/download/:id', adminAuth, (req, res) => {
  const id = path.basename(req.params.id);
  if (!eventExists(id)) return res.status(404).json({ error: 'Not found' });
  const dir = eventDir(id);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.wav')).sort().map(f => path.join(dir, f));
  if (files.length === 0) return res.status(404).json({ error: '録音がありません' });
  try {
    const firstBuf = fs.readFileSync(files[0]);
    const numChannels = firstBuf.readUInt16LE(22);
    const sampleRate = firstBuf.readUInt32LE(24);
    const bitDepth = firstBuf.readUInt16LE(34);
    const totalPCM = Buffer.concat(files.map(f => fs.readFileSync(f).slice(44)));
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + totalPCM.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * numChannels * (bitDepth / 8), 28);
    header.writeUInt16LE(numChannels * (bitDepth / 8), 32);
    header.writeUInt16LE(bitDepth, 34);
    header.write('data', 36);
    header.writeUInt32LE(totalPCM.length, 40);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', `attachment; filename="arigatou_${id}_${date}.wav"`);
    res.send(Buffer.concat([header, totalPCM]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- 個別削除（管理者 or 削除トークン） ----
app.delete('/recording/:id/:filename', (req, res) => {
  const id = path.basename(req.params.id);
  const safe = path.basename(req.params.filename);
  if (!eventExists(id)) return res.status(404).json({ error: 'Not found' });
  const filepath = path.join(eventDir(id), safe);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Not found' });
  const adminPw = req.headers['x-admin-password'];
  const deleteToken = req.headers['x-delete-token'];
  let authorized = adminPw === ADMIN_PASSWORD;
  if (!authorized && deleteToken) {
    try {
      const meta = JSON.parse(fs.readFileSync(filepath.replace('.wav', '.json'), 'utf8'));
      authorized = meta.deleteToken && meta.deleteToken === deleteToken;
    } catch {}
  }
  if (!authorized) return res.status(401).json({ error: '認証失敗' });
  fs.unlinkSync(filepath);
  const jsonPath = filepath.replace('.wav', '.json');
  if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
  res.json({ success: true });
});

// ---- 録音全削除（管理者） ----
app.delete('/clear/:id', adminAuth, (req, res) => {
  const id = path.basename(req.params.id);
  if (!eventExists(id)) return res.status(404).json({ error: 'Not found' });
  const dir = eventDir(id);
  fs.readdirSync(dir)
    .filter(f => (f.endsWith('.wav') || f.endsWith('.json')) && !f.startsWith('_'))
    .forEach(f => fs.unlinkSync(path.join(dir, f)));
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`サーバー起動中 → http://localhost:${PORT}`));
