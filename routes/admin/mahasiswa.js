/**
 * routes/admin/mahasiswa.js
 * Kelola data mahasiswa (CRUD + tagihan SPP + reset password)
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../../middleware/auth');
const { db, auth } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive');
const { Readable } = require('stream');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

router.use(verifyToken);
router.use(isAdmin);

// ============================================================================
// FUNGSI BANTU
// ============================================================================

async function getMahasiswaFotoFolderId() {
  const folderName = 'Foto_Mahasiswa';
  const query = await drive.files.list({
    q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
  });
  if (query.data.files.length > 0) {
    return query.data.files[0].id;
  } else {
    const folder = await drive.files.create({
      resource: { name: folderName, mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id',
    });
    return folder.data.id;
  }
}

function getAngkatanFromNim(nim) {
  if (nim && nim.length >= 2) {
    return '20' + nim.substring(0, 2);
  }
  return new Date().getFullYear().toString();
}

// ============================================================================
// DAFTAR MAHASISWA
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const { angkatan, search, status } = req.query;

    // Ambil semua mahasiswa
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

      mahasiswaList.push(m);
    });

    const angkatanList = Array.from(angkatanSet).sort().reverse();

    res.render('admin/mahasiswa_list', {
      title: 'Kelola Mahasiswa',
      mahasiswa: mahasiswaList,  // <-- diubah dari mahasiswaList menjadi mahasiswa
      angkatanList,
      filterAngkatan: angkatan || '',
      search: search || '',
      filterStatus: status || '' // tambahkan jika ada filter status
    });
  } catch (error) {
    console.error('Error mengambil data mahasiswa:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal mengambil data mahasiswa'
    });
  }
});

// ============================================================================
// TAMBAH MAHASISWA
// ============================================================================

router.get('/create', (req, res) => {
  res.render('admin/mahasiswa_form', { title: 'Tambah Mahasiswa', mahasiswa: null });
});

router.post('/', upload.single('foto'), async (req, res) => {
  try {
    const { nim, nama, email, password } = req.body;
    const file = req.file;

    if (!nim || !nama || !email || !password) {
      return res.status(400).send('NIM, Nama, Email, dan Password wajib diisi');
    }

    let userRecord;
    try {
      userRecord = await auth.createUser({
        email,
        password,
        displayName: nama,
      });
    } catch (authError) {
      console.error('Gagal membuat user di Auth:', authError);
      return res.status(400).send('Email sudah terdaftar atau password tidak valid');
    }

    let fotoUrl = null, fotoFileId = null;
    if (file) {
      const folderId = await getMahasiswaFotoFolderId();
      const fileName = `${nim}_${Date.now()}.${file.originalname.split('.').pop()}`;
      const fileMetadata = { name: fileName, parents: [folderId] };
      const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
      const response = await drive.files.create({
        resource: fileMetadata,
        media,
        fields: 'id, webViewLink',
      });
      fotoUrl = response.data.webViewLink;
      fotoFileId = response.data.id;
    }

    await db.collection('users').doc(userRecord.uid).set({
      nim,
      nama,
      email,
      foto: fotoUrl,
      fotoFileId,
      role: 'mahasiswa',
      createdAt: new Date().toISOString(),
    });

    await db.collection('tagihan').doc(userRecord.uid).set({
      mahasiswaId: userRecord.uid,
      semester: [],
    });

    res.redirect('/admin/mahasiswa');
  } catch (error) {
    console.error('Error menambah mahasiswa:', error);
    res.status(500).send('Gagal menambah mahasiswa: ' + error.message);
  }
});

// ============================================================================
// DETAIL MAHASISWA
// ============================================================================

router.get('/:id', async (req, res) => {
  try {
    const mahasiswaDoc = await db.collection('users').doc(req.params.id).get();
    if (!mahasiswaDoc.exists) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan',
        message: 'Mahasiswa tidak ditemukan'
      });
    }
    const mahasiswa = { id: mahasiswaDoc.id, ...mahasiswaDoc.data() };

    const tagihanDoc = await db.collection('tagihan').doc(req.params.id).get();
    const tagihan = tagihanDoc.exists ? tagihanDoc.data() : { semester: [] };

    res.render('admin/mahasiswa_detail', {
      title: 'Detail Mahasiswa',
      mahasiswa,
      tagihan
    });
  } catch (error) {
    console.error('Error mengambil detail mahasiswa:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat detail mahasiswa'
    });
  }
});

// ============================================================================
// EDIT MAHASISWA
// ============================================================================

router.get('/:id/edit', async (req, res) => {
  try {
    const mahasiswaDoc = await db.collection('users').doc(req.params.id).get();
    if (!mahasiswaDoc.exists) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan',
        message: 'Mahasiswa tidak ditemukan'
      });
    }
    const mahasiswa = { id: mahasiswaDoc.id, ...mahasiswaDoc.data() };
    res.render('admin/mahasiswa_form', { title: 'Edit Mahasiswa', mahasiswa });
  } catch (error) {
    console.error('Error memuat form edit mahasiswa:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat form edit'
    });
  }
});

router.post('/:id/update', upload.single('foto'), async (req, res) => {
  try {
    const { nim, nama, email } = req.body;
    const file = req.file;
    const mahasiswaRef = db.collection('users').doc(req.params.id);
    const mahasiswaDoc = await mahasiswaRef.get();

    if (!mahasiswaDoc.exists) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan',
        message: 'Mahasiswa tidak ditemukan'
      });
    }
    const oldData = mahasiswaDoc.data();

    const updateData = {
      nim,
      nama,
      email,
      updatedAt: new Date().toISOString(),
    };

    if (file) {
      const folderId = await getMahasiswaFotoFolderId();
      const fileName = `${nim}_${Date.now()}.${file.originalname.split('.').pop()}`;
      const fileMetadata = { name: fileName, parents: [folderId] };
      const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
      const response = await drive.files.create({
        resource: fileMetadata,
        media,
        fields: 'id, webViewLink',
      });
      updateData.foto = response.data.webViewLink;
      updateData.fotoFileId = response.data.id;

      if (oldData.fotoFileId) {
        try {
          await drive.files.delete({ fileId: oldData.fotoFileId });
        } catch (err) {
          console.error('Gagal hapus foto lama:', err);
        }
      }
    }

    if (email !== oldData.email) {
      try {
        await auth.updateUser(req.params.id, { email });
      } catch (authError) {
        console.error('Gagal update email di Auth:', authError);
      }
    }

    await mahasiswaRef.update(updateData);
    res.redirect('/admin/mahasiswa');
  } catch (error) {
    console.error('Error update mahasiswa:', error);
    res.status(500).send('Gagal update mahasiswa: ' + error.message);
  }
});

// ============================================================================
// RESET PASSWORD
// ============================================================================

router.post('/:id/reset-password', async (req, res) => {
  try {
    const mahasiswaDoc = await db.collection('users').doc(req.params.id).get();
    if (!mahasiswaDoc.exists) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan',
        message: 'Mahasiswa tidak ditemukan'
      });
    }
    const email = mahasiswaDoc.data().email;
    await auth.generatePasswordResetLink(email);
    res.redirect(`/admin/mahasiswa/${req.params.id}?reset=email_sent`);
  } catch (error) {
    console.error('Error reset password:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal reset password'
    });
  }
});

// ============================================================================
// KELOLA TAGIHAN SPP
// ============================================================================

router.get('/:id/tagihan/tambah', async (req, res) => {
  try {
    const mahasiswaDoc = await db.collection('users').doc(req.params.id).get();
    if (!mahasiswaDoc.exists) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan',
        message: 'Mahasiswa tidak ditemukan'
      });
    }
    const mahasiswa = mahasiswaDoc.data();
    res.render('admin/tagihan_form', {
      title: 'Tambah Tagihan',
      mahasiswaId: req.params.id,
      mahasiswa,
      tagihan: null
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat form'
    });
  }
});

router.post('/:id/tagihan', async (req, res) => {
  try {
    const { semester, jumlah, jatuhTempo, status } = req.body;
    const mahasiswaId = req.params.id;

    if (!semester || !jumlah) {
      return res.status(400).send('Semester dan jumlah wajib diisi');
    }

    const tagihanRef = db.collection('tagihan').doc(mahasiswaId);
    const tagihanDoc = await tagihanRef.get();
    const existing = tagihanDoc.exists ? tagihanDoc.data() : { semester: [] };

    existing.semester.push({
      id: Date.now().toString(),
      semester,
      jumlah: parseInt(jumlah),
      jatuhTempo: jatuhTempo || null,
      status: status || 'belum lunas',
      createdAt: new Date().toISOString()
    });

    await tagihanRef.set(existing);
    res.redirect(`/admin/mahasiswa/${mahasiswaId}`);
  } catch (error) {
    console.error('Error tambah tagihan:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal menambah tagihan'
    });
  }
});

router.get('/:id/tagihan/:tagihanId/edit', async (req, res) => {
  try {
    const mahasiswaDoc = await db.collection('users').doc(req.params.id).get();
    if (!mahasiswaDoc.exists) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan',
        message: 'Mahasiswa tidak ditemukan'
      });
    }
    const mahasiswa = mahasiswaDoc.data();

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
      mahasiswaId: req.params.id,
      mahasiswa,
      tagihan,
      tagihanId: req.params.tagihanId
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat form edit'
    });
  }
});

router.post('/:id/tagihan/:tagihanId/update', async (req, res) => {
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
    res.redirect(`/admin/mahasiswa/${req.params.id}`);
  } catch (error) {
    console.error('Error update tagihan:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal update tagihan'
    });
  }
});

router.post('/:id/tagihan/:tagihanId/delete', async (req, res) => {
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

    res.redirect(`/admin/mahasiswa/${req.params.id}`);
  } catch (error) {
    console.error('Error hapus tagihan:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal hapus tagihan'
    });
  }
});

// ============================================================================
// HAPUS MAHASISWA
// ============================================================================

router.post('/:id/delete', async (req, res) => {
  try {
    const mahasiswaRef = db.collection('users').doc(req.params.id);
    const mahasiswaDoc = await mahasiswaRef.get();
    if (!mahasiswaDoc.exists) {
      return res.status(404).render('error', {
        title: 'Tidak Ditemukan',
        message: 'Mahasiswa tidak ditemukan'
      });
    }
    const data = mahasiswaDoc.data();

    if (data.fotoFileId) {
      try {
        await drive.files.delete({ fileId: data.fotoFileId });
      } catch (err) {
        console.error('Gagal hapus foto mahasiswa:', err);
      }
    }

    try {
      await auth.deleteUser(req.params.id);
    } catch (authError) {
      console.error('Gagal hapus dari Auth:', authError);
    }

    await db.collection('tagihan').doc(req.params.id).delete();
    await mahasiswaRef.delete();

    res.redirect('/admin/mahasiswa');
  } catch (error) {
    console.error('Error hapus mahasiswa:', error);
    res.status(500).send('Gagal hapus mahasiswa: ' + error.message);
  }
});

module.exports = router;