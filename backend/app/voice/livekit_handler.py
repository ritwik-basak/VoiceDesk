import os

from livekit.api import AccessToken, VideoGrants


def generate_token(room_name: str, participant_name: str) -> str:
    """Generate a LiveKit access token for a participant joining a room."""
    token = (
        AccessToken(
            api_key=os.getenv("LIVEKIT_API_KEY"),
            api_secret=os.getenv("LIVEKIT_API_SECRET"),
        )
        .with_identity(participant_name)
        .with_grants(
            VideoGrants(
                room=room_name,
                room_join=True,
                can_publish=True,
                can_subscribe=True,
            )
        )
    )
    return token.to_jwt()


def get_livekit_url() -> str:
    """Return the LiveKit server URL from environment."""
    return os.getenv("LIVEKIT_URL")
