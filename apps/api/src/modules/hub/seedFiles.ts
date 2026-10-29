// Valid demo files of an exact size for the seed: a one-page PDF, a PNG and a JPEG, each padded
// with bytes viewers ignore (an unreferenced PDF stream, a private PNG chunk, JPEG comments).
import { crc32, deflateSync } from 'node:zlib';

/** A 16×16 baseline JPEG (made once with macOS `sips` from a generated PNG). */
const JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKAC' +
  'AAQAAAABAAAAEKADAAQAAAABAAAAEAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZ' +
  'jwCyBOmACZjs+EJ+/8AAEQgAEAAQAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIB' +
  'AwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNE' +
  'RUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfI' +
  'ycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIB' +
  'AgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpD' +
  'REVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG' +
  'x8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMACQkJCQkJEAkJEBYQEBAWHhYWFhYeJh4eHh4eJi4mJiYmJiYu' +
  'Li4uLi4uLjc3Nzc3N0BAQEBASEhISEhISEhISP/bAEMBCwwMEhESHxERH0szKjNLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tL' +
  'S0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS//dAAQAAf/aAAwDAQACEQMRAD8AwoRWrCKzoRWrCK+kq4cvAPY//9k=' +
  '';

const ascii = (s: string) => s.replace(/[^\x20-\x7e]/g, '-').replace(/[\\()]/g, (c) => `\\${c}`);

export function pdf(title: string, size: number): Buffer {
  const text = `BT /F1 18 Tf 72 770 Td (${ascii(title)}) Tj ET\nBT /F1 11 Tf 72 745 Td (UniVerse demo resource) Tj ET`;
  const objects = (padding: number) => [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${padding} >>\nstream\n${' '.repeat(padding)}\nendstream`,
  ];
  const build = (padding: number) => {
    let body = '%PDF-1.4\n';
    const offsets: number[] = [];
    objects(padding).forEach((o, i) => {
      offsets.push(body.length);
      body += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = body.length;
    body += `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) body += `${String(o).padStart(10, '0')} 00000 n \n`;
    body += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return body;
  };
  // The padding's own /Length digits change the size, so settle it in two passes.
  let padding = Math.max(0, size - build(0).length);
  padding = Math.max(0, padding - (build(padding).length - size));
  return Buffer.from(build(padding), 'latin1');
}

const chunk = (type: string, data: Buffer) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

export function png(size: number): Buffer {
  const w = 64;
  const h = 64;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1)
      raw.set([30 + x * 3, 120, 200 - y * 2], y * (w * 3 + 1) + 1 + x * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const head = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
  ]);
  const end = chunk('IEND', Buffer.alloc(0));
  // "paDd": ancillary, private, safe to copy; decoders skip it.
  const pad = chunk('paDd', Buffer.alloc(Math.max(0, size - head.length - end.length - 12)));
  return Buffer.concat([head, pad, end]);
}

export function jpeg(size: number): Buffer {
  const base = Buffer.from(JPEG_BASE64, 'base64');
  const segments: Buffer[] = [];
  let remaining = size - base.length;
  while (remaining >= 4) {
    let n = Math.min(remaining, 65_537); // marker (2) + length field (2) + up to 65,533 bytes
    if (remaining - n > 0 && remaining - n < 4) n -= 4;
    const seg = Buffer.alloc(n, 0x20);
    seg[0] = 0xff;
    seg[1] = 0xfe; // COM
    seg.writeUInt16BE(n - 2, 2);
    segments.push(seg);
    remaining -= n;
  }
  // Comments go right after the SOI marker.
  return Buffer.concat([base.subarray(0, 2), ...segments, base.subarray(2)]);
}
