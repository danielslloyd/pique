import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..asr import whisper_stream

router = APIRouter(tags=["asr"])


@router.get("/api/asr/capabilities")
def capabilities() -> dict:
    return {"whisper_available": whisper_stream.whisper_available()}


@router.websocket("/ws/asr")
async def asr_socket(ws: WebSocket) -> None:
    """Protocol: client sends a JSON text frame {"type":"start","expected_text":...},
    then binary Int16 16kHz mono PCM frames. Server replies with JSON
    {"type":"partial","words":[{word,confidence}],"text": "..."} after each decode.
    A {"type":"stop"} text frame (or disconnect) ends the session."""
    await ws.accept()
    if not whisper_stream.whisper_available():
        await ws.send_json({"type": "error", "error": "faster-whisper not installed"})
        await ws.close()
        return

    session = whisper_stream.StreamSession()
    model = await whisper_stream.get_model()

    try:
        while True:
            message = await ws.receive()
            if message.get("type") == "websocket.disconnect":
                break
            if (text := message.get("text")) is not None:
                data = json.loads(text)
                if data.get("type") == "start":
                    session = whisper_stream.StreamSession(
                        expected_text=data.get("expected_text", "")
                    )
                    await ws.send_json({"type": "ready"})
                elif data.get("type") == "stop":
                    break
            elif (blob := message.get("bytes")) is not None:
                session.add_pcm(blob)
                if session.ready_to_decode():
                    words = await session.transcribe(model)
                    await ws.send_json(
                        {
                            "type": "partial",
                            "words": words,
                            "text": " ".join(w["word"] for w in words),
                        }
                    )
    except WebSocketDisconnect:
        pass
