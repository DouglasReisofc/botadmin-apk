#!/usr/bin/env python3
import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone

import requests

try:
    from instagrapi import Client
    from instagrapi.exceptions import ClientConnectionError, PleaseWaitFewMinutes
except ImportError as exc:
    sys.stderr.write(f"instagrapi not available: {exc}\n")
    sys.exit(2)
try:
    from pydantic.json import pydantic_encoder
except Exception:
    pydantic_encoder = None


def isoformat(dt):
    if not dt:
        return None
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc).isoformat()
        return dt.astimezone(timezone.utc).isoformat()
    return str(dt)


def login_client(client, sessionid=None, settings_path=None, username=None, password=None, force_login=False):
    if not force_login and sessionid:
        try:
            client.login_by_sessionid(sessionid)
            return {"session": True, "settings": False, "password": False}
        except Exception:
            pass

    if not force_login and settings_path and os.path.exists(settings_path) and username and password:
        try:
            client.load_settings(settings_path)
            client.login(username, password)
            client.dump_settings(settings_path)
            return {"session": False, "settings": True, "password": True}
        except Exception:
            pass

    if username and password:
        client.login(username, password)
        if settings_path:
            try:
                client.dump_settings(settings_path)
            except Exception:
                pass
        return {"session": False, "settings": bool(settings_path), "password": True}

    raise RuntimeError("Não foi possível autenticar com instagrapi.")


def build_profile_response(user, media_list, login_flags):
    profile = {
        "pk": user.pk,
        "id": user.pk,
        "username": user.username,
        "full_name": user.full_name,
        "biography": user.biography,
        "external_url": user.external_url,
        "followers": user.follower_count,
        "following": user.following_count,
        "posts": user.media_count,
        "reel_count": getattr(user, "reel_count", None),
        "igtv_count": getattr(user, "igtv_count", None),
        "is_private": user.is_private,
        "is_verified": user.is_verified,
        "profile_pic_url": user.profile_pic_url,
        "profile_pic_url_hd": user.profile_pic_url_hd,
        "category": user.category_name,
        "contact_phone_number": user.contact_phone_number,
        "public_email": user.public_email,
    }

    posts = []
    for media in media_list:
        post = {
            "pk": media.pk,
            "id": getattr(media, "id", None),
            "code": media.code,
            "taken_at": isoformat(media.taken_at),
            "media_type": media.media_type,
            "product_type": media.product_type,
            "thumbnail_url": media.thumbnail_url or getattr(media, "thumbnail_url", None),
            "like_count": getattr(media, "like_count", None),
            "comment_count": getattr(media, "comment_count", None),
            "play_count": getattr(media, "play_count", None),
            "view_count": getattr(media, "view_count", None),
            "caption_text": getattr(media, "caption_text", None),
            "video_url": getattr(media, "video_url", None),
            "main_media_url": getattr(media, "video_url", None) or getattr(media, "thumbnail_url", None),
            "permalink": f"https://www.instagram.com/p/{media.code}/" if media.code else None,
        }
        posts.append(post)

    return {
        "profile": profile,
        "recent_posts": posts,
        "fetched_at": isoformat(datetime.utcnow()),
        "login": login_flags,
    }


def collect_session_snapshot(client):
    data = {
        "sessionid": getattr(client, "sessionid", None),
        "user_id": getattr(client, "user_id", None),
        "authenticated_user": getattr(client, "authenticated_user_name", None),
        "csrftoken": None,
        "ds_user_id": None,
        "ig_did": None,
        "mid": None,
        "rur": None,
        "cookies": {},
        "timestamp": int(time.time()),
    }
    try:
        cookies = client.private.cookies.get_dict(domain=".instagram.com")
        if not cookies:
            cookies = client.private.cookies.get_dict()
        data["cookies"] = cookies
    except Exception:
        data["cookies"] = {}

    for key in ["csrftoken", "ds_user_id", "ig_did", "mid", "rur"]:
        if not data.get(key) and data["cookies"].get(key):
            data[key] = data["cookies"][key]
    if not data.get("ds_user_id"):
        data["ds_user_id"] = str(data.get("user_id") or "")
    return data


def json_default(value):
    if pydantic_encoder:
        try:
            return pydantic_encoder(value)
        except Exception:
            pass
    if isinstance(value, (datetime,)):
        return isoformat(value)
    return str(value)


def main():
    parser = argparse.ArgumentParser(description="Fetch Instagram profile via instagrapi")
    parser.add_argument("--username", required=True, help="Instagram username to inspect")
    parser.add_argument("--insta-user", dest="insta_user", help="Login username")
    parser.add_argument("--insta-pass", dest="insta_pass", help="Login password")
    parser.add_argument("--sessionid", help="Session ID cookie")
    parser.add_argument("--settings", dest="settings_path", help="Settings JSON file")
    parser.add_argument("--posts", type=int, default=6, help="How many recent posts to fetch")
    parser.add_argument("--force-login", action="store_true", help="Ignora sessão e força login com usuário/senha")
    parser.add_argument("--dump-session-json", dest="session_json", help="Onde salvar o snapshot da sessão em JSON")

    args = parser.parse_args()
    target = args.username.lstrip("@").strip()
    if not target:
        raise SystemExit("Username inválido.")

    client = Client()
    client.delay_range = [1, 3]
    flags = login_client(
        client,
        sessionid=args.sessionid,
        settings_path=args.settings_path,
        username=args.insta_user,
        password=args.insta_pass,
        force_login=args.force_login,
    )
    flags["forced_login"] = bool(args.force_login)

    session_snapshot = collect_session_snapshot(client)
    if args.session_json:
        try:
            with open(args.session_json, "w", encoding="utf-8") as fh:
                json.dump(session_snapshot, fh, ensure_ascii=False, indent=2, default=json_default)
        except Exception:
            pass

    last_error = None
    for attempt in range(3):
        try:
            user = client.user_info_by_username(target)
            break
        except (ClientConnectionError, requests.exceptions.RetryError, PleaseWaitFewMinutes) as exc:  # noqa: F821
            last_error = exc
            if attempt == 2:
                raise
            time.sleep(5 * (attempt + 1))
    else:
        raise last_error
    media_list = []
    amount = max(0, min(args.posts, 12))
    if amount:
        try:
            media_list = client.user_medias(user.pk, amount)
        except Exception:
            media_list = []

    payload = build_profile_response(user, media_list, flags)
    payload["session"] = session_snapshot
    print(json.dumps(payload, ensure_ascii=False, default=json_default))


if __name__ == "__main__":
    main()
