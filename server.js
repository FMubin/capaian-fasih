const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const stream = require('stream');
const { google } = require('googleapis');

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

// Google Drive API Credentials
const GOOGLE_CLIENT_EMAIL = process.env.GOOGLE_DRIVE_CLIENT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_DRIVE_PRIVATE_KEY || process.env.GOOGLE_PRIVATE_KEY;
const GOOGLE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || process.env.GOOGLE_FOLDER_ID;

function getGoogleDriveClient() {
  if (!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    console.log('[GOOGLE DRIVE] Credentials missing in environment variables');
    return null;
  }
  try {
    const formattedPrivateKey = GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
    const auth = new google.auth.JWT(
      GOOGLE_CLIENT_EMAIL.trim(),
      null,
      formattedPrivateKey,
      ['https://www.googleapis.com/auth/drive']
    );
    return google.drive({ version: 'v3', auth });
  } catch (err) {
    console.error('[GOOGLE DRIVE INIT ERROR]:', err && err.message ? err.message : err);
    return null;
  }
}

async function uploadToGoogleDrive(buffer, filename, mimetype) {
  const drive = getGoogleDriveClient();
  if (!drive) return null;

  try {
    const bufferStream = new stream.PassThrough();
    bufferStream.end(buffer);

    const fileMetadata = {
      name: filename,
      parents: GOOGLE_FOLDER_ID ? [GOOGLE_FOLDER_ID.trim()] : []
    };

    const media = {
      mimeType: mimetype,
      body: bufferStream
    };

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, webViewLink, webContentLink, thumbnailLink'
    });

    const fileId = response.data.id;

    // Grant public read permission to file
    try {
      await drive.permissions.create({
        fileId: fileId,
        requestBody: {
          role: 'reader',
          type: 'anyone'
        }
      });
    } catch (permErr) {
      console.warn('[GOOGLE DRIVE PERMISSION WARN]:', permErr && permErr.message ? permErr.message : permErr);
    }

    const fileUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
    const viewUrl = response.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;

    console.log(`[GOOGLE DRIVE SUCCESS] Uploaded file: ${filename} (ID: ${fileId})`);

    return {
      fileId,
      fileUrl,
      viewUrl
    };
  } catch (err) {
    console.error('[GOOGLE DRIVE UPLOAD ERROR]:', err && err.message ? err.message : err);
    return null;
  }
}

