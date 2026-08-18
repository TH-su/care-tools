// SF Symbols風のストロークアイコン（24×24 viewBox / stroke 1.7）

const PATHS = {
  inbox: <><path d="M3 13h4.2c.5 0 .9.3 1.2.7l.9 1.6c.3.4.7.7 1.2.7h3c.5 0 .9-.3 1.2-.7l.9-1.6c.3-.4.7-.7 1.2-.7H21" /><path d="M5.5 5h13c.8 0 1.5.5 1.8 1.2L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5l.7-6.8C4 5.5 4.7 5 5.5 5z" /></>,
  inboxes: <><path d="M3 15h3.7c.5 0 .9.3 1.2.7l.6 1.1c.3.4.7.7 1.2.7h4.6c.5 0 .9-.3 1.2-.7l.6-1.1c.3-.4.7-.7 1.2-.7H21" /><path d="M5.5 8h13c.8 0 1.5.5 1.8 1.2L21 15v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3l.7-5.8C4 8.5 4.7 8 5.5 8z" /><path d="M6 4.5h12" /></>,
  flag: <path d="M6 21V4.5m0 .5c2.5-1.8 5-1.8 7.5 0S18 6.8 19.5 6v8.5c-1.5.8-3.5.8-6-1s-5-1.8-7.5 0" />,
  flagFill: <path fill="currentColor" stroke="none" d="M6.85 21a.85.85 0 0 1-1.7 0V4.5a.85.85 0 0 1 1.7 0zM8 4.6c2.2-1.3 4.4-1.1 6.4.3 1.7 1.2 3 1.4 4.3.8.6-.3 1.3.2 1.3.8v8c0 .3-.2.6-.4.7-1.9 1-4 .8-6.2-.8-1.7-1.2-3.2-1.4-5.4-.4z" />,
  sent: <path d="M20.3 3.7 3.8 9.4c-.9.3-.9 1.5 0 1.9l6 2.2 2.3 6.1c.4.9 1.6.9 1.9 0l5.6-16.6c.3-.8-.5-1.6-1.3-1.3zM10 13.5l4.5-4.5" />,
  draft: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M8.5 13h7M8.5 16.5h5" /></>,
  junk: <><circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" /></>,
  trash: <><path d="M4.5 6.5h15M9.8 3.5h4.4c.5 0 .8.3.8.8v2.2H9V4.3c0-.5.3-.8.8-.8zM6 6.5l.9 12.6a2 2 0 0 0 2 1.9h6.2a2 2 0 0 0 2-1.9l.9-12.6" /><path d="M10 10.5v6M14 10.5v6" /></>,
  archive: <><rect x="3.5" y="4" width="17" height="4.5" rx="1" /><path d="M5 8.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5M10 12.5h4" /></>,
  folder: <path d="M3.5 6.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  search: <><circle cx="10.8" cy="10.8" r="6.3" /><path d="M15.5 15.5 20 20" /></>,
  gear: <><circle cx="12" cy="12" r="3.2" /><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  compose: <><path d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5" /><path d="M17.3 3.7a2 2 0 0 1 2.9 2.9L12 14.8 8 16l1.2-4z" /></>,
  chevR: <path d="m9.5 6.5 5.5 5.5-5.5 5.5" />,
  chevD: <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  refresh: <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.7 3.5v4h-4" />,
  reply: <path d="m9.5 7-5 5 5 5M4.8 12H14a5.5 5.5 0 0 1 5.5 5.5v1" />,
  replyAll: <path d="m8 7-5 5 5 5M13 7l-5 5 5 5M8.2 12h5.3a6 6 0 0 1 6 6v.5" />,
  forward: <path d="m14.5 7 5 5-5 5M19.2 12H10a5.5 5.5 0 0 0-5.5 5.5v1" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  paperclip: <path d="m20 11.5-7.8 7.8a5 5 0 0 1-7-7l8.2-8.2a3.3 3.3 0 0 1 4.7 4.7L10 16.9a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 3v1.8M12 19.2V21M21 12h-1.8M4.8 12H3M18.4 5.6l-1.3 1.3M6.9 17.1l-1.3 1.3M18.4 18.4l-1.3-1.3M6.9 6.9 5.6 5.6" /></>,
  moon: <path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a7 7 0 0 0 10.7 10.7z" />,
  mail: <><rect x="3" y="5" width="18" height="14.5" rx="2.5" /><path d="m4 7.5 8 5.8 8-5.8" /></>,
  mailOpen: <><path d="M3.5 9.5 12 4l8.5 5.5V19a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /><path d="m4.5 10.5 7.5 5 7.5-5" /></>,
  send: <path d="M12 19V6M6 11.5 12 5.5l6 6" />,
  attach: <path d="m20 11.5-7.8 7.8a5 5 0 0 1-7-7l8.2-8.2a3.3 3.3 0 0 1 4.7 4.7L10 16.9a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4" />,
  download: <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M4.5 19.5h15" />,
  image: <><rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m5 17.5 4.5-4.5 3 3 3-3 3.5 3.5" /></>,
  doc: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>,
  warn: <><path d="M12 4 2.8 20h18.4z" /><path d="M12 10v4.2M12 17.2v.3" /></>,
  more: <><circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none" /></>,
  move: <><path d="M3.5 6.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /><path d="M12 10.5v6m0-6-2.3 2.3M12 10.5l2.3 2.3" transform="rotate(180 12 13.5)" /></>,
  shield: <path d="M12 3.5c2.5 1.5 5 2.2 7.5 2.2 0 6.8-2.5 11.6-7.5 14.3C7 17.3 4.5 12.5 4.5 5.7 7 5.7 9.5 5 12 3.5z" />,
  sparkle: <path d="M12 4.5c.6 3.6 2.9 5.9 6.5 6.5-3.6.6-5.9 2.9-6.5 6.5-.6-3.6-2.9-5.9-6.5-6.5 3.6-.6 5.9-2.9 6.5-6.5zM18.5 15l.4 2.1 2.1.4-2.1.4-.4 2.1-.4-2.1-2.1-.4 2.1-.4z" />,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 9.5h17M8 3.2v3.4M16 3.2v3.4" /></>,
  calendarPlus: <><path d="M20.5 11.5V7.5a2.5 2.5 0 0 0-2.5-2.5H6a2.5 2.5 0 0 0-2.5 2.5v10.5A2.5 2.5 0 0 0 6 20.5h6" /><path d="M3.5 9.5h17M8 3.2v3.4M16 3.2v3.4" /><path d="M18 14.5v6M15 17.5h6" /></>,
  todo: <><rect x="3.5" y="4.5" width="17" height="16" rx="2.5" /><path d="m7.5 11.5 2 2 4-4.5M12 16h5" /></>,
  circle: <circle cx="12" cy="12" r="8" />,
  checkCircle: <><circle cx="12" cy="12" r="8" /><path d="m8.5 12.2 2.4 2.4 4.6-5" /></>,
  clock: <><circle cx="12" cy="12" r="8.2" /><path d="M12 7.2V12l3.2 1.9" /></>,
  pin: <><path d="M12 21c4-4.6 6-7.8 6-10.4A6 6 0 0 0 6 10.6C6 13.2 8 16.4 12 21z" /><circle cx="12" cy="10.5" r="2.2" /></>,
  people: <><circle cx="9" cy="8.5" r="3.2" /><path d="M3 19.5c0-3 2.7-4.8 6-4.8s6 1.8 6 4.8" /><path d="M16 5.6a3.2 3.2 0 0 1 0 6.1M17.5 15.2c2.1.6 3.5 2.1 3.5 4.3" /></>,
  chevL: <path d="m14.5 6.5-5.5 5.5 5.5 5.5" />,
  list: <path d="M4 6.5h.5M4 12h.5M4 17.5h.5M8.5 6.5H20M8.5 12H20M8.5 17.5H20" />,
  grid: <><rect x="3.5" y="4.5" width="17" height="15.5" rx="2" /><path d="M3.5 9.5h17M9 9.5V20M15 9.5V20M3.5 15h17" /></>,
  columns: <><rect x="3.5" y="4.5" width="17" height="15.5" rx="2" /><path d="M9 4.5V20M15 4.5V20M3.5 8.5h17" /></>,
  google: <path fill="currentColor" stroke="none" d="M20.6 12.2c0-.6-.1-1.2-.2-1.8H12v3.4h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9c1.7-1.6 2.7-3.9 2.7-6.5z M12 21c2.4 0 4.5-.8 6-2.2l-2.9-2.2c-.8.5-1.8.9-3.1.9-2.4 0-4.4-1.6-5.1-3.8H3.9v2.3A9 9 0 0 0 12 21z M6.9 13.7a5.4 5.4 0 0 1 0-3.4V8H3.9a9 9 0 0 0 0 8z M12 6.6c1.3 0 2.5.5 3.5 1.4l2.6-2.6A9 9 0 0 0 3.9 8l3 2.3C7.6 8.2 9.6 6.6 12 6.6z" />,
  link: <><path d="M10.5 13.5a3.6 3.6 0 0 0 5.2.2l2.6-2.6a3.6 3.6 0 0 0-5.1-5.1L11.8 7.4" /><path d="M13.5 10.5a3.6 3.6 0 0 0-5.2-.2l-2.6 2.6a3.6 3.6 0 0 0 5.1 5.1l1.4-1.4" /></>,
  edit: <><path d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5" /><path d="M17.3 3.7a2 2 0 0 1 2.9 2.9L12 14.8 8 16l1.2-4z" /></>,
  panel: <><rect x="3.5" y="4.5" width="17" height="15.5" rx="2" /><path d="M14.5 4.5V20" /></>,
  today: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 9.5h17M8 3.2v3.4M16 3.2v3.4" /><circle cx="12" cy="15" r="2.2" fill="currentColor" stroke="none" /></>,
  keyboard: <><rect x="2.5" y="7" width="19" height="10.5" rx="2" /><path d="M6 10.5h.5M9.5 10.5h.5M13 10.5h.5M16.5 10.5h1M6 14h1M9 14h6M17 14h1" /></>,
};

export function Icon({ name, size = 18, className, style }) {
  const path = PATHS[name] || PATHS.mail;
  return (
    <svg
      className={className} style={style}
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      {path}
    </svg>
  );
}

export const MAILBOX_ICONS = {
  '\\Inbox': 'inbox',
  '\\Sent': 'sent',
  '\\Drafts': 'draft',
  '\\Junk': 'junk',
  '\\Trash': 'trash',
  '\\Archive': 'archive',
  '\\All': 'archive',
  '\\Flagged': 'flag',
};
