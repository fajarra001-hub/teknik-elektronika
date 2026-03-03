/**
 * routes/mahasiswa/akademik.js
 * Modul Akademik Mahasiswa: KRS, KHS, Transkrip, Kalender Akademik
 */

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');
const drive = require('../../config/googleDrive');
const { Readable } = require('stream');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// Semua route memerlukan autentikasi
router.use(verifyToken);

// ============================================================================
// FUNGSI BANTU (HELPER)
// ============================================================================

/**
 * Mendapatkan data mahasiswa dari req.user (sudah diisi verifyToken)
 */
function getMahasiswa(user) {
  return {
    nim: user.nim,
    nama: user.nama,
    prodi: 'Teknik Elektronika',
    angkatan: user.nim && user.nim.length >= 2 ? '20' + user.nim.substring(0, 2) : '-'
  };
}

/**
 * Menentukan folder angkatan di Google Drive
 */
async function getOrCreateFolder(parentId, namaFolder) {
  const query = await drive.files.list({
    q: `'${parentId}' in parents and name='${namaFolder}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
  });
  if (query.data.files.length > 0) {
    return query.data.files[0].id;
  } else {
    const folder = await drive.files.create({
      resource: { name: namaFolder, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
      fields: 'id',
    });
    return folder.data.id;
  }
}

// ============================================================================
// HALAMAN UTAMA AKADEMIK
// ============================================================================

/**
 * GET /mahasiswa/akademik
 * Menampilkan ringkasan akademik mahasiswa (menu navigasi)
 */
router.get('/', async (req, res) => {
  try {
    res.render('mahasiswa/akademik', { title: 'Akademik', user: req.user });
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal memuat halaman akademik');
  }
});

// ============================================================================
// KARTU RENCANA STUDI (KRS)
// ============================================================================

/**
 * GET /mahasiswa/akademik/krs
 * Daftar KRS yang pernah dibuat
 */
router.get('/krs', async (req, res) => {
  try {
    const snapshot = await db.collection('krs')
      .where('userId', '==', req.user.id)
      .orderBy('createdAt', 'desc')
      .get();

    const krsList = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const mkIds = data.mataKuliah || []; // field menyimpan array ID mata kuliah

      // Ambil detail 3 mata kuliah pertama untuk preview
      const courses = [];
      for (const mkId of mkIds.slice(0, 3)) {
        if (!mkId) continue; // lewati jika ID kosong
        try {
          const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
          if (mkDoc.exists) {
            courses.push({
              kode: mkDoc.data().kode,
              nama: mkDoc.data().nama,
              sks: mkDoc.data().sks
            });
          }
        } catch (err) {
          console.error(`Gagal ambil mata kuliah ${mkId}:`, err.message);
        }
      }

      krsList.push({
        id: doc.id,
        ...data,
        courses,
        courseCount: mkIds.length
      });
    }

    res.render('mahasiswa/krs_list', {
      title: 'Daftar KRS',
      user: req.user,
      krsList
    });
  } catch (error) {
    console.error(error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat KRS' });
  }
});

/**
 * GET /mahasiswa/akademik/krs/baru
 * Form buat KRS baru (pilih mata kuliah)
 */
router.get('/krs/baru', async (req, res) => {
  try {
    const coursesSnapshot = await db.collection('mataKuliah').orderBy('kode').get();
    const courses = coursesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('mahasiswa/krs_form', { user: req.user, courses });
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal memuat data mata kuliah');
  }
});

/**
 * POST /mahasiswa/akademik/krs
 * Simpan KRS baru
 */
router.post('/krs', async (req, res) => {
  try {
    const { semester, courses } = req.body;
    
    if (!semester || !courses) {
      return res.status(400).send('Semester dan mata kuliah harus diisi');
    }

    const krsData = {
      userId: req.user.id,
      semester,
      mataKuliah: JSON.parse(courses), // simpan sebagai array ID
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    
    const docRef = await db.collection('krs').add(krsData);
    res.redirect(`/mahasiswa/akademik/krs/${docRef.id}`);
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal menyimpan KRS');
  }
});

/**
 * GET /mahasiswa/akademik/krs/:id
 * Detail KRS dan upload file
 */
router.get('/krs/:id', async (req, res) => {
  try {
    const krsDoc = await db.collection('krs').doc(req.params.id).get();
    if (!krsDoc.exists) return res.status(404).send('KRS tidak ditemukan');
    const krs = { id: krsDoc.id, ...krsDoc.data() };
    if (krs.userId !== req.user.id) return res.status(403).send('Akses ditolak');

    // Ambil detail mata kuliah
    const mkIds = krs.mataKuliah || [];
    const mkList = [];
    for (const mkId of mkIds) {
      if (!mkId) continue;
      try {
        const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
        if (mkDoc.exists) {
          mkList.push({
            id: mkId,
            kode: mkDoc.data().kode,
            nama: mkDoc.data().nama,
            sks: mkDoc.data().sks
          });
        }
      } catch (err) {
        console.error(`Gagal ambil mata kuliah ${mkId}:`, err.message);
      }
    }

    res.render('mahasiswa/krs_detail', {
      user: req.user,
      krs,
      mkList
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal memuat detail KRS');
  }
});

/**
 * POST /mahasiswa/akademik/krs/:id/upload
 * Upload file KRS ke Google Drive (struktur folder otomatis)
 */
router.post('/krs/:id/upload', upload.single('file'), async (req, res) => {
  try {
    const krsDoc = await db.collection('krs').doc(req.params.id).get();
    if (!krsDoc.exists) return res.status(404).send('KRS tidak ditemukan');
    const krsData = krsDoc.data();
    if (krsData.userId !== req.user.id) return res.status(403).send('Akses ditolak');

    const file = req.file;
    if (!file) return res.status(400).send('Tidak ada file');

    const user = req.user;
    const nim = user.nim;
    const nama = user.nama;
    const angkatan = nim && nim.length >= 2 ? '20' + nim.substring(0, 2) : new Date().getFullYear().toString();

    // Gunakan environment variable KRS_FOLDER_ID (pastikan di .env)
    const rootFolderId = process.env.KRS_FOLDER_ID;
    if (!rootFolderId) throw new Error('KRS_FOLDER_ID tidak diatur di environment');

    const folderAngkatanId = await getOrCreateFolder(rootFolderId, angkatan);
    const folderMahasiswaId = await getOrCreateFolder(folderAngkatanId, `${nama.replace(/\s+/g, '_')}_${nim}`);

    const fileName = `KRS_${krsData.semester.replace(/\s+/g, '_')}.pdf`;
    const fileMetadata = { name: fileName, parents: [folderMahasiswaId] };
    const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
    const response = await drive.files.create({ resource: fileMetadata, media, fields: 'id, webViewLink' });

    // Beri permission publik
    await drive.permissions.create({
      fileId: response.data.id,
      requestBody: { role: 'reader', type: 'anyone' }
    });

    const directLink = `https://drive.google.com/uc?export=view&id=${response.data.id}`;
    await db.collection('krs').doc(req.params.id).update({
      driveFileId: response.data.id,
      driveFileLink: directLink,
      driveFolder: `${angkatan}/${folderMahasiswaId}`
    });

    res.redirect(`/mahasiswa/akademik/krs/${req.params.id}`);
  } catch (error) {
    console.error('Gagal upload KRS:', error);
    res.status(500).send('Upload gagal: ' + error.message);
  }
});

