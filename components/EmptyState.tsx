export function EmptyState({
  title,
  description,
  emoji = '🦉',
}: {
  title: string;
  description?: string;
  emoji?: string;
}) {
  return (
    <div className="card p-10 flex flex-col items-center text-center gap-3">
      <div className="text-6xl" aria-hidden>{emoji}</div>
      <h2 className="font-bold text-xl text-duo-ink">{title}</h2>
      {description && <p className="text-duo-mute max-w-md">{description}</p>}
    </div>
  );
}
