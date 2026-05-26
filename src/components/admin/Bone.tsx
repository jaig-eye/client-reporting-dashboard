export default function Bone({ className, style }: { className: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`animate-pulse ${className}`}
      style={{ background: 'var(--bg-subtle)', borderRadius: 'inherit', ...style }}
    />
  )
}
