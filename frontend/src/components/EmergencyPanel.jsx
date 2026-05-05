import { useEffect, useRef } from 'react'
import { AlertTriangle, Phone, ArrowLeft, CheckCircle, MapPin, Truck, X, Download } from 'lucide-react'
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import { jsPDF } from 'jspdf'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

const STYLES = `
  @keyframes em-slide-in {
    from { opacity: 0; transform: translateY(14px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .em-slide-in { animation: em-slide-in 0.3s cubic-bezier(0.4,0,0.2,1) both; }
  @keyframes em-ping-red {
    0%   { transform: scale(1);   opacity: 0.7; }
    70%  { transform: scale(2.2); opacity: 0; }
    100% { transform: scale(2.2); opacity: 0; }
  }
  .em-ping-red { animation: em-ping-red 1.8s ease-out infinite; }
`


function MapClickHandler({ onMapClick }) {
  useMapEvents({ click: (e) => onMapClick(e.latlng) })
  return null
}

function downloadAmbulancePDF({ bookingRef, patientName, phone, address, pincode, dispatchTime }) {
  const doc = new jsPDF()
  const W = doc.internal.pageSize.getWidth()
  const unit = `AMB-KA-${bookingRef.slice(-3)}`

  // Red header
  doc.setFillColor(220, 38, 38)
  doc.rect(0, 0, W, 38, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.text('VoiceDesk AI Emergency Services', W / 2, 15, { align: 'center' })
  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  doc.text('AMBULANCE DISPATCH SLIP', W / 2, 27, { align: 'center' })

  // Green status bar
  doc.setFillColor(22, 163, 74)
  doc.rect(0, 38, W, 11, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('STATUS: DISPATCHED  ✓', W / 2, 45.5, { align: 'center' })

  doc.setTextColor(30, 30, 30)

  const section = (title, y) => {
    doc.setFillColor(248, 250, 252)
    doc.rect(14, y - 6, W - 28, 6, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(220, 38, 38)
    doc.text(title, 16, y)
    doc.setTextColor(30, 30, 30)
    return y + 7
  }

  const row = (label, value, y) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(100, 100, 100)
    doc.text(label, 16, y)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(20, 20, 20)
    const wrapped = doc.splitTextToSize(String(value || '—'), W - 85)
    doc.text(wrapped, 82, y)
    return y + wrapped.length * 5.5 + 2
  }

  let y = 58
  y = section('BOOKING DETAILS', y)
  y = row('Booking Reference:', bookingRef, y)
  y = row('Patient Name:', patientName, y)
  y = row('Phone Number:', phone || '—', y)
  y = row('Dispatch Time:', dispatchTime, y)
  y = row('Service Type:', 'Emergency Ambulance', y)
  y += 3

  y = section('PICKUP LOCATION', y)
  y = row('Full Address:', address, y)
  y = row('Pincode:', pincode, y)
  y = row('City:', 'Bangalore', y)
  y += 3

  y = section('DISPATCH INFO', y)
  y = row('Assigned Unit:', unit, y)
  y = row('Estimated Response:', '10 - 15 minutes', y)
  y = row('Emergency Helpline:', '108 / 112', y)
  y += 3

  y = section('SERVICE & PAYMENT', y)
  y = row('Base Fare:', 'Rs. 500', y)
  y = row('Distance Rate:', 'Rs. 12/km (calculated on arrival)', y)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(22, 163, 74)
  doc.text('PAYMENT MODE: PAY AT CLINIC', 16, y)
  y += 6

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(100, 100, 100)
  const note = doc.splitTextToSize(
    'Billing will be processed at the receiving facility. Emergency services are free for eligible AB-PMJAY beneficiaries.',
    W - 30
  )
  doc.text(note, 16, y)
  y += note.length * 4.5 + 6

  // Horizontal divider
  doc.setDrawColor(220, 220, 220)
  doc.line(14, y, W - 14, y)
  y += 6

  doc.setFont('helvetica', 'italic')
  doc.setFontSize(7.5)
  doc.setTextColor(130, 130, 130)
  doc.text('VoiceDesk AI Emergency Services', W / 2, y, { align: 'center' })
  y += 5
  doc.text('emergency@voicedesk.ai  |  Helpline: 1800-XXX-XXXX', W / 2, y, { align: 'center' })
  y += 4
  doc.text('This is a system-generated document. Presented for demonstration purposes.', W / 2, y, { align: 'center' })

  doc.save(`ambulance-dispatch-${bookingRef}.pdf`)
}

// ── Sub-views ──────────────────────────────────────────────────────────────────

function OptionsView({ onSelectCallback, onSelectAmbulance, onClose }) {
  return (
    <div className="em-slide-in flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <p className="font-bold text-gray-900 text-base">Emergency Assistance</p>
            <p className="text-sm text-gray-500">Choose how you'd like to proceed</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors flex-shrink-0"
        >
          <X className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      {/* Option 1 — Specialist Callback */}
      <button
        onClick={onSelectCallback}
        className="w-full p-5 bg-blue-50 border border-blue-200 rounded-2xl hover:bg-blue-100 active:scale-[0.98] transition-all text-left group"
      >
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-200 transition-colors">
            <Phone className="w-6 h-6 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-base text-gray-900">Specialist Callback</p>
            <p className="text-sm text-gray-600 mt-1.5 leading-relaxed">
              A specialized medical agent will call you within 5 minutes.
            </p>
          </div>
          <span className="text-blue-400 text-xl flex-shrink-0 mt-1">→</span>
        </div>
      </button>

      {/* Option 2 — Book Ambulance */}
      <button
        onClick={onSelectAmbulance}
        className="w-full p-5 bg-red-50 border border-red-200 rounded-2xl hover:bg-red-100 active:scale-[0.98] transition-all text-left group"
      >
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0 group-hover:bg-red-200 transition-colors">
            <Truck className="w-6 h-6 text-red-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-base text-gray-900">Book Ambulance</p>
            <p className="text-sm text-gray-600 mt-1.5 leading-relaxed">
              Dispatch an ambulance to your location immediately.
            </p>
          </div>
          <span className="text-red-400 text-xl flex-shrink-0 mt-1">→</span>
        </div>
      </button>
    </div>
  )
}

function CallbackConfirmed({ onClose }) {
  return (
    <div className="em-slide-in flex flex-col items-center gap-5 py-8 text-center">
      <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
        <CheckCircle className="w-10 h-10 text-green-600" />
      </div>
      <div>
        <p className="font-bold text-gray-900 text-lg">Specialist Will Call Shortly</p>
        <p className="text-sm text-gray-500 mt-2 max-w-[260px] leading-relaxed">
          A medical specialist will call you within 5 minutes. Please stay calm and keep your phone nearby.
        </p>
      </div>
      <div className="w-full bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-800 font-semibold">
        Do not end the call — stay on the line.
      </div>
      <button onClick={onClose} className="text-sm text-primary font-semibold hover:underline mt-1">
        Return to call
      </button>
    </div>
  )
}

function AmbulanceForm({ address, setAddress, pincode, setPincode, mapPin, setMapPin, onSubmit, onBack }) {
  return (
    <div className="em-slide-in flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors flex-shrink-0"
          >
            <ArrowLeft className="w-4 h-4 text-gray-600" />
          </button>
          <div>
            <p className="font-bold text-gray-900 text-base">Ambulance Dispatch</p>
            <p className="text-sm text-gray-500">Enter your location details carefully</p>
          </div>
        </div>
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2 flex-shrink-0">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
          <div className="text-right">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold leading-none mb-0.5">Ambulances Available</p>
            <p className="text-sm font-bold text-green-700 leading-none">4 / 6</p>
          </div>
        </div>
      </div>

      {/* Service area notice */}
      <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5">
        <MapPin className="w-4 h-4 text-blue-500 flex-shrink-0" />
        <p className="text-xs text-blue-700 font-medium">Ambulance service available within Bangalore region only.</p>
      </div>

      {/* Mic-off notice */}
      <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
        <svg className="w-4 h-4 text-amber-600 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
          <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>
        </svg>
        <p className="text-xs text-amber-700 font-medium">Voice input paused — please type your address for accuracy</p>
      </div>

      {/* Address */}
      <div>
        <label className="text-sm font-semibold text-gray-700 mb-1.5 block">
          Full Address <span className="text-red-500">*</span>
        </label>
        <textarea
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Flat/House no., Building, Street, Area, City"
          rows={3}
          className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400 resize-none"
        />
      </div>

      {/* Pincode */}
      <div>
        <label className="text-sm font-semibold text-gray-700 mb-1.5 block">
          Pincode <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={pincode}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '')
            if (v.length <= 6) setPincode(v)
          }}
          placeholder="6-digit pincode"
          className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400 font-mono tracking-widest"
          maxLength={6}
        />
        {pincode.length > 0 && pincode.length < 6 && (
          <p className="text-xs text-red-400 mt-1">{6 - pincode.length} more digit{6 - pincode.length !== 1 ? 's' : ''} needed</p>
        )}
      </div>

      {/* Map */}
      <div>
        <label className="text-sm font-semibold text-gray-700 mb-1.5 block">
          Confirm on Map <span className="text-gray-400 font-normal text-xs">(optional — click to drop pin)</span>
        </label>
        <div className="rounded-xl overflow-hidden border border-gray-200" style={{ height: '190px' }}>
          <MapContainer
            center={[12.9716, 77.5946]}
            zoom={11}
            scrollWheelZoom={false}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            />
            <MapClickHandler onMapClick={setMapPin} />
            {mapPin && <Marker position={[mapPin.lat, mapPin.lng]} />}
          </MapContainer>
        </div>
        {mapPin ? (
          <p className="text-xs text-gray-500 mt-1.5 flex items-center gap-1">
            <MapPin className="w-3 h-3 text-primary flex-shrink-0" />
            Pin: {mapPin.lat.toFixed(4)}, {mapPin.lng.toFixed(4)}
          </p>
        ) : (
          <p className="text-xs text-gray-400 mt-1.5">Click anywhere on the map to mark your location.</p>
        )}
      </div>

      <button
        onClick={onSubmit}
        disabled={address.trim().length < 5 || pincode.length !== 6}
        className="w-full py-3 bg-red-600 text-white rounded-xl font-bold text-sm hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
      >
        Dispatch Ambulance
      </button>
    </div>
  )
}

