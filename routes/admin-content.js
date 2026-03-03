/**
 * routes/admin-content.js
 * Mengelola konten landing page: aktivitas, berita, statistik, seminar, jadwal penting, track lulusan, dll.
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middleware/auth');
const { db } = require('../config/firebaseAdmin');
const drive = require('../config/googleDrive');
const { Readable } = require('stream');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// Semua route di sini hanya bisa diakses admin
router.use(verifyToken);
router.use(isAdmin);

// ============================================================================
// FUNGSI BANTU UNTUK FOLDER DRIVE
// ============================================================================

async function getFolderId(folderName) {
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
// KELOLA AKTIVITAS PRODI
// ============================================================================

router.get('/aktivitas', async (req, res) => {
  try {
    const snapshot = await db.collection('aktivitas').orderBy('tanggal', 'desc').get();
    const aktivitas = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('admin/aktivitas_list', { title: 'Kelola Aktivitas', aktivitas, success: req.query.success });
  } catch (error) {
    console.error(error);
    res.status(500).render('admin/error', { message: 'Gagal memuat aktivitas' });
  }
});

router.get('/aktivitas/create', (req, res) => {
  res.render('admin/aktivitas_form', { title: 'Tambah Aktivitas', aktivitas: null });
});

router.post('/aktivitas', upload.single('gambar'), async (req, res) => {
  try {
    const { judul, deskripsi, konten, kategori, tanggal, lokasi } = req.body;
    const file = req.file;
    
    let gambarUrl = null;
    if (file) {
      const folderId = await getFolderId('Gambar_Aktivitas');
      const fileName = `${Date.now()}_${file.originalname}`;
      const fileMetadata = { name: fileName, parents: [folderId] };
      const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
      const response = await drive.files.create({
        resource: fileMetadata,
        media,
        fields: 'id, webViewLink'
      });
      gambarUrl = response.data.webViewLink;
    }

    await db.collection('aktivitas').add({
      judul,
      deskripsi,
      konten,
      kategori,
      tanggal,
      lokasi,
      gambar: gambarUrl,
      createdAt: new Date().toISOString()
    });

    res.redirect('/admin-content/aktivitas?success=ditambahkan');
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal menambah aktivitas');
  }
});

router.get('/aktivitas/edit/:id', async (req, res) => {
  try {
    const doc = await db.collection('aktivitas').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).send('Aktivitas tidak ditemukan');
    const aktivitas = { id: doc.id, ...doc.data() };
    res.render('admin/aktivitas_form', { title: 'Edit Aktivitas', aktivitas });
  } catch (error) {
    console.error(error);
    res.status(500).render('admin/error', { message: 'Gagal memuat aktivitas' });
  }
});

router.post('/aktivitas/update/:id', upload.single('gambar'), async (req, res) => {
  try {
    const { judul, deskripsi, konten, kategori, tanggal, lokasi } = req.body;
    const file = req.file;
    const docRef = db.collection('aktivitas').doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).send('Aktivitas tidak ditemukan');
    
    const oldData = doc.data();
    const updateData = {
      judul,
      deskripsi,
      konten,
      kategori,
      tanggal,
      lokasi,
      updatedAt: new Date().toISOString()
    };

    if (file) {
      const folderId = await getFolderId('Gambar_Aktivitas');
      const fileName = `${Date.now()}_${file.originalname}`;
      const fileMetadata = { name: fileName, parents: [folderId] };
      const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
      const response = await drive.files.create({
        resource: fileMetadata,
        media,
        fields: 'id, webViewLink'
      });
      updateData.gambar = response.data.webViewLink;
      // Jika ada fileId lama, hapus? Tidak kita lakukan untuk sederhana.
    } else {
      updateData.gambar = oldData.gambar;
    }

    await docRef.update(updateData);
    res.redirect('/admin-content/aktivitas?success=diupdate');
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal update aktivitas');
  }
});

router.post('/aktivitas/delete/:id', async (req, res) => {
  try {
    await db.collection('aktivitas').doc(req.params.id).delete();
    res.redirect('/admin-content/aktivitas?success=dihapus');
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal hapus aktivitas');
  }
});

// ============================================================================
// KELOLA BERITA
// ============================================================================

router.get('/berita', async (req, res) => {
  try {
    const snapshot = await db.collection('berita').orderBy('tanggal', 'desc').get();
    const berita = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('admin/berita', { title: 'Kelola Berita', berita, success: req.query.success });
  } catch (error) {
    console.error(error);
    res.status(500).render('admin/error', { message: 'Gagal memuat berita' });
  }
});

// GET form tambah berita
router.get('/berita/create', (req, res) => {
  res.render('admin/berita_form', { 
    title: 'Tambah Berita', 
    berita: null,
    user: req.user   // <-- tambahkan ini
  });
});

// GET form edit berita
router.get('/berita/edit/:id', async (req, res) => {
  try {
    const doc = await db.collection('berita').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).send('Berita tidak ditemukan');
    const berita = { id: doc.id, ...doc.data() };
    res.render('admin/berita_form', { 
      title: 'Edit Berita', 
      berita,
      user: req.user   // <-- tambahkan ini
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal memuat form edit');
  }
});

router.post('/berita', upload.single('gambar'), async (req, res) => {
  try {
    const { judul, isi, penulis, sumber } = req.body;
    const file = req.file;

    let gambarUrl = null;
    if (file) {
      const folderId = await getFolderId('Gambar_Berita');
      const fileName = `${Date.now()}_${file.originalname}`;
      const fileMetadata = { name: fileName, parents: [folderId] };
      const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
      const response = await drive.files.create({
        resource: fileMetadata,
        media,
        fields: 'id, webViewLink'
      });
      gambarUrl = response.data.webViewLink;
    }

    await db.collection('berita').add({
      judul,
      isi,
      penulis: penulis || 'Admin',
      sumber: sumber || '',
      gambar: gambarUrl,
      tanggal: new Date().toISOString(),
      createdAt: new Date().toISOString()
    });

    res.redirect('/admin-content/berita?success=ditambahkan');
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal menambah berita');
  }
});

router.get('/berita/edit/:id', async (req, res) => {
  try {
    const doc = await db.collection('berita').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).send('Berita tidak ditemukan');
    const berita = { id: doc.id, ...doc.data() };
    res.render('admin/berita_form', { 
      title: 'Edit Berita', 
      berita,
      user: req.user   // <-- tambahkan ini
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal memuat form edit');
  }
});

router.post('/berita/update/:id', upload.single('gambar'), async (req, res) => {
  try {
    const { judul, isi, penulis, sumber } = req.body;
    const file = req.file;
    const docRef = db.collection('berita').doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).send('Berita tidak ditemukan');

    const oldData = doc.data();
    const updateData = {
      judul,
      isi,
      penulis,
      sumber,
      updatedAt: new Date().toISOString()
    };

    if (file) {
      const folderId = await getFolderId('Gambar_Berita');
      const fileName = `${Date.now()}_${file.originalname}`;
      const fileMetadata = { name: fileName, parents: [folderId] };
      const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
      const response = await drive.files.create({
        resource: fileMetadata,
        media,
        fields: 'id, webViewLink'
      });
      updateData.gambar = response.data.webViewLink;
      // Hapus gambar lama jika ada (opsional, butuh fileId)
    } else {
      updateData.gambar = oldData.gambar;
    }

    await docRef.update(updateData);
    res.redirect('/admin-content/berita?success=diupdate');
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal update berita');
  }
});

router.post('/berita/delete/:id', async (req, res) => {
  try {
    await db.collection('berita').doc(req.params.id).delete();
    res.redirect('/admin-content/berita?success=dihapus');
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal hapus berita');
  }
});

// ============================================================================
// KELOLA STATISTIK
// ============================================================================

router.get('/statistik', async (req, res) => {
  try {
    const doc = await db.collection('statistik').doc('data').get();
    const statistik = doc.exists ? doc.data() : {
      mahasiswaAktif: 0,
      mahasiswaMagang: 0,
      angkatan: []
    };
    res.render('admin/statistik', { title: 'Kelola Statistik', statistik, success: req.query.success });
  } catch (error) {
    console.error(error);
    res.status(500).render('admin/error', { message: 'Gagal memuat statistik' });
  }
});

router.post('/statistik', async (req, res) => {
  try {
    const { mahasiswaAktif, mahasiswaMagang, angkatan } = req.body;
    // angkatan dikirim sebagai JSON string
    let parsedAngkatan = [];
    if (angkatan) {
      parsedAngkatan = typeof angkatan === 'string' ? JSON.parse(angkatan) : angkatan;
    }
    await db.collection('statistik').doc('data').set({
      mahasiswaAktif: parseInt(mahasiswaAktif) || 0,
      mahasiswaMagang: parseInt(mahasiswaMagang) || 0,
      angkatan: parsedAngkatan
    });
    res.redirect('/admin-content/statistik?success=disimpan');
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal menyimpan statistik');
  }
});

// ============================================================================
// KELOLA SEMINAR
// ============================================================================

router.get('/seminar', async (req, res) => {
  try {
    const snapshot = await db.collection('seminar').orderBy('tanggal', 'asc').get();
    const seminar = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('admin/seminar', { title: 'Kelola Seminar', seminar, success: req.query.success });
  } catch (error) {
    console.error(error);
    res.status(500).render('admin/error', { message: 'Gagal memuat seminar' });
  }
});

router.get('/seminar/tambah', (req, res) => {
  res.render('admin/seminar_form', { title: 'Tambah Seminar', seminar: null });
});

router.post('/seminar', async (req, res) => {
  try {
    const { judul, tanggal, waktu, tempat, pemateri, deskripsi } = req.body;
    await db.collection('seminar').add({
      judul,
      tanggal,
      waktu,
      tempat,
      pemateri,
      deskripsi,
      createdAt: new Date().toISOString()
    });
    res.redirect('/admin-content/seminar?success=ditambahkan');
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal menambah seminar');
  }
});

router.get('/seminar/edit/:id', async (req, res) => {
  try {
    const doc = await db.collection('seminar').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).send('Seminar tidak ditemukan');
    const seminar = { id: doc.id, ...doc.data() };
    res.render('admin/seminar_form', { title: 'Edit Seminar', seminar });
  } catch (error) {
    console.error(error);
    res.status(500).render('admin/error', { message: 'Gagal memuat seminar' });
  }
});

router.post('/seminar/update/:id', async (req, res) => {
  try {
    const { judul, tanggal, waktu, tempat, pemateri, deskripsi } = req.body;
    await db.collection('seminar').doc(req.params.id).update({
      judul,
      tanggal,
      waktu,
      tempat,
      pemateri,
      deskripsi,
      updatedAt: new Date().toISOString()
    });
    res.redirect('/admin-content/seminar?success=diupdate');
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal update seminar');
  }
});

router.post('/seminar/hapus/:id', async (req, res) => {
  try {
    await db.collection('seminar').doc(req.params.id).delete();
    res.redirect('/admin-content/seminar?success=dihapus');
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal hapus seminar');
  }
});

// ============================================================================
// KELOLA JADWAL PENTING
// ============================================================================

router.get('/jadwalpenting', async (req, res) => {
  try {
    const snapshot = await db.collection('jadwalPenting').orderBy('tanggal', 'desc').get();
    const jadwal = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('admin/jadwalpenting', { title: 'Kelola Jadwal Penting', jadwal, success: req.query.success });
  } catch (error) {
    console.error(error);
    res.status(500).render('admin/error', { message: 'Gagal memuat jadwal' });
  }
});

router.get('/jadwalpenting/create', (req, res) => {
  res.render('admin/jadwalpenting_form', { title: 'Tambah Jadwal', jadwal: null });
});

router.post('/jadwalpenting', async (req, res) => {
  try {
    const { judul, deskripsi, tanggal, waktu, tempat, kategori } = req.body;
    await db.collection('jadwalPenting').add({
      judul,
      deskripsi,
      tanggal,
      waktu,
      tempat,
      kategori: kategori || 'umum',
      createdAt: new Date().toISOString()
    });
    res.redirect('/admin-content/jadwalpenting?success=ditambahkan');
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal menambah jadwal');
  }
});

router.get('/jadwalpenting/edit/:id', async (req, res) => {
  try {
    const doc = await db.collection('jadwalPenting').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).send('Jadwal tidak ditemukan');
    const jadwal = { id: doc.id, ...doc.data() };
    res.render('admin/jadwalpenting_form', { title: 'Edit Jadwal', jadwal });
  } catch (error) {
    console.error(error);
    res.status(500).render('admin/error', { message: 'Gagal memuat jadwal' });
  }
});

router.post('/jadwalpenting/update/:id', async (req, res) => {
  try {
    const { judul, deskripsi, tanggal, waktu, tempat, kategori } = req.body;
    await db.collection('jadwalPenting').doc(req.params.id).update({
      judul,
      deskripsi,
      tanggal,
      waktu,
      tempat,
      kategori,
      updatedAt: new Date().toISOString()
    });
    res.redirect('/admin-content/jadwalpenting?success=diupdate');
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal update jadwal');
  }
});

router.post('/jadwalpenting/delete/:id', async (req, res) => {
  try {
    await db.collection('jadwalPenting').doc(req.params.id).delete();
    res.redirect('/admin-content/jadwalpenting?success=dihapus');
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal hapus jadwal');
  }
});

// ============================================================================
// KELOLA TRACK LULUSAN
// ============================================================================

router.get('/tracklulusan', async (req, res) => {
  try {
    const snapshot = await db.collection('lulusan').orderBy('tahunLulus', 'desc').get();
    const lulusan = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('admin/tracklulusan', { title: 'Track Lulusan', lulusan, success: req.query.success });
  } catch (error) {
    console.error(error);
    res.status(500).render('admin/error', { message: 'Gagal memuat lulusan' });
  }
});

router.get('/tracklulusan/create', (req, res) => {
  res.render('admin/tracklulusan_form', { title: 'Tambah Lulusan', lulusan: null });
});

router.post('/tracklulusan', upload.single('foto'), async (req, res) => {
  try {
    const { nama, nim, tahunLulus, pekerjaan, tempatKerja, alamatKerja, gaji, status, email, noHp } = req.body;
    const file = req.file;

    let fotoUrl = null;
    if (file) {
      const folderId = await getFolderId('Foto_Lulusan');
      const fileName = `${nim}_${Date.now()}.${file.originalname.split('.').pop()}`;
      const fileMetadata = { name: fileName, parents: [folderId] };
      const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
      const response = await drive.files.create({
        resource: fileMetadata,
        media,
        fields: 'id, webViewLink'
      });
      fotoUrl = response.data.webViewLink;
    }

    await db.collection('lulusan').add({
      nama,
      nim,
      tahunLulus: parseInt(tahunLulus),
      pekerjaan,
      tempatKerja,
      alamatKerja,
      gaji,
      status,
      email,
      noHp,
      foto: fotoUrl,
      createdAt: new Date().toISOString()
    });

    res.redirect('/admin-content/tracklulusan?success=ditambahkan');
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal menambah lulusan');
  }
});

router.get('/tracklulusan/edit/:id', async (req, res) => {
  try {
    const doc = await db.collection('lulusan').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).send('Lulusan tidak ditemukan');
    const lulusan = { id: doc.id, ...doc.data() };
    res.render('admin/tracklulusan_form', { title: 'Edit Lulusan', lulusan });
  } catch (error) {
    console.error(error);
    res.status(500).render('admin/error', { message: 'Gagal memuat lulusan' });
  }
});

router.post('/tracklulusan/update/:id', upload.single('foto'), async (req, res) => {
  try {
    const { nama, nim, tahunLulus, pekerjaan, tempatKerja, alamatKerja, gaji, status, email, noHp } = req.body;
    const file = req.file;
    const docRef = db.collection('lulusan').doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).send('Lulusan tidak ditemukan');

    const oldData = doc.data();
    const updateData = {
      nama,
      nim,
      tahunLulus: parseInt(tahunLulus),
      pekerjaan,
      tempatKerja,
      alamatKerja,
      gaji,
      status,
      email,
      noHp,
      updatedAt: new Date().toISOString()
    };

    if (file) {
      const folderId = await getFolderId('Foto_Lulusan');
      const fileName = `${nim}_${Date.now()}.${file.originalname.split('.').pop()}`;
      const fileMetadata = { name: fileName, parents: [folderId] };
      const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
      const response = await drive.files.create({
        resource: fileMetadata,
        media,
        fields: 'id, webViewLink'
      });
      updateData.foto = response.data.webViewLink;
      // Hapus foto lama jika ada
      if (oldData.fotoFileId) {
        try { await drive.files.delete({ fileId: oldData.fotoFileId }); } catch (e) {}
      }
    } else {
      updateData.foto = oldData.foto;
    }

    await docRef.update(updateData);
    res.redirect('/admin-content/tracklulusan?success=diupdate');
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal update lulusan');
  }
});

router.post('/tracklulusan/delete/:id', async (req, res) => {
  try {
    const doc = await db.collection('lulusan').doc(req.params.id).get();
    if (doc.exists && doc.data().fotoFileId) {
      try { await drive.files.delete({ fileId: doc.data().fotoFileId }); } catch (e) {}
    }
    await db.collection('lulusan').doc(req.params.id).delete();
    res.redirect('/admin-content/tracklulusan?success=dihapus');
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal hapus lulusan');
  }
});

module.exports = router;