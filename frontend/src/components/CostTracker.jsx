import { useState, useEffect } from 'react'

function formatDuration(secs) {
  const mm = String(Math.floor(secs / 60)).padStart(2, '0')
  const ss = String(secs % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function Tooltip({ text }) {
  const [show, setShow] = useState(false)
  return (
    <span className="relative inline-block ml-1">
      <button
        className="w-3.5 h-3.5 rounded-full bg-gray-200 text-gray-500 text-[9px] font-bold leading-none flex items-center justify-center hover:bg-gray-300 transition-colors"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      >
        i
      </button>
      {show && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 w-48 bg-gray-800 text-white text-[10px] rounded-lg px-2.5 py-2 z-50 leading-relaxed shadow-lg">
          {text}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-800" />
        </div>
      )}
    </span>
  )
}

export default function CostTracker({ tokensUsed, costUsd, isActive }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!isActive) {
      setElapsed(0)
      return
    }
    const id = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(id)
  }, [isActive])

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-gray-200 shadow-sm z-40">
      <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-around">

        <div className="text-center">
          <div className="flex items-center justify-center">
            <p className="text-[10px] text-gray-400 uppercase tracking-widest font-medium">Tokens Used</p>
            <Tooltip text="Total tokens consumed by the AI in this session." />
          </div>
          <p className="text-sm font-semibold text-gray-700 mt-0.5 tabular-nums font-poppins">
            {tokensUsed.toLocaleString()}
          </p>
        </div>

        <div className="w-px h-6 bg-gray-200" />

        <div className="text-center">
          <div className="flex items-center justify-center">
            <p className="text-[10px] text-gray-400 uppercase tracking-widest font-medium">Estimated Cost</p>
            <Tooltip text="Approximate cost based on Groq/Gemini pricing per 1M tokens." />
          </div>
          <p className="text-sm font-semibold text-gray-700 mt-0.5 tabular-nums font-poppins">
            ${costUsd.toFixed(4)}
          </p>
        </div>

        <div className="w-px h-6 bg-gray-200" />

        <div className="text-center">
          <p className="text-[10px] text-gray-400 uppercase tracking-widest font-medium">Call Duration</p>
          <p className="text-sm font-semibold text-gray-700 mt-0.5 tabular-nums font-poppins">
            {formatDuration(elapsed)}
          </p>
        </div>

      </div>
    </div>
  )
}
