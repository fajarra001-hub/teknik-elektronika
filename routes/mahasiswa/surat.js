/**
 * routes/mahasiswa/surat.js
 * Modul Persuratan Mahasiswa: pengajuan surat aktif kuliah dan surat lainnya
 */

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');

router.use(verifyToken);

// ============================================================================
// FUNGSI BANTU
// ============================================================================

/**
 * Generate kode validasi (untuk keaslian surat)
 */
function generateKodeValidasi() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `ELK${timestamp}${random}`;
}

// ============================================================================
// DAFTAR SURAT
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('surat')
      .where('userId', '==', req.user.id)
      .orderBy('createdAt', 'desc')
      .get();
    const suratList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('mahasiswa/persuratan/index', {
      title: 'Daftar Surat',
      user: req.user,
      suratList
    });
  } catch (error) {
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Gagal memuat daftar surat' 
    });
  }
});

// ============================================================================
// PENGAJUAN SURAT AKTIF KULIAH
// ============================================================================

router.get('/aktif-kuliah', (req, res) => {
  const semesterSekarang = 'Genap 2025/2026'; // nanti bisa diambil dari config
  res.render('mahasiswa/persuratan/aktif_form', {
    title: 'Ajukan Surat Aktif Kuliah',
    user: req.user,
    semesterSekarang
  });
});

router.post('/aktif-kuliah', async (req, res) => {
  try {
    const { keperluan, semester, tahunAkademik } = req.body;
    if (!keperluan) {
      return res.status(400).send('Keperluan harus diisi');
    }

    // Generate kode validasi (akan digunakan jika surat jadi diterbitkan)
    const kodeValidasi = generateKodeValidasi();

    const suratData = {
      userId: req.user.id,
      jenis: 'Aktif Kuliah',
      kodeValidasi,
      keperluan,
      semester: semester || 'Genap 2025/2026',
      tahunAkademik: tahunAkademik || '2025/2026',
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [{
        status: 'pending',
        timestamp: new Date().toISOString(),
        catatan: 'Pengajuan surat diterima'
      }]
    };

    await db.collection('surat').add(suratData);
    res.redirect('/mahasiswa/persuratan');
  } catch (error) {
  console.error('Error mengajukan surat:', error);
  res.status(500).render('error', { 
    title: 'Error', 
    message: 'Gagal mengajukan surat' 
  });
}
});

// ============================================================================
// PENGAJUAN SURAT LAINNYA
// ============================================================================

router.get('/lainnya', (req, res) => {
  res.render('mahasiswa/persuratan/lainnya_form', {
    title: 'Ajukan Surat Lainnya',
    user: req.user
  });
});

router.post('/lainnya', async (req, res) => {
  try {
    const { jenisSurat, keperluan, keterangan } = req.body;
    if (!jenisSurat || !keperluan) {
      return res.status(400).send('Jenis surat dan keperluan harus diisi');
    }

    const kodeValidasi = generateKodeValidasi();

    const suratData = {
      userId: req.user.id,
      jenis: jenisSurat,
      kodeValidasi,
      keperluan,
      keterangan: keterangan || '',
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [{
        status: 'pending',
        timestamp: new Date().toISOString(),
        catatan: 'Pengajuan surat diterima'
      }]
    };

    await db.collection('surat').add(suratData);
    res.redirect('/mahasiswa/persuratan');
  } catch (error) {
  console.error('Error mengajukan surat:', error);
  res.status(500).render('error', { 
    title: 'Error', 
    message: 'Gagal mengajukan surat' 
  });
}
});

// ============================================================================
// DETAIL SURAT
// ============================================================================

router.get('/:id', async (req, res) => {
  try {
    const doc = await db.collection('surat').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).send('Surat tidak ditemukan');
    }
    const surat = { id: doc.id, ...doc.data() };
    if (surat.userId !== req.user.id) {
      return res.status(403).send('Akses ditolak');
    }
    res.render('mahasiswa/persuratan/detail', {
      title: 'Detail Surat',
      user: req.user,
      surat
    });
  } catch (error) {
  console.error('Error detail surat:', error);
  res.status(500).render('error', { 
    title: 'Error', 
    message: 'Gagal memuat detail surat' 
  });
}
});

// ============================================================================
// DOWNLOAD SURAT (PDF) - setelah admin upload file
// ============================================================================

router.get('/:id/download', async (req, res) => {
  try {
    const doc = await db.collection('surat').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).send('Surat tidak ditemukan');
    const surat = doc.data();
    if (surat.userId !== req.user.id) return res.status(403).send('Akses ditolak');
    if (surat.status !== 'completed') {
      return res.status(400).send('Surat belum tersedia');
    }
    if (!surat.fileUrl) {
      return res.status(400).send('File surat belum diupload');
    }
    // Redirect ke URL file (bisa juga download langsung)
    res.redirect(surat.fileUrl);
  } catch (error) {
    console.error('Error download surat:', error);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Gagal mengunduh surat' 
    });
  }
});

// ============================================================================
// BATALKAN PENGAJUAN (hanya jika status pending)
// ============================================================================

router.post('/:id/batal', async (req, res) => {
  try {
    const docRef = db.collection('surat').doc(req.params.id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).send('Surat tidak ditemukan');
    const surat = doc.data();
    if (surat.userId !== req.user.id) return res.status(403).send('Akses ditolak');
    if (surat.status !== 'pending') {
      return res.status(400).send('Hanya surat dengan status pending yang dapat dibatalkan');
    }

    await docRef.update({
      status: 'cancelled',
      updatedAt: new Date().toISOString(),
      history: [
        ...(surat.history || []),
        {
          status: 'cancelled',
          timestamp: new Date().toISOString(),
          catatan: 'Dibatalkan oleh mahasiswa'
        }
      ]
    });
    res.redirect('/mahasiswa/persuratan');
  } catch (error) {
  console.error('Error membatalkan surat:', error);
  res.status(500).render('error', { 
    title: 'Error', 
    message: 'Gagal membatalkan surat' 
  });
}
});

module.exports = router;