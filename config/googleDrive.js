// config/googleDrive.js

const { google } = require("googleapis");
const oauth2Client = require("./googleOAuth");

// Inisialisasi Google Drive API
const drive = google.drive({
  version: "v3",
  auth: oauth2Client,
});

module.exports = drive;