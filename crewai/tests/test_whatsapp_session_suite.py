import importlib
from types import SimpleNamespace


def test_cli_whatsapp_session_test_passes_for_baileys_format(monkeypatch):
    cli = importlib.import_module("cli")

    monkeypatch.setattr(cli, "check_api", lambda: True)
    monkeypatch.setattr(
        cli,
        "fetch_json",
        lambda *_args, **_kwargs: {
            "connected": True,
            "sessionId": "default",
            "hasRemoteSession": True,
            "remoteFormat": "baileys-multifile-v1",
            "qrAvailable": False,
        },
    )

    assert cli.run_whatsapp_session_test(timeout=1) is True


def test_cli_whatsapp_session_test_fails_if_api_down(monkeypatch):
    cli = importlib.import_module("cli")
    monkeypatch.setattr(cli, "check_api", lambda: False)

    assert cli.run_whatsapp_session_test(timeout=1) is False


def test_check_bridge_does_not_crash_without_pgrep(monkeypatch):
    cli = importlib.import_module("cli")

    monkeypatch.setattr(cli.shutil, "which", lambda _cmd: None)
    monkeypatch.setattr(
        cli.subprocess,
        "run",
        lambda *_args, **_kwargs: SimpleNamespace(returncode=0, stdout="python api.py\n"),
    )

    assert cli.check_bridge() is False


def test_check_bridge_uses_ps_fallback_to_detect_connector(monkeypatch):
    cli = importlib.import_module("cli")

    monkeypatch.setattr(cli.shutil, "which", lambda _cmd: None)
    monkeypatch.setattr(
        cli.subprocess,
        "run",
        lambda *_args, **_kwargs: SimpleNamespace(
            returncode=0,
            stdout="node whatsapp-connector/index.js\npython api.py\n",
        ),
    )

    assert cli.check_bridge() is True
