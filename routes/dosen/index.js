/**
 * routes/dosen/index.js
 * 
 * File utama untuk semua rute dosen.
 * Menggabungkan semua sub‑modul dosen (dashboard, biodata, elearning, dll.)
 * serta menambahkan middleware autentikasi dan error handling.
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isDosen } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const laporanMagangRouter = require('./laporanMagang');
const seminarRouter = require('./seminar');
// ============================================================================
// MIDDLEWARE UMUM UNTUK SEMUA RUTE DOSEN
// ============================================================================

// Pastikan semua rute di sini hanya bisa diakses oleh dosen yang sudah login
router.use(verifyToken);
router.use(isDosen);

// Middleware untuk menyediakan data user ke semua view dosen (opsional)
router.use((req, res, next) => {
  res.locals.user = req.user;   // agar bisa diakses di semua template tanpa passing ulang
  next();
});

// ============================================================================
// IMPORT SUB‑MODUL ROUTE DOSEN
// ============================================================================

// Dashboard – ringkasan mata kuliah, tugas, mahasiswa
router.use('/dashboard', require('./dashboard'));
router.use('/laporan-magang', laporanMagangRouter);
router.use('/seminar', seminarRouter);

// Monitoring Magang
router.use('/magang', require('./magang'));
// Biodata – lihat dan edit profil, foto, kontak, ubah password
router.use('/biodata', require('./biodata'));
// Kelola Tugas
router.use('/tugas', require('./tugas'));
// E‑Learning – kelola pertemuan, tugas, nilai per mata kuliah
router.use('/elearning', require('./elearning'));
router.use('/mk', require('./mk'));
// Kurikulum – lihat daftar mata kuliah prodi (read‑only)
router.use('/kurikulum', require('./kurikulum'));
router.use('/nilai', require('./nilai'));
// Mahasiswa Bimbingan – daftar mahasiswa dari MK yang diampu
router.use('/mahasiswa', require('./mahasiswa'));

// Rekap dan Input Nilai – kelola nilai tugas, UTS, UAS
router.use('/nilai', require('./nilai'));

// ============================================================================
// RUTE UTAMA DOSEN
// ============================================================================

/**
 * GET /dosen
 * Halaman utama dashboard dosen – diarahkan ke /dosen/dashboard
 */
router.get('/', (req, res) => {
  res.redirect('/dosen/dashboard');
});

// Untuk kompatibilitas dengan tautan lama, arahkan /dosen/dashboard ke sub‑modul (sudah ditangani di atas)
// Tidak perlu tambahan karena sudah di‑mount
// ============================================================================
// KELOLA TUGAS (tanpa melalui elearning)
// ============================================================================

// Daftar semua tugas yang dibuat dosen ini
router.get('/tugas', async (req, res) => {
  try {
    const snapshot = await db.collection('tugas')
      .where('dosenId', '==', req.dosen.id)
      .orderBy('deadline', 'desc')
      .get();

    const tugasList = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        mkKode: data.mkKode || '?', // bisa diisi dari data MK jika perlu
        mkNama: data.mkNama || '?'
      };
    });

    res.render('dosen/tugas_list', {
      title: 'Daftar Tugas',
      tugasList
    });
  } catch (error) {
    console.error('Error ambil tugas:', error);
    // Tangani error indeks
    if (error.code === 9) {
      return res.status(500).render('error', {
        title: 'Error',
        message: 'Database memerlukan indeks. Silakan hubungi admin atau buat indeks.'
      });
    }
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal mengambil tugas'
    });
  }
});

// Form buat tugas baru
router.get('/tugas/create', async (req, res) => {
  try {
    // Ambil mata kuliah yang diampu dosen ini untuk dropdown
    const mkSnapshot = await db.collection('mataKuliah')
      .where('dosenIds', 'array-contains', req.dosen.id)
      .orderBy('kode')
      .get();

    const mkList = mkSnapshot.docs.map(doc => ({
      id: doc.id,
      kode: doc.data().kode,
      nama: doc.data().nama
    }));

    res.render('dosen/tugas_form', {
      title: 'Buat Tugas Baru',
      mkList,
      tugas: null
    });
  } catch (error) {
    console.error('Error load form tugas:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat form'
    });
  }
});

// Proses simpan tugas baru (POST)
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const { Readable } = require('stream');
const drive = require('../../config/googleDrive');

