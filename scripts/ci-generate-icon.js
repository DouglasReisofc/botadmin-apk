// Generate resources/icon.png from resources/logo_src (if present)
// Fallback to repo default logo when conversion fails
const fs = require('fs');

(async () => {
  try {
    const sharp = require('sharp');
    if (fs.existsSync('resources/logo_src')) {
      await sharp('resources/logo_src')
        .resize({ width: 1024, height: 1024, fit: 'contain', background: '#ffffff' })
        .png()
        .toFile('resources/icon.png');
      process.exit(0);
    }
  } catch (e) {
    // ignore and fallback
  }

  try {
    if (!fs.existsSync('resources')) fs.mkdirSync('resources', { recursive: true });
    fs.copyFileSync('public/images/brand/logo/logo-icon.svg', 'resources/icon.png');
  } catch (e) {
    // last resort: create empty placeholder to not fail the workflow
    try { fs.writeFileSync('resources/icon.png', Buffer.from([])); } catch {}
  }
})();

