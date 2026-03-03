/**
 * routes/admin/berita.js
 * Kelola Berita Prodi - CRUD lengkap dengan upload gambar ke Google Drive
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive');
const { Readable } = require('stream');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// Middleware autentikasi
router.use(verifyToken);
router.use(isAdmin);

// ============================================================================
// FUNGSI BANTU
// ============================================================================

/**
 * Mendapatkan ID folder gambar berita di Google Drive.
 * Membuat folder jika belum ada.
 */
async function getBeritaGambarFolderId() {
  const folderName = 'Gambar_Berita';
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
// DAFTAR BERITA
// ============================================================================

/**
 * GET /admin/berita
 * Menampilkan semua berita (terbaru di atas)
 */
router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('berita').orderBy('tanggal', 'desc').get();
    const berita = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('admin/berita', { title: 'Kelola Berita', berita, success: req.query.success });
  } catch (error) {
    console.error('Error mengambil berita:', error);
    res.status(500).render('error', { message: 'Gagal mengambil data berita' });
  }
});

// ============================================================================
// TAMBAH BERITA
// ============================================================================

/**
 * GET /admin/berita/create
 * Form tambah berita
 */
router.get('/create', (req, res) => {
  res.render('admin/berita_form', { title: 'Tambah Berita', berita: null, action: 'tambah' });
});

/**
 * POST /admin/berita
 * Simpan berita baru (dengan upload gambar opsional)
 */
router.post('/', upload.single('gambar'), async (req, res) => {
  try {
    const { judul, isi, penulis, sumber } = req.body;
    const file = req.file;

    if (!judul || !isi) {
      return res.status(400).send('Judul dan isi berita wajib diisi');
    }

    let gambarUrl = null, gambarFileId = null;
    if (file) {
      const folderId = await getBeritaGambarFolderId();
      const fileName = `${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`;
      const fileMetadata = { name: fileName, parents: [folderId] };
      const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
      const response = await drive.files.create({
        resource: fileMetadata,
        media,
        fields: 'id, webViewLink',
      });
      gambarUrl = response.data.webViewLink;
      gambarFileId = response.data.id;
    }

    await db.collection('berita').add({
      judul,
      isi,
      penulis: penulis || req.user.nama || 'Admin',
      sumber: sumber || '',
      gambar: gambarUrl,
      gambarFileId,
      tanggal: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    res.redirect('/admin/berita?success=ditambahkan');
  } catch (error) {
    console.error('Error tambah berita:', error);
    res.status(500).send('Gagal menambah berita');
  }
});

// ============================================================================
// EDIT BERITA
// ============================================================================

/**
 * GET /admin/berita/:id/edit
 * Form edit berita
 */
router.get('/:id/edit', async (req, res) => {
  try {
    const doc = await db.collection('berita').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).send('Berita tidak ditemukan');
    }
    const berita = { id: doc.id, ...doc.data() };
    res.render('admin/berita_form', { title: 'Edit Berita', berita, action: 'edit' });
  } catch (error) {
    console.error('Error ambil berita:', error);
    res.status(500).render('error', { message: 'Gagal mengambil data berita' });
  }
});

/**
 * POST /admin/berita/:id/update
 * Update berita (dengan upload gambar baru opsional)
 */
router.post('/:id/update', upload.single('gambar'), async (req, res) => {
  try {
    const { judul, isi, penulis, sumber } = req.body;
    const file = req.file;
    const docRef = db.collection('berita').doc(req.params.id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).send('Berita tidak ditemukan');
    }
    const oldData = doc.data();

    const updateData = {
      judul,
      isi,
      penulis: penulis || oldData.penulis,
      sumber: sumber || '',
      updatedAt: new Date().toISOString()
    };

    if (file) {
      // Hapus gambar lama jika ada
      if (oldData.gambarFileId) {
        try {
          await drive.files.delete({ fileId: oldData.gambarFileId });
        } catch (err) {
          console.error('Gagal hapus gambar lama:', err);
        }
      }
      const folderId = await getBeritaGambarFolderId();
      const fileName = `${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`;
      const fileMetadata = { name: fileName, parents: [folderId] };
      const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
      const response = await drive.files.create({
        resource: fileMetadata,
        media,
        fields: 'id, webViewLink',
      });
      updateData.gambar = response.data.webViewLink;
      updateData.gambarFileId = response.data.id;
    }

    await docRef.update(updateData);
    res.redirect('/admin/berita?success=diupdate');
  } catch (error) {
    console.error('Error update berita:', error);
    res.status(500).send('Gagal update berita');
  }
});

// ============================================================================
// HAPUS BERITA
// ============================================================================

/**
 * POST /admin/berita/:id/delete
 * Hapus berita beserta gambar di Drive
 */
router.post('/:id/delete', async (req, res) => {
  try {
    const docRef = db.collection('berita').doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).send('Berita tidak ditemukan');
    }
    const data = doc.data();

    if (data.gambarFileId) {
      try {
        await drive.files.delete({ fileId: data.gambarFileId });
      } catch (err) {
        console.error('Gagal hapus gambar berita:', err);
      }
    }

    await docRef.delete();
    res.redirect('/admin/berita?success=dihapus');
  } catch (error) {
    console.error('Error hapus berita:', error);
    res.status(500).send('Gagal hapus berita');
  }
});

module.exports = router;