/**
 * routes/dosen/laporanMagang.js
 * Monitoring laporan magang mahasiswa untuk dosen
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

/**
 * Ambil data mahasiswa dari koleksi users
 */
async function getMahasiswa(userId) {
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists) {
      return { id: userDoc.id, ...userDoc.data() };
    }
    return { id: userId, nama: 'Unknown', nim: '-' };
  } catch (error) {
    console.error('Error getMahasiswa:', error);
    return { id: userId, nama: 'Error', nim: '-' };
  }
}

// ============================================================================
// DAFTAR MAHASISWA DENGAN LAPORAN MAGANG
// ============================================================================

router.get('/', async (req, res) => {
  try {
    // Ambil semua laporan magang (koleksi laporanMagang)
    const laporanSnapshot = await db.collection('laporanMagang').get();
    
    // Kelompokkan berdasarkan userId
    const grouped = {};
    for (const doc of laporanSnapshot.docs) {
      const data = doc.data();
      const userId = data.userId;
      if (!grouped[userId]) {
        grouped[userId] = {
          mahasiswa: await getMahasiswa(userId),
          laporan: []
        };
      }
      grouped[userId].laporan.push({
        id: doc.id,
        ...data
      });
    }

    // Ubah objek menjadi array untuk view
    const groupedList = Object.values(grouped);

    res.render('dosen/laporan_list', {
      title: 'Laporan Magang Mahasiswa',
      groupedList
    });
  } catch (error) {
    console.error('Error mengambil laporan magang:', error);
    res.status(500).render('error', { message: 'Gagal memuat data laporan' });
  }
});

// ============================================================================
// DETAIL LAPORAN PER MAHASISWA
// ============================================================================

router.get('/mahasiswa/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const mahasiswa = await getMahasiswa(userId);

    const laporanSnapshot = await db.collection('laporanMagang')
      .where('userId', '==', userId)
      .get();

    const laporanList = laporanSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    res.render('dosen/laporan_detail', {
      title: `Laporan - ${mahasiswa.nama}`,
      mahasiswa,
      laporanList
    });
  } catch (error) {
    console.error('Error mengambil detail laporan:', error);
    res.status(500).render('error', { message: 'Gagal memuat detail laporan' });
  }
});

module.exports = router;