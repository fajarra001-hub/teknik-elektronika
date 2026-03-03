/**
 * routes/dosen/mahasiswa.js
 * Daftar mahasiswa bimbingan (mahasiswa yang mengambil mata kuliah yang diampu)
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
 * Mendapatkan semua mata kuliah yang diampu oleh dosen ini
 */
async function getMataKuliahDosen(dosenId) {
  const snapshot = await db.collection('mataKuliah')
    .where('dosenIds', 'array-contains', dosenId)
    .get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

/**
 * Mendapatkan daftar mahasiswa yang terdaftar pada suatu MK
 */
async function getMahasiswaByMkId(mkId) {
  const enrollmentSnapshot = await db.collection('enrollment')
    .where('mkId', '==', mkId)
    .get();
  const mahasiswaIds = enrollmentSnapshot.docs.map(d => d.data().mahasiswaId);
  const mahasiswaList = [];
  for (const uid of mahasiswaIds) {
    const userDoc = await db.collection('users').doc(uid).get();
    if (userDoc.exists) {
      mahasiswaList.push({ id: uid, ...userDoc.data() });
    }
  }
  return mahasiswaList;
}

// ============================================================================
// DAFTAR MAHASISWA
// ============================================================================

/**
 * GET /dosen/mahasiswa
 * Menampilkan semua mahasiswa dari semua MK yang diampu
 * Query params:
 *   - angkatan: filter berdasarkan angkatan (2 digit pertama NIM)
 *   - mkId: filter berdasarkan mata kuliah tertentu
 *   - search: pencarian nama/NIM
 */
router.get('/', async (req, res) => {
  try {
    const { angkatan, mkId, search } = req.query;
    const dosenId = req.user.id;

    // Ambil semua MK yang diampu
    const mkList = await getMataKuliahDosen(dosenId);
    const mkIds = mkList.map(mk => mk.id);

    if (mkIds.length === 0) {
      return res.render('dosen/mahasiswa_list', {
        title: 'Mahasiswa Bimbingan',
        mahasiswaList: [],
        mkList: [],
        filterMk: '',
        filterAngkatan: '',
        search: ''
      });
    }

    // Ambil semua enrollment untuk MK tersebut
    let enrollmentQuery = db.collection('enrollment')
      .where('mkId', 'in', mkIds);
    const enrollmentSnapshot = await enrollmentQuery.get();
    const mahasiswaIds = [...new Set(enrollmentSnapshot.docs.map(d => d.data().mahasiswaId))];

    // Ambil data mahasiswa
    const mahasiswaList = [];
    for (const uid of mahasiswaIds) {
      const userDoc = await db.collection('users').doc(uid).get();
      if (userDoc.exists) {
        const m = { id: uid, ...userDoc.data() };
        
        // Hitung angkatan dari NIM
        let angkatanMhs = '';
        if (m.nim && m.nim.length >= 2) {
          angkatanMhs = '20' + m.nim.substring(0, 2);
        }

        // Filter berdasarkan angkatan
        if (angkatan && angkatanMhs !== angkatan) continue;

        // Filter berdasarkan search (nama/NIM)
        if (search) {
          const lowerSearch = search.toLowerCase();
          const matchNama = m.nama && m.nama.toLowerCase().includes(lowerSearch);
          const matchNim = m.nim && m.nim.includes(search);
          if (!matchNama && !matchNim) continue;
        }

        // Ambil MK yang diambil mahasiswa ini (hanya dari MK yang diampu dosen)
        const mkDiambil = enrollmentSnapshot.docs
          .filter(d => d.data().mahasiswaId === uid)
          .map(d => {
            const mk = mkList.find(m => m.id === d.data().mkId);
            return mk ? mk.kode : d.data().mkId;
          });

        mahasiswaList.push({
          ...m,
          angkatan: angkatanMhs,
          mkDiambil
        });
      }
    }

    // Urutkan berdasarkan NIM
    mahasiswaList.sort((a, b) => a.nim.localeCompare(b.nim));

    // Ambil daftar angkatan unik untuk filter
    const angkatanSet = new Set();
    mahasiswaList.forEach(m => {
      if (m.angkatan) angkatanSet.add(m.angkatan);
    });
    const angkatanList = Array.from(angkatanSet).sort().reverse();

    res.render('dosen/mahasiswa_list', {
      title: 'Mahasiswa Bimbingan',
      mahasiswaList,
      mkList,
      filterMk: mkId || '',
      filterAngkatan: angkatan || '',
      search: search || '',
      angkatanList
    });

  } catch (error) {
    console.error('Error mengambil mahasiswa bimbingan:', error);
    res.status(500).render('error', { message: 'Gagal mengambil data mahasiswa' });
  }
});

// ============================================================================
// DETAIL MAHASISWA (opsional)
// ============================================================================

/**
 * GET /dosen/mahasiswa/:id
 * Menampilkan detail mahasiswa: profil, MK yang diambil, nilai, dll
 */
router.get('/:id', async (req, res) => {
  try {
    const mahasiswaId = req.params.id;
    const dosenId = req.user.id;

    // Ambil data mahasiswa
    const userDoc = await db.collection('users').doc(mahasiswaId).get();
    if (!userDoc.exists) {
      return res.status(404).send('Mahasiswa tidak ditemukan');
    }
    const mahasiswa = { id: mahasiswaId, ...userDoc.data() };

    // Ambil MK yang diampu dosen ini
    const mkDosen = await getMataKuliahDosen(dosenId);
    const mkDosenIds = mkDosen.map(m => m.id);

    // Ambil MK yang diambil mahasiswa (hanya dari MK yang diampu dosen)
    const enrollmentSnapshot = await db.collection('enrollment')
      .where('mahasiswaId', '==', mahasiswaId)
      .where('mkId', 'in', mkDosenIds)
      .get();
    const mkDiambil = [];
    for (const doc of enrollmentSnapshot.docs) {
      const mkId = doc.data().mkId;
      const mk = mkDosen.find(m => m.id === mkId);
      if (mk) {
        mkDiambil.push(mk);
      }
    }

    // Ambil nilai untuk setiap MK
    const nilaiList = [];
    for (const mk of mkDiambil) {
      const nilaiSnapshot = await db.collection('nilai')
        .where('mahasiswaId', '==', mahasiswaId)
        .where('mkId', '==', mk.id)
        .get();
      const nilaiMap = {};
      nilaiSnapshot.docs.forEach(doc => {
        const data = doc.data();
        nilaiMap[data.tipe] = data.nilai;
      });
      nilaiList.push({
        mk,
        nilai: nilaiMap
      });
    }

    res.render('dosen/mahasiswa_detail', {
      title: `Detail Mahasiswa - ${mahasiswa.nama}`,
      mahasiswa,
      mkDiambil,
      nilaiList
    });

  } catch (error) {
    console.error('Error detail mahasiswa:', error);
    res.status(500).render('error', { message: 'Gagal memuat detail mahasiswa' });
  }
});

module.exports = router;