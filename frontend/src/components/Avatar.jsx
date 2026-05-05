import { useRef, useState, useCallback, useEffect } from 'react'

const KEYFRAMES = `
  @keyframes vd-blob1 {
    0%,100% { transform: translate(0%,0%) scale(1); }
    25%     { transform: translate(30%,-25%) scale(1.3); }
    55%     { transform: translate(-18%,28%) scale(0.8); }
    80%     { transform: translate(-25%,-15%) scale(1.15); }
  }
  @keyframes vd-blob2 {
    0%,100% { transform: translate(0%,0%) scale(1); }
    35%     { transform: translate(-35%,18%) scale(1.35); }
    70%     { transform: translate(25%,-30%) scale(0.75); }
  }
  @keyframes vd-blob3 {
    0%,100% { transform: translate(0%,0%) scale(1); }
    20%     { transform: translate(20%,35%) scale(0.8); }
    60%     { transform: translate(-28%,-25%) scale(1.25); }
  }
  @keyframes vd-blob4 {
    0%,100% { transform: translate(0%,0%) scale(1); }
    45%     { transform: translate(-20%,-35%) scale(1.3); }
    80%     { transform: translate(30%,20%) scale(0.78); }
  }
  @keyframes vd-smoke {
    0%   { opacity: 0;    transform: translateY(60%) scale(0.4) rotate(0deg); }
    20%  { opacity: 0.85; }
    60%  { opacity: 0.5;  }
    100% { opacity: 0;    transform: translateY(-100%) scale(2) rotate(25deg); }
  }
  @keyframes vd-spin-slow {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
`

// Each blob gets its own repulsion strength so they scatter differently
const BLOBS = [
  { w: '80%', h: '80%', top: '8%',  left: '8%',  r: '42% 58% 52% 48% / 48% 52% 58% 42%', a: 'vd-blob1', b: 8,  op: 0.55, rx: 80,  ry: 65  },
  { w: '65%', h: '68%', top: '18%', left: '20%', r: '58% 42% 38% 62% / 62% 38% 52% 48%', a: 'vd-blob2', b: 10, op: 0.5,  rx: 110, ry: 100 },
  { w: '55%', h: '58%', top: '22%', left: '25%', r: '62% 38% 28% 72% / 52% 62% 38% 48%', a: 'vd-blob3', b: 7,  op: 0.6,  rx: 55,  ry: 90  },
  { w: '50%', h: '50%', top: '28%', left: '12%', r: '48% 52% 58% 42% / 58% 44% 42% 56%', a: 'vd-blob4', b: 9,  op: 0.45, rx: 120, ry: 45  },
]

const PUFFS = [
  { w: '44%', l: '12%', delay: '0s' },
  { w: '52%', l: '35%', delay: '0.9s' },
  { w: '38%', l: '58%', delay: '1.7s' },
  { w: '30%', l: '72%', delay: '0.4s' },
]

function SmokeBlobs({ speed = 1, cursor }) {
  const s = (base) => `${(base / speed).toFixed(1)}s`

  // cursor: { x, y } normalised to [-1, 1] from circle centre, or null
  const repulse = (rx, ry) => cursor
    ? `translate(${(-cursor.x * rx).toFixed(1)}px, ${(-cursor.y * ry).toFixed(1)}px)`
    : 'translate(0px, 0px)'

  return (
    <>
      <style>{KEYFRAMES}</style>

      {/* base gradient */}
      <div className="absolute inset-0" style={{
        background: 'linear-gradient(135deg, #0891b2 0%, #06b6d4 40%, #14b8a6 70%, #0d9488 100%)',
      }} />

      {/* spinning colour wash */}
      <div style={{
        position: 'absolute', inset: '-40%',
        background: 'conic-gradient(from 0deg, rgba(255,255,255,0.18), rgba(6,182,212,0.35), rgba(255,255,255,0.08), rgba(20,184,166,0.3), rgba(255,255,255,0.18))',
        animation: `vd-spin-slow ${s(8)} linear infinite`,
        filter: 'blur(4px)',
      }} />

      {/* morphing blobs — outer wrapper handles repulsion, inner handles CSS animation */}
      {BLOBS.map((bl, i) => (
        <div key={i} style={{
          position: 'absolute',
          width: bl.w, height: bl.h,
          top: bl.top, left: bl.left,
          transform: repulse(bl.rx, bl.ry),
          transition: cursor ? 'transform 0.25s ease-out' : 'transform 0.6s ease-out',
          willChange: 'transform',
        }}>
          <div style={{
            width: '100%', height: '100%',
            background: `radial-gradient(circle, rgba(255,255,255,${bl.op}) 0%, rgba(255,255,255,0.05) 60%, transparent 75%)`,
            borderRadius: bl.r,
            animation: `${bl.a} ${s(3.5 + i * 0.5)} ease-in-out infinite`,
            filter: `blur(${bl.b}px)`,
          }} />
        </div>
      ))}

      {/* rising smoke puffs */}
      {PUFFS.map((p, i) => (
        <div key={i} style={{
          position: 'absolute',
          width: p.w, height: p.w,
          bottom: '-10%', left: p.l,
          background: 'radial-gradient(circle, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.15) 50%, transparent 70%)',
          borderRadius: '50%',
          animation: `vd-smoke ${s(2.5 + i * 0.25)} ease-in-out infinite`,
          animationDelay: p.delay,
          filter: 'blur(10px)',
        }} />
      ))}
    </>
  )
}

