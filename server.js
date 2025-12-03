const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 5000;

const activeBots = new Map();
const botLogs = new Map();

const getSessions = () => {
    return fs.readdirSync('./').filter(file => {
        return fs.statSync(file).isDirectory() && /^\d+$/.test(file);
    });
};

const startBotProcess = (sessionName) => {
    if (activeBots.has(sessionName)) {
        return { success: false, message: 'Bot sudah berjalan' };
    }

    const child = spawn('node', ['bot.js', sessionName], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true
    });

    activeBots.set(sessionName, child);
    botLogs.set(sessionName, []);

    child.stdout.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        const logs = botLogs.get(sessionName) || [];
        lines.forEach(line => {
            if (line.trim()) {
                logs.push({ time: new Date().toLocaleTimeString('id-ID'), type: 'info', msg: line });
                if (logs.length > 100) logs.shift();
            }
        });
        botLogs.set(sessionName, logs);
    });

    child.stderr.on('data', (data) => {
        const logs = botLogs.get(sessionName) || [];
        logs.push({ time: new Date().toLocaleTimeString('id-ID'), type: 'error', msg: data.toString().trim() });
        if (logs.length > 100) logs.shift();
        botLogs.set(sessionName, logs);
    });

    child.on('close', (code) => {
        const logs = botLogs.get(sessionName) || [];
        logs.push({ time: new Date().toLocaleTimeString('id-ID'), type: 'system', msg: `Bot berhenti (Code: ${code})` });
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
        return { success: false, message: 'Bot sedang berjalan! Stop dulu sebelum menghapus.' };
    }
    
    const sessionPath = `./${sessionName}`;
    if (!fs.existsSync(sessionPath)) {
        return { success: false, message: 'Session tidak ditemukan' };
    }
    
    try {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        botLogs.delete(sessionName);
        return { success: true, message: 'Session berhasil dihapus' };
    } catch (e) {
        return { success: false, message: 'Gagal menghapus: ' + e.message };
    }
};

const addSession = (phoneNumber) => {
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    
    if (cleanPhone.length < 10) {
        return { success: false, message: 'Nomor tidak valid (minimal 10 digit)' };
    }
    
    if (getSessions().includes(cleanPhone)) {
        return { success: false, message: 'Nomor sudah terdaftar' };
    }
    
    startBotProcess(cleanPhone);
    return { success: true, message: 'Memproses pairing...', phone: cleanPhone };
};

