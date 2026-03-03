const express = require('express');
const router = express.Router();
const { verifyToken, isDosen } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');

router.use(verifyToken);
router.use(isDosen);

async function getMahasiswa(userId) {
  const doc = await db.collection('users').doc(userId).get();
  return doc.exists ? doc.data() : { nama: '-', nim: '-' };
}

router.get('/', async (req, res) => {
  try {
    const snapshot = await db.collection('permohonanMagang').orderBy('createdAt', 'desc').get();
    const seminarList = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const mahasiswa = await getMahasiswa(data.userId);
      seminarList.push({ id: doc.id, ...data, mahasiswa });
    }
    res.render('dosen/seminar_list', { seminarList });
  } catch (error) {
    console.error(error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat seminar' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const doc = await db.collection('permohonanMagang').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).send('Seminar tidak ditemukan');
    const seminar = { id: doc.id, ...doc.data() };
    const mahasiswa = await getMahasiswa(seminar.userId);
    res.render('dosen/seminar_detail', { seminar, mahasiswa });
  } catch (error) {
    console.error(error);
    res.status(500).render('error', { title: 'Error', message: 'Gagal memuat detail' });
  }
});

module.exports = router;