const fs = require('fs');
const path = 'workspaces/RVO/server.js';

// Baca file
let content = fs.readFileSync(path, 'utf8');

// Pattern untuk mencari template literal di komentar
const patterns = [
    /\/\/.*`.*\$\{.*\}.*`/g,  // Single line comment dengan template literal
    /\/\*[\s\S]*?\$\{.*\}[\s\S]*?\*\//g  // Multi-line comment dengan template literal
];

// Ganti template literal di komentar dengan string concatenation
content = content.replace(/\/\/.*`(.*)\$\{(.*)\}(.*)`/g, function(match) {
    // Hapus template literal dari komentar
    return match.replace(/`.*`/, "'.' + variable + '.'");
});

// Atau lebih simple: hapus semua backticks dari komentar
content = content.replace(/\/\/.*`/g, function(match) {
    return match.replace(/`/g, "'");
});

// Tulis kembali
fs.writeFileSync(path, content);
console.log('Fixed comments in server.js');
