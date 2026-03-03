/**
 * routes/admin/krs.js
 * Kelola KRS: lihat daftar, detail, setujui, tolak, dan hapus
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive'); // untuk hapus file

router.use(verifyToken);
router.use(isAdmin);

// ============================================================================
// DAFTAR KRS (dengan filter status & semester)
// ============================================================================

/**
 * GET /admin/krs
 * Menampilkan daftar KRS dengan opsi filter
 */
router.get('/', async (req, res) => {
  try {
    const { status, semester } = req.query;

    let query = db.collection('krs');
    if (status) query = query.where('status', '==', status);
    if (semester) query = query.where('semester', '==', semester);
    query = query.orderBy('createdAt', 'desc');

    const krsSnapshot = await query.get();

    const krsList = [];
    for (const doc of krsSnapshot.docs) {
      const data = doc.data();
      
      // Ambil data mahasiswa pemilik KRS
      const mahasiswaDoc = await db.collection('users').doc(data.userId).get();
      const mahasiswa = mahasiswaDoc.exists ? mahasiswaDoc.data() : { nama: 'Unknown', nim: '-' };

      // Ambil preview mata kuliah (maksimal 3)
      const mkIds = data.mataKuliah || [];
      const courses = [];
      for (const mkId of mkIds.slice(0, 3)) {
        const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
        if (mkDoc.exists) {
          courses.push({
            kode: mkDoc.data().kode,
            nama: mkDoc.data().nama,
            sks: mkDoc.data().sks
          });
        }
      }

      krsList.push({
        id: doc.id,
        ...data,
        mahasiswa,
        courses,
        courseCount: mkIds.length
      });
    }

    // Filter yang aktif (untuk mempertahankan nilai di form)
    const filters = { status, semester };

    res.render('admin/krs_list', {
      title: 'Daftar KRS',
      krsList,
      filters,
      success: req.query.success
    });
  } catch (error) {
    console.error('Error mengambil KRS:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat daftar KRS'
    });
  }
});

// ============================================================================
// DETAIL KRS
// ============================================================================

/**
 * GET /admin/krs/:id
 * Menampilkan detail KRS tertentu
 */
router.get('/:id', async (req, res) => {
  try {
    const krsDoc = await db.collection('krs').doc(req.params.id).get();
    if (!krsDoc.exists) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan',
        message: 'KRS tidak ditemukan'
      });
    }
    const krs = { id: krsDoc.id, ...krsDoc.data() };

    // Ambil data mahasiswa
    const mahasiswaDoc = await db.collection('users').doc(krs.userId).get();
    const mahasiswa = mahasiswaDoc.exists ? mahasiswaDoc.data() : { nama: '-', nim: '-' };

    // Ambil detail semua mata kuliah yang diambil
    const mkIds = krs.mataKuliah || [];
    const mkList = [];
    for (const mkId of mkIds) {
      const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
      if (mkDoc.exists) {
        mkList.push({
          id: mkId,
          kode: mkDoc.data().kode,
          nama: mkDoc.data().nama,
          sks: mkDoc.data().sks
        });
      }
    }

    res.render('admin/krs_detail', {
      title: `Detail KRS - ${mahasiswa.nama}`,
      krs,
      mahasiswa,
      mkList
    });
  } catch (error) {
    console.error('Error detail KRS:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat detail KRS'
    });
  }
});

// ============================================================================
// APPROVE KRS
// ============================================================================

/**
 * POST /admin/krs/:id/approve
 * Menyetujui KRS (ubah status menjadi 'approved')
 */
router.post('/:id/approve', async (req, res) => {
  try {
    const krsRef = db.collection('krs').doc(req.params.id);
    const krsDoc = await krsRef.get();
    if (!krsDoc.exists) return res.status(404).send('KRS tidak ditemukan');
    const krs = krsDoc.data();
    const mkIds = krs.mataKuliah || [];
    const semester = krs.semester;
    const userId = krs.userId;

    const batch = db.batch();
    batch.update(krsRef, {
      status: 'approved',
      approvedAt: new Date().toISOString(),
      approvedBy: req.user.id
    });

    for (const mkId of mkIds) {
      const enrollmentRef = db.collection('enrollment').doc(); // auto-id
      batch.set(enrollmentRef, {
        userId,
        mkId,
        semester,
        status: 'active',
        createdAt: new Date().toISOString(),
        approvedBy: req.user.id,
        krsId: req.params.id
      });
    }
    await batch.commit();
    res.redirect('/admin/krs?success=approved');
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal approve KRS');
  }
});
// ============================================================================
// APPROVE KRS
// ============================================================================

