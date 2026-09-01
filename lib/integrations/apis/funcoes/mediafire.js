const cheerio = require("cheerio");
const { fetch } = require("undici");
const { lookup } = require("mime-types");

async function mediaFire(url) {
    try {
        const headers = {
            "user-agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0 Safari/537.36",
        };

        let response = await fetch(url, { headers, redirect: "follow" });
        let html = await response.text();

        if (response.status === 403 && response.headers.get("set-cookie")) {
            const cookie = response.headers.get("set-cookie").split(";")[0];
            response = await fetch(url, { headers: { ...headers, Cookie: cookie } });
            html = await response.text();
        }

        const $ = cheerio.load(html);

        const typeElement = $(".dl-btn-cont").find(".icon");
        const type = typeElement.attr("class")?.split(" ")[1] || null;

        const filename = $(".dl-btn-label").attr("title") || "unknown";

        const downloadButton = $("#downloadButton");
        let download = null;
        let size = null;
        if (downloadButton.length) {
            const scrambled = downloadButton.attr("data-scrambled-url");
            if (scrambled) {
                download = Buffer.from(scrambled, "base64").toString("utf-8");
            }
            size = downloadButton.text().match(/\(([^)]+)\)/)?.[1] || null;
        }

        const ext = filename.split(".").pop();
        const mimetype = lookup(ext.toLowerCase()) || "application/" + ext.toLowerCase();

        return {
            filename,
            type,
            size,
            ext,
            mimetype,
            download,
        };
    } catch (error) {
        throw {
            msg: "Gagal mengambil data dari link tersebut",
            error,
        };
    }
}

module.exports = mediaFire;
