import { ChatPromptTemplate } from "@langchain/core/prompts";
import { TestCaseReview } from "@workitem3/test-case-contract";
import { createFoundryChatModel } from "../models/foundry.js";
import { gatherMcpContext, loadMcpTools } from "../mcp/context.js";
import { config } from "../config/index.js";
import {
  RESEARCH_SYSTEM_PROMPT,
  REVIEW_SYSTEM_PROMPT,
} from "../prompts/review.js";

export const AGENT_NAME = "Manual Test Review Agent";

async function build() {
  const model = createFoundryChatModel({
    ...config.model,
    endpoint: config.foundry.endpoint,
    apiKey: config.foundry.apiKey,
    agentName: AGENT_NAME,
  });
  const reviewPrompt = ChatPromptTemplate.fromMessages([
    ["system", REVIEW_SYSTEM_PROMPT],
    [
      "human",
      "Review this story and the pre-generated test case set provided as input. Assess those cases as-is; do not generate a replacement set. Use the research evidence below:\n\n{input}\n\n## Research evidence from common-mcp-server\n{context}",
    ],
  ]);
  const reviewer = reviewPrompt.pipe(
    model.withStructuredOutput(TestCaseReview, { name: "test_case_review" }),
  );
  const tools = await loadMcpTools(config.mcpServer, AGENT_NAME);
  return async (input, runConfig) => {
    const serializedInput = JSON.stringify(input, null, 2);
    const context = await gatherMcpContext({
      model,
      tools,
      systemPrompt: RESEARCH_SYSTEM_PROMPT,
      input: serializedInput,
    });
    return reviewer.invoke({ input: serializedInput, context }, runConfig);
  };
}

let chain;

export async function reviewTestCases(input) {
  chain ??= build().catch((error) => {
    chain = undefined;
    throw error;
  });
  const run = await chain;
  return run(input, { runName: AGENT_NAME, tags: ["manual-test-review"] });
}
