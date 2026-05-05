import { useState, useRef } from 'react'
import { Room, RoomEvent, Track } from 'livekit-client'

const DEFAULT_GAIN = parseFloat(localStorage.getItem('vd_gain') ?? '2.5')

export function useLiveKit() {
  const [isConnected, setIsConnected]   = useState(false)
  const [isSpeaking, setIsSpeaking]     = useState(false)
  const [userSpeaking, setUserSpeaking] = useState(false)
  const [agentSpeaking, setAgentSpeaking] = useState(false)
  const [volume, setVolumeState]         = useState(DEFAULT_GAIN)
  const roomRef     = useRef(null)
  const audioCtxRef = useRef(null)
  const gainNodeRef = useRef(null)
  const analyserRef = useRef(null)   // exposed for real-time amplitude reading
  const sourcesRef  = useRef([])
  const elementsRef = useRef([])

  function setVolume(val) {
    const clamped = Math.max(0, Math.min(5, parseFloat(val)))
    setVolumeState(clamped)
    localStorage.setItem('vd_gain', String(clamped))
    if (gainNodeRef.current) gainNodeRef.current.gain.value = clamped
  }

  function _getOrCreateAudioGraph() {
    if (!audioCtxRef.current) {
      const ctx     = new AudioContext()
      const gain    = ctx.createGain()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.75

      gain.gain.value = parseFloat(localStorage.getItem('vd_gain') ?? '2.5')

      // source → gain → analyser → destination
      gain.connect(analyser)
      analyser.connect(ctx.destination)

      audioCtxRef.current = ctx
      gainNodeRef.current = gain
      analyserRef.current = analyser
    }
    const ctx = audioCtxRef.current
    if (ctx.state === 'suspended') ctx.resume()
    return ctx
  }

  async function connect(token, url) {
    const room = new Room()
    roomRef.current = room

    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const local = room.localParticipant
      setUserSpeaking(speakers.some(p => p.sid === local.sid))
      setAgentSpeaking(speakers.some(p => p.sid !== local.sid))
    })

    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind !== Track.Kind.Audio) return

      const audioEl = track.attach()
      audioEl.muted = true
      audioEl.style.display = 'none'
      document.body.appendChild(audioEl)
      elementsRef.current.push(audioEl)

      const ctx    = _getOrCreateAudioGraph()
      const stream = new MediaStream([track.mediaStreamTrack])
      const source = ctx.createMediaStreamSource(stream)
      source.connect(gainNodeRef.current)
      sourcesRef.current.push(source)

      setIsSpeaking(true)
    })

    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) setIsSpeaking(false)
    })

    room.on(RoomEvent.Disconnected, () => {
      setIsConnected(false)
      setIsSpeaking(false)
    })

    await room.connect(url, token)
    await room.localParticipant.setMicrophoneEnabled(true)
    setIsConnected(true)
  }

  async function disconnect() {
    sourcesRef.current.forEach(s => { try { s.disconnect() } catch (_) {} })
    sourcesRef.current = []

    elementsRef.current.forEach(el => { try { el.remove() } catch (_) {} })
    elementsRef.current = []

    if (gainNodeRef.current) {
      try { gainNodeRef.current.disconnect() } catch (_) {}
      gainNodeRef.current = null
    }
    if (analyserRef.current) {
      try { analyserRef.current.disconnect() } catch (_) {}
      analyserRef.current = null
    }
    if (audioCtxRef.current) {
      try { await audioCtxRef.current.close() } catch (_) {}
      audioCtxRef.current = null
    }

    if (roomRef.current) {
      try { await roomRef.current.localParticipant.setMicrophoneEnabled(false) } catch (_) {}
      roomRef.current.disconnect()
      roomRef.current = null
    }
    setIsConnected(false)
    setIsSpeaking(false)
    setUserSpeaking(false)
    setAgentSpeaking(false)
  }

  async function setMicEnabled(enabled) {
    if (!roomRef.current) return
    try { await roomRef.current.localParticipant.setMicrophoneEnabled(enabled) } catch (_) {}
  }

  return { room: roomRef.current, isConnected, isSpeaking, userSpeaking, agentSpeaking, volume, setVolume, analyserRef, connect, disconnect, setMicEnabled }
}
