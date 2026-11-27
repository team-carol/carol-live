// A picture as YouTube takes it for a thumbnail: JPG or PNG, at most 2 MB. Anything else (a bigger file, a WebP)
// is redrawn as a 1280-wide JPG; a file that already fits goes up untouched.

export const THUMBNAIL = { maxBytes: 2 * 1024 * 1024, width: 1280, height: 720 };

export const fitsAsIs = (type: string, size: number) => (type === "image/jpeg" || type === "image/png") && size <= THUMBNAIL.maxBytes;

/** size to draw a [w]×[h] picture at so it is no larger than the thumbnail size (never enlarged) */
export function fitSize(w: number, h: number): { w: number; h: number } {
  const s = Math.min(1, THUMBNAIL.width / w, THUMBNAIL.height / h);
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

export async function fitThumbnail(file: File): Promise<Blob> {
  if (fitsAsIs(file.type, file.size)) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("이 파일은 이미지로 읽을 수 없습니다");
  }
  const { w, h } = fitSize(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  for (const quality of [0.9, 0.8, 0.65]) {
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", quality));
    if (blob && blob.size <= THUMBNAIL.maxBytes) return blob;
  }
  throw new Error("썸네일을 2MB 아래로 줄이지 못했습니다");
}
