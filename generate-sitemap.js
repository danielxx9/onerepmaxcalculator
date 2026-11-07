const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://onerepmaxcalculator.me';
let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

// Add Homepage
xml += `  <url><loc>${BASE_URL}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n`;

// Add Root Tool Pages (e.g., plate-calculator.html)
const rootFiles = fs.readdirSync('.').filter(f => f.endsWith('.html') && f !== 'index.html');
rootFiles.forEach(file => {
    xml += `  <url><loc>${BASE_URL}/${file.replace('.html', '')}</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>\n`;
});

// Add Article Pages
if (fs.existsSync('./articles')) {
    xml += `  <url><loc>${BASE_URL}/articles/</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>\n`;
    const articleFiles = fs.readdirSync('./articles').filter(f => f.endsWith('.html') && f !== 'index.html');
    articleFiles.forEach(file => {
        xml += `  <url><loc>${BASE_URL}/articles/${file.replace('.html', '')}</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>\n`;
    });
}

xml += '</urlset>';
fs.writeFileSync('sitemap.xml', xml);
console.log('✅ Sitemap generated automatically!');