// Icons copied from the design files. All are decorative: buttons that show only an icon carry an aria-label.

type IconProps = { size?: number };

function Svg({ size = 20, width = 1.7, children }: IconProps & { width?: number; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const icons = {
  grid: (p: IconProps) => (
    <Svg {...p}>
      <rect x="4" y="4" width="6" height="6" rx="1.5" />
      <rect x="14" y="4" width="6" height="6" rx="1.5" />
      <rect x="4" y="14" width="6" height="6" rx="1.5" />
      <rect x="14" y="14" width="6" height="6" rx="1.5" />
    </Svg>
  ),
  home: (p: IconProps) => (
    <Svg {...p} width={1.8}>
      <path d="M4 11l8-7 8 7v9H4z" />
    </Svg>
  ),
  bag: (p: IconProps) => (
    <Svg {...p}>
      <path d="M6 7h12l-1 13H7z" />
      <path d="M9 7a3 3 0 0 1 6 0" />
    </Svg>
  ),
  print: (p: IconProps) => (
    <Svg {...p}>
      <path d="M7 8V3h10v5" />
      <rect x="3" y="8" width="18" height="9" rx="2" />
      <path d="M7 14h10v7H7z" />
    </Svg>
  ),
  box: (p: IconProps) => (
    <Svg {...p}>
      <path d="M3 7l9-4 9 4v10l-9 4-9-4z" />
      <path d="M3 7l9 4 9-4M12 11v10" />
    </Svg>
  ),
  chart: (p: IconProps) => (
    <Svg {...p}>
      <path d="M5 20V11M11 20V5M17 20v-7M3 20h18" />
    </Svg>
  ),
  clock: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  ),
  users: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 4 6" />
    </Svg>
  ),
  gear: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
    </Svg>
  ),
  logout: (p: IconProps) => (
    <Svg {...p} width={1.8}>
      <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />
    </Svg>
  ),
  plus: (p: IconProps) => (
    <Svg {...p} width={2.2}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  close: (p: IconProps) => (
    <Svg {...p} width={2.2}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  ),
  photo: (p: IconProps) => (
    <Svg {...p} width={1.6}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="m21 16-5-5-9 8" />
    </Svg>
  ),
  eye: (p: IconProps) => (
    <Svg {...p} width={1.8}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  ),
  search: (p: IconProps) => (
    <Svg {...p} width={1.8}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </Svg>
  ),
  lock: (p: IconProps) => (
    <Svg {...p} width={1.8}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Svg>
  ),
  back: (p: IconProps) => (
    <Svg {...p} width={2}>
      <path d="M15 18l-6-6 6-6" />
    </Svg>
  ),
};
