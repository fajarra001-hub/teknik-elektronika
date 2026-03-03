const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db, auth } = require('../../config/firebaseAdmin');

router.use(verifyToken);
router.use(isAdmin);

// GET daftar pengguna
router.get('/', async (req, res) => {
  try {
    const { role } = req.query;
    let users = [];

    if (role && role !== 'all') {
      if (role === 'dosen') {
        const dosenSnapshot = await db.collection('dosen').orderBy('nama').get();
        users = dosenSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), role: 'dosen' }));
      } else {
        const userSnapshot = await db.collection('users').where('role', '==', role).orderBy('nama').get();
        users = userSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      }
    } else {
      const userSnapshot = await db.collection('users').orderBy('nama').get();
      const dosenSnapshot = await db.collection('dosen').orderBy('nama').get();
      users = [
        ...userSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
        ...dosenSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), role: 'dosen' }))
      ];
      users.sort((a, b) => a.nama.localeCompare(b.nama));
    }

    res.render('admin/users', {
      title: 'Kelola Pengguna',
      users,
      role: role || 'all',
      success: req.query.success
    });
  } catch (error) {
    console.error(error);
    res.status(500).render('admin/error', { message: 'Gagal memuat data pengguna' });
  }
});

// POST tambah pengguna
router.post('/', async (req, res) => {
  try {
    const { role, nama, nim, nip, email, password } = req.body;
    const userRecord = await auth.createUser({ email, password, displayName: nama });

    if (role === 'dosen') {
      await db.collection('dosen').doc(userRecord.uid).set({
        userId: userRecord.uid,
        nama,
        nip: nip || '',
        email,
        createdAt: new Date().toISOString()
      });
    } else {
      await db.collection('users').doc(userRecord.uid).set({
        nama,
        nim: role === 'mahasiswa' ? nim : '',
        email,
        role,
        createdAt: new Date().toISOString()
      });
    }

    res.redirect('/admin/users?success=ditambahkan');
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal menambah user: ' + error.message);
  }
});

// POST hapus user
router.post('/:id/delete', async (req, res) => {
  try {
    await auth.deleteUser(req.params.id);
    await db.collection('users').doc(req.params.id).delete().catch(() => {});
    await db.collection('dosen').doc(req.params.id).delete().catch(() => {});
    res.redirect('/admin/users?success=dihapus');
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal menghapus user');
  }
});

// POST reset password
router.post('/reset-password', async (req, res) => {
  try {
    await auth.generatePasswordResetLink(req.body.email);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;