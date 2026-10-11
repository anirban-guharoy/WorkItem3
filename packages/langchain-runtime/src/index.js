import fs from "node:fs";
import path from "node:path";
import { ChatAnthropic } from "@langchain/anthropic";

export function loadModelConfig(defaultPath) {
  const file = path.resolve(process.env.MODEL_CONFIG_FILE || defaultPath);
  const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!cfg.model) throw new Error(`${file}: "model" is required`);
  return { temperature: 0.2, maxTokens: 8192, ...cfg };
}

export function createFoundryChatModel({ model, temperature, maxTokens, endpoint, apiKey, agentName }) {
  if (!endpoint || !apiKey) {
    throw new Error("AZURE_FOUNDRY_ENDPOINT and AZURE_FOUNDRY_API_KEY are required");
  }
  console.log(`[agent] using Claude deployment "${model}" via Azure AI Foundry (${agentName})`);
  return new ChatAnthropic({
    model,
    temperature,
    maxTokens,
    anthropicApiKey: apiKey,
    anthropicApiUrl: endpoint,
  });
}
