import { deflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { extractLargestPdfImage } from "./pdf-image";

function pdfWithImages(objects: Array<{ dict: string; data: Buffer }>): Uint8Array {
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  objects.forEach((object, index) => {
    const header = `${index + 1} 0 obj\n<< /Type /XObject /Subtype /Image ${object.dict} /Length ${object.data.length} >>\nstream\n`;
    parts.push(Buffer.from(header, "latin1"), object.data, Buffer.from("\nendstream\nendobj\n", "latin1"));
  });
  parts.push(Buffer.from("%%EOF\n", "latin1"));
  return Buffer.concat(parts);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
}

describe("extractLargestPdfImage", () => {
  it("returns the largest image and ignores icons", () => {
    const icon = Buffer.from([0xff, 0xd8, 0xff, 0x01]);
    const photo = Buffer.from([0xff, 0xd8, 0xff, 0x02, 0x03, 0x04]);
    const pdf = pdfWithImages([
      { dict: "/Width 40 /Height 40 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode", data: icon },
      { dict: "/Width 320 /Height 240 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode", data: photo },
    ]);

    const image = extractLargestPdfImage(pdf);
    expect(image?.mimeType).toBe("image/jpeg");
    expect(image?.width).toBe(320);
    expect(image?.height).toBe(240);
    expect(Buffer.from(image!.bytes).equals(photo)).toBe(true);
  });

  it("decodes a Flate RGB stream into a PNG", () => {
    const width = 120;
    const height = 90;
    const raw = Buffer.alloc(width * height * 3);
    for (let i = 0; i < raw.length; i += 1) raw[i] = i % 256;
    const pdf = pdfWithImages([
      { dict: `/Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode`, data: deflateSync(raw) },
    ]);

    const image = extractLargestPdfImage(pdf);
    expect(image?.mimeType).toBe("image/png");
    expect(image?.width).toBe(width);
    expect(image?.height).toBe(height);
    expect(Array.from(image!.bytes.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(readUint32(image!.bytes, 16)).toBe(width);
    expect(readUint32(image!.bytes, 20)).toBe(height);
  });

  it("undoes the PNG predictor used by Flate image streams", () => {
    const width = 100;
    const height = 90;
    const rowBytes = width * 3;
    const raw = Buffer.alloc((rowBytes + 1) * height);
    for (let y = 0; y < height; y += 1) {
      raw[y * (rowBytes + 1)] = 0;
      for (let x = 0; x < rowBytes; x += 1) raw[y * (rowBytes + 1) + 1 + x] = (x + y) % 256;
    }
    const pdf = pdfWithImages([
      { dict: `/Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 >>`, data: deflateSync(raw) },
    ]);

    const image = extractLargestPdfImage(pdf);
    expect(image?.mimeType).toBe("image/png");
    expect(image?.width).toBe(width);
    expect(image?.height).toBe(height);
  });

  it("converts a DeviceCMYK Flate stream to RGB PNG", () => {
    const width = 90;
    const height = 80;
    const raw = Buffer.alloc(width * height * 4, 0);
    const pdf = pdfWithImages([
      { dict: `/Width ${width} /Height ${height} /ColorSpace /DeviceCMYK /BitsPerComponent 8 /Filter /FlateDecode`, data: deflateSync(raw) },
    ]);

    const image = extractLargestPdfImage(pdf);
    expect(image?.mimeType).toBe("image/png");
    expect(readUint32(image!.bytes, 16)).toBe(width);
  });

  it("returns null when the PDF has no usable image", () => {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n", "latin1");
    expect(extractLargestPdfImage(pdf)).toBeNull();
  });

  it("skips images with unsupported filters", () => {
    const pdf = pdfWithImages([
      { dict: "/Width 300 /Height 300 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /JPXDecode", data: Buffer.from([1, 2, 3, 4]) },
    ]);
    expect(extractLargestPdfImage(pdf)).toBeNull();
  });

  it("skips image masks", () => {
    const pdf = pdfWithImages([
      { dict: "/Width 300 /Height 300 /ImageMask true /BitsPerComponent 1 /Filter /DCTDecode", data: Buffer.from([0xff, 0xd8]) },
    ]);
    expect(extractLargestPdfImage(pdf)).toBeNull();
  });
});
