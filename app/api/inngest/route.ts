import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import {
  processImportRequested,
  processTranscriptSubmitted,
} from "@/lib/inngest/functions";

export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processImportRequested, processTranscriptSubmitted],
});
