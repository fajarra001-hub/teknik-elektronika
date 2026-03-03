/**
 * routes/admin/berkas.js
 * Berkas Akademik - Lihat KRS & KHS per angkatan dan per mahasiswa
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
 * Mendapatkan angkatan dari NIM
 * @param {string} nim 
 * @returns {string} tahun angkatan (contoh: "2024")
 */
function getAngkatanFromNim(nim) {
  if (!nim || nim.length < 2) return 'Unknown';
  return '20' + nim.substring(0, 2);
}

// ============================================================================
// RUTE UTAMA – DAFTAR MAHASISWA DENGAN FILTER
// ============================================================================

/**
 * GET /admin/berkas
 * Menampilkan daftar mahasiswa beserta info KRS/KHS
 */
router.get('/', async (req, res) => {
  try {
    const { angkatan, search } = req.query;

    // Ambil semua mahasiswa
    const mahasiswaSnapshot = await db.collection('users')
      .where('role', '==', 'mahasiswa')
      .orderBy('nim')
      .get();

    const mahasiswaList = [];
    const angkatanSet = new Set();

    for (const doc of mahasiswaSnapshot.docs) {
      const m = { id: doc.id, ...doc.data() };
      const nim = m.nim || '';
      const angkatanMhs = getAngkatanFromNim(nim);
      angkatanSet.add(angkatanMhs);

      // Filter berdasarkan angkatan
      if (angkatan && angkatanMhs !== angkatan) continue;

      // Filter berdasarkan search (nama atau nim)
      if (search) {
        const lowerSearch = search.toLowerCase();
        const matchNama = m.nama && m.nama.toLowerCase().includes(lowerSearch);
        const matchNim = m.nim && m.nim.includes(search);
        if (!matchNama && !matchNim) continue;
      }

      // Hitung jumlah KRS dan KHS (contoh sederhana, asumsi ada field jumlah atau kita query manual)
      // Untuk efisiensi, kita bisa menyimpan hitungan di database atau query manual.
      // Di sini kita asumsikan kita punya field krsCount dan khsCount di users, atau kita query.
      // Sementara kita set 0.
      m.krsCount = 0;
      m.khsCount = 0;

      mahasiswaList.push(m);
    }

    const angkatanList = Array.from(angkatanSet).sort().reverse();

    res.render('admin/berkas_index', {
      title: 'Berkas Akademik',
      mahasiswaList,
      angkatanList,
      filterAngkatan: angkatan || '',
      search: search || ''
    });
  } catch (error) {
    console.error('Error memuat berkas:', error);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Gagal memuat data' 
    });
  }
});

// ============================================================================
// DAFTAR MAHASISWA PER ANGKATAN (alternatif, bisa diarahkan ke sini)
// ============================================================================

/**
 * GET /admin/berkas/angkatan/:tahun
 * Menampilkan daftar mahasiswa dalam angkatan tertentu
 */
router.get('/angkatan/:tahun', async (req, res) => {
  try {
    const { tahun } = req.params;
    const duaDigit = tahun.slice(-2); // ambil "24" dari "2024"

    // Ambil mahasiswa dengan NIM diawali dua digit tersebut
    const mahasiswaSnapshot = await db.collection('users')
      .where('role', '==', 'mahasiswa')
      .orderBy('nim')
      .get();

    const mahasiswaList = [];
    mahasiswaSnapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.nim && data.nim.startsWith(duaDigit)) {
        mahasiswaList.push({ id: doc.id, ...data });
      }
    });

    res.render('admin/berkas_angkatan', {
      title: `Mahasiswa Angkatan ${tahun}`,
      tahun,
      mahasiswa: mahasiswaList
    });
  } catch (error) {
    console.error('Error memuat mahasiswa per angkatan:', error);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Gagal memuat data mahasiswa' 
    });
  }
});

// ============================================================================
// DETAIL BERKAS MAHASISWA (KRS & KHS)
// ============================================================================

/**
 * GET /admin/berkas/mahasiswa/:id
 * Menampilkan semua KRS dan KHS milik seorang mahasiswa
 */
