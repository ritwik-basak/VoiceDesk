import { useState } from 'react'
import {
  Heart, Stethoscope, Sparkles, Bone, Brain, Baby,
  Flower2, Ear, Eye, Lightbulb, Droplets, Wind,
  Zap, Droplet, Activity, Hospital,
} from 'lucide-react'

const SPEC = {
  'cardiologist':        { Icon: Heart,       color: 'text-red-500    bg-red-50    border-red-100'    },
  'general physician':   { Icon: Stethoscope, color: 'text-blue-500   bg-blue-50   border-blue-100'   },
  'dermatologist':       { Icon: Sparkles,    color: 'text-pink-500   bg-pink-50   border-pink-100'   },
  'orthopedic':          { Icon: Bone,        color: 'text-orange-500 bg-orange-50 border-orange-100' },
  'orthopedic surgeon':  { Icon: Bone,        color: 'text-orange-500 bg-orange-50 border-orange-100' },
  'neurologist':         { Icon: Brain,       color: 'text-purple-500 bg-purple-50 border-purple-100' },
  'pediatrician':        { Icon: Baby,        color: 'text-yellow-600 bg-yellow-50 border-yellow-100' },
  'gynecologist':        { Icon: Flower2,     color: 'text-rose-500   bg-rose-50   border-rose-100'   },
  'gynaecologist':       { Icon: Flower2,     color: 'text-rose-500   bg-rose-50   border-rose-100'   },
  'ent':                 { Icon: Ear,         color: 'text-teal-500   bg-teal-50   border-teal-100'   },
  'ophthalmologist':     { Icon: Eye,         color: 'text-cyan-500   bg-cyan-50   border-cyan-100'   },
  'psychiatrist':        { Icon: Lightbulb,   color: 'text-indigo-500 bg-indigo-50 border-indigo-100' },
  'diabetologist':       { Icon: Droplets,    color: 'text-amber-500  bg-amber-50  border-amber-100'  },
  'gastroenterologist':  { Icon: Activity,    color: 'text-lime-600   bg-lime-50   border-lime-100'   },
  'pulmonologist':       { Icon: Wind,        color: 'text-sky-500    bg-sky-50    border-sky-100'    },
  'endocrinologist':     { Icon: Zap,         color: 'text-violet-500 bg-violet-50 border-violet-100' },
  'urologist':           { Icon: Droplet,     color: 'text-emerald-500 bg-emerald-50 border-emerald-100' },
}

function getSpec(specialization) {
  const key = (specialization || '').toLowerCase().trim()
  return SPEC[key] || { Icon: Hospital, color: 'text-gray-500 bg-gray-50 border-gray-100' }
}

function formatTime(time) {
  const [hour, minute] = time.split(':').map(Number)
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`
}

export default function SlotCalendar({ slotGrid, onSelectSlot }) {
  const [selectedSlot, setSelectedSlot] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (!slotGrid?.days?.length) return null

  async function handleSlotClick(day, slot) {
    if (!slot.available || isSubmitting) return
    const key = `${day.date}-${slot.time}`
    setSelectedSlot(key)
    setIsSubmitting(true)
    try {
      await onSelectSlot(day.date, slot.time, slotGrid.doctor_name, day.label)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="mt-4 w-full max-w-3xl mx-auto bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {(() => { const { Icon, color } = getSpec(slotGrid.specialization); return (
            <div className={`flex-shrink-0 w-10 h-10 rounded-xl border flex items-center justify-center ${color}`}>
              <Icon size={20} />
            </div>
          )})()}
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-800 font-poppins leading-tight">
              Slots for {slotGrid.doctor_name}
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {selectedSlot ? 'Slot selected. Asking the assistant to confirm.' : slotGrid.specialization}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-gray-500 flex-shrink-0">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-secondary" />
            Available
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-gray-300" />
            Booked
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[680px] grid grid-cols-7 divide-x divide-gray-100">
          {slotGrid.days.map(day => (
            <div key={day.date} className="p-3">
              <div className="mb-3">
                <p className="text-xs font-semibold text-gray-700">{day.label}</p>
                <p className="text-[10px] text-gray-400 tabular-nums">{day.date}</p>
              </div>
              <div className="space-y-2">
                {day.slots.map(slot => {
                  const key = `${day.date}-${slot.time}`
                  const isSelected = selectedSlot === key
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={!slot.available || isSubmitting}
                      onClick={() => handleSlotClick(day, slot)}
                      className={`w-full h-9 rounded-lg text-xs font-medium tabular-nums border transition-all ${
                        isSelected
                          ? 'bg-primary text-white border-primary shadow-sm'
                          : slot.available
                            ? 'bg-secondary/10 text-emerald-700 border-secondary/20 hover:bg-secondary hover:text-white'
                            : 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed line-through'
                      } ${isSubmitting && !isSelected ? 'opacity-60 cursor-wait' : ''}`}
                    >
                      {isSelected && isSubmitting ? 'Selected' : formatTime(slot.time)}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