function AmbulanceDispatching() {
  return (
    <div className="em-slide-in flex flex-col items-center gap-5 py-8 text-center">
      <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center">
        <Truck className="w-10 h-10 text-red-600" style={{ animation: 'em-slide-in 0.6s ease-in-out infinite alternate' }} />
      </div>
      <div>
        <p className="font-bold text-gray-900 text-lg">Ambulance Dispatched</p>
        <p className="text-sm text-gray-500 mt-2 max-w-[260px] leading-relaxed">
          Ending call and preparing your dispatch slip…
        </p>
      </div>
      <div className="w-full bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-800 font-semibold">
        Stay at your location — help is on the way.
      </div>
    </div>
  )
}

export function AmbulanceSlip({ bookingRef, patientName, phone, address, pincode, dispatchTime, onClose }) {
  const unit = `AMB-KA-${bookingRef.slice(-3)}`

  return (
    <div className="em-slide-in flex flex-col gap-0">
      {/* Slip header */}
      <div className="bg-red-600 rounded-t-2xl p-4 text-white text-center">
        <div className="flex items-center justify-center gap-2 mb-1">
          <Truck className="w-5 h-5" />
          <span className="font-bold text-base tracking-wide">AMBULANCE DISPATCHED</span>
        </div>
        <p className="text-xs text-red-200 uppercase tracking-widest">VoiceDesk AI Emergency Services</p>
      </div>

      {/* Green status */}
      <div className="bg-green-600 py-1.5 text-center">
        <span className="text-white text-xs font-bold tracking-widest uppercase">✓ Status: Dispatched</span>
      </div>

      {/* Slip body */}
      <div className="bg-white rounded-b-2xl border border-gray-200 border-t-0 p-4 flex flex-col gap-3">

        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Booking Ref</p>
            <p className="font-bold text-gray-900 text-sm mt-0.5">{bookingRef}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Dispatch Time</p>
            <p className="font-medium text-gray-800 text-sm mt-0.5">{dispatchTime}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Patient</p>
            <p className="font-medium text-gray-800 text-sm mt-0.5">{patientName}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Assigned Unit</p>
            <p className="font-bold text-gray-900 text-sm mt-0.5">{unit}</p>
          </div>
          {phone && (
            <div className="col-span-2">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Phone Number</p>
              <p className="font-medium text-gray-800 text-sm mt-0.5">{phone}</p>
            </div>
          )}
        </div>

        <div className="border-t border-gray-100 pt-3">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold mb-1">Pickup Address</p>
          <p className="text-sm text-gray-800 leading-snug">{address}</p>
          <p className="text-xs text-gray-500 mt-0.5">Pincode: {pincode} · Bangalore</p>
        </div>

        <div className="border-t border-gray-100 pt-3 flex items-center justify-between">
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">ETA</p>
            <p className="text-sm font-semibold text-gray-800 mt-0.5">10 – 15 minutes</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Emergency No.</p>
            <p className="text-sm font-bold text-red-600 mt-0.5">108 / 112</p>
          </div>
        </div>

        <div className="border-t border-gray-100 pt-3 grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Service Charge</p>
            <p className="text-sm text-gray-800 mt-0.5">₹500 base + ₹12/km</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">Payment</p>
            <p className="text-sm font-medium text-gray-800 mt-0.5">Pay at Clinic</p>
          </div>
        </div>

        <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2.5 text-xs text-green-800 leading-relaxed">
          Billing processed at the receiving facility. AB-PMJAY eligible patients receive emergency services at no cost.
        </div>

        {/* Actions */}
        <button
          onClick={() => downloadAmbulancePDF({ bookingRef, patientName, phone, address, pincode, dispatchTime })}
          className="w-full py-2.5 flex items-center justify-center gap-2 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-gray-800 transition-all active:scale-[0.98]"
        >
          <Download className="w-4 h-4" />
          Download Dispatch Slip (PDF)
        </button>

        <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 font-semibold hover:underline text-center transition-colors">
          Close
        </button>

        <p className="text-[10px] text-gray-400 text-center leading-relaxed">
          VoiceDesk AI Emergency Services<br />
          This is a system-generated document.
        </p>
      </div>
    </div>
  )
}

