import assert from "node:assert/strict";
import test from "node:test";
import {
  createTeamsAgent,
  isAllowedTeamsConversation,
} from "../../src/api/teams-adapter.js";

const allowlist = {
  allowedTeamIds: ["team-guid"],
  allowedChannelIds: ["channel-guid"],
};

test("allows only messages from the configured Teams team and channel", () => {
  assert.equal(
    isAllowedTeamsConversation(
      {
        channelId: "msteams",
        channelData: {
          team: { id: "team-guid" },
          channel: { id: "channel-guid" },
        },
      },
      allowlist,
    ),
    true,
  );
});

test("denies direct messages, other teams, and other channels", () => {
  for (const activity of [
    {
      channelId: "msteams",
      channelData: { team: { id: "team-guid" }, channel: { id: "other" } },
    },
    {
      channelId: "msteams",
      channelData: { team: { id: "other" }, channel: { id: "channel-guid" } },
    },
    { channelId: "msteams", channelData: {} },
    {
      channelId: "emulator",
      channelData: {
        team: { id: "team-guid" },
        channel: { id: "channel-guid" },
      },
    },
  ]) {
    assert.equal(isAllowedTeamsConversation(activity, allowlist), false);
  }
});

test("creates the Teams application with explicit SDK authentication", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const agent = createTeamsAgent(async () => "ok", {
      teams: allowlist,
      authConfig: {
        clientId: "test-client",
        clientSecret: "test-secret",
        tenantId: "test-tenant",
      },
      onError: () => {},
    });
    assert.ok(agent);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});
