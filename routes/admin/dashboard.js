// routes/admin/dashboard.js
const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');

router.use(verifyToken);
router.use(isAdmin);

router.get('/', async (req, res) => {
  try {
    // 1. Statistik Mahasiswa (users role mahasiswa)
    const mahasiswaSnapshot = await db.collection('users')
      .where('role', '==', 'mahasiswa')
      .get();
    const mahasiswaCount = mahasiswaSnapshot.size;

    // 2. Statistik Dosen (koleksi dosen)
    const dosenSnapshot = await db.collection('dosen').get();
    const dosenCount = dosenSnapshot.size;

    // 3. Statistik Mata Kuliah
    const mkSnapshot = await db.collection('mataKuliah').get();
    const mkCount = mkSnapshot.size;

    // 4. KRS Pending
    const krsPendingSnapshot = await db.collection('krs')
      .where('status', '==', 'pending')
      .get();
    const krsPending = krsPendingSnapshot.size;

    // 5. Logbook Pending
    const logbookPendingSnapshot = await db.collection('logbookMagang')
      .where('status', '==', 'pending')
      .get();
    const logbookPending = logbookPendingSnapshot.size;

    // 6. Laporan Magang Pending (status 'submitted')
    const laporanPendingSnapshot = await db.collection('laporanMagang')
      .where('status', '==', 'submitted')
      .get();
    const laporanPending = laporanPendingSnapshot.size;

    // 7. Surat Pending
    const suratPendingSnapshot = await db.collection('surat')
      .where('status', '==', 'pending')
      .get();
    const suratPending = suratPendingSnapshot.size;

    // 8. Event Mendatang (5 terdekat)
    const today = new Date().toISOString().split('T')[0];
    const eventsSnapshot = await db.collection('jadwalPenting')
      .where('tanggal', '>=', today)
      .orderBy('tanggal', 'asc')
      .limit(5)
      .get();
    const events = eventsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const stats = {
      mahasiswaCount,
      dosenCount,
      mkCount,
      krsPending,
      logbookPending,
      laporanPending,
      suratPending
    };

    res.render('admin/dashboard', {
      title: 'Dashboard Admin',
      user: req.user,
      stats,
      events
    });

  } catch (error) {
    console.error('Error loading admin dashboard:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat dashboard admin'
    });
  }
});

module.exports = router;