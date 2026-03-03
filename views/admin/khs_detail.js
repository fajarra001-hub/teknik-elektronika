<%- include('../partials/header') %>

<div class="container mt-4">
  <h2 class="fw-bold mb-4">Detail KHS</h2>
  <div class="card">
    <div class="card-header">
      <h5><%= mahasiswa.nama %> (<%= mahasiswa.nim %>)</h5>
    </div>
    <div class="card-body">
      <table class="table table-borderless">
        <tr><th>Semester</th><td><%= khs.semester %></td></tr>
        <tr><th>IP</th><td><%= khs.ip || '-' %></td></tr>
        <tr><th>Keterangan</th><td><%= khs.keterangan || '-' %></td></tr>
        <tr><th>File</th><td><a href="<%= khs.fileUrl %>" target="_blank">Lihat di Drive</a></td></tr>
        <tr><th>Tanggal Upload</th><td><%= new Date(khs.createdAt).toLocaleString('id-ID') %></td></tr>
        <tr><th>Diupload oleh</th><td><%= khs.uploadedBy || '-' %></td></tr>
      </table>
      <a href="/admin/khs/list" class="btn btn-secondary">Kembali</a>
    </div>
  </div>
</div>

<%- include('../partials/footer') %>