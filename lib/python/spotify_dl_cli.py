#!/usr/bin/env python3
"""
Wrapper simples para coletar metadados de uma faixa do Spotify via spotDL.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from typing import Any, Dict, List

DEFAULT_CLIENT_ID = "5f573c9620494bae87890c0f08a60293"
DEFAULT_CLIENT_SECRET = "212476d9b0f3472eaa762d90b19b0ba8"

try:
    from spotdl.types.song import Song
    from spotdl.utils.spotify import SpotifyClient, SpotifyError
except ImportError as exc:  # pragma: no cover
    print(json.dumps({"ok": False, "error": f"spotdl não está instalado: {exc}"}))
    sys.exit(1)


def format_duration(seconds: Any) -> str:
    """
    Converte segundos em texto mm:ss ou hh:mm:ss.
    """

    try:
        total = int(round(float(seconds)))
    except (TypeError, ValueError):
        total = 0

    hours, remainder = divmod(max(0, total), 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


def ensure_env_defaults():
    """
    Define chaves padrão caso o usuário não possua config local do spotDL.
    """

    os.environ.setdefault("SPOTDL_DISABLE_CHECK_FOR_UPDATES", "1")
    os.environ.setdefault("SPOTDL_DISABLE_SPLASH", "1")
    os.environ.setdefault("SPOTIPY_CLIENT_ID", DEFAULT_CLIENT_ID)
    os.environ.setdefault("SPOTIPY_CLIENT_SECRET", DEFAULT_CLIENT_SECRET)


def init_spotify_client():
    """
    Inicializa o cliente Spotify usado pelo spotDL.
    """

    client_id = os.environ.get("SPOTIPY_CLIENT_ID") or DEFAULT_CLIENT_ID
    client_secret = os.environ.get("SPOTIPY_CLIENT_SECRET") or DEFAULT_CLIENT_SECRET

    try:
        SpotifyClient.init(
            client_id=client_id,
            client_secret=client_secret,
            user_auth=False,
            cache_path=None,
            no_cache=False,
            headless=True,
        )
    except SpotifyError as exc:  # pragma: no cover
        if "already been initialized" not in str(exc):
            raise


def normalize_artist(song: Song) -> Dict[str, Any]:
    """
    Retorna informações consolidadas de artista.
    """

    artists: List[str] = list(song.artists or [])
    if not artists and song.artist:
        artists = [song.artist]
    joined = ", ".join(artists)
    return {"artists": artists, "artist": joined}


def main() -> int:
    parser = argparse.ArgumentParser(description="Extrai metadados básicos de uma faixa do Spotify.")
    parser.add_argument("--url", required=True, help="URL da música no Spotify.")
    args = parser.parse_args()

    ensure_env_defaults()
    logging.basicConfig(level=logging.ERROR, stream=sys.stderr)

    try:
        init_spotify_client()
        song = Song.from_url(args.url)
        artist_info = normalize_artist(song)

        payload = {
            "title": song.name,
            "album": song.album_name,
            "release_date": song.date,
            "duration_seconds": song.duration,
            "duration_text": format_duration(song.duration),
            "cover": song.cover_url,
            "spotify_url": song.url,
            **artist_info,
        }

        print(json.dumps({"ok": True, "result": payload}, ensure_ascii=False))
        return 0
    except Exception as exc:  # pragma: no cover
        print(
            json.dumps(
                {"ok": False, "error": str(exc), "type": exc.__class__.__name__}
            ),
            file=sys.stdout,
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
