#!/usr/bin/env node
/**
 * Auto-start script untuk Cloudflare Pages
 * Menjalankan server.js dan memastikan tetap hidup
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

console.log('🚀 WhatsApp Bot Server - Auto Starter');
console.log('=====================================\n');

// Konfigurasi
const CONFIG = {
  BIN_ID: process.env.BIN_ID || '693151eed0ea881f40121ca6',
  JSONBIN_KEY: process.env.JSONBIN_KEY || '$2a$10$u00Qvq6xrri32tc7bEYVhuQv94XS.ygeVCr70UDbzoOVlR8yLuUq.',
  MAIN_URL: process.env.MAIN_URL || 'https://xgenzy.github.io/RVO/',
  PORT: process.env.PORT || 3000,
  NODE_PATH: process.env.NODE_PATH || 'node'
};

// Cek dependencies
function checkDependencies() {
  console.log('🔍 Checking dependencies...');
  
  try {
    // Cek node version
    const nodeVersion = execSync('node --version').toString().trim();
    console.log(`✓ Node.js: ${nodeVersion}`);
    
    // Cek npm
    const npmVersion = execSync('npm --version').toString().trim();
    console.log(`✓ npm: ${npmVersion}`);
    
    // Cek apakah server.js ada
    if (!fs.existsSync(path.join(__dirname, 'server.js'))) {
      throw new Error('server.js not found!');
    }
    console.log('✓ server.js: Found');
    
    // Cek package.json
    if (!fs.existsSync(path.join(__dirname, 'package.json'))) {
      console.log('⚠️ package.json not found, creating default...');
      createDefaultPackage();
    }
    
    // Cek apakah cloudflared tersedia
    try {
      execSync('cloudflared --version', { stdio: 'ignore' });
      console.log('✓ cloudflared: Available');
    } catch {
      console.log('⚠️ cloudflared: Not available in PATH');
      console.log('   Download from: https://github.com/cloudflare/cloudflared/releases');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Dependency check failed:', error.message);
    return false;
  }
}

// Buat package.json default jika tidak ada
function createDefaultPackage() {
  const defaultPackage = {
    name: "whatsapp-bot-server",
    version: "1.0.0",
    main: "autostart.js",
    scripts: {
      start: "node autostart.js",
      server: "node server.js"
    },
    dependencies: {
      "express": "^4.18.2",
      "node-fetch": "^2.6.7"
    }
  };
  
  fs.writeFileSync(
    path.join(__dirname, 'package.json'),
    JSON.stringify(defaultPackage, null, 2)
  );
}

// Install dependencies jika diperlukan
function installDependencies() {
  console.log('\n📦 Installing dependencies...');
  
  try {
    if (!fs.existsSync(path.join(__dirname, 'node_modules'))) {
      console.log('Installing npm packages...');
      execSync('npm install', { stdio: 'inherit', cwd: __dirname });
      console.log('✓ Dependencies installed');
    } else {
      console.log('✓ node_modules already exists');
    }
    return true;
  } catch (error) {
    console.error('❌ Failed to install dependencies:', error.message);
    return false;
  }
}

// Start server dengan restart otomatis
function startServer() {
  console.log('\n▶️  Starting server...');
  
  const serverArgs = ['server.js'];
  
  // Tambah environment variables
  const env = {
    ...process.env,
    BIN_ID: CONFIG.BIN_ID,
    JSONBIN_KEY: CONFIG.JSONBIN_KEY,
    MAIN_URL: CONFIG.MAIN_URL,
    PORT: CONFIG.PORT,
    NODE_ENV: 'production'
  };
  
  let restartCount = 0;
  const MAX_RESTARTS = 10;
  let serverProcess;
  
  function spawnServer() {
    console.log(`\n🔄 Starting server (Attempt ${restartCount + 1}/${MAX_RESTARTS})...`);
    
    serverProcess = spawn(CONFIG.NODE_PATH, serverArgs, {
      stdio: 'inherit',
      shell: true,
      env: env,
      cwd: __dirname
    });
    
    serverProcess.on('error', (err) => {
      console.error('❌ Server process error:', err.message);
      scheduleRestart();
    });
    
    serverProcess.on('exit', (code, signal) => {
      console.log(`⚠️  Server exited with code ${code}`);
      
      if (code === 0 || code === null) {
        console.log('Server stopped gracefully');
        process.exit(0);
      } else {
        console.log(`Server crashed or was terminated`);
        scheduleRestart();
      }
    });
  }
  
  function scheduleRestart() {
    restartCount++;
    
    if (restartCount >= MAX_RESTARTS) {
      console.error(`❌ Maximum restart attempts (${MAX_RESTARTS}) reached`);
      console.log('Please check the server configuration and try again');
      process.exit(1);
    }
    
    const delay = Math.min(30000, restartCount * 2000); // Max 30 second delay
    console.log(`⏳ Restarting in ${delay/1000} seconds...`);
    
    setTimeout(() => {
      spawnServer();
    }, delay);
  }
  
  // Tangani sinyal system
  process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT, shutting down...');
    if (serverProcess) serverProcess.kill('SIGINT');
    process.exit(0);
  });
  
  process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM, shutting down...');
    if (serverProcess) serverProcess.kill('SIGTERM');
    process.exit(0);
  });
  
  // Start pertama
  spawnServer();
}

// Main function
async function main() {
  console.clear();
  
  // Tampilkan banner
  console.log(`
╔══════════════════════════════════════════════════╗
║    WhatsApp Bot Server - Cloudflare Pages        ║
║          Auto Start with Cloudflared             ║
╚══════════════════════════════════════════════════╝
  `);
  
  // Check environment
  console.log('📊 Environment:');
  console.log(`- BIN_ID: ${CONFIG.BIN_ID ? 'Set' : 'Not set'}`);
  console.log(`- JSONBIN_KEY: ${CONFIG.JSONBIN_KEY ? 'Set' : 'Not set'}`);
  console.log(`- PORT: ${CONFIG.PORT}`);
  console.log(`- MAIN_URL: ${CONFIG.MAIN_URL}`);
  
  // Jalankan proses
  if (!checkDependencies()) {
    process.exit(1);
  }
  
  if (!installDependencies()) {
    console.log('⚠️  Continuing with existing dependencies...');
  }
  
  // Jalankan server
  startServer();
}

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
  console.log('Restarting...');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
});

// Mulai
main().catch(console.error);
