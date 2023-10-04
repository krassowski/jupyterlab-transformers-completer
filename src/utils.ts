// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

/**
 * Format bytes to human readable string.
 */
export function formatFileSize(
  bytes: number,
  decimalPoint: number = 2,
  k: number = 1024
): string {
  // https://www.codexworld.com/how-to/convert-file-size-bytes-kb-mb-gb-javascript/
  if (bytes === 0) {
    return '0 B';
  }
  const dm = decimalPoint;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  if (i >= 0 && i < sizes.length) {
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  } else {
    return String(bytes);
  }
}
