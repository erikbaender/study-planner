/** Read bytes incrementally so declared and chunked bodies obey the same limit. */
export async function boundedBody(request: Request, maximumBytes: number): Promise<string> {
  if (Number(request.headers.get("content-length")) > maximumBytes) {
    throw new RangeError("Request body exceeds the size limit");
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new RangeError("Request body exceeds the size limit");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
