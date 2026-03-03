const express = require('express');
const router = express.Router();
const { verifyToken, isDosen } = require('../../middleware/auth');
const { db } = require('../../config/firebaseAdmin');

router.use(verifyToken);
router.use(isDosen);

// GET /dosen/chat/:userId - menampilkan halaman chat dengan mahasiswa tertentu
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const mahasiswa = await db.collection('users').doc(userId).get();
    if (!mahasiswa.exists) {
      return res.status(404).send('Mahasiswa tidak ditemukan');
    }
    const mhsData = mahasiswa.data();
    res.render('dosen/chat', {
      title: `Chat dengan ${mhsData.nama}`,
      dosenId: req.user.id,
      mahasiswaId: userId,
      mahasiswa: mhsData
    });
  } catch (error) {
    console.error('Error load chat:', error);
    res.status(500).send('Gagal memuat chat');
  }
});

// POST /dosen/chat/send - mengirim pesan (API endpoint)
router.post('/send', async (req, res) => {
  try {
    const { receiverId, message } = req.body;
    if (!receiverId || !message) {
      return res.status(400).json({ error: 'Receiver dan pesan harus diisi' });
    }
    const chatRef = await db.collection('chats').add({
      senderId: req.user.id,
      receiverId,
      message,
      timestamp: new Date().toISOString(),
      read: false
    });
    res.json({ success: true, id: chatRef.id });
  } catch (error) {
    console.error('Error send message:', error);
    res.status(500).json({ error: 'Gagal mengirim pesan' });
  }
});

// GET /dosen/chat/messages/:userId - ambil pesan dengan mahasiswa tertentu
router.get('/messages/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const messages = await db.collection('chats')
      .where('senderId', 'in', [req.user.id, userId])
      .where('receiverId', 'in', [req.user.id, userId])
      .orderBy('timestamp', 'asc')
      .get();
    const messageList = messages.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(messageList);
  } catch (error) {
    console.error('Error get messages:', error);
    res.status(500).json({ error: 'Gagal mengambil pesan' });
  }
});

module.exports = router;