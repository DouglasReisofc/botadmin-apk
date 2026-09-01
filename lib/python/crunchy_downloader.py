import os
import sys
from datetime import datetime

import yt_dlp

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
COOKIES_PATH = os.path.join(BASE_DIR, "crunchycookies.txt")
DOWNLOAD_DIR = os.path.join(BASE_DIR, "tmp_crunchyroll")

DEBUG_URL = ""


def ensure_cookies() -> None:
    if os.path.exists(COOKIES_PATH) and os.path.getsize(COOKIES_PATH) > 0:
        return
    raise FileNotFoundError(
        f"Arquivo de cookies não encontrado ou vazio: {COOKIES_PATH}\n"
        "Exporte os cookies do Crunchyroll para este arquivo no formato Netscape."
    )


def ensure_download_dir() -> None:
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)


def build_output_template() -> str:
    timestamp = datetime.now().strftime("%Y%m%d")
    return os.path.join(DOWNLOAD_DIR, f"{timestamp}_%(title)s_%(id)s.%(ext)s")


def download_crunchy(url: str) -> None:
    ensure_cookies()
    ensure_download_dir()

    ydl_opts = {
        "cookiefile": COOKIES_PATH,
        "format": "bv*+ba/b",
        "merge_output_format": "mp4",
        "noplaylist": True,
        "quiet": False,
        "outtmpl": build_output_template(),
        "progress_hooks": [
            lambda d: print(f"[yt-dlp] {d.get('status')} - {d.get('filename', '')}", file=sys.stderr)
        ],
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        print(f"➜ Iniciando download do Crunchyroll: {url}")
        info = ydl.extract_info(url, download=True)
        print("✓ Download concluído!")
        print(f"Título: {info.get('title')}")
        print(f"Arquivo salvo em: {ydl.prepare_filename(info)}")


def main() -> None:
    if DEBUG_URL.strip():
        url = DEBUG_URL.strip()
        print(f"[debug] Usando URL fixa: {url}")
    else:
        if len(sys.argv) < 2:
            print("Uso: python crunchy_downloader.py <URL_CRUNCHYROLL>")
            sys.exit(1)
        url = sys.argv[1].strip()

    if not url.startswith("http"):
        print("Informe uma URL válida do Crunchyroll.")
        sys.exit(1)

    try:
        download_crunchy(url)
    except Exception as exc:
        print(f"✗ Falha no download: {exc}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
