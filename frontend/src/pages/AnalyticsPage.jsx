import { useState, useEffect, useCallback } from 'react'

const BASE = import.meta.env.VITE_BACKEND_URL

const OUTCOME_META = {
  completed:  { label: 'Completed',  cls: 'bg-emerald-100 text-emerald-700' },
  escalated:  { label: 'Escalated',  cls: 'bg-red-100 text-red-700'         },
  incomplete: { label: 'Incomplete', cls: 'bg-amber-100 text-amber-700'     },
  abandoned:  { label: 'Abandoned',  cls: 'bg-gray-100 text-gray-500'       },
}

const ESCALATION_LABELS = {
  medical_emergency:       'Medical Emergency',
  patient_requested_human: 'Patient Requested Human',
  repeated_clarification:  'Repeated Clarification Failure',
}

function formatDateTime(iso) {
  if (!iso) return '—'
  // Supabase returns UTC timestamps — append Z if no timezone suffix so the
  // browser converts to local time correctly instead of treating it as local.
  const str = /[Z+]/.test(iso.slice(-6)) ? iso : iso + 'Z'
  return new Date(str).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatSlot(date, time) {
  if (!date) return '—'
  const d = new Date(`${date}T00:00:00`)
  const day = d.getDate()
  const suffix = day % 10 === 1 && day !== 11 ? 'st'
    : day % 10 === 2 && day !== 12 ? 'nd'
    : day % 10 === 3 && day !== 13 ? 'rd' : 'th'
  const month = d.toLocaleString('en-IN', { month: 'short' })
  const [h, m] = (time || '00:00').split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const dh   = h % 12 || 12
  return `${day}${suffix} ${month} · ${dh}:${String(m).padStart(2,'0')} ${ampm}`
}

function TranscriptModal({ callId, onClose }) {
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${BASE}/analytics/calls/${callId}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [callId])

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white rounded-t-2xl">
          <div>
            <h3 className="font-semibold text-gray-900">Call Transcript</h3>
            {data && (
              <p className="text-xs text-gray-400 mt-0.5">
                {data.patient_name} · {data.phone_masked} · {formatDateTime(data.started_at)}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {loading && <p className="text-sm text-gray-400 text-center mt-8">Loading transcript...</p>}
          {!loading && (!data?.transcript?.length) && (
            <p className="text-sm text-gray-400 text-center mt-8">No transcript available for this call.</p>
          )}
          {data?.transcript?.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'assistant' ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                msg.role === 'assistant'
                  ? 'bg-gray-100 text-gray-800 rounded-tl-sm'
                  : 'bg-primary text-white rounded-tr-sm'
              }`}>
                <p className={`text-[10px] font-semibold mb-1 ${msg.role === 'assistant' ? 'text-gray-400' : 'text-white/70'}`}>
                  {msg.role === 'assistant' ? 'VoiceDesk AI' : 'Patient'}
                </p>
                {msg.content}
              </div>
            </div>
          ))}
        </div>

        {/* Summary */}
        {data?.summary && (
          <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 rounded-b-2xl">
            <p className="text-xs text-gray-500"><span className="font-semibold">Summary:</span> {data.summary}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function EarningsModal({ onClose }) {
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${BASE}/analytics/earnings`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white rounded-t-2xl">
          <div>
            <h3 className="font-semibold text-gray-900">Clinic Earnings</h3>
            <p className="text-xs text-gray-400 mt-0.5">Revenue from confirmed appointments</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {loading && <p className="text-sm text-gray-400 text-center mt-8">Loading earnings...</p>}
          {data && (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-4">
                  <p className="text-xs text-emerald-600 uppercase tracking-widest font-semibold">Total Revenue</p>
                  <p className="text-3xl font-bold text-emerald-700 mt-1">₹{data.total_revenue.toLocaleString('en-IN')}</p>
                  <p className="text-[10px] text-emerald-500 mt-1">Appointments + Ambulance</p>
                </div>
                <div className="bg-primary/5 border border-primary/10 rounded-xl px-4 py-4">
                  <p className="text-xs text-primary uppercase tracking-widest font-semibold">Appointments</p>
                  <p className="text-3xl font-bold text-primary mt-1">{data.total_appointments}</p>
                </div>
              </div>

              {/* Monthly */}
              {data.by_month.length > 0 && (
                <div>
                  <h4 className="text-xs uppercase tracking-widest text-gray-400 font-semibold mb-3">Monthly Breakdown</h4>
                  <div className="space-y-2">
                    {data.by_month.map(m => (
                      <div key={m.month} className="flex items-center justify-between px-4 py-2.5 bg-gray-50 rounded-lg">
                        <span className="text-sm text-gray-700 font-medium">{m.month}</span>
                        <span className="text-sm font-bold text-gray-900">₹{m.revenue.toLocaleString('en-IN')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Ambulance Earnings */}
              <div>
                <h4 className="text-xs uppercase tracking-widest text-gray-400 font-semibold mb-3">Ambulance Dispatches</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-4">
                    <p className="text-xs text-red-600 uppercase tracking-widest font-semibold">Ambulance Revenue</p>
                    <p className="text-2xl font-bold text-red-700 mt-1">
                      ₹{(data.ambulance_revenue || 0).toLocaleString('en-IN')}
                    </p>
                  </div>
                  <div className="bg-orange-50 border border-orange-100 rounded-xl px-4 py-4">
                    <p className="text-xs text-orange-600 uppercase tracking-widest font-semibold">Dispatches</p>
                    <p className="text-2xl font-bold text-orange-700 mt-1">{data.ambulance_dispatches || 0}</p>
                  </div>
                </div>
                <div className="mt-2 px-4 py-2.5 bg-gray-50 rounded-lg flex justify-between text-sm">
                  <span className="text-gray-500">Fee per dispatch</span>
                  <span className="font-semibold text-gray-900">₹{(data.ambulance_fee || 3500).toLocaleString('en-IN')}</span>
                </div>
              </div>

              {/* Per doctor */}
              <div>
                <h4 className="text-xs uppercase tracking-widest text-gray-400 font-semibold mb-3">Per Doctor</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-widest text-gray-400 border-b border-gray-100">
                        {['Doctor', 'Specialization', 'Appts', 'Fee/Visit', 'Total Revenue'].map(h => (
                          <th key={h} className="py-2 px-3 text-left font-semibold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {data.by_doctor.map(d => (
                        <tr key={d.doctor} className="hover:bg-gray-50">
                          <td className="py-2.5 px-3 font-medium text-gray-900">{d.doctor}</td>
                          <td className="py-2.5 px-3 text-gray-500 text-xs">{d.specialization}</td>
                          <td className="py-2.5 px-3 text-gray-700 tabular-nums">{d.appointments}</td>
                          <td className="py-2.5 px-3 text-gray-700 tabular-nums">₹{d.total_per_appt.toLocaleString('en-IN')}</td>
                          <td className="py-2.5 px-3 font-bold text-emerald-700 tabular-nums">₹{d.revenue.toLocaleString('en-IN')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const PAGE_SIZE = 15

export default function AnalyticsPage() {
  const [calls, setCalls]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [filter, setFilter]         = useState('all')
  const [page, setPage]             = useState(1)
  const [selectedId, setSelectedId] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [showEarnings, setShowEarnings] = useState(false)

  const fetchCalls = useCallback(async () => {
    try {
      const res  = await fetch(`${BASE}/analytics/calls`)
      const data = await res.json()
      setCalls(data.calls || [])
      setLastUpdated(new Date())
    } catch (e) {
      console.error('Analytics fetch error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchCalls() }, [fetchCalls])

  const filtered = calls.filter(c => {
    const matchSearch = !search || [c.patient_name, c.phone_masked, c.doctor_booked]
      .some(v => (v || '').toLowerCase().includes(search.toLowerCase()))
    const matchFilter = filter === 'all' || c.outcome === filter
    return matchSearch && matchFilter
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // Reset to page 1 whenever search or filter changes
  useEffect(() => { setPage(1) }, [search, filter])

  // Summary stats
  const totalCalls       = calls.length
  const completedCalls   = calls.filter(c => c.outcome === 'completed').length
  const escalatedCalls   = calls.filter(c => c.outcome === 'escalated').length
  const incompleteCalls  = calls.filter(c => c.outcome === 'incomplete').length
  const totalTokens      = calls.reduce((s, c) => s + (c.tokens_used || 0), 0)
  const totalCost        = calls.reduce((s, c) => s + (c.cost_usd || 0), 0)
  const bookedCalls      = calls.filter(c => c.doctor_booked && c.doctor_booked !== '—').length
  const emergencyCalls   = calls.filter(c => c.emergency_triggered).length

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-inter flex flex-col">

      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shadow-sm">
        <div>
          <h1 className="text-lg font-bold text-gray-900" style={{ fontFamily: '"Playfair Display", serif' }}>
            Call Analytics
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Loading...'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowEarnings(true)}
            className="flex items-center gap-1.5 text-xs text-emerald-700 border border-emerald-200 bg-emerald-50 rounded-lg px-3 py-1.5 hover:bg-emerald-100 transition-colors font-medium"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
            </svg>
            Clinic Earnings
          </button>
          <button
            onClick={fetchCalls}
            className="flex items-center gap-1.5 text-xs text-primary border border-primary/30 rounded-lg px-3 py-1.5 hover:bg-primary/5 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0115 0M20 15a9 9 0 01-15 0"/>
            </svg>
            Refresh
          </button>
        </div>
      </header>

      <main className="flex-1 p-6 space-y-6 overflow-y-auto">

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-8 gap-4">
          {[
            { label: 'Total Calls',  value: totalCalls,                         cls: 'text-gray-900' },
            { label: 'Completed',    value: completedCalls,                     cls: 'text-emerald-700' },
            { label: 'Incomplete',   value: incompleteCalls,                    cls: 'text-amber-600' },
            { label: 'Escalated',    value: escalatedCalls,                     cls: 'text-red-600' },
            { label: 'Emergency',    value: emergencyCalls,                     cls: 'text-orange-600' },
            { label: 'Appointments', value: bookedCalls,                        cls: 'text-primary' },
            { label: 'Total Tokens', value: totalTokens.toLocaleString(),       cls: 'text-gray-700' },
            { label: 'Total Cost',   value: `$${totalCost.toFixed(4)}`,        cls: 'text-gray-700' },
          ].map(({ label, value, cls }) => (
            <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3">
              <p className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold">{label}</p>
              <p className={`text-2xl font-bold mt-1 ${cls}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="text"
            placeholder="Search by name, phone, doctor..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 min-w-48 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          {['all', 'completed', 'incomplete', 'escalated'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-2 text-xs rounded-lg font-medium capitalize transition-colors ${
                filter === f
                  ? 'bg-primary text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {f}
            </button>
          ))}
          <span className="text-xs text-gray-400">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-sm text-gray-400">Loading call records...</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-gray-400">No calls found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-[11px] uppercase tracking-widest text-gray-400">
                    {['Time', 'Patient', 'Phone', 'Doctor', 'Slot', 'Duration', 'Tokens', 'Cost', 'Outcome', 'Escalation', 'Emergency', ''].map(h => (
                      <th key={h} className="px-4 py-3 text-left font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {paginated.map(call => {
                    const meta = OUTCOME_META[call.outcome] || OUTCOME_META.completed
                    return (
                      <tr key={call.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">
                          {formatDateTime(call.created_at)}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                          {call.patient_name || '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-500 font-mono text-xs whitespace-nowrap">
                          {call.phone_masked}
                        </td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                          {call.doctor_booked || '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                          {formatSlot(call.appointment_date, call.appointment_time)}
                        </td>
                        <td className="px-4 py-3 text-gray-500 tabular-nums whitespace-nowrap">
                          {call.duration || '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-500 tabular-nums whitespace-nowrap">
                          {(call.tokens_used || 0).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-gray-500 tabular-nums whitespace-nowrap">
                          ${(call.cost_usd || 0).toFixed(4)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`text-[10px] font-semibold px-2 py-1 rounded-full uppercase tracking-wide ${meta.cls}`}>
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-red-500 whitespace-nowrap">
                          {call.escalation_reason
                            ? ESCALATION_LABELS[call.escalation_reason] || call.escalation_reason
                            : ''}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {call.emergency_triggered && (
                            <span className={`text-[10px] font-semibold px-2 py-1 rounded-full uppercase tracking-wide ${
                              call.emergency_option === 'ambulance'
                                ? 'bg-red-100 text-red-700'
                                : call.emergency_option === 'callback'
                                ? 'bg-orange-100 text-orange-700'
                                : 'bg-orange-50 text-orange-600'
                            }`}>
                              {call.emergency_option === 'ambulance' ? 'Ambulance'
                               : call.emergency_option === 'callback' ? 'Callback'
                               : 'Triggered'}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <button
                            onClick={() => setSelectedId(call.id)}
                            className="text-xs text-primary hover:underline font-medium"
                          >
                            Transcript
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {!loading && filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between px-1">
            <p className="text-xs text-gray-400">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ← Prev
              </button>

              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(n => n === 1 || n === totalPages || Math.abs(n - page) <= 1)
                .reduce((acc, n, idx, arr) => {
                  if (idx > 0 && n - arr[idx - 1] > 1) acc.push('…')
                  acc.push(n)
                  return acc
                }, [])
                .map((n, i) =>
                  n === '…' ? (
                    <span key={`ellipsis-${i}`} className="px-2 text-xs text-gray-400">…</span>
                  ) : (
                    <button
                      key={n}
                      onClick={() => setPage(n)}
                      className={`w-8 h-8 text-xs rounded-lg font-medium transition-colors ${
                        page === n
                          ? 'bg-primary text-white'
                          : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {n}
                    </button>
                  )
                )}

              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next →
              </button>
            </div>
          </div>
        )}

      </main>

      {selectedId && (
        <TranscriptModal callId={selectedId} onClose={() => setSelectedId(null)} />
      )}
      {showEarnings && (
        <EarningsModal onClose={() => setShowEarnings(false)} />
      )}
    </div>
  )
}
