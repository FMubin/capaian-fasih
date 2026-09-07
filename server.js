const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const isVercel = process.env.VERCEL === '1';

const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const INITIAL_DB_FILE = path.join(DATA_DIR, 'db.json');
const RUNTIME_DB_FILE = isVercel ? '/tmp/db.json' : INITIAL_DB_FILE;

if (!isVercel && !fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
if (!isVercel && !fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 
                     process.env.SUPABASE_KEY || 
                     process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 
                     process.env.SUPABASE_ANON_KEY || 
                     process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

async function readDB() {
  // 1. If Supabase environment variables exist, read from Supabase Cloud!
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/app_data?id=eq.capaian_db&select=data`, {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      });
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0 && rows[0].data) {
        const parsed = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
        if (!Array.isArray(parsed.petugas_master)) parsed.petugas_master = [];
        if (!Array.isArray(parsed.capaian)) parsed.capaian = [];

        if (parsed.petugas_master.length === 0 && fs.existsSync(INITIAL_DB_FILE)) {
          const initRaw = fs.readFileSync(INITIAL_DB_FILE, 'utf-8');
          const initParsed = JSON.parse(initRaw);
          parsed.petugas_master = initParsed.petugas_master || [];
          await writeDB(parsed);
        }
        return parsed;
      }
    } catch (err) {
      console.error('Error reading Supabase DB, fallbacking...', err);
    }
  }

  // 2. If Vercel KV / Upstash environment variables exist, read from KV!
  if (KV_URL && KV_TOKEN) {
    try {
      const res = await fetch(`${KV_URL}/get/capaian_db`, {
        headers: { Authorization: `Bearer ${KV_TOKEN}` }
      });
      const json = await res.json();
      if (json && json.result) {
        const parsed = typeof json.result === 'string' ? JSON.parse(json.result) : json.result;
        if (!Array.isArray(parsed.petugas_master)) parsed.petugas_master = [];
        if (!Array.isArray(parsed.capaian)) parsed.capaian = [];

        if (parsed.petugas_master.length === 0 && fs.existsSync(INITIAL_DB_FILE)) {
          const initRaw = fs.readFileSync(INITIAL_DB_FILE, 'utf-8');
          const initParsed = JSON.parse(initRaw);
          parsed.petugas_master = initParsed.petugas_master || [];
          await writeDB(parsed);
        }
        return parsed;
      }
    } catch (err) {
      console.error('Error reading Cloud KV DB, fallback to file:', err);
    }
  }

  // 3. Fallback to local file /tmp or data/db.json
  try {
    let fileToRead = RUNTIME_DB_FILE;
    if (!fs.existsSync(fileToRead)) {
      if (fs.existsSync(INITIAL_DB_FILE)) {
        fileToRead = INITIAL_DB_FILE;
      } else {
        const defaultData = { petugas_master: [], capaian: [] };
        if (!isVercel) fs.writeFileSync(RUNTIME_DB_FILE, JSON.stringify(defaultData, null, 2));
        return defaultData;
      }
    }
    const raw = fs.readFileSync(fileToRead, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.petugas_master)) parsed.petugas_master = [];
    if (!Array.isArray(parsed.capaian)) parsed.capaian = [];
    return parsed;
  } catch (err) {
    console.error('Error reading DB:', err);
    return { petugas_master: [], capaian: [] };
  }
}

async function writeDB(data) {
  // 1. If Supabase environment variables exist, write to Supabase Cloud!
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/app_data`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify({
          id: 'capaian_db',
          data: data
        })
      });
      return true;
    } catch (err) {
      console.error('Error writing Supabase DB:', err);
    }
  }

  // 2. If Vercel KV / Upstash environment variables exist, write to Cloud KV!
  if (KV_URL && KV_TOKEN) {
    try {
      await fetch(`${KV_URL}/set/capaian_db`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${KV_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(JSON.stringify(data))
      });
      return true;
    } catch (err) {
      console.error('Error writing Cloud KV DB:', err);
    }
  }

  // 3. Fallback to local file /tmp or data/db.json
  try {
    fs.writeFileSync(RUNTIME_DB_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    console.error('Error writing DB:', err);
    return false;
  }
}

const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: { fileSize: 500 * 1024 }, // Max 500 KB
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|webp|gif/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Hanya file gambar (PNG, JPG, JPEG, WEBP, GIF) yang diperbolehkan!'));
  }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// API Routes

