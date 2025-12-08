const http = require('http');
const fs = require('fs');
const { spawn, exec, execSync } = require('child_process');
const crypto = require('crypto');
const axios = require('axios');
const os = require('os');
const path = require('path');

// ====================================================
// ⚙️ KONFIGURASI SERVER
// ====================================================
const BIN_ID = '693151eed0ea881f40121ca6';
const API_KEY = '$2a$10$u00Qvq6xrri32tc7bEYVhuQv94XS.ygeVCr70UDbzoOVlR8yLuUq.';
const WA_ADMIN = 'https://wa.me/6283879950760';
const EXTERNAL_REDIRECT = 'https://xgenzy.github.io/RVO/';

// Port untuk Cloudflare Pages/Workers
const PORT = process.env.PORT || 3000;

// Auto-restart config
const HEALTH_CHECK_INTERVAL = 15000;
const MAX_RETRIES = 5;
const RESTART_DELAY = 3000;

// ====================================================
// AUTO INSTALL DEPENDENCIES
// ====================================================
async function installDependencies() {
    console.log('📦 Checking and installing dependencies...');
    
    const dependencies = [
        'axios',
        'btch-downloader',
        'express',
        'socket.io',
        'qrcode-terminal',
        'wa-sticker-formatter',
        '@whiskeysockets/baileys',
        'moment',
        'fluent-ffmpeg',
        'form-data',
        'node-fetch',
        'cheerio'
    ];

    const packageJson = {
        name: "whatsapp-bot-manager",
        version: "1.0.0",
        main: "server.js",
        scripts: {
            "start": "node server.js",
            "install-deps": "npm install",
            "dev": "node server.js"
        },
        dependencies: {}
    };

    try {
        // Create package.json if doesn't exist
        if (!fs.existsSync('package.json')) {
            dependencies.forEach(dep => {
                packageJson.dependencies[dep] = "latest";
            });
            fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2));
            console.log('✅ Created package.json');
        }

        // Check if node_modules exists
        if (!fs.existsSync('node_modules')) {
            console.log('📥 Installing dependencies... This may take a minute.');
            
            // Install dependencies
            const installProcess = spawn('npm', ['install', '--no-audit', '--no-fund', '--production'], {
                stdio: 'inherit',
                shell: true
            });

            await new Promise((resolve, reject) => {
                installProcess.on('close', (code) => {
                    if (code === 0) {
                        console.log('✅ Dependencies installed successfully');
                        resolve();
                    } else {
                        reject(new Error(`npm install failed with code ${code}`));
                    }
                });
            });
        } else {
            console.log('✅ Dependencies already installed');
        }

        // Install cloudflared if not exists
        if (!checkCloudflared()) {
            await installCloudflared();
        }

    } catch (error) {
        console.warn('⚠️ Dependency installation warning:', error.message);
        console.log('🔄 Continuing with available dependencies...');
    }
}

function checkCloudflared() {
    try {
        if (os.platform() === 'win32') {
            execSync('where cloudflared', { stdio: 'ignore' });
        } else {
            execSync('which cloudflared', { stdio: 'ignore' });
        }
        return true;
    } catch {
        return false;
    }
}

async function installCloudflared() {
    console.log('📥 Installing cloudflared...');
    
    try {
        let downloadUrl = '';
        let filename = 'cloudflared';
        
        switch (os.platform()) {
            case 'win32':
                downloadUrl = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
                filename = 'cloudflared.exe';
                break;
            case 'darwin':
                downloadUrl = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz';
                break;
            default:
                downloadUrl = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64';
        }
        
        const response = await axios({
            method: 'GET',
            url: downloadUrl,
            responseType: 'stream'
        });
        
        const writer = fs.createWriteStream(filename);
        response.data.pipe(writer);
        
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
        
        if (os.platform() !== 'win32') {
            fs.chmodSync(filename, 0o755);
        }
        
        console.log('✅ Cloudflared installed successfully');
        
    } catch (error) {
        console.warn('⚠️ Could not install cloudflared:', error.message);
    }
}

// ====================================================
// STATE MANAGEMENT
// ====================================================
let cloudflaredProcess = null;
let tunnelUrl = null;
let retryCount = 0;
let isRestarting = false;
let httpServer = null;
let serverPort = null;

const STATUS_FILE = path.join(__dirname, 'server_status.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const BOTS_META_FILE = path.join(__dirname, 'bots.json');

let usersDB = [];
let botsMeta = {};
const activeBots = new Map();
const pairingCodes = new Map();
const activeSessions = new Map();
const checkRequests = new Map();

// ====================================================
// DATABASE FUNCTIONS
// ====================================================
function loadUsersDB() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const data = fs.readFileSync(USERS_FILE, 'utf8').trim();
            
            if (!data) {
                console.log('users.json is empty, initializing...');
                usersDB = [];
                saveUsers();
                return;
            }
            
            const parsed = JSON.parse(data);
            
            if (Array.isArray(parsed)) {
                usersDB = parsed;
                console.log(`Loaded ${usersDB.length} users from database`);
            } else {
                console.error('users.json is not an array, resetting...');
                usersDB = [];
                saveUsers();
            }
        } else {
            console.log('users.json not found, creating...');
            usersDB = [];
            saveUsers();
        }
    } catch (error) {
        console.error('Error loading users DB:', error.message);
        usersDB = [];
        try {
            fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
            console.log('Created new users.json file');
        } catch (writeError) {
            console.error('Failed to create users.json:', writeError.message);
        }
    }
}

loadUsersDB();

const saveUsers = () => {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(usersDB, null, 2));
        console.log(`Saved ${usersDB.length} users to database`);
    } catch (error) {
        console.error('Error saving users DB:', error.message);
    }
};

if (fs.existsSync(BOTS_META_FILE)) {
    try { botsMeta = JSON.parse(fs.readFileSync(BOTS_META_FILE)); }
    catch { botsMeta = {}; }
}
const saveBotMeta = () => fs.writeFileSync(BOTS_META_FILE, JSON.stringify(botsMeta, null, 2));

// ====================================================
// UTILS FUNCTIONS
// ====================================================
async function updateCloudUrl(url) {
    if (BIN_ID.includes('MASUKKAN')) return;
    try {
        await axios.put(`https://api.jsonbin.io/v3/b/${BIN_ID}`,
            { url: url, updated: new Date().toISOString() },
            { headers: { 'X-Master-Key': API_KEY, 'Content-Type': 'application/json' } }
        );
        console.log('✅ Cloud URL updated');
    } catch (e) {
        console.warn('⚠️ Failed to update cloud URL:', e.message);
    }
}

const generateToken = () => crypto.randomBytes(16).toString('hex');
const getSessionInfo = (req) => {
    const h = req.headers.cookie;
    if (!h) return null;
    const c = h.split(';').reduce((a, b) => {
        const [n, v] = b.trim().split('=');
        a[n] = v;
        return a;
    }, {});
    return c.auth_token ? activeSessions.get(c.auth_token) : null;
};

const isAuthenticated = (req) => !!getSessionInfo(req);
const normalizePhone = (ph) => {
    let p = ph.replace(/[^0-9]/g, '');
    if (p.startsWith('0')) p = '62' + p.substring(1);
    else if (p.startsWith('8')) p = '62' + p;
    return p;
};

// ====================================================
// BOT PROCESS FUNCTIONS
// ====================================================
const getSessions = () => fs.readdirSync('./').filter(file => {
    try {
        return fs.statSync(file).isDirectory() && /^\d+$/.test(file);
    } catch {
        return false;
    }
});

const startBotProcess = (sessionName) => {
    const meta = botsMeta[sessionName];
    if (!meta) return { success: false, message: 'Sesi tidak ditemukan' };

    if (meta.isTrial && meta.trialEnd && Date.now() > meta.trialEnd) {
        meta.active = false;
        saveBotMeta();
        return { success: false, message: 'Trial Habis' };
    }

    if (!meta.active) return { success: false, message: 'Menunggu Persetujuan Admin' };
    if (activeBots.has(sessionName)) return { success: false, message: 'Sudah Jalan' };

    pairingCodes.delete(sessionName);

    const child = spawn('node', ['bot.js', sessionName], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        shell: true,
        env: { ...process.env, RVO_MODE: 'true', SWSAVE_MODE: 'true', ANTIBAN_MODE: 'true' }
    });

    activeBots.set(sessionName, child);

    child.stdout.on('data', (d) => {
        const lines = d.toString().trim().split('\n');
        lines.forEach(l => {
            const clean = l.trim();
            if (clean) {
                if (clean.includes('KODE PAIRING')) pairingCodes.set(sessionName, clean.split(':').pop().trim());
                if (clean.includes('TERHUBUNG')) pairingCodes.set(sessionName, 'CONNECTED');
            }
        });
    });

    child.on('message', (msg) => {
        if (msg && msg.type === 'CHECK_RESULT' && msg.requestId) {
            const resolver = checkRequests.get(msg.requestId);
            if (resolver) {
                resolver(msg.data);
                checkRequests.delete(msg.requestId);
            }
        }
    });

    child.on('close', () => activeBots.delete(sessionName));
    return { success: true };
};

const stopBotProcess = (sessionName) => {
    if (activeBots.has(sessionName)) {
        activeBots.get(sessionName).kill();
        activeBots.delete(sessionName);
        return { success: true };
    }
    return { success: false };
};

const deleteSession = (sessionName) => {
    if (activeBots.has(sessionName)) activeBots.get(sessionName).kill();
    try {
        fs.rmSync(`./${sessionName}`, { recursive: true, force: true });
        delete botsMeta[sessionName];
        saveBotMeta();
        return { success: true };
    } catch (e) { return { success: false }; }
};

