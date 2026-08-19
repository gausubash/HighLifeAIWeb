"use client";

import { useMockUpload } from "./useMockUpload";

interface UploadDropzoneProps {
  projectId: string;
  onComplete: (analysisId: string) => void;
}

export function UploadDropzone({ projectId, onComplete }: UploadDropzoneProps) {
  const { error, progress, uploading, inputRef, handleDrop, handleFileChange, openFilePicker } =
    useMockUpload({ projectId, onComplete });

  return (
    <div className="card">
      <h2 className="mb-2 text-lg font-semibold">Upload floor plan PDF</h2>
      <p className="mb-4 text-sm text-slate-600">
        PDF only, max 50 MB. Mock mode — file stays in browser memory.
      </p>

      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && openFilePicker()}
        onClick={openFilePicker}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-12 transition hover:border-brand-500 hover:bg-brand-50"
        aria-label="Upload PDF floor plan"
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={handleFileChange}
        />
        {uploading ? (
          <div className="w-full max-w-xs text-center">
            <p className="mb-2 text-sm font-medium">Uploading… {progress}%</p>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-brand-600 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm font-medium text-slate-700">
              Drag and drop a PDF here, or click to browse
            </p>
            <p className="mt-1 text-xs text-slate-500">application/pdf · max 50 MB</p>
          </>
        )}
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
