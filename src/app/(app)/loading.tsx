export default function Loading() {
  return (
    <div className="px-6 pt-5">
      <div className="mb-5 h-6 w-48 animate-pulse rounded-md bg-active" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card h-40 animate-pulse" />
        ))}
      </div>
      <div className="card mt-4 h-72 animate-pulse" />
    </div>
  );
}
