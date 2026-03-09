// routes/elkLibrary.js
const express = require('express');
const router = express.Router();
const { db } = require('../config/firebaseAdmin');

const ITEMS_PER_PAGE = 9;

router.get('/', async (req, res) => {
  try {
    const { search, tahun, pembimbing, type, page = 1 } = req.query;
    const currentPage = parseInt(page) || 1;

    // Ambil laporan magang yang sudah disetujui
    const laporanSnapshot = await db.collection('laporanMagang')
      .where('status', '==', 'approved')
      .orderBy('approvedAt', 'desc')
      .get();

    const laporanList = laporanSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        _type: 'laporan',
        // Seragamkan field tahun
        tahun: data.tahun || null,
        // Untuk pencarian, gunakan field yang sudah ada
        judulPencarian: data.judulPublik || data.title || '',
        penulisPencarian: data.nama || data.penulis || '',
        abstrakPencarian: data.abstrak || data.abstract || ''
      };
    });

    // Ambil artikel dosen yang sudah disetujui
    const artikelSnapshot = await db.collection('artikelDosen')
      .where('status', '==', 'approved')
      .orderBy('createdAt', 'desc')
      .get();

    const artikelList = artikelSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        _type: 'artikel',
        // Seragamkan field tahun
        tahun: data.publicationYear || null,
        judulPencarian: data.title || '',
        penulisPencarian: data.penulis || (data.authors ? data.authors.join(', ') : ''),
        abstrakPencarian: data.abstrak || data.abstract || ''
      };
    });

    // Gabungkan
    let allItems = [...laporanList, ...artikelList];

    // Filter berdasarkan search (manual)
    if (search && search.trim() !== '') {
      const lowerSearch = search.toLowerCase();
      allItems = allItems.filter(item => 
        item.judulPencarian.toLowerCase().includes(lowerSearch) ||
        item.penulisPencarian.toLowerCase().includes(lowerSearch) ||
        item.abstrakPencarian.toLowerCase().includes(lowerSearch)
      );
    }

    // Filter berdasarkan tahun (menggunakan field tahun yang sudah seragam)
    if (tahun && tahun.trim() !== '') {
      const tahunNum = parseInt(tahun);
      allItems = allItems.filter(item => item.tahun === tahunNum);
    }

    // Filter berdasarkan pembimbing (khusus laporan)
    if (pembimbing && pembimbing.trim() !== '') {
      const lowerPembimbing = pembimbing.toLowerCase();
      allItems = allItems.filter(item => 
        item._type === 'laporan' && 
        item.pembimbing && 
        item.pembimbing.toLowerCase().includes(lowerPembimbing)
      );
    }

    // Filter berdasarkan tipe
    if (type && type !== 'all') {
      allItems = allItems.filter(item => item._type === type);
    }

    // Urutkan berdasarkan tanggal (desc)
    allItems.sort((a, b) => {
      const dateA = a.approvedAt || a.createdAt || a.uploadedAt;
      const dateB = b.approvedAt || b.createdAt || b.uploadedAt;
      return (dateB || '').localeCompare(dateA || '');
    });

    // Pagination
    const totalItems = allItems.length;
    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const paginatedItems = allItems.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    // Ambil daftar tahun unik untuk filter
    const tahunSet = new Set();
    laporanList.forEach(item => { if (item.tahun) tahunSet.add(item.tahun); });
    artikelList.forEach(item => { if (item.tahun) tahunSet.add(item.tahun); });
    const tahunList = Array.from(tahunSet).sort((a, b) => b - a);

    // Hapus field sementara yang tidak perlu dikirim ke view
    const itemsForView = paginatedItems.map(item => {
      const { judulPencarian, penulisPencarian, abstrakPencarian, ...rest } = item;
      return rest;
    });

    res.render('elkLibrary/index', {
      title: 'ELK Library',
      items: itemsForView,
      filters: {
        search: search || '',
        tahun: tahun || '',
        pembimbing: pembimbing || '',
        type: type || 'all'
      },
      tahunList,
      currentPage,
      totalPages
    });
  } catch (error) {
    console.error('Error ELK Library:', error);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Gagal memuat ELK Library' 
    });
  }
});

router.get('/:id', async (req, res) => {
  try {
    // Coba cari di laporanMagang dulu
    let doc = await db.collection('laporanMagang').doc(req.params.id).get();
    let type = 'laporan';
    if (!doc.exists) {
      doc = await db.collection('artikelDosen').doc(req.params.id).get();
      type = 'artikel';
    }
    if (!doc.exists) {
      return res.status(404).render('error', { 
        title: 'Tidak Ditemukan', 
        message: 'Item tidak ditemukan' 
      });
    }
    const data = doc.data();
    const item = { id: doc.id, ...data, _type: type };

    // Increment views
    await doc.ref.update({ views: (data.views || 0) + 1 });

    res.render('elkLibrary/detail', {
      title: item.judulPublik || item.title || 'Detail',
      item
    });
  } catch (error) {
    console.error('Error detail:', error);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'Gagal memuat detail' 
    });
  }
});

module.exports = router;