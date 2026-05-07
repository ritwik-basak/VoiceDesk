<div align="center">

# VoiceDesk — Agentic Voice AI for Conversational Healthcare Automation

## Real-time voice agent for hospital appointment booking with symptom-based doctor recommendation, emergency services, and full observability

</div>

A production-ready AI voice agent that lets patients book, cancel, and manage hospital appointments entirely by speaking. The agent identifies returning patients, collects symptoms to recommend the right specialist, detects intent, finds the earliest available slot, and confirms bookings — all in a natural phone-like conversation over a live WebRTC audio stream. Includes an emergency escalation path with ambulance routing and human handoff.

![Python](https://img.shields.io/badge/Python-3.11-blue?style=flat&logo=python)
![FastAPI](https://img.shields.io/badge/FastAPI-Backend-green?style=flat&logo=fastapi)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react)
![Vite](https://img.shields.io/badge/Vite-Frontend-646CFF?style=flat&logo=vite)
![LangGraph](https://img.shields.io/badge/LangGraph-Agent_Orchestration-purple?style=flat)
![LiveKit](https://img.shields.io/badge/LiveKit-Voice_Platform-orange?style=flat)
![Groq](https://img.shields.io/badge/Groq-LLM-F55036?style=flat)
![Deepgram](https://img.shields.io/badge/Deepgram-STT-13EF93?style=flat&logo=deepgram&logoColor=black)
![Cartesia](https://img.shields.io/badge/Cartesia-TTS-black?style=flat)
![Supabase](https://img.shields.io/badge/Supabase-Database-green?style=flat&logo=supabase)
![Langfuse](https://img.shields.io/badge/Langfuse-Observability-blue?style=flat)
![Docker](https://img.shields.io/badge/Docker-Deployment-2496ED?style=flat&logo=docker)

---

## Key Highlights

- Built a voice-first multi-agent booking system using LangGraph's state machine architecture, routing across Receptionist → Booking → Summary agents based on conversation stage and detected intent.
- Engineered symptom-based doctor recommendation: the agent collects the patient's symptoms before listing doctors, narrows the specialty match, and suggests the most relevant specialist — reducing back-and-forth compared to open-ended doctor selection.
- Engineered a real-time voice pipeline: Deepgram Nova-2 for streaming STT, Cartesia Sonic for low-latency TTS, and LiveKit WebRTC for full-duplex audio between patient and agent.
- Implemented robust spoken-input parsing to handle natural speech variations — "nine AM", "two thirty", "double 5", "triple 3" — converting to structured time and phone number formats before tool invocation.
- Built an emergency escalation path: the agent detects emergency keywords in speech, surfaces an emergency panel with ambulance routing (Leaflet map) and a one-tap human handoff, and exits the booking flow immediately.
- Built persistent conversation state using LangGraph's PostgreSQL checkpointer (Supabase), so sessions survive restarts and can resume mid-conversation.
- Full LLM observability via Langfuse: every LangGraph span, tool call, token count, and latency is traced end-to-end.
- Deployed via Docker Compose on Oracle Cloud Always Free (ARM) with GitHub Actions CI/CD — `git push` to `main` auto-deploys in under 30 seconds.

---

## Use Cases

- Patient describes symptoms and the agent recommends the right specialist before booking
- Patient calls to book a new appointment with a preferred or recommended doctor
- Returning patient checks or retrieves upcoming appointments
- Patient cancels or reschedules an existing appointment
- Agent proactively recommends the earliest available slot when a patient has no time preference
- Emergency detection mid-call: agent surfaces ambulance routing and transfers to a human agent immediately

---

## Architecture

```text
                        ┌─────────────────────────────────┐
                        │         React Frontend           │
                        │  Call UI · Calendar · Analytics  │
                        └────────────┬────────────────────┘
                                     │  LiveKit WebRTC (audio)
                                     │  SSE (tool call updates)
                        ┌────────────▼────────────────────┐
                        │        FastAPI Backend           │
                        │                                  │
                        │  POST /livekit/token  → room JWT │
                        │  GET  /sse/{thread}   → updates  │
                        │  GET  /health         → status   │
                        └────────────┬────────────────────┘
                                     │
                        ┌────────────▼────────────────────┐
                        │     LiveKit Agent Worker         │
                        │  Deepgram STT → LangGraph →      │
                        │  Cartesia TTS                    │
                        └────────────┬────────────────────┘
                                     │
                        ┌────────────▼────────────────────┐
                        │      LangGraph State Machine     │
                        │                                  │
                        │  Receptionist Agent              │
                        │   └─ identify patient            │
                        │   └─ detect intent               │
                        │                                  │
                        │  Booking Agent                   │
                        │   └─ list doctors / slots        │
                        │   └─ conflict check              │
                        │   └─ book / cancel / retrieve    │
                        │                                  │
                        │  Summary Agent                   │
                        │   └─ confirm & persist           │
                        └────────────┬────────────────────┘
                                     │
                        ┌────────────▼────────────────────┐
                        │  Supabase (PostgreSQL)           │
                        │  Users · Doctors · Slots ·       │
                        │  Appointments · LG Checkpointer  │
                        └─────────────────────────────────┘
```

---

## Conversation Flow

```
GREETING → IDENTIFY_USER → INTENT_DETECTION → ACTION → CONFIRMATION → END
```

**Agent Responsibilities**

| Agent | Role |
|-------|------|
| **Receptionist** | Greets caller, verifies identity (name + phone), detects intent (book / cancel / retrieve / modify / list_doctors / end) |
| **Booking** | Fetches doctors and slots, checks conflicts, finds earliest availability, books or cancels appointments |
| **Summary** | Confirms all actions taken, generates call summary, persists final state to database |

---

## Tools Available to Agents

| Tool | Description |
|------|-------------|
| `identify_user` | Look up or register a patient by phone number |
| `get_patient_profile` | Return full history and upcoming appointments |
| `get_doctors` | List all available doctors |
| `fetch_slots_by_doctor` | Get open time slots for a specific doctor |
| `find_earliest_available` | Recommend the soonest open slot proactively |
| `check_appointment_conflict` | Prevent double-booking on the same day |
| `book_appointment` | Create a confirmed appointment in the database |
| `retrieve_appointments` | Show all upcoming appointments for a patient |
| `cancel_appointment` | Remove a booking by appointment ID |

---

## Project Structure

```text
voice-ai/
│
├── backend/
│   ├── main.py                   # FastAPI app, LiveKit token endpoint, SSE, daily slot refresh
│   ├── agent_worker.py           # LiveKit agent session handler (STT → LangGraph → TTS)
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── .env.example
│   └── app/
│       ├── agent/
│       │   ├── graph.py          # LangGraph state machine, Groq LLM, Langfuse tracing
│       │   └── agents.py         # Receptionist, Booking, Summary agent prompts
│       ├── tools/
│       │   └── appointment_tools.py  # All LangChain tools + spoken-input parsers
│       ├── voice/
│       │   ├── pipeline.py       # VoicePipeline: coordinates STT → agent → TTS
│       │   ├── stt.py            # Deepgram Nova-2 streaming transcription
│       │   ├── tts.py            # Cartesia Sonic synthesis (batch + streaming)
│       │   └── livekit_handler.py # LiveKit room token generation
│       └── db/
│           └── queries.py        # All Supabase async queries
│
├── frontend/
│   └── src/
│       ├── App.jsx               # Tab router: Call ↔ Analytics
│       ├── pages/
│       │   ├── CallPage.jsx      # Main voice UI with EQ animation and stage badges
│       │   └── AnalyticsPage.jsx # Call metrics and history dashboard
│       ├── components/
│       │   ├── Avatar.jsx        # Animated agent avatar with speaking indicator
│       │   ├── CallControls.jsx  # Start / End call buttons
│       │   ├── CostTracker.jsx   # Live token count + USD cost display
│       │   ├── SummaryCard.jsx   # Post-call booking confirmation
│       │   ├── SlotCalendar.jsx  # 2-week interactive appointment slot picker
│       │   ├── ToolCallCard.jsx  # Real-time tool execution status cards
│       │   ├── EscalationCard.jsx # Human agent handoff UI
│       │   └── EmergencyPanel.jsx # Emergency contact + ambulance dispatch
│       └── hooks/
│           ├── useLiveKit.js     # LiveKit room connection, audio graph, gain control
│           └── useConversation.js # Conversation state, SSE polling, tool call tracking
│
├── docker-compose.yml            # api service (port 8000) + agent worker service
├── .github/
│   └── workflows/
│       └── deploy.yml            # GitHub Actions: SSH into Oracle VM on push to main
└── AGENTS.md                     # Project conventions and architecture guide
```

---

## Tech Stack

**Frontend**
- React 19 — component-based voice call UI
- Vite — fast dev server and production bundler
- Tailwind CSS — utility-first styling
- LiveKit Client — WebRTC audio room connection
- Lucide React — icon system
- Leaflet + React Leaflet — ambulance routing map
- jsPDF — appointment slip PDF export
- Lottie React — animations
- date-fns — date/time utilities

**Backend**
- FastAPI — API server (LiveKit token, SSE, health endpoints)
- Uvicorn — ASGI server
- LangGraph — multi-agent state machine orchestration
- LangChain + langchain-groq — LLM abstraction and Groq integration
- LiveKit Agents — agent session management framework
- livekit-plugins-deepgram — Deepgram STT integration
- livekit-plugins-cartesia — Cartesia TTS integration
- livekit-plugins-silero — Voice Activity Detection
- langgraph-checkpoint-postgres — PostgreSQL state persistence
- sse-starlette — Server-Sent Events for real-time frontend updates

**AI / Voice**
- Groq `llama-3.3-70b-versatile` — primary LLM for all agents
- Deepgram Nova-2 (`en-IN`) — streaming speech-to-text
- Cartesia Sonic-2 — low-latency text-to-speech synthesis
- Langfuse — LLM observability, tracing, token tracking

**Infrastructure**
- Supabase (PostgreSQL) — database for users, doctors, slots, appointments, and LangGraph checkpointer
- LiveKit Cloud — managed WebRTC media server
- Docker Compose — multi-service containerized deployment
- Oracle Cloud Always Free (ARM) — VM.Standard.A1.Flex, 4 vCPU, 24 GB RAM
- GitHub Actions + appleboy/ssh-action — CI/CD pipeline (push → auto-deploy)
- Vercel — frontend hosting

---

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+
- Groq API key
- Supabase project (PostgreSQL database)
- LiveKit Cloud account (URL, API key, API secret)
- Deepgram API key
- Cartesia API key
- Langfuse account (optional, for observability)

### 1. Backend Setup

#### Create and activate a virtual environment

**Windows**
```bash
python -m venv venv
venv\Scripts\activate
```

**Mac/Linux**
```bash
python3 -m venv venv
source venv/bin/activate
```

#### Install dependencies
```bash
cd backend
pip install -r requirements.txt
```

#### Configure environment variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

```env
# LLM
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=llama-3.3-70b-versatile

# Database
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_anon_key
SUPABASE_SERVICE_KEY=your_service_role_key
SUPABASE_DB_URL=postgresql://postgres.xxx:password@host:6543/postgres

# LiveKit
LIVEKIT_URL=wss://your-app.livekit.cloud
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret

# Speech-to-Text
DEEPGRAM_API_KEY=your_deepgram_key

# Text-to-Speech
TTS_PROVIDER=cartesia
CARTESIA_API_KEY=your_cartesia_key
CARTESIA_MODEL=sonic-2
CARTESIA_VOICE_ID=your_voice_id

# Observability
LANGFUSE_PUBLIC_KEY=your_public_key
LANGFUSE_SECRET_KEY=your_secret_key
LANGFUSE_BASE_URL=https://jp.cloud.langfuse.com
```

#### Run the backend API server
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

#### Run the LiveKit agent worker (separate terminal)
```bash
python agent_worker.py
```

Both processes must run simultaneously. The API server handles HTTP and SSE; the agent worker listens for incoming voice sessions.

---

### 2. Frontend Setup

```bash
cd frontend
npm install
```

Create a `.env` file in `frontend/`:
```env
VITE_BACKEND_URL=http://localhost:8000
```

Start the dev server:
```bash
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## Demo Walkthrough

1. Open the app and click **Start Call**
2. The agent greets you and asks for your name and phone number
3. Say your name and phone number naturally — the agent handles spoken digit variations ("double 5", "nine AM", etc.)
4. State your intent: *"I'd like to book an appointment with Dr. Sharma"*
5. The agent checks available slots and recommends the earliest one
6. Confirm the slot verbally — the agent books it and reads back the confirmation
7. The **Summary Card** appears with full booking details after the call ends
8. Switch to the **Analytics** tab to review call metrics, token usage, and cost

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check and service status |
| `POST` | `/livekit/token` | Generate a LiveKit room token for a new session |
| `GET` | `/sse/{thread_id}` | SSE stream of real-time tool call and state updates |

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | Yes | Groq API key for LLM inference |
| `GROQ_MODEL` | Yes | Model ID (default: `llama-3.3-70b-versatile`) |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_KEY` | Yes | Supabase anon key (public client) |
| `SUPABASE_SERVICE_KEY` | Yes | Supabase service role key (admin operations) |
| `SUPABASE_DB_URL` | Yes | PostgreSQL connection string for LangGraph checkpointer |
| `LIVEKIT_URL` | Yes | LiveKit Cloud WebSocket URL |
| `LIVEKIT_API_KEY` | Yes | LiveKit API key |
| `LIVEKIT_API_SECRET` | Yes | LiveKit API secret |
| `DEEPGRAM_API_KEY` | Yes | Deepgram speech-to-text key |
| `TTS_PROVIDER` | Yes | Active TTS provider (`cartesia` / `deepgram` / `elevenlabs`) |
| `CARTESIA_API_KEY` | Yes | Cartesia TTS key |
| `CARTESIA_MODEL` | Yes | Cartesia model (default: `sonic-2`) |
| `CARTESIA_VOICE_ID` | Yes | Cartesia voice UUID |
| `LANGFUSE_PUBLIC_KEY` | Optional | Langfuse public key for tracing |
| `LANGFUSE_SECRET_KEY` | Optional | Langfuse secret key |
| `LANGFUSE_BASE_URL` | Optional | Langfuse server URL |

---

## Deployment

### Docker (Production)

Both services are defined in `docker-compose.yml`:

```bash
docker compose up -d --build
```

- `api` — FastAPI server on port 8000
- `agent` — LiveKit agent worker (no exposed port, connects to LiveKit Cloud)

### CI/CD with GitHub Actions

On every push to `main`, GitHub Actions SSHes into the Oracle VM and rebuilds:

```yaml
# .github/workflows/deploy.yml
script: |
  cd ~/voice-ai
  git pull origin main
  docker compose up -d --build
```

Required GitHub secrets: `ORACLE_HOST`, `ORACLE_SSH_KEY`.

### Vercel (Frontend)

1. Connect your GitHub repository to Vercel
2. Set **Root Directory** to `frontend`
3. Add environment variable: `VITE_BACKEND_URL=http://your-oracle-ip:8000`
4. Deploy

---

## Observability

Every LangGraph run is traced in Langfuse:

- Full conversation waterfall (Receptionist → Booking → Summary spans)
- Per-turn token counts (input + output) and USD cost
- Tool call durations and inputs/outputs
- LLM latency at each node

Voice infrastructure (Deepgram STT, Cartesia TTS) is handled by LiveKit Agents outside the LangGraph graph and is not traced — this is expected behavior.

---

## Notes

- Phone number is the unique patient identifier; the agent always collects it during identification
- The daily slot refresh job (`_daily_slot_refresh`) runs on startup and keeps 14 days of appointment slots populated automatically
- LangGraph's PostgreSQL checkpointer (via Supabase) persists full conversation state — sessions survive server restarts
- ElevenLabs TTS is available as a fallback; switch by setting `TTS_PROVIDER=elevenlabs` in `.env`
