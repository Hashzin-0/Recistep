from main import is_allowed_media_url, is_supported_source


def test_accepts_public_instagram_reel() -> None:
    assert is_supported_source("instagram", "https://www.instagram.com/reel/ABC123/")


def test_accepts_instagram_share_reel() -> None:
    assert is_supported_source("instagram", "https://www.instagram.com/share/reel/ABC123/")


def test_rejects_instagram_profile() -> None:
    assert not is_supported_source("instagram", "https://www.instagram.com/someuser/")


def test_accepts_public_tiktok_video() -> None:
    assert is_supported_source("tiktok", "https://www.tiktok.com/@cook/video/1234567890")


def test_accepts_tiktok_short_link() -> None:
    assert is_supported_source("tiktok", "https://vm.tiktok.com/ZMabc123/")


def test_rejects_other_platform() -> None:
    assert not is_supported_source("tiktok", "https://www.youtube.com/watch?v=abc")


def test_rejects_non_https_source() -> None:
    assert not is_supported_source("tiktok", "http://www.tiktok.com/@cook/video/1234567890")


def test_rejects_credentials_in_source_url() -> None:
    assert not is_supported_source("instagram", "https://user:pass@www.instagram.com/reel/ABC123/")


def test_accepts_platform_cdn_urls() -> None:
    assert is_allowed_media_url("instagram", "https://scontent.cdninstagram.com/video.mp4")
    assert is_allowed_media_url("tiktok", "https://v16.tiktok.com/video.mp4")


def test_rejects_untrusted_media_hosts() -> None:
    assert not is_allowed_media_url("instagram", "https://example.com/video.mp4")
    assert not is_allowed_media_url("tiktok", "https://example.com/video.mp4")
