"use client";
import React, { useRef, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

export default function Upload() {
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docUrl, setDocUrl] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadError(null);
    setUploadProgress(0);
    if (!fileInputRef.current?.files?.length) return;
    setUploading(true);
    setUploadSuccess(false);
    const file = fileInputRef.current.files[0];
    const formData = new FormData();
    formData.append("file", file);
    if (docUrl) {
      formData.append("doc_url", docUrl);
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${API_URL}/api/upload`);
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            setUploadProgress(Math.round((event.loaded / event.total) * 100));
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            setUploadSuccess(true);
            resolve();
          } else {
            setUploadError(xhr.responseText || "Upload failed");
            reject(new Error(xhr.responseText || "Upload failed"));
          }
        };
        xhr.onerror = () => {
          setUploadError("Failed to upload file");
          reject(new Error("Failed to upload file"));
        };
        xhr.send(formData);
      });
    } catch (err: any) {
      setUploadError(err.message || "Failed to upload file");
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-0">
      <div className="w-full max-w-md mt-12 bg-white rounded-xl shadow p-8 flex flex-col items-center">
        <h2 className="text-lg font-semibold mb-4 text-gray-800">Upload PDF Document</h2>
        <form className="flex flex-col items-center w-full" onSubmit={handleFileUpload}>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 mb-2 w-full text-gray-800 placeholder-gray-500"
            required
          />
          <input
            type="url"
            value={docUrl}
            onChange={e => setDocUrl(e.target.value)}
            placeholder="Document URL (required)"
            className="mb-2 w-full rounded border px-3 py-2 text-sm text-gray-800 placeholder-gray-500"
            required
          />
          {uploading && (
            <div className="w-full mb-2">
              <div className="h-2 bg-gray-200 rounded">
                <div
                  className="h-2 bg-blue-500 rounded"
                  style={{ width: `${uploadProgress}%`, transition: 'width 0.2s' }}
                ></div>
              </div>
              <div className="text-xs text-gray-600 mt-1 text-center">{uploadProgress}%</div>
            </div>
          )}
          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-2 rounded font-semibold hover:bg-blue-700 transition disabled:opacity-60"
            disabled={uploading}
          >
            {uploading ? "Uploading..." : "Upload"}
          </button>
        </form>
        {uploadSuccess && (
          <p className="text-green-600 mt-2">Upload successful!</p>
        )}
        {uploadError && (
          <p className="text-red-600 mt-2">{uploadError}</p>
        )}
      </div>
    </main>
  );
}
