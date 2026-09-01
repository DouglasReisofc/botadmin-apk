import yt_dlp
import os
import sys
import json
import uuid
import shutil
import time
import subprocess
import glob
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
    # O cliente padrão do yt-dlp é mais estável para mídia; só habilite EJS/Node
    # quando o ambiente pedir explicitamente, pois alguns hosts passam a receber
    # 403 ao combinar Node/EJS com o cliente Android.
    if os.environ.get('YT_ALLOW_NODE_JS_RUNTIME', '0') == '1' and NODE_RUNTIME:
        return {'node': {'path': NODE_RUNTIME}}
    return {}

def build_remote_components():
    raw = os.environ.get('YT_REMOTE_COMPONENTS') or 'ejs:github'
    return [item.strip() for item in raw.split(',') if item.strip()]

def build_youtube_extractor_args():
    # O cliente mweb exige PO Token e pode retornar somente storyboards.
    # O cliente padrão do yt-dlp usa android_vr e mantém os formatos de áudio.
    raw_clients = os.environ.get('YT_PLAYER_CLIENTS') or 'default'
    clients = [item.strip() for item in raw_clients.split(',') if item.strip()]
    args = {'player_client': clients or ['default']}
    if os.environ.get('YT_DISABLE_INNERTUBE', '0') != '0':
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

# Debug: URL fixa para teste rápido diretamente neste arquivo.
# Deixe vazio ('') para desativar e usar argumentos da linha de comando.
DEBUG_HARDCODE_URL = ''

def gerar_id_unico():
    return str(uuid.uuid4())

def encontrar_arquivo_audio(pasta_downloads, id_unico):
    candidatos = []
    for caminho in glob.glob(os.path.join(pasta_downloads, f'{id_unico}.*')):
        if os.path.isfile(caminho) and os.path.splitext(caminho)[1].lower() in ('.mp3', '.m4a', '.webm', '.opus', '.ogg'):
            candidatos.append(caminho)
    if not candidatos:
        return None
    return max(candidatos, key=lambda item: os.path.getsize(item))


def duracao_audio(caminho):
    try:
        result = subprocess.run(
            ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', caminho],
            capture_output=True,
            text=True,
            timeout=30,
            check=True,
        )
        value = float((result.stdout or '').strip())
        return value if value > 0 else 0.0
    except Exception as error:
        sys.stderr.write(f'Falha ao validar duração do áudio: {error}\n')
        return 0.0


def validar_arquivo_audio(caminho, info):
    try:
        tamanho = os.path.getsize(caminho)
    except OSError:
        return False, 0, 0.0
    esperado = float(info.get('duration') or 0)
    duracao = duracao_audio(caminho)
    # Um áudio real pode ser curto, mas nunca deve ser um JSON/HTML ou alguns KB.
    if tamanho < 64 * 1024 or duracao <= 0:
        return False, tamanho, duracao
    if esperado > 30 and duracao < max(10, esperado * 0.97):
        return False, tamanho, duracao
    return True, tamanho, duracao


def salvar_dados_audio(url, info, id_unico, caminho_arquivo, base_url, tamanho=None, duracao=None):
    audio_url = f"{base_url}/api/playaudio/{id_unico}"

    dados_audio = {
        'id': id_unico,
        'url': url,
        'data': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'titulo': info.get('title', 'Desconhecido'),
        'descricao': info.get('description', ''),
        'uploader': info.get('uploader', ''),
        'thumbnail': info.get('thumbnail', ''),
        'duration': info.get('duration', 0),
        'duration_downloaded': duracao if duracao is not None else info.get('duration', 0),
        'file_size': tamanho if tamanho is not None else os.path.getsize(caminho_arquivo),
        'mime_type': 'audio/mpeg' if caminho_arquivo.lower().endswith('.mp3') else 'audio/*',
        'view_count': info.get('view_count', 0),
        'like_count': info.get('like_count', 0),
        'audio_url': audio_url,
        'file_path': caminho_arquivo
    }

    arquivo_json = os.path.join(BASE_DIR, 'audios.json')
    dados_existentes = {}

    if os.path.exists(arquivo_json):
        try:
            with open(arquivo_json, 'r') as f:
                dados_existentes = json.load(f)
        except Exception as e:
            sys.stderr.write(f"Erro ao ler JSON: {str(e)}\n")

    dados_existentes[id_unico] = dados_audio

    try:
        temporario = f'{arquivo_json}.{id_unico}.tmp'
        with open(temporario, 'w') as f:
            json.dump(dados_existentes, f, indent=4)
        os.replace(temporario, arquivo_json)
    except Exception as e:
        sys.stderr.write(f"Erro ao salvar JSON: {str(e)}\n")

