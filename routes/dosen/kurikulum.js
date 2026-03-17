/**
 * routes/dosen/kurikulum.js
 * Menampilkan kurikulum prodi (daftar mata kuliah) dan detail MK
 * Serta halaman MyRPS (daftar MK yang diampu dosen) dan halaman RPS statis per kode MK
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
 * Mendapatkan daftar semester unik dari semua mata kuliah
 */
async function getSemesterList() {
  const mkSnapshot = await db.collection('mataKuliah').get();
  const semesters = new Set();
  mkSnapshot.docs.forEach(doc => {
    const semester = doc.data().semester;
    if (semester) semesters.add(semester);
  });
  return Array.from(semesters).sort((a, b) => a - b);
}

/**
 * Mendapatkan nama dosen dari array ID dosen
 */
async function getDosenNames(dosenIds) {
  if (!dosenIds || dosenIds.length === 0) return '-';
  const names = [];
  for (const id of dosenIds) {
    const dosenDoc = await db.collection('dosen').doc(id).get();
    if (dosenDoc.exists) {
      names.push(dosenDoc.data().nama);
    }
  }
  return names.join(', ') || '-';
}

// ============================================================================
// HALAMAN DAFTAR MATA KULIAH (KURIKULUM) - SEMUA MK
// ============================================================================
router.get('/', async (req, res) => {
  try {
    const { semester } = req.query;

    let mkSnapshot;
    if (semester) {
      mkSnapshot = await db.collection('mataKuliah')
        .where('semester', '==', parseInt(semester))
        .orderBy('semester')
        .orderBy('kode')
        .get();
    } else {
      mkSnapshot = await db.collection('mataKuliah')
        .orderBy('semester')
        .orderBy('kode')
        .get();
    }

    const mkList = [];
    for (const doc of mkSnapshot.docs) {
      const data = doc.data();
      const dosenNames = await getDosenNames(data.dosenIds || []);
      mkList.push({
        id: doc.id,
        kode: data.kode,
        nama: data.nama,
        sks: data.sks,
        semester: data.semester,
        dosen: dosenNames,
        rpsUrl: data.rpsUrl || null
      });
    }

    const semesterList = await getSemesterList();

    res.render('dosen/kurikulum/index', {
      title: 'Kurikulum Prodi',
      mkList,
      semesterList,
      selectedSemester: semester || ''
    });
  } catch (error) {
    console.error('Error memuat kurikulum:', error);
    res.status(500).render('error', { message: 'Gagal memuat data kurikulum' });
  }
});

// ============================================================================
// HALAMAN MY RPS (DAFTAR MK YANG DIAMPU DOSEN)
// ============================================================================
router.get('/my-rps', async (req, res) => {
  try {
    const dosenId = req.dosen.id;

    // Ambil mata kuliah yang diampu oleh dosen ini
    const mkSnapshot = await db.collection('mataKuliah')
      .where('dosenIds', 'array-contains', dosenId)
      .orderBy('semester')
      .orderBy('kode')
      .get();

    const mkList = mkSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        kode: data.kode,
        nama: data.nama,
        sks: data.sks,
        semester: data.semester,
        rpsUrl: data.rpsUrl || null
      };
    });

    res.render('dosen/kurikulum/my_rps', {
      title: 'My RPS',
      mkList
    });
  } catch (error) {
    console.error('Error memuat My RPS:', error);
    res.status(500).render('error', { message: 'Gagal memuat data RPS' });
  }
});

// ============================================================================
// HALAMAN RPS PER MATA KULIAH (STATIS, BERDASARKAN KODE MK)
// ============================================================================
router.get('/rps/:kode', async (req, res) => {
  try {
    const { kode } = req.params;

    // Cari mata kuliah berdasarkan kode
    const mkSnapshot = await db.collection('mataKuliah')
      .where('kode', '==', kode)
      .limit(1)
      .get();

    if (mkSnapshot.empty) {
      return res.status(404).send('Mata kuliah tidak ditemukan');
    }

    const mkDoc = mkSnapshot.docs[0];
    const mk = { id: mkDoc.id, ...mkDoc.data() };

    // Cek apakah dosen yang login mengampu mata kuliah ini
    if (!mk.dosenIds || !mk.dosenIds.includes(req.dosen.id)) {
      return res.status(403).send('Anda tidak memiliki akses ke mata kuliah ini');
    }

    // Render file EJS sesuai dengan kode MK (misal: rps_EL2001.ejs)
    // File harus berada di folder views/dosen/kurikulum/rps/
    res.render(`dosen/kurikulum/rps/${kode}`, { mk });
  } catch (error) {
    console.error('Error memuat halaman RPS:', error);
    res.status(500).render('error', { message: 'Gagal memuat RPS' });
  }
});

// ============================================================================
// HALAMAN DETAIL MATA KULIAH (BERDASARKAN ID)
// ============================================================================
router.get('/:id', async (req, res) => {
  try {
    const mkDoc = await db.collection('mataKuliah').doc(req.params.id).get();
    if (!mkDoc.exists) {
      return res.status(404).send('Mata kuliah tidak ditemukan');
    }

    const mk = { id: mkDoc.id, ...mkDoc.data() };

    // Ambil nama dosen pengampu
    const dosenList = [];
    for (const id of mk.dosenIds || []) {
      const dosenDoc = await db.collection('dosen').doc(id).get();
      if (dosenDoc.exists) {
        dosenList.push(dosenDoc.data().nama);
      }
    }

    // Ambil materi (jika ada)
    const materi = mk.materi || [];

    // Ambil tugas terkait (jika ada)
    const tugasSnapshot = await db.collection('tugas')
      .where('mkId', '==', req.params.id)
      .orderBy('deadline', 'asc')
      .get();
    const tugasList = tugasSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    res.render('dosen/kurikulum/detail', {
      title: `Detail MK - ${mk.kode}`,
      mk,
      dosenList,
      materi,
      tugasList
    });
  } catch (error) {
    console.error('Error memuat detail MK:', error);
    res.status(500).render('error', { message: 'Gagal memuat detail mata kuliah' });
  }
});

module.exports = router;