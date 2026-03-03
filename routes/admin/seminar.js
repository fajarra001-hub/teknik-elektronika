/**
 * routes/admin/seminar.js
 * Manajemen seminar magang oleh admin
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

async function getMahasiswa(userId) {
  const doc = await db.collection('users').doc(userId).get();
  return doc.exists ? doc.data() : { nama: '-', nim: '-' };
}

// ============================================================================
// DAFTAR SEMINAR
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    let query = db.collection('permohonanMagang').orderBy('createdAt', 'desc');
    if (status) query = query.where('status', '==', status);
    const snapshot = await query.get();

    const seminarList = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const mahasiswa = await getMahasiswa(data.userId);
      seminarList.push({
        id: doc.id,
        ...data,
        mahasiswa
      });
    }

    res.render('admin/seminar_list', {
      title: 'Manajemen Seminar Magang',
      seminarList,
      filterStatus: status || ''
    });
  } catch (error) {
    console.error('Error ambil seminar:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat data seminar'
    });
  }
});

// ============================================================================
// DETAIL SEMINAR
// ============================================================================

router.get('/:id', async (req, res) => {
  try {
    const doc = await db.collection('permohonanMagang').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan',
        message: 'Seminar tidak ditemukan'
      });
    }
    const seminar = { id: doc.id, ...doc.data() };
    const mahasiswa = await getMahasiswa(seminar.userId);
    res.render('admin/seminar_detail', {
      title: 'Detail Seminar',
      seminar,
      mahasiswa
    });
  } catch (error) {
    console.error('Error detail seminar:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat detail'
    });
  }
});

// ============================================================================
// SETUJUI SEMINAR (dengan jadwal)
// ============================================================================

router.post('/:id/approve', async (req, res) => {
  try {
    const { tanggal, waktu, tempat, penguji, catatan } = req.body;
    if (!tanggal || !waktu || !tempat) {
      return res.status(400).send('Tanggal, waktu, dan tempat wajib diisi');
    }

    const seminarRef = db.collection('permohonanMagang').doc(req.params.id);
    const doc = await seminarRef.get();
    if (!doc.exists) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan',
        message: 'Seminar tidak ditemukan'
      });
    }
    const data = doc.data();

    const jadwal = {
      tanggal,
      waktu,
      tempat,
      penguji: penguji || '',
      catatan: catatan || ''
    };

    await seminarRef.update({
      status: 'approved',
      jadwal,
      updatedAt: new Date().toISOString(),
      history: [
        ...(data.history || []),
        { status: 'approved', timestamp: new Date().toISOString(), catatan: 'Disetujui oleh admin dengan jadwal' }
      ]
    });

    res.redirect(`/admin/seminar/${req.params.id}`);
  } catch (error) {
    console.error('Error approve seminar:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal menyetujui seminar'
    });
  }
});

// ============================================================================
// TOLAK SEMINAR
// ============================================================================

router.post('/:id/reject', async (req, res) => {
  try {
    const { alasan } = req.body;
    if (!alasan) {
      return res.status(400).send('Alasan penolakan wajib diisi');
    }

    const seminarRef = db.collection('permohonanMagang').doc(req.params.id);
    const doc = await seminarRef.get();
    if (!doc.exists) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan',
        message: 'Seminar tidak ditemukan'
      });
    }
    const data = doc.data();

    await seminarRef.update({
      status: 'rejected',
      alasanPenolakan: alasan,
      updatedAt: new Date().toISOString(),
      history: [
        ...(data.history || []),
        { status: 'rejected', timestamp: new Date().toISOString(), catatan: `Ditolak: ${alasan}` }
      ]
    });

    res.redirect(`/admin/seminar/${req.params.id}`);
  } catch (error) {
    console.error('Error reject seminar:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal menolak seminar'
    });
  }
});

module.exports = router;