// ============================================================================
// KARTU HASIL STUDI (KHS)
// ============================================================================

/**
 * GET /mahasiswa/akademik/khs
 * Daftar KHS per semester (dengan filter)
 */
router.get('/khs', async (req, res) => {
  try {
    const { semester } = req.query;

    // Ambil semua KHS milik mahasiswa ini
    let khsQuery = db.collection('khs')
      .where('userId', '==', req.user.id)
      .orderBy('semester', 'asc');

    if (semester) {
      khsQuery = khsQuery.where('semester', '==', semester);
    }

    const khsSnapshot = await khsQuery.get();
    const khsList = khsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Ambil daftar semester unik untuk filter
    const allKhsSnapshot = await db.collection('khs')
      .where('userId', '==', req.user.id)
      .get();
    const semesterSet = new Set();
    allKhsSnapshot.docs.forEach(doc => {
      if (doc.data().semester) semesterSet.add(doc.data().semester);
    });
    const semesterList = Array.from(semesterSet).sort();

    res.render('mahasiswa/khs_list', {
      title: 'Kartu Hasil Studi (KHS)',
      user: req.user,
      khsList,
      semesterList,
      filters: { semester: semester || '' }
    });
  } catch (error) {
    console.error(error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat KHS' });
  }
});

/**
 * GET /mahasiswa/akademik/khs/:id
 * Detail KHS
 */
router.get('/khs/:id', async (req, res) => {
  try {
    const khsDoc = await db.collection('khs').doc(req.params.id).get();
    if (!khsDoc.exists) return res.status(404).send('KHS tidak ditemukan');
    const khs = { id: khsDoc.id, ...khsDoc.data() };
    if (khs.userId !== req.user.id) return res.status(403).send('Akses ditolak');

    res.render('mahasiswa/khs_detail', {
      title: 'Detail KHS',
      user: req.user,
      khs
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal memuat detail KHS');
  }
});

// ============================================================================
// TRANSKRIP NILAI
// ============================================================================

/**
 * GET /mahasiswa/akademik/transkrip
 * Menampilkan transkrip nilai (dari collection grades)
 */
router.get('/transkrip', async (req, res) => {
  try {
    // Query grades dengan indeks yang diperlukan (pastikan indeks sudah dibuat)
    const gradesSnapshot = await db.collection('grades')
      .where('userId', '==', req.user.id)
      .orderBy('semester', 'asc')
      .get();

    const grades = gradesSnapshot.docs.map(doc => doc.data());

    // Hitung IPK
    let totalSKS = 0, totalNilai = 0;
    grades.forEach(g => {
      totalSKS += g.sks;
      totalNilai += g.sks * g.nilai;
    });
    const ipk = totalSKS > 0 ? (totalNilai / totalSKS).toFixed(2) : 0;

    res.render('mahasiswa/transkrip', {
      title: 'Transkrip Nilai',
      user: req.user,
      grades,
      ipk
    });
  } catch (error) {
    console.error(error);
    // Jika error karena indeks, beri pesan yang lebih ramah
    if (error.code === 9) {
      return res.status(500).render('error', {
        title: 'Error',
        message: 'Fitur transkrip membutuhkan indeks database. Silakan hubungi administrator.'
      });
    }
    res.status(500).send('Gagal memuat transkrip');
  }
});

// ============================================================================
// KALENDER AKADEMIK
// ============================================================================

/**
 * GET /mahasiswa/akademik/kalender
 * Menampilkan kalender akademik (dari collection kalenderAkademik)
 */
router.get('/kalender', async (req, res) => {
  try {
    const now = new Date().toISOString();
    const snapshot = await db.collection('kalenderAkademik')
      .where('tanggal', '>=', now)
      .orderBy('tanggal', 'asc')
      .get();
    const events = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.render('mahasiswa/kalender', { title: 'Kalender Akademik', user: req.user, events });
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal memuat kalender');
  }
});

module.exports = router;