def limpar_arquivos_antigos(pasta_downloads, arquivo_json, max_age_seconds=300):
    """
    Remove arquivos e entradas de JSON mais antigos que max_age_seconds (default 5 minutos)
    para evitar encher o disco com temporários.
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
        caminho = dados[key].get('file_path') or os.path.join(pasta_downloads, f"{key}.mp3")
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

    # Limpa arquivos órfãos na pasta
    try:
        for nome in os.listdir(pasta_downloads):
            if not nome.lower().endswith(('.mp3', '.m4a', '.webm')):
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

def copiar_cookies_fallback():
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
        except Exception as e:
            sys.stderr.write(f"Falha ao copiar cookies de {path}: {str(e)}\n")
    return False

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
        if copiar_cookies_fallback():
            try:
                with open(cookies_file, 'r') as f:
                    if f.read().strip():
                        sys.stderr.write(f"Cookies carregados do fallback para {cookies_file}.\n")
                        return True
            except Exception as e:
                sys.stderr.write(f"Falha ao validar cookies copiados: {str(e)}\n")
        if atualizar_cookies():
            try:
                with open(cookies_file, 'r') as f:
                    if f.read().strip():
                        sys.stderr.write(f"Cookies atualizados com sucesso em {cookies_file}.\n")
                        return True
            except Exception as e:
                sys.stderr.write(f"Falha ao validar cookies atualizados: {str(e)}\n")
        return False
    return False

def baixar_audio(url, pasta_downloads='tmp', base_url=''):
    try:
        lowered_url = (url or '').lower()
        is_youtube_link = 'youtube' in lowered_url or 'youtu.be' in lowered_url
        force_youtube_cookies = os.environ.get('YT_FORCE_COOKIES', '0') == '1'
        pasta_downloads = os.path.join(BASE_DIR, pasta_downloads)
        if not os.path.exists(pasta_downloads):
            os.makedirs(pasta_downloads)
        limpar_arquivos_antigos(pasta_downloads, os.path.join(BASE_DIR, 'audios.json'))

        id_unico = gerar_id_unico()

        ydl_opts = {
            'format': 'bestaudio/best',
            'outtmpl': os.path.join(pasta_downloads, f'{id_unico}.%(ext)s'),
            'quiet': True,
            'no_warnings': True,
            'noplaylist': True,
            'noprogress': True,
            'retries': 3,
            'fragment_retries': 3,
            'skip_unavailable_fragments': True,
            'http_headers': {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'},
            'js_runtimes': JS_RUNTIMES,
            'remote_components': REMOTE_COMPONENTS,
            'extractor_args': YOUTUBE_EXTRACTOR_ARGS,
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '128'
            }]
        }

        youtube_cookies_ready = False
        if is_youtube_link:
            sys.stderr.write(f"Link do YouTube detectado: {url}\n")
            if verificar_cookies(yt_cookies_file):
                youtube_cookies_ready = True
                if force_youtube_cookies:
                    ydl_opts['cookiefile'] = yt_cookies_file
                else:
                    # Em alguns ambientes o cookie reduz formatos disponíveis; começa sem cookie.
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

        for tentativa in range(3):
            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    sys.stderr.write("Iniciando download de áudio...\n")
                    info = ydl.extract_info(url, download=True)
                    caminho_arquivo = encontrar_arquivo_audio(pasta_downloads, id_unico)
                    if not caminho_arquivo:
                        raise RuntimeError('O downloader terminou sem gerar um arquivo de áudio.')
                    valido, tamanho, duracao = validar_arquivo_audio(caminho_arquivo, info)
                    if not valido:
                        try:
                            os.remove(caminho_arquivo)
                        except OSError:
                            pass
                        raise RuntimeError(
                            f'Áudio incompleto rejeitado: {tamanho} bytes, {duracao:.1f}s '
                            f'(esperado {float(info.get("duration") or 0):.1f}s).'
                        )
                    salvar_dados_audio(url, info, id_unico, caminho_arquivo, base_url, tamanho, duracao)
                    sys.stderr.write(f"Download concluído! ID único do áudio: {id_unico}\n")
                    return id_unico
            except Exception as e:
                err = str(e)
                err_lower = err.lower()
                if is_youtube_link:
                    if (
                        'requested format is not available' in err_lower or
                        'only images are available' in err_lower or
                        'no video formats found' in err_lower
                    ) and ydl_opts.get('cookiefile') and not JS_RUNTIMES:
                        sys.stderr.write('Formato indisponível com cookie; tentando novamente sem cookie.\n')
                        ydl_opts.pop('cookiefile', None)
                        continue
                    if ('cookie' in err_lower or 'sign in to confirm you\'re not a bot' in err_lower) and tentativa < 2:
                        sys.stderr.write('Problema com cookies, tentando atualizar...\n')
                        if atualizar_cookies():
                            youtube_cookies_ready = True
                            ydl_opts['cookiefile'] = yt_cookies_file
                            continue
                    if 'sign in to confirm you\'re not a bot' in err_lower and tentativa < 2 and youtube_cookies_ready and not ydl_opts.get('cookiefile'):
                        sys.stderr.write('Ativando cookies como fallback para bypass do anti-bot.\n')
                        ydl_opts['cookiefile'] = yt_cookies_file
                        continue
                sys.stderr.write(f"Erro no download: {err}\n")
                return None

    except Exception as e:
        sys.stderr.write(f"Erro no download: {str(e)}\n")
        return None

if __name__ == "__main__":
    # Se houver uma URL fixa de debug, priorize-a para facilitar o teste.
    if DEBUG_HARDCODE_URL and DEBUG_HARDCODE_URL.strip():
        url = DEBUG_HARDCODE_URL.strip()
        sys.stderr.write(f"[debug] Usando URL fixa do arquivo: {url}\n")
    else:
        if len(sys.argv) < 2:
            sys.stderr.write("URL não fornecida\n")
            sys.exit(1)
        url = sys.argv[1]
    base = sys.argv[2] if len(sys.argv) > 2 else os.environ.get('BASE_URL', '')
    resultado = baixar_audio(url, base_url=base)
    if resultado:
        print(resultado, flush=True)
        sys.exit(0)
    else:
        sys.exit(1)
