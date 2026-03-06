import importlib


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
