import { useState, useEffect } from 'react'
import { jsPDF } from 'jspdf'

function formatDate(value) {
  if (!value) return 'N/A'
  const parsed = new Date(`${value}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

function formatTime(value) {
  if (!value) return 'N/A'
  const [hour = 0, minute = 0] = value.split(':').map(Number)
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`
}

function formatDateTime(value) {
  if (!value) return 'N/A'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'N/A'
  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatMoney(value, currency = 'INR') {
  return `${currency} ${Number(value || 0).toLocaleString('en-IN')}`
}

function fallbackRef(prefix) {
  return `${prefix}-${Date.now().toString().slice(-8)}`
}

function buildDisplaySlip(appointmentSlip, patient, startedAt, appointmentsMade) {
  const hasSlip = appointmentSlip && Object.keys(appointmentSlip).length > 0
  if (hasSlip) return appointmentSlip

  return {
    clinic: {
      name: 'VoiceDesk Healthcare Clinic',
      address: '2nd Floor, Wellness Plaza, MG Road, Bengaluru, Karnataka 560001',
      phone: '+91 80 4567 2300',
      email: 'appointments@voicedesk.health',
      gstin: '29AAFCV4821K1Z5',
    },
    references: {
      slip_number: fallbackRef('VD-SLIP'),
      invoice_number: fallbackRef('INV'),
      receipt_number: fallbackRef('RCPT'),
      booking_reference: fallbackRef('BOOK'),
      queue_number: 'Q--',
    },
    patient: {
      name: patient?.name || 'Patient',
      phone_number: patient?.phone_number || 'N/A',
      patient_id: fallbackRef('PAT'),
    },
    doctor: {
      name: 'Doctor details pending',
      specialization: 'N/A',
      qualification: 'N/A',
      experience_years: 'N/A',
    },
    slot: {
      date: '',
      time: '',
      status: appointmentsMade?.length ? 'Confirmed' : 'Pending',
      type: 'Outpatient Consultation',
      mode: 'In-clinic visit',
    },
    billing: {
      consultation_fee: 750,
      registration_fee: 100,
      service_fee: 50,
      total_amount: 900,
      currency: 'INR',
      payment_status: 'Pay at clinic',
      payment_mode: 'Counter payment pending',
    },
    timestamps: {
      issued_at: new Date().toISOString(),
      call_started_at: startedAt,
    },
    instructions: [
      'Please arrive 15 minutes before the appointment time.',
      'Carry a valid photo ID and any previous prescriptions or reports.',
      'This slip is valid only for the appointment slot mentioned above.',
      'For cancellation or rescheduling, contact the clinic before the appointment time.',
    ],
  }
}

function generateAppointmentPDF(slip, summary, appointmentsMade, tokensUsed, costUsd, duration, toolCalls) {
  const doc = new jsPDF()
  const W = doc.internal.pageSize.getWidth()

  const clinic    = slip.clinic    || {}
  const refs      = slip.references || {}
  const patient   = slip.patient   || {}
  const doctor    = slip.doctor    || {}
  const slot      = slip.slot      || {}
  const billing   = slip.billing   || {}
  const timestamps = slip.timestamps || {}
  const instructions = slip.instructions || []

  // ── Header ──────────────────────────────────────────────────────────────
  doc.setFillColor(8, 145, 178)
  doc.rect(0, 0, W, 42, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text(clinic.name || 'VoiceDesk Healthcare Clinic', W / 2, 14, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.text(clinic.address || '', W / 2, 22, { align: 'center' })
  doc.text(`${clinic.phone || ''}  |  ${clinic.email || ''}  |  GSTIN: ${clinic.gstin || ''}`, W / 2, 30, { align: 'center' })

  // ── Status bar ───────────────────────────────────────────────────────────
  const confirmed = slot.status === 'Confirmed'
  doc.setFillColor(confirmed ? 22 : 217, confirmed ? 163 : 119, confirmed ? 74 : 6)
  doc.rect(0, 42, W, 11, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(255, 255, 255)
  doc.text(
    `APPOINTMENT CONFIRMATION SLIP  |  STATUS: ${(slot.status || 'PENDING').toUpperCase()}`,
    W / 2, 49.5, { align: 'center' }
  )
  doc.setTextColor(30, 30, 30)

  // ── Helpers ──────────────────────────────────────────────────────────────
  const sectionHeader = (title, y) => {
    doc.setFillColor(240, 249, 255)
    doc.rect(14, y - 5, W - 28, 7, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(8, 145, 178)
    doc.text(title, 16, y)
    doc.setTextColor(30, 30, 30)
    return y + 8
  }

  const kv = (label, value, y, lx = 16, vx = 58) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(110, 110, 110)
    doc.text(label, lx, y)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(20, 20, 20)
    const lines = doc.splitTextToSize(String(value || '—'), W - vx - 14)
    doc.text(lines, vx, y)
    return y + lines.length * 5 + 1.5
  }

  // ── References ───────────────────────────────────────────────────────────
  let y = 62
  y = sectionHeader('BOOKING REFERENCES', y)

  const mid = W / 2
  const refPairs = [
    ['Slip No:', refs.slip_number, 'Invoice No:', refs.invoice_number],
    ['Booking Ref:', refs.booking_reference, 'Queue No:', refs.queue_number],
  ]
  refPairs.forEach(([l1, v1, l2, v2]) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(110, 110, 110)
    doc.text(l1, 16, y)
    doc.setFont('helvetica', 'normal'); doc.setTextColor(20, 20, 20)
    doc.text(String(v1 || '—'), 44, y)
    doc.setFont('helvetica', 'bold'); doc.setTextColor(110, 110, 110)
    doc.text(l2, mid + 2, y)
    doc.setFont('helvetica', 'normal'); doc.setTextColor(20, 20, 20)
    doc.text(String(v2 || '—'), mid + 28, y)
    y += 6
  })
  y += 4

  // ── Patient + Doctor (two columns) ───────────────────────────────────────
  doc.setFillColor(240, 249, 255)
  doc.rect(14, y - 5, mid - 17, 7, 'F')
  doc.rect(mid, y - 5, mid - 3, 7, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(8, 145, 178)
  doc.text('PATIENT DETAILS', 16, y)
  doc.text('DOCTOR DETAILS', mid + 2, y)
  doc.setTextColor(30, 30, 30)
  y += 8

  const startY = y
  let py = startY
  const pKv = (l, v) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(110,110,110); doc.text(l, 16, py); doc.setFont('helvetica', 'normal'); doc.setTextColor(20,20,20); doc.text(String(v||'—'), 42, py); py += 6 }
  pKv('Name:', patient.name)
  pKv('Phone:', patient.phone_number)
  pKv('Patient ID:', patient.patient_id)

  let dy = startY
  const dKv = (l, v) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(110,110,110); doc.text(l, mid+2, dy); doc.setFont('helvetica', 'normal'); doc.setTextColor(20,20,20); const lines = doc.splitTextToSize(String(v||'—'), mid-30); doc.text(lines, mid+26, dy); dy += lines.length * 5 + 1 }
  dKv('Doctor:', doctor.name)
  dKv('Specialization:', doctor.specialization)
  dKv('Qualification:', doctor.qualification)
  dKv('Experience:', `${doctor.experience_years || 'N/A'} years`)

  doc.setDrawColor(200, 200, 200)
  doc.line(mid - 1, startY - 13, mid - 1, Math.max(py, dy) + 2)
  y = Math.max(py, dy) + 6

  // ── Slot ────────────────────────────────────────────────────────────────
  y = sectionHeader('APPOINTMENT SLOT', y)
  const boxW = (W - 30) / 4
  ;[['DATE', formatDate(slot.date)], ['TIME', formatTime(slot.time)], ['VISIT TYPE', slot.type || 'N/A'], ['MODE', slot.mode || 'N/A']].forEach((item, i) => {
    const bx = 14 + i * (boxW + 0.7)
    doc.setFillColor(240, 249, 255)
    doc.rect(bx, y - 2, boxW - 1, 17, 'F')
    doc.setDrawColor(186, 230, 253)
    doc.rect(bx, y - 2, boxW - 1, 17, 'S')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(8, 145, 178)
    doc.text(item[0], bx + (boxW - 1) / 2, y + 4, { align: 'center' })
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(20, 20, 20)
    const vLines = doc.splitTextToSize(item[1], boxW - 5)
    doc.text(vLines[0] || '', bx + (boxW - 1) / 2, y + 11, { align: 'center' })
  })
  y += 23

  // ── Billing ──────────────────────────────────────────────────────────────
  y = sectionHeader('BILLING DETAILS', y)
  y = kv('Consultation Fee:', `Rs. ${billing.consultation_fee || 0}`, y)
  y = kv('Registration Fee:', `Rs. ${billing.registration_fee || 0}`, y)
  y = kv('Service Fee:', `Rs. ${billing.service_fee || 0}`, y)
  doc.setDrawColor(220, 220, 220)
  doc.line(14, y, W - 14, y)
  y += 5
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(20, 20, 20)
  doc.text('Total Amount:', 16, y)
  doc.text(`Rs. ${billing.total_amount || 0}`, W - 14, y, { align: 'right' })
  y += 7
  y = kv('Payment:', billing.payment_status || 'Pay at Clinic', y)
  y += 4

  // ── Instructions ─────────────────────────────────────────────────────────
  y = sectionHeader('PATIENT INSTRUCTIONS', y)
  instructions.forEach((instr, i) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(50, 50, 50)
    const lines = doc.splitTextToSize(`${i + 1}. ${instr}`, W - 30)
    doc.text(lines, 16, y)
    y += lines.length * 5 + 2
  })
  y += 3

  // ── Footer ───────────────────────────────────────────────────────────────
  doc.setDrawColor(220, 220, 220)
  doc.line(14, y, W - 14, y)
  y += 5
  doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(140, 140, 140)
  doc.text(`Issued: ${formatDateTime(timestamps.issued_at)}  |  Duration: ${duration || 'N/A'}  |  Tokens: ${tokensUsed.toLocaleString()}  |  AI Cost: $${costUsd.toFixed(4)}`, W / 2, y, { align: 'center' })
  y += 4
  doc.text('VoiceDesk AI — This is a computer-generated slip and does not require a physical signature.', W / 2, y, { align: 'center' })

  doc.save(`${refs.invoice_number || 'appointment-slip'}.pdf`)
}

export default function SummaryCard({
  summary,
  appointmentsMade = [],
  tokensUsed = 0,
  costUsd = 0,
  duration,
  conversationStage,
  startedAt,
  toolCalls = [],
  patient = {},
  appointmentSlip = {},
  onClose,
  onNewCall,
}) {
  const hasConfirmedBooking = (
    appointmentSlip &&
    Object.keys(appointmentSlip).length > 0 &&
    appointmentSlip.doctor?.name &&
    appointmentSlip.doctor.name !== 'Doctor details pending' &&
    appointmentSlip.slot?.date
  )
  const slip = buildDisplaySlip(appointmentSlip, patient, startedAt, appointmentsMade)
  const clinic = slip.clinic || {}
  const refs = slip.references || {}
  const patientInfo = slip.patient || {}
  const doctor = slip.doctor || {}
  const slot = slip.slot || {}
  const billing = slip.billing || {}
  const timestamps = slip.timestamps || {}
  const instructions = slip.instructions || []

  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [])

  function handleDownload() {
    generateAppointmentPDF(slip, summary, appointmentsMade, tokensUsed, costUsd, duration, toolCalls)
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 p-4 transition-all duration-300"
      style={{
        backgroundColor: visible ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0)',
        backdropFilter: visible ? 'blur(4px)' : 'blur(0px)',
      }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-screen overflow-y-auto flex flex-col transition-all duration-500"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0) scale(1)' : 'translateY(28px) scale(0.97)',
        }}
      >
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between gap-4 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 font-poppins">
              {hasConfirmedBooking ? 'Appointment Slip' : 'Call Summary'}
            </h2>
            <p className="text-xs text-gray-400 mt-1">
              {hasConfirmedBooking ? `Issued ${formatDateTime(timestamps.issued_at)}` : 'No appointment was booked this call'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
        </div>

        <div className="flex-1 px-6 py-5 bg-gray-50">
          {!hasConfirmedBooking && (
            <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
              No appointment was confirmed during this call. The full slip will appear here when a booking is completed.
            </div>
          )}
          <article className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden" style={{ display: hasConfirmedBooking ? 'block' : 'none' }}>
            <header className="px-6 py-5 border-b-2 border-gray-900">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <h1 className="text-2xl font-bold text-gray-950 font-poppins">{clinic.name}</h1>
                  <p className="text-sm text-gray-600 mt-1 max-w-xl">{clinic.address}</p>
                  <p className="text-xs text-gray-500 mt-2">
                    {clinic.phone} | {clinic.email} | GSTIN: {clinic.gstin}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs uppercase tracking-wider text-gray-400 font-semibold">Status</p>
                  <p className="text-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-3 py-1 mt-1">
                    {slot.status}
                  </p>
                </div>
              </div>
            </header>

            <section className="px-6 py-5 border-b border-gray-200">
              <div className="flex items-center justify-between gap-4 mb-4">
                <h3 className="text-base font-bold text-gray-900 font-poppins">Appointment Confirmation Slip</h3>
                <p className="text-xs text-gray-500">Queue No: <span className="font-semibold text-gray-900">{refs.queue_number}</span></p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  ['Slip No.', refs.slip_number],
                  ['Invoice No.', refs.invoice_number],
                  ['Receipt No.', refs.receipt_number],
                  ['Booking Ref.', refs.booking_reference],
                ].map(([label, value]) => (
                  <div key={label} className="border border-gray-100 rounded-lg px-3 py-2 bg-gray-50">
                    <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{label}</p>
                    <p className="text-xs font-semibold text-gray-800 mt-1 break-words">{value || 'N/A'}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="grid md:grid-cols-2 border-b border-gray-200">
              <div className="px-6 py-5 border-b md:border-b-0 md:border-r border-gray-200">
                <h4 className="text-xs uppercase tracking-wider text-gray-400 font-bold mb-3">Patient Details</h4>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-gray-500">Name</dt>
                    <dd className="font-semibold text-gray-900 text-right">{patientInfo.name}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-gray-500">Phone Number</dt>
                    <dd className="font-semibold text-gray-900 text-right">{patientInfo.phone_number}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-gray-500">Patient ID</dt>
                    <dd className="font-semibold text-gray-900 text-right">{patientInfo.patient_id}</dd>
                  </div>
                </dl>
              </div>

              <div className="px-6 py-5">
                <h4 className="text-xs uppercase tracking-wider text-gray-400 font-bold mb-3">Doctor Details</h4>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-gray-500">Doctor</dt>
                    <dd className="font-semibold text-gray-900 text-right">{doctor.name}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-gray-500">Specialization</dt>
                    <dd className="font-semibold text-gray-900 text-right">{doctor.specialization || 'N/A'}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-gray-500">Qualification</dt>
                    <dd className="font-semibold text-gray-900 text-right">{doctor.qualification || 'N/A'}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-gray-500">Experience</dt>
                    <dd className="font-semibold text-gray-900 text-right">{doctor.experience_years || 'N/A'} years</dd>
                  </div>
                </dl>
              </div>
            </section>

            <section className="px-6 py-5 border-b border-gray-200">
              <h4 className="text-xs uppercase tracking-wider text-gray-400 font-bold mb-3">Confirmed Slot</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  ['Date', formatDate(slot.date)],
                  ['Time', formatTime(slot.time)],
                  ['Visit Type', slot.type],
                  ['Mode', slot.mode],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-3">
                    <p className="text-[10px] uppercase tracking-wider text-sky-500 font-bold">{label}</p>
                    <p className="text-sm font-bold text-gray-900 mt-1">{value || 'N/A'}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="border-b border-gray-200">
              <div className="px-6 py-5">
                <h4 className="text-xs uppercase tracking-wider text-gray-400 font-bold mb-3">Billing Details</h4>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Consultation Fee</dt>
                    <dd className="font-semibold">{formatMoney(billing.consultation_fee, billing.currency)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Registration Fee</dt>
                    <dd className="font-semibold">{formatMoney(billing.registration_fee, billing.currency)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Service Fee</dt>
                    <dd className="font-semibold">{formatMoney(billing.service_fee, billing.currency)}</dd>
                  </div>
                  <div className="flex justify-between border-t border-gray-100 pt-2">
                    <dt className="font-bold text-gray-900">Total Amount</dt>
                    <dd className="font-bold text-gray-900">{formatMoney(billing.total_amount, billing.currency)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Payment</dt>
                    <dd className="font-semibold text-amber-700">{billing.payment_status}</dd>
                  </div>
                </dl>
              </div>
            </section>

            <section className="px-6 py-5 border-b border-gray-200">
              <h4 className="text-xs uppercase tracking-wider text-gray-400 font-bold mb-3">Confirmed Appointment Record</h4>
              {appointmentsMade.length > 0 ? (
                <ul className="space-y-2">
                  {appointmentsMade.map((appt, i) => (
                    <li key={i} className="text-sm text-gray-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                      {typeof appt === 'string' ? appt : JSON.stringify(appt)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-400 bg-gray-50 rounded-lg px-3 py-2">No confirmed appointment text was captured.</p>
              )}
            </section>

            <section className="px-6 py-5">
              <h4 className="text-xs uppercase tracking-wider text-gray-400 font-bold mb-3">Patient Instructions</h4>
              <ul className="grid md:grid-cols-2 gap-2">
                {instructions.map((item, index) => (
                  <li key={index} className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2">
                    {index + 1}. {item}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-gray-400 mt-4">
                Issued at {formatDateTime(timestamps.issued_at)}. This computer-generated appointment slip does not require a physical signature.
              </p>
            </section>
          </article>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3 sticky bottom-0 bg-white">
          {hasConfirmedBooking && (
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 px-5 py-2 text-sm bg-primary hover:bg-sky-600 text-white rounded-xl font-medium transition-all duration-200 shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
              </svg>
              Download PDF
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
