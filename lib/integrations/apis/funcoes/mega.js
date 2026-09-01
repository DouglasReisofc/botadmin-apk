const fs = require('fs');
const path = require('path');

const DEFAULT_DEST_DIR = path.join(process.cwd(), 'public', 'tmp');

async function downloadMegaFile(link, destDir = DEFAULT_DEST_DIR) {
    try {
        const { downloadMegaFileToPublic } = await import('../../../mega-downloader');
        const result = await downloadMegaFileToPublic(link);

        if (destDir && path.resolve(destDir) !== path.resolve(DEFAULT_DEST_DIR)) {
            await fs.promises.mkdir(destDir, { recursive: true });
            const targetPath = path.join(destDir, result.filename);
            await fs.promises.copyFile(result.filePath, targetPath);
            return { success: true, path: targetPath, name: result.filename };
        }

        return { success: true, path: result.filePath, name: result.filename };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: message };
    }
}

module.exports = downloadMegaFile;
