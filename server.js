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
            height: 200px;
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
        }
        .btn-start {
            background: linear-gradient(90deg, #00d9ff, #00ff88);
            color: #1a1a2e;
        }
        .btn-stop {
            background: linear-gradient(90deg, #ff6464, #ff8888);
            color: #fff;
        }
        .btn:hover { opacity: 0.8; transform: scale(1.02); }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        
        .refresh-note {
            text-align: center;
            color: #666;
            margin-top: 30px;
            font-size: 0.9em;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
        .pulse { animation: pulse 2s infinite; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>WhatsApp Bot Monitor</h1>
            <p>Real-time monitoring dashboard</p>
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
    
    <script>
        const startTime = Date.now();
        
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
