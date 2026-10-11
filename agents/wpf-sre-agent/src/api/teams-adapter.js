import {
  AgentApplication,
  CloudAdapter,
  MemoryStorage,
} from "@microsoft/agents-hosting";

export function isAllowedTeamsConversation(
  activity,
  { allowedTeamIds, allowedChannelIds },
) {
  const teamId = activity.channelData?.team?.id;
  const channelId = activity.channelData?.channel?.id;
  return Boolean(
    activity.channelId === "msteams" &&
    teamId &&
    channelId &&
    allowedTeamIds.includes(teamId) &&
    allowedChannelIds.includes(channelId),
  );
}

export function createTeamsAgent(handleCommand, { teams, authConfig, onError }) {
  const adapter = new CloudAdapter(authConfig);
  const agent = new AgentApplication({
    storage: new MemoryStorage(),
    adapter,
  });
  agent.onActivity("message", async (context) => {
    const { activity } = context;
    if (!isAllowedTeamsConversation(activity, teams)) {
      await context.sendActivity(
        "This bot is not enabled for this Teams team/channel.",
      );
      return;
    }

    const text = (activity.text || "").replace(/<at>.*?<\/at>/gi, "").trim();
    try {
      const reply = await handleCommand(text, {
        userId: activity.from?.id,
        conversationId: activity.conversation?.id,
      });
      await context.sendActivity(reply);
    } catch (error) {
      onError(error);
      await context.sendActivity(
        "The requested operation failed. Check the wpf-sre-agent logs or retry later.",
      );
    }
  });
  return agent;
}
