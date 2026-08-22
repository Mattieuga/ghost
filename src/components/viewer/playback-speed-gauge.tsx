interface PlaybackSpeedGaugeProps {
  rate: number;
  className?: string;
}

// Five deliberate needle states, matching the five playback speeds Ghost
// exposes. Keeping these explicit makes each icon position easy to tune.
const GAUGE_STATES = [
  { rate: 0.5, angle: -55 },
  { rate: 1, angle: -18 },
  { rate: 1.25, angle: 0 },
  { rate: 1.5, angle: 18 },
  { rate: 2, angle: 55 },
] as const;

export function PlaybackSpeedGauge({ rate, className }: PlaybackSpeedGaugeProps) {
  const state = GAUGE_STATES.find((candidate) => candidate.rate === rate) ?? GAUGE_STATES[1];

  return (
    <svg
      data-playback-rate-gauge={state.rate}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* This is Lucide's full-size Gauge arc; only the needle is custom. */}
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
      <g
        style={{
          transform: `rotate(${state.angle}deg)`,
          transformOrigin: "12px 14px",
          transition: "transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      >
        <path d="M12 14V8.35" />
      </g>
    </svg>
  );
}
