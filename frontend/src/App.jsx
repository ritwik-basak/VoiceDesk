import { useState } from 'react'
import CallPage from './pages/CallPage.jsx'
import AnalyticsPage from './pages/AnalyticsPage.jsx'

export default function App() {
  const [page, setPage] = useState('call')
  const [isCallActive, setIsCallActive] = useState(false)

  return (
    <div className="relative">
      {/* Centered tab switcher — hidden during an active call */}
      <div className={`fixed top-3.5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 bg-gray-100 rounded-full p-1 shadow-sm transition-all duration-300 ${isCallActive ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <button
          onClick={() => setPage('call')}
          className={`px-4 py-1 text-xs font-semibold rounded-full transition-all duration-200 ${
            page === 'call'
              ? 'bg-white shadow text-gray-900'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Call
        </button>
        <button
          onClick={() => setPage('analytics')}
          className={`px-4 py-1 text-xs font-semibold rounded-full transition-all duration-200 ${
            page === 'analytics'
              ? 'bg-white shadow text-gray-900'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Analytics
        </button>
      </div>

      {/* Pages with fade transition */}
      <div
        key={page}
        style={{ animation: 'pageFadeIn 0.3s ease-out both' }}
      >
        {page === 'call' ? <CallPage onCallActiveChange={setIsCallActive} /> : <AnalyticsPage />}
      </div>

      <style>{`
        @keyframes pageFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
