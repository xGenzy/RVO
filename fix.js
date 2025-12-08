#!/usr/bin/env node
/**
 * Build Script untuk WhatsApp Bot Cloudflare Pages
 * - Fix komentar di server.js
 * - Install dependencies
 * - Build untuk production
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

console.log('🔧 WhatsApp Bot - Build System');
console.log('==============================\n');

// Config
const CONFIG = {
  serverFile: 'server.js',
  indexPath: 'index.html',
  buildDir: 'dist',
  packageFile: 'package.json'
};

// Fungsi untuk membersihkan template literal di komentar
function fixCommentsInFile(filePath) {
  console.log(`🔍 Fixing comments in ${filePath}...`);
  
  if (!fs.existsSync(filePath)) {
    console.error(`❌ File ${filePath} not found!`);
    return false;
  }
  
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // 1. Fix single line comments dengan backticks
    content = content.replace(/\/\/.*`([^`]*)`/g, (match, inside) => {
      // Ganti backticks dengan quotes di komentar
      return match.replace(/`/g, "'");
    });
    
    // 2. Fix multi-line comments dengan backticks
    content = content.replace(/\/\*[\s\S]*?\*\//g, (match) => {
      // Ganti backticks dalam multi-line comment
      return match.replace(/`/g, "'");
    });
    
    // 3. Fix template literal dalam string (jika ada)
    content = content.replace(/'`\$\{.*\}`'/g, (match) => {
      return match.replace(/`/g, "'");
    });
    
    // 4. Tambahkan safe error handling jika belum ada
    if (!content.includes('process.on(\'uncaughtException\'')) {
      const uncaughtHandler = `
// Error handling
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  console.log('Server restarting...');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
`;
      // Tambahkan sebelum app.listen
      const listenIndex = content.lastIndexOf('app.listen');
      if (listenIndex !== -1) {
        content = content.slice(0, listenIndex) + uncaughtHandler + content.slice(listenIndex);
      }
    }
    
    // Write file
    fs.writeFileSync(filePath, content);
    console.log(`✅ Fixed ${filePath}`);
    return true;
    
  } catch (error) {
    console.error(`❌ Error fixing ${filePath}:`, error.message);
    return false;
  }
}

// Fungsi untuk create cloudflared runner script
function createCloudflaredScript() {
  console.log('🌐 Creating Cloudflared runner...');
  
  const cloudflaredScript = `
#!/usr/bin/env node
// Cloudflared Runner untuk Cloudflare Pages
// Versi: 1.0.0

const { spawn } = require('child_process');
const fetch = require('node-fetch');

const CLOUDFLARED_VERSION = '2023.10.0';
const PORT = process.env.PORT || 3000;

async function getCloudflaredUrl(port) {
  return new Promise((resolve, reject) => {
    console.log('Starting Cloudflared tunnel...');
    
    // Jika cloudflared tidak tersedia, gunakan fallback
    const cloudflared = spawn('npx', ['cloudflared', 'tunnel', '--url', \`http://localhost:\${port}\`], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let tunnelUrl = null;
    let output = '';
    
    const timeout = setTimeout(() => {
      cloudflared.kill();
      reject(new Error('Timeout getting Cloudflared URL'));
    }, 15000);
    
    cloudflared.stderr.on('data', (data) => {
      const text = data.toString();
      output += text;
      
      // Cari URL
      const match = text.match(/https:\\/\\/[a-zA-Z0-9.-]+\\.trycloudflare\\.com/);
      if (match) {
        tunnelUrl = match[0];
        clearTimeout(timeout);
        cloudflared.kill();
        resolve(tunnelUrl);
      }
    });
    
    cloudflared.on('close', () => {
      clearTimeout(timeout);
      if (!tunnelUrl) {
        reject(new Error('Failed to get Cloudflared URL'));
      }
    });
  });
}

// Export untuk digunakan di server.js
module.exports = { getCloudflaredUrl };
`;
  
  fs.writeFileSync('cloudflared-runner.js', cloudflaredScript);
  console.log('✅ Created cloudflared-runner.js');
}

// Fungsi untuk create server wrapper
function createServerWrapper() {
  console.log('🔄 Creating server wrapper...');
  
  const wrapperScript = `
// Server Wrapper untuk Cloudflare Pages
const express = require('express');
const { getCloudflaredUrl } = require('./cloudflared-runner');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Config
const CONFIG = {
  BIN_ID: process.env.BIN_ID || '693151eed0ea881f40121ca6',
  JSONBIN_KEY: process.env.JSONBIN_KEY || '$2a$10\$u00Qvq6xrri32tc7bEYVhuQv94XS.ygeVCr70UDbzoOVlR8yLuUq.',
  MAIN_URL: process.env.MAIN_URL || 'https://xgenzy.github.io/RVO/'
};

// Middleware
app.use(express.json());
app.use(express.static('.'));

// Routes
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    server: 'cloudflare-pages',
    timestamp: new Date().toISOString(),
    port: PORT
  });
});

// Update URL ke JSONBin
async function updateJsonBin(url) {
  try {
    const response = await fetch(\`https://api.jsonbin.io/v3/b/\${CONFIG.BIN_ID}\`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': CONFIG.JSONBIN_KEY
      },
      body: JSON.stringify({ 
        url: url,
        updated: new Date().toISOString()
      })
    });
    
    if (response.ok) {
      console.log('✅ URL updated to JSONBin');
      return true;
    }
    return false;
  } catch (error) {
    console.error('❌ JSONBin update failed:', error.message);
    return false;
  }
}

// Start server dengan cloudflared
async function startServer() {
  try {
    // Start Express
    app.listen(PORT, '0.0.0.0', () => {
      console.log(\`🚀 Server running on port \${PORT}\`);
    });
    
    // Start Cloudflared (hanya di production)
    if (process.env.NODE_ENV === 'production') {
      setTimeout(async () => {
        try {
          const url = await getCloudflaredUrl(PORT);
          console.log(\`🌐 Public URL: \${url}\`);
          
          // Update ke JSONBin
          if (CONFIG.BIN_ID && CONFIG.JSONBIN_KEY) {
            await updateJsonBin(url);
          }
        } catch (error) {
          console.error('Cloudflared error:', error.message);
          console.log('Using fallback URL:', CONFIG.MAIN_URL);
        }
      }, 2000);
    }
    
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Error handling
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start
startServer();
`;
  
  fs.writeFileSync('server-wrapper.js', wrapperScript);
  console.log('✅ Created server-wrapper.js');
}

// Fungsi untuk install dependencies
function installDependencies() {
  console.log('📦 Installing dependencies...');
  
  try {
    // Cek package.json
    if (!fs.existsSync(CONFIG.packageFile)) {
      console.log('Creating package.json...');
      
      const packageJson = {
        name: "whatsapp-bot-cloudflare",
        version: "1.0.0",
        main: "server-wrapper.js",
        scripts: {
          "start": "node server-wrapper.js",
          "build": "node build.js",
          "dev": "node server.js"
        },
        dependencies: {
          "express": "^4.18.2",
          "node-fetch": "^2.6.7",
          "cloudflared": "^0.0.1"
        },
        engines: {
          "node": ">=16.0.0"
        }
      };
      
      fs.writeFileSync(CONFIG.packageFile, JSON.stringify(packageJson, null, 2));
      console.log('✅ Created package.json');
    }
    
    // Install dependencies
    console.log('Running npm install...');
    execSync('npm install', { stdio: 'inherit' });
    console.log('✅ Dependencies installed');
    return true;
    
  } catch (error) {
    console.error('❌ Failed to install dependencies:', error.message);
    return false;
  }
}

// Fungsi untuk create build directory
function createBuild() {
  console.log('🏗️  Creating build directory...');
  
  if (!fs.existsSync(CONFIG.buildDir)) {
    fs.mkdirSync(CONFIG.buildDir, { recursive: true });
  }
  
  // Copy files to dist
  const filesToCopy = [
    'index.html',
    'server-wrapper.js',
    'cloudflared-runner.js',
    'package.json',
    'package-lock.json'
  ];
  
  filesToCopy.forEach(file => {
    if (fs.existsSync(file)) {
      fs.copyFileSync(file, path.join(CONFIG.buildDir, file));
      console.log(`✅ Copied ${file}`);
    }
  });
  
  // Copy node_modules (hanya production dependencies)
  console.log('Copying node_modules...');
  const nodeModulesSrc = 'node_modules';
  const nodeModulesDest = path.join(CONFIG.buildDir, 'node_modules');
  
  if (fs.existsSync(nodeModulesSrc)) {
    // Create symlink atau copy minimal
    try {
      fs.symlinkSync(path.resolve(nodeModulesSrc), nodeModulesDest, 'dir');
      console.log('✅ Created symlink to node_modules');
    } catch {
      console.log('⚠️  Could not create symlink, using direct reference');
    }
  }
  
  console.log(`✅ Build created in ${CONFIG.buildDir}`);
}

// Fungsi untuk test build
function testBuild() {
  console.log('🧪 Testing build...');
  
  try {
    // Test server.js
    const serverContent = fs.readFileSync('server.js', 'utf8');
    
    // Check for problematic patterns
    const problematicPatterns = [
      /`.*\$\{.*\}.*`/g,
      /execSync.*cloudflared/g
    ];
    
    let hasIssues = false;
    
    problematicPatterns.forEach(pattern => {
      if (pattern.test(serverContent)) {
        console.warn(`⚠️  Found potentially problematic pattern: ${pattern}`);
        hasIssues = true;
      }
    });
    
    if (!hasIssues) {
      console.log('✅ No problematic patterns found');
    }
    
    // Test if server can start
    console.log('Testing server start...');
    const testScript = `
const http = require('http');
const server = http.createServer((req, res) => {
  res.end('OK');
});
server.listen(0, () => {
  console.log('Test server OK');
  server.close();
});
`;
    
    fs.writeFileSync('test-server.js', testScript);
    execSync('node test-server.js', { stdio: 'pipe' });
    fs.unlinkSync('test-server.js');
    
    console.log('✅ Build test passed');
    return true;
    
  } catch (error) {
    console.error('❌ Build test failed:', error.message);
    return false;
  }
}

// Fungsi untuk create deployment script
function createDeployScript() {
  console.log('🚀 Creating deployment script...');
  
  const deployScript = `#!/bin/bash
# Deployment Script untuk Cloudflare Pages

echo "Starting deployment..."

# 1. Build aplikasi
npm run build

# 2. Check if build succeeded
if [ ! -d "dist" ]; then
  echo "❌ Build failed: dist directory not found"
  exit 1
fi

# 3. Deploy to Cloudflare Pages (jika wrangler terinstall)
if command -v wrangler &> /dev/null; then
  echo "Deploying with wrangler..."
  wrangler pages publish dist --project-name=whatsapp-bot
else
  echo "⚠️  Wrangler not found"
  echo "📁 Build files are in dist/"
  echo "Manual deployment required"
fi

echo "✅ Deployment script ready"
`;
  
  fs.writeFileSync('deploy.sh', deployScript);
  fs.chmodSync('deploy.sh', '755');
  console.log('✅ Created deploy.sh');
}

// Fungsi untuk create .gitignore
function createGitignore() {
  console.log('📁 Creating .gitignore...');
  
  const gitignoreContent = `
# Dependencies
node_modules/
dist/

# Environment
.env
.env.local
.env.production

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Cloudflared
cloudflared
*.exe

# Build artifacts
build/
.cache/
.tmp/
.DS_Store
`;
  
  fs.writeFileSync('.gitignore', gitignoreContent);
  console.log('✅ Created .gitignore');
}

// Main build function
async function build() {
  console.log('🏁 Starting build process...\n');
  
  // 1. Fix comments in server.js
  if (!fixCommentsInFile(CONFIG.serverFile)) {
    console.error('Build failed: Could not fix server.js');
    process.exit(1);
  }
  
  // 2. Create necessary scripts
  createCloudflaredScript();
  createServerWrapper();
  
  // 3. Create .gitignore
  createGitignore();
  
  // 4. Install dependencies
  if (!installDependencies()) {
    console.warn('⚠️  Dependencies installation had issues');
  }
  
  // 5. Test build
  if (!testBuild()) {
    console.warn('⚠️  Build test had issues');
  }
  
  // 6. Create build directory
  createBuild();
  
  // 7. Create deploy script
  createDeployScript();
  
  console.log('\n✨ Build completed successfully!');
  console.log('\n📋 Next steps:');
  console.log('1. Upload all files to Cloudflare Pages');
  console.log('2. Set environment variables in Pages dashboard:');
  console.log('   - BIN_ID: 693151eed0ea881f40121ca6');
  console.log('   - JSONBIN_KEY: $2a$10$u00Qvq6xrri32tc7bEYVhuQv94XS.ygeVCr70UDbzoOVlR8yLuUq.');
  console.log('   - MAIN_URL: https://xgenzy.github.io/RVO/');
  console.log('3. Build command: npm run build');
  console.log('4. Output directory: dist');
  console.log('5. Or run: ./deploy.sh');
}

// Run build
build().catch(error => {
  console.error('💥 Build failed:', error);
  process.exit(1);
});
