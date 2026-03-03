/**
 * routes/admin/nilai.js
 * Rekap Nilai Seluruh Mata Kuliah (Admin)
 * Menampilkan daftar MK, lalu detail nilai per MK
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');

router.use(verifyToken);
router.use(isAdmin);

// ============================================================================
// FUNGSI BANTU
// ============================================================================

/**
 * Mendapatkan data mahasiswa dari UID
 */
async function getMahasiswaById(uid) {
  try {
    const userDoc = await db.collection('users').doc(uid).get();
    if (userDoc.exists) {
      return { id: uid, ...userDoc.data() };
    }
    return { id: uid, nama: 'Unknown', nim: '-' };
  } catch (error) {
    console.error('Error getMahasiswaById:', error);
    return { id: uid, nama: 'Error', nim: '-' };
  }
}

/**
 * Menghitung nilai akhir berdasarkan bobot
 * Bobot: rata-rata tugas 40%, UTS 30%, UAS 30%
 * @param {Object} nilaiMap - map nilai dengan key tipe (misal 'Tugas 1', 'UTS', 'UAS')
 * @returns {number|null} nilai akhir
 */
function hitungNilaiAkhir(nilaiMap) {
  // Kumpulkan semua nilai tugas
  const tugasValues = [];
  let uts = null, uas = null;

  for (const [tipe, data] of Object.entries(nilaiMap)) {
    if (tipe.toLowerCase().includes('tugas')) {
      tugasValues.push(data.nilai);
    } else if (tipe.toUpperCase() === 'UTS') {
      uts = data.nilai;
    } else if (tipe.toUpperCase() === 'UAS') {
      uas = data.nilai;
    }
  }

  if (tugasValues.length === 0 || uts === null || uas === null) {
    return null; // belum lengkap
  }

  const rataTugas = tugasValues.reduce((a, b) => a + b, 0) / tugasValues.length;
  const nilaiAkhir = (rataTugas * 0.4) + (uts * 0.3) + (uas * 0.3);
  return Math.round(nilaiAkhir * 100) / 100; // dua desimal
}

// ============================================================================
// DAFTAR MATA KULIAH
// ============================================================================

/**
 * GET /admin/nilai
 * Menampilkan daftar semua mata kuliah
 */
router.get('/', async (req, res) => {
  try {
    const mkSnapshot = await db.collection('mataKuliah').orderBy('kode').get();
    const mkList = mkSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('admin/nilai_list', {
      title: 'Rekap Nilai',
      mkList
    });
  } catch (error) {
    console.error('Error mengambil MK:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat data MK' });
  }
});

// ============================================================================
// DETAIL NILAI PER MATA KULIAH
// ============================================================================

/**
 * GET /admin/nilai/:mkId
 * Menampilkan daftar mahasiswa beserta nilai tugas, UTS, UAS, dan nilai akhir
 */
router.get('/:mkId', async (req, res) => {
  try {
    const mkId = req.params.mkId;
    const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
    if (!mkDoc.exists) {
      return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Mata kuliah tidak ditemukan' });
    }
    const mk = { id: mkId, ...mkDoc.data() };

    // Ambil semua mahasiswa yang terdaftar di MK ini (dari enrollment aktif)
    const enrollmentSnapshot = await db.collection('enrollment')
      .where('mkId', '==', mkId)
      .where('status', '==', 'active')
      .get();

    const mahasiswaIds = enrollmentSnapshot.docs.map(d => d.data().userId);
    const mahasiswaList = [];

    for (const uid of mahasiswaIds) {
      const mahasiswa = await getMahasiswaById(uid);
      // Ambil semua nilai untuk MK dan mahasiswa ini
      const nilaiSnapshot = await db.collection('nilai')
        .where('mkId', '==', mkId)
        .where('mahasiswaId', '==', uid)
        .get();

      const nilaiMap = {};
      nilaiSnapshot.docs.forEach(doc => {
        const data = doc.data();
        nilaiMap[data.tipe] = data.nilai;
      });

      // Hitung nilai akhir
      const nilaiAkhir = hitungNilaiAkhir(nilaiMap);

      mahasiswaList.push({
        mahasiswa,
        nilai: nilaiMap,
        nilaiAkhir
      });
    }

    // Urutkan berdasarkan NIM
    mahasiswaList.sort((a, b) => a.mahasiswa.nim.localeCompare(b.mahasiswa.nim));

    // Kumpulkan semua tipe nilai yang ada (untuk header tabel)
    const tipeSet = new Set();
    mahasiswaList.forEach(item => {
      Object.keys(item.nilai).forEach(tipe => tipeSet.add(tipe));
    });
    const tipeList = Array.from(tipeSet).sort();

    res.render('admin/nilai_detail', {
      title: `Rekap Nilai - ${mk.kode} ${mk.nama}`,
      mk,
      mahasiswaList,
      tipeList
    });
  } catch (error) {
    console.error('Error detail nilai:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat detail nilai' });
  }
});

module.exports = router;