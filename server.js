const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const crypto = require('crypto');
const axios = require('axios'); 
const os = require('os');
const path = require('path');
const btch = require('btch-downloader'); // JANGAN LUPA: npm install btch-downloader

// ====================================================
// ⚙️ KONFIGURASI SERVER
// ====================================================
const BIN_ID = '693151eed0ea881f40121ca6'; 
const API_KEY = '$2a$10$u00Qvq6xrri32tc7bEYVhuQv94XS.ygeVCr70UDbzoOVlR8yLuUq.'; 
const WA_ADMIN = 'https://wa.me/6283879950760'; 
const EXTERNAL_REDIRECT = 'https://xgenzy.github.io/RVO/';

// Port internal random
const PORT = 0; // 0 = port random otomatis

// Auto-restart config
const HEALTH_CHECK_INTERVAL = 15000; // 15 detik
const MAX_RETRIES = 5;
const RESTART_DELAY = 3000; // 3 detik
// ====================================================
// STATE MANAGEMENT UNTUK AUTO-RESTART
// ====================================================
let cloudflaredProcess = null;
let tunnelUrl = null;
let retryCount = 0;
let isRestarting = false;
let httpServer = null;
let serverPort = null;

// File untuk menyimpan status
const STATUS_FILE = path.join(__dirname, 'server_status.json');

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
// DATABASE & BOT MANAGEMENT (KODE ASLI ANDA)
// ====================================================
const USERS_FILE = path.join(__dirname, 'users.json');
const BOTS_META_FILE = path.join(__dirname, 'bots.json');

let usersDB = [];

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

let botsMeta = {};
if (fs.existsSync(BOTS_META_FILE)) { 
    try { botsMeta = JSON.parse(fs.readFileSync(BOTS_META_FILE)); } 
    catch { botsMeta = {}; } 
}
const saveBotMeta = () => fs.writeFileSync(BOTS_META_FILE, JSON.stringify(botsMeta, null, 2));

const activeBots = new Map();
const pairingCodes = new Map();
const activeSessions = new Map(); 
const checkRequests = new Map();

