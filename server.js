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

function readDB() {
  try {
    let fileToRead = RUNTIME_DB_FILE;
    if (!fs.existsSync(fileToRead)) {
      if (fs.existsSync(INITIAL_DB_FILE)) {
        fileToRead = INITIAL_DB_FILE;
      } else {
        const defaultData = { petugas_master: [], capaian: [] };
        fs.writeFileSync(RUNTIME_DB_FILE, JSON.stringify(defaultData, null, 2));
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

function writeDB(data) {
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
app.get('/api/master-data', (req, res) => {
  const db = readDB();
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
app.post('/api/petugas', (req, res) => {
  const { kecamatan, posisi, nama } = req.body;
  if (!kecamatan || !nama) {
    return res.status(400).json({ success: false, message: 'Kecamatan dan Nama Petugas wajib diisi.' });
  }

  const db = readDB();
  const exists = db.petugas_master.some(p => p.nama.toLowerCase() === nama.trim().toLowerCase() && p.kecamatan.toLowerCase() === kecamatan.trim().toLowerCase());

  if (!exists) {
    db.petugas_master.push({
      nama: nama.trim(),
      posisi: posisi ? posisi.trim() : 'Petugas Lapangan Sensus (PPL Sensus)',
      kecamatan: kecamatan.trim()
    });
    writeDB(db);
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
app.get('/api/capaian', (req, res) => {
  const db = readDB();
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

// 4. Dual Dropzone Upload (Accepts files_capaian and files_hapus simultaneously!)
app.post('/api/capaian', upload.fields([
  { name: 'files_capaian', maxCount: 20 },
  { name: 'files_hapus', maxCount: 20 },
  { name: 'files', maxCount: 20 }
]), (req, res) => {
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
      // Cleanup files if validation fails
      Object.values(req.files || {}).flat().forEach(f => {
        if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
      });
      return res.status(400).json({ success: false, message: 'Kecamatan dan Nama Petugas wajib dipilih!' });
    }

    const db = readDB();

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

    writeDB(db);

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
app.delete('/api/capaian/:id', (req, res) => {
  const { id } = req.params;
  const db = readDB();

  const index = db.capaian.findIndex(item => item.id === id);
  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Data capaian tidak ditemukan.' });
  }

  const [deletedItem] = db.capaian.splice(index, 1);
  writeDB(db);

  if (deletedItem.filename) {
    const filePath = path.join(UPLOADS_DIR, deletedItem.filename);
    if (fs.existsSync(filePath)) {
      fs.unlink(filePath, (err) => {
        if (err) console.error(`Gagal menghapus file ${filePath}:`, err);
      });
    }
  }

  res.json({
    success: true,
    message: `Screenshot milik ${deletedItem.nama} berhasil dihapus.`,
    data: deletedItem
  });
});

// 6. Delete All Screenshots for a specific Petugas
app.delete('/api/capaian-petugas', (req, res) => {
  const { kecamatan, nama } = req.body;
  if (!kecamatan || !nama) {
    return res.status(400).json({ success: false, message: 'Kecamatan dan Nama Petugas harus diisi.' });
  }

  const db = readDB();
  const toDelete = db.capaian.filter(i => i.kecamatan.toLowerCase() === kecamatan.toLowerCase() && i.nama.toLowerCase() === nama.toLowerCase());
  
  db.capaian = db.capaian.filter(i => !(i.kecamatan.toLowerCase() === kecamatan.toLowerCase() && i.nama.toLowerCase() === nama.toLowerCase()));
  writeDB(db);

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
