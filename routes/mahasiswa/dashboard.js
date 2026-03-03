/**
 * routes/mahasiswa/dashboard.js
 * Dashboard utama mahasiswa
 */

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');

// Semua route memerlukan autentikasi
router.use(verifyToken);

// ============================================================================
// FUNGSI BANTU
// ============================================================================

/**
 * Mendapatkan daftar tagihan SPP mahasiswa dari collection tagihan
 * @param {string} userId - UID mahasiswa
 * @returns {Promise<Array>} daftar tagihan per semester
 */
async function getTagihan(userId) {
  try {
    const tagihanDoc = await db.collection('tagihan').doc(userId).get();
    if (tagihanDoc.exists) {
      return tagihanDoc.data().semester || [];
    }
    return [];
  } catch (error) {
    console.error('Error getTagihan:', error);
    return [];
  }
}

/**
 * Mendapatkan mata kuliah yang diambil mahasiswa (dari enrollment aktif)
 * @param {string} userId - UID mahasiswa
 * @returns {Promise<Array>} daftar mata kuliah dengan detail
 */
async function getMataKuliahDiambil(userId) {
  try {
    const enrollmentSnapshot = await db.collection('enrollment')
      .where('userId', '==', userId)   // ← perbaikan: gunakan userId
      .where('status', '==', 'active')
      .get();

    const mkList = [];
    for (const doc of enrollmentSnapshot.docs) {
      const data = doc.data();
      const mkId = data.mkId;
      const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
      if (mkDoc.exists) {
        mkList.push({
          id: mkId,
          ...mkDoc.data(),
          enrollmentId: doc.id,
          semesterEnrollment: data.semester,
          tahunAjaran: data.tahunAjaran
        });
      }
    }
    return mkList;
  } catch (error) {
    console.error('Error getMataKuliahDiambil:', error);
    return [];
  }
}

/**
 * Menghitung pertemuan terkini untuk suatu mata kuliah berdasarkan materi
 * @param {Object} mk - data mata kuliah (dengan field materi)
 * @returns {number} jumlah pertemuan yang sudah selesai
 */
function getPertemuanTerkini(mk) {
  if (!mk.materi || !Array.isArray(mk.materi)) return 0;
  // Hitung yang statusnya 'selesai'
  const selesai = mk.materi.filter(m => m.status === 'selesai').length;
  return selesai;
}

/**
 * Mendapatkan daftar tugas aktif untuk mahasiswa (berdasarkan MK yang diambil)
 * @param {Array} mkIds - daftar ID mata kuliah
 * @returns {Promise<Array>} daftar tugas dengan deadline > sekarang
 */
async function getTugasAktif(mkIds) {
  try {
    if (mkIds.length === 0) return [];
    const now = new Date().toISOString();
    const tugasList = [];

    // Karena Firestore tidak mendukung 'in' dengan lebih dari 10 nilai, kita loop
    // Alternatif: query per MK, tapi ini ok untuk jumlah MK terbatas
    for (const mkId of mkIds) {
      const snapshot = await db.collection('tugas')
        .where('mkId', '==', mkId)
        .where('deadline', '>', now)
        .orderBy('deadline', 'asc')
        .get();
      snapshot.docs.forEach(doc => {
        tugasList.push({ id: doc.id, ...doc.data() });
      });
    }
    return tugasList;
  } catch (error) {
    console.error('Error getTugasAktif:', error);
    return [];
  }
}

/**
 * Mendapatkan semester aktif saat ini (bisa dari konfigurasi atau perhitungan tanggal)
 * @returns {string} label semester aktif
 */
function getSemesterAktif() {
  // Sementara hardcoded, nanti bisa diambil dari koleksi config
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-12
  if (month >= 1 && month <= 6) {
    return `Genap ${year-1}/${year}`;
  } else {
    return `Ganjil ${year}/${year+1}`;
  }
}

// ============================================================================
// RUTE UTAMA DASHBOARD
// ============================================================================

/**
 * GET /mahasiswa/dashboard
 * Menampilkan dashboard mahasiswa
 */
router.get('/', async (req, res) => {
  try {
    const user = req.user;
    const userId = user.id;

    // Ambil tagihan SPP
    const tagihan = await getTagihan(userId);

    // Ambil mata kuliah yang diambil
    const mkList = await getMataKuliahDiambil(userId);
    const mkIds = mkList.map(mk => mk.id);

    // Hitung total SKS yang diambil
    const totalSks = mkList.reduce((acc, mk) => acc + (mk.sks || 0), 0);

    // Ambil tugas aktif
    const tugasAktif = await getTugasAktif(mkIds);

    // Semester sekarang
    const semesterSekarang = getSemesterAktif();

    // Hitung rata-rata pertemuan terkini
    let pertemuanRata = 0;
    if (mkList.length > 0) {
      const totalPertemuan = mkList.reduce((acc, mk) => acc + getPertemuanTerkini(mk), 0);
      pertemuanRata = Math.round(totalPertemuan / mkList.length);
    }

    // Log untuk debugging (opsional)
    console.log(`Dashboard untuk ${user.nama}: ${mkList.length} MK, ${tugasAktif.length} tugas aktif`);

    res.render('mahasiswa/dashboard', {
      user,
      uploadSuccess: req.query.upload === 'success', // untuk notifikasi upload KRS
      tagihan,
      totalSks,
      semesterSekarang,
      pertemuanRata,
      tugasAktif
    });

  } catch (error) {
    console.error('Error loading mahasiswa dashboard:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat dashboard mahasiswa'
    });
  }
});

module.exports = router;