function ThinkingSpinner() {
  return (
    <div className="relative w-12 h-12">
      <div className="absolute inset-0 rounded-full border-4 border-white/30" />
      <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-white border-r-white/60 animate-spin" />
      <div className="absolute inset-3 rounded-full bg-white/20 shadow-inner" />
      <div className="absolute inset-[18px] rounded-full bg-white/80 animate-pulse" />
    </div>
  )
}

export default function Avatar({ isSpeaking, isThinking, analyserRef, isConnected }) {
  const circleRef  = useRef(null)
  const wrapperRef = useRef(null)   // scaled by amplitude
  const rafRef     = useRef(null)
  const [cursor, setCursor] = useState(null)

  // Real-time amplitude → scale the circle wrapper directly via DOM (no re-renders)
  useEffect(() => {
    const dataArray = new Uint8Array(256)

    function tick() {
      const analyser = analyserRef?.current
      if (analyser && wrapperRef.current) {
        analyser.getByteTimeDomainData(dataArray)
        let sum = 0
        for (let i = 0; i < dataArray.length; i++) {
          const v = (dataArray[i] - 128) / 128
          sum += v * v
        }
        const rms   = Math.sqrt(sum / dataArray.length)
        const scale = 1 + Math.min(rms * 1.2, 0.15)  // max ~15% growth
        wrapperRef.current.style.transform = `scale(${scale.toFixed(3)})`
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [analyserRef])

  const handleMouseMove = useCallback((e) => {
    const rect = circleRef.current?.getBoundingClientRect()
    if (!rect) return
    const cx = rect.left + rect.width  / 2
    const cy = rect.top  + rect.height / 2
    setCursor({
      x: (e.clientX - cx) / (rect.width  / 2),
      y: (e.clientY - cy) / (rect.height / 2),
    })
  }, [])

  const handleMouseLeave = useCallback(() => setCursor(null), [])

  return (
    <div className="flex flex-col items-center gap-5 select-none">
      <div
        ref={wrapperRef}
        className={`relative ${isThinking && !isSpeaking ? "scale-105" : ""}`}
        style={{ transition: "transform 0.08s ease-out" }}
      >
        {/* outer rings */}
        {isSpeaking ? (
          <>
            <div className="absolute inset-0 rounded-full border-4 border-primary/40 animate-ping" />
            <div className="absolute inset-0 rounded-full border-2 border-primary/20 animate-pulse" />
            <div className="absolute -inset-2 rounded-full border-2 border-primary/10 animate-ping" />
          </>
        ) : isThinking ? (
          <>
            <div className="absolute -inset-4 rounded-full border-2 border-sky-200 animate-ping" />
            <div className="absolute -inset-2 rounded-full border border-emerald-200 animate-pulse" />
          </>
        ) : (
          <div className="absolute inset-0 rounded-full border border-primary/20 animate-pulse" />
        )}

        {/* circle */}
        <div
          ref={circleRef}
          className="rounded-full overflow-hidden shadow-2xl relative"
          style={{
            width: isConnected ? "13rem" : "12rem",
            height: isConnected ? "13rem" : "12rem",
            transition:
              "width 0.7s cubic-bezier(0.4, 0, 0.2, 1), height 0.7s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <SmokeBlobs
            speed={isSpeaking ? 2 : isThinking ? 1.5 : 1}
            cursor={cursor}
          />
          {isThinking && (
            <div className="absolute inset-0 flex items-center justify-center">
              <ThinkingSpinner />
            </div>
          )}
        </div>
      </div>

      <div
        className="text-center"
        style={{
          maxWidth: isConnected ? "350px" : "768px",
          transition: "max-width 0.7s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        <p
          className="text-gray-950 font-bold tracking-tight italic leading-none"
          style={{
            fontFamily: '"Playfair Display", serif',
            fontSize: isConnected ? "3.5rem" : "clamp(2.8rem, 6vw, 4.5rem)",
            transition: "font-size 0.7s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          VoiceDesk AI
        </p>
        <div
          className="overflow-hidden transition-all duration-500 ease-in-out"
          style={{
            maxHeight: isConnected ? "0px" : "200px",
            opacity: isConnected ? 0 : 1,
          }}
        >
          <p className="text-sm md:text-base text-gray-500 mt-3 font-medium">
            Multi-agent healthcare front desk for voice based patient
            identification, emergency services, symptom-based doctor matching,
            and booking appointment. 
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
            {[
              "Receptionist Agent",
              "Booking Agent",
              "Summary Agent",
              "Symptom Matching",
              "Emergency Services",
              ,
            ].map((item) => (
              <span
                key={item}
                className="text-[11px] text-gray-500 bg-white border border-gray-200 rounded-full px-3 py-1 shadow-sm tracking-widest uppercase"
                style={{ fontFamily: '"Oswald", sans-serif' }}
              >
                {item}
              </span>
            ))}
          </div>
        </div>
        {isSpeaking && (
          <p className="text-gray-900 text-sm mt-3 font-semibold animate-pulse">
            Speaking...
          </p>
        )}
        {isThinking && !isSpeaking && (
          <p className="text-gray-700 text-sm mt-3 font-semibold animate-pulse">
            Preparing response...
          </p>
        )}
      </div>
    </div>
  );
}
