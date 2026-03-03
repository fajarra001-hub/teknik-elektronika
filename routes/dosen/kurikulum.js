/**
 * routes/dosen/kurikulum.js
 * Kurikulum Prodi – melihat daftar mata kuliah beserta RPS, CPL, dan tugas
 * (Hanya untuk viewing, tidak ada fitur edit)
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
 * Mendapatkan nama dosen dari ID (array)
 */
async function getDosenNames(dosenIds) {
  if (!dosenIds || !Array.isArray(dosenIds)) return [];
  const names = [];
  for (const id of dosenIds) {
    const doc = await db.collection('dosen').doc(id).get();
    if (doc.exists) {
      names.push(doc.data().nama);
    } else {
      names.push('Unknown');
    }
  }
  return names;
}

// ============================================================================
// DAFTAR MATA KULIAH (KURIKULUM)
// ============================================================================

/**
 * GET /dosen/kurikulum
 * Menampilkan semua mata kuliah yang ada di prodi
 * (bisa difilter berdasarkan semester)
 */
router.get('/', async (req, res) => {
  try {
    const { semester } = req.query;

    let query = db.collection('mataKuliah').orderBy('semester').orderBy('kode');
    if (semester) {
      query = query.where('semester', '==', parseInt(semester));
    }

    const snapshot = await query.get();
    const mkList = [];

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const dosenNames = await getDosenNames(data.dosenIds || []);
      mkList.push({
        id: doc.id,
        kode: data.kode,
        nama: data.nama,
        sks: data.sks,
        semester: data.semester,
        dosen: dosenNames.join(', '),
        cpl: data.cpl || null,
        rpsUrl: data.rpsUrl || null
      });
    }

    // Ambil daftar semester unik untuk dropdown filter
    const semuaSnapshot = await db.collection('mataKuliah').get();
    const semesterSet = new Set();
    semuaSnapshot.docs.forEach(doc => {
      if (doc.data().semester) semesterSet.add(doc.data().semester);
    });
    const semesterList = Array.from(semesterSet).sort((a, b) => a - b);

    res.render('dosen/kurikulum_list', {
      title: 'Kurikulum Prodi',
      mkList,
      semesterList,
      selectedSemester: semester || ''
    });
  } catch (error) {
    console.error('Error mengambil kurikulum:', error);
    res.status(500).render('error', { message: 'Gagal mengambil data kurikulum' });
  }
});

// ============================================================================
// DETAIL MATA KULIAH (RPS, CPL, TUGAS)
// ============================================================================

/**
 * GET /dosen/kurikulum/:id
 * Menampilkan detail mata kuliah: RPS, CPL, materi, tugas
 */
router.get('/:id', async (req, res) => {
  try {
    const mkDoc = await db.collection('mataKuliah').doc(req.params.id).get();
    if (!mkDoc.exists) {
      return res.status(404).send('Mata kuliah tidak ditemukan');
    }
    const mk = { id: mkDoc.id, ...mkDoc.data() };

    // Ambil nama dosen pengampu
    const dosenList = [];
    if (mk.dosenIds && mk.dosenIds.length > 0) {
      for (const id of mk.dosenIds) {
        const d = await db.collection('dosen').doc(id).get();
        if (d.exists) dosenList.push(d.data().nama);
        else dosenList.push('Unknown');
      }
    }

    // Ambil tugas yang terkait dengan MK ini
    const tugasSnapshot = await db.collection('tugas')
      .where('mkId', '==', req.params.id)
      .orderBy('deadline', 'asc')
      .get();
    const tugasList = tugasSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    // Materi per pertemuan (jika ada)
    const materi = mk.materi || [];

    res.render('dosen/kurikulum_detail', {
      title: `${mk.kode} - ${mk.nama}`,
      mk,
      dosenList,
      tugasList,
      materi
    });
  } catch (error) {
    console.error('Error detail kurikulum:', error);
    res.status(500).render('error', { message: 'Gagal memuat detail kurikulum' });
  }
});

module.exports = router;