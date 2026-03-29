const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

app.use(express.static(path.join(__dirname, 'public')));

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
  res.json({ success: true });
});

// 録音一覧取得
app.get('/list', (req, res) => {
  const files = fs.readdirSync(UPLOADS_DIR)
    .filter(f => f.endsWith('.wav'))
    .sort();
  res.json(files.map((f, i) => ({
    index: i + 1,
    filename: f,
    timestamp: parseInt(f.split('_')[0])
  })));
});

// 全録音を結合してダウンロード
app.get('/download', (req, res) => {
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

// 個別削除
app.delete('/recording/:filename', (req, res) => {
  const safe = path.basename(req.params.filename);
  const filepath = path.join(UPLOADS_DIR, safe);
  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// 全削除
app.delete('/clear', (req, res) => {
  fs.readdirSync(UPLOADS_DIR)
    .filter(f => f.endsWith('.wav'))
    .forEach(f => fs.unlinkSync(path.join(UPLOADS_DIR, f)));
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`サーバー起動中 → http://localhost:${PORT}`));
