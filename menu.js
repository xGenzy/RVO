const readline = require('readline');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

// Menyimpan proses bot yang sedang berjalan
// Format: { '628xxx': ChildProcessObject }
const activeBots = new Map();

// Warna untuk log terminal agar beda tiap bot
const colors = [
    "\x1b[32m", // Green
    "\x1b[33m", // Yellow
    "\x1b[34m", // Blue
    "\x1b[35m", // Magenta
    "\x1b[36m", // Cyan
];
const resetColor = "\x1b[0m";

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (text) => new Promise((resolve) => rl.question(text, resolve));

// Fungsi Helper: Bersihkan Layar
const clear = () => {
    console.clear();
    console.log(`
███╗   ███╗██╗   ██╗██╗  ██╗████████╗██╗
████╗ ████║██║   ██║██║  ██║╚══██╔══╝██║
██╔████╔██║██║   ██║██║  ██║   ██║   ██║
██║╚██╔╝██║██║   ██║██║  ██║   ██║   ██║
██║ ╚═╝ ██║╚██████╔╝███████║   ██║   ██║
╚═╝     ╚═╝ ╚═════╝ ╚══════╝   ╚═╝   ╚═╝
    🔥 MULTI-DEVICE MANAGER v2.0 🔥
`);
};

// Fungsi: Ambil daftar sesi (folder angka)
const getSessions = () => {
    return fs.readdirSync('./').filter(file => {
        return fs.statSync(file).isDirectory() && /^\d+$/.test(file);
    });
};

// Fungsi: Menjalankan Bot Tertentu
const startBotProcess = (sessionName, indexColor) => {
    if (activeBots.has(sessionName)) {
        console.log(`⚠️  Bot ${sessionName} sudah berjalan!`);
        return;
    }

    const color = colors[indexColor % colors.length];
    const prefix = `${color}[${sessionName}]${resetColor}`;

    console.log(`🚀 Menyalakan Bot: ${sessionName}...`);

    // Spawn process baru
    const child = spawn('node', ['bot.js', sessionName], {
        stdio: ['ignore', 'pipe', 'pipe'], // Capture stdout/stderr
        shell: true
    });

    // Simpan referensi proses
    activeBots.set(sessionName, child);

    // Tangani Log Output (Stdout)
    child.stdout.on('data', (data) => {
        const lines = data.toString().trim().split('\n');
        lines.forEach(line => {
            // Filter log sampah/kosong
            if(line.trim()) console.log(`${prefix} ${line}`);
        });
    });

    // Tangani Error Output (Stderr)
    child.stderr.on('data', (data) => {
        console.log(`${prefix} ❌ Error: ${data.toString().trim()}`);
    });

    // Tangani jika bot mati sendiri
    child.on('close', (code) => {
        console.log(`${prefix} 🛑 Bot berhenti (Code: ${code})`);
        activeBots.delete(sessionName);
    });
};

// Fungsi: Matikan Semua Bot sebelum Exit
const killAllBots = () => {
    if (activeBots.size > 0) {
        console.log("\n🧹 Mematikan semua bot...");
        activeBots.forEach((child, session) => {
            child.kill(); 
            // Untuk Windows kadang butuh taskkill force jika child.kill() tidak mempan
            try { process.kill(child.pid); } catch(e) {}
        });
        activeBots.clear();
    }
};

