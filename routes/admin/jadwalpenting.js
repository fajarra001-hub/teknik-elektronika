// routes/admin/jadwalpenting.js
const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');

router.use(verifyToken);
router.use(isAdmin);

// Helper untuk format tanggal
function formatDate(date) {
  if (!date) return '';
  if (date instanceof Date) return date.toISOString().split('T')[0];
  return date;
}

// Daftar semua jadwal
router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('jadwalPenting')
      .orderBy('tanggal', 'desc')
      .get();
    const jadwal = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    res.render('admin/jadwalpenting', { 
      title: 'Kelola Jadwal Penting',
      jadwal,
      success: req.query.success 
    });
  } catch (error) {
    console.error('Error mengambil jadwal:', error);
    res.status(500).render('admin/error', { message: 'Gagal mengambil data jadwal' });
  }
});

// Form tambah jadwal
router.get('/create', (req, res) => {
  res.render('admin/jadwalpenting_form', { 
    title: 'Tambah Jadwal Penting',
    jadwal: null 
  });
});

// Simpan jadwal baru
router.post('/', async (req, res) => {
  try {
    const { judul, deskripsi, tanggal, waktu, tempat, kategori } = req.body;
    
    if (!judul || !tanggal) {
      return res.status(400).send('Judul dan tanggal wajib diisi');
    }

    await db.collection('jadwalPenting').add({
      judul,
      deskripsi: deskripsi || '',
      tanggal,
      waktu: waktu || '',
      tempat: tempat || '',
      kategori: kategori || 'umum',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    res.redirect('/admin/jadwalpenting?success=ditambahkan');
  } catch (error) {
    console.error('Error tambah jadwal:', error);
    res.status(500).send('Gagal menambah jadwal');
  }
});

// Form edit jadwal
router.get('/:id/edit', async (req, res) => {
  try {
    const doc = await db.collection('jadwalPenting').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).send('Jadwal tidak ditemukan');
    }
    const jadwal = { id: doc.id, ...doc.data() };
    // Format tanggal untuk input type date
    if (jadwal.tanggal) {
      jadwal.tanggal = jadwal.tanggal.split('T')[0];
    }
    res.render('admin/jadwalpenting_form', { 
      title: 'Edit Jadwal Penting',
      jadwal 
    });
  } catch (error) {
    console.error('Error ambil jadwal:', error);
    res.status(500).render('admin/error', { message: 'Gagal mengambil data jadwal' });
  }
});

// Update jadwal
router.post('/:id/update', async (req, res) => {
  try {
    const { judul, deskripsi, tanggal, waktu, tempat, kategori } = req.body;
    
    if (!judul || !tanggal) {
      return res.status(400).send('Judul dan tanggal wajib diisi');
    }

    await db.collection('jadwalPenting').doc(req.params.id).update({
      judul,
      deskripsi: deskripsi || '',
      tanggal,
      waktu: waktu || '',
      tempat: tempat || '',
      kategori: kategori || 'umum',
      updatedAt: new Date().toISOString()
    });

    res.redirect('/admin/jadwalpenting?success=diupdate');
  } catch (error) {
    console.error('Error update jadwal:', error);
    res.status(500).send('Gagal update jadwal');
  }
});

// Hapus jadwal
router.post('/:id/delete', async (req, res) => {
  try {
    await db.collection('jadwalPenting').doc(req.params.id).delete();
    res.redirect('/admin/jadwalpenting?success=dihapus');
  } catch (error) {
    console.error('Error hapus jadwal:', error);
    res.status(500).send('Gagal hapus jadwal');
  }
});

module.exports = router;