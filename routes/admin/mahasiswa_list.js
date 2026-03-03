/**
 * routes/admin/mahasiswa.js
 * Kelola data mahasiswa (CRUD)
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
 * Mendapatkan angkatan dari NIM
 * @param {string} nim 
 * @returns {string}
 */
function getAngkatanFromNim(nim) {
  if (!nim || nim.length < 2) return 'Unknown';
  return '20' + nim.substring(0, 2);
}

// ============================================================================
// DAFTAR MAHASISWA
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const { angkatan, search } = req.query;

    // Ambil semua mahasiswa (role = 'mahasiswa')
    const snapshot = await db.collection('users')
      .where('role', '==', 'mahasiswa')
      .orderBy('nim')
      .get();

    const mahasiswaList = [];
    const angkatanSet = new Set();

    snapshot.docs.forEach(doc => {
      const data = doc.data();
      const m = { id: doc.id, ...data };
      const angkatanMhs = getAngkatanFromNim(m.nim);
      angkatanSet.add(angkatanMhs);

      // Filter berdasarkan angkatan
      if (angkatan && angkatanMhs !== angkatan) return;

      // Filter berdasarkan search (nama atau nim)
      if (search) {
        const lowerSearch = search.toLowerCase();
        const matchNama = m.nama && m.nama.toLowerCase().includes(lowerSearch);
        const matchNim = m.nim && m.nim.includes(search);
        if (!matchNama && !matchNim) return;
      }

      mahasiswaList.push({
        ...m,
        angkatan: angkatanMhs
      });
    });

    const angkatanList = Array.from(angkatanSet).sort().reverse();

    res.render('admin/mahasiswa_list', {
      title: 'Daftar Mahasiswa',
      mahasiswaList,
      angkatanList,
      filterAngkatan: angkatan || '',
      search: search || ''
    });
  } catch (error) {
    console.error('Error mengambil mahasiswa:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat data mahasiswa'
    });
  }
});

// ============================================================================
// DETAIL MAHASISWA
// ============================================================================

router.get('/:id', async (req, res) => {
  try {
    const doc = await db.collection('users').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan',
        message: 'Mahasiswa tidak ditemukan'
      });
    }
    const mahasiswa = { id: doc.id, ...doc.data() };
    res.render('admin/mahasiswa_detail', {
      title: `Detail Mahasiswa - ${mahasiswa.nama}`,
      mahasiswa
    });
  } catch (error) {
    console.error('Error detail mahasiswa:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat detail mahasiswa'
    });
  }
});

// ============================================================================
// TAMBAH MAHASISWA (form)
// ============================================================================

router.get('/create', (req, res) => {
  res.render('admin/mahasiswa_form', {
    title: 'Tambah Mahasiswa',
    mahasiswa: null
  });
});

// ============================================================================
// PROSES TAMBAH MAHASISWA
// ============================================================================

router.post('/', async (req, res) => {
  try {
    const { nim, nama, email, password, noHp } = req.body;
    // Validasi sederhana
    if (!nim || !nama || !email || !password) {
      return res.status(400).send('NIM, Nama, Email, dan Password wajib diisi');
    }

    // Cek apakah email sudah terdaftar di Firebase Auth
    // (Di sini kita asumsikan admin sudah membuat akun via Firebase Console)
    // Untuk memudahkan, kita simpan data user di Firestore saja.
    // Jika ingin integrasi Auth, perlu implementasi lebih lanjut.

    await db.collection('users').add({
      nim,
      nama,
      email,
      noHp: noHp || '',
      role: 'mahasiswa',
      createdAt: new Date().toISOString()
    });

    res.redirect('/admin/mahasiswa');
  } catch (error) {
    console.error('Error tambah mahasiswa:', error);
    res.status(500).send('Gagal menambah mahasiswa');
  }
});

// ============================================================================
// EDIT MAHASISWA (form)
// ============================================================================

router.get('/:id/edit', async (req, res) => {
  try {
    const doc = await db.collection('users').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).send('Mahasiswa tidak ditemukan');
    }
    const mahasiswa = { id: doc.id, ...doc.data() };
    res.render('admin/mahasiswa_form', {
      title: 'Edit Mahasiswa',
      mahasiswa
    });
  } catch (error) {
    console.error('Error edit mahasiswa:', error);
    res.status(500).send('Gagal memuat form edit');
  }
});

// ============================================================================
// PROSES EDIT MAHASISWA
// ============================================================================

router.post('/:id/update', async (req, res) => {
  try {
    const { nim, nama, email, noHp } = req.body;
    if (!nim || !nama || !email) {
      return res.status(400).send('NIM, Nama, dan Email wajib diisi');
    }

    await db.collection('users').doc(req.params.id).update({
      nim,
      nama,
      email,
      noHp: noHp || '',
      updatedAt: new Date().toISOString()
    });

    res.redirect('/admin/mahasiswa');
  } catch (error) {
    console.error('Error update mahasiswa:', error);
    res.status(500).send('Gagal update mahasiswa');
  }
});

// ============================================================================
// HAPUS MAHASISWA
// ============================================================================

router.post('/:id/delete', async (req, res) => {
  try {
    await db.collection('users').doc(req.params.id).delete();
    res.redirect('/admin/mahasiswa');
  } catch (error) {
    console.error('Error hapus mahasiswa:', error);
    res.status(500).send('Gagal hapus mahasiswa');
  }
});

module.exports = router;