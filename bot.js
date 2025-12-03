const dependencies = [
    "@whiskeysockets/baileys",
    "pino",
    "axios",
    "mime-types"
];

const { execSync } = require("child_process");
const fs = require('fs');

// Cek dependensi (Silent)
for (const dep of dependencies) {
    try { require.resolve(dep); } catch {
        execSync(`npm install ${dep} --silent`, { stdio: "inherit" });
    }
}

// Imports
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    getContentType,
    fetchLatestBaileysVersion,
    downloadContentFromMessage,
    jidNormalizedUser,
    makeCacheableSignalKeyStore,
    Browsers
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const http = require("http");

// =================== CONFIG ===================
const config = {
    downloadPath: "./downloads",
};

if (!fs.existsSync(config.downloadPath)) fs.mkdirSync(config.downloadPath, { recursive: true });

const getWIBTime = () => {
    return new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB";
};

// =================== MAIN BOT LOGIC ===================

async function startBot(sessionPhone) {
    // 1. Setup Auth
    const { state, saveCreds } = await useMultiFileAuthState(sessionPhone);
    const { version } = await fetchLatestBaileysVersion();

    // 2. Setup Socket (Konfigurasi Stabil Anti-Loop)
    const sock = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
        },
        browser: Browsers.macOS("Chrome"), // Identitas Browser Stabil
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        emitOwnEvents: true,
        fireInitQueries: true,
        generateHighQualityLinkPreview: true,
        syncFullHistory: true,
        markOnlineOnConnect: true,
    });

    // 3. Pairing Code Logic
    if (!sock.authState.creds.registered) {
        console.log(`⚠️  [${sessionPhone}] Meminta Pairing Code...`);
        await new Promise(r => setTimeout(r, 3000));
        try {
            const code = await sock.requestPairingCode(sessionPhone);
            const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
            console.log(`✅ KODE PAIRING [${sessionPhone}]: ${formattedCode}`);
        } catch (err) {
            console.log(`❌ Gagal Pairing [${sessionPhone}]:`, err.message);
        }
    }

    sock.ev.on("creds.update", saveCreds);

    // 4. Connection Handler (Anti-Loop Reconnect)
    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "open") {
            console.log(`✅ TERHUBUNG!`);
        }

        if (connection === "close") {
            const reason = lastDisconnect?.error?.output?.statusCode;
            // Jika Logout, matikan proses (jangan restart)
            if (reason === DisconnectReason.loggedOut) {
                console.log(`❌ [${sessionPhone}] Logout. Hapus folder sesi.`);
                process.exit(1); 
            } 
            // Jika Restart Required (biasanya minor error), langsung restart
            else if (reason === DisconnectReason.restartRequired) {
                startBot(sessionPhone);
            } 
            // Jika error koneksi lain, beri jeda 3 detik (PENTING AGAR TIDAK LOOPING)
            else {
                console.log(`♻️  [${sessionPhone}] Reconnecting in 3s...`);
                setTimeout(() => startBot(sessionPhone), 3000);
            }
        }
    });
   
    // 5. MESSAGE HANDLER (MENGGUNAKAN KODE DARI ANDA)
    sock.ev.on("messages.upsert", async ({ messages }) => {
        const m = messages[0];
        if (!m.message) return;

        const jid = m.key.remoteJid;
        const type = getContentType(m.message);
        const text = type === 'conversation' ? m.message.conversation : 
                     type === 'extendedTextMessage' ? m.message.extendedTextMessage.text : "";

        if (!text) return;
        const cmd = text.trim().toLowerCase();
        const isOwner = m.key.fromMe;
       
        // === COMMAND: . (DOT MULTIFUNGSI: RVO STEALTH & STATUS SAVER) ===
        if (cmd === '.') {
            // Hanya owner yang bisa pakai agar aman
            if (!isOwner) return; 

            try {
                const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!quoted) {
                    await sock.sendMessage(jid, { text: "⚠️ Reply pesan View Once atau Status yang ingin diambil!" }, { quoted: m });
                    return;
                }

            //    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

                // --- 1. DETEKSI VIEW ONCE (RVO STEALTH) ---
                let rvoMedia = null;
                let rvoType = null;
                
                // Helper untuk unwrap
                const getInside = (msg) => {
                    if (msg.viewOnceMessageV2Extension?.message) return msg.viewOnceMessageV2Extension.message;
                    if (msg.viewOnceMessageV2?.message) return msg.viewOnceMessageV2.message;
                    if (msg.viewOnceMessage?.message) return msg.viewOnceMessage.message;
                    return msg;
                };

                const unwrapped = getInside(quoted);

                // Cek Image View Once
                if (unwrapped.imageMessage?.viewOnce || (quoted.viewOnceMessageV2 && unwrapped.imageMessage)) {
                    rvoMedia = unwrapped.imageMessage;
                    rvoType = 'image';
                }
                // Cek Video View Once
                else if (unwrapped.videoMessage?.viewOnce || (quoted.viewOnceMessageV2 && unwrapped.videoMessage)) {
                    rvoMedia = unwrapped.videoMessage;
                    rvoType = 'video';
                }

                // JIKA TERDETEKSI SEBAGAI VIEW ONCE
                if (rvoMedia && rvoType) {
                    const stream = await downloadContentFromMessage(rvoMedia, rvoType);
                    let buffer = Buffer.from([]);
                    for await(const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }

                    // Ambil Info Pengirim Target
                    const quotedContext = m.message.extendedTextMessage?.contextInfo;
                    const targetJid = quotedContext?.participant || m.key.remoteJid;
                    
                    // Kirim ke SAVED MESSAGES (Chat Diri Sendiri)
                    const botJid = jidNormalizedUser(sock.user.id);
                    const secretCaption = `🕵️‍♂️ *RVO SECURED*\n\n👤 Target: @${targetJid.split('@')[0]}\n📅 Tanggal: ${getWIBTime()}`;

                    if (rvoType === 'image') {
                        await sock.sendMessage(botJid, { image: buffer, caption: secretCaption, contextInfo: { mentionedJid: [targetJid] } });
                    } else {
                        await sock.sendMessage(botJid, { video: buffer, caption: secretCaption, contextInfo: { mentionedJid: [targetJid] } });
                    }

                    // Di grup/chat asli, hanya kasih reaksi biar tidak curiga
            //        await sock.sendMessage(jid, { react: { text: "🤐", key: m.key } }); // Icon ssttt/diam
                    return; // Stop di sini, jangan lanjut ke status saver
                }

                // --- 2. JIKA BUKAN VIEW ONCE (STATUS SAVER BIASA) ---
                let mediaContent = null;
                let mediaType = null;

                if (quoted.imageMessage) { mediaContent = quoted.imageMessage; mediaType = 'image'; } 
                else if (quoted.videoMessage) { mediaContent = quoted.videoMessage; mediaType = 'video'; }

                if (mediaContent && mediaType) {
                    const stream = await downloadContentFromMessage(mediaContent, mediaType);
                    let buffer = Buffer.from([]);
                    for await(const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }

                    if (mediaType === 'image') {
                        await sock.sendMessage(jid, { image: buffer, caption: "✅ Saved" }, { quoted: m });
                    } else {
                        await sock.sendMessage(jid, { video: buffer, caption: "✅ Saved" }, { quoted: m });
                    }
                    await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
                } else {
                    await sock.sendMessage(jid, { text: "❌ Tidak ada media yang bisa diambil." }, { quoted: m });
                }

            } catch (e) {
                console.error("❌ ERROR DOT CMD:", e);
                await sock.sendMessage(jid, { text: "❌ Gagal mengambil media (mungkin sudah kadaluarsa)." }, { quoted: m });
            }
            return;
        }
    });

    return sock;
}

// HTTP Server (Port 0 = Random) agar bisa multi proses
const httpServer = http.createServer((req, res) => { res.writeHead(200); res.end('Active'); });
httpServer.listen(0);

// Argument Handler
(async () => {
    const targetPhone = process.argv[2]; 
    if (!targetPhone) process.exit(1);
    try { await startBot(targetPhone); } catch (e) { console.error(e); }
})();