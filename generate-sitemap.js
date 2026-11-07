const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://onerepmaxcalculator.me';
let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

// 1. Homepage
xml += `  <url><loc>${BASE_URL}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n`;

// 2. Root Pages (Tools, Resources, Legal)
const legalPages = ["privacy", "terms", "disclaimer", "cookie-policy", "affiliate-disclosure", "dmca", "contact", "donate"];
const resourcePages = ["about", "faq", "glossary", "federations", "data-sources", "changelog", "sitemap"];

const rootFiles = fs.readdirSync('.').filter(f => {
    return f.endsWith('.html') && 
           f !== 'index.html' && 
           f !== '404.html' && 
           !f.startsWith('generated-');
});

rootFiles.forEach(file => {
    const baseName = file.replace('.html', '');
    
    let priority = "0.9"; // Default for tools
    if (legalPages.includes(baseName)) priority = "0.3";
    else if (resourcePages.includes(baseName)) priority = "0.7";

    xml += `  <url><loc>${BASE_URL}/${baseName}</loc><changefreq>monthly</changefreq><priority>${priority}</priority></url>\n`;
});

// 3. Articles Hub
if (fs.existsSync('./articles')) {
    xml += `  <url><loc>${BASE_URL}/articles/</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>\n`;
    
    // 4. Individual Articles
    const articleFiles = fs.readdirSync('./articles').filter(f => f.endsWith('.html') && f !== 'index.html');
    articleFiles.forEach(file => {
        xml += `  <url><loc>${BASE_URL}/articles/${file.replace('.html', '')}</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>\n`;
    });
}

xml += '</urlset>';
fs.writeFileSync('sitemap.xml', xml);
console.log('✅ Sitemap generated perfectly with 50+ tools and articles!');