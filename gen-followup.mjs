import { generateVoiceMessage } from "./dist/src/integrations/elevenlabs/client.js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const config = {
  voiceId: "BMKogJVvmqzDZBd0Nwwq",
  modelId: "eleven_monolingual_v1"
};

const script = "Hey friend! Michael asked me to follow up after the video. He is an AI Swarm Architect building real-world agent systems and working with teams to apply AI in practical, high-impact ways. He would really enjoy connecting to exchange ideas. Would you be open to a short coffee or call? Let me know what works for you.";

console.log("Generating new voice message...");
const result = await generateVoiceMessage(config, script, "friend");

if (result.status !== "completed") {
  console.error("Failed:", result.error);
  process.exit(1);
}

const dir = "./data/media/voice";
mkdirSync(dir, { recursive: true });
const path = join(dir, "voice_followup_test.mp3");
writeFileSync(path, result.audioData);
console.log("Saved:", path, "(" + result.audioData.length + " bytes)");
