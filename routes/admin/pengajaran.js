/**
 * routes/admin/pengajaran.js
 * Admin memantau progres perkuliahan setiap mata kuliah
 * Melihat materi yang telah diupload dosen dan progress pertemuan
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
 * Menghitung progress pertemuan suatu MK dari array materi
 */
function hitungProgress(materi) {
  if (!materi || !Array.isArray(materi)) {
    return { total: 16, terlaksana: 0, persentase: 0 };
  }
  const total = 16; // standar 16 pertemuan
  const terlaksana = materi.filter(m => m.status === 'selesai').length;
  const persentase = Math.round((terlaksana / total) * 100);
  return { total, terlaksana, persentase };
}

/**
 * Mendapatkan nama dosen dari array ID
 */
async function getDosenNames(dosenIds) {
  if (!dosenIds || !Array.isArray(dosenIds) || dosenIds.length === 0) return [];
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
// HALAMAN UTAMA - DAFTAR MATA KULIAH
// ============================================================================

/**
 * GET /admin/pengajaran
 * Menampilkan daftar semua mata kuliah dengan progress
 * Bisa difilter berdasarkan semester
 */
router.get('/', async (req, res) => {
  try {
    const { semester } = req.query;

    let query = db.collection('mataKuliah').orderBy('semester', 'desc').orderBy('kode');
    if (semester) {
      query = query.where('semester', '==', parseInt(semester));
    }
    const snapshot = await query.get();

    const mkList = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const progress = hitungProgress(data.materi);
      const dosenNames = await getDosenNames(data.dosenIds);
      mkList.push({
        id: doc.id,
        kode: data.kode,
        nama: data.nama,
        sks: data.sks,
        semester: data.semester,
        dosen: dosenNames.join(', '),
        totalPertemuan: progress.total,
        terlaksana: progress.terlaksana,
        persentase: progress.persentase
      });
    }

    // Ambil daftar semester unik untuk dropdown filter
    const semesterSnapshot = await db.collection('mataKuliah').get();
    const semesterSet = new Set();
    semesterSnapshot.docs.forEach(doc => {
      if (doc.data().semester) semesterSet.add(doc.data().semester);
    });
    const semesterList = Array.from(semesterSet).sort((a, b) => a - b);

    res.render('admin/pengajaran_list', {
      title: 'Monitoring Pengajaran',
      mkList,
      semesterList,
      selectedSemester: semester || ''
    });
  } catch (error) {
    console.error('Error mengambil data pengajaran:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat data pengajaran' });
  }
});

// ============================================================================
// DETAIL MATA KULIAH
// ============================================================================

/**
 * GET /admin/pengajaran/:id
 * Menampilkan detail pertemuan dan progress MK
 */
router.get('/:id', async (req, res) => {
  try {
    const mkDoc = await db.collection('mataKuliah').doc(req.params.id).get();
    if (!mkDoc.exists) {
      return res.status(404).render('error', { title: 'Tidak Ditemukan', message: 'Mata kuliah tidak ditemukan' });
    }
    const mk = { id: mkDoc.id, ...mkDoc.data() };

    // Siapkan daftar pertemuan 1-16
    const materi = mk.materi || [];
    const pertemuanList = [];
    for (let i = 1; i <= 16; i++) {
      const existing = materi.find(m => m.pertemuan === i) || {};
      pertemuanList.push({
        pertemuan: i,
        topik: existing.topik || `Pertemuan ${i}`,
        tanggal: existing.tanggal || null,
        status: existing.status || 'belum',
        catatan: existing.catatan || '',
        materiUrl: existing.fileUrl || null
      });
    }

    // Progress
    const terlaksana = pertemuanList.filter(p => p.status === 'selesai').length;
    const persentase = Math.round((terlaksana / 16) * 100);

    // Dosen pengampu
    const dosenList = [];
    if (mk.dosenIds && mk.dosenIds.length > 0) {
      for (const dId of mk.dosenIds) {
        const dDoc = await db.collection('dosen').doc(dId).get();
        if (dDoc.exists) {
          dosenList.push({ id: dId, nama: dDoc.data().nama });
        }
      }
    }

    // Tugas terkait (opsional)
    let tugasList = [];
    try {
      const tugasSnapshot = await db.collection('tugas')
        .where('mkId', '==', req.params.id)
        .orderBy('deadline', 'asc')
        .get();
      tugasList = tugasSnapshot.docs.map(doc => ({
        id: doc.id,
        judul: doc.data().judul,
        deadline: doc.data().deadline,
        tipe: doc.data().tipe
      }));
    } catch (err) {
      console.error('Gagal ambil tugas:', err.message);
    }

    res.render('admin/pengajaran_detail', {
      title: `${mk.kode} - ${mk.nama}`,
      mk,
      pertemuanList,
      dosenList,
      terlaksana,
      persentase,
      tugasList
    });
  } catch (error) {
    console.error('Error detail MK:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat detail MK' });
  }
});

