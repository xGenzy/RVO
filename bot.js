module.exports = async (sock, m, addLog) => {
    try {
        const msg = m.messages[0];
        if (!msg.message) return;

        // Mendapatkan tipe pesan dan isi teks
        const messageType = Object.keys(msg.message)[0];
        const text = messageType === 'conversation' ? msg.message.conversation :
                     messageType === 'extendedTextMessage' ? msg.message.extendedTextMessage.text : '';

        const remoteJid = msg.key.remoteJid;
        
        // Log ke Dashboard HTML
        // addLog(`[MSG] ${remoteJid}: ${text}`, 'info');

        if (!msg.key.fromMe && text) {
            
            // CONTOH FITUR 1: PING
            if (text.toLowerCase() === 'ping') {
                addLog(`Command PING received from ${remoteJid}`, 'success');
                await sock.sendMessage(remoteJid, { text: 'Pong! ⚡ Cyber Monitor is Active.' });
            }

            // CONTOH FITUR 2: MENU
            if (text.toLowerCase() === '.menu') {
                await sock.sendMessage(remoteJid, { text: 'Menu Bot:\n1. Ping\n2. Status' });
            }

            // Tambahkan logika bot kamu yang lain disini...
        }

    } catch (e) {
        console.log("Error in bot.js:", e);
        addLog(`Error: ${e.message}`, 'error');
    }
};
