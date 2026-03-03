const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middleware/auth');
const { db } = require('../config/firebaseAdmin');

// Middleware untuk semua route admin
router.use(verifyToken);
router.use(isAdmin);

// ... semua route admin (termasuk yang Anda punya) ...

// GET /admin/krs/:id - detail KRS
router.get('/krs/:id', async (req, res) => {
  try {
    const krsDoc = await db.collection('krs').doc(req.params.id).get();
    if (!krsDoc.exists) return res.status(404).send('KRS tidak ditemukan');
    const krs = { id: krsDoc.id, ...krsDoc.data() };
    const userDoc = await db.collection('users').doc(krs.userId).get();
    const mahasiswa = userDoc.exists ? userDoc.data() : {};
    res.render('admin/krs_detail', { user: req.user, krs, mahasiswa });
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal memuat detail KRS');
  }
});

// ... route lainnya ...

module.exports = router;