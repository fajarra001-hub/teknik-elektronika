/**
 * routes/admin/khs.js
 * Kelola KHS: daftar, upload, detail, hapus
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive');
const { Readable } = require('stream');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

router.use(verifyToken);
router.use(isAdmin);

// ============================================================================
// FUNGSI BANTU
// ============================================================================

/**
 * Mendapatkan folder KHS di Drive (buat jika belum ada)
 */
async function getKhsFolderId() {
  const folderName = 'KHS_Mahasiswa';
  const query = await drive.files.list({
    q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
  });
  if (query.data.files.length > 0) {
    return query.data.files[0].id;
  } else {
    const folder = await drive.files.create({
      resource: { name: folderName, mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id',
    });
    return folder.data.id;
  }
}

/**
 * Mendapatkan angkatan dari NIM
 */
function getAngkatanFromNim(nim) {
  if (!nim || nim.length < 2) return 'Unknown';
  return '20' + nim.substring(0, 2);
}

// ============================================================================
// DAFTAR KHS
// ============================================================================

/**
 * GET /admin/khs/list
 * Menampilkan daftar KHS dengan filter semester/angkatan
 */
router.get('/list', async (req, res) => {
  try {
    const { semester, angkatan } = req.query;

    // Ambil semua KHS
    let khsQuery = db.collection('khs').orderBy('createdAt', 'desc');
    if (semester) khsQuery = khsQuery.where('semester', '==', semester);
    const khsSnapshot = await khsQuery.get();

    const khsList = [];
    for (const doc of khsSnapshot.docs) {
      const data = doc.data();
      const mahasiswaDoc = await db.collection('users').doc(data.userId).get();
      const mahasiswa = mahasiswaDoc.exists ? mahasiswaDoc.data() : { nama: 'Unknown', nim: '-' };
      const angkatanMhs = getAngkatanFromNim(mahasiswa.nim);
      
      if (angkatan && angkatanMhs !== angkatan) continue;

      khsList.push({
        id: doc.id,
        ...data,
        mahasiswa: {
          nama: mahasiswa.nama,
          nim: mahasiswa.nim,
          foto: mahasiswa.foto,
          angkatan: angkatanMhs
        }
      });
    }

    // Daftar semester unik untuk filter
    const semesterSnapshot = await db.collection('khs').get();
    const semesterSet = new Set();
    semesterSnapshot.docs.forEach(doc => {
      if (doc.data().semester) semesterSet.add(doc.data().semester);
    });
    const semesterList = Array.from(semesterSet).sort();

    // Daftar angkatan unik
    const angkatanSet = new Set(khsList.map(k => k.mahasiswa.angkatan));
    const angkatanList = Array.from(angkatanSet).sort().reverse();

    res.render('admin/khs_list', {
      title: 'Daftar KHS',
      khsList,
      semesterList,
      angkatanList,
      filters: { semester, angkatan }
    });
  } catch (error) {
    console.error('Error mengambil KHS:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat daftar KHS'
    });
  }
});

// ============================================================================
// FORM UPLOAD KHS
// ============================================================================

/**
 * GET /admin/khs/upload
 * Form upload KHS baru
 */
router.get('/upload', async (req, res) => {
  try {
    // Ambil daftar mahasiswa untuk dropdown
    const mahasiswaSnapshot = await db.collection('users')
      .where('role', '==', 'mahasiswa')
      .orderBy('nim')
      .get();
    const mahasiswaList = mahasiswaSnapshot.docs.map(doc => ({
      id: doc.id,
      nim: doc.data().nim,
      nama: doc.data().nama
    }));

    // Semester yang tersedia (bisa hardcode atau dari koleksi)
    const semesterOptions = [
      'Ganjil 2024/2025',
      'Genap 2024/2025',
      'Ganjil 2025/2026',
      'Genap 2025/2026'
    ];

    res.render('admin/khs_upload', {
      title: 'Upload KHS',
      mahasiswaList,
      semesterOptions,
      error: req.query.error
    });
  } catch (error) {
    console.error('Error load form upload:', error);
    res.status(500).send('Gagal memuat form upload');
  }
});

