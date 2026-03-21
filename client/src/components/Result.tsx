import { useState, useEffect } from 'react';

type Props = {
  downloadUrl: string;
  expiresAt: string;
  onReset: () => void;
};

export function Result({ downloadUrl, expiresAt, onReset }: Props) {
  const [timeLeft, setTimeLeft] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function updateTimer() {
      const now = Date.now();
      const expiry = new Date(expiresAt).getTime();
      const diff = expiry - now;

      if (diff <= 0) {
        setTimeLeft('Expired');
        return;
      }

      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${minutes}m ${seconds}s`);
    }

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const fullUrl = window.location.origin + downloadUrl;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body items-center text-center gap-5">
        <div className="text-success text-5xl">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>

        <h2 className="card-title text-success">Conversion Complete!</h2>

        <p className="text-base-content/60 text-sm">
          Your converted game files are ready. This is a one-time download link.
        </p>

        <a
          href={downloadUrl}
          className="btn btn-primary btn-lg gap-2"
          download
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Download
        </a>

        <div className="flex items-center gap-2">
          <div className="badge badge-outline badge-sm gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Expires in {timeLeft}
          </div>
        </div>

        <div className="join w-full max-w-md">
          <input
            className="input input-bordered join-item flex-1 text-xs"
            value={fullUrl}
            readOnly
          />
          <button
            className="btn btn-outline join-item"
            onClick={handleCopy}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        <div className="divider"></div>

        <button className="btn btn-ghost btn-sm" onClick={onReset}>
          Convert another file
        </button>
      </div>
    </div>
  );
}
