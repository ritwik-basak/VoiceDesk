import asyncio
import os

from dotenv import load_dotenv
import aiohttp
from livekit.plugins import elevenlabs


async def main():
    load_dotenv()

    voice_id = os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
    model = os.getenv("ELEVENLABS_MODEL", "eleven_turbo_v2_5")
    encoding = os.getenv("ELEVENLABS_ENCODING", "pcm_24000")
    api_key = os.getenv("ELEVENLABS_API_KEY") or os.getenv("ELEVEN_API_KEY")

    if not api_key:
        raise RuntimeError("Missing ELEVENLABS_API_KEY in backend/.env")

    session = aiohttp.ClientSession()
    tts = elevenlabs.TTS(
        voice_id=voice_id,
        model=model,
        encoding=encoding,
        api_key=api_key,
        auto_mode=False,
        http_session=session,
    )

    text = "Hello from VoiceDesk. This is an ElevenLabs test."
    total_bytes = 0
    event_count = 0

    print(
        "Testing ElevenLabs chunked TTS with "
        f"voice_id={voice_id}, model={model}, encoding={encoding}"
    )

    try:
        stream = tts.synthesize(text)
        async for event in stream:
            event_count += 1
            frame = getattr(event, "frame", None)
            if frame is not None:
                total_bytes += len(frame.data)
    finally:
        await tts.aclose()
        await session.close()

    print(f"Events received: {event_count}")
    print(f"Audio bytes received: {total_bytes}")

    if total_bytes <= 0:
        raise RuntimeError("ElevenLabs returned zero audio bytes")

    print("ElevenLabs direct TTS test passed")


if __name__ == "__main__":
    asyncio.run(main())
