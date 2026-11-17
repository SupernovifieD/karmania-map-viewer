/**
 * Giving a file to the person (step 22.9): the browser saves a `Blob` when a link to it with `download` is clicked. The link is made and clicked on the spot and the address of the
 * Blob is let go afterwards (it holds the file in memory until it is), a turn later so that the download has begun.
 */

/** Saves `blob` as `fileName` through the browser's download. */
export function saveBlob(doc: Document, blob: Blob, fileName: string): void {
  const address = URL.createObjectURL(blob);
  const link = doc.createElement('a');
  link.href = address;
  link.download = fileName;
  link.style.display = 'none';
  doc.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(address);
  }, 0);
}
