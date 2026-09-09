const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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

// ImgBB Free CDN API Credential (Optional)
const IMGBB_API_KEY = process.env.IMGBB_API_KEY;

async function uploadToImgBB(buffer, filename) {
  if (!IMGBB_API_KEY) return { fileUrl: null, error: 'No IMGBB_API_KEY configured' };
  try {
    const formData = new URLSearchParams();
    formData.append('image', buffer.toString('base64'));
    formData.append('name', filename);

    const res = await fetch(`https://api.imgbb.com/1/upload?key=${cleanString(IMGBB_API_KEY)}`, {
      method: 'POST',
      body: formData
    });
    const json = await res.json();
    if (json && json.success && json.data && json.data.url) {
      console.log(`[IMGBB SUCCESS] Uploaded ${filename} -> ${json.data.url}`);
      return { fileUrl: json.data.url, displayUrl: json.data.display_url || json.data.url, error: null };
    }
    console.error('[IMGBB UPLOAD ERROR]:', JSON.stringify(json));
    return { fileUrl: null, error: json };
  } catch (err) {
    console.error('[IMGBB EXCEPTION]:', err);
    return { fileUrl: null, error: err && err.message ? err.message : String(err) };
  }
}

function cleanPrivateKey(key) {
  if (!key) return '';
  let cleaned = key.trim();
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1);
  }
  return cleaned.replace(/\\n/g, '\n').trim();
}

function cleanString(str) {
  if (!str) return '';
  let cleaned = str.trim();
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1);
  }
  return cleaned.trim();
}

// Zero-dependency Google Service Account JWT OAuth Token Generator
async function getGoogleAccessToken(clientEmail, privateKey) {
  if (!clientEmail || !privateKey) {
    console.error('[GOOGLE AUTH ERROR]: Missing email or private key');
    return { token: null, error: 'Missing email or private key in environment variables' };
  }
  try {
    const email = cleanString(clientEmail);
    const formattedKey = cleanPrivateKey(privateKey);

    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const claimSet = {
      iss: email,
      scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    };

    const base64UrlEncode = (obj) =>
      Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)).toString('base64url');

    const encodedHeader = base64UrlEncode(header);
    const encodedClaimSet = base64UrlEncode(claimSet);
    const signatureInput = `${encodedHeader}.${encodedClaimSet}`;

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signatureInput);
    const signature = signer.sign(formattedKey, 'base64url');

    const jwt = `${signatureInput}.${signature}`;

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      })
    });

    const json = await res.json();
    if (json.access_token) {
      return { token: json.access_token, error: null };
    }
    console.error('[GOOGLE AUTH RESPONSE ERROR]:', JSON.stringify(json));
    return { token: null, error: json.error_description || json.error || JSON.stringify(json) };
  } catch (err) {
    console.error('[GOOGLE AUTH EXCEPTION]:', err && err.message ? err.message : err);
    return { token: null, error: err && err.message ? err.message : String(err) };
  }
}

