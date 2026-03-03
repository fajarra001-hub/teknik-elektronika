/**
 * routes/admin/laporanMagang.js
 * Admin melihat dan mengelola laporan magang mahasiswa (3 laporan per mahasiswa)
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive');

router.use(verifyToken);
router.use(isAdmin);

// ============================================================================
// FUNGSI BANTU
// ============================================================================

async function getMahasiswa(userId) {
  try {
    const doc = await db.collection('users').doc(userId).get();
    if (doc.exists) {
      const data = doc.data();
      return {
        id: doc.id,
        nama: data.nama || 'Unknown',
        nim: data.nim || '-',
        email: data.email || '-',
        noHp: data.noHp || '-'
      };
    }
    return { id: userId, nama: 'Tidak Ditemukan', nim: '-', email: '-', noHp: '-' };
  } catch (error) {
    console.error('Error getMahasiswa:', error);
    return { id: userId, nama: 'Error', nim: '-', email: '-', noHp: '-' };
  }
}

// ============================================================================
// DAFTAR LAPORAN (group by mahasiswa)
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('laporanMagang').orderBy('uploadedAt', 'desc').get();
    const mahasiswaMap = new Map();

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const userId = data.userId;
      if (!mahasiswaMap.has(userId)) {
        const mhs = await getMahasiswa(userId);
        mahasiswaMap.set(userId, {
          mahasiswa: mhs,
          laporan: []
        });
      }
      mahasiswaMap.get(userId).laporan.push({
        id: doc.id,
        ...data
      });
    }

    const groupedList = Array.from(mahasiswaMap.values());
    res.render('admin/laporan_list', {
      title: 'Laporan Magang Mahasiswa',
      groupedList
    });
  } catch (error) {
    console.error('Error ambil laporan:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat daftar laporan'
    });
  }
});

// ============================================================================
// DETAIL LAPORAN (untuk satu mahasiswa, semua laporannya)
// ============================================================================

router.get('/mahasiswa/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const mahasiswa = await getMahasiswa(userId);
    const snapshot = await db.collection('laporanMagang')
      .where('userId', '==', userId)
      .orderBy('laporanKe', 'asc')
      .get();
    const laporanList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('admin/laporan_detail', {
      title: `Laporan Magang - ${mahasiswa.nama}`,
      mahasiswa,
      laporanList
    });
  } catch (error) {
    console.error('Error detail laporan:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat detail laporan'
    });
  }
});

// ============================================================================
// UPDATE STATUS LAPORAN
// ============================================================================

router.post('/:laporanId/status', async (req, res) => {
  try {
    const { status, catatan } = req.body;
    const laporanRef = db.collection('laporanMagang').doc(req.params.laporanId);
    const doc = await laporanRef.get();
    if (!doc.exists) return res.status(404).send('Laporan tidak ditemukan');
    const data = doc.data();

    await laporanRef.update({
      status,
      catatanAdmin: catatan || '',
      updatedAt: new Date().toISOString(),
      history: [
        ...(data.history || []),
        { status, timestamp: new Date().toISOString(), catatan: catatan || '' }
      ]
    });

    res.redirect(`/admin/laporan-magang/mahasiswa/${data.userId}`);
  } catch (error) {
    console.error('Error update status:', error);
    res.status(500).send('Gagal update status');
  }
});

// ============================================================================
// HAPUS LAPORAN (hanya admin)
// ============================================================================

router.post('/:laporanId/hapus', async (req, res) => {
  try {
    const laporanRef = db.collection('laporanMagang').doc(req.params.laporanId);
    const doc = await laporanRef.get();
    if (!doc.exists) return res.status(404).send('Laporan tidak ditemukan');
    const data = doc.data();

    // Hapus file dari Google Drive
    if (data.fileId) {
      try {
        await drive.files.delete({ fileId: data.fileId });
      } catch (err) {
        console.error('Gagal hapus file Drive:', err);
      }
    }

    await laporanRef.delete();
    res.redirect(`/admin/laporan-magang/mahasiswa/${data.userId}`);
  } catch (error) {
    console.error('Error hapus laporan:', error);
    res.status(500).send('Gagal hapus laporan');
  }
});

module.exports = router;