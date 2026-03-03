/**
 * routes/mahasiswa/tracer.js
 * Modul Tracer Study Mahasiswa/Lulusan: Survey keberkerjaan, upload foto tempat kerja
 */

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive');
const { Readable } = require('stream');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// Semua route memerlukan autentikasi
router.use(verifyToken);

// ============================================================================
// FUNGSI BANTU
// ============================================================================

/**
 * Mendapatkan ID folder foto tracer study di Google Drive
 * Membuat folder jika belum ada
 */
async function getTracerFotoFolderId() {
  const folderName = 'Tracer_Foto';
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
// CEK STATUS SURVEY & TAMPILKAN FORM ATAU HASIL
// ============================================================================

/**
 * GET /mahasiswa/tracer
 * Menampilkan halaman tracer study: jika sudah mengisi, tampilkan hasil; jika belum, tampilkan form
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const tracerDoc = await db.collection('tracerStudy').doc(userId).get();

    if (tracerDoc.exists) {
      // Sudah mengisi, tampilkan data
      const data = tracerDoc.data();
      res.render('mahasiswa/tracer/hasil', {
        title: 'Hasil Tracer Study',
        user: req.user,
        data
      });
    } else {
      // Belum mengisi, tampilkan form
      res.render('mahasiswa/tracer/form', {
        title: 'Tracer Study',
        user: req.user
      });
    }
  } catch (error) {
    console.error('Error memuat tracer study:', error);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Gagal memuat halaman tracer study' 
    });
  }
});

// ============================================================================
// SIMPAN DATA SURVEY
// ============================================================================

/**
 * POST /mahasiswa/tracer
 * Menyimpan data tracer study (tanpa foto, foto diupload terpisah)
 */
router.post('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      pekerjaan, tempatKerja, alamatKerja, gaji,
      tanggalMulai, statusPekerjaan, bidang, namaPerusahaan
    } = req.body;

    // Validasi minimal
    if (!pekerjaan || !tempatKerja || !statusPekerjaan) {
      return res.status(400).send('Pekerjaan, tempat kerja, dan status pekerjaan wajib diisi');
    }

    const data = {
      userId,
      nim: req.user.nim,
      nama: req.user.nama,
      pekerjaan,
      tempatKerja,
      alamatKerja: alamatKerja || '',
      gaji: gaji || '',
      tanggalMulai: tanggalMulai || null,
      statusPekerjaan,
      bidang: bidang || '',
      namaPerusahaan: namaPerusahaan || tempatKerja,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await db.collection('tracerStudy').doc(userId).set(data);
    res.redirect('/mahasiswa/tracer');
  } catch (error) {
    console.error('Error menyimpan tracer study:', error);
    res.status(500).send('Gagal menyimpan data');
  }
});

// ============================================================================
// UPLOAD FOTO TEMPAT KERJA
// ============================================================================

/**
 * POST /mahasiswa/tracer/foto
 * Upload foto tempat kerja ke Google Drive dan simta URL di Firestore
 */
router.post('/foto', upload.single('foto'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).send('Tidak ada file yang diupload');
    }

    // Dapatkan folder foto tracer (buat jika belum ada)
    const folderId = await getTracerFotoFolderId();

    // Upload ke Google Drive
    const fileName = `Tracer_${req.user.nim}_${Date.now()}.${file.originalname.split('.').pop()}`;
    const fileMetadata = { name: fileName, parents: [folderId] };
    const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
    const response = await drive.files.create({
      resource: fileMetadata,
      media,
      fields: 'id, webViewLink'
    });

    // Beri akses publik (PENTING!)
    await drive.permissions.create({
      fileId: response.data.id,
      requestBody: {
        role: 'reader',
        type: 'anyone'
      }
    });

    // Simpan URL publik ke Firestore (gunakan set dengan merge agar data lain tidak hilang)
    const directLink = `https://drive.google.com/uc?export=view&id=${response.data.id}`;
    await db.collection('tracerStudy').doc(req.user.id).set({
      fotoUrl: directLink,
      fotoId: response.data.id,
      updatedAt: new Date().toISOString()
    }, { merge: true });

    res.redirect('/mahasiswa/tracer');
  } catch (error) {
    console.error('Error upload foto:', error);
    res.status(500).send('Gagal upload foto');
  }
});

// ============================================================================
// HAPUS FOTO
// ============================================================================

/**
 * POST /mahasiswa/tracer/foto/hapus
 * Menghapus foto tempat kerja dari Drive dan Firestore
 */
router.post('/foto/hapus', async (req, res) => {
  try {
    const userId = req.user.id;
    const tracerDoc = await db.collection('tracerStudy').doc(userId).get();
    if (!tracerDoc.exists) {
      return res.status(404).send('Data tidak ditemukan');
    }

    const data = tracerDoc.data();
    if (data.fotoId) {
      try {
        await drive.files.delete({ fileId: data.fotoId });
      } catch (err) {
        console.error('Gagal hapus file dari Drive:', err);
      }
      await db.collection('tracerStudy').doc(userId).update({
        fotoUrl: null,
        fotoId: null,
        updatedAt: new Date().toISOString()
      });
    }
    res.redirect('/mahasiswa/tracer');
  } catch (error) {
    console.error('Error hapus foto tracer:', error);
    res.status(500).send('Gagal hapus foto');
  }
});

// ============================================================================
// EDIT DATA (jika ingin mengubah)
// ============================================================================

/**
 * GET /mahasiswa/tracer/edit
 * Menampilkan form edit data tracer study
 */
router.get('/edit', async (req, res) => {
  try {
    const userId = req.user.id;
    const tracerDoc = await db.collection('tracerStudy').doc(userId).get();
    if (!tracerDoc.exists) {
      return res.redirect('/mahasiswa/tracer'); // jika belum ada, ke form awal
    }
    const data = tracerDoc.data();
    res.render('mahasiswa/tracer/form_edit', {
      title: 'Edit Tracer Study',
      user: req.user,
      data
    });
  } catch (error) {
    console.error('Error memuat form edit:', error);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Gagal memuat form edit' 
    });
  }
});

/**
 * POST /mahasiswa/tracer/edit
 * Menyimpan perubahan data tracer study
 */
router.post('/edit', async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      pekerjaan, tempatKerja, alamatKerja, gaji,
      tanggalMulai, statusPekerjaan, bidang, namaPerusahaan
    } = req.body;

    if (!pekerjaan || !tempatKerja || !statusPekerjaan) {
      return res.status(400).send('Pekerjaan, tempat kerja, dan status pekerjaan wajib diisi');
    }

    const updateData = {
      pekerjaan,
      tempatKerja,
      alamatKerja: alamatKerja || '',
      gaji: gaji || '',
      tanggalMulai: tanggalMulai || null,
      statusPekerjaan,
      bidang: bidang || '',
      namaPerusahaan: namaPerusahaan || tempatKerja,
      updatedAt: new Date().toISOString()
    };

    await db.collection('tracerStudy').doc(userId).update(updateData);
    res.redirect('/mahasiswa/tracer');
  } catch (error) {
    console.error('Error update tracer study:', error);
    res.status(500).send('Gagal mengupdate data');
  }
});

module.exports = router;