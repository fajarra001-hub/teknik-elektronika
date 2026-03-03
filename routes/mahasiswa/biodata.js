/**
 * routes/mahasiswa/biodata.js
 * Biodata Mahasiswa – lihat dan edit profil, foto, nomor HP, ubah password
 */

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../middleware/auth');
const { db, auth } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive');
const { Readable } = require('stream');
const multer = require('multer');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // Batas 5MB
});

// Semua route memerlukan autentikasi
router.use(verifyToken);

// ============================================================================
// FUNGSI BANTU
// ============================================================================

/**
 * Mendapatkan ID folder foto mahasiswa di Google Drive.
 * Membuat folder jika belum ada.
 */
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

// ============================================================================
// RUTE UTAMA – TAMPIL BIODATA
// ============================================================================

/**
 * GET /mahasiswa/biodata
 * Menampilkan halaman biodata mahasiswa (data dari req.user)
 */
router.get('/', (req, res) => {
  try {
    const user = req.user; // data dari middleware verifyToken (sudah include data dari Firestore)
    res.render('mahasiswa/biodata/index', {
      title: 'Biodata Saya',
      user,
      success: req.query.success,
      reset: req.query.reset
    });
  } catch (error) {
    console.error('Error memuat biodata:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat biodata'
    });
  }
});

// ============================================================================
// FORM EDIT BIODATA
// ============================================================================

/**
 * GET /mahasiswa/biodata/edit
 * Form edit biodata
 */
router.get('/edit', (req, res) => {
  try {
    res.render('mahasiswa/biodata/edit', {
      title: 'Edit Biodata',
      user: req.user
    });
  } catch (error) {
    console.error('Error memuat form edit:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat form edit'
    });
  }
});

/**
 * POST /mahasiswa/biodata/edit
 * Memperbarui biodata mahasiswa (nama, email, noHp, foto)
 */
router.post('/edit', upload.single('foto'), async (req, res) => {
  try {
    console.log('🚀 Route POST /mahasiswa/biodata/edit dipanggil');
    const { nama, email, noHp } = req.body;
    const file = req.file;
    const userId = req.user.id;
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).send('Data mahasiswa tidak ditemukan');
    }
    const oldData = userDoc.data();

    // Validasi input
    if (!nama || !email) {
      return res.status(400).send('Nama dan email wajib diisi');
    }

    // Data yang akan diupdate
    const updateData = {
      nama,
      email,
      noHp: noHp || '',
      updatedAt: new Date().toISOString()
    };

    // Proses foto jika ada file baru
    if (file) {
      // Validasi tipe file (hanya gambar)
      if (!file.mimetype.startsWith('image/')) {
        return res.status(400).send('File harus berupa gambar');
      }

      // Validasi ukuran file (maks 5MB)
      if (file.size > 5 * 1024 * 1024) {
        return res.status(400).send('Ukuran file maksimal 5MB');
      }

      // Hapus foto lama jika ada
      if (oldData.fotoFileId) {
        try {
          await drive.files.delete({ fileId: oldData.fotoFileId });
          console.log('Foto lama dihapus:', oldData.fotoFileId);
        } catch (err) {
          console.error('Gagal hapus foto lama:', err.message);
          // Tetap lanjut, foto lama mungkin sudah tidak ada
        }
      }

      // Upload foto baru ke Google Drive
      const folderId = await getMahasiswaFotoFolderId();
      const ext = file.originalname.split('.').pop();
      const fileName = `${req.user.nim || 'mahasiswa'}_${Date.now()}.${ext}`;
      const fileMetadata = { name: fileName, parents: [folderId] };
      const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
      const response = await drive.files.create({
        resource: fileMetadata,
        media,
        fields: 'id, webViewLink',
      });

      // Beri akses publik (wajib!)
      await drive.permissions.create({
        fileId: response.data.id,
        requestBody: {
          role: 'reader',
          type: 'anyone'
        }
      });
      console.log('File diupload ke Drive, ID:', response.data.id);

      // Simpan URL publik (format langsung) dan fileId
      updateData.foto = `https://drive.google.com/uc?export=view&id=${response.data.id}`;
      updateData.fotoFileId = response.data.id;
    }

    // Update email di Firebase Auth jika berubah
    if (email !== oldData.email) {
      try {
        await auth.updateUser(userId, { email });
        console.log('Email di Auth diperbarui');
      } catch (authError) {
        console.error('Gagal update email di Auth:', authError);
        return res.status(400).send('Email sudah digunakan atau tidak valid');
      }
    }

    // Simpan perubahan ke Firestore
    await userRef.update(updateData);
    console.log('Data Firestore berhasil diperbarui');

    // Redirect dengan pesan sukses
    res.redirect('/mahasiswa/biodata?success=updated');
  } catch (error) {
    console.error('Error update biodata:', error);
    // Jika error dari Google Drive atau lainnya, beri pesan yang jelas
    let message = 'Gagal update biodata';
    if (error.code === 403) {
      message = 'Izin akses Google Drive tidak mencukupi';
    } else if (error.code === 404) {
      message = 'Folder atau file tidak ditemukan di Drive';
    } else {
      message = error.message;
    }
    res.status(500).send('Gagal update biodata: ' + message);
  }
});

// ============================================================================
// HAPUS FOTO PROFIL
// ============================================================================

/**
 * POST /mahasiswa/biodata/foto/hapus
 * Menghapus foto profil (tanpa mengganti)
 */
router.post('/foto/hapus', async (req, res) => {
  try {
    const userId = req.user.id;
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).send('Data mahasiswa tidak ditemukan');
    }
    const data = userDoc.data();

    if (data.fotoFileId) {
      try {
        await drive.files.delete({ fileId: data.fotoFileId });
        console.log('Foto dihapus dari Drive, ID:', data.fotoFileId);
      } catch (err) {
        console.error('Gagal hapus file dari Drive:', err.message);
      }
    }

    await userRef.update({
      foto: null,
      fotoFileId: null,
      updatedAt: new Date().toISOString()
    });

    res.redirect('/mahasiswa/biodata?success=foto_hapus');
  } catch (error) {
    console.error('Error hapus foto:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal hapus foto'
    });
  }
});

// ============================================================================
// UBAH PASSWORD (mengirim email reset)
// ============================================================================

/**
 * POST /mahasiswa/biodata/ubah-password
 * Mengirim email reset password ke email mahasiswa
 */
router.post('/ubah-password', async (req, res) => {
  try {
    const email = req.user.email;
    if (!email) {
      return res.status(400).send('Email tidak ditemukan');
    }

    // Generate password reset link (tidak mengirim email secara otomatis)
    const link = await auth.generatePasswordResetLink(email);
    console.log('Password reset link:', link);

    // Redirect dengan pesan sukses
    res.redirect('/mahasiswa/biodata?reset=email_sent');
  } catch (error) {
    console.error('Error reset password:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal mengirim email reset password'
    });
  }
});

module.exports = router;