// MENU UTAMA
const mainMenu = async () => {
    clear();
    const sessions = getSessions();
    
    // Header Status
    console.log(`📊 Total Sesi: ${sessions.length}`);
    console.log(`⚡ Bot Aktif : ${activeBots.size} unit`);
    if (activeBots.size > 0) {
        console.log(`   (Running: ${Array.from(activeBots.keys()).join(', ')})`);
    }
    console.log("=========================================");
    console.log("[1] Start Bot");
    console.log("[2] Add WhatsApp");
    console.log("[3] Delete WhatsApp");
    console.log("[4] Stop All & Exit");
    console.log("=========================================");

    // Jika ada bot jalan, menu tidak blocking log, tapi kita pause input
    // Agar log bot tidak menimpa pertanyaan menu, user harus tekan enter dulu jika ingin menu lagi
    // Tapi karena readline simple, kita biarkan saja log menimpa.
    
    const choice = await question("👉 Pilih menu (1-4): ");

    switch (choice) {
        case '1': // MULTI START
            if (sessions.length === 0) {
                console.log("❌ Belum ada sesi. Tambahkan dulu.");
                await new Promise(r => setTimeout(r, 1500));
                return mainMenu();
            }

            console.log("\n📋 DAFTAR SESI TERSEDIA:");
            sessions.forEach((s, i) => {
                const status = activeBots.has(s) ? "✅ RUNNING" : "⚪ OFF";
                console.log(`${i + 1}. ${s} [${status}]`);
            });

            console.log("\n💡 Ketik nomor urut dipisah koma (Contoh: 1,3,5) atau ketik 'all' untuk semua.");
            const selection = await question("🎯 Pilih nomor: ");

            let selectedIndices = [];
            
            if (selection.toLowerCase() === 'all') {
                selectedIndices = sessions.map((_, i) => i);
            } else {
                selectedIndices = selection.split(',')
                    .map(x => parseInt(x.trim()) - 1)
                    .filter(idx => !isNaN(idx) && idx >= 0 && idx < sessions.length);
            }

            if (selectedIndices.length === 0) {
                console.log("❌ Pilihan tidak valid.");
            } else {
                console.log("\n🚀 Memproses antrian start...");
                selectedIndices.forEach((idx, loopIndex) => {
                    const sessionName = sessions[idx];
                    startBotProcess(sessionName, loopIndex);
                });
                console.log("\n✅ Bot berjalan di background. Log akan muncul di sini.");
                console.log("⌨️  Tekan [ENTER] untuk kembali ke menu utama (Log akan terus berjalan)...");
                await question(""); 
            }
            return mainMenu();

        case '2': // ADD SESSION
            console.log("\n📞 Masukkan Nomor HP Baru (Contoh: 62812xxx)");
            const phone = await question("Nomor: ");
            const cleanPhone = phone.replace(/\D/g, "");
            
            if (cleanPhone.length < 10) {
                console.log("❌ Nomor tidak valid!");
                await new Promise(r => setTimeout(r, 1500));
            } else {
                // Untuk login baru, kita jalankan mode 'inherit' agar user bisa lihat QR/Pairing code jelas
                // dan satu bot saja
                console.log("⏳ Membuka asisten pairing...");
                
                // Gunakan promise untuk menunggu bot ditutup
                await new Promise((resolve) => {
                    const child = spawn('node', ['bot.js', cleanPhone], { stdio: 'inherit', shell: true });
                    child.on('close', resolve);
                });
            }
            return mainMenu();

        case '3': // DELETE SESSION
            if (sessions.length === 0) return mainMenu();
            
            console.log("\n🗑️  HAPUS SESI:");
            sessions.forEach((s, i) => console.log(`${i + 1}. ${s}`));
            
            const delIdx = await question("\nPilih nomor yang akan DIHAPUS (0 batal): ");
            const targetIdx = parseInt(delIdx) - 1;

            if (targetIdx >= 0 && targetIdx < sessions.length) {
                const targetSession = sessions[targetIdx];
                
                // Cek jika sedang jalan
                if (activeBots.has(targetSession)) {
                    console.log("⚠️ Bot sedang berjalan! Matikan dulu.");
                } else {
                    const confirm = await question(`❓ Hapus ${targetSession}? (y/n): `);
                    if (confirm.toLowerCase() === 'y') {
                        fs.rmSync(`./${targetSession}`, { recursive: true, force: true });
                        console.log("✅ Terhapus.");
                    }
                }
            }
            await new Promise(r => setTimeout(r, 1500));
            return mainMenu();

        case '4': // EXIT
            killAllBots();
            console.log("👋 Bye!");
            process.exit(0);
            break;

        default:
            console.log("❌ Salah pilih.");
            await new Promise(r => setTimeout(r, 1000));
            return mainMenu();
    }
};

// Handle Ctrl+C (Force Close)
process.on('SIGINT', () => {
    console.log("\n⚠️  Force Close detected...");
    killAllBots();
    process.exit(0);
});

// Jalankan
mainMenu();