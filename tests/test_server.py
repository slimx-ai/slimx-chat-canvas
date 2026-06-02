from dataclasses import dataclass

from fastapi.testclient import TestClient

import server

client = TestClient(server.app)


@dataclass
class FakeSlimXResult:
    text: str


class FakeSlimXModel:
    def __init__(self):
        self.prompts = []

    def __call__(self, prompt):
        self.prompts.append(prompt)
        return FakeSlimXResult(text="hello from slimx")


def test_healthz_reports_ok():
    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readyz_reports_slimx_configuration():
    response = client.get("/readyz")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["slimx_configured"] is True
    assert body["slimx_model"] == server.SLIMX_MODEL


def test_env_float_falls_back_for_invalid_values(monkeypatch):
    monkeypatch.setenv("BROKEN_FLOAT", "not-a-float")

    assert server.env_float("BROKEN_FLOAT", 1.5) == 1.5


def test_env_int_falls_back_for_invalid_values(monkeypatch):
    monkeypatch.setenv("BROKEN_INT", "not-an-int")

    assert server.env_int("BROKEN_INT", 3) == 3


def test_create_slimx_model_passes_runtime_options(monkeypatch):
    seen = {}

    def fake_llm(model, **kwargs):
        seen["model"] = model
        seen["kwargs"] = kwargs
        return FakeSlimXModel()

    monkeypatch.setattr(server, "llm", fake_llm)
    monkeypatch.setattr(server, "SLIMX_MODEL", "openai:test")
    monkeypatch.setattr(server, "SLIMX_TEMPERATURE", 0.4)
    monkeypatch.setattr(server, "SLIMX_MAX_TOKENS", 256)
    monkeypatch.setattr(server, "SLIMX_TIMEOUT", 12.0)
    monkeypatch.setattr(server, "SLIMX_RETRIES", 4)

    model = server.create_slimx_model()

    assert isinstance(model, FakeSlimXModel)
    assert seen == {
        "model": "openai:test",
        "kwargs": {
            "temperature": 0.4,
            "max_tokens": 256,
            "timeout": 12.0,
            "retries": 4,
        },
    }


def test_call_model_uses_slimx_model(monkeypatch):
    model = FakeSlimXModel()
    monkeypatch.setattr(server, "get_slimx_model", lambda: model)

    assert server.call_model("hello") == "hello from slimx"
    assert model.prompts == ["hello"]


def test_chat_endpoint_strips_prompt_and_returns_reply(monkeypatch):
    seen = {}

    def fake_call_model(prompt):
        seen["prompt"] = prompt
        return "hello from slimx"

    monkeypatch.setattr(server, "call_model", fake_call_model)

    response = client.post("/api/chat", json={"prompt": "  hello  "})

    assert response.status_code == 200
    assert response.json() == {"reply": "hello from slimx"}
    assert seen["prompt"] == "hello"


def test_chat_endpoint_rejects_blank_prompt():
    response = client.post("/api/chat", json={"prompt": "   "})

    assert response.status_code == 422
    assert response.json()["detail"] == "Prompt cannot be blank."
