export default function AnimatedCheck({ size = 64, color = "#22c55e" }) {
  return (
    <svg className="ui-check" role="img" aria-label="Success" width={size} height={size} viewBox="0 0 52 52"
      fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="26" cy="26" r="25" />
      <path d="M14 27l8 8 16-16" />
    </svg>
  );
}
