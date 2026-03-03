/**
 * routes/dosen/nilai.js
 * Rekap Nilai & Input Nilai untuk Dosen
 * Menampilkan daftar mata kuliah yang diampu, rekap nilai per MK, dan input nilai (tugas, UTS, UAS)
 */

const express = require('express');
const router = express.Router();
const { verifyToken, isDosen } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');

router.use(verifyToken);
router.use(isDosen);

// ============================================================================
// FUNGSI BANTU
// ============================================================================

/**
 * Mendapatkan data mahasiswa dari UID
 */
async function getMahasiswaById(uid) {
  try {
    const userDoc = await db.collection('users').doc(uid).get();
    if (userDoc.exists) {
      return { id: uid, ...userDoc.data() };
    }
    return { id: uid, nama: 'Unknown', nim: '-' };
  } catch (error) {
    console.error('Error getMahasiswaById:', error);
    return { id: uid, nama: 'Error', nim: '-' };
  }
}

/**
 * Mendapatkan data nilai untuk suatu MK dan mahasiswa tertentu
 * Mengembalikan object dengan tipe nilai sebagai key (tugas1, uts, uas, dll)
 */
async function getNilaiByMkAndMahasiswa(mkId, mahasiswaId) {
  try {
    const snapshot = await db.collection('nilai')
      .where('mkId', '==', mkId)
      .where('mahasiswaId', '==', mahasiswaId)
      .get();
    
    const nilaiMap = {};
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      nilaiMap[data.tipe] = {
        id: doc.id,
        nilai: data.nilai,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt
      };
    });
    return nilaiMap;
  } catch (error) {
    console.error('Error getNilaiByMkAndMahasiswa:', error);
    return {};
  }
}

// ============================================================================
// DAFTAR MATA KULIAH (PILIH MK UNTUK LIHAT REKAP)
// ============================================================================

router.get('/', async (req, res) => {
  try {
    const mkSnapshot = await db.collection('mataKuliah')
      .where('dosenIds', 'array-contains', req.dosen.id) // gunakan req.dosen.id, bukan req.user.id
      .orderBy('semester', 'desc')
      .orderBy('kode')
      .get();
    
    const mkList = [];
    for (const doc of mkSnapshot.docs) {
      const mk = { id: doc.id, ...doc.data() };
      
      // Hitung jumlah mahasiswa yang mengambil MK ini (dari enrollment)
      const enrollmentSnapshot = await db.collection('enrollment')
        .where('mkId', '==', doc.id)
        .where('status', '==', 'active')
        .get();
      mk.jumlahMahasiswa = enrollmentSnapshot.size;
      
      mkList.push(mk);
    }

    res.render('dosen/nilai_pilih_mk', {
      title: 'Rekap Nilai - Pilih Mata Kuliah',
      mkList
    });
  } catch (error) {
    console.error('Error mengambil daftar MK:', error);
    res.status(500).render('error', { 
      title: 'Error',
      message: 'Gagal mengambil data mata kuliah' 
    });
  }
});

// ============================================================================
// REKAP NILAI PER MATA KULIAH
// ============================================================================

/**
 * GET /dosen/nilai/:mkId
 * Menampilkan rekap nilai semua mahasiswa untuk MK tertentu
 */
router.get('/:mkId', async (req, res) => {
  try {
    const { mkId } = req.params;

    // Ambil data MK
    const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
    if (!mkDoc.exists) {
      return res.status(404).send('Mata kuliah tidak ditemukan');
    }
    const mk = { id: mkDoc.id, ...mkDoc.data() };

    // Ambil semua mahasiswa yang terdaftar di MK ini (dari enrollment aktif)
    const enrollmentSnapshot = await db.collection('enrollment')
      .where('mkId', '==', mkId)
      .where('status', '==', 'active')
      .get();

    const mahasiswaIds = enrollmentSnapshot.docs.map(d => d.data().userId);

    // Ambil data mahasiswa dan nilai
    const data = [];
    for (const uid of mahasiswaIds) {
      const mahasiswa = await getMahasiswaById(uid);
      const nilaiMap = await getNilaiByMkAndMahasiswa(mkId, uid);
      data.push({ mahasiswa, nilai: nilaiMap });
    }

    // Urutkan berdasarkan NIM
    data.sort((a, b) => a.mahasiswa.nim.localeCompare(b.mahasiswa.nim));

    // === Dapatkan daftar tipe nilai unik ===
    // 1. Dari semua dokumen nilai pada MK ini
    const nilaiSnapshot = await db.collection('nilai')
      .where('mkId', '==', mkId)
      .get();
    const tipeSet = new Set();
    nilaiSnapshot.docs.forEach(doc => tipeSet.add(doc.data().tipe));

    // 2. Dari judul tugas pada MK ini (asumsikan judul tugas menjadi tipe nilai)
    const tugasSnapshot = await db.collection('tugas')
      .where('mkId', '==', mkId)
      .get();
    tugasSnapshot.docs.forEach(doc => {
      const judul = doc.data().judul;
      // Anda bisa menambahkan logika untuk memfilter judul yang relevan
      if (judul) tipeSet.add(judul);
    });

    // Ubah Set menjadi Array dan urutkan secara alami (misal: Tugas 1, Tugas 2, ...)
    const tipeList = Array.from(tipeSet).sort((a, b) => {
      // Urutkan berdasarkan angka jika ada, jika tidak, berdasarkan abjad
      const aNum = parseInt(a.match(/\d+/)?.[0] || 0);
      const bNum = parseInt(b.match(/\d+/)?.[0] || 0);
      if (aNum && bNum) return aNum - bNum;
      return a.localeCompare(b);
    });

    res.render('dosen/nilai_rekap', {
      title: `Rekap Nilai - ${mk.kode} ${mk.nama}`,
      mk,
      data,
      tipeList
    });
  } catch (error) {
    console.error('Error mengambil rekap nilai:', error);
    res.status(500).render('error', {
      title: 'Error',
      message: 'Gagal mengambil rekap nilai'
    });
  }
});

