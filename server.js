const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, delay } = require('@whiskeysockets/baileys');

// IMPORT LOGIKA BOT KAMU DI SINI
const botHandler = require('./bot'); 

const app = express();
const PORT = 3000;

app.use(express.static('.')); // Menyajikan index.html dan style.css
app.use(bodyParser.json());

// --- DATABASE SEMENTARA ---
let activeSockets = {}; // Menyimpan koneksi socket aktif
let sessionLogs = {};   // Menyimpan logs untuk ditampilkan di HTML
let pairingCodes = {};  // Menyimpan kode pairing sementara

// --- FUNGSI UTAMA START BOT ---
async function startSession(sessionId) {
    const logger = pino({ level: 'silent' });
    const { state, saveCreds } = await useMultiFileAuthState(`sessions/${sessionId}`);

    const sock = makeWASocket({
        auth: state,
        logger: logger,
        printQRInTerminal: false, // Kita pakai Pairing Code
        browser: ["Ubuntu", "Chrome", "20.0.04"], // Wajib untuk Pairing Code
        markOnlineOnConnect: true
    });

    // Simpan socket ke memory
    activeSockets[sessionId] = sock;
    if (!sessionLogs[sessionId]) sessionLogs[sessionId] = [];

    // Helper Log
    const addLog = (msg, type = 'info') => {
        const time = new Date().toLocaleTimeString();
        sessionLogs[sessionId].push({ time, msg, type });
        // Batasi log agar tidak memberatkan memori (max 50 baris)
        if (sessionLogs[sessionId].length > 50) sessionLogs[sessionId].shift();
    };

    // --- LOGIC KONEKSI ---
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (update.qr) {
            addLog('QR Code generated (Scan not supported here)', 'warning');
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            addLog(`Connection closed. Reconnecting: ${shouldReconnect}`, 'error');
            delete activeSockets[sessionId]; // Hapus dari daftar aktif
            
            if (shouldReconnect) {
                setTimeout(() => startSession(sessionId), 5000); // Auto reconnect
            }
        } else if (connection === 'open') {
            addLog(`Connected successfully as ${sessionId}`, 'success');
            pairingCodes[sessionId] = 'CONNECTED'; // Reset kode pairing
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // --- INTEGRASI BOT.JS DI SINI ---
    sock.ev.on('messages.upsert', async (m) => {
        try {
            // Panggil fungsi handler dari bot.js
            await botHandler(sock, m, addLog);
        } catch (err) {
            console.error(err);
        }
    });

    return sock;
}

// --- API ROUTES (Untuk HTML) ---

// 1. Ambil Status (Polling)
app.get('/api/status', (req, res) => {
    // Cek folder sessions
    const sessions = fs.existsSync('./sessions') 
        ? fs.readdirSync('./sessions').filter(f => !f.startsWith('.')) 
        : [];
    
    const activeBots = Object.keys(activeSockets);

    res.json({
        sessions,
        activeBots,
        logs: sessionLogs
    });
});

// 2. Tambah Bot Baru (Request Pairing Code)
app.post('/api/add', async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, message: 'No phone' });

    const sessionId = phone;
    
    // Jika sudah aktif, reject
    if (activeSockets[sessionId]) {
        return res.json({ success: false, message: 'Session already active' });
    }

    try {
        // Hapus session lama jika ada, agar bersih
        const sessionPath = `sessions/${sessionId}`;
        if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { recursive: true, force: true });

        const sock = await startSession(sessionId);
        
        // Tunggu sebentar agar socket siap, lalu request kode
        setTimeout(async () => {
            if (!sock.authState.creds.me) {
                try {
                    const code = await sock.requestPairingCode(phone);
                    pairingCodes[sessionId] = code;
                    sessionLogs[sessionId].push({ time: new Date().toLocaleTimeString(), msg: `Pairing Code: ${code}`, type: 'warning' });
                } catch (e) {
                    console.log('Pairing Request Error:', e);
                }
            }
        }, 3000);

        res.json({ success: true, phone: sessionId });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 3. Ambil Kode Pairing
app.get('/api/pairing-code/:phone', (req, res) => {
    const code = pairingCodes[req.params.phone];
    res.json({ code: code || 'WAITING' });
});

// 4. Start/Stop/Delete Manual
app.post('/api/start/:id', (req, res) => {
    startSession(req.params.id);
    res.json({ success: true });
});

app.post('/api/stop/:id', (req, res) => {
    const sock = activeSockets[req.params.id];
    if (sock) sock.end(undefined);
    delete activeSockets[req.params.id];
    res.json({ success: true });
});

app.post('/api/delete/:id', (req, res) => {
    const id = req.params.id;
    if (activeSockets[id]) {
        activeSockets[id].end(undefined);
        delete activeSockets[id];
    }
    fs.rm(`sessions/${id}`, { recursive: true, force: true }, () => {});
    delete sessionLogs[id];
    res.json({ success: true });
});

// 5. Global Actions
app.post('/api/start-all', (req, res) => {
    if (fs.existsSync('./sessions')) {
        const sessions = fs.readdirSync('./sessions');
        sessions.forEach(id => {
            if (!activeSockets[id]) startSession(id);
        });
    }
    res.json({ success: true });
});

app.post('/api/stop-all', (req, res) => {
    Object.values(activeSockets).forEach(sock => sock.end(undefined));
    activeSockets = {};
    res.json({ success: true });
});

// Jalankan Server
// Load session yang tersimpan saat startup
if (!fs.existsSync('./sessions')) fs.mkdirSync('./sessions');
const savedSessions = fs.readdirSync('./sessions');
savedSessions.forEach(id => startSession(id));

app.listen(PORT, () => {
    console.log(`Server dashboard berjalan di http://localhost:${PORT}`);
});
