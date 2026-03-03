const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CREDENTIALS_PATH = path.join(__dirname, 'config', 'oauth2.keys.json');
const TOKEN_PATH = path.join(__dirname, 'config', 'token.json');

// Baca file kredensial
const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
const { client_secret, client_id, redirect_uris } = credentials.web || credentials.installed;

// Buat OAuth2 client
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

// Buat URL untuk meminta izin
const authUrl = oAuth2Client.generateAuthUrl({
  access_type: 'offline',        // untuk mendapatkan refresh_token
  scope: ['https://www.googleapis.com/auth/drive'],
  prompt: 'consent'              // memaksa muncul layar izin setiap kali (perlu untuk refresh token)
});

console.log('Authorize aplikasi ini dengan mengunjungi URL berikut:');
console.log(authUrl);

// Minta input kode dari user
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Masukkan kode dari halaman tersebut: ', async (code) => {
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log('✅ Token berhasil disimpan di', TOKEN_PATH);
    console.log('Refresh token:', tokens.refresh_token);
  } catch (err) {
    console.error('❌ Gagal mendapatkan token:', err.message);
  }
  rl.close();
});