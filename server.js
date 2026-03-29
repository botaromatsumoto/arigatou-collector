const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'arigatou2024';

function adminAuth(req, res, next) {
  const pw = req.headers['x-admin-password'];
  if (pw !== ADMIN_PASSWORD) return res.status(401).json({ error: '認証失敗' });
  next();
}

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/admin/verify', adminAuth, (req, res) => res.json({ ok: true }));

// 音声ファイルの保存設定
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}.wav`);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// 録音アップロード
app.post('/upload', upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ファイルがありません' });
  const name = (req.body.name || '').trim().slice(0, 30);
  const deleteToken = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const jsonPath = path.join(UPLOADS_DIR, req.file.filename.replace('.wav', '.json'));
  fs.writeFileSync(jsonPath, JSON.stringify({ name, deleteToken }));
  res.json({ success: true, filename: req.file.filename, deleteToken });
});

// 録音一覧取得
app.get('/list', (req, res) => {
  const files = fs.readdirSync(UPLOADS_DIR)
    .filter(f => f.endsWith('.wav'))
    .sort();
  res.json(files.map((f, i) => {
    const jsonPath = path.join(UPLOADS_DIR, f.replace('.wav', '.json'));
    let name = '';
    try {
      if (fs.existsSync(jsonPath)) {
        name = JSON.parse(fs.readFileSync(jsonPath, 'utf8')).name || '';
      }
    } catch {}
    return { index: i + 1, filename: f, timestamp: parseInt(f.split('_')[0]), name };
  }));
});

// 全録音を結合してダウンロード
app.get('/download', adminAuth, (req, res) => {
  const files = fs.readdirSync(UPLOADS_DIR)
    .filter(f => f.endsWith('.wav'))
    .sort()
    .map(f => path.join(UPLOADS_DIR, f));

  if (files.length === 0) {
    return res.status(404).json({ error: '録音がありません' });
  }

  try {
    const firstBuf = fs.readFileSync(files[0]);
    const numChannels = firstBuf.readUInt16LE(22);
    const sampleRate = firstBuf.readUInt32LE(24);
    const bitDepth = firstBuf.readUInt16LE(34);

    // 各ファイルのPCMデータを結合（先頭44バイトのヘッダーを除く）
    const pcmChunks = files.map(f => fs.readFileSync(f).slice(44));
    const totalPCM = Buffer.concat(pcmChunks);

    // WAVヘッダーを作成
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

    const combined = Buffer.concat([header, totalPCM]);
    const date = new Date().toISOString().slice(0, 10);

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', `attachment; filename="arigatou_${date}.wav"`);
    res.send(combined);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 個別削除（管理者パスワード または 削除トークンで認証）
app.delete('/recording/:filename', (req, res) => {
  const safe = path.basename(req.params.filename);
  const filepath = path.join(UPLOADS_DIR, safe);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Not found' });

  const adminPw = req.headers['x-admin-password'];
  const deleteToken = req.headers['x-delete-token'];
  let authorized = adminPw === ADMIN_PASSWORD;

  if (!authorized && deleteToken) {
    try {
      const jsonPath = filepath.replace('.wav', '.json');
      const meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      authorized = meta.deleteToken && meta.deleteToken === deleteToken;
    } catch {}
  }

  if (!authorized) return res.status(401).json({ error: '認証失敗' });

  fs.unlinkSync(filepath);
  const jsonPath = filepath.replace('.wav', '.json');
  if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
  res.json({ success: true });
});

// 全削除
app.delete('/clear', adminAuth, (req, res) => {
  fs.readdirSync(UPLOADS_DIR)
    .filter(f => f.endsWith('.wav') || f.endsWith('.json'))
    .forEach(f => fs.unlinkSync(path.join(UPLOADS_DIR, f)));
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`サーバー起動中 → http://localhost:${PORT}`));
