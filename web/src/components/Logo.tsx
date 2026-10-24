import './Logo.css'

interface LogoProps {
  withWordmark?: boolean
}

// The Offcut mark: the best slice, lifted out of a long video.
// The frame colour comes from the --logo-frame CSS variable so it works on light and dark backgrounds.
export function Logo({ withWordmark = true }: LogoProps) {
  return (
    <span className="logo">
      <svg className="logo__mark" viewBox="0 0 64 64" aria-hidden="true">
        <g transform="translate(1.5 5)">
          <rect className="logo__frame" x="4" y="20" width="44" height="28" rx="5" fill="none" strokeWidth="3.5" />
          <rect
            className="logo__frame"
            x="30"
            y="20"
            width="12"
            height="28"
            fill="none"
            strokeWidth="1.5"
            strokeDasharray="2 3"
            opacity="0.6"
          />
          <g className="logo__slice">
            <rect x="37" y="6" width="19" height="34" rx="4" fill="#7a4dff" />
            <path d="M43.5 17v12l9-6z" fill="#f1ecff" />
          </g>
        </g>
      </svg>
      {withWordmark && <span className="logo__word">offcut</span>}
    </span>
  )
}
