import re
import uuid
from datetime import datetime

from langchain_core.messages import HumanMessage

from app.agent.graph import run_conversation_turn
from app.voice.stt import DeepgramSTT
from app.voice.tts import CartesiaTTS

_INTENT_PATTERN = re.compile(r"\n?INTENT:\s*\w+", re.IGNORECASE)


class VoicePipeline:
    def __init__(self, graph):
        self.graph = graph
        self.stt = DeepgramSTT()
        self.tts = CartesiaTTS()
        self.thread_id = str(uuid.uuid4())
        self.is_first_turn = True
        self.is_processing = False
        self.audio_callback = None

    async def start(self, on_audio_callback):
        """Start STT and register the audio output callback. Returns the thread ID."""
        self.audio_callback = on_audio_callback
        await self.stt.start(self.handle_transcript)
        return self.thread_id

    async def handle_transcript(self, transcript: str):
        """Process a finalised transcript through the agent graph and speak the reply."""
        if self.is_processing:
            return

        self.is_processing = True
        print(f"User said: {transcript}")

        try:
            initial_state = None
            if self.is_first_turn:
                initial_state = {
                    "messages": [HumanMessage(content=transcript)],
                    "phone_number": "",
                    "user_name": "",
                    "current_intent": "",
                    "conversation_stage": "GREETING",
                    "cost_usd": 0.0,
                    "tokens_used": 0,
                    "started_at": datetime.now().isoformat(),
                    "appointments_made": [],
                    "next_agent": "receptionist",
                }

            result = await run_conversation_turn(
                graph=self.graph,
                thread_id=self.thread_id,
                user_message=transcript,
                initial_state=initial_state,
            )

            response_text = result["messages"][-1].content if result["messages"] else ""

            # Strip INTENT marker before speaking
            clean_text = _INTENT_PATTERN.sub("", response_text).strip()

            audio = await self.tts.synthesize(clean_text)
            if self.audio_callback:
                await self.audio_callback(audio)

            self.is_first_turn = False
            print(f"Agent responded: {clean_text[:50]}")
        finally:
            self.is_processing = False

    async def send_audio(self, audio_data: bytes):
        """Forward raw audio bytes into the STT stream."""
        await self.stt.send_audio(audio_data)

    async def stop(self):
        """Tear down the STT connection."""
        await self.stt.stop()
        print("Voice pipeline stopped")
