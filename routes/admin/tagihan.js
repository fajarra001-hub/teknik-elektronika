/**
 * routes/admin/tagihan.js
 * Kelola tagihan SPP mahasiswa
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
 * Mendapatkan data mahasiswa dari ID
 */
async function getMahasiswa(id) {
  const doc = await db.collection('users').doc(id).get();
  if (doc.exists) {
    return { id: doc.id, ...doc.data() };
  }
  return { id, nama: 'Unknown', nim: '-' };
}

// ============================================================================
// DAFTAR SEMUA MAHASISWA DENGAN TAGIHAN
// ============================================================================

router.get('/', async (req, res) => {
  try {
    // Ambil semua mahasiswa
    const mahasiswaSnapshot = await db.collection('users')
      .where('role', '==', 'mahasiswa')
      .orderBy('nim')
      .get();

    const mahasiswaList = [];
    for (const doc of mahasiswaSnapshot.docs) {
      const m = { id: doc.id, ...doc.data() };
      // Ambil tagihan dari koleksi 'tagihan'
      const tagihanDoc = await db.collection('tagihan').doc(doc.id).get();
      const tagihan = tagihanDoc.exists ? tagihanDoc.data().semester || [] : [];
      
      // Hitung total tagihan dan status
      let totalBelumLunas = 0;
      tagihan.forEach(t => {
        if (t.status !== 'lunas') totalBelumLunas += t.jumlah;
      });

      mahasiswaList.push({
        ...m,
        tagihanCount: tagihan.length,
        totalBelumLunas
      });
    }

    res.render('admin/tagihan_list', {
      title: 'Kelola Tagihan Mahasiswa',
      mahasiswaList
    });
  } catch (error) {
    console.error('Error mengambil data tagihan:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat data tagihan'
    });
  }
});

// ============================================================================
// DETAIL TAGIHAN PER MAHASISWA
// ============================================================================

router.get('/mahasiswa/:id', async (req, res) => {
  try {
    const mahasiswa = await getMahasiswa(req.params.id);
    const tagihanDoc = await db.collection('tagihan').doc(req.params.id).get();
    const tagihan = tagihanDoc.exists ? tagihanDoc.data().semester || [] : [];

    res.render('admin/tagihan_detail', {
      title: `Tagihan - ${mahasiswa.nama}`,
      mahasiswa,
      tagihan
    });
  } catch (error) {
    console.error('Error detail tagihan:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat detail tagihan'
    });
  }
});

// ============================================================================
// TAMBAH TAGIHAN
// ============================================================================

router.get('/mahasiswa/:id/tambah', async (req, res) => {
  try {
    const mahasiswa = await getMahasiswa(req.params.id);
    res.render('admin/tagihan_form', {
      title: 'Tambah Tagihan',
      mahasiswa,
      tagihan: null,
      mode: 'tambah'
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat form'
    });
  }
});

router.post('/mahasiswa/:id/tambah', async (req, res) => {
  try {
    const { semester, jumlah, jatuhTempo, status } = req.body;
    if (!semester || !jumlah) {
      return res.status(400).send('Semester dan jumlah wajib diisi');
    }

    const tagihanRef = db.collection('tagihan').doc(req.params.id);
    const tagihanDoc = await tagihanRef.get();
    const data = tagihanDoc.exists ? tagihanDoc.data() : { semester: [] };

    data.semester.push({
      id: Date.now().toString(),
      semester,
      jumlah: parseInt(jumlah),
      jatuhTempo: jatuhTempo || null,
      status: status || 'belum lunas',
      createdAt: new Date().toISOString()
    });

    await tagihanRef.set(data);
    res.redirect(`/admin/tagihan/mahasiswa/${req.params.id}`);
  } catch (error) {
    console.error('Error tambah tagihan:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal menambah tagihan'
    });
  }
});

// ============================================================================
// EDIT TAGIHAN
// ============================================================================

router.get('/mahasiswa/:id/edit/:tagihanId', async (req, res) => {
  try {
    const mahasiswa = await getMahasiswa(req.params.id);
    const tagihanDoc = await db.collection('tagihan').doc(req.params.id).get();
    if (!tagihanDoc.exists) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan',
        message: 'Tagihan tidak ditemukan'
      });
    }

    const tagihanList = tagihanDoc.data().semester || [];
    const tagihan = tagihanList.find(t => t.id === req.params.tagihanId);
    if (!tagihan) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan',
        message: 'Tagihan tidak ditemukan'
      });
    }

    res.render('admin/tagihan_form', {
      title: 'Edit Tagihan',
      mahasiswa,
      tagihan,
      tagihanId: req.params.tagihanId,
      mode: 'edit'
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat form edit'
    });
  }
});

router.post('/mahasiswa/:id/edit/:tagihanId', async (req, res) => {
  try {
    const { semester, jumlah, jatuhTempo, status } = req.body;
    const tagihanRef = db.collection('tagihan').doc(req.params.id);
    const tagihanDoc = await tagihanRef.get();
    if (!tagihanDoc.exists) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan',
        message: 'Data tagihan tidak ditemukan'
      });
    }

    const data = tagihanDoc.data();
    const index = data.semester.findIndex(t => t.id === req.params.tagihanId);
    if (index === -1) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan',
        message: 'Tagihan tidak ditemukan'
      });
    }

    data.semester[index] = {
      ...data.semester[index],
      semester,
      jumlah: parseInt(jumlah),
      jatuhTempo: jatuhTempo || data.semester[index].jatuhTempo,
      status,
      updatedAt: new Date().toISOString()
    };

    await tagihanRef.set(data);
    res.redirect(`/admin/tagihan/mahasiswa/${req.params.id}`);
  } catch (error) {
    console.error('Error update tagihan:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal update tagihan'
    });
  }
});

// ============================================================================
// HAPUS TAGIHAN
// ============================================================================

router.post('/mahasiswa/:id/hapus/:tagihanId', async (req, res) => {
  try {
    const tagihanRef = db.collection('tagihan').doc(req.params.id);
    const tagihanDoc = await tagihanRef.get();
    if (!tagihanDoc.exists) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan',
        message: 'Data tagihan tidak ditemukan'
      });
    }

    const data = tagihanDoc.data();
    data.semester = data.semester.filter(t => t.id !== req.params.tagihanId);
    await tagihanRef.set(data);

    res.redirect(`/admin/tagihan/mahasiswa/${req.params.id}`);
  } catch (error) {
    console.error('Error hapus tagihan:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal hapus tagihan'
    });
  }
});

module.exports = router;