// ============================================================================
// INPUT / UPDATE NILAI
// ============================================================================

router.post('/input', async (req, res) => {
  try {
    const { mkId, mahasiswaId, tipe, nilai } = req.body;

    if (!mkId || !mahasiswaId || !tipe || nilai === undefined) {
      return res.status(400).json({ 
        success: false, 
        message: 'Data tidak lengkap (mkId, mahasiswaId, tipe, nilai wajib diisi)' 
      });
    }

    const nilaiAngka = parseFloat(nilai);
    if (isNaN(nilaiAngka) || nilaiAngka < 0 || nilaiAngka > 100) {
      return res.status(400).json({ 
        success: false, 
        message: 'Nilai harus angka antara 0-100' 
      });
    }

    const existingSnapshot = await db.collection('nilai')
      .where('mkId', '==', mkId)
      .where('mahasiswaId', '==', mahasiswaId)
      .where('tipe', '==', tipe)
      .limit(1)
      .get();

    if (existingSnapshot.empty) {
      await db.collection('nilai').add({
        mkId,
        mahasiswaId,
        tipe,
        nilai: nilaiAngka,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    } else {
      const docRef = existingSnapshot.docs[0].ref;
      await docRef.update({
        nilai: nilaiAngka,
        updatedAt: new Date().toISOString()
      });
    }

    res.redirect(`/dosen/nilai/${mkId}`);
  } catch (error) {
    console.error('Error input nilai:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal menyimpan nilai: ' + error.message 
    });
  }
});

// ============================================================================
// EKSPOR NILAI (CSV)
// ============================================================================

router.get('/:mkId/export', async (req, res) => {
  try {
    const { mkId } = req.params;
    
    const mkDoc = await db.collection('mataKuliah').doc(mkId).get();
    if (!mkDoc.exists) {
      return res.status(404).send('Mata kuliah tidak ditemukan');
    }
    const mk = mkDoc.data();

    const enrollmentSnapshot = await db.collection('enrollment')
      .where('mkId', '==', mkId)
      .where('status', '==', 'active')
      .get();
    
    const mahasiswaIds = enrollmentSnapshot.docs.map(d => d.data().userId);
    const rows = [];

    for (const userId of mahasiswaIds) {
      const mahasiswa = await getMahasiswaById(userId);
      const nilaiMap = await getNilaiByMkAndMahasiswa(mkId, userId);
      
      rows.push({
        nim: mahasiswa.nim,
        nama: mahasiswa.nama,
        tugas1: nilaiMap.tugas1?.nilai || '',
        tugas2: nilaiMap.tugas2?.nilai || '',
        tugas3: nilaiMap.tugas3?.nilai || '',
        uts: nilaiMap.uts?.nilai || '',
        uas: nilaiMap.uas?.nilai || ''
      });
    }

    const headers = ['NIM', 'Nama', 'Tugas 1', 'Tugas 2', 'Tugas 3', 'UTS', 'UAS'];
    const csvRows = [
      headers.join(','),
      ...rows.map(row => 
        [row.nim, row.nama, row.tugas1, row.tugas2, row.tugas3, row.uts, row.uas].join(',')
      )
    ];
    const csvString = csvRows.join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="nilai_${mk.kode}.csv"`);
    res.send(csvString);
  } catch (error) {
    console.error('Error export nilai:', error);
    res.status(500).send('Gagal mengekspor nilai');
  }
});

module.exports = router;