import { describe, expect, it } from "vitest";
import { vttToText } from "./vtt";

describe("vttToText", () => {
  it("strips headers, cue numbers, timestamps and inline tags", () => {
    const vtt = [
      "WEBVTT",
      "",
      "1",
      "00:00:01.940 --> 00:00:03.140",
      "Oh, my god,",
      "",
      "2",
      "00:00:03.141 --> 00:00:06.301",
      "<c.yellow>look</c> at this.",
    ].join("\n");

    expect(vttToText(vtt)).toBe("Oh, my god, look at this.");
  });

  it("collapses the consecutive duplicated lines of rolling captions", () => {
    const vtt = [
      "WEBVTT",
      "",
      "00:00:01.000 --> 00:00:02.000",
      "adiicone a farinha",
      "00:00:02.000 --> 00:00:03.000",
      "adiicone a farinha",
      "00:00:03.000 --> 00:00:04.000",
      "e mexa bem",
    ].join("\n");

    expect(vttToText(vtt)).toBe("adiicone a farinha e mexa bem");
  });

  it("removes karaoke timestamps while keeping the words", () => {
    const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<00:00:01.500>adicione <00:00:01.800>o açúcar";
    expect(vttToText(vtt)).toBe("adicione o açúcar");
  });

  it("returns an empty string for a track without cues", () => {
    expect(vttToText("WEBVTT\n\n")).toBe("");
    expect(vttToText("")).toBe("");
  });
});
