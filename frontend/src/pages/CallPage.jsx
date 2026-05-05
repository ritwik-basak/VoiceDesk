import { useRef, useState, useEffect } from "react";
import {
  Heart, Stethoscope, Sparkles, Bone, Brain, Baby,
  Flower2, Ear, Eye, Lightbulb, Droplets, Wind,
  Zap, Droplet, Activity, Hospital,
} from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import Avatar from "../components/Avatar.jsx";
import CallControls from "../components/CallControls.jsx";
import SummaryCard from "../components/SummaryCard.jsx";
import SlotCalendar from "../components/SlotCalendar.jsx";
import EscalationCard from "../components/EscalationCard.jsx";
import EmergencyPanel, { EmergencyBanner, AmbulanceSlip } from "../components/EmergencyPanel.jsx";
import { useLiveKit } from "../hooks/useLiveKit.js";
import { useConversation } from "../hooks/useConversation.js";

const BASE = import.meta.env.VITE_BACKEND_URL;
const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL;

const STAGE_META = {
  GREETING: { label: "Greeting", cls: "bg-sky-100 text-sky-700" },
  IDENTIFIED: {
    label: "User Identified",
    cls: "bg-emerald-100 text-emerald-700",
  },
  ACTIVE: { label: "Active Call", cls: "bg-emerald-100 text-emerald-700" },
  END: { label: "Call Ended", cls: "bg-gray-100 text-gray-500" },
};

const VOICE_BAR_STYLES = `
  @keyframes vd-bar { 0%,100%{transform:scaleY(0.15)} 50%{transform:scaleY(1)} }
`

const PROCESSING_WORDS = [
  'Thinking...', 'Processing...', 'Analysing...', 'Checking records...', 'Consulting...', 'Preparing...',
]

const BAR_HEIGHTS = [22, 34, 48, 60, 50, 34, 56, 46, 28, 40, 24]
const BAR_SPEEDS  = [0.55, 0.68, 0.72, 0.62, 0.50, 0.70, 0.60, 0.65, 0.53, 0.67, 0.57]
const BAR_DELAYS  = [0, 0.08, 0.18, 0.12, 0.05, 0.22, 0.10, 0.16, 0.03, 0.13, 0.07]

function EqBars({ slow }) {
  return (
    <div className="flex items-center gap-[4px]">
      {BAR_HEIGHTS.map((h, i) => (
        <div
          key={i}
          className="rounded-full bg-gray-700 origin-center"
          style={{
            width: 2,
            height: h,
            animation: `vd-bar ${BAR_SPEEDS[i] * (slow ? 1.7 : 1)}s ease-in-out ${BAR_DELAYS[i]}s infinite`,
          }}
        />
      ))}
    </div>
  )
}

function VoiceActivityBar({ state }) {
  const [wordIdx, setWordIdx] = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (state !== 'processing') {
      setWordIdx(0)
      setVisible(true)
      return
    }
    const id = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setWordIdx(i => (i + 1) % PROCESSING_WORDS.length)
        setVisible(true)
      }, 220)
    }, 1800)
    return () => clearInterval(id)
  }, [state])

  return (
    <>
      <style>{VOICE_BAR_STYLES}</style>
      <div className="flex flex-col items-center gap-2" style={{ height: 76, justifyContent: 'center' }}>
        {state === 'listening' && (
          <>
            <EqBars slow={false} />
            <span className="text-[11px] text-gray-600 font-semibold tracking-widest uppercase">Listening</span>
          </>
        )}
        {state === 'processing' && (
          <>
            <EqBars slow={true} />
            <span
              className="text-[11px] text-gray-600 font-semibold tracking-widest uppercase"
              style={{ transition: 'opacity 0.2s ease', opacity: visible ? 1 : 0 }}
            >
              {PROCESSING_WORDS[wordIdx]}
            </span>
          </>
        )}
      </div>
    </>
  )
}

