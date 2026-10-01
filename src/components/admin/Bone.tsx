// A loading placeholder block for the route skeletons (loading.tsx). It uses the same .skeleton
// shimmer as the rest of the admin (components/ui/Skeleton) — it used to be a flat grey pulse,
// which made most pages load differently from the Keywords tab.
export default function Bone({ className, style }: { className: string; style?: React.CSSProperties }) {
  return <div aria-hidden className={`skeleton ${className}`} style={style} />
}