// 1. Get Master Data
app.get('/api/master-data', async (req, res) => {
  const db = await readDB();
  const master = db.petugas_master || [];
  const kecamatanList = [...new Set(master.map(item => item.kecamatan))].sort();

  res.json({
    success: true,
    total: master.length,
    data: master,
    kecamatan: kecamatanList
  });
});

// 2. Add New Petugas
app.post('/api/petugas', async (req, res) => {
  const { kecamatan, posisi, nama } = req.body;
  if (!kecamatan || !nama) {
    return res.status(400).json({ success: false, message: 'Kecamatan dan Nama Petugas wajib diisi.' });
  }

  const db = await readDB();
  const exists = db.petugas_master.some(p => p.nama.toLowerCase() === nama.trim().toLowerCase() && p.kecamatan.toLowerCase() === kecamatan.trim().toLowerCase());

  if (!exists) {
    db.petugas_master.push({
      nama: nama.trim(),
      posisi: posisi ? posisi.trim() : 'Petugas Lapangan Sensus (PPL Sensus)',
      kecamatan: kecamatan.trim()
    });
    await writeDB(db);
  }

  const kecamatanList = [...new Set(db.petugas_master.map(item => item.kecamatan))].sort();

  res.json({
    success: true,
    message: 'Petugas berhasil ditambahkan ke master data.',
    data: db.petugas_master,
    kecamatan: kecamatanList
  });
});

// 3. Get All Capaian Screenshots
app.get('/api/capaian', async (req, res) => {
  const db = await readDB();
  let list = db.capaian || [];

  const { kecamatan, search } = req.query;

  if (kecamatan && kecamatan !== 'SEMUA') {
    list = list.filter(item => item.kecamatan.toLowerCase() === kecamatan.toLowerCase());
  }

  if (search) {
    const q = search.toLowerCase();
    list = list.filter(item =>
      (item.nama && item.nama.toLowerCase().includes(q)) ||
      (item.posisi && item.posisi.toLowerCase().includes(q)) ||
      item.kecamatan.toLowerCase().includes(q)
    );
  }

  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  res.json({
    success: true,
    total: list.length,
    data: list
  });
});

// 3.5 Check Upload Status for Specific Officer
app.get('/api/check-status', async (req, res) => {
  const { kecamatan, nama } = req.query;
  if (!kecamatan || !nama) {
    return res.json({ success: true, uploaded: false });
  }

  const db = await readDB();
  const exists = db.capaian.some(
    item => item.nama.toLowerCase() === nama.trim().toLowerCase() &&
            item.kecamatan.toLowerCase() === kecamatan.trim().toLowerCase()
  );

  res.json({
    success: true,
    uploaded: exists,
    count: exists ? db.capaian.filter(item => item.nama.toLowerCase() === nama.trim().toLowerCase() && item.kecamatan.toLowerCase() === kecamatan.trim().toLowerCase()).length : 0
  });
});

