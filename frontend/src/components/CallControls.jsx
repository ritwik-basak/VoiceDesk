const PhoneIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
  </svg>
)

const EndCallIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08A.99.99 0 010 12.37c0-.27.11-.53.29-.71C3.34 8.77 7.46 7 12 7s8.66 1.77 11.71 4.66c.18.18.29.44.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28a11.27 11.27 0 00-2.67-1.85.996.996 0 01-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
  </svg>
)

const Spinner = () => (
  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
)

export default function CallControls({ isConnected, isLoading, isDisconnecting, onStart, onEnd }) {
  if (isLoading) {
    return (
      <button
        disabled
        className="flex items-center gap-2.5 px-8 py-3 bg-gray-100 text-gray-400 rounded-xl font-medium cursor-not-allowed"
      >
        <Spinner />
        {isDisconnecting ? 'Disconnecting…' : 'Connecting…'}
      </button>
    )
  }

  if (isConnected) {
    return (
      <button
        onClick={onEnd}
        className="flex items-center gap-2.5 px-8 py-3 bg-red-500 hover:bg-red-600 active:bg-red-700 text-white rounded-xl font-medium shadow-md shadow-red-500/20 transition-all duration-200 hover:scale-105 active:scale-95"
      >
        <EndCallIcon />
        End Call
      </button>
    )
  }

  return (
    <button
      onClick={onStart}
      className="flex items-center gap-2.5 px-8 py-3 bg-primary hover:bg-green-500 active:bg-sky-700 text-white rounded-xl font-medium shadow-md shadow-primary/40 transition-all duration-200 hover:scale-105 active:scale-95"
    >
      <PhoneIcon />
      Start Call
    </button>
  )
}
