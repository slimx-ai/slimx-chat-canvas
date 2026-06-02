"""Tests for the SlimX Chat Canvas FastAPI app.

These run against ``MODEL_BACKEND=echo`` so they need no model checkpoint,
torch, or SlimX provider — just the FastAPI app and its request/response
contract. The echo backend simply reflects the last user message, which lets us
assert that routing, validation, and message normalization all work.
"""

import os

# Echo backend must be selected before the app (and its lifespan) is imported.
os.environ["MODEL_BACKEND"] = "echo"

import pytest
from fastapi.testclient import TestClient

# server:app is the uvicorn entrypoint; it re-exports app.main.app.
from server import app
from app.main import messages_to_prompt, normalize_messages
from app.schemas import ChatRequest


@pytest.fixture(scope="module")
def client():
    # The context manager runs FastAPI startup/shutdown (lifespan); in echo mode
    # that is a no-op, but exercising it guards against startup regressions.
    with TestClient(app) as test_client:
        yield test_client


# --- /health ---------------------------------------------------------------

def test_health_reports_echo_backend(client):
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["backend"] == "echo"
    assert body["gradio"] == "removed"


# --- /api/chat happy paths -------------------------------------------------

def test_chat_with_structured_messages_echoes_last_user(client):
    response = client.post(
        "/api/chat",
        json={"messages": [{"role": "user", "content": "Hello canvas"}], "max_new_tokens": 16},
    )
    assert response.status_code == 200
    body = response.json()
    # Echo backend embeds the last user message in its reply.
    assert "Hello canvas" in body["reply"]
    # Both response fields are populated and kept in sync.
    assert body["reply"] == body["text"]
    assert body["backend"] == "echo"
    assert body["prompt_chars"] > 0


def test_chat_accepts_legacy_prompt_field(client):
    response = client.post("/api/chat", json={"prompt": "legacy prompt"})
    assert response.status_code == 200
    assert "legacy prompt" in response.json()["reply"]


def test_generate_is_an_alias_for_chat(client):
    response = client.post(
        "/generate",
        json={"messages": [{"role": "user", "content": "alias check"}]},
    )
    assert response.status_code == 200
    assert "alias check" in response.json()["reply"]


def test_comment_mode_request_is_accepted(client):
    # A self-contained comment payload: isolated excerpt + question + anchor.
    response = client.post(
        "/api/chat",
        json={
            "mode": "comment",
            "lane_id": "comment:cmt_1",
            "anchor": {"message_id": "msg_5", "quote": "selected", "start": 0, "end": 8},
            "messages": [
                {"role": "system", "content": "The user selected an excerpt."},
                {"role": "user", "content": "Excerpt: selected"},
                {"role": "user", "content": "What does this mean?"},
            ],
        },
    )
    assert response.status_code == 200
    assert "What does this mean?" in response.json()["reply"]


# --- /api/chat validation --------------------------------------------------

def test_chat_requires_messages_or_prompt(client):
    # Neither messages nor prompt -> normalize_messages raises HTTP 400.
    response = client.post("/api/chat", json={})
    assert response.status_code == 400


def test_chat_rejects_blank_message_content(client):
    response = client.post("/api/chat", json={"messages": [{"role": "user", "content": ""}]})
    assert response.status_code == 422  # pydantic min_length=1


def test_chat_rejects_unsupported_role(client):
    response = client.post("/api/chat", json={"messages": [{"role": "robot", "content": "hi"}]})
    assert response.status_code == 422  # role not in Literal[system, user, assistant]


def test_chat_rejects_unsupported_mode(client):
    response = client.post(
        "/api/chat",
        json={"messages": [{"role": "user", "content": "hi"}], "mode": "sideways"},
    )
    assert response.status_code == 422  # mode not in Literal[main, deep, comment]


# --- pure helpers ----------------------------------------------------------

def test_normalize_messages_prefers_structured_messages():
    req = ChatRequest(messages=[{"role": "user", "content": "a"}], prompt="ignored")
    assert normalize_messages(req) == [{"role": "user", "content": "a"}]


def test_normalize_messages_falls_back_to_prompt():
    req = ChatRequest(prompt="  trimmed  ")
    assert normalize_messages(req) == [{"role": "user", "content": "trimmed"}]


def test_messages_to_prompt_formats_roles_and_appends_cue():
    prompt = messages_to_prompt(
        [
            {"role": "system", "content": "sys"},
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "yo"},
            {"role": "user", "content": ""},  # dropped: empty content
        ]
    )
    assert prompt == "System: sys\nUser: hi\nAssistant: yo\nAssistant:"