// Zero-dependency Google Drive API Multipart Direct Uploader
async function uploadToGoogleDrive(buffer, filename, mimetype) {
  if (!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    console.log('[GOOGLE DRIVE] Credentials missing in environment variables');
    return { fileId: null, error: 'Credentials missing' };
  }

  try {
    const authResult = await getGoogleAccessToken(GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY);
    if (!authResult.token) {
      console.error('[GOOGLE DRIVE UPLOAD FAILED]: Token error:', authResult.error);
      return { fileId: null, error: authResult.error };
    }
    const accessToken = authResult.token;

    const folderId = cleanString(GOOGLE_FOLDER_ID);
    const metadata = {
      name: filename,
      parents: folderId ? [folderId] : []
    };

    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const body = Buffer.concat([
      Buffer.from(
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        `Content-Type: ${mimetype || 'image/webp'}\r\n\r\n`
      ),
      buffer,
      Buffer.from(closeDelimiter)
    ]);

    const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&supportsTeamDrives=true&fields=id,webViewLink', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': body.length.toString()
      },
      body: body
    });

    const uploadJson = await uploadRes.json();
    if (!uploadJson.id) {
      console.error('[GOOGLE DRIVE UPLOAD ERROR]:', JSON.stringify(uploadJson));
      return { fileId: null, error: uploadJson };
    }

    const fileId = uploadJson.id;

    // Grant public read permission to file
    try {
      await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          role: 'reader',
          type: 'anyone'
        })
      });
    } catch (permErr) {
      console.warn('[GOOGLE DRIVE PERMISSION WARN]:', permErr);
    }

    const fileUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
    const viewUrl = uploadJson.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;

    console.log(`[GOOGLE DRIVE SUCCESS] Uploaded ${filename} -> File ID: ${fileId}`);

    return {
      fileId,
      fileUrl,
      viewUrl,
      error: null
    };
  } catch (err) {
    console.error('[GOOGLE DRIVE UPLOAD EXCEPTION]:', err && err.message ? err.message : err);
    return { fileId: null, error: err && err.message ? err.message : String(err) };
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
  limits: { fileSize: 15 * 1024 * 1024, files: 200 }, // Max 15 MB per file, up to 200 files total
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

// 0. Diagnostic Route to Test Google Drive Connection & Upload directly in browser!
app.get('/api/test-drive', async (req, res) => {
  const hasEmail = Boolean(GOOGLE_CLIENT_EMAIL);
  const hasKey = Boolean(GOOGLE_PRIVATE_KEY);
  const hasFolder = Boolean(GOOGLE_FOLDER_ID);

  if (!hasEmail || !hasKey) {
    return res.json({
      success: false,
      message: 'Environment Variables Google Drive belum lengkap di Vercel.',
      config: {
        GOOGLE_DRIVE_CLIENT_EMAIL: hasEmail ? `${GOOGLE_CLIENT_EMAIL.substring(0, 10)}...` : 'MISSING',
        GOOGLE_DRIVE_PRIVATE_KEY: hasKey ? 'PRESENT' : 'MISSING',
        GOOGLE_DRIVE_FOLDER_ID: hasFolder ? GOOGLE_FOLDER_ID : 'MISSING'
      }
    });
  }

  const authResult = await getGoogleAccessToken(GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY);
  if (!authResult.token) {
    return res.json({
      success: false,
      message: 'Gagal mendapatkan OAuth Access Token dari Google Service Account.',
      error: authResult.error,
      config: {
        email: cleanString(GOOGLE_CLIENT_EMAIL),
        folderId: cleanString(GOOGLE_FOLDER_ID)
      }
    });
  }

  // Attempt test file upload into the specified folder!
  const testBuffer = Buffer.from('TEST UPLOAD CAPAIAN FASIH BPS DRIVE INTEGRATION ' + new Date().toISOString());
  const driveResult = await uploadToGoogleDrive(testBuffer, `[TEST] Connection_Test_${Date.now()}.txt`, 'text/plain');

  if (!driveResult || !driveResult.fileId) {
    return res.json({
      success: false,
      message: 'Auth sukses, TETAPI Google Drive API menolak unggah file!',
      driveError: driveResult ? driveResult.error : 'Unknown upload error',
      config: {
        email: cleanString(GOOGLE_CLIENT_EMAIL),
        folderId: cleanString(GOOGLE_FOLDER_ID)
      }
    });
  }

  res.json({
    success: true,
    message: 'Google Drive API Connection & Test Upload SUCCESSFUL!',
    uploadedFileId: driveResult.fileId,
    viewUrl: driveResult.viewUrl,
    config: {
      email: cleanString(GOOGLE_CLIENT_EMAIL),
      folderId: cleanString(GOOGLE_FOLDER_ID)
    }
  });
});

// 0.5 Maintenance Mode API
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

// 2.9 Stream Single Image by ID with 1-Year Browser Caching & Full CORS Support
app.get('/api/capaian/image/:id', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  const { id } = req.params;

  const serveFileUrl = (fileUrl) => {
    if (!fileUrl) return res.status(404).send('Gambar tidak ditemukan.');

    // 1. Direct HTTP/HTTPS link -> redirect directly
    if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
      return res.redirect(fileUrl);
    }

    // 2. Data URI or Raw Base64 string -> decode to binary image buffer
    let cleanBase64 = fileUrl;
    let mimeType = 'image/webp';

    if (fileUrl.startsWith('data:')) {
      const parts = fileUrl.split(';base64,');
      if (parts.length === 2) {
        mimeType = parts[0].replace('data:', '').trim() || 'image/webp';
        cleanBase64 = parts[1];
      }
    } else if (fileUrl.startsWith('iVBORw0KG')) {
      mimeType = 'image/png';
    } else if (fileUrl.startsWith('/9j/')) {
      mimeType = 'image/jpeg';
    } else if (fileUrl.startsWith('R0lGOD')) {
      mimeType = 'image/gif';
    }

    // Remove newlines, carriage returns, and spaces
    cleanBase64 = cleanBase64.replace(/[\r\n\s]/g, '');

    try {
      const imgBuffer = Buffer.from(cleanBase64, 'base64');
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.send(imgBuffer);
    } catch (e) {
      console.error('Base64 decode error:', e);
      return res.status(500).send('Gagal memproses gambar.');
    }
  };

  const useMultiRow = await isMultiRowTableAvailable();

  if (useMultiRow) {
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/capaian_records?id=eq.${encodeURIComponent(id)}&select=file_url`, {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      });
      if (response.ok) {
        const rows = await response.json();
        if (rows.length > 0 && rows[0].file_url) {
          return serveFileUrl(rows[0].file_url);
        }
      }
    } catch (err) {
      console.error('Error fetching image by ID:', err);
    }
  }

  // Fallback DB
  const db = await readDB();
  const item = (db.capaian || []).find(c => c.id === id);
  if (item && item.file_url) {
    return serveFileUrl(item.file_url);
  }

  res.status(404).send('Gambar tidak ditemukan.');
});
app.get('/api/officer-images', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { kecamatan, nama, ids } = req.query;
  const useMultiRow = await isMultiRowTableAvailable();

  if (useMultiRow) {
    try {
      let queryUrl = `${SUPABASE_URL}/rest/v1/capaian_records?select=id,file_url,drive_file_id`;
      if (kecamatan && nama) {
        queryUrl += `&kecamatan=ilike.${encodeURIComponent(kecamatan)}&nama=ilike.${encodeURIComponent(nama)}`;
      } else if (ids) {
        const formattedIds = ids.split(',')
          .map(i => `"${i.trim().replace(/"/g, '')}"`)
          .join(',');
        queryUrl += `&id=in.(${formattedIds})`;
      }

      const response = await fetch(queryUrl, {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      });

      if (response.ok) {
        let rows = await response.json();
        rows = rows.map(item => {
          let finalUrl = item.file_url || '';
          if (finalUrl && !finalUrl.startsWith('data:') && !finalUrl.startsWith('http')) {
            finalUrl = `data:image/webp;base64,${finalUrl}`;
          } else if (!finalUrl && item.drive_file_id) {
            finalUrl = `https://drive.google.com/thumbnail?id=${item.drive_file_id}&sz=w1000`;
          }
          return {
            id: item.id,
            file_url: finalUrl
          };
        });
        return res.json({ success: true, data: rows });
      } else {
        const errText = await response.text();
        console.error('[OFFICER-IMAGES ERROR]:', response.status, errText);
      }
    } catch (err) {
      console.error('Error fetching officer images:', err);
    }
  }

  // Fallback DB
  const db = await readDB();
  let list = db.capaian || [];
  if (kecamatan && nama) {
    list = list.filter(item => item.kecamatan.toLowerCase() === kecamatan.toLowerCase() && item.nama.toLowerCase() === nama.toLowerCase());
  }
  const result = list.map(item => {
    let finalUrl = item.file_url || '';
    if (finalUrl && !finalUrl.startsWith('data:') && !finalUrl.startsWith('http')) {
      finalUrl = `data:image/webp;base64,${finalUrl}`;
    } else if (!finalUrl && item.drive_file_id) {
      finalUrl = `https://drive.google.com/thumbnail?id=${item.drive_file_id}&sz=w1000`;
    }
    return { id: item.id, file_url: finalUrl };
  });

  res.json({ success: true, data: result });
});

