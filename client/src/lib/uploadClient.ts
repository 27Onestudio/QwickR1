export type UploadedFile = { id: string; name: string; size: number; type: string; rotation?: number; pages?: number | null };
export type UploadResult = { code: string; expiresAt: number; ownerToken?: string; files: UploadedFile[] };

export function sendFiles(
  endpoint: string,
  files: File[],
  metadata: Record<string, unknown>,
  clientSessionId: string,
  onProgress: (percent: number) => void,
): Promise<UploadResult> {
  const form = new FormData();
  files.forEach(file => form.append("files", file, file.name));
  form.append("metadata", JSON.stringify(metadata));
  form.append("clientSessionId", clientSessionId);

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", endpoint);
    request.responseType = "json";
    request.upload.onprogress = event => {
      if (event.lengthComputable) onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    request.onerror = () => reject(new Error("Upload interrupted. Tap to Retry."));
    request.onabort = () => reject(new Error("Upload interrupted. Tap to Retry."));
    request.onload = () => {
      const payload = request.response as (UploadResult & { error?: string }) | null;
      if (request.status < 200 || request.status >= 300 || !payload) {
        reject(new Error(payload?.error || (request.status === 413 ? "File exceeds 25 MB limit." : "Upload failed. Please try again.")));
        return;
      }
      resolve(payload);
    };
    request.send(form);
  });
}
