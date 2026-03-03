/**
 * routes/auth.js
 * Autentikasi: login, logout, dan pembuatan sesi
 */

const express = require('express');
const router = express.Router();
const { admin, db } = require('../config/firebaseAdmin');

// ============================================================================
// HALAMAN LOGIN
// ============================================================================
router.get('/login', (req, res) => {
  res.render('auth/login', { error: null });
});

// ============================================================================
// PROSES LOGIN (menerima token dari client)
// ============================================================================
router.post('/login', async (req, res) => {
  const { idToken } = req.body;
  try {
    // 1. Verifikasi token dari Firebase Client SDK
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;
    const email = decodedToken.email;

    // 2. Cari data user di Firestore (collection users)
    let userDoc = await db.collection('users').doc(uid).get();
    let role, nama, nim;

    if (userDoc.exists) {
      // Admin atau mahasiswa
      const data = userDoc.data();
      role = data.role; // 'admin' atau 'mahasiswa'
      nama = data.nama || '';
      nim = data.nim || null;
    } else {
      // 3. Cek apakah user adalah dosen (collection dosen)
      const dosenSnapshot = await db.collection('dosen').where('userId', '==', uid).limit(1).get();
      if (!dosenSnapshot.empty) {
        const dosenData = dosenSnapshot.docs[0].data();
        role = 'dosen';
        nama = dosenData.nama;
        nim = null; // dosen tidak punya nim
      } else {
        // Jika tidak ditemukan, akun tidak terdaftar
        return res.render('auth/login', { error: 'Akun tidak terdaftar' });
      }
    }

    // 4. Buat session cookie (5 hari)
    const expiresIn = 60 * 60 * 24 * 5 * 1000; // 5 hari
    const sessionCookie = await admin.auth().createSessionCookie(idToken, { expiresIn });

    // Set cookie dengan opsi keamanan
    res.cookie('session', sessionCookie, {
      maxAge: expiresIn,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // HTTPS only di production
      sameSite: 'lax'
    });

    // 5. Redirect ke dashboard (nanti akan diarahkan oleh middleware)
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Login error:', error);
    res.render('auth/login', { error: 'Login gagal: ' + error.message });
  }
});

// ============================================================================
// LOGOUT
// ============================================================================
router.get('/logout', (req, res) => {
  res.clearCookie('session');
  res.redirect('/auth/login');
});

module.exports = router;