// 4. Dual Dropzone Upload (Accepts files_capaian and files_hapus simultaneously!)
app.post('/api/capaian', upload.fields([
  { name: 'files_capaian', maxCount: 20 },
  { name: 'files_hapus', maxCount: 20 },
  { name: 'files', maxCount: 20 }
]), async (req, res) => {
  try {
    const filesCapaian = (req.files && req.files['files_capaian']) || [];
    const filesHapus = (req.files && req.files['files_hapus']) || [];
    const filesGeneral = (req.files && req.files['files']) || [];

    const totalFilesCount = filesCapaian.length + filesHapus.length + filesGeneral.length;

    if (totalFilesCount === 0) {
      return res.status(400).json({ success: false, message: 'Minimal 1 file gambar screenshot wajib diunggah.' });
    }

    const { kecamatan, nama, posisi } = req.body;

    if (!kecamatan || !nama) {
      return res.status(400).json({ success: false, message: 'Kecamatan dan Nama Petugas wajib dipilih!' });
    }

    const db = await readDB();

    // STRICT CONSTRAINT: Reject if officer has ALREADY uploaded
    const alreadyUploaded = db.capaian.some(
      item => item.nama.toLowerCase() === nama.trim().toLowerCase() &&
              item.kecamatan.toLowerCase() === kecamatan.trim().toLowerCase()
    );

    if (alreadyUploaded) {
      return res.status(400).json({
        success: false,
        message: `Petugas "${nama}" (${kecamatan}) sudah pernah mengunggah bukti screenshot sebelumnya! Setiap petugas hanya diperbolehkan mengunggah 1 kali.`
      });
    }

    // Auto register to master data if missing
    const exists = db.petugas_master.some(p => p.nama.toLowerCase() === nama.trim().toLowerCase());
    if (!exists) {
      db.petugas_master.push({
        nama: nama.trim(),
        posisi: posisi ? posisi.trim() : 'Petugas Lapangan Sensus (PPL Sensus)',
        kecamatan: kecamatan.trim()
      });
    }

    const createdItems = [];

    // Helper to add files with specific jenis tag
    const processFiles = (fileList, jenisTag) => {
      fileList.forEach((file, index) => {
        const base64Data = file.buffer ? file.buffer.toString('base64') : '';
        const dataUri = base64Data ? `data:${file.mimetype};base64,${base64Data}` : '';

        const newItem = {
          id: `capaian_${Date.now()}_${jenisTag}_${index}_${Math.random().toString(36).substr(2, 4)}`,
          kecamatan: kecamatan.trim(),
          nama: nama.trim(),
          posisi: posisi ? posisi.trim() : 'PPL Sensus',
          jenis: jenisTag, // 'Capaian Petugas' or 'Hapus Aplikasi FASIH / Periode Sensus'
          filename: file.filename || file.originalname,
          original_name: file.originalname,
          file_url: dataUri,
          size_bytes: file.size,
          mimetype: file.mimetype,
          created_at: new Date().toISOString()
        };
        db.capaian.push(newItem);
        createdItems.push(newItem);
      });
    };

    processFiles(filesCapaian, 'Capaian Petugas');
    processFiles(filesHapus, 'Hapus Aplikasi FASIH / Periode Sensus');
    processFiles(filesGeneral, req.body.jenis || 'Capaian Petugas');

    await writeDB(db);

    console.log(`[DUAL UPLOAD SUCCESS] ${createdItems.length} screenshots uploaded by ${nama} (${kecamatan})`);

    res.json({
      success: true,
      message: `Berhasil mengunggah ${createdItems.length} screenshot (${filesCapaian.length} Capaian, ${filesHapus.length} Hapus)!`,
      count: createdItems.length,
      data: createdItems
    });
  } catch (err) {
    console.error('Error handling dual upload:', err);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server saat mengunggah.' });
  }
});

// 5. Delete Single Screenshot
app.delete('/api/capaian/:id', async (req, res) => {
  const { id } = req.params;
  const db = await readDB();

  const index = db.capaian.findIndex(item => item.id === id);
  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Data capaian tidak ditemukan.' });
  }

  const [deletedItem] = db.capaian.splice(index, 1);
  await writeDB(db);

  res.json({
    success: true,
    message: `Screenshot milik ${deletedItem.nama} berhasil dihapus.`,
    data: deletedItem
  });
});

// 6. Delete All Screenshots for a specific Petugas
app.delete('/api/capaian-petugas', async (req, res) => {
  const { kecamatan, nama } = req.body;
  if (!kecamatan || !nama) {
    return res.status(400).json({ success: false, message: 'Kecamatan dan Nama Petugas harus diisi.' });
  }

  const db = await readDB();
  const toDelete = db.capaian.filter(i => i.kecamatan.toLowerCase() === kecamatan.toLowerCase() && i.nama.toLowerCase() === nama.toLowerCase());
  
  db.capaian = db.capaian.filter(i => !(i.kecamatan.toLowerCase() === kecamatan.toLowerCase() && i.nama.toLowerCase() === nama.toLowerCase()));
  await writeDB(db);

  toDelete.forEach(item => {
    if (item.filename) {
      const filePath = path.join(UPLOADS_DIR, item.filename);
      if (fs.existsSync(filePath)) {
        fs.unlink(filePath, err => { if (err) console.error(err); });
      }
    }
  });

  res.json({
    success: true,
    message: `Seluruh (${toDelete.length}) screenshot milik ${nama} berhasil dihapus.`
  });
});

// Error handling middleware (e.g. for Multer LIMIT_FILE_SIZE)
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'Ukuran file gambar melebihi batas maksimal 500 KB!'
      });
    }
  }
  if (err) {
    return res.status(400).json({
      success: false,
      message: err.message || 'Terjadi kesalahan saat memproses gambar.'
    });
  }
  next();
});

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 Server Capaian FASIH running at: http://localhost:${PORT}`);
  console.log(`====================================================`);
});