// 3. Get All Capaian Screenshots (Lightweight Metadata Proxy - Instant 0.1s Page Load)
app.get('/api/capaian', async (req, res) => {
  const { kecamatan, search } = req.query;
  const useMultiRow = await isMultiRowTableAvailable();

  if (useMultiRow) {
    try {
      // Query metadata fields only (15 KB payload vs 50 MB) for instant 0.1s page load
      let queryUrl = `${SUPABASE_URL}/rest/v1/capaian_records?select=id,kecamatan,nama,posisi,jenis,created_at,drive_file_id&order=created_at.desc`;
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

        // Map file_url to lazy proxy endpoint or Google Drive direct thumbnail
        list = list.map(item => ({
          ...item,
          file_url: item.drive_file_id
            ? `https://drive.google.com/thumbnail?id=${item.drive_file_id}&sz=w1000`
            : `/api/capaian/image/${item.id}`
        }));

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

  list = list.map(item => ({
    ...item,
    file_url: item.drive_file_id
      ? `https://drive.google.com/thumbnail?id=${item.drive_file_id}&sz=w1000`
      : `/api/capaian/image/${item.id}`
  }));

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

// 4. Dual Dropzone Upload (Supports zero-dependency Google Drive API + Supabase Storage)
app.post('/api/capaian', (req, res, next) => {
  upload.fields([
    { name: 'files_capaian', maxCount: 100 },
    { name: 'files_hapus', maxCount: 100 },
    { name: 'files', maxCount: 100 }
  ])(req, res, (err) => {
    if (err) {
      console.error('[MULTER UPLOAD ERROR]:', err);
      let msg = err.message || 'Terjadi kesalahan saat mengunggah file.';
      if (err.code === 'LIMIT_FILE_SIZE') {
        msg = 'Ukuran file gambar terlalu besar (maksimal 15 MB per file).';
      } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        msg = 'Jumlah file screenshot melebihi batas maksimal (maksimal 100 foto per kategori).';
      }
      return res.status(400).json({ success: false, message: msg });
    }
    next();
  });
}, async (req, res) => {
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
    }

    const alreadyUploaded = (db.capaian || []).some(
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
    const exists = (db.petugas_master || []).some(p => p.nama.toLowerCase() === nama.trim().toLowerCase());
    if (!exists) {
      if (!Array.isArray(db.petugas_master)) db.petugas_master = [];
      db.petugas_master.push({
        nama: nama.trim(),
        posisi: posisi ? posisi.trim() : 'Petugas Lapangan Sensus (PPL Sensus)',
        kecamatan: kecamatan.trim()
      });
      await writeDB(db);
    }

    const createdItems = [];

    // Helper to process and upload files directly into Supabase as compressed Base64 (or ImgBB if configured)
    const processFiles = async (fileList, jenisTag) => {
      for (let index = 0; index < fileList.length; index++) {
        const file = fileList[index];
        let fileUrl = '';

        // 1. Try ImgBB Free CDN upload if IMGBB_API_KEY is configured
        if (file.buffer && IMGBB_API_KEY) {
          const imgbbResult = await uploadToImgBB(
            file.buffer,
            `[${jenisTag}] ${nama.trim()}_${file.originalname || `screenshot_${index}.webp`}`
          );
          if (imgbbResult && imgbbResult.fileUrl) {
            fileUrl = imgbbResult.fileUrl;
          }
        }

        // 2. Default to compressed Base64 Data URI directly stored in Supabase DB
        if (!fileUrl && file.buffer) {
          const base64Data = file.buffer.toString('base64');
          fileUrl = `data:${file.mimetype || 'image/webp'};base64,${base64Data}`;
        }

        const newItem = {
          id: `capaian_${Date.now()}_${jenisTag.replace(/[^a-zA-Z0-9]/g, '_')}_${index}_${Math.random().toString(36).substr(2, 4)}`,
          kecamatan: kecamatan.trim(),
          nama: nama.trim(),
          posisi: posisi ? posisi.trim() : 'PPL Sensus',
          jenis: jenisTag,
          filename: file.filename || file.originalname || `screenshot_${index}.webp`,
          original_name: file.originalname || `screenshot_${index}.webp`,
          file_url: fileUrl,
          size_bytes: file.size || 0,
          mimetype: file.mimetype || 'image/webp',
          created_at: new Date().toISOString()
        };

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
          console.error('Failed to insert into capaian_records, fallbacking to writeDB:', errText);
          if (!Array.isArray(db.capaian)) db.capaian = [];
          db.capaian.push(...createdItems);
          await writeDB(db);
        }
      } catch (err) {
        console.error('Multi-row insert failed, fallbacking to writeDB:', err);
        if (!Array.isArray(db.capaian)) db.capaian = [];
        db.capaian.push(...createdItems);
        await writeDB(db);
      }
    } else {
      if (!Array.isArray(db.capaian)) db.capaian = [];
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

// 7. Delete All Screenshots for a specific Kecamatan
app.delete('/api/capaian-kecamatan', async (req, res) => {
  const { kecamatan } = req.body;
  if (!kecamatan || kecamatan === 'SEMUA') {
    return res.status(400).json({ success: false, message: 'Kecamatan spesifik harus dipilih.' });
  }

  const useMultiRow = await isMultiRowTableAvailable();

  if (useMultiRow) {
    try {
      const delRes = await fetch(`${SUPABASE_URL}/rest/v1/capaian_records?kecamatan=ilike.${encodeURIComponent(kecamatan)}`, {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      });
      if (delRes.ok) {
        const db = await readDB();
        db.capaian = (db.capaian || []).filter(i => i.kecamatan.toLowerCase() !== kecamatan.toLowerCase());
        await writeDB(db);

        return res.json({
          success: true,
          message: `Seluruh data screenshot untuk Kecamatan "${kecamatan}" berhasil dihapus.`
        });
      }
    } catch (err) {
      console.error('Error deleting kecamatan records:', err);
    }
  }

  const db = await readDB();
  const initialCount = (db.capaian || []).length;
  db.capaian = (db.capaian || []).filter(i => i.kecamatan.toLowerCase() !== kecamatan.toLowerCase());
  const deletedCount = initialCount - db.capaian.length;
  await writeDB(db);

  res.json({
    success: true,
    message: `Berhasil menghapus ${deletedCount} screenshot di Kecamatan "${kecamatan}".`
  });
});

// 8. Delete ALL Screenshots Across Entire Database
app.delete('/api/capaian-all', async (req, res) => {
  const { confirmText } = req.body;
  if (confirmText !== 'HAPUS') {
    return res.status(400).json({ success: false, message: 'Konfirmasi tidak valid. Harus mengetik HAPUS.' });
  }

  const useMultiRow = await isMultiRowTableAvailable();

  if (useMultiRow) {
    try {
      const delRes = await fetch(`${SUPABASE_URL}/rest/v1/capaian_records?id=not.is.null`, {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      });
      if (!delRes.ok) {
        console.error('Failed to delete all from capaian_records:', await delRes.text());
      }
    } catch (err) {
      console.error('Error deleting all multi-row records:', err);
    }
  }

  const db = await readDB();
  const count = (db.capaian || []).length;
  db.capaian = [];
  await writeDB(db);

  res.json({
    success: true,
    message: `Seluruh data screenshot (${count} data) di aplikasi berhasil dihapus bersih.`
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