const addSession = (ph, owner) => {
    let p = normalizePhone(ph);
    if (getSessions().includes(p)) return { success: false, message: 'Nomor ada' };
    botsMeta[p] = { owner: owner, active: false, isTrial: false, trialEnd: null };
    saveBotMeta();
    pairingCodes.set(p, 'WAITING');

    const child = spawn('node', ['bot.js', p], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'], shell: true });
    activeBots.set(p, child);

    child.stdout.on('data', (d) => {
        const l = d.toString();
        if (l.includes('KODE PAIRING')) pairingCodes.set(p, l.split(':').pop().trim());
        if (l.includes('TERHUBUNG')) pairingCodes.set(p, 'CONNECTED');
    });

    setTimeout(() => {
        if (activeBots.has(p) && pairingCodes.get(p) !== 'CONNECTED') {
            activeBots.get(p).kill();
            activeBots.delete(p);
        }
    }, 120000);
    return { success: true, phone: p };
};

// ====================================================
// AUTO-RESTART SYSTEM
// ====================================================
function killExistingCloudflared() {
    try {
        if (os.platform() === 'win32') {
            exec('taskkill /F /IM cloudflared.exe 2>nul', () => { });
        } else {
            exec('pkill -f cloudflared 2>/dev/null', () => { });
        }
    } catch (error) {
        // Ignore errors
    }
}

function startCloudflaredTunnel(port) {
    return new Promise((resolve, reject) => {
        console.log(`🚇 Starting Cloudflare Tunnel for port ${port}...`);

        killExistingCloudflared();

        const cloudflaredCmd = os.platform() === 'win32' ? 'cloudflared.exe' : './cloudflared';

        cloudflaredProcess = spawn(cloudflaredCmd, [
            'tunnel',
            '--url', `http://localhost:${port}`,
            '--no-autoupdate'
        ], {
            stdio: ['pipe', 'pipe', 'pipe'],
            detached: false
        });

        let tunnelOutput = '';
        let urlFound = false;

        cloudflaredProcess.stderr.on('data', (data) => {
            const output = data.toString();
            tunnelOutput += output;

            const lines = output.split('\n');
            lines.forEach(line => {
                if (line.trim()) console.log('[CLOUDFLARED]', line.trim());
            });

            const urlMatch = output.match(/https:\/\/([a-zA-Z0-9\-]+\.trycloudflare\.com)/);
            if (urlMatch && !tunnelUrl) {
                tunnelUrl = `https://${urlMatch[1]}`;
                urlFound = true;

                console.log(`\n╔══════════════════════════════════════════╗`);
                console.log(`║         🚀 TUNNEL CREATED SUCCESSFULLY    ║`);
                console.log(`╚══════════════════════════════════════════╝\n`);
                console.log(`🌍 PUBLIC URL: \x1b[32m${tunnelUrl}\x1b[0m`);
                console.log(`🔗 Local: http://localhost:${port}`);
                console.log(`📊 Health: ${tunnelUrl}/health\n`);

                saveServerStatus({
                    url: tunnelUrl,
                    port: port,
                    created_at: new Date().toISOString(),
                    pid: process.pid,
                    cloudflared_pid: cloudflaredProcess.pid
                });

                updateCloudUrl(tunnelUrl);
                resolve(tunnelUrl);
            }
        });

        cloudflaredProcess.on('error', (err) => {
            console.error('❌ Cloudflared error:', err);
            reject(err);
        });

        cloudflaredProcess.on('close', (code) => {
            console.warn(`⚠️ Cloudflared exited with code ${code}`);
            tunnelUrl = null;

            if (!isRestarting && code !== 0) {
                console.log('🔄 Cloudflared closed, restarting...');
                setTimeout(() => restartServer(), RESTART_DELAY);
            }
        });

        setTimeout(() => {
            if (!urlFound) {
                console.error('❌ Tunnel creation timeout (30s)');
                if (cloudflaredProcess) cloudflaredProcess.kill();
                reject(new Error('Tunnel creation timeout'));
            }
        }, 30000);
    });
}

async function checkTunnelHealth() {
    if (!tunnelUrl) return false;

    try {
        const response = await axios.get(`${tunnelUrl}/health`, {
            timeout: 10000,
            validateStatus: () => true
        });

        return response.status === 200;
    } catch (error) {
        console.warn(`⚠️ Health check failed: ${error.message}`);
        return false;
    }
}

async function restartServer() {
    if (isRestarting) return;

    isRestarting = true;
    retryCount++;

    console.log(`\n🔄 Restarting server (Attempt ${retryCount}/${MAX_RETRIES})...`);

    try {
        if (cloudflaredProcess) {
            cloudflaredProcess.kill('SIGTERM');
            cloudflaredProcess = null;
        }

        if (httpServer) {
            httpServer.close();
            httpServer = null;
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
        await initializeServer();

        console.log('✅ Server restarted successfully');
        retryCount = 0;

    } catch (error) {
        console.error('❌ Failed to restart server:', error.message);

        if (retryCount >= MAX_RETRIES) {
            console.error(`💀 Max retries reached (${MAX_RETRIES}). Waiting 30 seconds...`);
            await new Promise(resolve => setTimeout(resolve, 30000));
            retryCount = 0;
        }

        setTimeout(() => {
            isRestarting = false;
            restartServer();
        }, RESTART_DELAY * 2);
        return;
    }

    isRestarting = false;
}

function saveServerStatus(status) {
    try {
        fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
        console.log(`📄 Status saved to: ${STATUS_FILE}`);
    } catch (error) {
        console.error('Failed to save status:', error);
    }
}

async function checkInternetConnection() {
    try {
        await axios.get('https://1.1.1.1', { timeout: 5000 });
        return true;
    } catch (error) {
        console.warn('🌐 Internet connection lost');
        return false;
    }
}

function setupGracefulShutdown() {
    const shutdown = async (signal) => {
        console.log(`\n${signal} received, shutting down gracefully...`);

        isRestarting = true;

        if (cloudflaredProcess) {
            cloudflaredProcess.kill('SIGTERM');
        }

        activeBots.forEach((bot, key) => {
            bot.kill();
            console.log(`Stopped bot: ${key}`);
        });

        if (httpServer) {
            httpServer.close();
        }

        console.log('✅ All processes stopped');
        process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    process.on('uncaughtException', (error) => {
        console.error('❌ Uncaught Exception:', error.message);
        setTimeout(() => restartServer(), 1000);
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    });
}

function startHealthMonitoring() {
    setInterval(async () => {
        try {
            const hasInternet = await checkInternetConnection();
            if (!hasInternet) {
                console.warn('🌐 No internet, waiting for connection...');
                return;
            }

            const isHealthy = await checkTunnelHealth();
            if (!isHealthy && tunnelUrl) {
                console.warn('⚠️ Tunnel unhealthy, restarting...');
                await restartServer();
            }

        } catch (error) {
            console.error('Health monitor error:', error.message);
        }
    }, HEALTH_CHECK_INTERVAL);
}

// ====================================================
// HTTP SERVER CREATION
// ====================================================
function createHttpServer() {
    const server = http.createServer(async (req, res) => {
        // Parse URL
        let url;
        try {
            url = new URL(req.url, `http://localhost:${serverPort}`);
        } catch {
            res.writeHead(400);
            res.end('Invalid URL');
            return;
        }

        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        const send = (d, s = 200) => {
            res.writeHead(s, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(d));
        };

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // HEALTH CHECK
        if (url.pathname === '/health') {
            const status = {
                status: 'healthy',
                uptime: process.uptime(),
                tunnel_url: tunnelUrl,
                server_port: serverPort,
                active_bots: activeBots.size,
                active_sessions: activeSessions.size,
                timestamp: new Date().toISOString()
            };
            return send(status);
        }

        // HOME PAGE
        if (url.pathname === '/' || url.pathname === '/index.html') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(getHTML());
            return;
        }

        // API ROUTES
        if (url.pathname === '/api/login' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', () => {
                try {
                    const { user, pass } = JSON.parse(body);
                    
                    // Admin login
                    if (user === 'admin' && pass === '098765') {
                        const token = generateToken();
                        activeSessions.set(token, { role: 'admin', user: user });
                        res.writeHead(200, {
                            'Set-Cookie': `auth_token=${token}; HttpOnly; Path=/; Max-Age=86400`,
                            'Content-Type': 'application/json'
                        });
                        res.end(JSON.stringify({ success: true, user: user }));
                        return;
                    }

                    // User login
                    const foundUser = usersDB.find(u => u.user === user && u.pass === pass);
                    if (foundUser) {
                        const token = generateToken();
                        activeSessions.set(token, { role: 'user', user: user });
                        res.writeHead(200, {
                            'Set-Cookie': `auth_token=${token}; HttpOnly; Path=/; Max-Age=86400`,
                            'Content-Type': 'application/json'
                        });
                        res.end(JSON.stringify({ success: true, user: user }));
                    } else {
                        send({ success: false, message: 'Username atau password salah' }, 401);
                    }
                } catch {
                    send({ success: false, message: 'Invalid request' }, 400);
                }
            });
            return;
        }

        if (url.pathname === '/api/register' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', () => {
                try {
                    const { user, pass } = JSON.parse(body);
                    
                    if (!user || !pass) {
                        return send({ success: false, message: 'Username dan password harus diisi' }, 400);
                    }
                    
                    if (user.length < 3) {
                        return send({ success: false, message: 'Username minimal 3 karakter' });
                    }
                    
                    if (pass.length < 4) {
                        return send({ success: false, message: 'Password minimal 4 karakter' });
                    }
                    
                    const userExists = usersDB.some(u => u.user === user);
                    if (userExists) {
                        return send({ success: false, message: 'Username sudah terdaftar' });
                    }
                    
                    const newUser = {
                        user: user,
                        pass: pass,
                        createdAt: new Date().toISOString(),
                        role: 'user'
                    };
                    
                    usersDB.push(newUser);
                    saveUsers();
                    
                    const token = generateToken();
                    activeSessions.set(token, { role: 'user', user: user });
                    
                    res.writeHead(200, {
                        'Set-Cookie': `auth_token=${token}; HttpOnly; Path=/; Max-Age=86400`,
                        'Content-Type': 'application/json'
                    });
                    res.end(JSON.stringify({ 
                        success: true, 
                        message: 'Registrasi berhasil!',
                        user: user 
                    }));
                    
                } catch (error) {
                    console.error('Register error:', error);
                    send({ success: false, message: 'Gagal mendaftar' }, 500);
                }
            });
            return;
        }

        if (url.pathname === '/api/data') {
            const s = getSessionInfo(req);
            if (!s) return send({}, 401);
            send({
                user: s.user,
                role: s.role,
                sessions: getSessions(),
                meta: botsMeta,
                activeBots: Array.from(activeBots.keys())
            });
            return;
        }

        if (url.pathname === '/api/logout' && req.method === 'POST') {
            const cookies = req.headers.cookie || '';
            const tokenMatch = cookies.match(/auth_token=([^;]+)/);
            if (tokenMatch) {
                activeSessions.delete(tokenMatch[1]);
            }
            res.writeHead(200, {
                'Set-Cookie': 'auth_token=; HttpOnly; Path=/; Max-Age=0',
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({ success: true }));
            return;
        }

        // Default 404
        res.writeHead(404);
        res.end(JSON.stringify({ message: 'Not Found' }));
    });

    return server;
}

