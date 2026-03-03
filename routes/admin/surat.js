/**
 * routes/admin/surat.js
 * Manajemen surat mahasiswa (admin dapat upload file surat)
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

async function getMahasiswa(userId) {
  const userDoc = await db.collection('users').doc(userId).get();
  if (userDoc.exists) {
    return { id: userId, ...userDoc.data() };
  }
  return { id: userId, nama: 'Unknown', nim: '-' };
}

async function getSuratFolderId() {
  const folderName = 'Surat_Mahasiswa';
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

// ============================================================================
// DAFTAR SURAT
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const { status, search } = req.query;
    let query = db.collection('surat').orderBy('createdAt', 'desc');
    if (status) query = query.where('status', '==', status);
    const snapshot = await query.get();

    const suratList = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const mahasiswa = await getMahasiswa(data.userId);
      // Filter search manual (nama atau keperluan)
      if (search) {
        const lower = search.toLowerCase();
        if (!mahasiswa.nama.toLowerCase().includes(lower) && !data.keperluan.toLowerCase().includes(lower)) continue;
      }
      suratList.push({
        id: doc.id,
        ...data,
        mahasiswa
      });
    }

    res.render('admin/surat/index', {
      title: 'Manajemen Surat',
      suratList,
      filters: { status, search }
    });
  } catch (error) {
  console.error('Error ambil surat:', error);
  res.status(500).render('error', { 
    title: 'Error', 
    message: 'Gagal memuat daftar surat' 
  });
}
});

// ============================================================================
// DETAIL SURAT
// ============================================================================

router.get('/:id', async (req, res) => {
  try {
    const doc = await db.collection('surat').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).send('Surat tidak ditemukan');
    const surat = { id: doc.id, ...doc.data() };
    const mahasiswa = await getMahasiswa(surat.userId);

    res.render('admin/surat/detail', {
      title: `Detail Surat - ${mahasiswa.nama}`,
      surat,
      mahasiswa
    });
  } catch (error) {
    console.error('Error detail surat:', error);
    res.status(500).render('error', { message: 'Gagal memuat detail surat' });
  }
});

// ============================================================================
// UPLOAD FILE SURAT (selesai)
// ============================================================================

router.post('/:id/upload', upload.single('file'), async (req, res) => {
  try {
    const suratId = req.params.id;
    const file = req.file;
    if (!file) return res.status(400).send('File tidak ada');

    const suratRef = db.collection('surat').doc(suratId);
    const suratDoc = await suratRef.get();
    if (!suratDoc.exists) return res.status(404).send('Surat tidak ditemukan');
    const surat = suratDoc.data();

    // Upload ke Drive
    const folderId = await getSuratFolderId();
    const fileName = `Surat_${surat.jenis}_${surat.userId}_${Date.now()}.pdf`;
    const fileMetadata = { name: fileName, parents: [folderId] };
    const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
    const driveResponse = await drive.files.create({ resource: fileMetadata, media, fields: 'id, webViewLink' });
    await drive.permissions.create({ fileId: driveResponse.data.id, requestBody: { role: 'reader', type: 'anyone' } });
    const fileUrl = `https://drive.google.com/uc?export=view&id=${driveResponse.data.id}`;

    // Update status surat
    await suratRef.update({
      status: 'completed',
      fileUrl,
      fileId: driveResponse.data.id,
      updatedAt: new Date().toISOString(),
      history: [
        ...(surat.history || []),
        {
          status: 'completed',
          timestamp: new Date().toISOString(),
          catatan: 'Surat telah diupload oleh Kaprodi'
        }
      ]
    });

    res.redirect(`/admin/surat/${suratId}`);
  } catch (error) {
    console.error('Error upload surat:', error);
    res.status(500).send('Gagal upload surat');
  }
});

// ============================================================================
// TOLAK SURAT (dengan alasan)
// ============================================================================

router.post('/:id/reject', async (req, res) => {
  try {
    const { alasan } = req.body;
    if (!alasan) return res.status(400).send('Alasan penolakan harus diisi');

    const suratRef = db.collection('surat').doc(req.params.id);
    const suratDoc = await suratRef.get();
    if (!suratDoc.exists) return res.status(404).send('Surat tidak ditemukan');
    const surat = suratDoc.data();

    await suratRef.update({
      status: 'rejected',
      alasanPenolakan: alasan,
      updatedAt: new Date().toISOString(),
      history: [
        ...(surat.history || []),
        {
          status: 'rejected',
          timestamp: new Date().toISOString(),
          catatan: `Ditolak: ${alasan}`
        }
      ]
    });

    res.redirect(`/admin/surat/${req.params.id}`);
  } catch (error) {
    console.error('Error reject surat:', error);
    res.status(500).send('Gagal menolak surat');
  }
});

module.exports = router;