// ── Emergency Banner ────────────────────────────────────────────────────────────

export function EmergencyBanner({ onClick }) {
  return (
    <>
      <style>{STYLES}</style>
      <button
        onClick={onClick}
        className="w-full flex items-center gap-4 p-4 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 active:scale-[0.99] transition-all text-left group"
      >
        {/* Icon with red ping ring */}
        <div className="relative flex-shrink-0">
          <div className="em-ping-red absolute inset-0 rounded-full bg-red-400" />
          <div className="relative w-11 h-11 rounded-full bg-red-100 flex items-center justify-center group-hover:bg-red-200 transition-colors">
            <AlertTriangle className="w-6 h-6 text-red-600" />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-base font-bold text-red-700 leading-tight">Medical Emergency?</p>
          <p className="text-sm text-red-500 mt-0.5 leading-snug">
            Tap here — or say <span className="font-semibold">"I have an emergency"</span>
          </p>
        </div>
        <span className="text-red-400 text-xl flex-shrink-0">→</span>
      </button>
    </>
  )
}

// ── Emergency Panel (main) ──────────────────────────────────────────────────────

export default function EmergencyPanel({
  step,
  onSelectCallback,
  onSelectAmbulance,
  onConfirmAmbulance,
  onClose,
  onBack,
  address, setAddress,
  pincode, setPincode,
  mapPin, setMapPin,
  onMicMute,
  onSpeak,
  patient,
  bookingRef,
  dispatchTime,
}) {
  const patientName = patient?.name || 'Patient'

  // Speak via real Cartesia/ElevenLabs voice on each step
  useEffect(() => {
    const lines = {
      options:
        'You have two options. Either Get a specialist callback within 5 minutes. ' +
        'or Book an ambulance. Please select your choice.',
      callback_confirmed:
        'A medical specialist will call you within 5 minutes. Please stay calm and keep your phone nearby.',
      ambulance_form:
        'Please type your full address in the form below and optionally mark your location on the map.',
      ambulance_confirmed:
        'Your ambulance has been dispatched. Emergency services are on their way. Please stay at your location.',
    }
    if (lines[step]) onSpeak?.(lines[step])
  }, [step])

  // Mute mic when user is in the address form or confirmed
  useEffect(() => {
    const shouldMute = step === 'ambulance_form' || step === 'ambulance_confirmed'
    onMicMute?.(shouldMute)
    return () => onMicMute?.(false)
  }, [step])

  return (
    <div className="bg-white rounded-2xl shadow-md border border-red-100 p-5">
      <style>{STYLES}</style>

      {step === 'options' && (
        <OptionsView
          key="options"
          onSelectCallback={onSelectCallback}
          onSelectAmbulance={onSelectAmbulance}
          onClose={onClose}
        />
      )}
      {step === 'callback_confirmed' && (
        <CallbackConfirmed key="callback_confirmed" onClose={onClose} />
      )}
      {step === 'ambulance_form' && (
        <AmbulanceForm
          key="ambulance_form"
          address={address}
          setAddress={setAddress}
          pincode={pincode}
          setPincode={setPincode}
          mapPin={mapPin}
          setMapPin={setMapPin}
          onSubmit={onConfirmAmbulance}
          onBack={onBack}
        />
      )}
      {step === 'ambulance_dispatching' && (
        <AmbulanceDispatching key="ambulance_dispatching" />
      )}
      {step === 'ambulance_confirmed' && (
        <AmbulanceSlip
          key="ambulance_confirmed"
          bookingRef={bookingRef}
          patientName={patientName}
          address={address}
          pincode={pincode}
          dispatchTime={dispatchTime}
          onClose={onClose}
        />
      )}
    </div>
  )
}