// ====================================================
// INITIALIZE SERVER
// ====================================================
async function initializeServer() {
    try {
        console.clear();
        showBanner();

        // Install dependencies
        await installDependencies();

        // Create HTTP server
        httpServer = createHttpServer();

        // Start HTTP server
        serverPort = await new Promise((resolve, reject) => {
            httpServer.listen(PORT, '127.0.0.1', () => {
                const port = httpServer.address().port;
                console.log(`🌐 HTTP Server running on port ${port}`);
                resolve(port);
            });
            httpServer.on('error', reject);
        });

        // Start Cloudflare Tunnel (if not in Cloudflare Pages environment)
        if (!process.env.CF_PAGES) {
            await startCloudflaredTunnel(serverPort);
            startHealthMonitoring();
        } else {
            console.log('🚀 Running on Cloudflare Pages');
            console.log(`🔗 Server URL: http://localhost:${serverPort}`);
        }

        // Setup graceful shutdown
        setupGracefulShutdown();

        console.log('\n' + '='.repeat(60));
        console.log('✅ SERVER READY');
        console.log('='.repeat(60));
        if (tunnelUrl) {
            console.log(`📡 Public URL: ${tunnelUrl}`);
        }
        console.log(`🔧 Internal Port: ${serverPort}`);
        console.log('='.repeat(60) + '\n');

    } catch (error) {
        console.error('❌ Failed to initialize server:', error.message);
        throw error;
    }
}

// ====================================================
// BANNER
// ====================================================
function showBanner() {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   ██████╗ ██████╗  ██████╗ ██╗   ██╗███████╗██╗██████╗      ║
║   ██╔══██╗██╔══██╗██╔═══██╗██║   ██║██╔════╝██║██╔══██╗     ║
║   ██████╔╝██████╔╝██║   ██║██║   ██║█████╗  ██║██║  ██║     ║
║   ██╔═══╝ ██╔══██╗██║   ██║╚██╗ ██╔╝██╔══╝  ██║██║  ██║     ║
║   ██║     ██║  ██║╚██████╔╝ ╚████╔╝ ███████╗██║██████╔╝     ║
║   ╚═╝     ╚═╝  ╚═╝ ╚═════╝   ╚═══╝  ╚══════╝╚═╝╚═════╝      ║
║                                                              ║
║           AUTO-INSTALL & CLOUDFLARE PAGES READY             ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
    `);
}

// ====================================================
// START APPLICATION
// ====================================================
(async () => {
    try {
        console.log('🚀 Starting WhatsApp Bot Manager...');
        
        // Check if we're in Cloudflare Pages
        if (process.env.CF_PAGES) {
            console.log('🌍 Cloudflare Pages Environment Detected');
            console.log('📦 Using built-in HTTP server only');
        }

        await initializeServer();

        // Keep process alive
        process.stdin.resume();

    } catch (error) {
        console.error('💀 Fatal error:', error);
        
        // Try to restart once
        console.log('🔄 Attempting restart in 5 seconds...');
        setTimeout(async () => {
            try {
                await initializeServer();
            } catch (restartError) {
                console.error('💀 Restart failed:', restartError);
                process.exit(1);
            }
        }, 5000);
    }
})();

// ====================================================
// DOWNLOADER FUNCTIONS (KODE ASLI ANDA)
// ====================================================
async function fetchMediaData(url) {
    console.log(`[DOWNLOAD] Memproses: ${url}`);
    
    const formatResult = (title, thumb, url, type = 'mp4') => ({
        title: title || 'Media Result',
        thumbnail: thumb || 'https://telegra.ph/file/558661849a0d310e5349e.png',
        url: url,
        type: type
    });

    try {
        let res = null;
        if (url.match(/(facebook|fb\.|instagram)/i)) {
            try {
                const { data } = await axios.get(`https://api.ryzendesu.vip/api/downloader/fbdl?url=${url}`);
                if(data?.data?.[0]?.url) return formatResult('Facebook/IG DL', data.data[0].thumbnail, data.data[0].url);
            } catch {}
            try {
                const { data } = await axios.get(`https://api.agatz.xyz/api/instagram?url=${url}`);
                if(data?.data?.[0]?.url) return formatResult('Instagram DL', data.data[0].thumbnail, data.data[0].url);
            } catch {}
        }
        
        if (url.includes('tiktok')) { if(btch.tiktok) res = await btch.tiktok(url); else if(btch.ttdl) res = await btch.ttdl(url); }
        else if (url.includes('youtu')) { if(btch.youtube) res = await btch.youtube(url); else if(btch.ytdl) res = await btch.ytdl(url); }

        if (!res) return null;

        let finalUrl = '', finalThumb = '', finalTitle = 'Downloaded Media';
        if (typeof res === 'string') finalUrl = res;
        else if (Array.isArray(res)) finalUrl = res[0]?.url || res[0];
        else if (typeof res === 'object') {
            finalUrl = res.url || res.video || res.link || res.nowm;
            finalThumb = res.thumbnail || res.cover;
            finalTitle = res.title || res.caption || 'Media';
        }

        if (!finalUrl) return null;
        return formatResult(finalTitle, finalThumb, finalUrl);
    } catch (e) { return null; }
}