function AssistantLoading({ label }) {
  return (
    <div className="fixed inset-0 bg-white/45 backdrop-blur-[2px] z-40 flex items-center justify-center">
      <div className="bg-white border border-sky-100 rounded-2xl shadow-2xl px-6 py-5 flex items-center gap-4">
        <div className="relative w-14 h-14">
          <div className="absolute inset-0 rounded-full border-4 border-sky-100" />
          <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-primary border-r-secondary animate-spin" />
          <div className="absolute inset-3 rounded-full bg-gradient-to-br from-primary/10 to-secondary/10" />
          <div className="absolute inset-[22px] rounded-full bg-secondary animate-pulse" />
        </div>
        <div>
          <p className="text-sm font-bold text-gray-900 font-poppins">
            {label}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">
            VoiceDesk is updating the live call flow.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function CallPage({ onCallActiveChange }) {
  const [isLoading, setIsLoading] = useState(false);
  const [devConnected, setDevConnected] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [callDuration, setCallDuration] = useState("00:00");
  const [currentRoomName, setCurrentRoomName] = useState("");
  const [currentThreadId, setCurrentThreadId] = useState("");
  const [assistantPending, setAssistantPending] = useState(false);
  const [assistantPendingLabel, setAssistantPendingLabel] = useState(
    "Preparing assistant response",
  );

  // Emergency flow state
  const [phoneWasSubmitted, setPhoneWasSubmitted] = useState(false);
  const [emergencyStep, setEmergencyStep] = useState(null); // null | 'options' | 'callback_confirmed' | 'ambulance_form' | 'ambulance_confirmed'
  const [ambulanceAddress, setAmbulanceAddress] = useState('');
  const [ambulancePincode, setAmbulancePincode] = useState('');
  const [ambulanceMapPin, setAmbulanceMapPin] = useState(null);
  const [ambulanceBookingRef, setAmbulanceBookingRef] = useState('');
  const [ambulanceDispatchTime, setAmbulanceDispatchTime] = useState('');
  const [showAmbulanceSlipModal, setShowAmbulanceSlipModal] = useState(false);
  const autoEndedRef = useRef(false);
  const pendingSinceRef = useRef(null);
  const wasListeningRef = useRef(false);
  const [voiceState, setVoiceState] = useState('idle');

  const roomNameRef = useRef("");
  const threadIdRef = useRef("");
  const isFirstTurnRef = useRef(true);
  const startTimeRef = useRef(null);
  const pollingRef = useRef(null);

  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const { isConnected, isSpeaking, userSpeaking, agentSpeaking, volume, setVolume, analyserRef, connect, disconnect, setMicEnabled } =
    useLiveKit();
  const {
    conversationStage,
    currentIntent,
    tokensUsed,
    costUsd,
    appointmentsMade,
    callSummary,
    toolCalls,
    sendMessage,
    resetConversation,
    startPolling,
    stopPolling,
    doctors,
    setDoctors,
    slotGrid,
    setSlotGrid,
    patient,
    appointmentSlip,
    addToolEvent,
    rateLimitError,
    setRateLimitError,
    escalated,
    setEscalated,
    escalationReason,
    emergencyVoiceTriggered,
    emergencyOption,
    showNameInput,
    manualName,
    setManualName,
    setShowNameInput,
    lastResponseAt,
    lastResponse,
    showPhoneInput,
    manualPhone,
    setManualPhone,
    setShowPhoneInput,
  } = useConversation();

  function beginAssistantWait(label) {
    pendingSinceRef.current = Date.now();
    setAssistantPendingLabel(label);
    setAssistantPending(true);
  }

  async function clearLastResponse() {
    if (!currentRoomName) return;
    try {
      await fetch(`${BASE}/conversation-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_name: currentRoomName, last_response: "" }),
      });
    } catch (e) {
      console.error("Clear response error:", e);
    }
  }

  useEffect(() => {
    if (!assistantPending || !lastResponseAt || !pendingSinceRef.current)
      return;
    if (lastResponseAt >= pendingSinceRef.current) {
      setAssistantPending(false);
      pendingSinceRef.current = null;
    }
  }, [assistantPending, lastResponseAt]);

  // ── Helpers ────────────────────────────────────────────────────────

  // ── Name submission ─────────────────────────────────────────────

  async function handleSubmitName() {
    const cleanName = manualName.trim();
    if (cleanName.length < 2) return;
    beginAssistantWait("Sending patient name to VoiceDesk");
    addToolEvent("Name Submitted");
    try {
      await clearLastResponse();
      await fetch(`${BASE}/set-name`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_name: currentRoomName, name: cleanName }),
      });

      await fetch(`${BASE}/inject-message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_name: currentRoomName,
          message: `My name is ${cleanName}`,
        }),
      });

      setManualName("");
      setShowNameInput(false);
    } catch (e) {
      console.error("Name submit error:", e);
      setAssistantPending(false);
    }
  }

  // ── Phone submission ─────────────────────────────────────────────

  async function handleSubmitPhone() {
    if (manualPhone.length !== 10) return;
    beginAssistantWait("Verifying patient phone number");
    addToolEvent("Phone Submitted");
    try {
      await clearLastResponse();
      await fetch(`${BASE}/set-phone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_name: currentRoomName,
          phone: manualPhone,
        }),
      });

      await fetch(`${BASE}/inject-message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_name: currentRoomName,
          message: `My phone number is ${manualPhone}`,
        }),
      });

      console.log(
        "Phone submitted:",
        manualPhone,
        "for room:",
        currentRoomName,
      );
      setManualPhone("");
      setShowPhoneInput(false);
      setPhoneWasSubmitted(true);
    } catch (e) {
      console.error("Phone submit error:", e);
      setAssistantPending(false);
    }
  }

  function formatSpokenDate(date, fallbackLabel) {
    const parsed = new Date(`${date}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return fallbackLabel || date;
    const day = parsed.getDate();
    const suffix =
      day % 10 === 1 && day !== 11
        ? "st"
        : day % 10 === 2 && day !== 12
          ? "nd"
          : day % 10 === 3 && day !== 13
            ? "rd"
            : "th";
    return `${day}${suffix} ${parsed.toLocaleString("en-IN", { month: "long" })} ${parsed.getFullYear()}`;
  }

  function formatSpokenTime(time) {
    const [hour, minute] = time.split(":").map(Number);
    const suffix = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return minute === 0
      ? `${displayHour} ${suffix}`
      : `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
  }

  async function handleSelectSlot(date, time, doctorName, dateLabel) {
    if (!currentRoomName) return;
    const spokenDate = formatSpokenDate(date, dateLabel);
    const spokenTime = formatSpokenTime(time);
    beginAssistantWait("Sending selected appointment slot");
    addToolEvent("Slot Selected");
    try {
      await clearLastResponse();
      await fetch(`${BASE}/inject-message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_name: currentRoomName,
          message: `${spokenDate} at ${spokenTime}`,
        }),
      });
    } catch (e) {
      console.error("Slot submit error:", e);
      setAssistantPending(false);
    }
  }

  function calcDuration() {
    if (!startTimeRef.current) return "00:00";
    const secs = Math.floor((Date.now() - startTimeRef.current) / 1000);
    const mm = String(Math.floor(secs / 60)).padStart(2, "0");
    const ss = String(secs % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }

  // ── Start call ────────────────────────────────────────────────────

  async function handleStartCall() {
    setIsLoading(true);
    beginAssistantWait("Starting secure voice room");
    addToolEvent("Call Started");
    try {
      const roomName = "voicedesk-" + uuidv4();
      const participantName = "Guest";
      const threadId = uuidv4();
      roomNameRef.current = roomName;
      threadIdRef.current = threadId;
      isFirstTurnRef.current = true;
      startTimeRef.current = Date.now();
      setCurrentRoomName(roomName);
      setCurrentThreadId(threadId);

      // 1. Fetch LiveKit token
      const tokenRes = await fetch(
        `${BASE}/token?room_name=${encodeURIComponent(roomName)}&participant_name=${encodeURIComponent(participantName)}`,
      );
      if (!tokenRes.ok) throw new Error("Token fetch failed");
      const { token, url } = await tokenRes.json();

      // 2. Connect to LiveKit room
      await connect(token, url || LIVEKIT_URL);

      // 3. Start voice pipeline on backend
      await fetch(`${BASE}/voice/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_name: roomName,
          participant_name: participantName,
        }),
      });

      // 4. Kick off first conversation turn
      await sendMessage("Hello", threadIdRef.current, true);
      isFirstTurnRef.current = false;

      // 5. Start polling for agent responses
      pollingRef.current = startPolling(roomName);
    } catch (err) {
      console.error("Start call error:", err);
      setAssistantPending(false);
    } finally {
      setIsLoading(false);
    }
  }

  // ── End call ──────────────────────────────────────────────────────

  async function handleEndCall() {
    setIsLoading(true);
    setIsDisconnecting(true);
    setAssistantPending(false);
    pendingSinceRef.current = null;
    stopPolling(pollingRef.current);
    setCallDuration(calcDuration());
    try {
      await fetch(`${BASE}/voice/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_name: roomNameRef.current }),
      });
    } catch (err) {
      console.error("Stop error:", err);
    } finally {
      disconnect();
      setIsLoading(false);
      setIsDisconnecting(false);
      // Don't show summary if the ambulance slip modal is already pending
      if (emergencyStep !== 'ambulance_dispatching') {
        setShowSummary(true);
      }
    }
  }

  // ── New call ──────────────────────────────────────────────────────

  async function handleEmergencySpeak(text) {
    if (!currentRoomName) return;
    try {
      await fetch(`${BASE}/voice/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room_name: currentRoomName, text }),
      });
    } catch (e) {
      console.error('Voice speak error:', e);
    }
  }

  async function handleConfirmAmbulance() {
    const ref = 'AMB-' + Math.random().toString(36).substring(2, 10).toUpperCase();
    const time = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
    setAmbulanceBookingRef(ref);
    setAmbulanceDispatchTime(time);
    setEmergencyStep('ambulance_dispatching');
    autoEndedRef.current = true; // prevent SummaryCard from appearing

    // Say goodbye via TTS
    try {
      await fetch(`${BASE}/voice/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_name: currentRoomName,
          text: "Your ambulance has been dispatched. Your ambulance dispatch slip will appear on screen shortly — you can download it and show it to the medical team on arrival. Thank you for calling VoiceDesk. Stay safe, help is on the way!",
        }),
      });
    } catch (e) {
      console.error('Ambulance goodbye speak error:', e);
    }

    // Auto-end call after TTS finishes (~17 s — message is ~42 words at 160+ WPM TTS + 2 s poll delay)
    setTimeout(async () => {
      stopPolling(pollingRef.current);
      setCallDuration(calcDuration());
      try {
        await fetch(`${BASE}/voice/stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ room_name: roomNameRef.current }),
        });
      } catch (err) {
        console.error('Ambulance stop error:', err);
      }
      disconnect();
      setEmergencyStep(null);
      setShowAmbulanceSlipModal(true);
    }, 17000);
  }

  function handleNewCall() {
    setShowSummary(false);
    resetConversation();
    setAssistantPending(false);
    pendingSinceRef.current = null;
    autoEndedRef.current = false;
    roomNameRef.current = "";
    threadIdRef.current = "";
    isFirstTurnRef.current = true;
    startTimeRef.current = null;
    setCallDuration("00:00");
    setPhoneWasSubmitted(false);
    setEmergencyStep(null);
    setAmbulanceAddress('');
    setAmbulancePincode('');
    setAmbulanceMapPin(null);
    setAmbulanceBookingRef('');
    setAmbulanceDispatchTime('');
    setShowAmbulanceSlipModal(false);
  }

  // Voice trigger — backend sets emergency_triggered when user says "emergency"
  useEffect(() => {
    if (emergencyVoiceTriggered && emergencyStep === null) {
      setEmergencyStep('options');
    }
  }, [emergencyVoiceTriggered]);

  // Voice option selection — backend detects "specialist" or "ambulance" while panel is open
  useEffect(() => {
    if (!emergencyOption) return;
    if (emergencyOption === 'callback') setEmergencyStep('callback_confirmed');
    if (emergencyOption === 'ambulance') setEmergencyStep('ambulance_form');
  }, [emergencyOption]);

  // Voice activity state machine: listening → processing → idle
  useEffect(() => {
    if (userSpeaking) {
      wasListeningRef.current = true
      setVoiceState('listening')
    } else if (agentSpeaking) {
      wasListeningRef.current = false
      setVoiceState('idle')
    } else if (wasListeningRef.current) {
      wasListeningRef.current = false
      setVoiceState('processing')
    }
  }, [userSpeaking, agentSpeaking])

  // Reset on disconnect
  useEffect(() => {
    if (!isConnected) { setVoiceState('idle'); wasListeningRef.current = false }
  }, [isConnected])

  // Notify App when call starts/ends so the tab switcher can hide
  useEffect(() => {
    onCallActiveChange?.(isConnected)
  }, [isConnected])

  useEffect(() => {
    if (conversationStage !== "END" || autoEndedRef.current) return;
    autoEndedRef.current = true;
    stopPolling(pollingRef.current);
    setCallDuration(calcDuration());
    disconnect();
    setShowSummary(true);
  }, [conversationStage]);

  // ── Render ────────────────────────────────────────────────────────

  const effectiveConnected = isConnected || (import.meta.env.DEV && devConnected);

  const stageMeta = STAGE_META[conversationStage] ?? {
    label: conversationStage,
    cls: "bg-gray-100 text-gray-500",
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-inter flex flex-col">

      {/* ── DEV shortcuts (remove before demo) ── */}
      {import.meta.env.DEV && (() => {
        const DEV_DOCTORS = [
          { name: 'Dr. Anil Sharma',  specialization: 'General Physician',  qualification: 'MBBS, MD (General Medicine)',  experience_years: 15 },
          { name: 'Dr. Priya Mehta',  specialization: 'Dermatologist',       qualification: 'MBBS, MD (Dermatology)',        experience_years: 12 },
          { name: 'Dr. Rohan Das',    specialization: 'Orthopedic Surgeon',  qualification: 'MBBS, MS (Orthopedics)',        experience_years: 18 },
          { name: 'Dr. Sneha Iyer',   specialization: 'Pediatrician',        qualification: 'MBBS, MD (Pediatrics)',         experience_years: 10 },
          { name: 'Dr. Arjun Kapoor', specialization: 'Cardiologist',        qualification: 'MBBS, MD, DM (Cardiology)',     experience_years: 20 },
          { name: 'Dr. Meera Nair',   specialization: 'Gynaecologist',       qualification: 'MBBS, MS (Obstetrics)',         experience_years: 14 },
        ];
        const DEV_SLOTS = {
          doctor_id: 99, doctor_name: 'Dr. Anil Sharma', specialization: 'General Physician',
          days: [
            { date: '2026-05-05', label: '5th May 2026',  slots: [{ time: '09:00', available: true }, { time: '10:00', available: false }, { time: '11:00', available: true }, { time: '14:00', available: true }] },
            { date: '2026-05-06', label: '6th May 2026',  slots: [{ time: '10:00', available: true }, { time: '15:00', available: true  }, { time: '16:00', available: false }] },
            { date: '2026-05-07', label: '7th May 2026',  slots: [{ time: '09:00', available: true }, { time: '11:00', available: true  }] },
          ],
        };
        const r = () => {
          setDevConnected(false); setEmergencyStep(null); setPhoneWasSubmitted(false);
          setShowSummary(false); setShowNameInput(false); setShowPhoneInput(false);
          setDoctors([]); setSlotGrid(null); setEscalated(false);
        };
        const c = (fn) => () => { r(); setDevConnected(true); fn?.(); };
        const BUTTONS = [
          ['─ General ─',    null],
          ['Homepage',        () => r()],
          ['Idle (listening)',c()],
          ['Name Input',      c(() => setShowNameInput(true))],
          ['Phone Input',     c(() => setShowPhoneInput(true))],
          ['Doctor List',     c(() => { setPhoneWasSubmitted(true); setDoctors(DEV_DOCTORS); })],
          ['Slot Calendar',   c(() => { setPhoneWasSubmitted(true); setSlotGrid(DEV_SLOTS); })],
          ['Summary',         c(() => setShowSummary(true))],
          ['Escalation',      c(() => setEscalated(true))],
          ['─ Emergency ─',  null],
          ['EM Options',      c(() => { setPhoneWasSubmitted(true); setEmergencyStep('options'); })],
          ['EM Callback',     c(() => { setPhoneWasSubmitted(true); setEmergencyStep('callback_confirmed'); })],
          ['EM Ambulance',    c(() => { setPhoneWasSubmitted(true); setEmergencyStep('ambulance_form'); })],
          ['EM Slip',         c(() => { setPhoneWasSubmitted(true); handleConfirmAmbulance(); })],
        ];
        return (
          <div className="fixed bottom-3 right-3 z-[9999] flex flex-col gap-0.5 max-h-screen overflow-y-auto">
            {BUTTONS.map(([label, fn]) =>
              fn === null
                ? <div key={label} className="text-[9px] text-white/50 text-center py-0.5">{label}</div>
                : <button key={label} onClick={fn}
                    className="text-[10px] bg-black/75 text-white px-2.5 py-1 rounded hover:bg-black text-left">
                    {label}
                  </button>
            )}
          </div>
        );
      })()}

      {/* ── Rate-limit banner ── */}
      {rateLimitError && (
        <div className="bg-red-600 px-4 py-2.5 flex items-center justify-between gap-4 z-50">
          <div className="flex items-center gap-2.5">
            <svg
              className="w-4 h-4 text-white flex-shrink-0"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M12 2L1 21h22L12 2zm0 3.5L20.5 19h-17L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z" />
            </svg>
            <p className="text-sm text-white font-medium">
              {rateLimitError}
            </p>
          </div>
          <button
            onClick={() => setRateLimitError("")}
            className="text-white/70 hover:text-white text-lg leading-none flex-shrink-0"
          >
            ×
          </button>
        </div>
      )}

      {/* ── Top bar ── */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shadow-sm z-30">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-md">
            <Stethoscope className="w-5 h-5 text-white" strokeWidth={2} />
          </div>
          <div>
            <span
              className="font-bold text-gray-950 text-2xl tracking-tight italic leading-none"
              style={{ fontFamily: '"Playfair Display", serif' }}
            >
              VoiceDesk AI
            </span>

            <p className="text-[10px] text-gray-400 leading-tight mt-0.5 tracking-widest uppercase" style={{ fontFamily: '"Oswald", sans-serif' }}>
              Multi-agent clinic voice desk
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Live badge + duration when active */}
          {isConnected && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 bg-red-50 border border-red-100 rounded-full px-3 py-1">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-xs text-red-600 font-semibold tracking-wide">
                  LIVE
                </span>
              </div>
              <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-full px-3 py-1">
                <svg
                  className="w-3 h-3 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6l4 2" />
                </svg>
                <span className="text-xs font-semibold text-gray-700 tabular-nums">
                  {(() => {
                    if (!startTimeRef.current) return "00:00";
                    const secs = Math.floor(
                      (currentTime - startTimeRef.current) / 1000,
                    );
                    return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
                  })()}
                </span>
              </div>
            </div>
          )}
          {/* Current time */}
          <span className="text-xs text-gray-400 tabular-nums font-medium hidden sm:block">
            {currentTime.toLocaleTimeString()}
          </span>
          {/* Stage badge — only when connected */}
          {isConnected && (
            <span
              className={`text-[11px] px-3 py-1 rounded-full tracking-widest uppercase transition-all duration-300 ${stageMeta.cls}`}
              style={{ fontFamily: '"Oswald", sans-serif' }}
            >
              {stageMeta.label}
            </span>
          )}
          {/* Volume slider */}
          <div className="flex items-center gap-2 bg-gray-50 rounded-full px-3 py-1.5">
            <svg
              className="w-3.5 h-3.5 text-gray-400 flex-shrink-0"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
            </svg>
            <input
              type="range"
              min="0"
              max="5"
              step="0.1"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="w-20 h-1 accent-primary cursor-pointer"
              title={`Volume: ${Math.round((volume / 5) * 100)}%`}
            />
            <svg
              className="w-3.5 h-3.5 text-gray-400 flex-shrink-0"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
            </svg>
          </div>

          {/* Connection indicator */}
          <div className="flex items-center gap-1.5 bg-gray-50 rounded-full px-3 py-1">
            <span
              className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                isConnected ? "bg-secondary animate-pulse" : "bg-gray-300"
              }`}
            />
            <span className="text-xs text-gray-500 font-medium">
              {isConnected ? "Connected" : "Ready"}
            </span>
          </div>
        </div>
      </header>

      {/* ── Main content ── */}
      <main className="flex-1 flex overflow-hidden relative z-[1]">

        {/* Left panel — Avatar + call controls */}
        <section
          className="flex flex-col items-center gap-8 p-10 flex-shrink-0"
          style={{
            width: effectiveConnected ? '42%' : '100%',
            justifyContent: effectiveConnected ? 'center' : 'flex-start',
            overflowY: effectiveConnected ? 'hidden' : 'auto',
            transition: 'width 0.7s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <Avatar isSpeaking={isSpeaking} isThinking={assistantPending} analyserRef={analyserRef} isConnected={effectiveConnected} />
          {effectiveConnected && !showSummary && (
            <VoiceActivityBar state={voiceState} />
          )}
          <CallControls
            isConnected={isConnected}
            isLoading={isLoading}
            isDisconnecting={isDisconnecting}
            onStart={handleStartCall}
            onEnd={handleEndCall}
          />
        </section>

        {/* Gradient divider */}
        <div
          className="flex-shrink-0 w-px self-stretch"
          style={{
            background: 'linear-gradient(to bottom, transparent 0%, #cbd5e1 20%, #cbd5e1 80%, transparent 100%)',
            opacity: effectiveConnected ? 1 : 0,
            transition: 'opacity 0.6s ease-in-out 0.3s',
          }}
        />

        {/* Right panel — interactive content slides in when connected */}
        <div
          className="flex-shrink-0 overflow-hidden"
          style={{
            width: effectiveConnected ? '58%' : '0%',
            transition: 'width 0.7s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <div
            className="h-full overflow-y-auto p-8 flex flex-col gap-5"
            style={{
              minWidth: '460px',
              opacity: effectiveConnected ? 1 : 0,
              transition: 'opacity 0.45s ease-in-out 0.28s',
            }}
          >

            {/* Emergency banner — shown after phone input is gone and call is past greeting */}
            {(phoneWasSubmitted || conversationStage === 'IDENTIFIED' || conversationStage === 'ACTIVE') && !showPhoneInput && !showNameInput && emergencyStep === null && (
              <div className="fade-in">
              <EmergencyBanner onClick={() => setEmergencyStep('options')} />
              </div>
            )}

            {/* Emergency panel — takes over right panel content */}
            {emergencyStep !== null && (
              <EmergencyPanel
                step={emergencyStep}
                onSelectCallback={() => setEmergencyStep('callback_confirmed')}
                onSelectAmbulance={() => setEmergencyStep('ambulance_form')}
                onConfirmAmbulance={handleConfirmAmbulance}
                onClose={() => { setEmergencyStep(null); setMicEnabled(true); }}
                onBack={() => setEmergencyStep('options')}
                address={ambulanceAddress}
                setAddress={setAmbulanceAddress}
                pincode={ambulancePincode}
                setPincode={setAmbulancePincode}
                mapPin={ambulanceMapPin}
                setMapPin={setAmbulanceMapPin}
                onMicMute={(mute) => setMicEnabled(!mute)}
                onSpeak={handleEmergencySpeak}
                patient={patient}
                bookingRef={ambulanceBookingRef}
                dispatchTime={ambulanceDispatchTime}
              />
            )}

            {/* Normal content — hidden when emergency flow is active */}
            {emergencyStep === null && (
            <>

            {/* Name input */}
            {showNameInput && (
              <div className="bg-white rounded-2xl shadow-md p-5 border border-primary/20 fade-in">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <p className="text-sm font-bold text-gray-900">Patient name</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Say your name or type it here for the receptionist agent.
                    </p>
                  </div>
                  <span className="text-[10px] font-bold text-primary bg-primary/10 rounded-full px-2 py-1 flex-shrink-0">
                    Step 1
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Full name"
                    className="flex-1 px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => e.key === "Enter" && handleSubmitName()}
                  />
                  <button
                    onClick={handleSubmitName}
                    disabled={manualName.trim().length < 2 || assistantPending}
                    className="px-5 py-2.5 text-sm bg-primary text-white rounded-xl hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-all"
                  >
                    Submit
                  </button>
                </div>
              </div>
            )}

            {/* Phone input */}
            {showPhoneInput && (
              <div className="bg-white rounded-2xl shadow-md p-5 border border-primary/20 fade-in">
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <p className="text-sm font-bold text-gray-900">Phone number</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Say your 10-digit number or type it here.
                    </p>
                  </div>
                  <span className="text-[10px] font-bold text-primary bg-primary/10 rounded-full px-2 py-1 flex-shrink-0">
                    Step 2
                  </span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="tel"
                    placeholder="10-digit phone number"
                    className="flex-1 px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary font-mono tracking-widest"
                    value={manualPhone}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "");
                      if (val.length <= 10) setManualPhone(val);
                    }}
                    maxLength={10}
                    autoFocus={!showNameInput}
                    onKeyDown={(e) => e.key === "Enter" && handleSubmitPhone()}
                  />
                  <button
                    onClick={handleSubmitPhone}
                    disabled={manualPhone.length !== 10 || assistantPending}
                    className="px-5 py-2.5 text-sm bg-primary text-white rounded-xl hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-all"
                  >
                    Submit
                  </button>
                </div>
                {manualPhone.length > 0 && manualPhone.length < 10 && (
                  <p className="text-xs text-red-400 mt-2">
                    {10 - manualPhone.length} more digit
                    {10 - manualPhone.length !== 1 ? "s" : ""} needed
                  </p>
                )}
              </div>
            )}

            {/* Slot calendar or doctor list */}
            {slotGrid ? (
              <div key={slotGrid.doctor_id} className="fade-in-slow">
                <SlotCalendar slotGrid={slotGrid} onSelectSlot={handleSelectSlot} />
              </div>
            ) : (
              doctors.length > 0 && (
                <div className="bg-white rounded-2xl shadow-sm p-5 border border-gray-100 fade-in">
                  <div className="flex items-start gap-2 mb-4 px-3 py-2.5 bg-primary/5 border border-primary/15 rounded-xl">
                    <span className="text-primary mt-0.5 flex-shrink-0">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                      </svg>
                    </span>
                    <p className="text-sm text-gray-900 leading-snug">
                      <span className="font-semibold">Not sure which doctor to see?</span> Describe your symptoms to the assistant and it will recommend the right specialist — for example, <span className="italic">"I have been having chest pain"</span> or <span className="italic">"my skin has been itching."</span>
                    </p>
                  </div>
                  <h3 className="font-semibold text-gray-700 mb-3">Available Doctors</h3>
                  <div className="grid grid-cols-2 gap-2 max-h-[26rem] overflow-y-auto pr-1">
                    {doctors.map((doc, i) => {
                      const specKey = (doc.specialization || '').toLowerCase().trim();
                      const SPEC = {
                        'cardiologist':        { Icon: Heart,        color: 'bg-red-50    text-red-500    border-red-100'    },
                        'general physician':   { Icon: Stethoscope,  color: 'bg-blue-50   text-blue-500   border-blue-100'   },
                        'dermatologist':       { Icon: Sparkles,     color: 'bg-pink-50   text-pink-500   border-pink-100'   },
                        'orthopedic':          { Icon: Bone,         color: 'bg-orange-50 text-orange-500 border-orange-100' },
                        'orthopedic surgeon':  { Icon: Bone,         color: 'bg-orange-50 text-orange-500 border-orange-100' },
                        'neurologist':         { Icon: Brain,        color: 'bg-purple-50 text-purple-500 border-purple-100' },
                        'pediatrician':        { Icon: Baby,         color: 'bg-yellow-50 text-yellow-600 border-yellow-100' },
                        'gynecologist':        { Icon: Flower2,      color: 'bg-rose-50   text-rose-500   border-rose-100'   },
                        'gynaecologist':       { Icon: Flower2,      color: 'bg-rose-50   text-rose-500   border-rose-100'   },
                        'ent':                 { Icon: Ear,          color: 'bg-teal-50   text-teal-500   border-teal-100'   },
                        'ophthalmologist':     { Icon: Eye,          color: 'bg-cyan-50   text-cyan-500   border-cyan-100'   },
                        'psychiatrist':        { Icon: Lightbulb,    color: 'bg-indigo-50 text-indigo-500 border-indigo-100' },
                        'diabetologist':       { Icon: Droplets,     color: 'bg-amber-50  text-amber-500  border-amber-100'  },
                        'gastroenterologist':  { Icon: Activity,     color: 'bg-lime-50   text-lime-600   border-lime-100'   },
                        'pulmonologist':       { Icon: Wind,         color: 'bg-sky-50    text-sky-500    border-sky-100'    },
                        'endocrinologist':     { Icon: Zap,          color: 'bg-violet-50 text-violet-500 border-violet-100' },
                        'urologist':           { Icon: Droplet,      color: 'bg-emerald-50 text-emerald-500 border-emerald-100' },
                      };
                      const { Icon = Hospital, color = 'bg-gray-50 text-gray-500 border-gray-100' } = SPEC[specKey] || {};
                      return (
                        <div key={i} className="flex items-start gap-2.5 p-2.5 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors duration-150">
                          <div className={`w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0 ${color}`}>
                            <Icon size={17} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm text-gray-800 leading-tight truncate">{doc.name}</p>
                            <span className={`inline-block mt-0.5 text-xs font-medium px-2 py-0.5 rounded-full border ${color}`}>
                              {doc.specialization}
                            </span>
                            {doc.qualification && (
                              <p className="text-xs text-gray-500 mt-0.5 leading-snug">{doc.qualification}</p>
                            )}
                            <p className="text-xs text-gray-400 mt-0.5">{doc.experience_years} yrs exp</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )
            )}

            {/* Idle/listening state */}
            {!showNameInput && !showPhoneInput && !slotGrid && doctors.length === 0 && (
              <div className="flex flex-col items-center justify-center flex-1 gap-5 py-20 text-center">
                <div className="relative w-20 h-20">
                  <div className="absolute inset-0 rounded-full bg-primary/10 animate-pulse" />
                  <div className="absolute inset-3 rounded-full bg-primary/15" />
                  <div className="absolute inset-6 rounded-full bg-primary/25 animate-pulse" style={{ animationDelay: '0.5s' }} />
                  <div className="absolute inset-0 rounded-full border-2 border-primary/20 animate-ping" style={{ animationDuration: '2s' }} />
                </div>
                <div>
                  <p className="text-gray-600 font-semibold text-sm">Assistant is listening</p>
                  <p className="text-gray-400 text-xs mt-1.5 max-w-[260px] leading-relaxed">
                    Speak naturally. The assistant will guide you through the booking process step by step.
                  </p>
                </div>
              </div>
            )}

            </>
            )}

          </div>
        </div>

      </main>

      {/* ── Escalation modal ── */}
      {escalated && (
        <EscalationCard
          patient={patient}
          escalationReason={escalationReason}
          onNewCall={handleNewCall}
        />
      )}

      {/* ── Ambulance slip modal (shown after ambulance dispatch + call end) ── */}
      {showAmbulanceSlipModal && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          style={{ animation: 'pageFadeIn 0.4s ease-out both' }}
        >
          <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => { setShowAmbulanceSlipModal(false); handleNewCall(); }}
              className="absolute top-3 right-3 z-10 w-7 h-7 rounded-full bg-white/80 hover:bg-white flex items-center justify-center shadow transition-colors"
              title="Close"
            >
              <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <AmbulanceSlip
              bookingRef={ambulanceBookingRef}
              patientName={patient?.name || 'Patient'}
              phone={patient?.phone || ''}
              address={ambulanceAddress}
              pincode={ambulancePincode}
              dispatchTime={ambulanceDispatchTime}
              onClose={() => { setShowAmbulanceSlipModal(false); handleNewCall(); }}
            />
          </div>
        </div>
      )}

      {/* ── Summary modal ── */}
      {showSummary && !escalated && (
        <SummaryCard
          summary={callSummary}
          appointmentsMade={appointmentsMade}
          tokensUsed={tokensUsed}
          costUsd={costUsd}
          duration={callDuration}
          conversationStage={conversationStage}
          startedAt={
            startTimeRef.current
              ? new Date(startTimeRef.current).toISOString()
              : null
          }
          toolCalls={toolCalls}
          patient={patient}
          appointmentSlip={appointmentSlip}
          onClose={() => setShowSummary(false)}
          onNewCall={handleNewCall}
        />
      )}
      <div className="fixed bottom-[-10px] left-0 right-0 pointer-events-none z-0">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 1440 320"
          style={{ display: "block" }}
        >
          <path
            fill="#06b6d4"
            fillOpacity="0.75"
            d="M0,32L18.5,37.3C36.9,43,74,53,111,69.3C147.7,85,185,107,222,101.3C258.5,96,295,64,332,90.7C369.2,117,406,203,443,218.7C480,235,517,181,554,154.7C590.8,128,628,128,665,138.7C701.5,149,738,171,775,170.7C812.3,171,849,149,886,154.7C923.1,160,960,192,997,224C1033.8,256,1071,288,1108,298.7C1144.6,309,1182,299,1218,245.3C1255.4,192,1292,96,1329,74.7C1366.2,53,1403,107,1422,133.3L1440,160L1440,320L1421.5,320C1403.1,320,1366,320,1329,320C1292.3,320,1255,320,1218,320C1181.5,320,1145,320,1108,320C1070.8,320,1034,320,997,320C960,320,923,320,886,320C849.2,320,812,320,775,320C738.5,320,702,320,665,320C627.7,320,591,320,554,320C516.9,320,480,320,443,320C406.2,320,369,320,332,320C295.4,320,258,320,222,320C184.6,320,148,320,111,320C73.8,320,37,320,18,320L0,320Z"
          />
        </svg>
      </div>
    </div>
  );
}
