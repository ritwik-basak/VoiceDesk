import os
import asyncio
from deepgram import (
    DeepgramClient,
    LiveTranscriptionEvents,
    LiveOptions,
)

class DeepgramSTT:
    def __init__(self):
        api_key = os.getenv("DEEPGRAM_API_KEY", "")
        self.client = DeepgramClient(api_key)
        self.connection = None
        self.transcript_callback = None

    async def start(self, on_transcript_callback):
        self.transcript_callback = on_transcript_callback
        try:
            self.connection = self.client.listen.live.v("1")

            def on_message(self_inner, result, **kwargs):
                try:
                    transcript = result.channel.alternatives[0].transcript
                    if transcript and result.is_final:
                        if self.transcript_callback:
                            asyncio.create_task(
                                self.transcript_callback(transcript)
                            )
                except Exception as e:
                    print(f"Transcript error: {e}")

            def on_error(self_inner, error, **kwargs):
                print(f"Deepgram error: {error}")

            self.connection.on(LiveTranscriptionEvents.Transcript, on_message)
            self.connection.on(LiveTranscriptionEvents.Error, on_error)

            options = LiveOptions(
                model="nova-2",
                language="en-IN",
                smart_format=True,
                interim_results=True,
            )

            self.connection.start(options)
            print("Deepgram STT started successfully")

        except Exception as e:
            print(f"Deepgram start error: {e}")
            import traceback
            traceback.print_exc()

    async def send_audio(self, audio_data: bytes):
        if self.connection:
            try:
                self.connection.send(audio_data)
            except Exception as e:
                print(f"Audio send error: {e}")

    async def stop(self):
        if self.connection:
            try:
                self.connection.finish()
                print("Deepgram STT stopped")
            except Exception as e:
                print(f"Deepgram stop error: {e}")