function getHTML() {
    return `
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Bot Manager OneUI</title>
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        :root {
            /* === ONE UI LIGHT === */
            --bg-body: #f7f7f7;
            --bg-card: #ffffff;
            --bg-nav: #f2f2f2;
            --text-pri: #000000;
            --text-sec: #787878;
            --accent: #28a745;
            --accent-soft: rgba(40, 167, 69, 0.15);
            --danger: #ff3b30;
            --success: #34c759;
            --warning: #ff9500;
            --info: #007aff;
            --border: #e0e0e0;
            --radius-xl: 26px;
            --radius-md: 18px;
            --radius-sm: 12px;
            --shadow: 8px 8px 24px rgba(0,0,0,0.06), -8px -8px 24px rgba(255,255,255,1);
            --shadow-float: 0 10px 30px rgba(0,0,0,0.1);
            --glass: rgba(255, 255, 255, 0.7);
        }

        [data-theme="dark"] {
            /* === ONE UI AMOLED DARK === */
            --bg-body: #000000;
            --bg-card: #121212;
            --bg-nav: #0a0a0a;
            --text-pri: #ffffff;
            --text-sec: #a0a0a0;
            --accent: #4ade80;
            --accent-soft: rgba(74, 222, 128, 0.2);
            --danger: #ff453a;
            --success: #32d74b;
            --warning: #ff9f0a;
            --info: #0a84ff;
            --border: #2c2c2c;
            --shadow: 0 4px 15px rgba(0,0,0,0.5);
            --shadow-float: 0 10px 40px rgba(0,0,0,0.7);
            --glass: rgba(18, 18, 18, 0.7);
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Roboto', sans-serif;
            -webkit-tap-highlight-color: transparent;
            outline: none;
        }

        body {
            background-color: var(--bg-body);
            color: var(--text-pri);
            min-height: 100vh;
            overflow-x: hidden;
            transition: background 0.4s ease, color 0.4s ease;
        }

        /* Loading Overlay */
        .loader-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: var(--bg-body);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            transition: opacity 0.3s;
        }

        .loader-overlay.hidden {
            opacity: 0;
            pointer-events: none;
        }

        .spinner-box {
            width: 50px;
            height: 50px;
            border: 3px solid var(--border);
            border-top: 3px solid var(--accent);
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-bottom: 20px;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        /* Layout */
        .app-container {
            display: flex;
            min-height: 100vh;
        }

        /* Sidebar */
        .sidebar {
            width: 280px;
            background: var(--bg-nav);
            padding: 25px 20px;
            display: flex;
            flex-direction: column;
            border-radius: 0 var(--radius-xl) var(--radius-xl) 0;
            box-shadow: 5px 0 20px rgba(0,0,0,0.02);
            z-index: 100;
            transition: transform 0.3s cubic-bezier(0.165, 0.84, 0.44, 1);
        }

        .main-content {
            flex: 1;
            padding: 30px;
            overflow-y: auto;
            position: relative;
        }

        /* Profile Section */
        .profile {
            display: flex;
            align-items: center;
            gap: 15px;
            margin-bottom: 40px;
            background: var(--bg-card);
            padding: 20px;
            border-radius: var(--radius-md);
            box-shadow: var(--shadow);
        }

        .avatar {
            width: 50px;
            height: 50px;
            background: linear-gradient(135deg, var(--accent), #0056b3);
            color: #fff;
            font-size: 22px;
            font-weight: 700;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }

        .profile-info h3 {
            font-size: 18px;
            margin-bottom: 5px;
            color: var(--text-pri);
        }

        .profile-info p {
            font-size: 12px;
            color: var(--text-sec);
            opacity: 0.8;
        }

        /* Navigation */
        .nav-menu {
            flex: 1;
        }

        .nav-btn {
            padding: 14px 18px;
            margin-bottom: 10px;
            border-radius: var(--radius-md);
            cursor: pointer;
            color: var(--text-sec);
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 15px;
            transition: all 0.3s ease;
            border: none;
            background: transparent;
            width: 100%;
            text-align: left;
        }

        .nav-btn:hover {
            background: var(--bg-card);
            color: var(--text-pri);
            transform: translateX(5px);
        }

        .nav-btn.active {
            background: var(--accent);
            color: #fff;
            box-shadow: 0 4px 15px var(--accent-soft);
        }

        .nav-btn i {
            width: 20px;
            text-align: center;
            font-size: 18px;
        }

        /* Theme Toggle */
        .theme-toggle {
            position: fixed;
            top: 25px;
            right: 30px;
            width: 44px;
            height: 44px;
            background: var(--bg-card);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: var(--shadow);
            z-index: 200;
            transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
            border: none;
            color: var(--text-pri);
        }

        .theme-toggle:active {
            transform: scale(0.9);
        }

        /* Cards */
        .card {
            background: var(--bg-card);
            border-radius: var(--radius-xl);
            padding: 25px;
            margin-bottom: 25px;
            box-shadow: var(--shadow);
            border: 1px solid var(--border);
            transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s;
        }

        .card:hover {
            transform: translateY(-5px) scale(1.01);
            box-shadow: var(--shadow-float);
        }

        /* Stats Grid */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .stat-item {
            text-align: center;
            padding: 20px;
            background: var(--bg-nav);
            border-radius: var(--radius-md);
        }

        .stat-val {
            font-size: 36px;
            font-weight: 700;
            color: var(--accent);
            display: block;
            line-height: 1;
            margin-bottom: 8px;
        }

        .stat-lbl {
            font-size: 14px;
            color: var(--text-sec);
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        /* Bot List */
        .bot-list {
            margin-top: 20px;
        }

        .bot-item {
            background: var(--bg-card);
            padding: 20px;
            border-radius: var(--radius-md);
            margin-bottom: 15px;
            border: 1px solid var(--border);
            transition: all 0.3s ease;
        }

        .bot-item:hover {
            border-color: var(--accent);
        }

        .bot-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }

        .bot-phone {
            font-size: 18px;
            font-weight: 600;
            color: var(--text-pri);
        }

        .bot-owner {
            font-size: 13px;
            color: var(--text-sec);
            margin-top: 5px;
        }

        .bot-status {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .status-badge {
            padding: 6px 14px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
        }

        .status-online {
            background: rgba(52, 199, 89, 0.15);
            color: var(--success);
        }

        .status-offline {
            background: rgba(255, 59, 48, 0.15);
            color: var(--danger);
        }

        .status-pending {
            background: rgba(255, 149, 0, 0.15);
            color: var(--warning);
        }

        .status-trial {
            background: rgba(0, 122, 255, 0.15);
            color: var(--info);
        }

        .bot-actions {
            display: flex;
            gap: 10px;
            margin-top: 15px;
            flex-wrap: wrap;
        }

        /* Buttons */
        .btn {
            padding: 10px 20px;
            border-radius: 50px;
            border: none;
            font-weight: 600;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.2s ease;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }

        .btn-primary {
            background: var(--accent);
            color: #fff;
            box-shadow: 0 4px 12px var(--accent-soft);
        }

        .btn-primary:hover {
            filter: brightness(1.1);
            transform: translateY(-2px);
        }

        .btn-secondary {
            background: transparent;
            border: 1px solid var(--border);
            color: var(--text-sec);
        }

        .btn-secondary:hover {
            background: var(--bg-nav);
            color: var(--text-pri);
        }

        .btn-danger {
            background: rgba(255, 59, 48, 0.1);
            color: var(--danger);
            border: 1px solid rgba(255, 59, 48, 0.2);
        }

        .btn-danger:hover {
            background: rgba(255, 59, 48, 0.2);
        }

        .btn-small {
            padding: 6px 12px;
            font-size: 12px;
        }

        /* Inputs */
        .input-group {
            margin-bottom: 20px;
        }

        .input-label {
            display: block;
            margin-bottom: 8px;
            font-weight: 500;
            color: var(--text-pri);
        }

        .form-input {
            width: 100%;
            padding: 14px 18px;
            border-radius: var(--radius-md);
            border: 1px solid var(--border);
            background: var(--bg-card);
            color: var(--text-pri);
            font-size: 15px;
            transition: all 0.3s ease;
        }

        .form-input:focus {
            border-color: var(--accent);
            box-shadow: 0 0 0 3px var(--accent-soft);
            outline: none;
        }

        /* Modals */
        .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(8px);
            z-index: 1000;
            display: none;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transition: opacity 0.3s ease;
        }

        .modal-overlay.active {
            display: flex;
            opacity: 1;
        }

        .modal-content {
            background: var(--bg-card);
            border-radius: var(--radius-xl);
            padding: 30px;
            box-shadow: var(--shadow-float);
            max-width: 500px;
            width: 90%;
            max-height: 90vh;
            overflow-y: auto;
            transform: scale(0.9);
            transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        .modal-overlay.active .modal-content {
            transform: scale(1);
        }

        .modal-header {
            margin-bottom: 20px;
        }

        .modal-title {
            font-size: 24px;
            font-weight: 700;
            color: var(--text-pri);
            margin-bottom: 10px;
        }

        .modal-close {
            position: absolute;
            top: 20px;
            right: 20px;
            background: none;
            border: none;
            font-size: 24px;
            color: var(--text-sec);
            cursor: pointer;
            transition: color 0.3s;
        }

        .modal-close:hover {
            color: var(--danger);
        }

        /* Tabs */
        .tab-container {
            margin-top: 20px;
        }

        .tab-buttons {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
            border-bottom: 1px solid var(--border);
            padding-bottom: 10px;
        }

        .tab-btn {
            padding: 10px 20px;
            background: transparent;
            border: none;
            color: var(--text-sec);
            font-weight: 500;
            cursor: pointer;
            border-radius: var(--radius-md);
            transition: all 0.3s ease;
        }

        .tab-btn.active {
            background: var(--accent);
            color: #fff;
        }

        .tab-content {
            display: none;
        }

        .tab-content.active {
            display: block;
            animation: fadeIn 0.5s ease;
        }

        @keyframes fadeIn {
            from {
                opacity: 0;
                transform: translateY(10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        /* Media Grid */
        .media-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 20px;
            margin-top: 20px;
        }

        .media-item {
            background: var(--bg-nav);
            border-radius: var(--radius-md);
            overflow: hidden;
            transition: transform 0.3s ease;
        }

        .media-item:hover {
            transform: translateY(-5px);
        }

        .media-preview {
            width: 100%;
            height: 150px;
            object-fit: cover;
        }

        .media-info {
            padding: 15px;
        }

        .media-title {
            font-size: 14px;
            font-weight: 500;
            color: var(--text-pri);
            margin-bottom: 5px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .media-date {
            font-size: 12px;
            color: var(--text-sec);
        }

        /* Download Result */
        .download-result {
            margin-top: 20px;
            padding: 20px;
            background: var(--bg-nav);
            border-radius: var(--radius-md);
            display: none;
        }

        .download-result.show {
            display: block;
            animation: fadeIn 0.5s ease;
        }

        .download-preview {
            width: 100%;
            max-width: 300px;
            border-radius: var(--radius-md);
            margin-bottom: 15px;
        }

        /* Check Profile */
        .profile-card {
            background: var(--bg-card);
            border-radius: 16px;
            padding: 30px;
            display: flex;
            flex-direction: column;
            align-items: center;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            border: 1px solid var(--border);
            animation: fadeIn 0.5s;
        }

        .profile-avatar {
            width: 120px;
            height: 120px;
            border-radius: 50%;
            object-fit: cover;
            border: 4px solid var(--accent);
            margin-bottom: 15px;
        }

        .profile-name {
            font-size: 22px;
            font-weight: bold;
            color: var(--text-pri);
            margin-bottom: 5px;
            text-align: center;
        }

        .profile-number {
            font-size: 14px;
            color: var(--text-sec);
            margin-bottom: 15px;
            background: var(--bg-nav);
            padding: 4px 12px;
            border-radius: 20px;
        }

        .profile-details {
            width: 100%;
            margin-top: 20px;
        }

        .detail-row {
            display: flex;
            justify-content: space-between;
            padding: 12px;
            background: var(--bg-nav);
            border-radius: 8px;
            margin-bottom: 10px;
            font-size: 14px;
        }

        .detail-label {
            color: var(--text-sec);
        }

        .detail-value {
            font-weight: 600;
            color: var(--text-pri);
            text-align: right;
            max-width: 60%;
            word-break: break-word;
        }

        /* Responsive */
        @media (max-width: 768px) {
            .app-container {
                flex-direction: column;
            }

            .sidebar {
                width: 100%;
                border-radius: 0;
                position: fixed;
                top: 0;
                left: 0;
                height: 70px;
                padding: 10px;
                flex-direction: row;
                align-items: center;
                justify-content: space-between;
                z-index: 1000;
            }

            .profile {
                display: none;
            }

            .nav-menu {
                display: flex;
                flex: 1;
                justify-content: space-around;
                margin: 0;
            }

            .nav-btn {
                flex-direction: column;
                padding: 10px;
                margin: 0;
                font-size: 10px;
                gap: 5px;
            }

            .nav-btn span {
                display: none;
            }

            .main-content {
                margin-top: 70px;
                padding: 20px;
            }

            .theme-toggle {
                position: fixed;
                bottom: 20px;
                right: 20px;
                top: auto;
            }

            .stats-grid {
                grid-template-columns: repeat(2, 1fr);
            }

            .media-grid {
                grid-template-columns: repeat(2, 1fr);
            }
        }

        @media (max-width: 480px) {
            .stats-grid {
                grid-template-columns: 1fr;
            }

            .media-grid {
                grid-template-columns: 1fr;
            }

            .bot-actions {
                flex-direction: column;
            }

            .btn {
                width: 100%;
                justify-content: center;
            }
        }

        /* Animations */
        @keyframes pulse {
            0% {
                transform: scale(1);
                opacity: 1;
            }
            50% {
                transform: scale(1.05);
                opacity: 0.8;
            }
            100% {
                transform: scale(1);
                opacity: 1;
            }
        }

        .pulse {
            animation: pulse 2s infinite;
        }

        /* Scrollbar */
        ::-webkit-scrollbar {
            width: 8px;
        }

        ::-webkit-scrollbar-track {
            background: var(--bg-nav);
            border-radius: 4px;
        }

        ::-webkit-scrollbar-thumb {
            background: var(--accent);
            border-radius: 4px;
        }

        ::-webkit-scrollbar-thumb:hover {
            background: var(--accent);
            opacity: 0.8;
        }
    </style>
</head>
<body data-theme="dark">
    <!-- Loading Screen -->
    <div class="loader-overlay" id="loadingScreen">
        <div class="spinner-box"></div>
        <div style="margin-top: 20px; font-weight: 600; color: var(--accent);">
            Starting WhatsApp Bot Manager...
        </div>
    </div>

    <!-- Theme Toggle -->
    <button class="theme-toggle" id="themeToggle" title="Toggle Theme">
        <i class="fas fa-moon"></i>
    </button>

    <div class="app-container">
        <!-- Sidebar -->
        <div class="sidebar" id="sidebar">
            <div class="profile">
                <div class="avatar" id="userAvatar">U</div>
                <div class="profile-info">
                    <h3 id="userName">Guest</h3>
                    <p id="userRole">User Panel</p>
                </div>
            </div>

            <div class="nav-menu">
                <button class="nav-btn active" data-view="dashboard">
                    <i class="fas fa-home"></i>
                    <span>Dashboard</span>
                </button>
                <button class="nav-btn" data-view="add-bot">
                    <i class="fas fa-robot"></i>
                    <span>Add Bot</span>
                </button>
                <button class="nav-btn" data-view="check-number">
                    <i class="fas fa-search"></i>
                    <span>Check Number</span>
                </button>
                <button class="nav-btn" data-view="downloader">
                    <i class="fas fa-download"></i>
                    <span>Downloader</span>
                </button>
                <button class="nav-btn" data-view="media">
                    <i class="fas fa-photo-video"></i>
                    <span>Media</span>
                </button>
                <button class="nav-btn" onclick="window.open('${WA_ADMIN}', '_blank')">
                    <i class="fas fa-headset"></i>
                    <span>Support</span>
                </button>
            </div>

            <button class="nav-btn btn-danger" id="logoutBtn">
                <i class="fas fa-sign-out-alt"></i>
                <span>Logout</span>
            </button>
        </div>

        <!-- Main Content -->
        <div class="main-content">
            <!-- Dashboard View -->
            <div class="view-content active" id="dashboardView">
                <div class="card">
                    <h2>Dashboard Overview</h2>
                    <p class="text-muted">Manage your WhatsApp bots efficiently</p>
                    
                    <div class="stats-grid">
                        <div class="stat-item">
                            <span class="stat-val" id="activeBotsCount">0</span>
                            <span class="stat-lbl">Active Bots</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-val" id="totalSessionsCount">0</span>
                            <span class="stat-lbl">Total Sessions</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-val" id="onlineBotsCount">0</span>
                            <span class="stat-lbl">Online Now</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-val" id="pendingBotsCount">0</span>
                            <span class="stat-lbl">Pending</span>
                        </div>
                    </div>
                </div>

                <div class="card">
                    <div class="bot-list-header">
                        <h3>Your WhatsApp Bots</h3>
                        <button class="btn btn-primary" id="refreshBotsBtn">
                            <i class="fas fa-sync-alt"></i> Refresh
                        </button>
                    </div>
                    
                    <div class="bot-list" id="botListContainer">
                        <!-- Bot items will be loaded here -->
                        <div class="empty-state">
                            <i class="fas fa-robot" style="font-size: 48px; color: var(--text-sec); margin-bottom: 20px;"></i>
                            <p>No WhatsApp bots yet. Add your first bot to get started!</p>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Add Bot View -->
            <div class="view-content" id="addBotView">
                <div class="card">
                    <h2>Add New WhatsApp Bot</h2>
                    <p class="text-muted">Connect a new WhatsApp account as a bot</p>
                    
                    <div class="input-group">
                        <label class="input-label">WhatsApp Phone Number</label>
                        <input type="tel" class="form-input" id="botPhoneInput" 
                               placeholder="Example: 628123456789" 
                               pattern="[0-9]{10,15}">
                        <small class="text-muted">Enter phone number with country code (without +)</small>
                    </div>
                    
                    <button class="btn btn-primary" id="addBotBtn" style="width: 100%;">
                        <i class="fas fa-plus"></i> Add Bot
                    </button>
                    
                    <div class="info-card" style="margin-top: 20px; padding: 15px; background: var(--bg-nav); border-radius: var(--radius-md);">
                        <h4><i class="fas fa-info-circle"></i> How to Connect</h4>
                        <ol style="margin-top: 10px; padding-left: 20px;">
                            <li>Enter your WhatsApp phone number</li>
                            <li>Click "Add Bot" button</li>
                            <li>Scan the QR code with WhatsApp</li>
                            <li>Wait for connection confirmation</li>
                        </ol>
                    </div>
                </div>
            </div>

            <!-- Check Number View -->
            <div class="view-content" id="checkNumberView">
                <div class="card">
                    <h2>Check WhatsApp Number</h2>
                    <p class="text-muted">Lookup information about any WhatsApp number</p>
                    
                    <div class="input-group">
                        <label class="input-label">Target Phone Number</label>
                        <input type="tel" class="form-input" id="checkNumberInput" 
                               placeholder="Example: 628123456789">
                    </div>
                    
                    <button class="btn btn-primary" id="checkNumberBtn" style="width: 100%;">
                        <i class="fas fa-search"></i> Check Number
                    </button>
                </div>
                
                <div class="card" id="checkResultContainer" style="display: none;">
                    <h3>Check Result</h3>
                    <div id="checkResultContent">
                        <!-- Result will be displayed here -->
                    </div>
                </div>
            </div>

            <!-- Downloader View -->
            <div class="view-content" id="downloaderView">
                <div class="card">
                    <h2>Media Downloader</h2>
                    <p class="text-muted">Download media from various platforms</p>
                    
                    <div class="tab-container">
                        <div class="tab-buttons">
                            <button class="tab-btn active" data-tab="video">Video</button>
                            <button class="tab-btn" data-tab="audio">Audio</button>
                        </div>
                        
                        <div class="tab-content active" id="videoTab">
                            <div class="input-group">
                                <label class="input-label">Video URL</label>
                                <input type="url" class="form-input" id="videoUrlInput" 
                                       placeholder="Paste TikTok, Instagram, YouTube, Facebook URL">
                            </div>
                            
                            <button class="btn btn-primary" id="downloadVideoBtn" style="width: 100%;">
                                <i class="fas fa-download"></i> Download Video
                            </button>
                        </div>
                        
                        <div class="tab-content" id="audioTab">
                            <div class="input-group">
                                <label class="input-label">Audio URL</label>
                                <input type="url" class="form-input" id="audioUrlInput" 
                                       placeholder="Paste YouTube or other audio source URL">
                            </div>
                            
                            <button class="btn btn-primary" id="downloadAudioBtn" style="width: 100%;">
                                <i class="fas fa-music"></i> Download Audio
                            </button>
                        </div>
                    </div>
                    
                    <div class="download-result" id="downloadResult">
                        <!-- Download result will be displayed here -->
                    </div>
                </div>
            </div>

            <!-- Media View -->
            <div class="view-content" id="mediaView">
                <div class="card">
                    <h2>Saved Media</h2>
                    <p class="text-muted">View and manage saved media files</p>
                    
                    <div class="tab-container">
                        <div class="tab-buttons">
                            <button class="tab-btn active" data-tab="rvo">View Once</button>
                            <button class="tab-btn" data-tab="status">Status</button>
                        </div>
                        
                        <div class="tab-content active" id="rvoTab">
                            <div class="media-grid" id="rvoMediaGrid">
                                <!-- RVO media items will be loaded here -->
                                <div class="empty-state">
                                    <i class="fas fa-eye-slash" style="font-size: 48px; color: var(--text-sec);"></i>
                                    <p>No view once media saved yet</p>
                                </div>
                            </div>
                        </div>
                        
                        <div class="tab-content" id="statusTab">
                            <div class="media-grid" id="statusMediaGrid">
                                <!-- Status media items will be loaded here -->
                                <div class="empty-state">
                                    <i class="fas fa-history" style="font-size: 48px; color: var(--text-sec);"></i>
                                    <p>No status media saved yet</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Add Bot Modal -->
    <div class="modal-overlay" id="addBotModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeModal('addBotModal')">&times;</button>
            <div class="modal-header">
                <h2 class="modal-title">Connect WhatsApp</h2>
                <p class="text-muted">Scan QR code with WhatsApp to connect</p>
            </div>
            
            <div id="qrStep">
                <div class="qr-container" style="text-align: center; margin: 20px 0;">
                    <div id="qrCodeDisplay" style="padding: 20px; background: white; display: inline-block; border-radius: 10px;">
                        <!-- QR code will be displayed here -->
                        <p>Loading QR code...</p>
                    </div>
                </div>
                
                <div class="info-box" style="background: var(--bg-nav); padding: 15px; border-radius: var(--radius-md); margin: 20px 0;">
                    <h4><i class="fas fa-mobile-alt"></i> How to Scan:</h4>
                    <ol style="margin-top: 10px; padding-left: 20px;">
                        <li>Open WhatsApp on your phone</li>
                        <li>Go to Settings → Linked Devices</li>
                        <li>Tap on "Link a Device"</li>
                        <li>Point your camera at the QR code</li>
                    </ol>
                </div>
                
                <div class="modal-actions" style="display: flex; gap: 10px;">
                    <button class="btn btn-secondary" onclick="closeModal('addBotModal')" style="flex: 1;">
                        Cancel
                    </button>
                    <button class="btn btn-primary" onclick="checkBotConnection()" style="flex: 1;">
                        <i class="fas fa-check"></i> Connected
                    </button>
                </div>
            </div>
            
            <div id="connectedStep" style="display: none; text-align: center;">
                <div style="font-size: 72px; color: var(--success); margin: 20px 0;">
                    <i class="fas fa-check-circle"></i>
                </div>
                <h3>Successfully Connected!</h3>
                <p class="text-muted">Your WhatsApp is now connected as a bot</p>
                <button class="btn btn-primary" onclick="closeModal('addBotModal'); loadDashboard();" style="margin-top: 20px;">
                    Continue to Dashboard
                </button>
            </div>
        </div>
    </div>

    <!-- Bot Actions Modal -->
    <div class="modal-overlay" id="botActionsModal">
        <div class="modal-content">
            <button class="modal-close" onclick="closeModal('botActionsModal')">&times;</button>
            <div class="modal-header">
                <h2 class="modal-title" id="botModalTitle">Bot Actions</h2>
                <p class="text-muted" id="botModalSubtitle"></p>
            </div>
            
            <div class="bot-actions-modal">
                <button class="btn btn-primary" onclick="botAction('start')" id="startBotBtn" style="width: 100%; margin-bottom: 10px;">
                    <i class="fas fa-play"></i> Start Bot
                </button>
                
                <button class="btn btn-secondary" onclick="botAction('restart')" id="restartBotBtn" style="width: 100%; margin-bottom: 10px;">
                    <i class="fas fa-redo"></i> Restart Bot
                </button>
                
                <button class="btn btn-danger" onclick="botAction('stop')" id="stopBotBtn" style="width: 100%; margin-bottom: 10px;">
                    <i class="fas fa-stop"></i> Stop Bot
                </button>
                
                <button class="btn btn-danger" onclick="botAction('delete')" id="deleteBotBtn" style="width: 100%;">
                    <i class="fas fa-trash"></i> Delete Bot
                </button>
            </div>
        </div>
    </div>

    <!-- Auth Modal -->
    <div class="modal-overlay active" id="authModal">
        <div class="modal-content">
            <div class="modal-header" style="text-align: center;">
                <h2 class="modal-title">WhatsApp Bot Manager</h2>
                <p class="text-muted">Login to manage your bots</p>
            </div>
            
            <div id="loginTab">
                <div class="input-group">
                    <label class="input-label">Username</label>
                    <input type="text" class="form-input" id="loginUsername" placeholder="Enter username">
                </div>
                
                <div class="input-group">
                    <label class="input-label">Password</label>
                    <input type="password" class="form-input" id="loginPassword" placeholder="Enter password">
                </div>
                
                <button class="btn btn-primary" id="loginBtn" style="width: 100%; margin-bottom: 15px;">
                    <i class="fas fa-sign-in-alt"></i> Login
                </button>
                
                <div style="text-align: center;">
                    <p class="text-muted" style="margin-bottom: 10px;">Don't have an account?</p>
                    <button class="btn btn-secondary" onclick="showRegister()" style="width: 100%;">
                        Create New Account
                    </button>
                </div>
            </div>
            
            <div id="registerTab" style="display: none;">
                <div class="input-group">
                    <label class="input-label">Username</label>
                    <input type="text" class="form-input" id="registerUsername" placeholder="Choose username">
                    <small class="text-muted" id="usernameFeedback"></small>
                </div>
                
                <div class="input-group">
                    <label class="input-label">Password</label>
                    <input type="password" class="form-input" id="registerPassword" placeholder="Choose password">
                </div>
                
                <div class="input-group">
                    <label class="input-label">Confirm Password</label>
                    <input type="password" class="form-input" id="registerConfirmPassword" placeholder="Confirm password">
                </div>
                
                <button class="btn btn-primary" id="registerBtn" style="width: 100%; margin-bottom: 15px;">
                    <i class="fas fa-user-plus"></i> Register
                </button>
                
                <button class="btn btn-secondary" onclick="showLogin()" style="width: 100%;">
                    <i class="fas fa-arrow-left"></i> Back to Login
                </button>
            </div>
        </div>
    </div>

    <script>
        // Global variables
        let currentUser = null;
        let currentBot = null;
        let authToken = null;

        // Initialize when DOM is loaded
        document.addEventListener('DOMContentLoaded', function() {
            // Check if user is already logged in
            checkAuth();
            
            // Initialize theme
            initTheme();
            
            // Initialize event listeners
            initEventListeners();
            
            // Hide loading screen after 2 seconds
            setTimeout(() => {
                document.getElementById('loadingScreen').classList.add('hidden');
            }, 2000);
        });

        // Theme functions
        function initTheme() {
            const savedTheme = localStorage.getItem('theme') || 'dark';
            document.body.setAttribute('data-theme', savedTheme);
            updateThemeIcon(savedTheme);
        }

        function toggleTheme() {
            const currentTheme = document.body.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            
            document.body.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            updateThemeIcon(newTheme);
        }

        function updateThemeIcon(theme) {
            const icon = document.querySelector('#themeToggle i');
            if (icon) {
                icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
            }
        }

        // Navigation functions
        function showView(viewId) {
            // Hide all views
            document.querySelectorAll('.view-content').forEach(view => {
                view.classList.remove('active');
            });
            
            // Remove active class from all nav buttons
            document.querySelectorAll('.nav-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            
            // Show selected view
            const viewElement = document.getElementById(viewId + 'View');
            if (viewElement) {
                viewElement.classList.add('active');
            }
            
            // Activate corresponding nav button
            const navBtn = document.querySelector('.nav-btn[data-view="dashboard"]');
            if (navBtn) {
                navBtn.classList.add('active');
            }
        }

        // Modal functions
        function showModal(modalId) {
            const modal = document.getElementById(modalId);
            if (modal) {
                modal.classList.add('active');
            }
        }

        function closeModal(modalId) {
            const modal = document.getElementById(modalId);
            if (modal) {
                modal.classList.remove('active');
            }
        }

        // Tab functions
        function showTab(tabId) {
            const container = document.querySelector('.tab-container.active');
            if (!container) return;
            
            // Hide all tabs
            container.querySelectorAll('.tab-content').forEach(tab => {
                tab.classList.remove('active');
            });
            
            // Deactivate all tab buttons
            container.querySelectorAll('.tab-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            
            // Show selected tab
            const tabElement = document.getElementById(tabId + 'Tab');
            if (tabElement) {
                tabElement.classList.add('active');
            }
            
            // Activate corresponding button
            const tabBtn = container.querySelector(`.tab-btn[data-tab="${tabId}"]`);
            if (tabBtn) {
                tabBtn.classList.add('active');
            }
        }

        // API functions
        async function apiRequest(endpoint, method = 'GET', data = null) {
            try {
                const options = {
                    method: method,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    credentials: 'include'
                };
                
                if (data) {
                    options.body = JSON.stringify(data);
                }
                
                const response = await fetch(`/api${endpoint}`, options);
                
                if (response.status === 401) {
                    // Unauthorized - redirect to login
                    showLoginModal();
                    return null;
                }
                
                const result = await response.json();
                return result;
            } catch (error) {
                console.error('API Request Error:', error);
                showNotification('Connection error. Please try again.', 'error');
                return null;
            }
        }

        // Auth functions
        function checkAuth() {
            // Check if auth token exists in cookie
            const cookies = document.cookie.split(';');
            const authCookie = cookies.find(c => c.trim().startsWith('auth_token='));
            
            if (authCookie) {
                authToken = authCookie.split('=')[1];
                loadDashboard();
            } else {
                showLoginModal();
            }
        }

        async function login() {
            const username = document.getElementById('loginUsername').value;
            const password = document.getElementById('loginPassword').value;
            
            if (!username || !password) {
                showNotification('Please enter username and password', 'warning');
                return;
            }
            
            const result = await apiRequest('/login', 'POST', { user: username, pass: password });
            
            if (result && result.success) {
                currentUser = result.user;
                closeModal('authModal');
                showNotification('Login successful!', 'success');
                loadDashboard();
            } else {
                showNotification(result?.message || 'Login failed', 'error');
            }
        }

        async function register() {
            const username = document.getElementById('registerUsername').value;
            const password = document.getElementById('registerPassword').value;
            const confirmPassword = document.getElementById('registerConfirmPassword').value;
            
            if (!username || !password || !confirmPassword) {
                showNotification('Please fill all fields', 'warning');
                return;
            }
            
            if (password !== confirmPassword) {
                showNotification('Passwords do not match', 'error');
                return;
            }
            
            if (password.length < 4) {
                showNotification('Password must be at least 4 characters', 'error');
                return;
            }
            
            const result = await apiRequest('/register', 'POST', { user: username, pass: password });
            
            if (result && result.success) {
                showNotification('Registration successful! Please login', 'success');
                showLogin();
            } else {
                showNotification(result?.message || 'Registration failed', 'error');
            }
        }

        async function logout() {
            await apiRequest('/logout', 'POST');
            currentUser = null;
            authToken = null;
            showLoginModal();
            showNotification('Logged out successfully', 'info');
        }

        // Dashboard functions
        async function loadDashboard() {
            const data = await apiRequest('/data');
            
            if (data) {
                // Update user info
                document.getElementById('userName').textContent = data.user;
                document.getElementById('userRole').textContent = data.role === 'admin' ? 'Admin Panel' : 'User Panel';
                document.getElementById('userAvatar').textContent = data.user.charAt(0).toUpperCase();
                
                // Update stats
                const activeBots = data.activeBots?.length || 0;
                const totalSessions = data.sessions?.length || 0;
                
                document.getElementById('activeBotsCount').textContent = activeBots;
                document.getElementById('totalSessionsCount').textContent = totalSessions;
                document.getElementById('onlineBotsCount').textContent = activeBots;
                document.getElementById('pendingBotsCount').textContent = totalSessions - activeBots;
                
                // Load bot list
                loadBotList(data);
            }
        }

        function loadBotList(data) {
            const container = document.getElementById('botListContainer');
            
            if (!data.sessions || data.sessions.length === 0) {
                container.innerHTML = `
                    <div class="empty-state" style="text-align: center; padding: 40px;">
                        <i class="fas fa-robot" style="font-size: 48px; color: var(--text-sec); margin-bottom: 20px;"></i>
                        <p style="color: var(--text-sec); margin-bottom: 20px;">No WhatsApp bots yet</p>
                        <button class="btn btn-primary" onclick="showView('add-bot')">
                            <i class="fas fa-plus"></i> Add Your First Bot
                        </button>
                    </div>
                `;
                return;
            }
            
            let html = '';
            
            data.sessions.forEach(session => {
                const meta = data.meta?.[session] || {};
                const isActive = data.activeBots?.includes(session) || false;
                const isOwned = data.role === 'admin' || meta.owner === data.user;
                
                if (!isOwned) return;
                
                let statusClass = 'status-offline';
                let statusText = 'OFFLINE';
                
                if (isActive) {
                    statusClass = 'status-online';
                    statusText = 'ONLINE';
                } else if (meta.active) {
                    statusClass = 'status-offline';
                    statusText = 'OFFLINE';
                } else {
                    statusClass = 'status-pending';
                    statusText = 'PENDING';
                }
                
                if (meta.isTrial) {
                    statusClass = 'status-trial';
                    statusText = 'TRIAL';
                }
                
                html += `
                    <div class="bot-item" data-session="${session}">
                        <div class="bot-header">
                            <div>
                                <div class="bot-phone">+${session}</div>
                                <div class="bot-owner">Owner: ${meta.owner || 'Unknown'}</div>
                            </div>
                            <div class="bot-status">
                                <span class="status-badge ${statusClass}">${statusText}</span>
                            </div>
                        </div>
                        
                        <div class="bot-actions">
                            ${isActive ? `
                                <button class="btn btn-secondary btn-small" onclick="botControl('${session}', 'stop')">
                                    <i class="fas fa-stop"></i> Stop
                                </button>
                                <button class="btn btn-secondary btn-small" onclick="botControl('${session}', 'restart')">
                                    <i class="fas fa-redo"></i> Restart
                                </button>
                            ` : `
                                <button class="btn btn-primary btn-small" onclick="botControl('${session}', 'start')">
                                    <i class="fas fa-play"></i> Start
                                </button>
                            `}
                            
                            ${data.role === 'admin' && !meta.active ? `
                                <button class="btn btn-secondary btn-small" onclick="botControl('${session}', 'approve')">
                                    <i class="fas fa-check"></i> Approve
                                </button>
                            ` : ''}
                            
                            ${meta.isTrial ? `
                                <button class="btn btn-secondary btn-small" onclick="botControl('${session}', 'extend')">
                                    <i class="fas fa-clock"></i> Extend
                                </button>
                            ` : ''}
                            
                            <button class="btn btn-danger btn-small" onclick="botControl('${session}', 'delete')">
                                <i class="fas fa-trash"></i> Delete
                            </button>
                        </div>
                    </div>
                `;
            });
            
            container.innerHTML = html;
        }

        // Bot control functions
        async function botControl(session, action) {
            if (action === 'delete') {
                if (!confirm('Are you sure you want to delete this bot?')) {
                    return;
                }
            }
            
            const result = await apiRequest(`/${action}/${session}`, 'POST');
            
            if (result && result.success) {
                showNotification(`Bot ${action} successful`, 'success');
                loadDashboard();
            } else {
                showNotification(result?.message || `Failed to ${action} bot`, 'error');
            }
        }

        // Add bot function
        async function addBot() {
            const phoneInput = document.getElementById('botPhoneInput');
            const phone = phoneInput.value.trim();
            
            if (!phone) {
                showNotification('Please enter phone number', 'warning');
                return;
            }
            
            // Validate phone number
            const phoneRegex = /^[0-9]{10,15}$/;
            if (!phoneRegex.test(phone)) {
                showNotification('Please enter a valid phone number (10-15 digits)', 'error');
                return;
            }
            
            const result = await apiRequest('/add', 'POST', { phone: phone });
            
            if (result && result.success) {
                showNotification('Bot added successfully! Please scan QR code', 'success');
                showAddBotModal(result.phone);
                phoneInput.value = '';
            } else {
                showNotification(result?.message || 'Failed to add bot', 'error');
            }
        }

        function showAddBotModal(phone) {
            currentBot = phone;
            document.getElementById('qrStep').style.display = 'block';
            document.getElementById('connectedStep').style.display = 'none';
            showModal('addBotModal');
            
            // Start polling for QR code
            pollQRCode(phone);
        }

        async function pollQRCode(phone) {
            const interval = setInterval(async () => {
                const result = await apiRequest(`/code/${phone}`);
                
                if (result && result.code) {
                    if (result.code === 'CONNECTED') {
                        clearInterval(interval);
                        document.getElementById('qrStep').style.display = 'none';
                        document.getElementById('connectedStep').style.display = 'block';
                    } else if (result.code !== 'WAITING') {
                        // Display QR code
                        const qrDiv = document.getElementById('qrCodeDisplay');
                        qrDiv.innerHTML = `
                            <div style="font-family: monospace; font-size: 24px; letter-spacing: 4px; color: #000; margin: 10px 0;">
                                ${result.code}
                            </div>
                            <small style="color: #666;">Pairing code</small>
                        `;
                    }
                }
            }, 2000);
        }

        async function checkBotConnection() {
            const result = await apiRequest(`/code/${currentBot}`);
            
            if (result && result.code === 'CONNECTED') {
                document.getElementById('qrStep').style.display = 'none';
                document.getElementById('connectedStep').style.display = 'block';
            } else {
                showNotification('Not connected yet. Please scan the QR code.', 'warning');
            }
        }

        // Check number function
        async function checkNumber() {
            const phoneInput = document.getElementById('checkNumberInput');
            const phone = phoneInput.value.trim();
            
            if (!phone) {
                showNotification('Please enter phone number', 'warning');
                return;
            }
            
            const result = await apiRequest('/check-number', 'POST', { target: phone });
            
            const container = document.getElementById('checkResultContainer');
            const content = document.getElementById('checkResultContent');
            
            if (result && result.success && result.data) {
                const data = result.data;
                
                container.style.display = 'block';
                content.innerHTML = `
                    <div class="profile-card">
                        <img src="${data.ppUrl || 'https://telegra.ph/file/558661849a0d310e5349e.png'}" 
                             class="profile-avatar" 
                             onerror="this.src='https://telegra.ph/file/558661849a0d310e5349e.png'">
                        
                        <div class="profile-name">${data.name || 'Unknown'}</div>
                        <div class="profile-number">+${data.number || phone}</div>
                        
                        <div class="profile-details">
                            <div class="detail-row">
                                <span class="detail-label">Account Type:</span>
                                <span class="detail-value">${data.type || 'Personal'}</span>
                            </div>
                            
                            <div class="detail-row">
                                <span class="detail-label">Status:</span>
                                <span class="detail-value">${data.status || '-'}</span>
                            </div>
                            
                            <div class="detail-row">
                                <span class="detail-label">Status Date:</span>
                                <span class="detail-value">${data.statusDate || '-'}</span>
                            </div>
                            
                            ${data.address && data.address !== '-' ? `
                                <div class="detail-row">
                                    <span class="detail-label">Address:</span>
                                    <span class="detail-value">${data.address}</span>
                                </div>
                            ` : ''}
                            
                            ${data.category && data.category !== '-' ? `
                                <div class="detail-row">
                                    <span class="detail-label">Category:</span>
                                    <span class="detail-value">${data.category}</span>
                                </div>
                            ` : ''}
                            
                            ${data.website && data.website !== '-' ? `
                                <div class="detail-row">
                                    <span class="detail-label">Website:</span>
                                    <span class="detail-value">
                                        <a href="${data.website}" target="_blank" style="color: var(--accent);">
                                            ${data.website}
                                        </a>
                                    </span>
                                </div>
                            ` : ''}
                            
                            ${data.email && data.email !== '-' ? `
                                <div class="detail-row">
                                    <span class="detail-label">Email:</span>
                                    <span class="detail-value">${data.email}</span>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `;
            } else {
                container.style.display = 'block';
                content.innerHTML = `
                    <div style="text-align: center; padding: 40px;">
                        <div style="font-size: 48px; color: var(--danger); margin-bottom: 20px;">
                            <i class="fas fa-times-circle"></i>
                        </div>
                        <h3 style="color: var(--danger); margin-bottom: 10px;">Number Not Found</h3>
                        <p style="color: var(--text-sec);">
                            The number <b>${phone}</b> is not registered on WhatsApp or is not active.
                        </p>
                    </div>
                `;
            }
        }

        // Downloader functions
        async function downloadVideo() {
            const urlInput = document.getElementById('videoUrlInput');
            const url = urlInput.value.trim();
            
            if (!url) {
                showNotification('Please enter video URL', 'warning');
                return;
            }
            
            const result = await apiRequest('/download', 'POST', { url: url, type: 'mp4' });
            
            if (result && result.success && result.data) {
                showDownloadResult(result.data);
            } else {
                showNotification('Failed to download video', 'error');
            }
        }

        async function downloadAudio() {
            const urlInput = document.getElementById('audioUrlInput');
            const url = urlInput.value.trim();
            
            if (!url) {
                showNotification('Please enter audio URL', 'warning');
                return;
            }
            
            const result = await apiRequest('/download', 'POST', { url: url, type: 'mp3' });
            
            if (result && result.success && result.data) {
                showDownloadResult(result.data);
            } else {
                showNotification('Failed to download audio', 'error');
            }
        }

        function showDownloadResult(data) {
            const resultDiv = document.getElementById('downloadResult');
            
            resultDiv.innerHTML = `
                <h4>Download Ready</h4>
                <img src="${data.thumbnail || 'https://telegra.ph/file/558661849a0d310e5349e.png'}" 
                     class="download-preview"
                     onerror="this.src='https://telegra.ph/file/558661849a0d310e5349e.png'">
                
                <h5 style="margin-bottom: 10px;">${data.title || 'Downloaded Media'}</h5>
                
                <a href="${data.url}" 
                   class="btn btn-primary" 
                   target="_blank"
                   style="width: 100%; margin-top: 15px;">
                    <i class="fas fa-download"></i> Download Now
                </a>
            `;
            
            resultDiv.classList.add('show');
        }

        // Media functions
        async function loadMedia(type) {
            const result = await apiRequest('/list-media', 'POST', { type: type });
            
            const gridId = type === 'rvo' ? 'rvoMediaGrid' : 'statusMediaGrid';
            const grid = document.getElementById(gridId);
            
            if (result && result.success && result.data && result.data.length > 0) {
                let html = '';
                
                result.data.forEach(item => {
                    const isVideo = item.file?.endsWith('.mp4') || item.url?.includes('.mp4');
                    
                    html += `
                        <div class="media-item">
                            ${isVideo ? `
                                <video class="media-preview" controls>
                                    <source src="${item.url}" type="video/mp4">
                                </video>
                            ` : `
                                <img src="${item.url}" class="media-preview" 
                                     onerror="this.src='https://telegra.ph/file/558661849a0d310e5349e.png'">
                            `}
                            
                            <div class="media-info">
                                <div class="media-title">${item.sender || 'Unknown'}</div>
                                <div class="media-date">
                                    ${new Date(item.time || Date.now()).toLocaleString()}
                                </div>
                                
                                <a href="${item.url}" 
                                   class="btn btn-primary btn-small" 
                                   download
                                   style="width: 100%; margin-top: 10px;">
                                    <i class="fas fa-download"></i> Download
                                </a>
                            </div>
                        </div>
                    `;
                });
                
                grid.innerHTML = html;
            } else {
                grid.innerHTML = `
                    <div class="empty-state" style="text-align: center; padding: 40px; grid-column: 1/-1;">
                        <i class="fas fa-${type === 'rvo' ? 'eye-slash' : 'history'}" 
                           style="font-size: 48px; color: var(--text-sec); margin-bottom: 20px;"></i>
                        <p style="color: var(--text-sec);">
                            No ${type === 'rvo' ? 'view once' : 'status'} media saved yet
                        </p>
                    </div>
                `;
            }
        }

        // Helper functions
        function showLoginModal() {
            showModal('authModal');
            showLogin();
        }

        function showLogin() {
            document.getElementById('loginTab').style.display = 'block';
            document.getElementById('registerTab').style.display = 'none';
        }

        function showRegister() {
            document.getElementById('loginTab').style.display = 'none';
            document.getElementById('registerTab').style.display = 'block';
        }

        function showNotification(message, type = 'info') {
            // Remove existing notification
            const existing = document.querySelector('.notification');
            if (existing) existing.remove();
            
            // Create notification element
            const notification = document.createElement('div');
            notification.className = `notification ${type}`;
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 15px 20px;
                background: ${type === 'success' ? 'var(--success)' : 
                           type === 'error' ? 'var(--danger)' : 
                           type === 'warning' ? 'var(--warning)' : 'var(--info)'};
                color: white;
                border-radius: var(--radius-md);
                box-shadow: var(--shadow-float);
                z-index: 9999;
                animation: slideIn 0.3s ease;
                max-width: 300px;
            `;
            
            notification.innerHTML = `
                <div style="display: flex; align-items: center; gap: 10px;">
                    <i class="fas fa-${type === 'success' ? 'check-circle' : 
                                   type === 'error' ? 'times-circle' : 
                                   type === 'warning' ? 'exclamation-triangle' : 'info-circle'}"></i>
                    <span>${message}</span>
                </div>
            `;
            
            document.body.appendChild(notification);
            
            // Auto remove after 5 seconds
            setTimeout(() => {
                notification.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => notification.remove(), 300);
            }, 5000);
        }

        // Initialize event listeners
        function initEventListeners() {
            // Theme toggle
            document.getElementById('themeToggle').addEventListener('click', toggleTheme);
            
            // Navigation buttons
            document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const view = btn.getAttribute('data-view');
                    showView(view);
                    
                    // Load specific data for view
                    if (view === 'media') {
                        loadMedia('rvo');
                    }
                });
            });
            
            // Tab buttons
            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const tab = btn.getAttribute('data-tab');
                    showTab(tab);
                    
                    if (tab === 'rvo') {
                        loadMedia('rvo');
                    } else if (tab === 'status') {
                        loadMedia('status');
                    }
                });
            });
            
            // Login/Register buttons
            document.getElementById('loginBtn')?.addEventListener('click', login);
            document.getElementById('registerBtn')?.addEventListener('click', register);
            
            // Enter key for login
            document.getElementById('loginPassword')?.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') login();
            });
            
            // Add bot button
            document.getElementById('addBotBtn')?.addEventListener('click', addBot);
            
            // Check number button
            document.getElementById('checkNumberBtn')?.addEventListener('click', checkNumber);
            
            // Download buttons
            document.getElementById('downloadVideoBtn')?.addEventListener('click', downloadVideo);
            document.getElementById('downloadAudioBtn')?.addEventListener('click', downloadAudio);
            
            // Refresh button
            document.getElementById('refreshBotsBtn')?.addEventListener('click', loadDashboard);
            
            // Logout button
            document.getElementById('logoutBtn')?.addEventListener('click', logout);
            
            // Auto-refresh dashboard every 10 seconds
            setInterval(loadDashboard, 10000);
        }

        // Add CSS animations for notifications
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideIn {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            
            @keyframes slideOut {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(100%);
                    opacity: 0;
                }
            }
            
            .text-muted {
                color: var(--text-sec);
            }
            
            .bot-list-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 20px;
            }
            
            .empty-state {
                text-align: center;
                padding: 40px;
                color: var(--text-sec);
            }
            
            .info-box {
                background: var(--bg-nav);
                padding: 15px;
                border-radius: var(--radius-md);
            }
        `;
        document.head.appendChild(style);
    </script>
</body>
</html>`;
}
