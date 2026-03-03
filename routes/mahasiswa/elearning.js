/**
 * routes/mahasiswa/elearning.js
 * Modul ELK‑Learning Mahasiswa: jadwal kuliah, tugas, kumpul tugas
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
// FUNGSI BANTU
// ============================================================================

/**
 * Mendapatkan mata kuliah yang diambil mahasiswa (dari enrollment)
 * @param {string} userId - UID mahasiswa
 * @returns {Promise<Array>} daftar mata kuliah dengan detail
 */
async function getMataKuliahDiambil(userId) {
  try {
    const enrollmentSnapshot = await db.collection('enrollment')
      .where('userId', '==', userId)        // ganti dari mahasiswaId
      .where('status', '==', 'active')     // tambahkan filter status
      .get();
    const mkList = [];
    for (const doc of enrollmentSnapshot.docs) {
      const mkId = doc.data().mkId;
      const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
      if (mkDoc.exists) {
        mkList.push({
          id: mkId,
          ...mkDoc.data(),
          enrollmentId: doc.id,
          semester: doc.data().semester,
          tahunAjaran: doc.data().tahunAjaran
        });
      }
    }
    return mkList;
  } catch (error) {
    console.error('Error getMataKuliahDiambil:', error);
    return [];
  }
}

/**
 * Mendapatkan jadwal kuliah (dari field jadwal di mataKuliah)
 * @param {Object} mk - data mata kuliah
 * @returns {string} jadwal kuliah atau pesan default
 */
function getJadwal(mk) {
  return mk.jadwal || 'Jadwal belum diatur';
}

/**
 * Mendapatkan materi pertemuan (dari field materi)
 * @param {Object} mk - data mata kuliah
 * @returns {Array} daftar pertemuan (1‑16)
 */
function getMateri(mk) {
  const materi = mk.materi || [];
  const pertemuanList = [];
  for (let i = 1; i <= 16; i++) {
    const existing = materi.find(m => m.pertemuan === i) || {};
    pertemuanList.push({
      pertemuan: i,
      topik: existing.topik || `Pertemuan ${i}`,
      tanggal: existing.tanggal || null,
      status: existing.status || 'belum',
      fileUrl: existing.fileUrl || null
    });
  }
  return pertemuanList;
}

/**
 * Mendapatkan tugas untuk suatu mata kuliah
 * @param {string} mkId - ID mata kuliah
 * @returns {Promise<Array>} daftar tugas
 */
async function getTugasByMk(mkId) {
  try {
    const snapshot = await db.collection('tugas')
      .where('mkId', '==', mkId)
      .orderBy('deadline', 'asc')
      .get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('Error getTugasByMk:', error);
    return [];
  }
}

/**
 * Mendapatkan status pengumpulan untuk setiap tugas
 * @param {string} tugasId - ID tugas
 * @param {string} mahasiswaId - UID mahasiswa
 * @returns {Promise<Object|null>} data pengumpulan atau null
 */
