from __future__ import annotations

import hmac
import os
import re
import threading
from typing import Literal
from urllib.parse import urlparse

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from yt_dlp import YoutubeDL

MAX_MEDIA_BYTES = 15 * 1024 * 1024
MAX_CONCURRENT_EXTRACTIONS = 2
API_KEY = os.getenv("MEDIA_EXTRACTOR_API_KEY", "").strip()
EXTRACTION_SLOTS = threading.BoundedSemaphore(MAX_CONCURRENT_EXTRACTIONS)

PAGE_HOSTS = {
    "instagram": {"instagram.com", "www.instagram.com", "m.instagram.com"},
    "tiktok": {"tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"},
}
MEDIA_SUFFIXES = {
    "instagram": ("cdninstagram.com", "fbcdn.net", "fbcdn.com", "instagram.com"),
    "tiktok": (
        "tiktokcdn.com", "tiktokcdn-us.com", "tiktokcdn-europe.com",
        "muscdn.com", "tiktokv.com", "tiktok.com", "byteoversea.com",
    ),
}
INSTAGRAM_POST = re.compile(r"^/(?:p|reel|reels|tv|share/(?:reel|p))/[A-Za-z0-9_-]+/?$", re.I)
TIKTOK_VIDEO = re.compile(r"^/@[^/]+/video/\d+/?$", re.I)
TIKTOK_SHORT = re.compile(r"^/(?:t|v)/[A-Za-z0-9_-]+/?$", re.I)

app = FastAPI(title="Recistep public media extractor", version="1.0.0")


class ExtractRequest(BaseModel):
    platform: Literal["instagram", "tiktok"]
    url: str = Field(min_length=10, max_length=2048)


class ExtractResponse(BaseModel):
    platform: Literal["instagram", "tiktok"]
    title: str = Field(max_length=200)
    author_name: str | None = Field(max_length=200)
    media_url: str
    mime_type: Literal["video/mp4"]
    duration_seconds: float | None
    filesize_bytes: int | None


def is_supported_source(platform: str, raw_url: str) -> bool:
    if platform not in PAGE_HOSTS:
        return False
    try:
        parsed = urlparse(raw_url)
        host = (parsed.hostname or "").lower()
        if parsed.scheme != "https" or not host or parsed.username or parsed.password or parsed.port:
            return False
        if host not in PAGE_HOSTS[platform]:
            return False
        path = parsed.path or "/"
        if platform == "instagram":
            return bool(INSTAGRAM_POST.fullmatch(path))
        if host in {"vm.tiktok.com", "vt.tiktok.com"}:
            return bool(re.fullmatch(r"/[A-Za-z0-9_-]+/?", path))
        return bool(TIKTOK_VIDEO.fullmatch(path) or TIKTOK_SHORT.fullmatch(path))
    except ValueError:
        return False


def is_allowed_media_url(platform: str, raw_url: str) -> bool:
    if platform not in MEDIA_SUFFIXES:
        return False
    try:
        parsed = urlparse(raw_url)
        host = (parsed.hostname or "").lower()
        if parsed.scheme != "https" or not host or parsed.username or parsed.password or parsed.port:
            return False
        return any(host == suffix or host.endswith("." + suffix) for suffix in MEDIA_SUFFIXES[platform])
    except ValueError:
        return False


def _pick_direct_mp4(info: dict) -> dict | None:
    candidates = list(info.get("formats") or [])
    if info.get("url"):
        candidates.append(info)

    usable = []
    for item in candidates:
        if not isinstance(item, dict):
            continue
        url = item.get("url")
        if not isinstance(url, str) or not url.startswith("https://"):
            continue
        if item.get("ext") != "mp4":
            continue
        if item.get("vcodec") in (None, "none") or item.get("acodec") in (None, "none"):
            continue
        protocol = str(item.get("protocol") or "")
        if protocol not in {"https", "http", "mhtml"}:
            continue
        if item.get("manifest_url") or item.get("fragments"):
            continue
        size = item.get("filesize") or item.get("filesize_approx")
        if isinstance(size, (int, float)) and size > MAX_MEDIA_BYTES:
            continue
        height = item.get("height") if isinstance(item.get("height"), int) else 0
        if height > 1080:
            continue
        bitrate = item.get("tbr") if isinstance(item.get("tbr"), (int, float)) else 0
        usable.append((height, bitrate, item))

    if not usable:
        return None
    usable.sort(key=lambda entry: (entry[0], entry[1]), reverse=True)
    return usable[0][2]


def _extract_public_video(platform: str, source_url: str) -> ExtractResponse:
    options = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "socket_timeout": 8,
        "retries": 1,
        "extractor_retries": 1,
        "ignoreerrors": False,
        "no_color": True,
    }
    with YoutubeDL(options) as ydl:
        info = ydl.extract_info(source_url, download=False)

    if not isinstance(info, dict) or info.get("entries") or info.get("_type") in {"playlist", "multi_video"}:
        raise HTTPException(status_code=422, detail="SOURCE_IS_NOT_A_SINGLE_PUBLIC_VIDEO")

    extractor_key = str(info.get("extractor_key") or "").lower()
    if platform not in extractor_key:
        raise HTTPException(status_code=422, detail="EXTRACTOR_PLATFORM_MISMATCH")

    media = _pick_direct_mp4(info)
    if not media or not is_allowed_media_url(platform, str(media.get("url") or "")):
        raise HTTPException(status_code=422, detail="PUBLIC_MP4_UNAVAILABLE")

    size = media.get("filesize") or media.get("filesize_approx")
    size_value = int(size) if isinstance(size, (int, float)) and size >= 0 else None
    duration = info.get("duration")
    duration_value = float(duration) if isinstance(duration, (int, float)) and duration >= 0 else None
    title = str(info.get("title") or info.get("description") or f"Vídeo de {platform.title()}").strip()
    author = info.get("uploader") or info.get("channel") or info.get("creator")
    author_value = str(author).strip()[:200] if author else None

    return ExtractResponse(
        platform=platform,
        title=title[:200] or f"Vídeo de {platform.title()}",
        author_name=author_value,
        media_url=str(media["url"]),
        mime_type="video/mp4",
        duration_seconds=duration_value,
        filesize_bytes=size_value,
    )


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/extract", response_model=ExtractResponse)
def extract_video(
    request: ExtractRequest,
    authorization: str | None = Header(default=None),
) -> ExtractResponse:
    if not API_KEY:
        raise HTTPException(status_code=503, detail="EXTRACTOR_NOT_CONFIGURED")
    expected = f"Bearer {API_KEY}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="UNAUTHORIZED")
    if not is_supported_source(request.platform, request.url):
        raise HTTPException(status_code=422, detail="UNSUPPORTED_PUBLIC_VIDEO_URL")
    if not EXTRACTION_SLOTS.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="EXTRACTOR_BUSY")
    try:
        try:
            return _extract_public_video(request.platform, request.url)
        except HTTPException:
            raise
        except Exception:
            # Do not expose extractor internals, cookies, signed URLs, or source details.
            raise HTTPException(status_code=422, detail="PUBLIC_MEDIA_EXTRACTION_FAILED") from None
    finally:
        EXTRACTION_SLOTS.release()