router.post('/tugas', upload.single('file'), async (req, res) => {
  try {
    const { mkId, judul, deskripsi, deadline, tipe } = req.body;
    const file = req.file;

    if (!mkId || !judul || !deadline) {
      return res.status(400).send('MK, judul, dan deadline wajib diisi');
    }

    // Ambil data MK untuk mendapatkan kode dan nama
    const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
    if (!mkDoc.exists) return res.status(404).send('MK tidak ditemukan');
    const mkData = mkDoc.data();

    let fileUrl = null, fileId = null;
    if (file) {
      // Upload ke Drive (sederhana, bisa dikembangkan)
      const fileName = `${judul.replace(/\s+/g, '_')}_${Date.now()}.pdf`;
      const fileMetadata = { name: fileName };
      const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
      const response = await drive.files.create({
        resource: fileMetadata,
        media,
        fields: 'id, webViewLink'
      });
      await drive.permissions.create({
        fileId: response.data.id,
        requestBody: { role: 'reader', type: 'anyone' }
      });
      fileUrl = `https://drive.google.com/uc?export=view&id=${response.data.id}`;
      fileId = response.data.id;
    }

    await db.collection('tugas').add({
      mkId,
      mkKode: mkData.kode,
      mkNama: mkData.nama,
      dosenId: req.dosen.id,
      judul,
      deskripsi: deskripsi || '',
      deadline: new Date(deadline).toISOString(),
      tipe: tipe || 'tugas',
      fileUrl,
      fileId,
      createdAt: new Date().toISOString()
    });

    res.redirect('/dosen/tugas');
  } catch (error) {
    console.error('Error buat tugas:', error);
    res.status(500).send('Gagal membuat tugas');
  }
});

// Detail tugas (jika belum ada)
// GET /dosen/tugas/:id
router.get('/tugas/:id', async (req, res) => {
  try {
    const tugasDoc = await db.collection('tugas').doc(req.params.id).get();
    if (!tugasDoc.exists) return res.status(404).send('Tugas tidak ditemukan');
    const tugas = { id: tugasDoc.id, ...tugasDoc.data() };

    // Ambil daftar mahasiswa yang terdaftar di MK ini (dari enrollment aktif)
    const enrollmentSnapshot = await db.collection('enrollment')
      .where('mkId', '==', tugas.mkId)
      .where('status', '==', 'active')
      .get();

    const mahasiswaIds = enrollmentSnapshot.docs.map(d => d.data().userId);
    const mahasiswaList = [];
    for (const uid of mahasiswaIds) {
      const userDoc = await db.collection('users').doc(uid).get();
      if (userDoc.exists) {
        const m = userDoc.data();
        // Cek pengumpulan untuk tugas ini
        const pengumpulanSnapshot = await db.collection('pengumpulan')
          .where('tugasId', '==', tugas.id)
          .where('mahasiswaId', '==', uid)
          .limit(1)
          .get();
        const pengumpulan = pengumpulanSnapshot.empty ? null : { id: pengumpulanSnapshot.docs[0].id, ...pengumpulanSnapshot.docs[0].data() };
        mahasiswaList.push({
          id: uid,
          nim: m.nim,
          nama: m.nama,
          pengumpulan
        });
      }
    }

    res.render('dosen/tugas_detail', {
      title: tugas.judul,
      tugas,
      mahasiswaList
    });
  } catch (error) {
    console.error('Error detail tugas:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat detail tugas' });
  }
});

// Beri nilai (POST)
// POST /dosen/pengumpulan/nilai
router.post('/pengumpulan/nilai', async (req, res) => {
  try {
    const { pengumpulanId, nilai, komentar } = req.body;
    if (!pengumpulanId) {
      return res.status(400).send('ID pengumpulan tidak ditemukan');
    }

    // Ambil data pengumpulan untuk mendapatkan tugasId
    const pengumpulanDoc = await db.collection('pengumpulan').doc(pengumpulanId).get();
    if (!pengumpulanDoc.exists) {
      return res.status(404).send('Pengumpulan tidak ditemukan');
    }
    const tugasId = pengumpulanDoc.data().tugasId;

    // Update nilai
    await db.collection('pengumpulan').doc(pengumpulanId).update({
      nilai: parseFloat(nilai),
      komentar,
      status: 'dinilai',
      dinilaiPada: new Date().toISOString()
    });

    // Redirect ke halaman detail tugas
    res.redirect(`/dosen/tugas/${tugasId}`);
  } catch (error) {
    console.error('Error memberi nilai:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memberi nilai'
    });
  }
});
// ============================================================================
// PENANGANAN ERROR KHUSUS DOSEN
// ============================================================================

// 404 – Rute tidak ditemukan di bawah /dosen
router.use((req, res, next) => {
  res.status(404).render('admin/404', { title: 'Halaman Tidak Ditemukan' });
});

// Error handler untuk rute dosen (menangkap error dari semua sub‑modul)
router.use((err, req, res, next) => {
  console.error('❌ Dosen error:', err.stack);

  // Jika response sudah dikirim, serahkan ke error handler default Express
  if (res.headersSent) {
    return next(err);
  }

  // Tampilkan halaman error yang sesuai
  res.status(err.status || 500);
  res.render('admin/error', {
    title: 'Terjadi Kesalahan',
    message: err.message || 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err : {}   // tampilkan stack hanya di dev
  });
});

// ============================================================================
// EKSPOR ROUTER
// ============================================================================
console.log('Dosen index.js loaded, submodules: dashboard, biodata, elearning, kurikulum, mahasiswa, nilai, mk');
module.exports = router;