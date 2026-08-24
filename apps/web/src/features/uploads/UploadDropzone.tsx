"use client";

import { usePdfUpload } from "./usePdfUpload";

interface UploadDropzoneProps {
  projectId: string;
  onComplete: (analysisId: string) => void;
}

export function UploadDropzone({ projectId, onComplete }: UploadDropzoneProps) {
  const { error, progress, uploading, inputRef, handleDrop, handleFileChange, openFilePicker } =
    usePdfUpload({ projectId, onComplete });

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold text-slate-900">Upload floor plan</h2>
      <p className="mb-3 text-xs text-slate-600">
        PDF, PNG, JPG, or WEBP, max 50 MB. Scale can be confirmed on the drawing after upload.
      </p>

      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && openFilePicker()}
        onClick={openFilePicker}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        className="flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-10 transition hover:border-brand-500 hover:bg-brand-50"
        aria-label="Upload floor plan"
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp,.pdf,.png,.jpg,.jpeg,.webp"
          className="hidden"
          onChange={handleFileChange}
        />
        {uploading ? (
          <div className="w-full max-w-xs text-center">
            <p className="mb-2 text-sm font-medium">Processing drawing… {progress}%</p>
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
              Drag and drop a floor plan here, or click to browse
            </p>
            <p className="mt-1 text-xs text-slate-500">PDF · PNG · JPG · WEBP · max 50 MB</p>
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
