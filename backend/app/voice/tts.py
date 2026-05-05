import asyncio
import os

import cartesia


class CartesiaTTS:
    def __init__(self):
        self.client = cartesia.Cartesia(api_key=os.getenv("CARTESIA_API_KEY"))
        self.voice_id = "a0e99841-438c-4a64-b679-ae501e7d6091"
        self.model_id = "sonic-english"

    async def synthesize(self, text: str) -> bytes:
        """Convert text to audio bytes (blocking call run in executor)."""
        loop = asyncio.get_event_loop()
        audio = await loop.run_in_executor(
            None,
            lambda: self.client.tts.bytes(
                model_id=self.model_id,
                transcript=text,
                voice={"id": self.voice_id},
                output_format={
                    "container": "raw",
                    "encoding": "pcm_f32le",
                    "sample_rate": 44100,
                },
            ),
        )
        return audio

    async def synthesize_streaming(self, text: str):
        """Stream audio chunks via SSE as they are generated."""
        loop = asyncio.get_event_loop()
        stream = await loop.run_in_executor(
            None,
            lambda: self.client.tts.sse(
                model_id=self.model_id,
                transcript=text,
                voice={"id": self.voice_id},
                output_format={
                    "container": "raw",
                    "encoding": "pcm_f32le",
                    "sample_rate": 44100,
                },
            ),
        )
        for chunk in stream:
            yield chunk
