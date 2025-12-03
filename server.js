const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

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

// --- BOT PROCESS MANAGER ---
const startBotProcess = (sessionName) => {
    if (activeBots.has(sessionName)) {
        return { success: false, message: 'Bot sudah berjalan' };
    }

    // Spawn bot process
    const child = spawn('node', ['bot.js', sessionName], {
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });

    activeBots.set(sessionName, child);
    botLogs.set(sessionName, []);

    child.stdout.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        const logs = botLogs.get(sessionName) || [];
        
        lines.forEach(line => {
            if (line.trim()) {
                console.log(`[BOT-${sessionName}]: ${line}`); // Debug di terminal
                
                logs.push({ time: new Date().toLocaleTimeString('id-ID'), type: 'info', msg: line });
                if (logs.length > 100) logs.shift();
                
                // TANGKAP KODE PAIRING
                if (line.includes('KODE PAIRING')) {
                    const code = line.split(':')[1].trim();
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
        console.error(`[ERROR-${sessionName}]: ${data}`);
        logs.push({ time: new Date().toLocaleTimeString('id-ID'), type: 'error', msg: data.toString().trim() });
        botLogs.set(sessionName, logs);
    });

    child.on('close', (code) => {
        const logs = botLogs.get(sessionName) || [];
        logs.push({ time: new Date().toLocaleTimeString('id-ID'), type: 'system', msg: `Bot berhenti (Code: ${code})` });
        botLogs.set(sessionName, logs);
        activeBots.delete(sessionName);
        pairingCodes.delete(sessionName); // Reset kode saat mati
    });

    return { success: true, message: 'Bot dimulai' };
};

const stopBotProcess = (sessionName) => {
    const child = activeBots.get(sessionName);
    if (!child) return { success: false, message: 'Bot tidak berjalan' };
    child.kill();
    activeBots.delete(sessionName);
    return { success: true, message: 'Bot dihentikan' };
};

const deleteSession = (sessionName) => {
    if (activeBots.has(sessionName)) return { success: false, message: 'Matikan bot dulu!' };
    const sessionPath = path.join(__dirname, sessionName);
    
    if (!fs.existsSync(sessionPath)) return { success: false, message: 'Session tidak ditemukan' };
    
    try {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        botLogs.delete(sessionName);
        pairingCodes.delete(sessionName);
        return { success: true, message: 'Session dihapus' };
    } catch (e) {
        return { success: false, message: 'Gagal hapus: ' + e.message };
    }
};

const addSession = (phoneNumber) => {
    // FORMAT NOMOR HP: Ubah 08 jadi 628
    let cleanPhone = phoneNumber.replace(/\D/g, '');
    if (cleanPhone.startsWith('0')) {
        cleanPhone = '62' + cleanPhone.slice(1);
    }
    
    if (cleanPhone.length < 10) return { success: false, message: 'Nomor tidak valid' };
    if (getSessions().includes(cleanPhone)) return { success: false, message: 'Nomor sudah ada' };
    
    // Set status awal
    pairingCodes.set(cleanPhone, 'WAITING');
    
    // Jalankan bot
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

// --- HTML FRONTEND ---
const getHTML = () => `
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Cyber Monitor</title>
    <link rel="stylesheet" href="/style.css">
</head>
<body>
    <header class="top-bar">
        <div class="logo-area"><span>⚡</span> CYBER MON</div>
        <div class="time-display" id="clock">00:00</div>
    </header>

    <div class="container">
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

        <div class="main-controls">
            <button class="btn btn-green" onclick="openAddModal()">+ ADD BOT</button>
            <button class="btn btn-blue" onclick="startAll()">ALL ON</button>
            <button class="btn btn-red" onclick="stopAll()">ALL OFF</button>
        </div>

        <div class="section-title">> SESSION LIST</div>
        <div class="bot-grid" id="botGrid"></div>

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
                <div style="text-align:center; padding-top:100px; color:#555;">SELECT A BOT ABOVE</div>
            </div>
        </div>
    </div>

    <!-- ADD MODAL -->
    <div class="modal" id="addModal">
        <div class="modal-box">
            <h3>NEW TARGET</h3>
            <div id="step1">
                <input type="number" class="input-cyber" id="phoneInput" placeholder="628xxx / 08xxx">
                <div style="display:flex; gap:10px;">
                    <button class="btn btn-red" onclick="closeAddModal()">CANCEL</button>
                    <button class="btn btn-green" onclick="submitAddBot()">GET CODE</button>
                </div>
            </div>
            <div id="step2" class="hidden" style="text-align:center;">
                <p style="color:var(--cyan); font-size:12px; margin-top:10px;">PAIRING CODE:</p>
                <div id="pairingCodeDisplay">WAITING...</div>
                <button class="btn btn-red" style="width:100%" onclick="closeAddModal()">CLOSE</button>
            </div>
        </div>
    </div>

    <script>
        let selectedSession = null;
        let pairingInterval = null;
        const startTime = Date.now();

        // Clock & Uptime
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
                renderUI(data);
            } catch (e) {}
        }

        function renderUI(data) {
            document.getElementById('statTotal').innerText = data.sessions.length;
            document.getElementById('statActive').innerText = data.activeBots.length;
            document.getElementById('statOffline').innerText = data.sessions.length - data.activeBots.length;

            const grid = document.getElementById('botGrid');
            const currentHTML = data.sessions.map(s => {
                const isActive = data.activeBots.includes(s);
                const isSelected = selectedSession === s ? 'active' : '';
                return \`<div class="bot-card \${isActive ? 'online' : 'offline'} \${isSelected}" onclick="selectBot('\${s}')">
                        <h3>+\${s}</h3>
                        <span>\${isActive ? 'ONLINE' : 'OFFLINE'}</span>
                    </div>\`;
            }).join('');
            
            if (grid.innerHTML !== currentHTML) grid.innerHTML = currentHTML;
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
            fetchStatus();
            document.querySelector('.terminal-container').scrollIntoView({ behavior: 'smooth' });
        }

        async function controlBot(action) {
            if (!selectedSession) return;
            await fetch(\`/api/\${action}/\${selectedSession}\`, { method: 'POST' });
            if (action === 'delete') {
                selectedSession = null;
                document.getElementById('terminalLogs').innerHTML = '<div style="text-align:center; padding-top:100px; color:#555;">DELETED</div>';
                document.getElementById('termActions').style.display = 'none';
            }
            fetchStatus();
        }

        async function startAll() { await fetch('/api/start-all', { method: 'POST' }); }
        async function stopAll() { await fetch('/api/stop-all', { method: 'POST' }); }

        function openAddModal() { 
            document.getElementById('addModal').style.display = 'flex'; 
            document.getElementById('step1').classList.remove('hidden'); 
            document.getElementById('step2').classList.add('hidden'); 
            document.getElementById('pairingCodeDisplay').innerText = "WAITING...";
        }
        function closeAddModal() { 
            document.getElementById('addModal').style.display = 'none'; 
            if(pairingInterval) clearInterval(pairingInterval); 
        }

        async function submitAddBot() {
            const phone = document.getElementById('phoneInput').value;
            if (!phone) return alert('Input Number');
            
            const res = await fetch('/api/add', { method: 'POST', body: JSON.stringify({ phone }) });
            const data = await res.json();
            
            if (data.success) {
                document.getElementById('step1').classList.add('hidden');
                document.getElementById('step2').classList.remove('hidden');
                
                let attempts = 0;
                pairingInterval = setInterval(async () => {
                    attempts++;
                    const cRes = await fetch('/api/pairing-code/' + data.phone);
                    const cData = await cRes.json();
                    
                    if (cData.code && cData.code !== 'WAITING') {
                        document.getElementById('pairingCodeDisplay').innerText = cData.code === 'CONNECTED' ? 'SUCCESS' : cData.code;
                        if(cData.code === 'CONNECTED') { 
                            clearInterval(pairingInterval); 
                            setTimeout(closeAddModal, 2000); 
                        }
                    }
                    // Timeout jika lebih dari 60 detik tidak ada kode
                    if (attempts > 30) {
                        document.getElementById('pairingCodeDisplay').innerText = "TIMEOUT / ERROR";
                        clearInterval(pairingInterval);
                    }
                }, 2000);
            } else {
                alert(data.message);
            }
        }

        setInterval(fetchStatus, 2000);
        fetchStatus();
    </script>
</body>
</html>
`;

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    if (url.pathname === '/' || url.pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getHTML());
    }
    else if (url.pathname === '/style.css') {
        try {
            const cssContent = fs.readFileSync(path.join(__dirname, 'style.css'));
            res.writeHead(200, { 'Content-Type': 'text/css' });
            res.end(cssContent);
        } catch { res.writeHead(404); res.end(); }
    }
    else if (url.pathname === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sessions: getSessions(), activeBots: Array.from(activeBots.keys()), logs: Object.fromEntries(botLogs) }));
    }
    else if (url.pathname.startsWith('/api/pairing-code/')) {
        const phone = url.pathname.split('/')[3];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: pairingCodes.get(phone) || 'WAITING' }));
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
    // API Kirim Pesan
    else if (url.pathname === '/api/send-message' && req.method === 'POST') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
            try {
                const { session, jid, text } = JSON.parse(body);
                const child = activeBots.get(session);
                if (child) {
                    child.send({ type: 'SEND_TEXT', jid, text });
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                } else {
                    res.writeHead(400); res.end(JSON.stringify({ success: false, message: 'Bot offline' }));
                }
            } catch (e) { res.writeHead(500); res.end(e.message); }
        });
    }
    else { res.writeHead(404); res.end('Not Found'); }
});

process.on('SIGINT', () => { activeBots.forEach(c => c.kill()); process.exit(0); });

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ Server Running on Port ${PORT}`);
    // Code Cloudflared tetap bisa Anda tambahkan di sini jika perlu
});
