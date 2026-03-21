type Props = {
  message: string;
  progress: number;
};

export function Progress({ message, progress }: Props) {
  const pct = Math.round(progress * 100);

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body items-center text-center gap-4">
        <span className="loading loading-spinner loading-lg text-primary"></span>
        <p className="text-base-content/70">{message}</p>
        <progress
          className="progress progress-primary w-full"
          value={pct}
          max="100"
        ></progress>
        <p className="text-sm text-base-content/40">{pct}%</p>
      </div>
    </div>
  );
}
