const dependencies = [
    "@whiskeysockets/baileys",
    "pino",
    "mime-types"
];

const { execSync } = require("child_process");
const fs = require('fs');

// Cek dependensi (Silent install jika belum ada)
for (const dep of dependencies) {
    try { require.resolve(dep); } catch {
        // execSync(`npm install ${dep} --silent`, { stdio: "inherit" });
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

// =================== CONFIG ===================
const getWIBTime = () => {
    return new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB";
};

// Global Variable untuk IPC
let globalSock = null;

// =================== MAIN BOT LOGIC ===================

async function startBot(sessionPhone) {
    // 1. Setup Auth
    const { state, saveCreds } = await useMultiFileAuthState(`./${sessionPhone}`);
    const { version } = await fetchLatestBaileysVersion();

    // 2. Setup Socket
    const sock = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
        },
        browser: Browsers.macOS("Chrome"),
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        emitOwnEvents: true,
        fireInitQueries: true,
        generateHighQualityLinkPreview: true,
        syncFullHistory: true,
        markOnlineOnConnect: true,
    });

    // Update Global Socket untuk IPC
    globalSock = sock;

    // 3. Pairing Code Logic (LOG FORMAT INI PENTING UNTUK SERVER.JS)
    if (!sock.authState.creds.registered) {
        // Beri jeda sedikit agar server siap menangkap log
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(sessionPhone);
                // FORMAT KHUSUS AGAR DIBACA SERVER.JS
                console.log(`KODE PAIRING: ${code}`);
            } catch (err) {
                console.log(`❌ Gagal Pairing: ${err.message}`);
            }
        }, 3000);
    }

    sock.ev.on("creds.update", saveCreds);

    // 4. Connection Handler
    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "open") {
            // LOG INI DIBACA SERVER.JS UNTUK STATUS ONLINE
            console.log(`TERHUBUNG: ${sessionPhone} Siap!`);
        }

        if (connection === "close") {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason === DisconnectReason.loggedOut) {
                console.log(`SYSTEM: Sesi Logout. Hapus folder sesi.`);
                process.exit(0); 
            } else if (reason === DisconnectReason.restartRequired) {
                startBot(sessionPhone);
            } else {
                console.log(`Reconnecting...`);
                setTimeout(() => startBot(sessionPhone), 3000);
            }
        }
    });
   
    // 5. MESSAGE HANDLER (Fitur RVO & Saver kamu)
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
       
        // FITUR UTAMA: DOT (.)
        if (cmd === '.') {
            if (!isOwner) return; 

            try {
                const quoted = m.message.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!quoted) return;

                // --- DETEKSI VIEW ONCE (RVO STEALTH) ---
                let rvoMedia = null;
                let rvoType = null;
                
                const getInside = (msg) => {
                    if (msg.viewOnceMessageV2Extension?.message) return msg.viewOnceMessageV2Extension.message;
                    if (msg.viewOnceMessageV2?.message) return msg.viewOnceMessageV2.message;
                    if (msg.viewOnceMessage?.message) return msg.viewOnceMessage.message;
                    return msg;
                };

                const unwrapped = getInside(quoted);

                if (unwrapped.imageMessage?.viewOnce || (quoted.viewOnceMessageV2 && unwrapped.imageMessage)) {
                    rvoMedia = unwrapped.imageMessage; rvoType = 'image';
                } else if (unwrapped.videoMessage?.viewOnce || (quoted.viewOnceMessageV2 && unwrapped.videoMessage)) {
                    rvoMedia = unwrapped.videoMessage; rvoType = 'video';
                }

                if (rvoMedia && rvoType) {
                    const stream = await downloadContentFromMessage(rvoMedia, rvoType);
                    let buffer = Buffer.from([]);
                    for await(const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }

                    const targetJid = m.message.extendedTextMessage?.contextInfo?.participant || m.key.remoteJid;
                    const botJid = jidNormalizedUser(sock.user.id);
                    const secretCaption = `🕵️‍♂️ *RVO SECURED*\nTarget: @${targetJid.split('@')[0]}\nTime: ${getWIBTime()}`;

                    if (rvoType === 'image') {
                        await sock.sendMessage(botJid, { image: buffer, caption: secretCaption, contextInfo: { mentionedJid: [targetJid] } });
                    } else {
                        await sock.sendMessage(botJid, { video: buffer, caption: secretCaption, contextInfo: { mentionedJid: [targetJid] } });
                    }
                    return; 
                }

                // --- STATUS SAVER BIASA ---
                let mediaContent = null;
                let mediaType = null;

                if (quoted.imageMessage) { mediaContent = quoted.imageMessage; mediaType = 'image'; } 
                else if (quoted.videoMessage) { mediaContent = quoted.videoMessage; mediaType = 'video'; }

                if (mediaContent && mediaType) {
                    const stream = await downloadContentFromMessage(mediaContent, mediaType);
                    let buffer = Buffer.from([]);
                    for await(const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }

                    if (mediaType === 'image') await sock.sendMessage(jid, { image: buffer, caption: "✅ Saved" }, { quoted: m });
                    else await sock.sendMessage(jid, { video: buffer, caption: "✅ Saved" }, { quoted: m });
                }

            } catch (e) {
                console.log(`Error RVO: ${e.message}`);
            }
        }
    });
}

// =================== IPC HANDLER (KOMUNIKASI DENGAN WEB) ===================
// Bagian ini yang membuat bot bisa diperintah dari index.html / server.js
process.on('message', async (data) => {
    if (data.type === 'SEND_TEXT') {
        if (!globalSock) return;
        try {
            const id = data.jid.includes('@') ? data.jid : `${data.jid}@s.whatsapp.net`;
            await globalSock.sendMessage(id, { text: data.text });
            console.log(`IPC: Pesan terkirim ke ${id}`);
        } catch (error) {
            console.log(`IPC Error: ${error.message}`);
        }
    }
});

// STARTUP
const targetPhone = process.argv[2]; 
if (!targetPhone) {
    console.log("Error: Session Name Required");
    process.exit(1);
}
startBot(targetPhone);
