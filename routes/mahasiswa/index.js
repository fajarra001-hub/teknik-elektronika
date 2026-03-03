const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../middleware/auth');

// Semua route mahasiswa harus login
router.use(verifyToken);

// Dashboard mahasiswa
const dashboardRouter = require('./dashboard');
router.use('/dashboard', dashboardRouter);   // atau router.get('/', dashboardRouter) jika root

// Modul lainnya
const akademikRouter = require('./akademik');
router.use('/akademik', akademikRouter);

const elearningRouter = require('./elearning');
router.use('/elearning', elearningRouter);

const magangRouter = require('./magang');
router.use('/magang', magangRouter);

const suratRouter = require('./surat');
router.use('/persuratan', suratRouter);

const tracerRouter = require('./tracer');
router.use('/tracer', tracerRouter);

const biodataRouter = require('./biodata');
router.use('/biodata', biodataRouter);

const tagihanRouter = require('./tagihan');
router.use('/tagihan', tagihanRouter);

module.exports = router;