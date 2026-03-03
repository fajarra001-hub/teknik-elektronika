/**
 * routes/dosen/laporanMagang.js
 * Dosen melihat laporan magang mahasiswa (read-only)
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isDosen } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');

router.use(verifyToken);
router.use(isDosen);

// ============================================================================
// FUNGSI BANTU
// ============================================================================

async function getMahasiswa(userId) {
  try {
    const doc = await db.collection('users').doc(userId).get();
    if (doc.exists) {
      return { id: doc.id, ...doc.data() };
    }
    return { id: userId, nama: 'Unknown', nim: '-' };
  } catch (error) {
    console.error('Error getMahasiswa:', error);
    return { id: userId, nama: 'Error', nim: '-' };
  }
}

// ============================================================================
// DAFTAR LAPORAN
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('laporanMagang').orderBy('uploadedAt', 'desc').get();
    const laporanList = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const mahasiswa = await getMahasiswa(data.userId);
      laporanList.push({
        id: doc.id,
        ...data,
        mahasiswa
      });
    }
    res.render('dosen/laporan_list', {
      title: 'Laporan Magang Mahasiswa',
      laporanList
    });
  } catch (error) {
    console.error('Error ambil laporan:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat daftar laporan'
    });
  }
});

// ============================================================================
// DETAIL LAPORAN
// ============================================================================

router.get('/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const laporanDoc = await db.collection('laporanMagang').doc(userId).get();
    if (!laporanDoc.exists) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan',
        message: 'Laporan tidak ditemukan'
      });
    }
    const laporan = laporanDoc.data();
    const mahasiswa = await getMahasiswa(userId);
    res.render('dosen/laporan_detail', {
      title: `Laporan Magang - ${mahasiswa.nama}`,
      laporan,
      mahasiswa
    });
  } catch (error) {
    console.error('Error detail laporan:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat detail laporan'
    });
  }
});

module.exports = router;