import os

from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv()

SUPABASE_URL: str = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY: str = os.environ["SUPABASE_SERVICE_KEY"]

supabase_client: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