router.get('/mahasiswa/:id', async (req, res) => {
  try {
    const mahasiswaId = req.params.id;

    // Data mahasiswa
    const mahasiswaDoc = await db.collection('users').doc(mahasiswaId).get();
    if (!mahasiswaDoc.exists) {
      return res.status(404).render('error', { 
        title: 'Tidak Ditemukan', 
        message: 'Mahasiswa tidak ditemukan' 
      });
    }
    const mahasiswa = { id: mahasiswaDoc.id, ...mahasiswaDoc.data() };

    // Ambil KRS mahasiswa (dari koleksi krs)
    const krsSnapshot = await db.collection('krs')
      .where('userId', '==', mahasiswaId)
      .orderBy('createdAt', 'desc')
      .get();
    const krsList = krsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Ambil KHS mahasiswa (dari koleksi khs)
    const khsSnapshot = await db.collection('khs')
      .where('userId', '==', mahasiswaId)
      .orderBy('semester', 'asc')
      .get();
    const khsList = khsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.render('admin/berkas_mahasiswa', {
      title: `Berkas Mahasiswa: ${mahasiswa.nama}`,
      mahasiswa,
      krsList,
      khsList
    });
  } catch (error) {
    console.error('Error memuat berkas mahasiswa:', error);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Gagal memuat berkas mahasiswa' 
    });
  }
});

// ============================================================================
// LIHAT DETAIL KRS
// ============================================================================

/**
 * GET /admin/berkas/krs/:id
 * Menampilkan detail KRS tertentu
 */
router.get('/krs/:id', async (req, res) => {
  try {
    const krsDoc = await db.collection('krs').doc(req.params.id).get();
    if (!krsDoc.exists) {
      return res.status(404).render('error', { 
        title: 'Tidak Ditemukan', 
        message: 'KRS tidak ditemukan' 
      });
    }
    const krs = { id: krsDoc.id, ...krsDoc.data() };

    // Ambil data mahasiswa
    const mahasiswaDoc = await db.collection('users').doc(krs.userId).get();
    const mahasiswa = mahasiswaDoc.exists ? mahasiswaDoc.data() : { nama: '-', nim: '-' };

    // Ambil detail mata kuliah yang diambil
    const mkIds = krs.mataKuliah || []; // asumsi field mataKuliah berisi array ID MK
    const mkList = [];
    for (const mkId of mkIds) {
      const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
      if (mkDoc.exists) {
        mkList.push({ id: mkId, ...mkDoc.data() });
      }
    }

    res.render('admin/berkas_krs_detail', {
      title: `Detail KRS - ${mahasiswa.nama}`,
      krs,
      mahasiswa,
      mkList  // <-- PASTIKAN INI DIKIRIM
    });
  } catch (error) {
    console.error('Error detail KRS:', error);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Gagal memuat detail KRS' 
    });
  }
});

// ============================================================================
// LIHAT DETAIL KHS
// ============================================================================

/**
 * GET /admin/berkas/khs/:id
 * Menampilkan detail KHS
 */
router.get('/khs/:id', async (req, res) => {
  try {
    const khsDoc = await db.collection('khs').doc(req.params.id).get();
    if (!khsDoc.exists) {
      return res.status(404).render('error', { 
        title: 'Tidak Ditemukan', 
        message: 'KHS tidak ditemukan' 
      });
    }
    const khs = { id: khsDoc.id, ...khsDoc.data() };

    // Ambil data mahasiswa
    const mahasiswaDoc = await db.collection('users').doc(khs.userId).get();
    const mahasiswa = mahasiswaDoc.exists ? mahasiswaDoc.data() : { nama: '-', nim: '-' };

    res.render('admin/berkas_khs_detail', {
      title: `Detail KHS - ${mahasiswa.nama}`,
      khs,
      mahasiswa
    });
  } catch (error) {
    console.error('Error mengambil detail KHS:', error);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Gagal memuat detail KHS' 
    });
  }
});

module.exports = router;