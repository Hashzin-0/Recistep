import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "recistep" });

export function isInngestConfigured(): boolean {
  return Boolean(process.env.INNGEST_EVENT_KEY?.trim()) || process.env.INNGEST_DEV === "1";
}
