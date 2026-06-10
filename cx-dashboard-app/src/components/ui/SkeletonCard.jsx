export default function SkeletonCard({ height = 220 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height }}>
      <div className="skeleton" style={{ height: 14, width: '40%' }} />
      <div className="skeleton" style={{ flex: 1 }} />
      <div className="skeleton" style={{ height: 10, width: '70%' }} />
    </div>
  );
}
