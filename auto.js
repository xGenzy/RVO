const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = 8080;

// Konfigurasi
const BIN_ID = '693151eed0ea881f40121ca6';
const API_KEY = '$2a$10$u00Qvq6xrri32tc7bEYVhuQv94XS.ygeVCr70UDbzoOVlR8yLuUq.';
let serverProcess = null;
let serverUrl = null;

app.use(express.json());
app.use(express.static('.')); // Serve static files

// Endpoint untuk start server
app.get('/api/start-server', async (req, res) => {
    try {
        if (serverProcess) {
            return res.json({
                success: true,
                message: 'Server already running',
                url: serverUrl
            });
        }

        console.log('🚀 Starting WhatsApp Bot Server...');
        
        // Start server.js
        serverProcess = spawn('node', ['server.js'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true,
            detached: false
        });

        let output = '';
        let foundUrl = null;

        // Capture output untuk mendapatkan URL
        const handleOutput = (data) => {
            const text = data.toString();
            output += text;
            console.log(text.trim());

            // Cari URL Cloudflare
            const urlMatch = text.match(/https:\/\/[a-zA-Z0-9\-]+\.trycloudflare\.com/);
            if (urlMatch && !foundUrl) {
                foundUrl = urlMatch[0];
                serverUrl = foundUrl;
                
                // Update JSONBin
                updateJsonBin(foundUrl);
                
                res.json({
                    success: true,
                    message: 'Server started successfully',
                    url: foundUrl,
                    pid: serverProcess.pid
                });
            }
        };

        serverProcess.stdout.on('data', handleOutput);
        serverProcess.stderr.on('data', handleOutput);

        // Timeout
        setTimeout(() => {
            if (!foundUrl) {
                // Coba cari di output yang sudah ada
                const urlFromOutput = output.match(/https:\/\/[a-zA-Z0-9\-]+\.trycloudflare\.com/);
                if (urlFromOutput) {
                    serverUrl = urlFromOutput[0];
                    updateJsonBin(serverUrl);
                    res.json({
                        success: true,
                        message: 'Server started (URL found in output)',
                        url: serverUrl
                    });
                } else {
                    res.json({
                        success: false,
                        message: 'Server started but no URL found'
                    });
                }
            }
        }, 30000);

        // Handle process exit
        serverProcess.on('close', () => {
            serverProcess = null;
            serverUrl = null;
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Endpoint untuk check status
app.get('/api/status', (req, res) => {
    res.json({
        success: true,
        running: !!serverProcess,
        url: serverUrl,
        pid: serverProcess?.pid
    });
});

// Endpoint untuk stop server
app.get('/api/stop-server', (req, res) => {
    if (serverProcess) {
        serverProcess.kill('SIGTERM');
        serverProcess = null;
        serverUrl = null;
        res.json({ success: true, message: 'Server stopped' });
    } else {
        res.json({ success: false, message: 'Server not running' });
    }
});

// Update JSONBin
async function updateJsonBin(url) {
    try {
        await axios.put(
            `https://api.jsonbin.io/v3/b/${BIN_ID}`,
            { url: url, updated: new Date().toISOString() },
            { headers: { 'X-Master-Key': API_KEY, 'Content-Type': 'application/json' } }
        );
        console.log('✅ JSONBin updated');
    } catch (error) {
        console.log('⚠️ Failed to update JSONBin:', error.message);
    }
}

// Start API server
app.listen(PORT, () => {
    console.log(`✅ API Server running on http://localhost:${PORT}`);
    console.log(`📁 Serving static files from current directory`);
});
