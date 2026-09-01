import yt_dlp
import os
import sys
import json
import uuid
import subprocess
import shutil
import time
from datetime import datetime
import urllib.request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
yt_cookies_file = os.path.join(BASE_DIR, 'ytcookies.txt')
insta_cookies_file = os.path.join(BASE_DIR, 'instacookies.txt')

COOKIES_URL = 'https://cookies.botadmin.shop/cookies/youtube?format=txt'
NODE_RUNTIME = os.environ.get('YT_JS_RUNTIME') or shutil.which('node') or 'node'
DENO_RUNTIME = (
    os.environ.get('YT_DENO_RUNTIME') or
    shutil.which('deno') or
    ('/root/.deno/bin/deno' if os.path.exists('/root/.deno/bin/deno') else '')
)

def build_js_runtimes():
    if DENO_RUNTIME:
        return {'deno': {'path': DENO_RUNTIME}}
    if os.environ.get('YT_ALLOW_NODE_JS_RUNTIME', '0') == '1' and NODE_RUNTIME:
        return {'node': {'path': NODE_RUNTIME}}
    return {}

def build_remote_components():
    raw = os.environ.get('YT_REMOTE_COMPONENTS') or 'ejs:github'
    return [item.strip() for item in raw.split(',') if item.strip()]

def build_youtube_extractor_args():
    raw_clients = os.environ.get('YT_PLAYER_CLIENTS') or 'mweb,default'
    clients = [item.strip() for item in raw_clients.split(',') if item.strip()]
    args = {'player_client': clients or ['mweb', 'default']}
    if os.environ.get('YT_DISABLE_INNERTUBE', '1') != '0':
        args['disable_innertube'] = ['1']
    return {'youtube': args}

JS_RUNTIMES = build_js_runtimes()
REMOTE_COMPONENTS = build_remote_components()
YOUTUBE_EXTRACTOR_ARGS = build_youtube_extractor_args()
FALLBACK_COOKIE_PATHS = [
    os.environ.get('YT_COOKIES_PATH'),
    os.environ.get('YT_COOKIES_FALLBACK'),
    '/ytcookies.txt',
    os.path.join('/', 'root', 'ytcookies.txt'),
    os.path.join(os.path.dirname(BASE_DIR), 'ytcookies.txt'),
    os.path.join(os.path.dirname(BASE_DIR), 'botadmin', 'ytcookies.txt'),
    os.path.join(BASE_DIR, 'ytcookies_backup.txt'),
]

DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
}

CLICKBUY_API_URL = 'http://clickbuy3.com/api/download'
CLICKBUY_API_HEADERS = {
    'accept': '*/*',
    'content-type': 'application/json',
    'origin': 'http://clickbuy3.com',
    'referer': 'http://clickbuy3.com/pt',
    'user-agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36',
}
CLICKBUY_VIDEO_HEADERS = {
    'referer': 'http://clickbuy3.com/',
}

def gerar_id_unico():
    return str(uuid.uuid4())

def is_shopee_url(url: str) -> bool:
    lowered = (url or '').lower()
    return 'shopee.' in lowered or 'shp.ee' in lowered or 'sv.shopee.com' in lowered

def is_douyin_url(url: str) -> bool:
    lowered = (url or '').lower()
    return 'douyin.com' in lowered or 'iesdouyin.com' in lowered or 'ixigua.com' in lowered

def is_kwai_url(url: str) -> bool:
    lowered = (url or '').lower()
    return 'kwai.com' in lowered or 'kuaishou.com' in lowered or 'kwai-video.com' in lowered

def first_existing_cookie_file(*paths: str):
    for cookie_path in paths:
        if not cookie_path:
            continue
        try:
            if os.path.exists(cookie_path) and os.path.getsize(cookie_path) > 0:
                return cookie_path
        except Exception:
            continue
    return None

def download_direct_file(file_url: str, output_path: str, referer: str = '', extra_headers: dict | None = None) -> bool:
    headers = dict(DEFAULT_HEADERS)
    if referer:
        headers['Referer'] = referer
    if isinstance(extra_headers, dict):
        headers.update(extra_headers)
    try:
        req = urllib.request.Request(file_url, headers=headers)
        with urllib.request.urlopen(req, timeout=60) as response, open(output_path, 'wb') as output_file:
            shutil.copyfileobj(response, output_file)
        return True
    except Exception as e:
        sys.stderr.write(f"Erro ao baixar arquivo direto: {str(e)}\n")
        return False

