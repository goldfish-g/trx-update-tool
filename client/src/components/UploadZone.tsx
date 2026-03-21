import { useState, useRef, useCallback } from 'react';

type Props = {
  onFilesSelected: (files: FileList) => void;
};

export function UploadZone({ onFilesSelected }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const archiveRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      onFilesSelected(e.dataTransfer.files);
    }
  }, [onFilesSelected]);

  return (
    <div className="card bg-base-100 shadow-xl">
      <div className="card-body items-center text-center gap-6">
        <div
          className={`w-full border-2 border-dashed rounded-xl p-12 transition-colors cursor-pointer ${
            isDragging
              ? 'border-primary bg-primary/10'
              : 'border-base-content/20 hover:border-primary/50'
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => archiveRef.current?.click()}
        >
          <div className="text-5xl mb-4 opacity-40">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <p className="text-lg font-medium mb-1">
            Drop your game files here
          </p>
          <p className="text-sm text-base-content/50">
            ZIP or tar.gz archive with your TR game data
          </p>
        </div>

        <div className="divider text-base-content/30">OR</div>

        <div className="flex gap-3 flex-wrap justify-center">
          <button
            className="btn btn-primary"
            onClick={(e) => { e.stopPropagation(); archiveRef.current?.click(); }}
          >
            Select Archive
          </button>
          <button
            className="btn btn-outline btn-primary"
            onClick={(e) => { e.stopPropagation(); folderRef.current?.click(); }}
          >
            Select Folder
          </button>
        </div>

        <input
          ref={archiveRef}
          type="file"
          className="hidden"
          accept=".zip,.tar.gz,.tgz"
          onChange={(e) => e.target.files && onFilesSelected(e.target.files)}
        />
        <input
          ref={folderRef}
          type="file"
          className="hidden"
          {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
          onChange={(e) => e.target.files && onFilesSelected(e.target.files)}
        />
      </div>
    </div>
  );
}
