/**
 * routes/dosen/biodata.js
 * Biodata Dosen - Lihat dan edit profil, foto, kontak, email, ubah password
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isDosen } = require('../../middleware/auth');
const { db, auth } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive');
const { Readable } = require('stream');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

router.use(verifyToken);
router.use(isDosen);

// ============================================================================
// FUNGSI BANTU
// ============================================================================

/**
 * Mendapatkan ID folder foto dosen di Google Drive.
 * Membuat folder jika belum ada.
 */
async function getDosenFotoFolderId() {
  const folderName = 'Foto_Dosen';
  try {
    const query = await drive.files.list({
      q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id)',
    });
    if (query.data.files.length > 0) {
      console.log('✅ Folder ditemukan:', query.data.files[0].id);
      return query.data.files[0].id;
    } else {
      console.log('📁 Folder tidak ditemukan, membuat baru...');
      const folder = await drive.files.create({
        resource: { name: folderName, mimeType: 'application/vnd.google-apps.folder' },
        fields: 'id',
      });
      console.log('✅ Folder dibuat:', folder.data.id);
      return folder.data.id;
    }
  } catch (error) {
    console.error('❌ Error saat mengakses folder Drive:', error);
    throw error;
  }
}

// ============================================================================
// RUTE UTAMA – TAMPIL BIODATA
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const dosenRef = db.collection('dosen').doc(req.dosen.id);
    const dosenDoc = await dosenRef.get();
    if (!dosenDoc.exists) {
      return res.status(404).render('error', {
        title: 'Error',
        message: 'Data dosen tidak ditemukan'
      });
    }
    const dosen = { id: req.dosen.id, ...dosenDoc.data() };

    res.render('dosen/biodata', {
      title: 'Biodata Saya',
      dosen,
      success: req.query.success,
      reset: req.query.reset
    });
  } catch (error) {
    console.error('❌ Error memuat biodata:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal memuat biodata'
    });
  }
});

// ============================================================================
// UPDATE BIODATA
// ============================================================================

router.post('/update', upload.single('foto'), async (req, res) => {
  try {
    const { nama, kontak, email } = req.body;
    const file = req.file;
    const dosenRef = db.collection('dosen').doc(req.dosen.id);
    const oldData = req.dosen;

    // Validasi input
    if (!nama || !email) {
      return res.status(400).send('Nama dan email wajib diisi');
    }

    const updateData = {
      nama,
      kontak: kontak || '',
      email,
      updatedAt: new Date().toISOString()
    };

    // ========== PROSES UPLOAD FOTO ==========
    if (file) {
      console.log('📸 File diterima:', file.originalname, file.mimetype, file.size);

      // Validasi tipe file
      if (!file.mimetype.startsWith('image/')) {
        return res.status(400).send('File harus berupa gambar');
      }

      // Hapus foto lama jika ada
      if (oldData.fotoFileId) {
        try {
          await drive.files.delete({ fileId: oldData.fotoFileId });
          console.log('🗑️ Foto lama dihapus:', oldData.fotoFileId);
        } catch (err) {
          console.error('⚠️ Gagal hapus foto lama (mungkin sudah tidak ada):', err.message);
        }
      }

      // Dapatkan folder tujuan
      let folderId;
      try {
        folderId = await getDosenFotoFolderId();
      } catch (err) {
        console.error('❌ Gagal mendapatkan folder Drive:', err);
        return res.status(500).send('Gagal mengakses folder penyimpanan');
      }

      const ext = file.originalname.split('.').pop();
      const fileName = `${oldData.nip || 'dosen'}_${Date.now()}.${ext}`;
      const fileMetadata = {
        name: fileName,
        parents: [folderId]
      };
      const media = {
        mimeType: file.mimetype,
        body: Readable.from(file.buffer)
      };

      // Upload file ke Drive
      let driveResponse;
      try {
        driveResponse = await drive.files.create({
          resource: fileMetadata,
          media,
          fields: 'id, webViewLink'
        });
        console.log('✅ File uploaded ke Drive:', driveResponse.data);
      } catch (uploadError) {
        console.error('❌ Gagal upload ke Drive:', uploadError);
        return res.status(500).send('Gagal upload foto: ' + uploadError.message);
      }

      // Set permission agar bisa diakses publik
      try {
        await drive.permissions.create({
          fileId: driveResponse.data.id,
          requestBody: {
            role: 'reader',
            type: 'anyone'
          }
        });
        console.log('🔓 Permission publik diberikan');
      } catch (permError) {
        console.error('⚠️ Gagal set permission (file mungkin tetap private):', permError.message);
        // Tetap lanjut, mungkin tetap bisa diakses dengan link
      }

      // Simpan link dan fileId ke Firestore
      const directLink = `https://drive.google.com/uc?export=view&id=${driveResponse.data.id}`;
      updateData.foto = directLink;
      updateData.fotoFileId = driveResponse.data.id;
    }

    // Update email di Firebase Auth jika berubah
    if (email !== oldData.email) {
      try {
        await auth.updateUser(req.user.uid, { email });
        console.log('📧 Email di Auth diperbarui');
      } catch (authError) {
        console.error('❌ Gagal update email di Auth:', authError);
        return res.status(400).send('Email sudah digunakan atau tidak valid');
      }
    }

    // Simpan perubahan ke Firestore
    await dosenRef.update(updateData);
    console.log('💾 Data Firestore diperbarui');

    res.redirect('/dosen/biodata?success=updated');
  } catch (error) {
    console.error('❌ Error update biodata:', error);
    res.status(500).send('Gagal update biodata: ' + error.message);
  }
});

// ============================================================================
// UBAH PASSWORD
// ============================================================================

router.post('/ubah-password', async (req, res) => {
  try {
    const email = req.dosen.email;
    if (!email) {
      return res.status(400).send('Email tidak ditemukan');
    }

    await auth.generatePasswordResetLink(email);
    console.log('📧 Link reset password dikirim ke:', email);
    res.redirect('/dosen/biodata?reset=email_sent');
  } catch (error) {
    console.error('❌ Error reset password:', error);
    res.status(500).send('Gagal mengirim email reset password');
  }
});

module.exports = router;