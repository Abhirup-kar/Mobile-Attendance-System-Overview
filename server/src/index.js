'use strict';

const os = require('node:os');
const path = require('node:path');
const { createDatabase } = require('./db');
const { createApp } = require('./app');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', 'data', 'attendance.db');

function getLanUrls(port) {
  const interfaces = os.networkInterfaces();
  const urls = [];
  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const info of entries) {
      if (info.family === 'IPv4' && !info.internal) {
        urls.push(`http://${info.address}:${port}`);
      }
    }
  }
  return urls;
}

const db = createDatabase(DB_PATH);
const server = createApp(db);

server.listen(PORT, HOST, () => {
  const actualPort = server.address().port;
  console.log('\n=== Mobile Attendance System Server Running ===');
  console.log(`SQLite Database : ${DB_PATH}`);
  console.log(`PC Operator UI  : http://localhost:${actualPort}/`);
  console.log(`Mobile App (PWA): http://localhost:${actualPort}/mobile`);
  const lanUrls = getLanUrls(actualPort);
  if (lanUrls.length > 0) {
    console.log('Android LAN URLs (open on phone via same Wi-Fi):');
    for (const url of lanUrls) {
      console.log(`  - Mobile App  : ${url}/mobile`);
      console.log(`  - Operator UI : ${url}/`);
    }
  }
  console.log('==============================================\n');
});

function shutdown(signal) {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