async function getPengumpulan(tugasId, mahasiswaId) {
  try {
    const snapshot = await db.collection('pengumpulan')
      .where('tugasId', '==', tugasId)
      .where('mahasiswaId', '==', mahasiswaId)   // ← sesuaikan field
      .limit(1)
      .get();
    return snapshot.empty ? null : { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
  } catch (error) {
    console.error('Error getPengumpulan:', error);
    return null;
  }
}

/**
 * Membuat folder di Google Drive untuk jawaban mahasiswa per mata kuliah
 * Struktur: Tugas/[TahunAjaran]/[KodeMK]/Jawaban/[NIM]/
 */
async function getOrCreateJawabanFolder(mk, nim, tahunAjaran) {
  // Asumsikan ada folder utama Tugas (dengan ID di .env)
  const TUGAS_FOLDER_ID = process.env.TUGAS_FOLDER_ID;
  if (!TUGAS_FOLDER_ID) throw new Error('TUGAS_FOLDER_ID tidak didefinisikan');

  // Folder tahun ajaran
  const tahunFolder = await getOrCreateSubFolder(TUGAS_FOLDER_ID, tahunAjaran);
  // Folder mata kuliah
  const mkFolder = await getOrCreateSubFolder(tahunFolder, mk.kode);
  // Folder Jawaban
  const jawabanFolder = await getOrCreateSubFolder(mkFolder, 'Jawaban');
  // Folder NIM
  const nimFolder = await getOrCreateSubFolder(jawabanFolder, nim);
  return nimFolder;
}

async function getOrCreateSubFolder(parentId, name) {
  const query = await drive.files.list({
    q: `'${parentId}' in parents and name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
  });
  if (query.data.files.length > 0) {
    return query.data.files[0].id;
  } else {
    const folder = await drive.files.create({
      resource: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
      fields: 'id',
    });
    return folder.data.id;
  }
}

// ============================================================================
// HALAMAN UTAMA E‑LEARNING
// ============================================================================

/**
 * GET /mahasiswa/elearning
 * Menampilkan daftar mata kuliah yang diambil
 */
router.get('/', async (req, res) => {
  try {
    const mkList = await getMataKuliahDiambil(req.user.id);
    res.render('mahasiswa/elearning/index', { title: 'ELK‑Learning', mkList });
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal memuat halaman e‑learning');
  }
});

// ============================================================================
// DETAIL MATA KULIAH (JADWAL, MATERI, TUGAS)
// ============================================================================

/**
 * GET /mahasiswa/elearning/mk/:id
 * Menampilkan detail mata kuliah: jadwal, materi, daftar tugas
 */
// GET /mahasiswa/elearning/mk/:id
// GET /mahasiswa/elearning/mk/:id
// GET /mahasiswa/elearning/mk/:id
// GET /mahasiswa/elearning/mk/:id
router.get('/mk/:id', async (req, res) => {
  try {
    const mkId = req.params.id;
    const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
    if (!mkDoc.exists) return res.status(404).send('Mata kuliah tidak ditemukan');
    const mk = { id: mkId, ...mkDoc.data() };

    // Verifikasi mahasiswa terdaftar di MK ini
    const enrollmentSnapshot = await db.collection('enrollment')
      .where('userId', '==', req.user.id)   // ← ganti dari mahasiswaId ke userId
      .where('mkId', '==', mkId)
      .where('status', '==', 'active')
      .get();
    if (enrollmentSnapshot.empty) {
      return res.status(403).send('Anda tidak terdaftar di mata kuliah ini');
    }

    // Jadwal
    const jadwal = mk.jadwal || 'Jadwal belum diatur';

    // Materi pertemuan
    const materi = mk.materi || [];
    const pertemuanList = [];
    for (let i = 1; i <= 16; i++) {
      const existing = materi.find(m => m.pertemuan === i) || {};
      pertemuanList.push({
        pertemuan: i,
        topik: existing.topik || `Pertemuan ${i}`,
        tanggal: existing.tanggal || null,
        status: existing.status || 'belum',
        fileUrl: existing.fileUrl || null
      });
    }

    // Dosen pengampu
    const dosenList = [];
    if (mk.dosenIds && mk.dosenIds.length > 0) {
      for (const dId of mk.dosenIds) {
        const dDoc = await db.collection('dosen').doc(dId).get();
        if (dDoc.exists) {
          dosenList.push({ id: dId, nama: dDoc.data().nama });
        }
      }
    }

    // Hitung jumlah mahasiswa terdaftar (aktif)
    const countSnapshot = await db.collection('enrollment')
      .where('mkId', '==', mkId)
      .where('status', '==', 'active')
      .count()
      .get();
    const jumlahMahasiswa = countSnapshot.data().count;

    // Tugas
    const tugasSnapshot = await db.collection('tugas')
      .where('mkId', '==', mkId)
      .orderBy('deadline', 'asc')
      .get();
    const tugasList = [];
    for (const doc of tugasSnapshot.docs) {
      const tugas = { id: doc.id, ...doc.data() };
      // Cek status pengumpulan
      const pengumpulan = await getPengumpulan(tugas.id, req.user.id);
      tugas.pengumpulan = pengumpulan;
      tugasList.push(tugas);
    }

    res.render('mahasiswa/elearning/mk_detail', {
      title: `${mk.kode} - ${mk.nama}`,
      mk,
      jadwal,
      materi: pertemuanList,
      dosenList,
      jumlahMahasiswa,   // ← pastikan variabel ini dikirim
      tugasList
    });
  } catch (error) {
    console.error('Error detail MK:', error);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Gagal memuat detail mata kuliah' 
    });
  }
});
// ============================================================================
// DETAIL TUGAS & KUMPUL TUGAS
// ============================================================================

/**
 * GET /mahasiswa/elearning/tugas/:id
 * Menampilkan detail tugas dan form upload (jika belum dikumpul)
 */
// GET /mahasiswa/elearning/tugas/:id
// GET /mahasiswa/elearning/tugas/:id
router.get('/tugas/:id', async (req, res) => {
  try {
    const tugasId = req.params.id;
    const tugasDoc = await db.collection('tugas').doc(tugasId).get();
    if (!tugasDoc.exists) return res.status(404).send('Tugas tidak ditemukan');
    const tugas = { id: tugasId, ...tugasDoc.data() };

    // Verifikasi mahasiswa terdaftar
    const enrollmentSnapshot = await db.collection('enrollment')
      .where('userId', '==', req.user.id)
      .where('mkId', '==', tugas.mkId)
      .where('status', '==', 'active')
      .get();
    if (enrollmentSnapshot.empty) {
      return res.status(403).send('Anda tidak terdaftar di mata kuliah tugas ini');
    }

    // Ambil data mata kuliah
    const mkDoc = await db.collection('mataKuliah').doc(tugas.mkId).get();
    const mk = mkDoc.exists ? { id: mkDoc.id, ...mkDoc.data() } : { kode: '-', nama: '-' };

    const pengumpulan = await getPengumpulan(tugasId, req.user.id);

    // Hitung apakah deadline sudah lewat
    const deadline = new Date(tugas.deadline);
    const sekarang = new Date();
    const deadlineLewat = deadline < sekarang;

    res.render('mahasiswa/elearning/tugas_detail', {
      title: tugas.judul,
      tugas,
      mk,
      pengumpulan,
      deadlineLewat,           // <-- kirim ke view
      sekarang: sekarang.toISOString()
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Gagal memuat detail tugas');
  }
});

/**
 * POST /mahasiswa/elearning/tugas/:id/kumpul
 * Upload jawaban tugas ke Google Drive
 */
router.post('/tugas/:id/kumpul', upload.single('file'), async (req, res) => {
  try {
    const tugasId = req.params.id;
    const file = req.file;
    if (!file) return res.status(400).send('Pilih file terlebih dahulu');

    const tugasDoc = await db.collection('tugas').doc(tugasId).get();
    if (!tugasDoc.exists) return res.status(404).send('Tugas tidak ditemukan');
    const tugas = tugasDoc.data();

    // Verifikasi mahasiswa terdaftar
    const enrollmentSnapshot = await db.collection('enrollment')
      .where('userId', '==', req.user.id)      // ganti
      .where('mkId', '==', tugas.mkId)
      .where('status', '==', 'active')         // tambahkan
      .get();
    if (enrollmentSnapshot.empty) {
      return res.status(403).send('Anda tidak terdaftar di mata kuliah ini');
    }

    // Cek apakah sudah pernah mengumpul
    const existing = await getPengumpulan(tugasId, req.user.id);
    if (existing) {
      return res.status(400).send('Anda sudah mengumpulkan tugas ini. Hapus terlebih dahulu jika ingin mengganti file.');
    }

    // Dapatkan data MK untuk kode dan tahun ajaran
    const mkDoc = await db.collection('mataKuliah').doc(tugas.mkId).get();
    const mk = mkDoc.data();
    // Ambil tahun ajaran dari enrollment (asumsi semua sama, bisa diambil dari salah satu)
    const enrollment = enrollmentSnapshot.docs[0].data();
    const tahunAjaran = enrollment.tahunAjaran || '2025/2026';

    const nim = req.user.nim;
    const nama = req.user.nama;

    // Buat folder jawaban
    const folderId = await getOrCreateJawabanFolder({ kode: mk.kode }, nim, tahunAjaran);

    // Nama file: NIM_JudulTugas_Timestamp.pdf
    const ext = file.originalname.split('.').pop();
    const fileName = `${nim}_${tugas.judul.replace(/\s+/g, '_')}_${Date.now()}.${ext}`;
    const fileMetadata = { name: fileName, parents: [folderId] };
    const media = { mimeType: file.mimetype, body: Readable.from(file.buffer) };
    const response = await drive.files.create({ resource: fileMetadata, media, fields: 'id, webViewLink' });

    // Simpan ke collection pengumpulan
    await db.collection('pengumpulan').add({
      tugasId,
      mahasiswaId: req.user.id,
      fileUrl: response.data.webViewLink,
      fileId: response.data.id,
      submittedAt: new Date().toISOString(),
      status: 'dikumpulkan',
      nilai: null,
      komentar: null
    });

    res.redirect(`/mahasiswa/elearning/tugas/${tugasId}`);
  } catch (error) {
    console.error('Gagal upload tugas:', error);
    res.status(500).send('Upload gagal: ' + error.message);
  }
});

/**
 * POST /mahasiswa/elearning/tugas/:id/hapus
 * Hapus pengumpulan (jika deadline belum lewat atau diizinkan)
 */
router.post('/tugas/:id/hapus', async (req, res) => {
  try {
    const tugasId = req.params.id;
    const pengumpulan = await getPengumpulan(tugasId, req.user.id);
    if (!pengumpulan) return res.status(404).send('Tidak ada pengumpulan untuk dihapus');

    // Opsional: cek deadline
    const tugasDoc = await db.collection('tugas').doc(tugasId).get();
    const deadline = new Date(tugasDoc.data().deadline);
    if (deadline < new Date()) {
      return res.status(400).send('Tidak dapat menghapus karena deadline telah lewat');
    }

    // Hapus file dari Drive
    if (pengumpulan.fileId) {
      try {
        await drive.files.delete({ fileId: pengumpulan.fileId });
      } catch (err) {
        console.error('Gagal hapus file Drive:', err);
      }
    }

    // Hapus dari Firestore
    await db.collection('pengumpulan').doc(pengumpulan.id).delete();

    res.redirect(`/mahasiswa/elearning/tugas/${tugasId}`);
  } catch (error) {
    console.error('Gagal hapus pengumpulan:', error);
    res.status(500).send('Gagal menghapus pengumpulan');
  }
});

module.exports = router;