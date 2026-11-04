/** The open ring with the ember in its gap. The ring takes the text colour, so it reads on any surface. */
export function HashifiMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path
        d="M22.6 6.2A12 12 0 1 0 27.8 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <circle cx="26.4" cy="8.4" r="3" className="fill-primary" />
    </svg>
  );
}