def request_shopee_video_url(url: str) -> tuple[str, dict]:
    try:
        payload = json.dumps({'url': url}).encode('utf-8')
        req = urllib.request.Request(
            CLICKBUY_API_URL,
            data=payload,
            headers=CLICKBUY_API_HEADERS,
            method='POST',
        )
        with urllib.request.urlopen(req, timeout=30) as response:
            raw_body = response.read().decode('utf-8', errors='ignore')
    except Exception as e:
        raise Exception(f'Falha ao consultar clickbuy ({str(e)})')

    try:
        parsed = json.loads(raw_body) if raw_body else {}
    except Exception:
        parsed = {}

    video_url = (
        parsed.get('videoUrl') or
        parsed.get('video_url') or
        parsed.get('url') or
        ''
    )
    if not isinstance(video_url, str) or not video_url.strip():
        raise Exception('clickbuy não retornou videoUrl')

    return video_url.strip(), parsed

def tentar_download_shopee_clickbuy(url: str, id_unico: str, pasta_downloads: str, base_url: str):
    try:
        video_source, payload = request_shopee_video_url(url)
    except Exception as e:
        sys.stderr.write(f"Shopee clickbuy falhou: {str(e)}\n")
        return None

    file_path = os.path.join(pasta_downloads, f'{id_unico}.mp4')
    if not download_direct_file(
        video_source,
        file_path,
        referer='http://clickbuy3.com/',
        extra_headers=CLICKBUY_VIDEO_HEADERS,
    ):
        return None

    info = {
        'title': (payload.get('title') if isinstance(payload.get('title'), str) else '') or 'Vídeo Shopee',
        'description': (payload.get('description') if isinstance(payload.get('description'), str) else '') or '',
        'uploader': (payload.get('author') if isinstance(payload.get('author'), str) else '') or 'Shopee',
        'thumbnail': (payload.get('thumbnail') if isinstance(payload.get('thumbnail'), str) else '') or '',
        'duration': 0,
        'view_count': 0,
        'like_count': 0,
    }

    if needs_conversion(file_path):
        sys.stderr.write("Convertendo vídeo da Shopee para formato compatível...\n")
        convert_to_whatsapp_format(file_path)

    salvar_dados_video(url, info, id_unico, pasta_downloads, base_url)
    sys.stderr.write(f"Download Shopee concluído! ID único do vídeo: {id_unico}\n")
    return id_unico

def salvar_dados_video(url, info, id_unico, pasta_downloads, base_url):
    video_url = f"{base_url}/api/play/{id_unico}"
    caminho_arquivo = os.path.join(pasta_downloads, f"{id_unico}.mp4")

    dados_video = {
        'id': id_unico,
        'url': url,
        'data': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'titulo': info.get('title', 'Desconhecido'),
        'descricao': info.get('description', ''),
        'uploader': info.get('uploader', ''),
        'thumbnail': info.get('thumbnail', ''),
        'duration': info.get('duration', 0),
        'view_count': info.get('view_count', 0),
        'like_count': info.get('like_count', 0),
        'video_url': video_url,
        'file_path': caminho_arquivo
    }

    arquivo_json = os.path.join(BASE_DIR, 'videos.json')
    dados_existentes = {}

    if os.path.exists(arquivo_json):
        try:
            with open(arquivo_json, 'r') as f:
                dados_existentes = json.load(f)
        except Exception as e:
            sys.stderr.write(f"Erro ao ler JSON: {str(e)}\n")

    dados_existentes[id_unico] = dados_video

    try:
        with open(arquivo_json, 'w') as f:
            json.dump(dados_existentes, f, indent=4)
    except Exception as e:
        sys.stderr.write(f"Erro ao salvar JSON: {str(e)}\n")

