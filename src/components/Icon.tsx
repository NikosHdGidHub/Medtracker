const drawings = {
  today: <><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M7.5 3v4m9-4v4m-13 3h17m-12 5h2m3 0h2" /></>,
  meds: <><path d="M5.4 18.6a5 5 0 0 1 0-7.1l6.1-6.1a5 5 0 0 1 7.1 7.1l-6.1 6.1a5 5 0 0 1-7.1 0Z" /><path d="m8.5 8.5 7 7" /></>,
  history: <><path d="M3.5 11a8.5 8.5 0 1 1 2.2 6.8M3.5 5v6h6" /><path d="M12 8v4l2.8 1.8" /></>,
  reports: <><path d="M4 4v15a1 1 0 0 0 1 1h15M8 16v-3m5 3V9m5 7V5" /><path d="M8 16h.01m5 0h.01m5 0h.01" /></>,
  settings: <><path d="M9.7 3.8h4.6l.6 2.2 1.6 1 2.2-.6 2.3 4-1.6 1.6v1.9l1.6 1.6-2.3 4-2.2-.6-1.6 1-.6 2.1H9.7L9 19.9l-1.6-1-2.2.6-2.3-4 1.6-1.6V12L3 10.4l2.3-4 2.2.6 1.6-1 .6-2.2Z" /><circle cx="12" cy="12.8" r="2.8" /></>,
  brand: <><rect x="3" y="3" width="18" height="18" rx="5" /><path d="M12 8v8m-4-4h8" /></>,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  next: <path d="m9 5 7 7-7 7" />,
  previous: <path d="m15 5-7 7 7 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <><path d="M4 7h16M9 7V4h6v3m3 0-.7 12a1 1 0 0 1-1 .9H7.7a1 1 0 0 1-1-.9L6 7m4 4v5m4-5v5" /></>,
  empty: <><rect x="5" y="4" width="14" height="16" rx="3" /><path d="M9 9h6m-6 4h6" /></>,
}

export function Icon({ name }: { name: keyof typeof drawings }) {
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {drawings[name]}
  </svg>
}