// Helper to check if multi-row table `capaian_records` exists in Supabase
async function isMultiRowTableAvailable() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/capaian_records?select=id&limit=1`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    return res.ok;
  } catch (err) {
    return false;
  }
}

// Single-row fallback DB reader/writer for legacy app_data / KV / file
async function readDB() {
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

// 0. Maintenance Mode API
app.get('/api/maintenance', async (req, res) => {
  const db = await readDB();
  res.json({
    success: true,
    maintenance: Boolean(db.maintenance)
  });
});

app.post('/api/maintenance', async (req, res) => {
  const { enabled } = req.body;
  const db = await readDB();
  db.maintenance = Boolean(enabled);
  await writeDB(db);
  res.json({
    success: true,
    maintenance: db.maintenance,
    message: db.maintenance ? 'Mode Pemeliharaan (Maintenance) DIAKTIFKAN.' : 'Mode Pemeliharaan (Maintenance) DINONAKTIFKAN.'
  });
});

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
  const { kecamatan, search } = req.query;
  const useMultiRow = await isMultiRowTableAvailable();

  if (useMultiRow) {
    try {
      let queryUrl = `${SUPABASE_URL}/rest/v1/capaian_records?select=*&order=created_at.desc`;
      if (kecamatan && kecamatan !== 'SEMUA') {
        queryUrl += `&kecamatan=ilike.${encodeURIComponent(kecamatan)}`;
      }
      const response = await fetch(queryUrl, {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      });

      if (response.ok) {
        let list = await response.json();
        if (search) {
          const q = search.toLowerCase();
          list = list.filter(item =>
            (item.nama && item.nama.toLowerCase().includes(q)) ||
            (item.posisi && item.posisi.toLowerCase().includes(q)) ||
            (item.kecamatan && item.kecamatan.toLowerCase().includes(q))
          );
        }
        return res.json({
          success: true,
          total: list.length,
          data: list
        });
      }
    } catch (err) {
      console.error('Error fetching multi-row capaian_records:', err);
    }
  }

  // Fallback
  const db = await readDB();
  let list = db.capaian || [];

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

  const useMultiRow = await isMultiRowTableAvailable();
  if (useMultiRow) {
    try {
      const checkUrl = `${SUPABASE_URL}/rest/v1/capaian_records?select=id&kecamatan=ilike.${encodeURIComponent(kecamatan)}&nama=ilike.${encodeURIComponent(nama)}`;
      const response = await fetch(checkUrl, {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      });
      if (response.ok) {
        const rows = await response.json();
        return res.json({
          success: true,
          uploaded: rows.length > 0,
          count: rows.length
        });
      }
    } catch (err) {
      console.error('Error checking multi-row status:', err);
    }
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

// 4. Dual Dropzone Upload (Supports Google Drive API + Supabase Storage)
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

    const useMultiRow = await isMultiRowTableAvailable();

    // Reject if officer has ALREADY uploaded
    if (useMultiRow) {
      try {
        const checkUrl = `${SUPABASE_URL}/rest/v1/capaian_records?select=id&kecamatan=ilike.${encodeURIComponent(kecamatan)}&nama=ilike.${encodeURIComponent(nama)}&limit=1`;
        const checkRes = await fetch(checkUrl, {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
          }
        });
        if (checkRes.ok) {
          const rows = await checkRes.json();
          if (rows.length > 0) {
            return res.status(400).json({
              success: false,
              message: `Petugas "${nama}" (${kecamatan}) sudah pernah mengunggah bukti screenshot sebelumnya! Setiap petugas hanya diperbolehkan mengunggah 1 kali.`
            });
          }
        }
      } catch (err) {
        console.error('Error checking upload status:', err);
      }
    } else {
      const dbCheck = await readDB();
      const alreadyUploaded = dbCheck.capaian.some(
        item => item.nama.toLowerCase() === nama.trim().toLowerCase() &&
                item.kecamatan.toLowerCase() === kecamatan.trim().toLowerCase()
      );

      if (alreadyUploaded) {
        return res.status(400).json({
          success: false,
          message: `Petugas "${nama}" (${kecamatan}) sudah pernah mengunggah bukti screenshot sebelumnya! Setiap petugas hanya diperbolehkan mengunggah 1 kali.`
        });
      }
    }

    // Auto register to master data if missing
    const db = await readDB();
    const exists = db.petugas_master.some(p => p.nama.toLowerCase() === nama.trim().toLowerCase());
    if (!exists) {
      db.petugas_master.push({
        nama: nama.trim(),
        posisi: posisi ? posisi.trim() : 'Petugas Lapangan Sensus (PPL Sensus)',
        kecamatan: kecamatan.trim()
      });
      await writeDB(db);
    }

    const createdItems = [];

    // Helper to process and upload files (prefers Google Drive API, falls back to Base64)
    const processFiles = async (fileList, jenisTag) => {
      for (let index = 0; index < fileList.length; index++) {
        const file = fileList[index];
        let fileUrl = '';
        let driveFileId = null;

        // 1. Try Google Drive Upload if API configured
        if (file.buffer) {
          const driveResult = await uploadToGoogleDrive(
            file.buffer,
            `[${jenisTag}] ${nama.trim()}_${file.originalname || `screenshot_${index}.webp`}`,
            file.mimetype || 'image/webp'
          );
          if (driveResult && driveResult.fileUrl) {
            fileUrl = driveResult.fileUrl;
            driveFileId = driveResult.fileId;
          }
        }

        // 2. Fallback to Base64 Data URI if Google Drive is not configured or failed
        if (!fileUrl) {
          const base64Data = file.buffer ? file.buffer.toString('base64') : '';
          fileUrl = base64Data ? `data:${file.mimetype};base64,${base64Data}` : '';
        }

        const newItem = {
          id: `capaian_${Date.now()}_${jenisTag.replace(/[^a-zA-Z0-9]/g, '_')}_${index}_${Math.random().toString(36).substr(2, 4)}`,
          kecamatan: kecamatan.trim(),
          nama: nama.trim(),
          posisi: posisi ? posisi.trim() : 'PPL Sensus',
          jenis: jenisTag,
          filename: file.filename || file.originalname,
          original_name: file.originalname,
          file_url: fileUrl,
          size_bytes: file.size,
          mimetype: file.mimetype,
          created_at: new Date().toISOString()
        };

        if (driveFileId) {
          newItem.drive_file_id = driveFileId;
        }

        createdItems.push(newItem);
      }
    };

    await processFiles(filesCapaian, 'Capaian Petugas');
    await processFiles(filesHapus, 'Hapus Aplikasi FASIH / Periode Sensus');
    await processFiles(filesGeneral, req.body.jenis || 'Capaian Petugas');

    if (useMultiRow) {
      try {
        const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/capaian_records`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify(createdItems)
        });

        if (!insertRes.ok) {
          const errText = await insertRes.text();
          console.error('Failed to insert into capaian_records:', errText);
          
          // Retry without drive_file_id property in case column hasn't been added to PostgreSQL schema yet
          const cleanedItems = createdItems.map(item => {
            const copy = { ...item };
            delete copy.drive_file_id;
            return copy;
          });

          const retryRes = await fetch(`${SUPABASE_URL}/rest/v1/capaian_records`, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify(cleanedItems)
          });

          if (!retryRes.ok) {
            console.error('Retry insert also failed, fallback to legacy DB:', await retryRes.text());
            db.capaian.push(...createdItems);
            await writeDB(db);
          }
        }
      } catch (err) {
        console.error('Multi-row insert failed, fallbacking to writeDB:', err);
        db.capaian.push(...createdItems);
        await writeDB(db);
      }
    } else {
      db.capaian.push(...createdItems);
      await writeDB(db);
    }

    console.log(`[DUAL UPLOAD SUCCESS] ${createdItems.length} screenshots uploaded for ${nama} (${kecamatan})`);

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
  const useMultiRow = await isMultiRowTableAvailable();

  if (useMultiRow) {
    try {
      const delRes = await fetch(`${SUPABASE_URL}/rest/v1/capaian_records?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      });
      if (delRes.ok) {
        return res.json({
          success: true,
          message: 'Screenshot berhasil dihapus.'
        });
      }
    } catch (err) {
      console.error('Error deleting multi-row record:', err);
    }
  }

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

  const useMultiRow = await isMultiRowTableAvailable();

  if (useMultiRow) {
    try {
      const delRes = await fetch(`${SUPABASE_URL}/rest/v1/capaian_records?kecamatan=ilike.${encodeURIComponent(kecamatan)}&nama=ilike.${encodeURIComponent(nama)}`, {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      });
      if (delRes.ok) {
        return res.json({
          success: true,
          message: `Seluruh screenshot milik ${nama} (${kecamatan}) berhasil dihapus.`
        });
      }
    } catch (err) {
      console.error('Error deleting multi-row officer records:', err);
    }
  }

  const db = await readDB();
  const toDelete = db.capaian.filter(i => i.kecamatan.toLowerCase() === kecamatan.toLowerCase() && i.nama.toLowerCase() === nama.toLowerCase());
  
  db.capaian = db.capaian.filter(i => !(i.kecamatan.toLowerCase() === kecamatan.toLowerCase() && i.nama.toLowerCase() === nama.toLowerCase()));
  await writeDB(db);

  res.json({
    success: true,
    message: `Seluruh (${toDelete.length}) screenshot milik ${nama} berhasil dihapus.`
  });
});

// Error handling middleware
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