def limpar_arquivos_antigos(pasta_downloads, arquivo_json, max_age_seconds=300):
    """
    Remove arquivos temporários e entradas antigas para evitar encher o disco.
    """
    agora = time.time()
    dados = {}
    try:
        if os.path.exists(arquivo_json):
            with open(arquivo_json, 'r') as f:
                dados = json.load(f)
    except Exception as e:
        sys.stderr.write(f"Erro ao ler JSON para limpeza: {str(e)}\n")
        dados = {}

    changed = False
    for key in list(dados.keys()):
        caminho = dados[key].get('file_path') or os.path.join(pasta_downloads, f"{key}.mp4")
        try:
            st = os.stat(caminho)
            if agora - st.st_mtime > max_age_seconds:
                os.remove(caminho)
                dados.pop(key, None)
                changed = True
        except FileNotFoundError:
            dados.pop(key, None)
            changed = True
        except Exception as e:
            sys.stderr.write(f"Erro ao limpar arquivo {caminho}: {str(e)}\n")

    # Limpa órfãos
    try:
        for nome in os.listdir(pasta_downloads):
            if not nome.lower().endswith(('.mp4', '.webm', '.mkv', '.avi', '.m4v', '.mov')):
                continue
            caminho = os.path.join(pasta_downloads, nome)
            try:
                st = os.stat(caminho)
                if agora - st.st_mtime > max_age_seconds:
                    os.remove(caminho)
            except Exception:
                pass
    except Exception as e:
        sys.stderr.write(f"Erro ao listar temporários: {str(e)}\n")

    if changed:
        try:
            with open(arquivo_json, 'w') as f:
                json.dump(dados, f, indent=4)
        except Exception as e:
            sys.stderr.write(f"Erro ao salvar JSON pós-limpeza: {str(e)}\n")

def needs_conversion(file_path):
    try:
        if not shutil.which('ffprobe'):
            sys.stderr.write("ffprobe não encontrado, assumindo necessidade de conversão.\n")
            return True
        v_cmd = [
            'ffprobe', '-v', 'error', '-select_streams', 'v:0',
            '-show_entries', 'stream=codec_name',
            '-of', 'default=noprint_wrappers=1:nokey=1', file_path
        ]
        a_cmd = [
            'ffprobe', '-v', 'error', '-select_streams', 'a:0',
            '-show_entries', 'stream=codec_name',
            '-of', 'default=noprint_wrappers=1:nokey=1', file_path
        ]
        video_codec = subprocess.run(v_cmd, capture_output=True, text=True).stdout.strip()
        audio_codec = subprocess.run(a_cmd, capture_output=True, text=True).stdout.strip()
        return not (video_codec == 'h264' and audio_codec in ('aac', 'mp3'))
    except Exception as e:
        sys.stderr.write(f"Erro ao verificar codecs: {str(e)}\n")
        return True

def convert_to_whatsapp_format(file_path):
    if not shutil.which('ffmpeg'):
        sys.stderr.write("ffmpeg não encontrado, não foi possível converter o vídeo.\n")
        return
    temp_path = f"{file_path}.tmp.mp4"
    cmd = [
        'ffmpeg', '-y', '-i', file_path,
        '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'main', '-level', '3.1',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        temp_path
    ]
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os.replace(temp_path, file_path)
    except Exception as e:
        sys.stderr.write(f"Erro ao converter vídeo: {str(e)}\n")
        if os.path.exists(temp_path):
            os.remove(temp_path)

def atualizar_cookies(retries: int = 3):
    last_err = None
    for i in range(max(1, retries)):
        try:
            with urllib.request.urlopen(COOKIES_URL, timeout=20) as resp:
                conteudo = resp.read().decode('utf-8')
            if conteudo and conteudo.strip():
                with open(yt_cookies_file, 'w') as f:
                    f.write(conteudo)
                sys.stderr.write('Cookies do YouTube atualizados.\n')
                return True
        except Exception as e:
            last_err = e
            sys.stderr.write(f'Falha ao atualizar cookies (tentativa {i+1}): {str(e)}\n')
    if last_err:
        sys.stderr.write(f'Falha ao atualizar cookies: {str(last_err)}\n')
    return False


def verificar_cookies(cookies_file):
    try:
        if os.path.exists(cookies_file):
            try:
                stale_seconds = int(os.environ.get('YT_COOKIES_STALE_SECONDS', '1800'))
            except Exception:
                stale_seconds = 1800
            if stale_seconds > 0:
                try:
                    age = time.time() - os.path.getmtime(cookies_file)
                    if age > stale_seconds:
                        sys.stderr.write(f"Cookies antigos ({int(age)}s), tentando atualizar...\n")
                        atualizar_cookies()
                except Exception as age_err:
                    sys.stderr.write(f"Falha ao verificar idade dos cookies: {str(age_err)}\n")
            with open(cookies_file, 'r') as f:
                if f.read().strip():
                    sys.stderr.write(f"Cookies carregados com sucesso de {cookies_file}.\n")
                    return True
        sys.stderr.write(f"Arquivo de cookies inválido: {cookies_file}\n")
    except Exception as e:
        sys.stderr.write(f"Erro ao ler o arquivo de cookies: {str(e)}\n")

    if cookies_file == yt_cookies_file:
        for path in FALLBACK_COOKIE_PATHS:
            if not path:
                continue
            try:
                if os.path.exists(path):
                    with open(path, 'r') as src:
                        data = src.read().strip()
                    if not data:
                        continue
                    with open(yt_cookies_file, 'w') as dst:
                        dst.write(data)
                    sys.stderr.write(f"Cookies copiados de {path}.\n")
                    return True
            except Exception as err:
                sys.stderr.write(f"Falha ao copiar cookies de {path}: {str(err)}\n")
        if atualizar_cookies():
            try:
                with open(cookies_file, 'r') as f:
                    if f.read().strip():
                        sys.stderr.write(f"Cookies atualizados com sucesso em {cookies_file}.\n")
                        return True
            except Exception as err:
                sys.stderr.write(f"Falha ao validar cookies atualizados: {str(err)}\n")
        return False
    return False