/**
 * POST /admin/khs/upload
 * Proses upload file KHS ke Drive dan simpan ke Firestore
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const { userId, semester, ip } = req.body;
    const file = req.file;

    if (!userId || !semester || !file) {
      return res.redirect('/admin/khs/upload?error=Data tidak lengkap');
    }

    // Validasi IP
    const ipNumber = parseFloat(ip);
    if (isNaN(ipNumber) || ipNumber < 0 || ipNumber > 4) {
      return res.redirect('/admin/khs/upload?error=IP tidak valid (0-4)');
    }

    // Cek apakah sudah ada KHS untuk mahasiswa dan semester ini
    const existing = await db.collection('khs')
      .where('userId', '==', userId)
      .where('semester', '==', semester)
      .get();
    if (!existing.empty) {
      return res.redirect('/admin/khs/upload?error=KHS untuk semester ini sudah ada');
    }

    // Dapatkan folder KHS
    const folderId = await getKhsFolderId();

    // Ambil data mahasiswa untuk penamaan file
    const mahasiswaDoc = await db.collection('users').doc(userId).get();
    if (!mahasiswaDoc.exists) {
      return res.redirect('/admin/khs/upload?error=Mahasiswa tidak ditemukan');
    }
    const mahasiswa = mahasiswaDoc.data();
    const nim = mahasiswa.nim || 'unknown';
    const fileName = `KHS_${nim}_${semester.replace(/\s+/g, '_')}.pdf`;

    // Upload ke Drive
    const fileMetadata = {
      name: fileName,
      parents: [folderId]
    };
    const media = {
      mimeType: file.mimetype,
      body: Readable.from(file.buffer)
    };
    const driveResponse = await drive.files.create({
      resource: fileMetadata,
      media,
      fields: 'id, webViewLink'
    });

    // Set permission publik
    await drive.permissions.create({
      fileId: driveResponse.data.id,
      requestBody: {
        role: 'reader',
        type: 'anyone'
      }
    });

    // Simpan ke Firestore
    await db.collection('khs').add({
      userId,
      semester,
      ip: ipNumber,
      fileUrl: `https://drive.google.com/uc?export=view&id=${driveResponse.data.id}`,
      fileId: driveResponse.data.id,
      fileName,
      createdAt: new Date().toISOString(),
      createdBy: req.user.id
    });

    res.redirect('/admin/khs/list?success=uploaded');
  } catch (error) {
    console.error('Error upload KHS:', error);
    res.redirect('/admin/khs/upload?error=Gagal upload: ' + error.message);
  }
});

// ============================================================================
// DETAIL KHS
// ============================================================================

/**
 * GET /admin/khs/:id
 * Menampilkan detail KHS
 */
router.get('/:id', async (req, res) => {
  try {
    const khsDoc = await db.collection('khs').doc(req.params.id).get();
    if (!khsDoc.exists) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan',
        message: 'KHS tidak ditemukan'
      });
    }
    const khs = { id: khsDoc.id, ...khsDoc.data() };

    // Ambil data mahasiswa
    const mahasiswaDoc = await db.collection('users').doc(khs.userId).get();
    const mahasiswa = mahasiswaDoc.exists ? mahasiswaDoc.data() : { nama: '-', nim: '-' };

    res.render('admin/khs_detail', {
      title: `Detail KHS - ${mahasiswa.nama}`,
      khs,
      mahasiswa
    });
  } catch (error) {
    console.error('Error detail KHS:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat detail KHS'
    });
  }
});

// ============================================================================
// HAPUS KHS
// ============================================================================

/**
 * POST /admin/khs/delete/:id
 * Menghapus KHS dan file di Drive
 */
router.post('/delete/:id', async (req, res) => {
  try {
    const khsDoc = await db.collection('khs').doc(req.params.id).get();
    if (!khsDoc.exists) {
      return res.status(404).send('KHS tidak ditemukan');
    }
    const khs = khsDoc.data();

    // Hapus file di Drive jika ada
    if (khs.fileId) {
      try {
        await drive.files.delete({ fileId: khs.fileId });
      } catch (err) {
        console.error('Gagal hapus file Drive:', err.message);
      }
    }

    // Hapus dokumen
    await db.collection('khs').doc(req.params.id).delete();

    res.redirect('/admin/khs/list?success=deleted');
  } catch (error) {
    console.error('Error delete KHS:', error);
    res.status(500).send('Gagal menghapus KHS');
  }
});

module.exports = router;