/**
 * POST /admin/krs/:id/approve
 * Menyetujui KRS (ubah status menjadi 'approved')
 * dan membuat dokumen enrollment untuk setiap mata kuliah
 */
router.post('/:id/approve', async (req, res) => {
  try {
    const krsRef = db.collection('krs').doc(req.params.id);
    const krsDoc = await krsRef.get();
    if (!krsDoc.exists) {
      return res.status(404).send('KRS tidak ditemukan');
    }
    const krs = krsDoc.data();
    const mkIds = krs.mataKuliah || [];
    const semester = krs.semester;
    const userId = krs.userId;

    // Batch write untuk efisiensi
    const batch = db.batch();

    // Update status KRS
    batch.update(krsRef, {
      status: 'approved',
      approvedAt: new Date().toISOString(),
      approvedBy: req.user.id
    });

    // Buat dokumen enrollment untuk setiap mata kuliah
    for (const mkId of mkIds) {
      // Cek apakah sudah ada enrollment untuk mahasiswa dan mk ini di semester yang sama? 
      // Jika tidak ingin duplikat, bisa dilakukan pengecekan terlebih dahulu.
      // Namun untuk kesederhanaan, kita buat dokumen baru. Bisa juga tambahkan field semester untuk membedakan.
      const enrollmentRef = db.collection('enrollment').doc(); // auto-id
      batch.set(enrollmentRef, {
        userId: userId,
        mkId: mkId,
        semester: semester,
        status: 'active',
        createdAt: new Date().toISOString(),
        approvedBy: req.user.id,
        krsId: req.params.id // optional, untuk referensi
      });
    }

    await batch.commit();

    res.redirect('/admin/krs?success=approved');
  } catch (error) {
    console.error('Error approve KRS:', error);
    res.status(500).send('Gagal menyetujui KRS');
  }
});
// ============================================================================
// REJECT KRS
// ============================================================================

/**
 * POST /admin/krs/:id/reject
 * Menolak KRS (ubah status menjadi 'rejected')
 */
router.post('/:id/reject', async (req, res) => {
  try {
    await db.collection('krs').doc(req.params.id).update({
      status: 'rejected',
      rejectedAt: new Date().toISOString(),
      rejectedBy: req.user.id
    });
    res.redirect('/admin/krs?success=rejected');
  } catch (error) {
    console.error('Error reject KRS:', error);
    res.status(500).send('Gagal menolak KRS');
  }
});

// ============================================================================
// DELETE KRS (beserta file di Drive jika ada)
// ============================================================================

/**
 * POST /admin/krs/delete/:id
 * Menghapus KRS dan file terkait di Google Drive
 */
router.post('/delete/:id', async (req, res) => {
  try {
    const krsDoc = await db.collection('krs').doc(req.params.id).get();
    if (!krsDoc.exists) {
      return res.status(404).send('KRS tidak ditemukan');
    }

    const krs = krsDoc.data();

    // Hapus file di Drive jika ada driveFileId
    if (krs.driveFileId) {
      try {
        await drive.files.delete({ fileId: krs.driveFileId });
        console.log('File di Drive berhasil dihapus:', krs.driveFileId);
      } catch (err) {
        console.error('Gagal menghapus file di Drive:', err.message);
        // Tetap lanjutkan penghapusan dokumen meskipun file gagal dihapus
      }
    }

    // Hapus dokumen KRS dari Firestore
    await db.collection('krs').doc(req.params.id).delete();

    // Redirect ke halaman daftar KRS dengan pesan sukses
    res.redirect('/admin/krs?success=deleted');
  } catch (error) {
    console.error('Error delete KRS:', error);
    res.status(500).send('Gagal menghapus KRS');
  }
});

module.exports = router;