def baixar_video(url, pasta_downloads='tmp', base_url=''):
    try:
        lowered_url = (url or '').lower()
        is_youtube_link = 'youtube' in lowered_url or 'youtu.be' in lowered_url
        is_shopee_link = is_shopee_url(url)
        is_douyin_link = is_douyin_url(url)
        is_kwai_link = is_kwai_url(url)
        force_youtube_cookies = os.environ.get('YT_FORCE_COOKIES', '0') == '1'

        pasta_downloads = os.path.join(BASE_DIR, pasta_downloads)
        if not os.path.exists(pasta_downloads):
            os.makedirs(pasta_downloads)
        limpar_arquivos_antigos(pasta_downloads, os.path.join(BASE_DIR, 'videos.json'))

        id_unico = gerar_id_unico()

        ydl_opts = {
            'format': (
                'bestvideo[ext=mp4][vcodec^=avc1][height<=720]+'
                'bestaudio[ext=m4a]/best[ext=mp4][vcodec^=avc1][height<=720]/'
                'best[height<=720]/best'
            ),
            'outtmpl': os.path.join(pasta_downloads, f'{id_unico}.mp4'),
            'merge_output_format': 'mp4',
            'quiet': True,
            'no_warnings': True,
            'extract_flat': False,
            'noprogress': True,
            'noplaylist': True,
            'retries': 3,
            'fragment_retries': 3,
            'concurrent_fragment_downloads': 4,
            'http_chunk_size': 10485760,
            'skip_unavailable_fragments': True,
            'http_headers': DEFAULT_HEADERS,
            'js_runtimes': JS_RUNTIMES,
            'remote_components': REMOTE_COMPONENTS,
            'extractor_args': YOUTUBE_EXTRACTOR_ARGS,
        }

        youtube_cookies_ready = False
        if is_youtube_link:
            sys.stderr.write(f"Link do YouTube detectado: {url}\n")
            if verificar_cookies(yt_cookies_file):
                youtube_cookies_ready = True
                if force_youtube_cookies or os.environ.get('YT_START_WITH_COOKIES', '1') != '0':
                    ydl_opts['cookiefile'] = yt_cookies_file
                else:
                    # Em alguns servidores, cookie + JS challenge limita formatos.
                    sys.stderr.write("Cookies do YouTube válidos. Iniciando sem cookie (fallback automático habilitado).\n")
            else:
                if force_youtube_cookies:
                    sys.stderr.write("Erro: Não foi possível carregar os cookies do YouTube.\n")
                    return None
                sys.stderr.write("Cookies do YouTube indisponíveis. Continuando sem cookie.\n")
        elif 'instagram.com' in url:
            sys.stderr.write(f"Link do Instagram detectado: {url}\n")
            if verificar_cookies(insta_cookies_file):
                ydl_opts['cookiefile'] = insta_cookies_file
            else:
                sys.stderr.write("Erro: Não foi possível carregar os cookies do Instagram.\n")
                return None
        elif is_douyin_link:
            cookie_file = first_existing_cookie_file(
                os.environ.get('DOUYIN_COOKIES_FILE', ''),
                os.environ.get('YTDLP_COOKIES_FILE', ''),
                os.path.join(BASE_DIR, 'douyincookies.txt'),
            )
            if cookie_file:
                sys.stderr.write(f"Cookies do Douyin carregados de {cookie_file}.\n")
                ydl_opts['cookiefile'] = cookie_file
            else:
                sys.stderr.write("Douyin sem cookies configurados; alguns links podem exigir DOUYIN_COOKIES_FILE ou YTDLP_COOKIES_FILE.\n")
        elif is_kwai_link:
            cookie_file = first_existing_cookie_file(
                os.environ.get('KWAI_COOKIES_FILE', ''),
                os.environ.get('KUAISHOU_COOKIES_FILE', ''),
                os.environ.get('YTDLP_COOKIES_FILE', ''),
                os.path.join(BASE_DIR, 'kwaicookies.txt'),
            )
            if cookie_file:
                sys.stderr.write(f"Cookies do Kwai/Kuaishou carregados de {cookie_file}.\n")
                ydl_opts['cookiefile'] = cookie_file

        if is_shopee_link:
            sys.stderr.write(f"Link da Shopee detectado: {url}\n")
            shopee_result = tentar_download_shopee_clickbuy(url, id_unico, pasta_downloads, base_url)
            if shopee_result:
                return shopee_result
            sys.stderr.write("Fallback Shopee via clickbuy falhou; tentando fluxo padrão.\n")

        format_fallback_applied = False
        youtube_cookie_format_failed = False
        for tentativa in range(4):
            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    sys.stderr.write("Iniciando download...\n")
                    info = ydl.extract_info(url, download=True)
                    caminho_final = os.path.join(pasta_downloads, f'{id_unico}.mp4')
                    if needs_conversion(caminho_final):
                        sys.stderr.write("Convertendo vídeo para formato compatível...\n")
                        convert_to_whatsapp_format(caminho_final)
                    salvar_dados_video(url, info, id_unico, pasta_downloads, base_url)
                    sys.stderr.write(f"Download concluído! ID único do vídeo: {id_unico}\n")
                    return id_unico
            except Exception as e:
                err = str(e)
                err_lower = err.lower()
                youtube_format_error = (
                    'requested format is not available' in err_lower or
                    'no video formats found' in err_lower or
                    'only images are available' in err_lower
                )
                if (
                    is_youtube_link and
                    youtube_format_error and
                    ydl_opts.get('cookiefile')
                ):
                    if not format_fallback_applied:
                        sys.stderr.write('Formato solicitado indisponível; tentando fallback automático de formato.\n')
                        ydl_opts['format'] = 'bestvideo+bestaudio/best'
                        format_fallback_applied = True
                        continue
                    if not JS_RUNTIMES and not youtube_cookie_format_failed:
                        sys.stderr.write('Formato indisponível com cookie; tentando novamente sem cookie.\n')
                        ydl_opts.pop('cookiefile', None)
                        youtube_cookie_format_failed = True
                        continue
                    sys.stderr.write('YouTube liberou apenas storyboards/imagens com o cookie atual. Esse link exige PO Token/GVS ou cookies mais recentes para baixar o vídeo.\n')
                    return None
                if (
                    youtube_format_error
                    and not format_fallback_applied
                ):
                    sys.stderr.write('Formato solicitado indisponível; tentando fallback automático de formato.\n')
                    ydl_opts['format'] = 'bestvideo+bestaudio/best'
                    format_fallback_applied = True
                    continue
                if (
                    is_youtube_link and
                    ('cookie' in err_lower or 'sign in to confirm you\'re not a bot' in err_lower) and
                    tentativa < 2
                ):
                    sys.stderr.write('Problema com cookies, tentando atualizar...\n')
                    if atualizar_cookies():
                        youtube_cookies_ready = True
                        ydl_opts['cookiefile'] = yt_cookies_file
                        continue
                if (
                    is_youtube_link and
                    'sign in to confirm you\'re not a bot' in err_lower and
                    tentativa < 2 and
                    youtube_cookies_ready and
                    not ydl_opts.get('cookiefile')
                ):
                    sys.stderr.write('Ativando cookies como fallback para bypass do anti-bot.\n')
                    ydl_opts['cookiefile'] = yt_cookies_file
                    continue
                if is_douyin_link and 'fresh cookies' in err_lower:
                    sys.stderr.write('Douyin exigiu cookies frescos. Configure DOUYIN_COOKIES_FILE ou YTDLP_COOKIES_FILE com cookies recentes do navegador.\n')
                    return None
                sys.stderr.write(f"Erro no download: {err}\n")
                return None

    except Exception as e:
        sys.stderr.write(f"Erro no download: {str(e)}\n")
        return None

if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.stderr.write("URL não fornecida\n")
        sys.exit(1)

    url = sys.argv[1]
    base = sys.argv[2] if len(sys.argv) > 2 else os.environ.get('BASE_URL', '')
    resultado = baixar_video(url, base_url=base)
    if resultado:
        print(resultado, flush=True)
        sys.exit(0)
    else:
        sys.exit(1)
