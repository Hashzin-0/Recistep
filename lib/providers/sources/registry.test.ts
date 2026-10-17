import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { getSourceConnector } from "./registry";
import { SUPPORTED_SOURCE_HOSTS } from "@/lib/source-url";

describe("getSourceConnector", () => {
  it("returns a connector for every recognized platform", () => {
    for (const platform of ["youtube", "tiktok", "instagram"] as const) {
      expect(getSourceConnector(platform).platform).toBe(platform);
    }
  });

  it("keeps the registry aligned with the validated source hosts", () => {
    const platforms = SUPPORTED_SOURCE_HOSTS.map((host) => getSourceConnector(
      host.endsWith("youtube.com") || host === "youtu.be"
        ? "youtube"
        : host.endsWith("tiktok.com")
          ? "tiktok"
          : "instagram",
    ).platform);

    expect(new Set(platforms)).toEqual(new Set(["youtube", "tiktok", "instagram"]));
  });
});
