import base64
import json
import logging
from collections.abc import AsyncIterator

import anthropic
from starlette.concurrency import run_in_threadpool

from src.config import settings
from src.prompts.teacher import ARRANGER_SYSTEM, CHAT_SYSTEM, SONG_CONTEXT_TEMPLATE, TRANSCRIBER_SYSTEM
from src.schemas.arrangement import Arrangement
from src.schemas.chat import ChatMessage, PlayerPosition
from src.schemas.song import GenerateRequest, SongOut
from src.services.arrangement import format_measures
from src.services.sheet_images import prepare_page

logger = logging.getLogger(__name__)

# On a safety-classifier decline the API re-runs the request on a fallback model.
FALLBACK_BETA = "server-side-fallback-2026-07-01"
IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
PDF_TYPE = "application/pdf"

_client: anthropic.AsyncAnthropic | None = None


class LlmError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        headers = {"anthropic-workspace-id": settings.ai_workspace_id} if settings.ai_workspace_id else None
        _client = anthropic.AsyncAnthropic(api_key=settings.ai_api_key or None, default_headers=headers)
    return _client


async def generate_arrangement(request: GenerateRequest) -> Arrangement:
    hands = {"both": "both hands", "right": "the right hand only", "left": "the left hand only"}[request.hands]
    prompt = (
        f"Arrange '{request.title}'"
        + (f" by {request.artist}" if request.artist else "")
        + f" for piano at {request.difficulty} level, for {hands}."
    )
    if request.instructions:
        prompt += f"\n\nStudent's requests: {request.instructions}"
    return await _structured(ARRANGER_SYSTEM, [{"type": "text", "text": prompt}])


async def transcribe_sheet(files: list[tuple[str, bytes]], title_hint: str | None) -> Arrangement:
    content: list[dict] = []
    for number, (media_type, data) in enumerate(files, start=1):
        if media_type == PDF_TYPE:
            content.append({"type": "text", "text": f"Page file {number} (PDF):"})
            content.append(_block("document", PDF_TYPE, data))
            continue
        whole, *slices = await run_in_threadpool(prepare_page, data)
        content.append({"type": "text", "text": f"Page {number}, whole page (use for layout and bar order):"})
        content.append(_block("image", "image/png", whole))
        for i, piece in enumerate(slices, start=1):
            content.append({"type": "text", "text": f"Page {number}, enlarged slice {i} of {len(slices)}, top to bottom:"})
            content.append(_block("image", "image/png", piece))
    text = (
        "Transcribe this sheet music. Pages are in order. The enlarged slices repeat parts of the "
        "whole page at higher resolution: read pitches from them, and transcribe each bar once."
    )
    if title_hint:
        text += f" The piece is called '{title_hint}'."
    content.append({"type": "text", "text": text})
    return await _structured(TRANSCRIBER_SYSTEM, content)


def _block(kind: str, media_type: str, data: bytes) -> dict:
    encoded = base64.standard_b64encode(data).decode("ascii")
    return {"type": kind, "source": {"type": "base64", "media_type": media_type, "data": encoded}}


async def _structured(system: str, content: list[dict], effort: str = "high") -> Arrangement:
    try:
        # Songs can run to thousands of notes, so stream to avoid HTTP timeouts.
        async with get_client().beta.messages.stream(
            model=settings.ai_model,
            max_tokens=64000,
            betas=[FALLBACK_BETA],
            fallbacks="default",
            output_config={"effort": effort},
            output_format=Arrangement,
            system=system,
            messages=[{"role": "user", "content": content}],
        ) as stream:
            message = await stream.get_final_message()
    except anthropic.APIError as exc:
        raise _api_error(exc) from exc

    if message.stop_reason == "refusal":
        raise LlmError("The AI declined this request.", 422)
    if message.stop_reason == "max_tokens":
        raise LlmError("The song was too long to finish in one go. Try a shorter section.", 422)
    if message.parsed_output is None:
        raise LlmError("The AI's reply could not be read as a song.")
    return message.parsed_output


async def stream_chat(
    messages: list[ChatMessage], song: SongOut | None, position: PlayerPosition | None
) -> AsyncIterator[str]:
    """Yield server-sent-event lines: text deltas, then a final done or error event."""
    system = [{"type": "text", "text": CHAT_SYSTEM}]
    if song:
        system.append({"type": "text", "text": _song_context(song), "cache_control": {"type": "ephemeral"}})

    history = [{"role": m.role, "content": m.content} for m in messages]
    if position and history and history[-1]["role"] == "user":
        where = f"<player_position>Measure {position.measure}, beat {position.beat:g}</player_position>\n"
        history[-1]["content"] = where + history[-1]["content"]

    try:
        async with get_client().beta.messages.stream(
            model=settings.ai_model,
            max_tokens=16000,
            betas=[FALLBACK_BETA],
            fallbacks="default",
            output_config={"effort": "medium"},
            system=system,
            messages=history,
        ) as stream:
            async for text in stream.text_stream:
                yield _sse({"type": "text", "text": text})
            message = await stream.get_final_message()
        if message.stop_reason == "refusal":
            yield _sse({"type": "error", "message": "The AI declined to answer that."})
        else:
            yield _sse({"type": "done"})
    except anthropic.APIError as exc:
        yield _sse({"type": "error", "message": _api_error(exc).message})


def _song_context(song: SongOut) -> str:
    ts = f"{song.time_signature[0]}/{song.time_signature[1]}"
    notes = f"Teacher notes: {song.teacher_notes}" if song.teacher_notes else ""
    return SONG_CONTEXT_TEMPLATE.format(
        title=song.title,
        artist=song.artist or "unknown",
        key=song.key or "unknown",
        time_signature=ts,
        tempo=song.tempo,
        measures=format_measures(song.notes, song.measures, song.time_signature),
        teacher_notes=notes,
    )


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _api_error(exc: anthropic.APIError) -> LlmError:
    logger.warning("LLM API error: %s", exc)
    if isinstance(exc, anthropic.AuthenticationError):
        return LlmError("No valid AI API key. Add AI_API_KEY to backend/.env.", 503)
    if isinstance(exc, anthropic.RateLimitError):
        return LlmError("The AI service is rate limited right now. Try again in a minute.", 429)
    if isinstance(exc, anthropic.BadRequestError):
        body = exc.body if isinstance(exc.body, dict) else {}
        detail = body.get("error", {}).get("message") or exc.message
        return LlmError(f"The AI service rejected the request: {detail}", 400)
    if isinstance(exc, anthropic.APIStatusError):
        return LlmError(f"AI service error ({exc.status_code}). Try again shortly.")
    return LlmError("Could not reach the AI service. Check your internet connection.")