// ============================================================================
// BULK UPDATE PERTEMUAN
// ============================================================================

/**
 * POST /admin/pengajaran/:id/pertemuan/bulk-update
 * Bulk update status pertemuan (centang yang sudah selesai)
 */
router.post('/:id/pertemuan/bulk-update', async (req, res) => {
  try {
    const { completed } = req.body; // array nomor pertemuan
    console.log('Bulk update received for MK:', req.params.id, 'completed:', completed);

    const mkRef = db.collection('mataKuliah').doc(req.params.id);
    const mkDoc = await mkRef.get();
    if (!mkDoc.exists) {
      console.log('MK tidak ditemukan');
      return res.status(404).json({ success: false, message: 'MK tidak ditemukan' });
    }

    const mk = mkDoc.data();
    let materi = mk.materi || [];
    const completedSet = new Set((Array.isArray(completed) ? completed : []).map(Number));
    console.log('Completed set:', completedSet);

    // Proses 16 pertemuan
    for (let i = 1; i <= 16; i++) {
      const idx = materi.findIndex(m => m.pertemuan === i);
      const isCompleted = completedSet.has(i);

      if (idx !== -1) {
        // Update status
        materi[idx].status = isCompleted ? 'selesai' : 'belum';
        if (isCompleted && !materi[idx].tanggal) {
          materi[idx].tanggal = new Date().toISOString().split('T')[0];
        }
      } else {
        // Buat baru
        materi.push({
          pertemuan: i,
          topik: `Pertemuan ${i}`,
          status: isCompleted ? 'selesai' : 'belum',
          tanggal: isCompleted ? new Date().toISOString().split('T')[0] : null,
        });
      }
    }

    // Urutkan dan simpan
    materi.sort((a, b) => a.pertemuan - b.pertemuan);
    await mkRef.update({ materi, updatedAt: new Date().toISOString() });
    console.log('Bulk update sukses');
    res.json({ success: true });
  } catch (error) {
    console.error('Error bulk update:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /admin/pengajaran/:id/pertemuan/bulk-update
 * Bulk update status pertemuan (centang yang sudah selesai)
 */
router.post('/:id/pertemuan/bulk-update', async (req, res) => {
  try {
    const { completed } = req.body; // array nomor pertemuan
    const mkRef = db.collection('mataKuliah').doc(req.params.id);
    const mkDoc = await mkRef.get();
    if (!mkDoc.exists) return res.status(404).send('MK tidak ditemukan');

    const mk = mkDoc.data();
    let materi = mk.materi || [];
    const completedSet = new Set((Array.isArray(completed) ? completed : []).map(Number));

    for (let i = 1; i <= 16; i++) {
      const idx = materi.findIndex(m => m.pertemuan === i);
      const isCompleted = completedSet.has(i);
      if (idx !== -1) {
        materi[idx].status = isCompleted ? 'selesai' : 'belum';
        if (isCompleted && !materi[idx].tanggal) {
          materi[idx].tanggal = new Date().toISOString().split('T')[0];
        }
      } else {
        materi.push({
          pertemuan: i,
          topik: `Pertemuan ${i}`,
          status: isCompleted ? 'selesai' : 'belum',
          tanggal: isCompleted ? new Date().toISOString().split('T')[0] : null,
        });
      }
    }
    materi.sort((a, b) => a.pertemuan - b.pertemuan);
    await mkRef.update({ materi, updatedAt: new Date().toISOString() });
    res.json({ success: true });
  } catch (error) {
    console.error('Error bulk update:', error);
    res.status(500).json({ success: false, message: 'Gagal bulk update' });
  }
});

// ============================================================================
// REKAP PER SEMESTER
// ============================================================================

/**
 * GET /admin/pengajaran/rekap/semester
 * Menampilkan rekap progress per semester
 */
router.get('/rekap/semester', async (req, res) => {
  try {
    const snapshot = await db.collection('mataKuliah').orderBy('semester').get();
    const rekapMap = new Map();

    snapshot.docs.forEach(doc => {
      const data = doc.data();
      const semester = data.semester;
      if (!semester) return;

      const progress = hitungProgress(data.materi);
      if (!rekapMap.has(semester)) {
        rekapMap.set(semester, {
          semester,
          totalMk: 0,
          totalPertemuan: 0,
          totalTerlaksana: 0,
          totalPersen: 0
        });
      }
      const rekap = rekapMap.get(semester);
      rekap.totalMk += 1;
      rekap.totalPertemuan += progress.total;
      rekap.totalTerlaksana += progress.terlaksana;
      rekap.totalPersen += progress.persentase;
    });

    const rekapList = [];
    for (let [semester, data] of rekapMap.entries()) {
      rekapList.push({
        semester: `Semester ${semester}`,
        totalMk: data.totalMk,
        totalPertemuan: data.totalPertemuan,
        totalTerlaksana: data.totalTerlaksana,
        rataPersentase: Math.round(data.totalPersen / data.totalMk)
      });
    }

    rekapList.sort((a, b) => a.semester.localeCompare(b.semester, undefined, { numeric: true }));

    res.render('admin/pengajaran_rekap_semester', {
      title: 'Rekap Pengajaran per Semester',
      rekapList
    });
  } catch (error) {
    console.error('Error rekap semester:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat rekap' });
  }
});

// ============================================================================
// REKAP PER DOSEN
// ============================================================================

/**
 * GET /admin/pengajaran/rekap/dosen
 * Menampilkan rekap progress per dosen
 */
router.get('/rekap/dosen', async (req, res) => {
  try {
    const mkSnapshot = await db.collection('mataKuliah').get();
    const dosenMap = new Map();

    for (const doc of mkSnapshot.docs) {
      const data = doc.data();
      const progress = hitungProgress(data.materi);
      const dosenIds = data.dosenIds || [];

      for (const dId of dosenIds) {
        if (!dId) continue;
        const dDoc = await db.collection('dosen').doc(dId).get();
        const nama = dDoc.exists ? dDoc.data().nama : 'Unknown';
        if (!dosenMap.has(dId)) {
          dosenMap.set(dId, {
            id: dId,
            nama,
            totalMk: 0,
            totalPertemuan: 0,
            totalTerlaksana: 0,
            totalPersen: 0
          });
        }
        const d = dosenMap.get(dId);
        d.totalMk += 1;
        d.totalPertemuan += progress.total;
        d.totalTerlaksana += progress.terlaksana;
        d.totalPersen += progress.persentase;
      }
    }

    const rekapList = [];
    for (let [id, data] of dosenMap.entries()) {
      rekapList.push({
        nama: data.nama,
        totalMk: data.totalMk,
        totalPertemuan: data.totalPertemuan,
        totalTerlaksana: data.totalTerlaksana,
        rataPersentase: Math.round(data.totalPersen / data.totalMk)
      });
    }

    rekapList.sort((a, b) => a.nama.localeCompare(b.nama));

    res.render('admin/pengajaran_rekap_dosen', {
      title: 'Rekap Pengajaran per Dosen',
      rekapList
    });
  } catch (error) {
    console.error('Error rekap dosen:', error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat rekap dosen' });
  }
});

// ============================================================================
// EXPORT (ke halaman print)
// ============================================================================

/**
 * GET /admin/pengajaran/export
 * Mengekspor data pengajaran ke tampilan print
 */
router.get('/export', async (req, res) => {
  try {
    const { semester } = req.query;
    let query = db.collection('mataKuliah').orderBy('semester').orderBy('kode');
    if (semester) {
      query = query.where('semester', '==', parseInt(semester));
    }
    const snapshot = await query.get();

    const exportData = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const progress = hitungProgress(data.materi);
      const dosenNames = await getDosenNames(data.dosenIds);
      exportData.push({
        kode: data.kode,
        nama: data.nama,
        sks: data.sks,
        semester: data.semester,
        dosen: dosenNames.join(', '),
        totalPertemuan: progress.total,
        terlaksana: progress.terlaksana,
        persentase: progress.persentase
      });
    }

    const filterInfo = semester ? `Semester ${semester}` : 'Semua Semester';

    res.render('admin/pengajaran_export', {
      title: 'Export Data Pengajaran',
      data: exportData,
      filterInfo,
      generatedAt: new Date().toLocaleString('id-ID')
    });
  } catch (error) {
    console.error('Error export:', error);
    res.status(500).send('Gagal export data');
  }
});

module.exports = router;