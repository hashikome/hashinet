/* The prototype's own icon set (prototypes/hearth-design/prototype/ui.js), 24px grid, 1.8 stroke. */
const ICONS = {
  overview: `<path d="M3 3h7v7H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 14h7v7H3z"/>`,
  venues: `<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>`,
  routers: `<rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 16.5h.01M11 16.5h.01M8 9.5a6 6 0 0 1 8 0M5.5 7a9.5 9.5 0 0 1 13 0"/>`,
  vouchers: `<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"/><path d="M14 7v10"/>`,
  packages: `<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>`,
  settings: `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.700 1.700 0 0 0 .3 1.800l.1.100a2 2 0 1 1-2.800 2.800l-.1-.1a1.700 1.700 0 0 0-2.900 1.200V21a2 2 0 1 1-4 0v-.1a1.700 1.700 0 0 0-2.900-1.200l-.1.100a2 2 0 1 1-2.800-2.800l.1-.1a1.700 1.700 0 0 0-1.200-2.900H3a2 2 0 1 1 0-4h.1a1.700 1.700 0 0 0 1.200-2.900l-.1-.1a2 2 0 1 1 2.800-2.800l.1.100a1.700 1.700 0 0 0 2.900-1.200V3a2 2 0 1 1 4 0v.1a1.700 1.700 0 0 0 2.900 1.200l.1-.1a2 2 0 1 1 2.800 2.800l-.1.100a1.700 1.700 0 0 0 1.200 2.900h.1a2 2 0 1 1 0 4h-.1a1.700 1.700 0 0 0-1.500 1Z"/>`,
  services: `<path d="M4 4h7v7H4zM4 14h7v6H4zM14 14h6v6h-6zM17.500 3v7M14 6.500h7"/>`,
  manage: `<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>`,
  billing: `<path d="M4 2v20l2.5-1.5L9 22l3-1.5 3 1.5 2.5-1.5L20 22V2l-2.5 1.5L15 2l-3 1.5L9 2 6.500 3.500 4 2Z"/><path d="M8 8h8M8 12h8M8 16h5"/>`,
  payments: `<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h3"/>`,
  devices: `<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>`,
  sessions: `<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/>`,
  portal: `<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>`,
  analytics: `<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>`,
  team: `<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16 14.2c2.9.3 5 2.6 5 5.8"/>`,
  businesses: `<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2"/>`,
  platform: `<path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 16 9 5 9-5"/>`,
  profile: `<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="12" r="2.5"/><path d="M14 10h4M14 14h4"/>`,
  audit: `<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h5"/>`,
  issues: `<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>`,
  invite: `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>`,
  plus: `<path d="M12 5v14M5 12h14"/>`,
  upload: `<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>`,
  download: `<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>`,
  chev: `<path d="M7 10l5 5 5-5"/>`,
  updown: `<path d="M8 9l4-4 4 4M8 15l4 4 4-4"/>`,
  chevron: `<path d="M9 6l6 6-6 6"/>`,
  check: `<path d="M5 12.5l4.5 4.5L19 7.5"/>`,
  menu: `<path d="M4 7h16M4 12h16M4 17h16"/>`,
  scan: `<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16"/>`,
  close: `<path d="M6 6l12 12M18 6L6 18"/>`,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="ico"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      // The paths are the prototype's own, kept verbatim.
      // biome-ignore lint/security/noDangerouslySetInnerHtml: constant markup from this file
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

/** HashiNet's mark: the ring and the ember. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path
        className="ring"
        d="M22.6 6.2A12 12 0 1 0 27.8 14"
        fill="none"
        strokeWidth={3.2}
        strokeLinecap="round"
      />
      <circle cx="26.4" cy="8.4" r="3" fill="#F59E2A" />
    </svg>
  );
}

/** A business's mark until it uploads a logo: its first letter. */
export function BusinessMark({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <svg
      className="mark biz-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="7" />
      <text x="16" y="22" textAnchor="middle" fontSize="17" fontWeight="600">
        {name.trim().charAt(0).toUpperCase()}
      </text>
    </svg>
  );
}