// ====================================================
// UTILS FUNCTIONS (KODE ASLI ANDA)
// ====================================================
async function updateCloudUrl(url) {
    if(BIN_ID.includes('MASUKKAN')) return; 
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
    const h = req.headers.cookie; if (!h) return null;
    const c = h.split(';').reduce((a, b) => { const [n, v] = b.trim().split('='); a[n] = v; return a; }, {});
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
// BOT PROCESS FUNCTIONS (KODE ASLI ANDA)
// ====================================================
const getSessions = () => fs.readdirSync('./').filter(file => fs.statSync(file).isDirectory() && /^\d+$/.test(file));

const startBotProcess = (sessionName) => {
    const meta = botsMeta[sessionName];
    if (!meta) return { success: false, message: 'Sesi tidak ditemukan' };
    
    if (meta.isTrial && meta.trialEnd && Date.now() > meta.trialEnd) {
        meta.active = false; saveBotMeta(); return { success: false, message: 'Trial Habis' };
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
    if(activeBots.has(sessionName)) { 
        activeBots.get(sessionName).kill(); 
        activeBots.delete(sessionName); 
        return { success: true }; 
    }
    return { success: false };
};

const deleteSession = (sessionName) => {
    if(activeBots.has(sessionName)) activeBots.get(sessionName).kill();
    try {
        fs.rmSync(`./${sessionName}`, {recursive:true, force:true}); 
        delete botsMeta[sessionName]; saveBotMeta();
        return {success:true};
    } catch(e) { return {success:false}; }
};

const addSession = (ph, owner) => { 
    let p = normalizePhone(ph);
    if (getSessions().includes(p)) return { success: false, message: 'Nomor ada' };
    botsMeta[p] = { owner: owner, active: false, isTrial: false, trialEnd: null }; saveBotMeta();
    pairingCodes.set(p, 'WAITING');
    
    const child = spawn('node', ['bot.js', p], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'], shell: true });
    activeBots.set(p, child);
    
    child.stdout.on('data', (d) => {
        const l = d.toString();
        if(l.includes('KODE PAIRING')) pairingCodes.set(p, l.split(':').pop().trim());
        if(l.includes('TERHUBUNG')) pairingCodes.set(p, 'CONNECTED');
    });

    setTimeout(() => {
        if(activeBots.has(p) && pairingCodes.get(p) !== 'CONNECTED') {
            activeBots.get(p).kill(); activeBots.delete(p);
        }
    }, 120000); 
    return {success:true, phone:p}; 
};

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
// ====================================================
// AUTO-RESTART SYSTEM FUNCTIONS
// ====================================================

// 1. Fungsi untuk kill cloudflared lama
function killExistingCloudflared() {
    try {
        // Linux/Mac
        exec('pkill -f cloudflared', (error, stdout, stderr) => {
            if (!error) console.log('✅ Killed existing cloudflared processes');
        });
        // Windows
        exec('taskkill /F /IM cloudflared.exe 2>nul', () => {});
    } catch (error) {
        // Ignore errors
    }
}

// 2. Fungsi untuk start cloudflared tunnel
function startCloudflaredTunnel(port) {
    return new Promise((resolve, reject) => {
        console.log(`🚇 Starting Cloudflare Tunnel for port ${port}...`);
        
        killExistingCloudflared();
        
        cloudflaredProcess = spawn('cloudflared', [
            'tunnel',
            '--url', `http://localhost:${port}`,
            '--no-autoupdate'
        ], {
            stdio: ['pipe', 'pipe', 'pipe'],
            detached: false
        });
        
        let tunnelOutput = '';
        let urlFound = false;
        
        // Capture output untuk mendapatkan URL
        cloudflaredProcess.stderr.on('data', (data) => {
            const output = data.toString();
            tunnelOutput += output;
            
            // Log output ke console
            const lines = output.split('\n');
            lines.forEach(line => {
                if (line.trim()) console.log('[CLOUDFLARED]', line.trim());
            });
            
            // Cari URL tunnel
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
                
                // Simpan status
                saveServerStatus({
                    url: tunnelUrl,
                    port: port,
                    created_at: new Date().toISOString(),
                    pid: process.pid,
                    cloudflared_pid: cloudflaredProcess.pid
                });
                
                // Update ke JSONBin
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
        
        // Timeout untuk tunnel creation
        setTimeout(() => {
            if (!urlFound) {
                console.error('❌ Tunnel creation timeout (30s)');
                cloudflaredProcess.kill();
                reject(new Error('Tunnel creation timeout'));
            }
        }, 30000);
    });
}

// 3. Fungsi health check
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

// 4. Fungsi restart server
async function restartServer() {
    if (isRestarting) return;
    
    isRestarting = true;
    retryCount++;
    
    console.log(`\n🔄 Restarting server (Attempt ${retryCount}/${MAX_RETRIES})...`);
    
    try {
        // Kill processes
        if (cloudflaredProcess) {
            cloudflaredProcess.kill('SIGTERM');
            cloudflaredProcess = null;
        }
        
        if (httpServer) {
            httpServer.close();
            httpServer = null;
        }
        
        // Tunggu sebentar
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Start ulang
        await initializeServer();
        
        console.log('✅ Server restarted successfully');
        retryCount = 0; // Reset retry count
        
    } catch (error) {
        console.error('❌ Failed to restart server:', error.message);
        
        if (retryCount >= MAX_RETRIES) {
            console.error(`💀 Max retries reached (${MAX_RETRIES}). Waiting 30 seconds...`);
            await new Promise(resolve => setTimeout(resolve, 30000));
            retryCount = 0;
        }
        
        // Coba lagi
        setTimeout(() => {
            isRestarting = false;
            restartServer();
        }, RESTART_DELAY * 2);
        return;
    }
    
    isRestarting = false;
}

// 5. Fungsi save status
function saveServerStatus(status) {
    try {
        fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
        console.log(`📄 Status saved to: ${STATUS_FILE}`);
    } catch (error) {
        console.error('Failed to save status:', error);
    }
}

// 6. Fungsi check internet connection
async function checkInternetConnection() {
    try {
        await axios.get('https://1.1.1.1', { timeout: 5000 });
        return true;
    } catch (error) {
        console.warn('🌐 Internet connection lost');
        return false;
    }
}

// 7. Setup graceful shutdown
function setupGracefulShutdown() {
    const shutdown = async (signal) => {
        console.log(`\n${signal} received, shutting down gracefully...`);
        
        isRestarting = true;
        
        // Kill cloudflared
        if (cloudflaredProcess) {
            cloudflaredProcess.kill('SIGTERM');
        }
        
        // Kill all bot processes
        activeBots.forEach((bot, key) => {
            bot.kill();
            console.log(`Stopped bot: ${key}`);
        });
        
        // Close HTTP server
        if (httpServer) {
            httpServer.close();
        }
        
        console.log('✅ All processes stopped');
        process.exit(0);
    };
    
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    
    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
        console.error('❌ Uncaught Exception:', error.message);
        setTimeout(() => restartServer(), 1000);
    });
    
    process.on('unhandledRejection', (reason, promise) => {
        console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    });
}

// 8. Health monitoring system
function startHealthMonitoring() {
    setInterval(async () => {
        try {
            // Check internet connection
            const hasInternet = await checkInternetConnection();
            if (!hasInternet) {
                console.warn('🌐 No internet, waiting for connection...');
                return;
            }
            
            // Check tunnel health
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
// 🎨 FRONTEND: ONE UI (AMOLED DARK/LIGHT) HD 3D
// ====================================================
const getHTML = () => `
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Bot Manager OneUI</title>
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap" rel="stylesheet">
    <style>
        :root {
            /* === ONE UI LIGHT === */
            --bg-body: #f7f7f7;
            --bg-card: #ffffff;
            --bg-nav: #f2f2f2;
            --text-pri: #000000;
            --text-sec: #787878;
            
            /* DIBAH DARI BIRU (#007aff) KE HIJAU */
            --accent: #28a745; 
            /* Merubah RGBA biru (0, 122, 255) ke hijau (40, 167, 69) */
            --accent-soft: rgba(40, 167, 69, 0.15);
            
            --danger: #ff3b30;
            --success: #34c759;
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
            
            /* DIUBAH DARI BIRU MUDA (#3399ff) KE HIJAU CERAH */
            --accent: #4ade80;
            /* Merubah RGBA biru muda ke hijau muda */
            --accent-soft: rgba(74, 222, 128, 0.2);
            
            --danger: #ff453a;
            --success: #32d74b;
            --border: #2c2c2c;
            --shadow: 0 4px 15px rgba(0,0,0,0.5); 
            --shadow-float: 0 10px 40px rgba(0,0,0,0.7);
            --glass: rgba(18, 18, 18, 0.7);
        }

        * { margin:0; padding:0; box-sizing:border-box; font-family: 'Roboto', sans-serif; -webkit-tap-highlight-color: transparent; outline:none; }
        
        body {
            background-color: var(--bg-body);
            color: var(--text-pri);
            height: 100vh;
            overflow: hidden;
            display: flex;
            transition: background 0.4s ease, color 0.4s ease;
        }

        /* --- LAYOUT --- */
        .sidebar {
            width: 300px;
            background: var(--bg-nav);
            padding: 25px;
            display: flex;
            flex-direction: column;
            border-radius: 0 var(--radius-xl) var(--radius-xl) 0;
            box-shadow: 5px 0 20px rgba(0,0,0,0.02);
            z-index: 100;
            transition: transform 0.3s cubic-bezier(0.165, 0.84, 0.44, 1);
        }

        .main-content {
            flex: 1;
            padding: 20px 30px;
            overflow-y: auto;
            position: relative;
        }

        /* --- HEADER --- */
        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 30px;
            padding-top: 10px;
        }
        .header h1 { font-size: 28px; font-weight: 700; letter-spacing: -0.5px; }
        .header p { color: var(--text-sec); font-size: 14px; margin-top: 5px; }

        /* --- THEME TOGGLE (TOP RIGHT) --- */
        .theme-toggle {
            position: absolute;
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
        }
        .theme-toggle:active { transform: scale(0.9); }
        .theme-toggle svg { width: 22px; height: 22px; fill: var(--text-pri); transition: fill 0.3s; }

        /* --- NAV ITEMS --- */
        .profile {
            display: flex; align-items: center; gap: 15px;
            margin-bottom: 40px;
            background: var(--bg-card); padding: 15px;
            border-radius: var(--radius-md);
            box-shadow: var(--shadow);
        }
        .avatar {
            width: 48px; height: 48px;
            background: linear-gradient(135deg, var(--accent), #0056b3);
            color: #fff; font-size: 20px; font-weight: 700;
            border-radius: 50%; display: flex; align-items: center; justify-content: center;
        }
        
        .nav-btn {
            padding: 14px 20px;
            margin-bottom: 12px;
            border-radius: var(--radius-md);
            cursor: pointer;
            color: var(--text-sec);
            font-weight: 500;
            display: flex; align-items: center; gap: 15px;
            transition: 0.3s;
        }
        .nav-btn svg { width: 22px; height: 22px; fill: var(--text-sec); transition: 0.3s; }
        .nav-btn:hover { background: var(--bg-card); color: var(--text-pri); transform: translateX(5px); }
        .nav-btn.active {
            background: var(--accent); color: #fff;
            box-shadow: 0 4px 15px var(--accent-soft);
        }
        .nav-btn.active svg { fill: #fff; }

        /* --- CARDS & 3D EFFECT --- */
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
        
        /* --- STATS GRID --- */
        .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
        .stat-item { text-align: center; }
        .stat-val { font-size: 36px; font-weight: 700; color: var(--accent); display: block; }
        .stat-lbl { font-size: 14px; color: var(--text-sec); font-weight: 500; text-transform: uppercase; letter-spacing: 1px; }

        /* --- BOT LIST --- */
        .bot-row {
            display: flex; justify-content: space-between; align-items: center;
            padding: 15px 0; border-bottom: 1px solid var(--border);
        }
        .bot-row:last-child { border-bottom: none; }
        .badge { padding: 6px 14px; border-radius: 20px; font-size: 11px; font-weight: 700; }
        .bg-on { background: rgba(50, 215, 75, 0.15); color: var(--success); }
        .bg-off { background: rgba(255, 59, 48, 0.15); color: var(--danger); }
        .bg-wait { background: rgba(255, 204, 0, 0.15); color: #ffcc00; }

        /* --- BUTTONS & INPUTS --- */
        .btn {
            padding: 12px 24px; border-radius: 50px; border: none; font-weight: 600; font-size: 14px; cursor: pointer;
            transition: 0.2s; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
        }
        .btn-primary { background: var(--accent); color: #fff; box-shadow: 0 4px 12px var(--accent-soft); }
        .btn-primary:hover { filter: brightness(1.1); transform: scale(1.05); }
        .btn-sec { background: transparent; border: 1px solid var(--border); color: var(--text-sec); }
        .btn-danger { background: rgba(255,59,48,0.1); color: var(--danger); }
        
        input {
            width: 100%; padding: 16px 20px; border-radius: var(--radius-md);
            border: 1px solid var(--border); background: var(--bg-body);
            color: var(--text-pri); font-size: 16px; margin-bottom: 15px;
            transition: 0.3s;
        }
        input:focus { border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }
        
        /* CHECK PROFILE UI */
        .profile-card {
            background: var(--bg-card); border-radius: 16px; padding: 30px; 
            display: flex; flex-direction: column; align-items: center; 
            box-shadow: 0 4px 12px rgba(0,0,0,0.1); border: 1px solid var(--border);
            animation: fadeIn 0.5s;
        }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .pc-img { width: 120px; height: 120px; border-radius: 50%; object-fit: cover; border: 4px solid var(--accent); margin-bottom: 15px; }
        .pc-name { font-size: 22px; font-weight: bold; color: var(--text-main); margin-bottom: 5px; }
        .pc-jid { font-size: 14px; color: var(--text-sub); margin-bottom: 15px; background: var(--bg-header); padding: 4px 12px; border-radius: 20px; }
        .pc-grid { width: 100%; display: grid; gap: 10px; margin-top: 10px; }
        .pc-row { display: flex; justify-content: space-between; padding: 12px; background: var(--bg-header); border-radius: 8px; font-size: 14px; }
        .pc-val { font-weight: 600; color: var(--text-main); text-align: right; }

        /* COMPONENTS */
        input { width: 100%; padding: 12px 15px; background: var(--input-bg); border: 1px solid var(--border); border-radius: 8px; color: var(--text-main); margin-bottom: 15px; outline: none; }
        input:focus { border-color: var(--accent); }
        .btn { border: none; padding: 10px 20px; border-radius: 24px; font-weight: 600; cursor: pointer; font-size: 14px; }
        .btn-main { background: var(--accent); color: white; }
        .btn-main:hover { background: #008f6f; }
        .btn-sec { background: transparent; border: 1px solid var(--border); color: var(--text-main); }
        
        .bot-item { background: var(--bg-card); padding: 15px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
        .badge { padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: bold; }
        .b-on { background: #dcf8c6; color: #00a884; } .b-off { background: #ffebeb; color: #ef5350; }

        /* --- MODAL --- */
        .modal-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.6); backdrop-filter: blur(8px);
            z-index: 1000; display: none; align-items: center; justify-content: center;
            opacity: 0; transition: opacity 0.3s;
        }
        .modal-overlay.active { display: flex; opacity: 1; }
        .modal-box {
            width: 90%; max-width: 420px;
            background: var(--bg-card); border-radius: var(--radius-xl);
            padding: 30px; box-shadow: var(--shadow-float);
            transform: scale(0.8); transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .modal-overlay.active .modal-box { transform: scale(1); }

        /* --- RESPONSIVE --- */
        .burger { display: none; font-size: 24px; cursor: pointer; color: var(--text-pri); }
        @media (max-width: 768px) {
            .sidebar { position: fixed; left: -100%; height: 100%; box-shadow: 10px 0 30px rgba(0,0,0,0.3); }
            .sidebar.active { left: 0; }
            .main-content { padding: 15px; }
            .header { margin-top: 40px; } /* Space for toggle */
            .burger { display: block; margin-right: 15px; }
            .header-title { display: flex; align-items: center; }
        }

        /* --- ANIMATIONS --- */
        @keyframes fadeUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
        .view-section { display: none; animation: fadeUp 0.5s ease forwards; }
        .view-section.active { display: block; }
    </style>
</head>
<body data-theme="dark">

    <!-- AUTH MODAL -->
    <div class="modal-overlay active" id="authModal">
        <div class="modal-box" style="text-align:center">
            <h2 style="margin-bottom:10px; color:var(--text-pri)">Selamat Datang</h2>
            <p style="color:var(--text-sec); margin-bottom:30px">Silakan masuk untuk melanjutkan</p>
            
            <div id="pLogin">
                <input id="u" placeholder="Username" autocomplete="off">
                <input type="password" id="p" placeholder="Password">
                <button onclick="login()" class="btn btn-primary" style="width:100%">MASUK</button>
                <div style="margin-top:20px; display:flex; justify-content:space-between; font-size:13px">
                    <span onclick="switchAuth('reg')" style="color:var(--accent); cursor:pointer; font-weight:600">Buat Akun</span>
                    <span onclick="switchAuth('reset')" style="color:var(--text-sec); cursor:pointer">Lupa Password?</span>
                </div>
            </div>

            <div id="pReg" style="display:none">
                <input id="ru" placeholder="Username (Awalan Kapital)">
                <input type="password" id="rp" placeholder="Password">
                <button onclick="reg()" class="btn btn-primary" style="width:100%">DAFTAR</button>
                <button onclick="switchAuth('login')" class="btn btn-sec" style="width:100%; margin-top:10px">Batal</button>
            </div>
            
            <div id="pReset" style="display:none">
                 <input id="rUser" placeholder="Username">
                <input id="rPhone" placeholder="Nomor Bot (628xxx)">
                <input type="password" id="rNewPass" placeholder="Password Baru">
                <button onclick="resetPass()" class="btn btn-primary" style="width:100%">RESET</button>
                <button onclick="switchAuth('login')" class="btn btn-sec" style="width:100%; margin-top:10px">Kembali</button>
            </div>
        </div>
    </div>

    <!-- ADD BOT MODAL -->
    <div class="modal-overlay" id="addModal">
        <div class="modal-box">
            <h3 style="margin-bottom:20px; color:var(--text-pri)">Tautkan Perangkat</h3>
            <div id="step1">
                <p style="color:var(--text-sec); margin-bottom:15px; font-size:14px">Masukkan nomor WhatsApp</p>
                <input id="botPhone" type="tel" placeholder="Contoh: (+62xxxx)">
                <div style="display:flex; gap:10px; margin-top:10px">
                    <button onclick="reqPair()" class="btn btn-primary" style="flex:1">Dapatkan Kode</button>
                    <button onclick="closeModal('addModal')" class="btn btn-sec">Batal</button>
                </div>
            </div>
            <div id="step2" style="display:none; text-align:center">
                <div id="codeDisplay" onclick="copyCode()" style="background:var(--bg-body); padding:20px; border-radius:var(--radius-md); font-family:monospace; font-size:32px; font-weight:bold; letter-spacing:4px; color:var(--accent); margin:20px 0; cursor:pointer; border:2px dashed var(--accent)">...</div>
                <p style="color:var(--text-sec); font-size:12px">Klik kode untuk menyalin</p>
                <button onclick="closeModal('addModal')" class="btn btn-sec" style="width:100%; margin-top:15px">Tutup</button>
            </div>
        </div>
    </div>

    <!-- THEME TOGGLE (TOP RIGHT) -->
    <div class="theme-toggle" onclick="toggleTheme()" title="Ubah Tema">
        <svg viewBox="0 0 24 24"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-3.03 0-5.5-2.47-5.5-5.5 0-1.82.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z"/></svg>
    </div>

    <!-- SIDEBAR -->
    <div class="sidebar" id="sidebar">
        <div class="profile">
            <div class="avatar" id="uInit">U</div>
            <div>
                <div style="font-weight:700; color:var(--text-pri)" id="uName">Guest</div>
                <div style="font-size:12px; color:var(--text-sec)">User Panel</div>
            </div>
        </div>
        
        <div style="flex:1">
        <div class="nav-btn" onclick="refreshWeb()">
                 <svg viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg> Refresh
            </div>
            <div class="nav-btn active" id="nav-dash" onclick="view('dash')">
                <svg viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg> Beranda
            </div>
            <div class="nav-btn" onclick="openModal('addModal')">
                <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg> Login WhatsApp
            </div>
            <div class="nav-btn" id="nav-check" onclick="view('check')">
                    <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg> Cek Nomor
                </div>
            <div class="nav-btn" id="nav-dl" onclick="view('dl')">
                <svg viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg> Downloader
            </div>
            <div class="nav-btn" onclick="window.open('${WA_ADMIN}')">
                <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg> Hubungi Admin
            </div>
        </div>

        <div class="nav-btn" onclick="logout()" style="color:var(--danger)">
            <svg viewBox="0 0 24 24" style="fill:var(--danger)"><path d="M10.09 15.59L11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5c-1.11 0-2 .9-2 2v4h2V5h14v14H5v-4H3v4c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/></svg> Keluar
        </div>
    </div>

    <!-- MAIN CONTENT -->
<div class="main-content">
    <div class="header">
    <div class="header-title">
        <div class="burger" onclick="document.getElementById('sidebar').classList.add('active')">☰</div>
        <div>
            <h1 id="pageTitle" class="page-title">
                <!-- Icon dan title akan diisi oleh JavaScript -->
                <div class="whatsapp-title-icon">
                    <svg viewBox="0 0 24 24" width="32" height="32" class="whatsapp-title-svg">
                        <path fill="#25D366" d="M12 0C5.373 0 0 5.373 0 12c0 2.126.663 4.1 1.789 5.731L.038 23.644c-.12.455.263.84.718.72l5.913-1.75A11.96 11.96 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/>
                        <path fill="#ffffff" d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" class="title-icon-bubble"/>
                    </svg>
                    <div class="title-pulse-ring"></div>
                </div>
                <span class="title-text">Dashboard</span>
            </h1>
            <p>Kelola bot WhatsApp anda dengan mudah.</p>
        </div>
    </div>
</div>

        <!-- DASHBOARD VIEW -->
        <div id="view-dash" class="view-section active">
            <div class="card">
                <div class="stats-grid">
                    <div class="stat-item">
                        <span class="stat-val" id="stBot">0</span>
                        <span class="stat-lbl">Bot Aktif</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-val" id="stSesi">0</span>
                        <span class="stat-lbl">Total Sesi</span>
                    </div>
                </div>
            </div>

            <h3 style="margin: 30px 0 15px 0; color:var(--text-pri)">Daftar WhatsApp</h3>
            <div class="card" id="botList" style="min-height:200px">
                <!-- Bot list injected here -->
            </div>
        </div>
        
        <!-- VIEW CHECK NUMBER -->
                <div id="view-check" class="view-section">
                    <div class="card">
                        <h2 style="margin-bottom:10px; color:var(--text-pri)">Stalker Nomor WA</h2>
                <p style="color:var(--text-sec); margin-bottom:30px">Cek detail profil, status, dan keaktifan Nomor</p>
                        <input id="checkPhone" type="tel" placeholder="Contoh: (+62xxxx)">
                        <button onclick="doCheck()" id="btnCheck" class="btn btn-main" style="width:100%">CEK</button>
                    </div>
                    <div id="checkResult"></div>
                </div>
             

        <!-- DOWNLOADER VIEW -->
        <div id="view-dl" class="view-section">
            <div class="card" style="text-align:center; padding:40px 25px;">
                <h2 style="margin-bottom:10px; color:var(--text-pri)">Media Downloader</h2>
                <p style="color:var(--text-sec); margin-bottom:30px">TikTok, Instagram, Facebook, YouTube (No WM)</p>
                
                <input id="dlUrl" placeholder="Tempel URL di sini..." style="text-align:center">
                
                <div style="display:flex; gap:15px; justify-content:center; flex-wrap:wrap">
                    <button onclick="doDownload('mp4')" id="btnMp4" class="btn btn-primary" style="min-width:140px">Download MP4</button>
                    <button onclick="doDownload('mp3')" id="btnMp3" class="btn btn-sec" style="min-width:140px">Download MP3</button>
                </div>

                <div id="dlResult" style="margin-top:30px"></div>
            </div>
        </div>
        
        <!-- LOADING SCREEN -->
<div class="loader-overlay" id="loadingScreen">
    <div class="spinner-box"></div>
    <div style="margin-top: 20px; font-weight: 600; color: var(--accent);">
        Menghubungkan ke Server ...
    </div>
</div>

    </div>

    <script>
        const REDIRECT_URL = '${EXTERNAL_REDIRECT}';

        // --- THEME LOGIC ---
        function toggleTheme() {
            const body = document.body;
            const current = body.getAttribute('data-theme');
            const next = current === 'dark' ? 'light' : 'dark';
            body.setAttribute('data-theme', next);
            localStorage.setItem('theme', next);
        }
        if(localStorage.getItem('theme')) document.body.setAttribute('data-theme', localStorage.getItem('theme'));

        // --- UI LOGIC --- (VERSI SIMPLE DENGAN ANIMASI)
function view(v) {
    document.querySelectorAll('.view-section').forEach(e=>e.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(e=>e.classList.remove('active'));
    document.getElementById('view-'+v).classList.add('active');
    if(document.getElementById('nav-'+v)) document.getElementById('nav-'+v).classList.add('active');
    
    // TITLES
    const titles = {
        dash: 'Dashboard',
        check: 'Cek Nomor', 
        dl: 'Downloader',
        status: 'Status Saver',
        rvo: 'RVO Gallery'
    };
    
    // DESKRIPSI
    const descriptions = {
        dash: 'Kelola bot WhatsApp anda dengan mudah.',
        check: 'Cek detail profil, status, dan keaktifan nomor.',
        dl: 'Download media dari TikTok, Instagram, Facebook, YouTube.',
        status: 'Status WhatsApp teman yang tersimpan.',
        rvo: 'Media sekali lihat (ViewOnce) yang tertangkap.'
    };
    
    // Update hanya textnya saja
    const titleElement = document.querySelector('.title-text');
    if (titleElement) {
        titleElement.textContent = titles[v] || 'Panel';
    }
    
    // Update deskripsi
    const headerDesc = document.querySelector('.header p');
    if (headerDesc) {
        headerDesc.textContent = descriptions[v] || 'Kelola panel WhatsApp anda';
    }
    
    // Update SVG icon path dan tambah animasi
    const iconPathElement = document.querySelector('.title-icon-bubble');
    const svgElement = document.querySelector('.whatsapp-title-svg');
    const pulseRing = document.querySelector('.title-pulse-ring');
    
    if (iconPathElement && svgElement) {
        const iconPaths = {
            dash: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
            check: 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
            dl: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
            status: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
            rvo: 'M4 8h4V4H4v4zm6 12h4v-4h-4v4zm-6 0h4v-4H4v4zm0-6h4v-4H4v4zm6 0h4v-4h-4v4zm6-10v4h4V4h-4zm-6 4h4V4h-4v4zm6 6h4v-4h-4v4zm0 6h4v-4h-4v4z'
        };
        
        const newPath = iconPaths[v] || 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z';
        
        // Reset animasi
        svgElement.style.animation = 'none';
        if (pulseRing) pulseRing.style.animation = 'none';
        
        // Trigger reflow untuk restart animation
        void svgElement.offsetWidth;
        if (pulseRing) void pulseRing.offsetWidth;
        
        // Update icon path
        iconPathElement.setAttribute('d', newPath);
        
        // Restart animasi dengan efek khusus per halaman
        setTimeout(() => {
            // Animasi float tetap
            svgElement.style.animation = 'titleFloat 3s ease-in-out infinite';
            
            // Animasi khusus untuk setiap halaman
            let bubbleAnimation = 'titleBubble 2s infinite';
            if (v === 'dash') {
                bubbleAnimation = 'homeBounce 2s infinite';
            } else if (v === 'check') {
                bubbleAnimation = 'searchSpin 3s infinite';
            } else if (v === 'dl') {
                bubbleAnimation = 'downloadPulse 2s infinite';
            } else if (v === 'status') {
                bubbleAnimation = 'statusPulse 1.5s infinite';
            } else if (v === 'rvo') {
                bubbleAnimation = 'gridPulse 2s infinite';
            }
            
            iconPathElement.style.animation = bubbleAnimation;
            
            // Restart pulse ring animation
            if (pulseRing) {
                pulseRing.style.animation = 'titlePulse 2s infinite';
            }
            
            // Tambah efek glow untuk transisi
            svgElement.style.filter = 'drop-shadow(0 0 8px rgba(37, 211, 102, 0.8))';
            setTimeout(() => {
                svgElement.style.filter = 'none';
            }, 500);
            
        }, 10);
    }
    
    document.getElementById('sidebar').classList.remove('active');
}

function refreshWeb() { 
    if(confirm('Refresh Web?')) window.location.href = REDIRECT_URL; 
}

function openModal(id) { 
    document.getElementById(id).classList.add('active'); 
}

function closeModal(id) { 
    document.getElementById(id).classList.remove('active'); 
}

function switchAuth(type) {
    ['pLogin','pReg','pReset'].forEach(id => document.getElementById(id).style.display='none');
    if(type==='login') document.getElementById('pLogin').style.display='block';
    if(type==='reg') document.getElementById('pReg').style.display='block';
    if(type==='reset') document.getElementById('pReset').style.display='block';
}

        // --- API CALLS ---
        async function post(url, data) {
            try { return await (await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)})).json(); }
            catch { return {success:false, message:'Koneksi Error'}; }
        }

        // --- ANIMATION UTILS ---
function toggleLoading(show) {
    const loader = document.getElementById('loadingScreen');
    if(show) loader.classList.add('active');
    else {
        // Delay sedikit biar smooth
        setTimeout(() => loader.classList.remove('active'), 9000);
    }
}

async function login() {
    try {
        const u = document.getElementById('u').value;
        const p = document.getElementById('p').value;
        
        console.log('Login attempt with user:', u); // Debug
        
        if(!u || !p) {
            alert("Harap isi username dan password");
            return;
        }
        
        // Tampilkan loading di tombol
        const loginBtn = document.querySelector('#pLogin button');
        const originalText = loginBtn.innerHTML;
        loginBtn.innerHTML = 'MEMUAT...';
        loginBtn.disabled = true;
        
        // Gunakan fungsi post() yang sudah ada
        const d = await post('/api/login', {user: u, pass: p});
        
        console.log('Login response:', d); // Debug
        
        if(d.success) { 
            closeModal('authModal'); 
            loadData();
        } else {
            alert('Login Gagal: ' + (d.message || 'Cek username/password'));
        }
        
        // Reset tombol
        loginBtn.innerHTML = originalText;
        loginBtn.disabled = false;
        
    } catch (error) {
        console.error('Login error:', error);
        alert('Terjadi kesalahan. Coba lagi.');
        
        // Pastikan tombol di-reset jika error
        const loginBtn = document.querySelector('#pLogin button');
        if(loginBtn) {
            loginBtn.innerHTML = 'MASUK';
            loginBtn.disabled = false;
        }
    }
}
        async function reg() {
    const u = document.getElementById('ru').value.trim();
    const p = document.getElementById('rp').value.trim();
    
    if (!u || !p) {
        alert('Username dan password harus diisi');
        return;
    }
    
    if (u.length < 3) {
        alert('Username minimal 3 karakter');
        return;
    }
    
    if (p.length < 4) {
        alert('Password minimal 4 karakter');
        return;
    }
    
    // Tampilkan loading
    const regBtn = document.querySelector('#pReg button');
    const originalText = regBtn.innerHTML;
    regBtn.innerHTML = 'MENDAPATKAN...';
    regBtn.disabled = true;
    
    try {
        const d = await post('/api/register', {user: u, pass: p});
        
        if (d.success) { 
            alert('Berhasil daftar!');
            closeModal('authModal');
            loadData();
        } else {
            alert('Gagal: ' + (d.message || 'Coba username lain'));
        }
    } catch (error) {
        console.error('Registration error:', error);
        alert('Terjadi kesalahan. Coba lagi.');
    } finally {
        // Reset button
        regBtn.innerHTML = originalText;
        regBtn.disabled = false;
    }
}
// Tambahkan event listener untuk real-time validation
document.addEventListener('DOMContentLoaded', function() {
    const usernameInput = document.getElementById('ru');
    if (usernameInput) {
        let timeout;
        usernameInput.addEventListener('input', function() {
            clearTimeout(timeout);
            const username = this.value.trim();
            
            if (username.length < 3) return;
            
            timeout = setTimeout(async () => {
                const result = await post('/api/check-username', { username: username });
                const feedback = document.getElementById('usernameFeedback');
                
                if (!feedback) {
                    const newFeedback = document.createElement('div');
                    newFeedback.id = 'usernameFeedback';
                    newFeedback.style.fontSize = '12px';
                    newFeedback.style.marginTop = '-10px';
                    newFeedback.style.marginBottom = '10px';
                    usernameInput.parentNode.insertBefore(newFeedback, usernameInput.nextSibling);
                }
                
                const feedbackEl = document.getElementById('usernameFeedback');
                if (result.available) {
                    feedbackEl.innerHTML = '✓ Username tersedia';
                    feedbackEl.style.color = 'var(--success)';
                } else {
                    feedbackEl.innerHTML = '✗ ' + (result.message || 'Username tidak tersedia');
                    feedbackEl.style.color = 'var(--danger)';
                }
            }, 500);
        });
    }
});
        async function resetPass() {
            const d = await post('/api/reset-password', {user:document.getElementById('rUser').value, phone:document.getElementById('rPhone').value, newPass:document.getElementById('rNewPass').value});
            if(d.success) { alert('Password Reset!'); switchAuth('login'); } else alert('Gagal');
        }
        async function logout() { await post('/api/logout',{}); window.location.reload(); }
        
        

        
        // Cari function doCheck() di dalam string HTML server.js
        async function doCheck() {
            const ph = document.getElementById('checkPhone').value;
            if(!ph) return alert('Isi nomor');
            const btn = document.getElementById('btnCheck');
            const res = document.getElementById('checkResult');
            
            btn.innerHTML = 'Sedang Mencari...'; btn.disabled = true;
            res.innerHTML = ''; // Reset hasil sebelumnya

            const r = await post('/api/check-number', {target: ph});
            btn.innerHTML = 'CEK SEKARANG'; btn.disabled = false;

            if(r.success && r.data) {
                const d = r.data;
                // Badge warna untuk tipe WA
                const typeBadge = d.type.includes('Business') 
                    ? '<span style="background:#e6fffa; color:#00a884; padding:2px 8px; border-radius:4px; font-size:10px; border:1px solid #00a884">BUSINESS</span>'
                    : '<span style="background:#e3f2fd; color:#2196f3; padding:2px 8px; border-radius:4px; font-size:10px; border:1px solid #2196f3">PERSONAL</span>';

                res.innerHTML = \`
                <div class="profile-card" style="animation: fadeUp 0.5s">
                    <img src="\${d.ppUrl}" class="pc-img">
                    
                    <div class="pc-name">\${d.name}</div>
                    <div style="margin-bottom:15px">\${typeBadge}</div>
                    
                    <div class="pc-jid">+\${d.number}</div>

                    <div class="pc-grid">
                        <div class="pc-row"><span>Info Tanggal</span><span class="pc-val" style="max-width:60%; text-align:right">\${d.status}</span></div>
                        <div class="pc-row"><span>Info Tentang</span><span class="pc-val">\${d.statusDate}</span></div>
                        
                        <!-- Info Khusus -->
                        \${d.address !== '-' ? \`<div class="pc-row"><span>Alamat</span><span class="pc-val">\${d.address}</span></div>\` : ''}
                        \${d.category !== '-' ? \`<div class="pc-row"><span>Kategori</span><span class="pc-val">\${d.category}</span></div>\` : ''}
                        \${d.website !== '-' ? \`<div class="pc-row"><span>Website</span><span class="pc-val"><a href="\${d.website}" target="_blank">\${d.website}</a></span></div>\` : ''}
                        \${d.email !== '-' ? \`<div class="pc-row"><span>Email</span><span class="pc-val">\${d.email}</span></div>\` : ''}
                    </div>
                </div>\`;
            } else {
                // Tampilan Gagal / Tidak Aktif
                res.innerHTML = \`
                <div style="background:var(--bg-card); padding:20px; border-radius:12px; border:1px solid var(--danger); text-align:center; margin-top:15px; animation: fadeUp 0.5s">
                    <div style="font-size:40px; margin-bottom:10px">❌</div>
                    <h3 style="color:var(--danger)">Nomor Tidak Ditemukan</h3>
                    <p style="color:var(--text-sec); font-size:13px; margin-top:5px">
                        Nomor <b>\${ph}</b> tidak terdaftar di WhatsApp atau sedang tidak aktif/diblokir.
                    </p>
                </div>\`;
            }
        }
        
        // --- DOWNLOADER ---
        async function doDownload(type) {
            const url = document.getElementById('dlUrl').value;
            const res = document.getElementById('dlResult');
            const b1 = document.getElementById('btnMp4');
            const b2 = document.getElementById('btnMp3');
            
            if(!url) return alert('Masukkan URL!');
            b1.disabled=true; b2.disabled=true;
            res.innerHTML = '<div style="color:var(--text-sec)">Sedang memproses...</div>';

            const d = await post('/api/download', {url, type});
            b1.disabled=false; b2.disabled=false;
            
            if(d.success && d.data) {
                res.innerHTML = \`
                <div style="margin-top:20px; animation:fadeUp 0.5s">
                    <img src="\${d.data.thumbnail}" style="width:100%; max-width:300px; border-radius:12px; box-shadow:var(--shadow-float); margin-bottom:15px">
                    <h4 style="margin-bottom:10px; color:var(--text-pri)">\${d.data.title}</h4>
                    <a href="\${d.data.url}" target="_blank" class="btn btn-primary">DOWNLOAD FILE</a>
                </div>\`;
            } else {
                res.innerHTML = '<div style="color:var(--danger)">Gagal mengambil media.</div>';
            }
        }
        
        async function loadRVO() {
            const grid = document.getElementById('rvoGrid');
            grid.innerHTML = '<p>Memuat...</p>';
            const d = await post('/api/list-media', { type: 'rvo' });
            grid.innerHTML = '';
            
            if(d.success && d.data.length > 0) {
                d.data.reverse().forEach(item => {
                    let content = item.file.endsWith('.mp4') 
                        ? \`<video src="\${item.url}" controls style="width:100%; border-radius:10px"></video>\` 
                        : \`<img src="\${item.url}" style="width:100%; border-radius:10px; cursor:pointer" onclick="window.open('\${item.url}')">\`;
                    
                    grid.innerHTML += \`
                    <div class="card" style="padding:10px; margin:0">
                        \${content}
                        <div style="font-size:11px; color:var(--text-sec); margin-top:5px">
                            <b>\${item.sender}</b><br>\${new Date(item.time).toLocaleString()}
                        </div>
                        <a href="\${item.url}" download class="btn btn-primary" style="width:100%; padding:5px; font-size:11px; margin-top:5px">Simpan</a>
                    </div>\`;
                });
            } else { grid.innerHTML = '<p style="color:var(--text-sec)">Belum ada media RVO.</p>'; }
        }
        // --- BOT ACTIONS ---
        async function act(ph, action) {
            if(action==='delete' && !confirm('Hapus bot ini?')) return;
            await post('/api/'+action+'/'+ph, {}); loadData();
        }

        async function reqPair() {
            const ph = document.getElementById('botPhone').value;
            const d = await post('/api/add', {phone:ph});
            if(d.success) {
                document.getElementById('step1').style.display='none';
                document.getElementById('step2').style.display='block';
                const i = setInterval(async()=>{
                    const r = await(await fetch('/api/code/'+d.phone)).json();
                    if(r.code) {
                        document.getElementById('codeDisplay').innerText = r.code;
                        if(r.code === 'CONNECTED') { clearInterval(i); alert('Terhubung!'); closeModal('addModal'); loadData(); }
                    }
                }, 2000);
            } else alert(d.message);
        }
        function copyCode() { navigator.clipboard.writeText(document.getElementById('codeDisplay').innerText); alert('Kode disalin'); }

        // --- DATA LOADER ---        
        async function loadStatus() {
            const grid = document.getElementById('statusGrid');
            grid.innerHTML = '<p>Memuat...</p>';
            const d = await post('/api/list-media', { type: 'status' });
            grid.innerHTML = '';

            if(d.success && d.data.length > 0) {
                d.data.reverse().forEach(item => {
                    let content = item.file.endsWith('.mp4') 
                        ? \`<video src="\${item.url}" controls style="width:100%; border-radius:10px"></video>\` 
                        : \`<img src="\${item.url}" style="width:100%; border-radius:10px; cursor:pointer" onclick="window.open('\${item.url}')">\`;
                    
                    grid.innerHTML += \`
                    <div class="card" style="padding:10px; margin:0">
                        \${content}
                        <div style="font-size:11px; color:var(--text-sec); margin-top:5px">
                            <b>\${item.sender}</b><br>\${new Date(item.time).toLocaleString()}
                        </div>
                        <a href="\${item.url}" download class="btn btn-primary" style="width:100%; padding:5px; font-size:11px; margin-top:5px">Simpan</a>
                    </div>\`;
                });
            } else { grid.innerHTML = '<p style="color:var(--text-sec)">Belum ada status tersimpan.</p>'; }
        }
        
        
        async function loadData() {
            const r = await fetch('/api/data');
            if(r.status === 401) { document.getElementById('authModal').classList.add('active'); return; }
            const d = await r.json();
            
            document.getElementById('uName').innerText = d.user;
            document.getElementById('uInit').innerText = d.user.charAt(0);
            document.getElementById('stBot').innerText = d.activeBots.length;
            document.getElementById('stSesi').innerText = d.sessions.length;

            const list = document.getElementById('botList');
            list.innerHTML = '';
            
            if(d.sessions.length === 0) list.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text-sec)">Belum ada bot tertaut.</div>';

            d.sessions.forEach(s => {
                const m = d.meta[s] || {};
                if(d.role !== 'admin' && m.owner !== d.user) return;
                
                const isOn = d.activeBots.includes(s);
                let status = isOn ? '<span class="badge bg-on">ONLINE</span>' : (m.active ? '<span class="badge bg-off">OFFLINE</span>' : '<span class="badge bg-wait">PENDING</span>');
                let trial = m.isTrial ? '<span class="badge" style="background:rgba(51, 153, 255, 0.2); color:#3399ff; margin-right:5px">TRIAL</span>' : '';

                let btns = '';
                if(d.role === 'admin') {
                    if(isOn) btns = \`<button onclick="act('\${s}','stop')" class="btn btn-sec" style="padding:6px 12px; font-size:12px">Stop</button> <button onclick="act('\${s}','restart')" class="btn btn-sec" style="padding:6px 12px; font-size:12px">Restart</button>\`;
                    else btns = \`<button onclick="act('\${s}','start')" class="btn btn-primary" style="padding:6px 12px; font-size:12px">Start/Acc</button>\`;
                    btns += \`<button onclick="act('\${s}','delete')" class="btn btn-danger" style="padding:6px 12px; font-size:12px; margin-left:5px">Hapus</button>\`;
                    if(!m.isTrial && !isOn) btns += \`<button onclick="act('\${s}','trial')" class="btn btn-sec" style="padding:6px 12px; font-size:12px; margin-left:5px">Trial</button>\`;
                } else {
                    if(isOn) btns = \`<button onclick="act('\${s}','restart')" class="btn btn-sec" style="padding:6px 12px; font-size:12px">Restart</button>\`;
                    else if(m.active) btns = \`<button onclick="act('\${s}','start')" class="btn btn-primary" style="padding:6px 12px; font-size:12px">Start Bot</button>\`;
                    else btns = '<span style="font-size:12px; color:var(--text-sec)">Menunggu Admin</span>';
                    
                    btns += \`<button onclick="act('\${s}','delete')" class="btn btn-danger" style="padding:6px 12px; font-size:12px; margin-left:5px">Hapus</button>\`;
                }

                list.innerHTML += \`
                <div class="bot-row">
                    <div>
                        <h4 style="color:var(--text-pri)">+\${s}</h4>
                        <span style="color:var(--text-sec); font-size:13px">Owner: \${m.owner}</span>
                    </div>
                    <div style="text-align:right; display:flex; flex-direction:column; align-items:flex-end; gap:5px">
                        <div>\${trial} \${status}</div>
                        <div style="margin-top:4px">\${btns}</div>
                    </div>
                </div>\`;
            });
        }

        loadData();
        setInterval(() => { if(document.getElementById('authModal').style.display !== 'flex') loadData(); }, 5000);
        
        // Inisialisasi animasi saat pertama load
document.addEventListener('DOMContentLoaded', function() {
    const svgElement = document.querySelector('.whatsapp-title-svg');
    const iconPathElement = document.querySelector('.title-icon-bubble');
    const pulseRing = document.querySelector('.title-pulse-ring');
    
    if (svgElement && iconPathElement) {
        // Set animasi default untuk dashboard
        svgElement.style.animation = 'titleFloat 3s ease-in-out infinite';
        iconPathElement.style.animation = 'homeBounce 2s infinite';
        
        if (pulseRing) {
            pulseRing.style.animation = 'titlePulse 2s infinite';
        }
    }
});

    </script>
</body>
</html>
`;

// ====================================================
// HTTP SERVER (MODIFIED FOR AUTO-RESTART)
// ====================================================

// Buat HTTP server
function createHttpServer() {
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://localhost:${serverPort}`);
        const ext = path.extname(url.pathname);
        
        // Header CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        const send = (d, s=200) => { 
            res.writeHead(s, {'Content-Type':'application/json'}); 
            res.end(JSON.stringify(d)); 
        };
        
        if (req.method === 'OPTIONS') { 
            res.writeHead(204); 
            res.end(); 
            return; 
        }

        // HEALTH CHECK ENDPOINT
        if (url.pathname === '/health') {
            const status = {
                status: 'healthy',
                uptime: process.uptime(),
                tunnel_url: tunnelUrl,
                server_port: serverPort,
                active_bots: activeBots.size,
                active_sessions: activeSessions.size,
                last_check: new Date().toISOString()
            };
            return send(status);
        }

        // STATIC FILES
        if (url.pathname.startsWith('/public/') && fs.existsSync('.' + url.pathname)) {
            const mime = { '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.json': 'application/json' };
            res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
            fs.createReadStream('.' + url.pathname).pipe(res);
            return;
        }

        // 2. HALAMAN UTAMA (FRONTEND)
    if (url.pathname === '/') { 
        res.writeHead(200, {'Content-Type':'text/html'}); 
        res.end(getHTML()); 
        return;
    }
        
        // ... (SISA ROUTING API ANDA TETAP SAMA)
        // API AUTHENTICATION
        else if (url.pathname === '/api/register' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    
    req.on('end', () => {
        try {
            const { user, pass } = JSON.parse(body);
            
            // Validasi input
            if (!user || !pass) {
                return send({ success: false, message: 'Username dan password harus diisi' }, 400);
            }
            
            if (user.length < 3) {
                return send({ success: false, message: 'Username minimal 3 karakter' }, 400);
            }
            
            if (pass.length < 4) {
                return send({ success: false, message: 'Password minimal 4 karakter' }, 400);
            }
            
            // Pastikan usersDB adalah array
            if (!Array.isArray(usersDB)) {
                console.error('usersDB is not an array during registration');
                usersDB = [];
            }
            
            // Cek apakah username sudah ada
            const userExists = usersDB.some(u => u.user === user);
            if (userExists) {
                return send({ success: false, message: 'Username sudah terdaftar' }, 400);
            }
            
            // Tambahkan user baru
            const newUser = {
                user: user,
                pass: pass,
                createdAt: new Date().toISOString(),
                role: 'user'
            };
            
            usersDB.push(newUser);
            saveUsers();
            
            console.log('New user registered:', user);
                    
                    const token = generateToken();
            activeSessions.set(token, { role: 'user', user: user });
            
            res.writeHead(200, {
                'Set-Cookie': `auth_token=${token}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax`,
                'Content-Type': 'application/json'
            });
            
            res.end(JSON.stringify({ 
                success: true, 
                message: 'Registrasi berhasil!',
                user: user 
            }));
            
        } catch (error) {
            console.error('Register error:', error);
            send({ success: false, message: 'Gagal mendaftar. Coba lagi.' }, 500);
        }
    });
}

// API CHECK USERNAME
else if (url.pathname === '/api/check-username' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    
    req.on('end', () => {
        try {
            const { username } = JSON.parse(body);
            
            if (!username || username.length < 3) {
                return send({ available: false, message: 'Username terlalu pendek' });
            }
            
            // Cek ketersediaan
            const exists = Array.isArray(usersDB) && usersDB.some(u => u.user === username);
            
            if (exists) {
                return send({ available: false, message: 'Username sudah digunakan' });
            }
            
            send({ available: true, message: 'Username tersedia' });
            
        } catch (error) {
            send({ available: false, message: 'Error checking username' });
        }
    });
}

else if (url.pathname === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    
    req.on('end', () => {
        try {
            const { user, pass } = JSON.parse(body);
            
            // Pastikan usersDB adalah array
            if (!Array.isArray(usersDB)) {
                console.error('usersDB is not an array:', usersDB);
                usersDB = [];
                saveUsers();
                return send({ success: false, message: 'Database error. Please try again.' }, 500);
            }
            
            // Cek Admin
            if (user === 'admin' && pass === '098765') {
                const token = generateToken();
                activeSessions.set(token, { role: 'admin', user: user });
                
                res.writeHead(200, {
                    'Set-Cookie': `auth_token=${token}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax`,
                    'Content-Type': 'application/json'
                });
                res.end(JSON.stringify({ success: true, user: user }));
                return;
            }
            
            // Cek User biasa
            const foundUser = usersDB.find(u => u.user === user && u.pass === pass);
            
            if (foundUser) {
                const token = generateToken();
                activeSessions.set(token, { role: 'user', user: user });
                
                res.writeHead(200, {
                    'Set-Cookie': `auth_token=${token}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax`,
                    'Content-Type': 'application/json'
                });
                res.end(JSON.stringify({ success: true, user: user }));
            } else {
                send({ success: false, message: 'Username atau password salah' }, 401);
            }
            
        } catch (parseError) {
            console.error('Login parse error:', parseError);
            send({ success: false, message: 'Format data tidak valid' }, 400);
        }
    });
}

// Tambahkan di API routes
else if (url.pathname === '/api/reset-db' && req.method === 'POST') {
    const s = getSessionInfo(req);
    if(!s || s.role !== 'admin') return send({}, 403);
    
    try {
        usersDB = [];
        saveUsers();
        send({ success: true, message: 'Database reset successful' });
    } catch (e) {
        send({ success: false, message: 'Reset failed: ' + e.message });
    }
}

    // 4. API DASHBOARD DATA
    else if (url.pathname === '/api/data') {
        const s = getSessionInfo(req); 
        if(!s) return send({}, 401);
        send({
            user: s.user, 
            role: s.role, 
            sessions: getSessions(), 
            meta: botsMeta, 
            activeBots: Array.from(activeBots.keys())
        });
    }
// 5. API LIST MEDIA (RVO & STATUS)
    // Note: Karena bot.js baru mengirim ke chat WA, array ini mungkin kosong, 
    // tapi endpoint tetap dibiarkan agar frontend tidak error.
    else if (url.pathname === '/api/list-media' && req.method === 'POST') {
        const s = getSessionInfo(req); 
        if(!s) return send({}, 401);
        let b=''; req.on('data', c=>b+=c); req.on('end', () => {
            try {
                const { type } = JSON.parse(b); // type = 'rvo' atau 'status'
                const jsonFile = path.join(__dirname, type + '.json');
                let data = [];
                // Hanya baca jika file ada
                if (fs.existsSync(jsonFile)) { 
                    try { data = JSON.parse(fs.readFileSync(jsonFile)); } catch {} 
                }
                send({ success: true, data: data });
            } catch(e) { send({ success: false, data: [] }); }
        });
    }

    // 6. API CEK NOMOR (IPC ke Bot)
    else if (url.pathname === '/api/check-number' && req.method === 'POST') {
        const s = getSessionInfo(req); 
        if(!s) return send({}, 401);
        
        let b=''; req.on('data', c=>b+=c); req.on('end', async ()=>{
            try {
                const { target } = JSON.parse(b);
                const pTarget = normalizePhone(target);
                
                // Cari bot aktif milik user, atau pinjam bot manapun jika admin
                let botSession = Array.from(activeBots.keys()).find(b => botsMeta[b]?.owner === s.user);
                // Fallback: Jika user tidak punya bot aktif, pakai bot pertama yg ada (optional)
                if(!botSession && activeBots.size > 0) botSession = Array.from(activeBots.keys())[0];
                
                if(!botSession) return send({success:false, message: 'Silahkan hubungkan WhatsApp terlebih dahulu untuk melakukan Stalking.'});
                
                const child = activeBots.get(botSession);
                const requestId = crypto.randomBytes(8).toString('hex');
                
                // Buat Promise timeout 15 detik
                const checkPromise = new Promise((resolve) => {
                    checkRequests.set(requestId, resolve);
                    setTimeout(() => {
                        if(checkRequests.has(requestId)) {
                            checkRequests.delete(requestId);
                            resolve(null); // Timeout
                        }
                    }, 15000);
                });

                // Kirim perintah ke Bot via IPC
                if (child.send) {
                    child.send({ type: 'CHECK_NUMBER', target: pTarget, requestId: requestId });
                    const result = await checkPromise;
                    
                    if(result) send({success:true, data: result});
                    else send({success:false, message: 'Bot tidak merespon (Timeout) atau nomor invalid.'});
                } else {
                    send({success:false, message: 'Gagal komunikasi internal dengan Bot.'});
                }
            } catch (e) { send({success:false, message: 'Server Error'}); }
        });
    }

    // 7. API DOWNLOADER
    else if (url.pathname === '/api/download' && req.method === 'POST') {
        const s = getSessionInfo(req); if(!s) return send({}, 401);
        let b=''; req.on('data', c=>b+=c); req.on('end', async ()=>{
            try {
                const { url, type } = JSON.parse(b);
                if(!url) return send({success:false, message: 'URL kosong'});
                const data = await fetchMediaData(url, type || 'mp4'); 
                if (data) send({success:true, data: data});
                else send({success:false, message: 'Gagal mengambil media. Coba lagi.'});
            } catch (e) { send({success:false, message: 'Server Error'}); }
        });
    }

    // 8. API MANAJEMEN BOT (Add, Code, Start, Stop, Delete)
    else if (url.pathname === '/api/add' && req.method === 'POST') {
        const s = getSessionInfo(req); if(!s) return send({}, 401);
        let b=''; req.on('data', c=>b+=c); req.on('end', ()=>{
            try {
                const {phone} = JSON.parse(b); 
                send(addSession(phone, s.user));
            } catch(e) { send({success:false}); }
        });
    }
    else if (url.pathname.startsWith('/api/code/')) {
        if(!isAuthenticated(req)) return send({}, 401);
        const p = url.pathname.split('/').pop();
        send({code: pairingCodes.get(p) || 'WAITING'});
    }
    else if (url.pathname.startsWith('/api/trial/')) {
        const s = getSessionInfo(req); 
        if(!s || s.role!=='admin') return send({}, 403);
        const p = url.pathname.split('/').pop();
        if(botsMeta[p]) { 
            botsMeta[p].active=true; 
            botsMeta[p].isTrial=true; 
            botsMeta[p].trialEnd=Date.now()+(3*24*60*60*1000); // 3 Hari Trial
            saveBotMeta(); 
        }
        send(startBotProcess(p));
    }
    else if (url.pathname.startsWith('/api/start/')) {
        const s = getSessionInfo(req); if(!s) return send({}, 401);
        const p = url.pathname.split('/').pop();
        if(s.role==='admin' || botsMeta[p]?.owner===s.user) {
            // Auto activate jika admin yang start
            if(s.role==='admin' && botsMeta[p]) { botsMeta[p].active=true; saveBotMeta(); }
            send(startBotProcess(p));
        } else send({}, 403);
    }
    else if (url.pathname.startsWith('/api/stop/')) {
        const s = getSessionInfo(req); if(!s) return send({}, 401);
        const p = url.pathname.split('/').pop();
        if(s.role==='admin' || botsMeta[p]?.owner===s.user) send(stopBotProcess(p)); 
        else send({}, 403);
    }
    else if (url.pathname.startsWith('/api/restart/')) {
        const s = getSessionInfo(req); if(!s) return send({}, 401);
        const p = url.pathname.split('/').pop();
        if(s.role==='admin' || botsMeta[p]?.owner===s.user) {
            stopBotProcess(p); 
            setTimeout(()=>send(startBotProcess(p)), 2000); // Delay sedikit biar proses kill selesai
        } else send({}, 403);
    }
    else if (url.pathname.startsWith('/api/delete/')) {
        const s = getSessionInfo(req); if(!s) return send({}, 401);
        const p = url.pathname.split('/').pop();
        if(s.role==='admin' || botsMeta[p]?.owner===s.user) send(deleteSession(p)); 
        else send({}, 403);
    }
    else { 
        res.writeHead(404); 
        res.end(JSON.stringify({message: 'Not Found'})); 
    }
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
        
        // Buat HTTP server
        httpServer = createHttpServer();
        
        // Start HTTP server dengan port random
        serverPort = await new Promise((resolve, reject) => {
            httpServer.listen(PORT, '127.0.0.1', () => {
                const port = httpServer.address().port;
                console.log(`🌐 HTTP Server running on port ${port}`);
                resolve(port);
            });
            
            httpServer.on('error', reject);
        });
        
        // Start Cloudflare Tunnel
        await startCloudflaredTunnel(serverPort);
        
        // Start health monitoring
        startHealthMonitoring();
        
        // Setup graceful shutdown
        setupGracefulShutdown();
        
        console.log('\n' + '='.repeat(60));
        console.log('✅ SERVER READY - AUTO-RESTART ENABLED');
        console.log('='.repeat(60));
        console.log(`📡 Public URL: ${tunnelUrl}`);
        console.log(`🔧 Internal Port: ${serverPort}`);
        console.log(`🔄 Health Check: Every ${HEALTH_CHECK_INTERVAL/1000}s`);
        console.log(`🛡️ Max Retries: ${MAX_RETRIES}`);
        console.log('='.repeat(60) + '\n');
        
    } catch (error) {
        console.error('❌ Failed to initialize server:', error.message);
        throw error;
    }
}

// Banner display
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
║           CLOUDFLARE TUNNEL WITH AUTO-RESTART               ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
    `);
}

// ====================================================
// CHECK CLOUDFLARED INSTALLATION
// ====================================================

(async () => {
    try {
        
        // Initialize server
        await initializeServer();
        
        // Start with retry mechanism
        let attempts = 0;
        const maxAttempts = 3;
        
        while (attempts < maxAttempts) {
            try {
                await new Promise((resolve, reject) => {
                    // Server already running from initializeServer()
                    const checkInterval = setInterval(async () => {
                        if (tunnelUrl) {
                            clearInterval(checkInterval);
                            resolve();
                        }
                    }, 1000);
                    
                    // Timeout
                    setTimeout(() => {
                        clearInterval(checkInterval);
                        reject(new Error('Server startup timeout'));
                    }, 60000);
                });
                break; // Success
                
            } catch (error) {
                attempts++;
                console.error(`❌ Startup attempt ${attempts} failed:`, error.message);
                
                if (attempts < maxAttempts) {
                    console.log(`🔄 Retrying in 5 seconds...`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    await restartServer();
                } else {
                    console.error('💀 Max startup attempts reached. Exiting.');
                    process.exit(1);
                }
            }
        }
        
    } catch (error) {
        console.error('Fatal error:', error);
        process.exit(1);
    }
})();
