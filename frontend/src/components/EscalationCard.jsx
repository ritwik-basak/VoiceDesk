const REASON_LABELS = {
  patient_requested_human: { label: 'Human Agent Requested',            icon: '👤' },
  repeated_clarification:  { label: 'Repeated Communication Difficulty', icon: '🔄' },
}

export default function EscalationCard({ patient = {}, escalationReason, onNewCall }) {
  const meta  = REASON_LABELS[escalationReason] || { label: 'Escalated to Human', icon: '📞' }
  const phone = patient?.phone_number || 'your registered number'

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden">

        {/* Header */}
        <div className="bg-red-600 px-6 py-5 flex items-center gap-4">
          <span className="text-3xl">{meta.icon}</span>
          <div>
            <h2 className="text-lg font-bold text-white">Escalated to Human Agent</h2>
            <p className="text-red-100 text-sm mt-0.5">{meta.label}</p>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-6 flex flex-col gap-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-4 flex items-start gap-3">
            <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2L1 21h22L12 2zm0 3.5L20.5 19h-17L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z"/>
            </svg>
            <p className="text-sm text-amber-800 leading-relaxed">
              A VoiceDesk healthcare specialist will call you back at{' '}
              <span className="font-bold">{phone}</span> within{' '}
              <span className="font-bold">1 hour</span>.
              Please keep your phone available.
            </p>
          </div>

          <div className="space-y-2">
            {[
              'Your request has been logged and assigned to a specialist.',
              'You will receive a call on the number you provided.',
              'If urgent, please call your nearest emergency services.',
            ].map((line, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400 mt-2 flex-shrink-0" />
                <p className="text-sm text-gray-600">{line}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
          <button
            onClick={onNewCall}
            className="px-5 py-2 text-sm bg-primary hover:bg-sky-600 text-white rounded-xl font-medium transition-all duration-200 shadow-sm"
          >
            Start New Call
          </button>
        </div>
      </div>
    </div>
  )
}
