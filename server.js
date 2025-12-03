const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');
const localtunnel = require('localtunnel'); 
const crypto = require('crypto');

const PORT = 5000;

const activeBots = new Map();
const botLogs = new Map();
const pairingCodes = new Map();

// --- FUNCTION UTILS ---
const getSessions = () => {
    return fs.readdirSync('./').filter(file => {
        return fs.statSync(file).isDirectory() && /^\d+$/.test(file);
    });
};

const getWIBTime = () => {
    return new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
};

// --- BOT PROCESS MANAGER ---
const startBotProcess = (sessionName) => {
    if (activeBots.has(sessionName)) {
        return { success: false, message: 'Bot sudah berjalan' };
    }

    const child = spawn('node', ['bot.js', sessionName], {
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        shell: true
    });

    activeBots.set(sessionName, child);
    botLogs.set(sessionName, []);
    child.stdout.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        const logs = botLogs.get(sessionName) || [];
        
        lines.forEach(line => {
            if (line.trim()) {
                // --- TAMBAHAN BARIS INI UNTUK DEBUG DI TERMINAL ---
                console.log(`[BOT SAYS]: ${line}`); 
                // --------------------------------------------------

                logs.push({ time: new Date().toLocaleTimeString('id-ID'), type: 'info', msg: line });
                if (logs.length > 100) logs.shift();
                
                // PASTIKAN KEYWORDNYA SAMA PERSIS DENGAN DI BOT.JS
                if (line.includes('KODE PAIRING')) {
                    const parts = line.split(':');
                    // Ambil bagian terakhir setelah titik dua
                    const code = parts[parts.length - 1].trim(); 
                    pairingCodes.set(sessionName, code);
                }
                if (line.includes('TERHUBUNG')) {
                    pairingCodes.set(sessionName, 'CONNECTED');
                }
            }
        });
        botLogs.set(sessionName, logs);
    });
        
    child.stderr.on('data', (data) => {
        const logs = botLogs.get(sessionName) || [];
        logs.push({ time: new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' }), type: 'error', msg: data.toString().trim() });
        if (logs.length > 100) logs.shift();
        botLogs.set(sessionName, logs);
    });

    child.on('close', (code) => {
        const logs = botLogs.get(sessionName) || [];
        logs.push({ time: new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' }), type: 'system', msg: `Bot berhenti (Code: ${code})` });
        botLogs.set(sessionName, logs);
        activeBots.delete(sessionName);
    });

    return { success: true, message: 'Bot dimulai' };
};

const stopBotProcess = (sessionName) => {
    const child = activeBots.get(sessionName);
    if (!child) {
        return { success: false, message: 'Bot tidak berjalan' };
    }
    child.kill();
    activeBots.delete(sessionName);
    return { success: true, message: 'Bot dihentikan' };
};

const deleteSession = (sessionName) => {
    if (activeBots.has(sessionName)) {
        return { success: false, message: 'Bot sedang berjalan! Stop dulu.' };
    }
    const sessionPath = `./${sessionName}`;
    if (!fs.existsSync(sessionPath)) {
        return { success: false, message: 'Session tidak ditemukan' };
    }
    try {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        botLogs.delete(sessionName);
        pairingCodes.delete(sessionName);
        return { success: true, message: 'Session dihapus' };
    } catch (e) {
        return { success: false, message: 'Gagal: ' + e.message };
    }
};

const addSession = (phoneNumber) => {
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    if (cleanPhone.length < 10) return { success: false, message: 'Nomor tidak valid' };
    if (getSessions().includes(cleanPhone)) return { success: false, message: 'Nomor sudah ada' };
    
    pairingCodes.set(cleanPhone, 'WAITING');
    startBotProcess(cleanPhone);
    return { success: true, message: 'Processing...', phone: cleanPhone };
};

const startAllBots = () => {
    getSessions().forEach(s => { if (!activeBots.has(s)) startBotProcess(s); });
    return { success: true, message: 'All bots started' };
};

const stopAllBots = () => {
    activeBots.forEach((child) => child.kill());
    activeBots.clear();
    return { success: true, message: 'All bots stopped' };
};

// --- HTML FRONTEND (MOBILE LAYOUT) ---
const getHTML = () => `
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>WA • Cyber Monitor</title>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Rajdhani:wght@500;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-dark: #050b14;
            --bg-panel: #0a141f;
            --wa-green: #00ff88;
            --wa-dark: #005c4b;
            --cyan: #00d9ff;
            --red: #ff3333;
            --text-main: #e0e6ed;
            --text-dim: #5c6b7f;
            --border: 1px solid rgba(0, 255, 136, 0.2);
        }

        * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        
        body {
            background-color: var(--bg-dark);
            color: var(--text-main);
            font-family: 'Rajdhani', sans-serif;
            min-height: 100vh;
            overflow-x: hidden;
            padding-bottom: 20px;
        }

        /* Background Effects */
        body::after {
            content: ""; position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%);
            background-size: 100% 2px; pointer-events: none; z-index: 999; opacity: 0.3;
        }

        /* HEADER */
        .top-bar {
            height: 60px; background: var(--bg-panel); border-bottom: var(--border);
            display: flex; align-items: center; justify-content: space-between;
            padding: 0 15px; position: sticky; top: 0; z-index: 100;
            box-shadow: 0 5px 20px rgba(0,0,0,0.8);
        }
        .logo-area {
            font-family: 'JetBrains Mono'; font-weight: 700; color: var(--wa-green);
            font-size: 18px; letter-spacing: 1px; display: flex; gap: 8px; align-items: center;
        }
        .time-display { font-family: 'JetBrains Mono'; color: var(--cyan); font-size: 14px; }

        /* CONTAINER */
        .container { padding: 15px; max-width: 800px; margin: 0 auto; }

        /* STATS (Grid 2x2 on mobile) */
        .stats-bar {
            display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px;
        }
        .stat-box {
            background: rgba(0, 255, 136, 0.05); border: 1px solid rgba(0, 255, 136, 0.1);
            padding: 10px; border-radius: 4px; display: flex; flex-direction: column;
            align-items: center; text-align: center;
        }
        .stat-box .label { font-size: 10px; color: var(--text-dim); letter-spacing: 1px; margin-bottom: 2px; }
        .stat-box .value { font-size: 18px; font-family: 'JetBrains Mono'; font-weight: bold; }
        .stat-box.online .value { color: var(--wa-green); text-shadow: 0 0 5px var(--wa-green); }
        .stat-box.offline .value { color: var(--red); }

        /* ACTION BUTTONS */
        .main-controls { display: flex; gap: 8px; margin-bottom: 20px; }
        .btn {
            flex: 1; padding: 12px 5px; border: none; font-family: 'Rajdhani'; font-weight: bold;
            font-size: 12px; cursor: pointer; text-transform: uppercase; letter-spacing: 1px;
            clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px);
            transition: 0.2s;
        }
        .btn-green { background: var(--wa-green); color: #000; }
        .btn-green:active { transform: scale(0.98); background: #fff; }
        .btn-blue { background: rgba(0, 217, 255, 0.1); border: 1px solid var(--cyan); color: var(--cyan); }
        .btn-red { background: rgba(255, 51, 51, 0.1); border: 1px solid var(--red); color: var(--red); }

        /* BOT LIST (GRID SYSTEM) */
        .section-title { color: var(--text-dim); font-size: 12px; margin-bottom: 10px; letter-spacing: 2px; border-bottom: 1px solid #222; padding-bottom: 5px; }
        
        .bot-grid {
            display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; margin-bottom: 25px;
        }

        .bot-card {
            background: rgba(255,255,255,0.03); border: 1px solid transparent;
            padding: 15px 10px; border-radius: 4px; cursor: pointer; position: relative;
            display: flex; flex-direction: column; align-items: center; gap: 5px;
            transition: all 0.2s;
        }
        .bot-card:active { transform: scale(0.98); }
        .bot-card.active { border-color: var(--wa-green); background: rgba(0, 255, 136, 0.05); }
        .bot-card.online { border-bottom: 2px solid var(--wa-green); }
        .bot-card.offline { border-bottom: 2px solid var(--red); opacity: 0.7; }
        
        .bot-card h3 { font-family: 'JetBrains Mono'; font-size: 14px; color: #fff; }
        .bot-card span { font-size: 10px; padding: 2px 6px; border-radius: 2px; }
        .bot-card.online span { background: var(--wa-green); color: #000; }
        .bot-card.offline span { background: var(--red); color: #fff; }

        /* TERMINAL (DI BAWAH) */
        .terminal-container {
            background: #000; border: 1px solid #333; border-radius: 6px;
            display: flex; flex-direction: column; overflow: hidden;
            height: 400px; /* Fixed height for log area */
            box-shadow: 0 0 15px rgba(0,0,0,0.5);
        }
        .terminal-header {
            background: #111; padding: 8px 12px; border-bottom: 1px solid #333;
            display: flex; justify-content: space-between; align-items: center;
        }
        .terminal-title { font-family: 'JetBrains Mono'; font-size: 11px; color: var(--wa-green); }
        
        .terminal-actions button {
            background: transparent; border: 1px solid #444; color: #888; margin-left: 5px;
            padding: 2px 8px; font-size: 10px; cursor: pointer; font-family: 'JetBrains Mono';
        }
        .terminal-actions button.del { border-color: var(--red); color: var(--red); }
        
        .terminal-logs {
            flex: 1; padding: 10px; overflow-y: auto; font-family: 'JetBrains Mono'; font-size: 11px;
            color: #ccc; line-height: 1.4; background: radial-gradient(circle at center, #111 0%, #000 100%);
        }
        
        .log-entry { margin-bottom: 3px; display: flex; flex-wrap: wrap; }
        .log-time { color: #555; margin-right: 6px; font-size: 10px; }
        .log-msg { word-break: break-all; }
        .info .log-msg { color: var(--cyan); }
        .error .log-msg { color: var(--red); }
        .system .log-msg { color: #ffeb3b; }

        /* MODAL */
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); z-index: 2000; align-items: center; justify-content: center; }
        .modal-box { background: var(--bg-panel); border: 1px solid var(--wa-green); padding: 25px; width: 90%; max-width: 350px; }
        .input-cyber { width: 100%; padding: 10px; background: #000; border: 1px solid #333; color: var(--wa-green); font-family: 'JetBrains Mono'; margin: 15px 0; outline: none; }
        .hidden { display: none !important; }

    </style>
</head>
<body>

    <header class="top-bar">
        <div class="logo-area"><span>⚡</span> CYBER MON</div>
        <div class="time-display" id="clock">00:00</div>
    </header>

    <div class="container">
        <!-- STATS ROW -->
        <div class="stats-bar">
            <div class="stat-box">
                <span class="label">TOTAL</span>
                <span class="value" id="statTotal">0</span>
            </div>
            <div class="stat-box online">
                <span class="label">ONLINE</span>
                <span class="value" id="statActive">0</span>
            </div>
            <div class="stat-box offline">
                <span class="label">OFFLINE</span>
                <span class="value" id="statOffline">0</span>
            </div>
            <div class="stat-box">
                <span class="label">UPTIME</span>
                <span class="value" style="font-size:14px" id="statUptime">0h</span>
            </div>
        </div>

        <!-- MAIN CONTROLS -->
        <div class="main-controls">
            <button class="btn btn-green" onclick="openAddModal()">+ ADD BOT</button>
            <button class="btn btn-blue" onclick="startAll()">ALL ON</button>
            <button class="btn btn-red" onclick="stopAll()">ALL OFF</button>
        </div>

        <!-- BOT LIST GRID -->
        <div class="section-title">> SESSION LIST</div>
        <div class="bot-grid" id="botGrid">
            <!-- Bot Cards Injected Here -->
        </div>

        <!-- TERMINAL AREA -->
        <div class="section-title">> TERMINAL LOGS</div>
        <div class="terminal-container">
            <div class="terminal-header">
                <div class="terminal-title" id="termTitle">NO SESSION SELECTED</div>
                <div class="terminal-actions" id="termActions" style="display:none">
                    <button onclick="controlBot('start')">START</button>
                    <button onclick="controlBot('stop')">STOP</button>
                    <button class="del" onclick="controlBot('delete')">DEL</button>
                </div>
            </div>
            <div class="terminal-logs" id="terminalLogs">
                <div style="text-align:center; padding-top:100px; color:#333;">
                    SELECT A BOT ABOVE<br>TO VIEW LOGS
                </div>
            </div>
        </div>
    </div>

    <!-- ADD MODAL -->
    <div class="modal" id="addModal">
        <div class="modal-box">
            <h3 style="color:var(--text-main)">NEW TARGET</h3>
            <div id="step1">
                <input type="number" class="input-cyber" id="phoneInput" placeholder="628xxx">
                <div style="display:flex; gap:10px;">
                    <button class="btn btn-red" onclick="closeAddModal()">CANCEL</button>
                    <button class="btn btn-green" onclick="submitAddBot()">GET CODE</button>
                </div>
            </div>
            <div id="step2" class="hidden" style="text-align:center;">
                <p style="color:var(--cyan); font-size:12px; margin-top:10px;">PAIRING CODE:</p>
                <div id="pairingCodeDisplay" style="font-size:28px; font-weight:bold; color:var(--wa-green); margin:15px 0; letter-spacing:3px;">...</div>
                <button class="btn btn-red" style="width:100%" onclick="closeAddModal()">CLOSE</button>
            </div>
        </div>
    </div>

    <script>
        let selectedSession = null;
        let lastData = null;
        const startTime = Date.now();
        let pairingInterval = null;

        setInterval(() => {
            document.getElementById('clock').innerText = new Date().toLocaleTimeString('id-ID', {hour12: false, hour:'2-digit', minute:'2-digit'});
            const diff = Math.floor((Date.now() - startTime) / 1000);
            const h = Math.floor(diff/3600);
            const m = Math.floor((diff%3600)/60);
            document.getElementById('statUptime').innerText = \`\${h}h \${m}m\`;
        }, 1000);

        async function fetchStatus() {
            try {
                const res = await fetch('/api/status');
                const data = await res.json();
                lastData = data;
                renderUI(data);
            } catch (e) {}
        }

        function renderUI(data) {
            // Stats
            document.getElementById('statTotal').innerText = data.sessions.length;
            document.getElementById('statActive').innerText = data.activeBots.length;
            document.getElementById('statOffline').innerText = data.sessions.length - data.activeBots.length;

            // Bot Grid
            const grid = document.getElementById('botGrid');
            const currentHTML = data.sessions.map(s => {
                const isActive = data.activeBots.includes(s);
                const isSelected = selectedSession === s ? 'active' : '';
                return \`
                    <div class="bot-card \${isActive ? 'online' : 'offline'} \${isSelected}" onclick="selectBot('\${s}')">
                        <h3>+\${s}</h3>
                        <span>\${isActive ? 'ONLINE' : 'OFFLINE'}</span>
                    </div>
                \`;
            }).join('');
            
            if (grid.innerHTML !== currentHTML) grid.innerHTML = currentHTML;

            // Logs
            updateTerminal(data);
        }

        function updateTerminal(data) {
            if (!selectedSession) return;
            
            document.getElementById('termTitle').innerText = \`ROOT@\${selectedSession}\`;
            document.getElementById('termActions').style.display = 'block';

            const logs = data.logs[selectedSession] || [];
            const logContainer = document.getElementById('terminalLogs');
            
            if (logs.length === 0) {
                logContainer.innerHTML = '<div style="padding:10px; color:#555">No logs yet...</div>';
                return;
            }

            const html = logs.map(l => \`
                <div class="log-entry \${l.type}">
                    <span class="log-time">[\${l.time}]</span>
                    <span class="log-msg">\${l.msg}</span>
                </div>
            \`).join('');

            const shouldScroll = logContainer.scrollTop + logContainer.clientHeight >= logContainer.scrollHeight - 50;
            if (logContainer.innerHTML !== html) {
                logContainer.innerHTML = html;
                if (shouldScroll) logContainer.scrollTop = logContainer.scrollHeight;
            }
        }

        function selectBot(session) {
            selectedSession = session;
            if (lastData) renderUI(lastData);
            // Scroll ke terminal saat bot dipilih agar user sadar log ada dibawah
            document.querySelector('.terminal-container').scrollIntoView({ behavior: 'smooth' });
        }

        async function controlBot(action) {
            if (!selectedSession) return;
            await fetch(\`/api/\${action}/\${selectedSession}\`, { method: 'POST' });
            if (action === 'delete') {
                selectedSession = null;
                document.getElementById('terminalLogs').innerHTML = '<div style="text-align:center; padding-top:100px; color:#333;">DELETED</div>';
                document.getElementById('termActions').style.display = 'none';
            }
            fetchStatus();
        }

        async function startAll() { await fetch('/api/start-all', { method: 'POST' }); fetchStatus(); }
        async function stopAll() { await fetch('/api/stop-all', { method: 'POST' }); fetchStatus(); }

        // Modal Logic
        function openAddModal() { document.getElementById('addModal').style.display = 'flex'; document.getElementById('step1').classList.remove('hidden'); document.getElementById('step2').classList.add('hidden'); }
        function closeAddModal() { document.getElementById('addModal').style.display = 'none'; if(pairingInterval) clearInterval(pairingInterval); }

        async function submitAddBot() {
            const phone = document.getElementById('phoneInput').value;
            if (!phone) return alert('Input Number');
            const res = await fetch('/api/add', { method: 'POST', body: JSON.stringify({ phone }) });
            const data = await res.json();
            if (data.success) {
                document.getElementById('step1').classList.add('hidden');
                document.getElementById('step2').classList.remove('hidden');
                pairingInterval = setInterval(async () => {
                    const cRes = await fetch('/api/pairing-code/' + data.phone);
                    const cData = await cRes.json();
                    if (cData.code && cData.code !== 'WAITING') {
                        document.getElementById('pairingCodeDisplay').innerText = cData.code === 'CONNECTED' ? 'SUCCESS' : cData.code;
                        if(cData.code === 'CONNECTED') { clearInterval(pairingInterval); setTimeout(closeAddModal, 2000); fetchStatus(); }
                    }
                }, 2000);
            } else alert(data.message);
        }

        fetchStatus();
        setInterval(fetchStatus, 2000);
    </script>
</body>
</html>
`;

// --- SERVER HANDLER ---
// --- UBAH BAGIAN SERVER HANDLER ---
const server = http.createServer((req, res) => {
    // Parsing URL
    const url = new URL(req.url, `http://localhost:${PORT}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // 1. ROUTE UNTUK HALAMAN UTAMA (HTML)
    if (url.pathname === '/' || url.pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        // Hapus <style>...</style> dari getHTML() dan ganti dengan:
        // <link rel="stylesheet" href="/style.css">
        res.end(getHTML()); 
    }
    // ... API lain ...

// API BARU: Kirim Pesan dari Web
else if (url.pathname === '/api/send-message' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
        try {
            const { session, jid, text } = JSON.parse(body);
            const child = activeBots.get(session);
            
            if (child) {
                // KIRIM DATA KE BOT.JS LEWAT JALUR IPC
                child.send({ type: 'SEND_TEXT', jid, text });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Perintah dikirim ke bot' }));
            } else {
                res.writeHead(400); 
                res.end(JSON.stringify({ success: false, message: 'Bot mati/tidak ada' }));
            }
        } catch (e) { res.writeHead(500); res.end(e.message); }
    });
}
    // 2. ROUTE BARU UNTUK STYLE.CSS
    else if (url.pathname === '/style.css') {
        try {
            const cssContent = fs.readFileSync(path.join(__dirname, 'style.css'));
            res.writeHead(200, { 'Content-Type': 'text/css' });
            res.end(cssContent);
        } catch (e) {
            res.writeHead(404);
            res.end("CSS Not Found");
        }
    }
    else if (url.pathname === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sessions: getSessions(), activeBots: Array.from(activeBots.keys()), logs: Object.fromEntries(botLogs) }));
    }
    else if (url.pathname.startsWith('/api/pairing-code/')) {
        const phone = url.pathname.split('/')[3];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: pairingCodes.get(phone) || null }));
    }
    else if (url.pathname.startsWith('/api/start/') && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(startBotProcess(url.pathname.split('/')[3])));
    }
    else if (url.pathname.startsWith('/api/stop/') && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stopBotProcess(url.pathname.split('/')[3])));
    }
    else if (url.pathname === '/api/start-all' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(startAllBots()));
    }
    else if (url.pathname === '/api/stop-all' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stopAllBots()));
    }
    else if (url.pathname === '/api/add' && req.method === 'POST') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
            try {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(addSession(JSON.parse(body).phone)));
            } catch { res.writeHead(400); res.end(); }
        });
    }
    else if (url.pathname.startsWith('/api/delete/') && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(deleteSession(url.pathname.split('/')[3])));
    }
    else { res.writeHead(404); res.end('Not Found'); }
});

process.on('SIGINT', () => { activeBots.forEach(c => c.kill()); process.exit(0); });

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ Local Server: http://localhost:${PORT}`);
    console.log('⏳ Menghubungkan ke Cloudflare Quick Tunnel...');
    console.log('   (Ini solusi paling cepat & anti-blokir untuk Termux)');

    // Menjalankan Cloudflared
    const tunnel = spawn('cloudflared', [
        'tunnel', 
        '--url', `http://localhost:${PORT}`,
        '--logfile', 'cloudflared.log' // Supaya log bersih
    ]);

    // Cloudflared mengeluarkan link lewat stderr
    tunnel.stderr.on('data', (data) => {
        const output = data.toString();
        // Mencari link trycloudflare.com
        const urlMatch = output.match(/https:\/\/[\w-]+\.trycloudflare\.com/);
        
        if (urlMatch) {
            console.log(`\n🚀 LINK DASHBOARD BERHASIL:`);
            console.log(`👉 ${urlMatch[0]}`);
            console.log(`\n(Gunakan link ini di browser HP lain untuk monitoring)`);
        }
    });

    tunnel.on('close', (code) => {
        console.log(`Cloudflared berhenti (Code: ${code})`);
    });
    
    // Matikan cloudflared jika bot dimatikan
    process.on('exit', () => tunnel.kill());
});
