/**
 * routes/mahasiswa/tagihan.js
 * Menampilkan informasi tagihan SPP mahasiswa
 */

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');

// Semua route memerlukan autentikasi
router.use(verifyToken);

/**
 * GET /mahasiswa/tagihan
 * Menampilkan daftar tagihan SPP per semester
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const tagihanDoc = await db.collection('tagihan').doc(userId).get();
    
    let tagihan = [];
    if (tagihanDoc.exists) {
      tagihan = tagihanDoc.data().semester || [];
    }

    // Hitung total tagihan dan total lunas (asumsi field jumlah dan status)
    let totalTagihan = 0, totalLunas = 0;
    tagihan.forEach(t => {
      if (t.status === 'lunas') {
        totalLunas += t.jumlah;
      } else {
        totalTagihan += t.jumlah;
      }
    });

    const sisaTagihan = totalTagihan; // jika belum ada pembayaran, totalTagihan sudah sisa

    res.render('mahasiswa/tagihan', {
      title: 'Tagihan SPP',
      user: req.user,
      tagihan,
      totalTagihan,
      totalLunas,
      sisaTagihan
    });
  } catch (error) {
    console.error('Error mengambil tagihan:', error);
    res.status(500).send('Gagal memuat tagihan');
  }
});

module.exports = router;