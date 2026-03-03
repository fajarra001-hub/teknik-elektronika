/**
 * routes/dosen/magang.js
 * Monitoring magang untuk dosen (hanya lihat logbook mahasiswa)
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
 * Format tanggal ke format Indonesia
 */
function formatDate(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Ambil data mahasiswa dari ID
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
// DAFTAR MAHASISWA YANG MENGIKUTI PDK YANG DIAMPU DOSEN
// ============================================================================

router.get('/', async (req, res) => {
  try {
    // 1. Ambil semua mata kuliah PDK yang diampu oleh dosen ini
    const mkSnapshot = await db.collection('mataKuliah')
      .where('dosenIds', 'array-contains', req.dosen.id)
      .where('isPDK', '==', true)
      .get();

    const pdkIds = mkSnapshot.docs.map(doc => doc.id);

    if (pdkIds.length === 0) {
      return res.render('dosen/magang_list', {
        title: 'Monitoring Magang',
        mahasiswaList: [],
        message: 'Anda belum mengampu mata kuliah PDK.'
      });
    }

    // 2. Ambil semua enrollment aktif untuk mata kuliah PDK tersebut
    const enrollmentSnapshot = await db.collection('enrollment')
      .where('mkId', 'in', pdkIds)
      .where('status', '==', 'active')
      .get();

    // Kumpulkan userId unik
    const userIds = [...new Set(enrollmentSnapshot.docs.map(doc => doc.data().userId))];

    // 3. Ambil data mahasiswa dan statistik
    const mahasiswaList = [];
    for (const userId of userIds) {
      const mhs = await getMahasiswa(userId);
      // Hitung jumlah entri logbook untuk mahasiswa ini
      const logbookSnapshot = await db.collection('logbookMagang')
        .where('userId', '==', userId)
        .get();
      const totalLogbook = logbookSnapshot.size;
      // Hitung jumlah pending (opsional)
      const pendingSnapshot = await db.collection('logbookMagang')
        .where('userId', '==', userId)
        .where('status', '==', 'pending')
        .get();
      const pendingCount = pendingSnapshot.size;

      mahasiswaList.push({
        ...mhs,
        totalLogbook,
        pendingCount
      });
    }

    res.render('dosen/magang_list', {
      title: 'Monitoring Magang',
      mahasiswaList,
      message: null
    });
  } catch (error) {
    console.error('Error ambil daftar mahasiswa:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat data mahasiswa' });
  }
});

// ============================================================================
// DETAIL LOGBOOK MAHASISWA (read-only)
// ============================================================================

router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const mahasiswa = await getMahasiswa(userId);

    // Ambil semua logbook milik mahasiswa ini, urut tanggal descending
    const logbookSnapshot = await db.collection('logbookMagang')
      .where('userId', '==', userId)
      .orderBy('tanggal', 'desc')
      .get();

    const logbookList = logbookSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        tanggalFormatted: formatDate(data.tanggal)
      };
    });

    res.render('dosen/magang_detail', {
      title: `Logbook - ${mahasiswa.nama}`,
      mahasiswa,
      logbookList
    });
  } catch (error) {
    console.error('Error ambil logbook mahasiswa:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat logbook' });
  }
});
// ============================================================================
// CETAK LOGBOOK MAHASISWA (DOSEN)
// ============================================================================
router.get('/print/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { semester } = req.query;
    const mahasiswa = await getMahasiswa(userId);

    let query = db.collection('logbookMagang')
      .where('userId', '==', userId)
      .orderBy('tanggal', 'asc');

    if (semester) {
      query = query.where('semester', '==', semester);
    }

    const snapshot = await query.get();
    const logbookList = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        ...data,
        tanggalFormatted: formatDate(data.tanggal)
      };
    });

    const totalDurasi = logbookList.reduce((sum, item) => sum + (parseFloat(item.durasi) || 0), 0);

    const filterInfo = semester ? `Semester: ${semester}` : 'Semua Semester';

    res.render('dosen/magang_print', {
      title: `Cetak Logbook - ${mahasiswa.nama}`,
      mahasiswa,
      logbookList,
      totalDurasi,
      filterInfo,
      generatedAt: new Date().toLocaleString('id-ID')
    });
  } catch (error) {
    console.error('Error print logbook dosen:', error);
    res.status(500).send('Gagal mencetak logbook');
  }
});
module.exports = router;