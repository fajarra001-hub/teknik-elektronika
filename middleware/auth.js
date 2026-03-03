const { admin, db } = require('../config/firebaseAdmin');

/**
 * Middleware untuk memverifikasi token sesi dan mendapatkan data user
 */
const verifyToken = async (req, res, next) => {
  const sessionCookie = req.cookies.session || '';
  if (!sessionCookie) {
    return res.redirect('/auth/login');
  }

  try {
    const decodedClaims = await admin.auth().verifySessionCookie(sessionCookie, true);
    const uid = decodedClaims.uid;

    // Coba ambil dari collection users (untuk admin & mahasiswa)
    let userDoc = await db.collection('users').doc(uid).get();
    
    if (userDoc.exists) {
      req.user = { id: uid, ...userDoc.data() };
    } else {
      // Coba cek di collection dosen
      const dosenSnapshot = await db.collection('dosen').where('userId', '==', uid).limit(1).get();
      if (!dosenSnapshot.empty) {
        const dosenData = dosenSnapshot.docs[0].data();
        req.user = {
          id: uid,
          nama: dosenData.nama,
          email: dosenData.email,
          role: 'dosen',
          dosenId: dosenSnapshot.docs[0].id, // simpan id dokumen dosen
          ...dosenData
        };
      } else {
        return res.redirect('/auth/login');
      }
    }
    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.clearCookie('session');
    res.redirect('/auth/login');
  }
};

/**
 * Middleware untuk memeriksa apakah user adalah admin
 */
const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).send('Akses ditolak. Hanya untuk admin.');
  }
};

/**
 * Middleware untuk memeriksa apakah user adalah mahasiswa
 */
const isMahasiswa = (req, res, next) => {
  if (req.user && req.user.role === 'mahasiswa') {
    next();
  } else {
    res.status(403).send('Akses ditolak. Hanya untuk mahasiswa.');
  }
};

/**
 * Middleware untuk memeriksa apakah user adalah dosen
 * dan menyimpan data lengkap dosen ke req.dosen
 */
const isDosen = async (req, res, next) => {
  try {
    if (!req.user || !req.user.dosenId) {
      return res.status(403).render('error', {
        title: 'Akses Ditolak',
        message: 'Anda bukan dosen'
      });
    }
    const dosenDoc = await db.collection('dosen').doc(req.user.dosenId).get();
    if (!dosenDoc.exists) {
      return res.status(403).render('error', {
        title: 'Akses Ditolak',
        message: 'Data dosen tidak ditemukan'
      });
    }
    req.dosen = { id: dosenDoc.id, ...dosenDoc.data() };
    next();
  } catch (error) {
    console.error('Error in isDosen middleware:', error);
    res.status(500).render('error', {
      title: 'Error Server',
      message: 'Terjadi kesalahan saat memverifikasi dosen'
    });
  }
};

/**
 * Middleware untuk memeriksa apakah user adalah admin atau dosen
 */
const isAdminOrDosen = (req, res, next) => {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'dosen')) {
    next();
  } else {
    res.status(403).send('Akses ditolak. Hanya untuk admin atau dosen.');
  }
};

module.exports = {
  verifyToken,
  isAdmin,
  isMahasiswa,
  isDosen,
  isAdminOrDosen
};