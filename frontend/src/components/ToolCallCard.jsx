import { useState, useEffect } from 'react'
import { format } from 'date-fns'

const TOOL_ICONS = {
  'Call Started': 'phone',
  'Name Submitted': 'user',
  'Phone Submitted': 'hash',
  'Slot Selected': 'calendar',
  'Identifying User': 'user',
  'Fetching Doctors': 'clinic',
  'Fetching Available Slots': 'calendar',
  'Booking Appointment': 'check',
  'Retrieving Appointments': 'list',
  'Cancelling Appointment': 'x',
  'Modifying Appointment': 'edit',
  'Ending Conversation': 'end',
}

const TOOL_BORDER = {
  'Call Started': 'border-l-sky-400',
  'Name Submitted': 'border-l-blue-400',
  'Phone Submitted': 'border-l-cyan-400',
  'Slot Selected': 'border-l-amber-400',
  'Identifying User': 'border-l-blue-400',
  'Fetching Doctors': 'border-l-purple-400',
  'Fetching Available Slots': 'border-l-sky-400',
  'Booking Appointment': 'border-l-emerald-400',
  'Retrieving Appointments': 'border-l-indigo-400',
  'Cancelling Appointment': 'border-l-red-400',
  'Modifying Appointment': 'border-l-amber-400',
  'Ending Conversation': 'border-l-gray-400',
}

function ToolIcon({ type }) {
  const base = 'w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black'
  if (type === 'check') return <span className={`${base} bg-emerald-50 text-emerald-600`}>OK</span>
  if (type === 'x') return <span className={`${base} bg-red-50 text-red-600`}>X</span>
  if (type === 'calendar') return <span className={`${base} bg-sky-50 text-sky-600`}>Cal</span>
  if (type === 'clinic') return <span className={`${base} bg-purple-50 text-purple-600`}>Dr</span>
  if (type === 'hash') return <span className={`${base} bg-cyan-50 text-cyan-600`}>#</span>
  if (type === 'list') return <span className={`${base} bg-indigo-50 text-indigo-600`}>Rx</span>
  if (type === 'edit') return <span className={`${base} bg-amber-50 text-amber-600`}>Ed</span>
  if (type === 'end') return <span className={`${base} bg-gray-100 text-gray-600`}>End</span>
  if (type === 'phone') return <span className={`${base} bg-sky-50 text-sky-600`}>Call</span>
  return <span className={`${base} bg-blue-50 text-blue-600`}>ID</span>
}

export default function ToolCallCard({ tool }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const id = setTimeout(() => setVisible(true), 16)
    return () => clearTimeout(id)
  }, [])

  const icon = TOOL_ICONS[tool.name] || 'user'
  const borderColor = TOOL_BORDER[tool.name] || 'border-l-gray-300'
  const isPending = tool.status === 'pending'

  return (
    <div
      className={`flex items-start gap-3 bg-white rounded-xl px-3 py-3 border border-gray-100 border-l-4 ${borderColor} shadow-sm
        transition-all duration-300 ease-out
        ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}
    >
      <ToolIcon type={icon} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800 leading-tight">{tool.name}</p>
        {tool.detail && <p className="text-xs text-gray-500 mt-0.5 leading-snug">{tool.detail}</p>}
        <p className="text-xs text-gray-400 mt-1">{format(new Date(tool.timestamp), 'HH:mm:ss')}</p>
      </div>
      <span
        className={`text-xs font-semibold whitespace-nowrap px-2 py-0.5 rounded-full ${
          isPending ? 'text-amber-700 bg-amber-50' : 'text-secondary bg-secondary/10'
        }`}
      >
        {isPending ? 'Queued' : 'Done'}
      </span>
    </div>
  )
}
