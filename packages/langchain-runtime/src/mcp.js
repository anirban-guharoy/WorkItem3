import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";

const MAX_TOOL_ROUNDS = 8;

export async function loadMcpTools({ name, url, token }, agentName) {
  if (!url) throw new Error("MCP_SERVER_URL is required for context research");
  const client = new MultiServerMCPClient({
    mcpServers: {
      [name]: {
        transport: "http",
        url,
        ...(token && { headers: { Authorization: `Bearer ${token}` } }),
      },
    },
  });
  const tools = await client.getTools();
  if (!tools.length) throw new Error(`${name} did not provide any tools`);
  console.log(`[${agentName}] loaded ${tools.length} tools from ${name}`);
  return tools;
}

async function runTool(toolsByName, call) {
  const tool = toolsByName[call.name];
  if (!tool) return new ToolMessage({ tool_call_id: call.id, content: `Unknown tool ${call.name}` });
  try {
    return await tool.invoke(call);
  } catch (error) {
    return new ToolMessage({
      tool_call_id: call.id,
      content: `Tool error: ${error.message}`,
      status: "error",
    });
  }
}

export async function gatherMcpContext({ model, tools, systemPrompt, input }) {
  if (!tools.length) return "(no external context available)";

  const toolsByName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", systemPrompt],
    new MessagesPlaceholder("messages"),
  ]);
  const researcher = prompt.pipe(model.bindTools(tools));
  const messages = [new HumanMessage(input)];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await researcher.invoke({ messages });
    messages.push(response);
    if (!response.tool_calls?.length) return response.text || String(response.content);
    messages.push(...(await Promise.all(response.tool_calls.map((call) => runTool(toolsByName, call)))));
  }

  const response = await researcher.invoke({
    messages: [...messages, new HumanMessage("Stop searching. Summarize the relevant findings and cite document titles/URLs.")],
  });
  return response.text || String(response.content);
}
