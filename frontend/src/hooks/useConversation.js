import { useState, useRef } from 'react'

const BASE = import.meta.env.VITE_BACKEND_URL

const TOOL_KEYWORDS = {
  identify_user: 'Identifying User',
  fetch_slots: 'Fetching Available Slots',
  book_appointment: 'Booking Appointment',
  retrieve_appointments: 'Retrieving Appointments',
  cancel_appointment: 'Cancelling Appointment',
  modify_appointment: 'Modifying Appointment',
  end_conversation: 'Ending Conversation',
}

function detectToolCalls(text) {
  const lower = (text || '').toLowerCase()
  return Object.entries(TOOL_KEYWORDS)
    .filter(([keyword]) => lower.includes(keyword))
    .map(([, displayName]) => ({
      id: crypto.randomUUID(),
      name: displayName,
      status: 'completed',
      timestamp: new Date(),
    }))
}

export function useConversation() {
  const [conversationStage, setConversationStage] = useState('GREETING')
  const [currentIntent, setCurrentIntent] = useState('')
  const [tokensUsed, setTokensUsed] = useState(0)
  const [costUsd, setCostUsd] = useState(0)
  const [appointmentsMade, setAppointmentsMade] = useState([])
  const [callSummary, setCallSummary] = useState('')
  const [toolCalls, setToolCalls] = useState([])
  const [doctors, setDoctors] = useState([])
  const [slotGrid, setSlotGrid] = useState(null)
  const [patient, setPatient] = useState({})
  const [appointmentSlip, setAppointmentSlip] = useState({})
  const [showPhoneInput, setShowPhoneInput] = useState(false)
  const [showNameInput, setShowNameInput] = useState(false)
  const [manualPhone, setManualPhone] = useState('')
  const [manualName, setManualName] = useState('')
  const [lastResponseAt, setLastResponseAt] = useState(null)
  const [lastResponse, setLastResponse] = useState('')
  const [rateLimitError, setRateLimitError] = useState('')
  const [escalated, setEscalated]           = useState(false)
  const [escalationReason, setEscalationReason] = useState('')
  const [emergencyVoiceTriggered, setEmergencyVoiceTriggered] = useState(false)
  const [emergencyOption, setEmergencyOption] = useState(null)
  const shownToolsRef = useRef(new Set())

  function addToolEvent(name, status = 'completed') {
    setToolCalls(prev => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name,
        status,
        timestamp: new Date().toISOString(),
      },
    ])
  }

  const fetchDoctors = async () => {
    try {
      const res = await fetch(`${BASE}/doctors`)
      const data = await res.json()
      setDoctors(data.doctors || [])
    } catch (e) {
      console.error('Doctor fetch error:', e)
    }
  }

  async function sendMessage(message, threadId, isFirstTurn) {
    const res = await fetch(`${BASE}/conversation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        thread_id: threadId,
        message,
        is_first_turn: isFirstTurn,
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`HTTP ${res.status}: ${text}`)
    }

    const data = await res.json()

    setConversationStage(data.conversation_stage || 'GREETING')
    setCurrentIntent(data.current_intent || '')
    setTokensUsed(data.tokens_used || 0)
    setCostUsd(data.cost_usd || 0)
    setAppointmentsMade(data.appointments_made || [])
    setPatient(data.patient || {})
    setAppointmentSlip(data.appointment_slip || {})

    const detected = detectToolCalls(data.response || '')
    if (detected.length > 0) {
      setToolCalls(prev => [...prev, ...detected])
    }

    if (data.conversation_stage === 'END') {
      setCallSummary(data.response || '')
    }

    return data
  }

  const startPolling = (roomName) => {
    console.log('Starting polling for room:', roomName)
    const interval = setInterval(async () => {
      console.log('Polling...', roomName)
      try {
        const res = await fetch(`${BASE}/conversation-status/${roomName}`)
        const data = await res.json()
        setConversationStage(data.conversation_stage || 'GREETING')
        setCurrentIntent(data.current_intent || '')
        setTokensUsed(data.tokens_used || 0)
        setCostUsd(data.cost_usd || 0)
        setAppointmentsMade(data.appointments_made || [])
        setPatient(data.patient || {})
        setAppointmentSlip(data.appointment_slip || {})
        if (data.slot_grid) {
          setSlotGrid(data.slot_grid)
          setDoctors([])
        }
        if (data.rate_limit_error) setRateLimitError(data.rate_limit_error)
        if (data.escalated) {
          setEscalated(true)
          setEscalationReason(data.escalation_reason || '')
        }
        if (data.emergency_triggered) {
          setEmergencyVoiceTriggered(true)
        }
        if (data.emergency_option) {
          setEmergencyOption(data.emergency_option)
        }

        const stage = data.conversation_stage || 'GREETING'

        if (data.last_response) {
          setLastResponseAt(Date.now())
          setLastResponse(data.last_response)
        }

        // Use tools_called array from backend
        const toolsCalledNames = {
          identify_user: 'Identifying User',
          get_doctors: 'Fetching Doctors',
          fetch_slots: 'Fetching Available Slots',
          book_appointment: 'Booking Appointment',
          retrieve_appointments: 'Retrieving Appointments',
          cancel_appointment: 'Cancelling Appointment',
          modify_appointment: 'Modifying Appointment',
          end_conversation: 'Ending Conversation',
        }

        const toolsCalled = data.tools_called || []
        const userJustIdentified = toolsCalled.includes('identify_user')
        const isIdentifiedStage  = stage === 'IDENTIFIED'
        const isEnded            = stage === 'END'
        const doctorsLoading     = toolsCalled.includes('get_doctors')

        // ── Use explicit backend flags set by agent_worker ────────────────────
        // The backend's _is_name_collection_stage() / _is_phone_collection_stage()
        // check conversation history directly, making this far more reliable than
        // keyword matching against last_response text.
        setShowNameInput(
          !isEnded && !userJustIdentified && !isIdentifiedStage &&
          data.ui_show_name_input === true
        )

        const shouldShowPhone = !isEnded && !userJustIdentified && !doctorsLoading &&
          data.ui_show_phone_input === true
        setShowPhoneInput(shouldShowPhone)
        if (userJustIdentified) setManualPhone('')
        if (toolsCalled.includes('get_doctors')) {
          fetchDoctors()
        }
        if (toolsCalled.length > 0) {
          setToolCalls(prev => {
            const newTools = toolsCalled
              .filter(t => toolsCalledNames[t])
              .filter(t => {
                const key = t + Date.now().toString().slice(0, -4)
                if (shownToolsRef.current.has(key)) return false
                shownToolsRef.current.add(key)
                return true
              })
              .map(t => ({
                id: Date.now() + Math.random(),
                name: toolsCalledNames[t],
                status: 'completed',
                timestamp: new Date().toISOString(),
              }))
            return [...prev, ...newTools]
          })
        }
      } catch (e) {
        console.error('Polling error:', e)
      }
    }, 2500)
    return interval
  }

  const stopPolling = (interval) => {
    clearInterval(interval)
  }

  function resetConversation() {
    setConversationStage('GREETING')
    setCurrentIntent('')
    setTokensUsed(0)
    setCostUsd(0)
    setAppointmentsMade([])
    setCallSummary('')
    setToolCalls([])
    setDoctors([])
    setSlotGrid(null)
    setPatient({})
    setAppointmentSlip({})
    setShowPhoneInput(false)
    setShowNameInput(false)
    setManualPhone('')
    setManualName('')
    setLastResponseAt(null)
    setLastResponse('')
    setRateLimitError('')
    setEscalated(false)
    setEscalationReason('')
    setEmergencyVoiceTriggered(false)
    setEmergencyOption(null)
    shownToolsRef.current = new Set()
  }

  return {
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
    showNameInput,
    manualName,
    setManualName,
    setShowNameInput,
    lastResponseAt,
    lastResponse,
    rateLimitError,
    setRateLimitError,
    escalated,
    setEscalated,
    escalationReason,
    emergencyVoiceTriggered,
    emergencyOption,
    showPhoneInput,
    manualPhone,
    setManualPhone,
    setShowPhoneInput,
  }
}
