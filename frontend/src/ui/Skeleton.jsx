export default function Skeleton({ width = "100%", height = 16, style, className = "" }) {
  return <span aria-hidden="true" className={`ui-skeleton ${className}`} style={{ width, height, ...style }} />;
}
