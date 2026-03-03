/**
 * routes/admin/dosen.js
 * Kelola data dosen (CRUD + upload foto + mata kuliah)
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive');
const { Readable } = require('stream');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// Middleware autentikasi (sudah diterapkan di index.js, namun untuk keamanan tambahan)
router.use(verifyToken);
router.use(isAdmin);

// ============================================================================
// FUNGSI BANTU (HELPER)
// ============================================================================

/**
 * Mendapatkan ID folder foto dosen di Google Drive.
 * Membuat folder jika belum ada.
 */
async function getDosenFotoFolderId() {
  const folderName = 'Foto_Dosen';
  const query = await drive.files.list({
    q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
  });
  if (query.data.files.length > 0) {
    return query.data.files[0].id;
  } else {
    const folder = await drive.files.create({
      resource: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
      },
      fields: 'id',
    });
    return folder.data.id;
  }
}

// ============================================================================
// RUTE CRUD
// ============================================================================

/**
 * GET /admin/dosen
 * Menampilkan daftar semua dosen.
 */
router.get('/', async (req, res) => {
  try {
    const dosenSnapshot = await db.collection('dosen').orderBy('nama').get();
    const dosen = dosenSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('admin/dosen_list', { title: 'Kelola Dosen', dosen });
  } catch (error) {
    console.error('Error mengambil data dosen:', error);
    res.status(500).render('error', { message: 'Gagal mengambil data dosen' });
  }
});

/**
 * GET /admin/dosen/create
 * Form tambah dosen.
 */
router.get('/create', async (req, res) => {
  try {
    const mkSnapshot = await db.collection('mataKuliah').orderBy('kode').get();
    const mkList = mkSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('admin/dosen_form', { title: 'Tambah Dosen', dosen: null, mkList });
  } catch (error) {
    console.error('Error memuat form tambah dosen:', error);
    res.status(500).render('error', { message: 'Gagal memuat form' });
  }
});

/**
 * POST /admin/dosen
 * Menyimpan dosen baru.
 */
router.post('/', upload.single('foto'), async (req, res) => {
  try {
    const { nip, nama, kontak, email, mataKuliahIds } = req.body;
    const file = req.file;

    if (!nip || !nama || !email) {
      return res.status(400).send('NIP, Nama, dan Email wajib diisi');
    }

    // Proses mata kuliah (bisa array atau string)
    let mkIds = [];
    if (mataKuliahIds) {
      mkIds = Array.isArray(mataKuliahIds) ? mataKuliahIds : [mataKuliahIds];
    }

    let fotoUrl = null, fotoFileId = null;
    if (file) {
      const folderId = await getDosenFotoFolderId();
      const fileName = `${nip}_${Date.now()}.${file.originalname.split('.').pop()}`;
      const fileMetadata = { name: fileName, parents: [folderId] };
      const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
      const response = await drive.files.create({
        resource: fileMetadata,
        media,
        fields: 'id, webViewLink',
      });
      fotoUrl = response.data.webViewLink;
      fotoFileId = response.data.id;
    }

    await db.collection('dosen').add({
      nip,
      nama,
      kontak,
      email,
      foto: fotoUrl,
      fotoFileId,
      mataKuliahIds: mkIds,
      createdAt: new Date().toISOString(),
    });

    res.redirect('/admin/dosen');
  } catch (error) {
    console.error('Error menambah dosen:', error);
    res.status(500).send('Gagal menambah dosen: ' + error.message);
  }
});

/**
 * GET /admin/dosen/:id/edit
 * Form edit dosen.
 */
router.get('/:id/edit', async (req, res) => {
  try {
    const dosenDoc = await db.collection('dosen').doc(req.params.id).get();
    if (!dosenDoc.exists) {
      return res.status(404).send('Dosen tidak ditemukan');
    }
    const dosen = { id: dosenDoc.id, ...dosenDoc.data() };
    const mkSnapshot = await db.collection('mataKuliah').orderBy('kode').get();
    const mkList = mkSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('admin/dosen_form', { title: 'Edit Dosen', dosen, mkList });
  } catch (error) {
    console.error('Error memuat form edit dosen:', error);
    res.status(500).render('error', { message: 'Gagal memuat form edit' });
  }
});

/**
 * POST /admin/dosen/:id/update
 * Memperbarui data dosen.
 */
router.post('/:id/update', upload.single('foto'), async (req, res) => {
  try {
    const { nip, nama, kontak, email, mataKuliahIds } = req.body;
    const file = req.file;
    const dosenRef = db.collection('dosen').doc(req.params.id);
    const dosenDoc = await dosenRef.get();

    if (!dosenDoc.exists) {
      return res.status(404).send('Dosen tidak ditemukan');
    }
    const oldData = dosenDoc.data();

    let mkIds = [];
    if (mataKuliahIds) {
      mkIds = Array.isArray(mataKuliahIds) ? mataKuliahIds : [mataKuliahIds];
    }

    const updateData = {
      nip,
      nama,
      kontak,
      email,
      mataKuliahIds: mkIds,
      updatedAt: new Date().toISOString(),
    };

    if (file) {
      const folderId = await getDosenFotoFolderId();
      const fileName = `${nip}_${Date.now()}.${file.originalname.split('.').pop()}`;
      const fileMetadata = { name: fileName, parents: [folderId] };
      const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
      const response = await drive.files.create({
        resource: fileMetadata,
        media,
        fields: 'id, webViewLink',
      });
      updateData.foto = response.data.webViewLink;
      updateData.fotoFileId = response.data.id;

      // Hapus foto lama
      if (oldData.fotoFileId) {
        try {
          await drive.files.delete({ fileId: oldData.fotoFileId });
        } catch (err) {
          console.error('Gagal hapus foto lama:', err);
        }
      }
    }

    await dosenRef.update(updateData);
    res.redirect('/admin/dosen');
  } catch (error) {
    console.error('Error update dosen:', error);
    res.status(500).send('Gagal update dosen: ' + error.message);
  }
});

/**
 * POST /admin/dosen/:id/delete
 * Menghapus dosen beserta foto di Drive.
 */
router.post('/:id/delete', async (req, res) => {
  try {
    const dosenRef = db.collection('dosen').doc(req.params.id);
    const dosenDoc = await dosenRef.get();
    if (!dosenDoc.exists) {
      return res.status(404).send('Dosen tidak ditemukan');
    }
    const data = dosenDoc.data();

    if (data.fotoFileId) {
      try {
        await drive.files.delete({ fileId: data.fotoFileId });
      } catch (err) {
        console.error('Gagal hapus foto dosen:', err);
      }
    }

    await dosenRef.delete();
    res.redirect('/admin/dosen');
  } catch (error) {
    console.error('Error hapus dosen:', error);
    res.status(500).send('Gagal hapus dosen: ' + error.message);
  }
});

module.exports = router;