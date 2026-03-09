// routes/admin/laporanMagang.js
const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');

router.use(verifyToken);
router.use(isAdmin);

// Fungsi bantu untuk mendapatkan data mahasiswa dari ID
async function getMahasiswaById(userId) {
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists) {
      return { id: userDoc.id, ...userDoc.data() };
    }
    return { id: userId, nama: 'Unknown', nim: '-' };
  } catch (error) {
    console.error('Error getMahasiswaById:', error);
    return { id: userId, nama: 'Error', nim: '-' };
  }
}

// ============================================================================
// REKAP LAPORAN PER MAHASISWA (halaman grup)
// ============================================================================
router.get('/rekap', async (req, res) => {
  try {
    const snapshot = await db.collection('laporanMagang').get();
    const laporanList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Kelompokkan berdasarkan userId
    const grouped = {};
    for (const laporan of laporanList) {
      if (!grouped[laporan.userId]) {
        grouped[laporan.userId] = [];
      }
      grouped[laporan.userId].push(laporan);
    }

    // Ambil data mahasiswa untuk setiap userId
    const groupedList = [];
    for (const userId in grouped) {
      const mahasiswa = await getMahasiswaById(userId);
      groupedList.push({
        mahasiswa,
        laporan: grouped[userId]
      });
    }

    // Urutkan berdasarkan nama mahasiswa
    groupedList.sort((a, b) => a.mahasiswa.nama.localeCompare(b.mahasiswa.nama));

    res.render('admin/laporan_list', { // sesuaikan dengan nama file view yang benar
      title: 'Rekap Laporan Magang',
      groupedList
    });
  } catch (error) {
    console.error('Error ambil rekap laporan:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat rekap laporan' });
  }
});

// ============================================================================
// DETAIL LAPORAN PER MAHASISWA
// ============================================================================
router.get('/mahasiswa/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    // ambil data mahasiswa
    const mahasiswaDoc = await db.collection('users').doc(userId).get();
    if (!mahasiswaDoc.exists) {
      return res.status(404).render('error', { title: 'Error', message: 'Mahasiswa tidak ditemukan' });
    }
    const mahasiswa = { id: userId, ...mahasiswaDoc.data() };

    // ambil semua laporan milik mahasiswa ini
    const snapshot = await db.collection('laporanMagang')
      .where('userId', '==', userId)
      .orderBy('laporanKe', 'asc')
      .get();
    const laporanList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    res.render('admin/laporan_detail', {
      title: `Laporan Magang - ${mahasiswa.nama}`,
      mahasiswa,
      laporanList,
      success: req.query.success
    });
  } catch (error) {
    console.error('Error detail laporan:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat detail laporan' });
  }
});

// ============================================================================
// UPDATE STATUS LAPORAN (beserta catatan)
// ============================================================================
// routes/admin/laporanMagang.js
router.post('/:id/status', async (req, res) => {
  try {
    const { status, catatan } = req.body;
    const docRef = db.collection('laporanMagang').doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).send('Laporan tidak ditemukan');
    const userId = doc.data().userId;

    const updateData = {
      status,
      catatanAdmin: catatan || '',
      updatedAt: new Date().toISOString()
    };

    // Jika status menjadi 'approved', tambahkan approvedAt
    if (status === 'approved') {
      updateData.approvedAt = new Date().toISOString();
    } else {
      // Jika status bukan approved, hapus approvedAt (opsional, agar tidak muncul di library)
      updateData.approvedAt = null;
    }

    await docRef.update(updateData);
    res.redirect(`/admin/laporan-magang/mahasiswa/${userId}?success=updated`);
  } catch (error) {
    console.error('Error update status:', error);
    res.status(500).send('Gagal update status');
  }
});

// ============================================================================
// HAPUS LAPORAN (sudah ada, pastikan pathnya konsisten)
// ============================================================================
router.post('/:id/delete', async (req, res) => {
  try {
    const docRef = db.collection('laporanMagang').doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).send('Laporan tidak ditemukan');
    const userId = doc.data().userId;
    const data = doc.data();

    // Hapus file di Drive jika ada
    if (data.fileId) {
      try {
        await drive.files.delete({ fileId: data.fileId });
      } catch (err) {
        console.error('Gagal hapus file Drive:', err);
      }
    }

    await docRef.delete();
    res.redirect(`/admin/laporan-magang/mahasiswa/${userId}?success=deleted`);
  } catch (error) {
    console.error('Error hapus laporan:', error);
    res.status(500).send('Gagal hapus laporan');
  }
});
// ============================================================================
// PROSES PERSETUJUAN
// ============================================================================
router.post('/:id/approve', async (req, res) => {
  try {
    const { judulPublik, abstrak, pembimbing, tahun } = req.body;
    if (!judulPublik || !abstrak) {
      return res.status(400).send('Judul publik dan abstrak wajib diisi');
    }
    await db.collection('laporanMagang').doc(req.params.id).update({
      judulPublik,
      abstrak,
      pembimbing: pembimbing || '',
      tahun: parseInt(tahun) || new Date().getFullYear(),
      status: 'approved',
      approvedAt: new Date().toISOString(),
      approvedBy: req.user.id
    });
    res.redirect('/admin/laporan-magang?success=approved');
  } catch (error) {
    console.error('Error approve laporan:', error);
    res.status(500).send('Gagal menyetujui laporan');
  }
});

module.exports = router;