const getHTML = () => `
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WhatsApp Bot Monitor</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            min-height: 100vh;
            color: #fff;
        }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        
        .header {
            text-align: center;
            padding: 30px 0;
            border-bottom: 1px solid rgba(255,255,255,0.1);
            margin-bottom: 30px;
        }
        .header h1 {
            font-size: 2.5em;
            background: linear-gradient(90deg, #00d9ff, #00ff88);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 10px;
        }
        .header p { color: #888; }
        
        .actions-bar {
            display: flex;
            gap: 15px;
            margin-bottom: 25px;
            flex-wrap: wrap;
        }
        .action-btn {
            padding: 12px 25px;
            border: none;
            border-radius: 10px;
            cursor: pointer;
            font-weight: bold;
            font-size: 1em;
            transition: all 0.3s;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .action-btn.add {
            background: linear-gradient(90deg, #00d9ff, #00ff88);
            color: #1a1a2e;
        }
        .action-btn:hover { opacity: 0.85; transform: scale(1.02); }
        
        .stats {
            display: flex;
            gap: 20px;
            margin-bottom: 30px;
            flex-wrap: wrap;
        }
        .stat-card {
            flex: 1;
            min-width: 150px;
            background: rgba(255,255,255,0.05);
            border-radius: 15px;
            padding: 20px;
            text-align: center;
            border: 1px solid rgba(255,255,255,0.1);
        }
        .stat-card .number {
            font-size: 2.5em;
            font-weight: bold;
            color: #00d9ff;
        }
        .stat-card .label { color: #888; margin-top: 5px; }
        .stat-card.active .number { color: #00ff88; }
        
        .sessions-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
            gap: 20px;
        }
        
        .session-card {
            background: rgba(255,255,255,0.05);
            border-radius: 15px;
            overflow: hidden;
            border: 1px solid rgba(255,255,255,0.1);
            transition: transform 0.3s, box-shadow 0.3s;
        }
        .session-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        }
        
        .session-header {
            padding: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        .session-info h3 {
            font-size: 1.2em;
            margin-bottom: 5px;
        }
        .session-info .phone {
            color: #888;
            font-size: 0.9em;
        }
        
        .status {
            padding: 5px 15px;
            border-radius: 20px;
            font-size: 0.85em;
            font-weight: bold;
        }
        .status.online {
            background: rgba(0,255,136,0.2);
            color: #00ff88;
        }
        .status.offline {
            background: rgba(255,100,100,0.2);
            color: #ff6464;
        }
        
        .session-logs {
            height: 180px;
            overflow-y: auto;
            padding: 15px;
            background: rgba(0,0,0,0.3);
            font-family: 'Consolas', monospace;
            font-size: 0.8em;
        }
        .session-logs::-webkit-scrollbar { width: 5px; }
        .session-logs::-webkit-scrollbar-thumb { background: #444; border-radius: 5px; }
        
        .log-line { padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .log-line .time { color: #666; margin-right: 10px; }
        .log-line.error { color: #ff6464; }
        .log-line.system { color: #ffaa00; }
        .log-line.info { color: #00d9ff; }
        
        .session-actions {
            padding: 15px 20px;
            display: flex;
            gap: 10px;
        }
        .btn {
            flex: 1;
            padding: 12px;
            border: none;
            border-radius: 10px;
            cursor: pointer;
            font-weight: bold;
            transition: all 0.3s;
            font-size: 0.9em;
        }
        .btn-start {
            background: linear-gradient(90deg, #00d9ff, #00ff88);
            color: #1a1a2e;
        }
        .btn-stop {
            background: linear-gradient(90deg, #ff6464, #ff8888);
            color: #fff;
        }
        .btn-delete {
            background: rgba(255,100,100,0.2);
            color: #ff6464;
            border: 1px solid #ff6464;
        }
        .btn:hover { opacity: 0.8; transform: scale(1.02); }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        
        .refresh-note {
            text-align: center;
            color: #666;
            margin-top: 30px;
            font-size: 0.9em;
        }
        
        /* Modal */
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            justify-content: center;
            align-items: center;
            z-index: 1000;
        }
        .modal.show { display: flex; }
        .modal-content {
            background: #1a1a2e;
            border-radius: 20px;
            padding: 30px;
            width: 90%;
            max-width: 450px;
            border: 1px solid rgba(255,255,255,0.1);
        }
        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 25px;
        }
        .modal-header h2 {
            color: #00d9ff;
        }
        .modal-close {
            background: none;
            border: none;
            color: #888;
            font-size: 1.5em;
            cursor: pointer;
        }
        .modal-close:hover { color: #fff; }
        
        .form-group {
            margin-bottom: 20px;
        }
        .form-group label {
            display: block;
            margin-bottom: 8px;
            color: #888;
        }
        .form-group input {
            width: 100%;
            padding: 15px;
            border: 1px solid rgba(255,255,255,0.2);
            border-radius: 10px;
            background: rgba(255,255,255,0.05);
            color: #fff;
            font-size: 1.1em;
        }
        .form-group input:focus {
            outline: none;
            border-color: #00d9ff;
        }
        .form-group small {
            display: block;
            margin-top: 8px;
            color: #666;
        }
        
        .modal-btn {
            width: 100%;
            padding: 15px;
            border: none;
            border-radius: 10px;
            cursor: pointer;
            font-weight: bold;
            font-size: 1em;
            background: linear-gradient(90deg, #00d9ff, #00ff88);
            color: #1a1a2e;
            transition: all 0.3s;
        }
        .modal-btn:hover { opacity: 0.85; }
        .modal-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        
        .pairing-code {
            text-align: center;
            padding: 20px;
            background: rgba(0,255,136,0.1);
            border-radius: 10px;
            margin: 20px 0;
        }
        .pairing-code .code {
            font-size: 2em;
            font-weight: bold;
            color: #00ff88;
            letter-spacing: 5px;
            font-family: 'Consolas', monospace;
        }
        .pairing-code p {
            color: #888;
            margin-top: 10px;
            font-size: 0.9em;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        .pulse { animation: pulse 2s infinite; }
        
        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: #666;
        }
        .empty-state h3 { margin-bottom: 10px; color: #888; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>WhatsApp Bot Monitor</h1>
            <p>Real-time monitoring dashboard</p>
        </div>
        
        <div class="actions-bar">
            <button class="action-btn add" onclick="showAddModal()">
                <span>+</span> Tambah WhatsApp
            </button>
        </div>
        
        <div class="stats" id="stats">
            <div class="stat-card">
                <div class="number" id="totalSessions">-</div>
                <div class="label">Total Sesi</div>
            </div>
            <div class="stat-card active">
                <div class="number" id="activeBots">-</div>
                <div class="label">Bot Aktif</div>
            </div>
            <div class="stat-card">
                <div class="number" id="uptime">-</div>
                <div class="label">Uptime</div>
            </div>
        </div>
        
        <div class="sessions-grid" id="sessionsGrid"></div>
        
        <p class="refresh-note pulse">Auto-refresh setiap 3 detik</p>
    </div>
    
    <!-- Modal Tambah WhatsApp -->
    <div class="modal" id="addModal">
        <div class="modal-content">
            <div class="modal-header">
                <h2>Tambah WhatsApp</h2>
                <button class="modal-close" onclick="closeAddModal()">&times;</button>
            </div>
            <div id="addModalBody">
                <div class="form-group">
                    <label>Nomor WhatsApp</label>
                    <input type="text" id="phoneInput" placeholder="628xxxxxxxxxx" />
                    <small>Masukkan nomor dengan kode negara (tanpa +)</small>
                </div>
                <button class="modal-btn" onclick="addWhatsApp()">Tambah & Dapatkan Kode Pairing</button>
            </div>
        </div>
    </div>
    
    <!-- Modal Konfirmasi Hapus -->
    <div class="modal" id="deleteModal">
        <div class="modal-content">
            <div class="modal-header">
                <h2 style="color:#ff6464">Hapus WhatsApp</h2>
                <button class="modal-close" onclick="closeDeleteModal()">&times;</button>
            </div>
            <p style="color:#888;margin-bottom:20px">Apakah Anda yakin ingin menghapus session <strong id="deletePhone" style="color:#fff"></strong>?</p>
            <p style="color:#ff6464;font-size:0.9em;margin-bottom:20px">Tindakan ini tidak dapat dibatalkan!</p>
            <div style="display:flex;gap:10px">
                <button class="btn" style="background:#333;color:#fff" onclick="closeDeleteModal()">Batal</button>
                <button class="btn btn-stop" onclick="confirmDelete()">Ya, Hapus</button>
            </div>
        </div>
    </div>
    
    <script>
        const startTime = Date.now();
        let deleteTarget = null;
        
        function formatUptime(ms) {
            const seconds = Math.floor(ms / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            if (hours > 0) return hours + 'h ' + (minutes % 60) + 'm';
            if (minutes > 0) return minutes + 'm ' + (seconds % 60) + 's';
            return seconds + 's';
        }
        
        async function fetchStatus() {
            try {
                const res = await fetch('/api/status');
                const data = await res.json();
                
                document.getElementById('totalSessions').textContent = data.sessions.length;
                document.getElementById('activeBots').textContent = data.activeBots.length;
                document.getElementById('uptime').textContent = formatUptime(Date.now() - startTime);
                
                const grid = document.getElementById('sessionsGrid');
                
                if (data.sessions.length === 0) {
                    grid.innerHTML = '<div class="empty-state"><h3>Belum ada WhatsApp</h3><p>Klik "Tambah WhatsApp" untuk memulai</p></div>';
                    return;
                }
                
                grid.innerHTML = data.sessions.map(session => {
                    const isActive = data.activeBots.includes(session);
                    const logs = data.logs[session] || [];
                    return \`
                        <div class="session-card">
                            <div class="session-header">
                                <div class="session-info">
                                    <h3>Bot Session</h3>
                                    <div class="phone">+\${session}</div>
                                </div>
                                <div class="status \${isActive ? 'online' : 'offline'}">
                                    \${isActive ? 'ONLINE' : 'OFFLINE'}
                                </div>
                            </div>
                            <div class="session-logs" id="logs-\${session}">
                                \${logs.length === 0 ? '<div class="log-line" style="color:#666">Tidak ada log...</div>' : 
                                    logs.slice(-20).map(l => \`<div class="log-line \${l.type}"><span class="time">\${l.time}</span>\${l.msg}</div>\`).join('')}
                            </div>
                            <div class="session-actions">
                                <button class="btn btn-start" onclick="startBot('\${session}')" \${isActive ? 'disabled' : ''}>
                                    Start
                                </button>
                                <button class="btn btn-stop" onclick="stopBot('\${session}')" \${!isActive ? 'disabled' : ''}>
                                    Stop
                                </button>
                                <button class="btn btn-delete" onclick="showDeleteModal('\${session}')" \${isActive ? 'disabled' : ''}>
                                    Hapus
                                </button>
                            </div>
                        </div>
                    \`;
                }).join('');
                
                data.sessions.forEach(session => {
                    const logsDiv = document.getElementById('logs-' + session);
                    if (logsDiv) logsDiv.scrollTop = logsDiv.scrollHeight;
                });
            } catch (e) {
                console.error('Fetch error:', e);
            }
        }
        
        async function startBot(session) {
            await fetch('/api/start/' + session, { method: 'POST' });
            fetchStatus();
        }
        
        async function stopBot(session) {
            await fetch('/api/stop/' + session, { method: 'POST' });
            fetchStatus();
        }
        
        function showAddModal() {
            document.getElementById('addModal').classList.add('show');
            document.getElementById('phoneInput').value = '';
            document.getElementById('addModalBody').innerHTML = \`
                <div class="form-group">
                    <label>Nomor WhatsApp</label>
                    <input type="text" id="phoneInput" placeholder="628xxxxxxxxxx" />
                    <small>Masukkan nomor dengan kode negara (tanpa +)</small>
                </div>
                <button class="modal-btn" onclick="addWhatsApp()">Tambah & Dapatkan Kode Pairing</button>
            \`;
        }
        
        function closeAddModal() {
            document.getElementById('addModal').classList.remove('show');
        }
        
        async function addWhatsApp() {
            const phone = document.getElementById('phoneInput').value.trim();
            if (!phone) {
                alert('Masukkan nomor WhatsApp!');
                return;
            }
            
            const res = await fetch('/api/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone })
            });
            const data = await res.json();
            
            if (data.success) {
                document.getElementById('addModalBody').innerHTML = \`
                    <div class="pairing-code">
                        <p style="color:#00d9ff;margin-bottom:15px">Menunggu Kode Pairing...</p>
                        <div class="code pulse" id="pairingCode">----</div>
                        <p>Masukkan kode ini di WhatsApp > Perangkat Tertaut > Tautkan Perangkat</p>
                    </div>
                    <p style="color:#888;font-size:0.9em;text-align:center">Kode akan muncul dalam beberapa detik. Cek juga di log session.</p>
                    <button class="modal-btn" style="margin-top:20px;background:#333;color:#fff" onclick="closeAddModal()">Tutup</button>
                \`;
                
                // Poll for pairing code
                let attempts = 0;
                const checkCode = setInterval(async () => {
                    attempts++;
                    const statusRes = await fetch('/api/status');
                    const statusData = await statusRes.json();
                    const logs = statusData.logs[data.phone] || [];
                    
                    for (const log of logs) {
                        if (log.msg.includes('KODE PAIRING')) {
                            const match = log.msg.match(/KODE PAIRING.*?:\\s*([\\d-]+)/);
                            if (match) {
                                document.getElementById('pairingCode').textContent = match[1];
                                document.getElementById('pairingCode').classList.remove('pulse');
                                clearInterval(checkCode);
                            }
                        }
                        if (log.msg.includes('TERHUBUNG')) {
                            document.getElementById('pairingCode').textContent = 'CONNECTED!';
                            document.getElementById('pairingCode').style.color = '#00ff88';
                            clearInterval(checkCode);
                        }
                    }
                    
                    if (attempts > 30) clearInterval(checkCode);
                }, 2000);
                
                fetchStatus();
            } else {
                alert(data.message);
            }
        }
        
        function showDeleteModal(session) {
            deleteTarget = session;
            document.getElementById('deletePhone').textContent = '+' + session;
            document.getElementById('deleteModal').classList.add('show');
        }
        
        function closeDeleteModal() {
            document.getElementById('deleteModal').classList.remove('show');
            deleteTarget = null;
        }
        
        async function confirmDelete() {
            if (!deleteTarget) return;
            
            const res = await fetch('/api/delete/' + deleteTarget, { method: 'POST' });
            const data = await res.json();
            
            if (data.success) {
                closeDeleteModal();
                fetchStatus();
            } else {
                alert(data.message);
            }
        }
        
        fetchStatus();
        setInterval(fetchStatus, 3000);
    </script>
</body>
</html>
`;

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    if (url.pathname === '/' || url.pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getHTML());
    }
    else if (url.pathname === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            sessions: getSessions(),
            activeBots: Array.from(activeBots.keys()),
            logs: Object.fromEntries(botLogs)
        }));
    }
    else if (url.pathname.startsWith('/api/start/') && req.method === 'POST') {
        const session = url.pathname.split('/')[3];
        const result = startBotProcess(session);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
    }
    else if (url.pathname.startsWith('/api/stop/') && req.method === 'POST') {
        const session = url.pathname.split('/')[3];
        const result = stopBotProcess(session);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
    }
    else if (url.pathname === '/api/add' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { phone } = JSON.parse(body);
                const result = addSession(phone);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(result));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'Invalid request' }));
            }
        });
    }
    else if (url.pathname.startsWith('/api/delete/') && req.method === 'POST') {
        const session = url.pathname.split('/')[3];
        const result = deleteSession(session);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
    }
    else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

process.on('SIGINT', () => {
    console.log('\nMematikan semua bot...');
    activeBots.forEach((child) => child.kill());
    process.exit(0);
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🌐 WhatsApp Bot Monitor berjalan di port ${PORT}`);
    console.log(`📊 Buka browser untuk melihat dashboard\n`);
});
