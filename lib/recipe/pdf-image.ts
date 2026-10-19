import "server-only";
import { deflateSync, inflateSync } from "node:zlib";

export type ExtractedPdfImage = {
  mimeType: "image/jpeg" | "image/png";
  bytes: Uint8Array;
  width: number;
  height: number;
};

const MIN_EDGE_PX = 80;
const MAX_DECODED_BYTES = 12 * 1024 * 1024;

function parseDictNumber(dict: string, key: string): number | null {
  const match = dict.match(new RegExp("/" + key + "\\s+(\\d+)"));
  return match ? Number(match[1]) : null;
}

function parseName(dict: string, key: string): string | null {
  const match = dict.match(new RegExp("/" + key + "\\s*/([A-Za-z0-9]+)"));
  return match ? match[1] : null;
}

function parseFilters(dict: string): string[] {
  const arrayMatch = dict.match(/\/Filter\s*\[([^\]]*)\]/);
  if (arrayMatch) {
    return arrayMatch[1]
      .split(/\s+/)
      .map((part) => part.replace(/^\//, "").trim())
      .filter(Boolean);
  }
  const nameMatch = dict.match(/\/Filter\s*\/([A-Za-z0-9]+)/);
  return nameMatch ? [nameMatch[1]] : [];
}

function colorspaceChannels(colorspace: string | null): number | null {
  switch (colorspace) {
    case "DeviceGray":
    case "CalGray":
      return 1;
    case "DeviceRGB":
    case "CalRGB":
      return 3;
    case "DeviceCMYK":
      return 4;
    default:
      return null;
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Undoes the PNG row predictor used by FlateDecode image streams. */
function unfilterPng(data: Buffer, width: number, height: number, colors: number): Buffer | null {
  const rowBytes = width * colors;
  const bpp = colors;
  const stride = rowBytes + 1;
  if (data.length < stride * height || rowBytes <= 0) return null;
  const out = Buffer.alloc(rowBytes * height);
  let prevRow = Buffer.alloc(rowBytes);
  for (let y = 0; y < height; y += 1) {
    const filterType = data[y * stride];
    const src = data.subarray(y * stride + 1, y * stride + 1 + rowBytes);
    const row = out.subarray(y * rowBytes, (y + 1) * rowBytes);
    for (let x = 0; x < rowBytes; x += 1) {
      const left = x >= bpp ? row[x - bpp] : 0;
      const up = prevRow[x];
      const upLeft = x >= bpp ? prevRow[x - bpp] : 0;
      let value = src[x];
      switch (filterType) {
        case 0: break;
        case 1: value = (value + left) & 0xff; break;
        case 2: value = (value + up) & 0xff; break;
        case 3: value = (value + ((left + up) >> 1)) & 0xff; break;
        case 4: value = (value + paeth(left, up, upLeft)) & 0xff; break;
        default: return null;
      }
      row[x] = value;
    }
    prevRow = row;
  }
  return out;
}

function cmykToRgb(samples: Buffer, width: number, height: number): Buffer {
  const pixels = width * height;
  const out = Buffer.alloc(pixels * 3);
  for (let i = 0; i < pixels; i += 1) {
    const c = samples[i * 4] / 255;
    const m = samples[i * 4 + 1] / 255;
    const y = samples[i * 4 + 2] / 255;
    const k = samples[i * 4 + 3] / 255;
    out[i * 3] = Math.round(255 * (1 - c) * (1 - k));
    out[i * 3 + 1] = Math.round(255 * (1 - m) * (1 - k));
    out[i * 3 + 2] = Math.round(255 * (1 - y) * (1 - k));
  }
  return out;
}

let crcTable: number[] | null = null;

function crc32(buffer: Buffer): number {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) crc = crcTable[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(width: number, height: number, channels: 1 | 3, samples: Buffer): Uint8Array {
  const rowBytes = width * channels;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (rowBytes + 1)] = 0;
    samples.copy(raw, y * (rowBytes + 1) + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 1 ? 0 : 2;
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function decodeFlateImage(dict: string, raw: Buffer, width: number, height: number): ExtractedPdfImage | null {
  let data: Buffer;
  try {
    data = inflateSync(raw);
  } catch {
    return null;
  }
  if (data.length === 0 || data.length > MAX_DECODED_BYTES) return null;

  const bitsPerComponent = parseDictNumber(dict, "BitsPerComponent") ?? 8;
  if (bitsPerComponent !== 8) return null;

  const colorspace = parseName(dict, "ColorSpace");
  let channels = colorspaceChannels(colorspace);

  const predictor = parseDictNumber(dict, "Predictor") ?? 1;
  if (predictor >= 10) {
    const colors = parseDictNumber(dict, "Colors") ?? channels ?? 1;
    const unfiltered = unfilterPng(data, width, height, colors);
    if (!unfiltered) return null;
    data = unfiltered;
    channels = colors;
  }

  if (!channels) {
    const pixels = width * height;
    if (pixels === 0) return null;
    const inferred = data.length / pixels;
    if (inferred === 1 || inferred === 3) channels = inferred;
    else return null;
  }

  const expected = width * height * channels;
  if (data.length < expected) return null;

  if (channels === 4) {
    return { mimeType: "image/png", bytes: encodePng(width, height, 3, cmykToRgb(data, width, height)), width, height };
  }
  if (channels === 1 || channels === 3) {
    return { mimeType: "image/png", bytes: encodePng(width, height, channels, data), width, height };
  }
  return null;
}

function decodeImageObject(objectText: string): ExtractedPdfImage | null {
  if (!/\/Subtype\s*\/Image\b/.test(objectText)) return null;
  if (/\/ImageMask\s+true\b/.test(objectText)) return null;

  const streamIndex = objectText.indexOf("stream");
  if (streamIndex < 0) return null;
  const dict = objectText.slice(0, streamIndex);

  const width = parseDictNumber(dict, "Width");
  const height = parseDictNumber(dict, "Height");
  if (!width || !height || width < MIN_EDGE_PX || height < MIN_EDGE_PX) return null;

  let dataStart = streamIndex + "stream".length;
  if (objectText[dataStart] === "\r") dataStart += 1;
  if (objectText[dataStart] === "\n") dataStart += 1;
  const endStream = objectText.indexOf("endstream", dataStart);
  if (endStream < 0) return null;
  let dataEnd = endStream;
  if (objectText[dataEnd - 1] === "\n") dataEnd -= 1;
  if (objectText[dataEnd - 1] === "\r") dataEnd -= 1;
  if (dataEnd <= dataStart) return null;
  const raw = Buffer.from(objectText.slice(dataStart, dataEnd), "latin1");

  const filters = parseFilters(dict);
  if (filters.includes("DCTDecode") || filters.includes("DCT")) {
    return { mimeType: "image/jpeg", bytes: raw, width, height };
  }
  if (filters.includes("FlateDecode") || filters.includes("Fl")) {
    return decodeFlateImage(dict, raw, width, height);
  }
  return null;
}

/**
 * Extracts the largest embedded raster image from a PDF. The heuristic picks
 * the image with the biggest pixel area while ignoring small icons and masks.
 * Returns null when no usable image is found.
 */
export function extractLargestPdfImage(pdf: Uint8Array): ExtractedPdfImage | null {
  if (pdf.byteLength === 0) return null;
  const text = Buffer.from(pdf).toString("latin1");
  const objectRegex = /(\d+)\s+(\d+)\s+obj\b/g;
  let best: (ExtractedPdfImage & { area: number }) | null = null;
  let match: RegExpExecArray | null;
  while ((match = objectRegex.exec(text)) !== null) {
    const start = objectRegex.lastIndex;
    const end = text.indexOf("endobj", start);
    if (end < 0) break;
    let image: ExtractedPdfImage | null = null;
    try {
      image = decodeImageObject(text.slice(start, end));
    } catch {
      image = null;
    }
    if (!image) continue;
    const area = image.width * image.height;
    if (!best || area > best.area) best = { ...image, area };
  }
  if (!best) return null;
  const { area: _area, ...image } = best;
  return image;
}
