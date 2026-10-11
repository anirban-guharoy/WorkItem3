import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedTeamsConversation } from "../src/teams.js";

const allowlist = {
  allowedTeamIds: ["team-guid"],
  allowedChannelIds: ["channel-guid"],
};

test("allows only messages from the configured Teams team and channel", () => {
  assert.equal(isAllowedTeamsConversation({
    channelId: "msteams",
    channelData: { team: { id: "team-guid" }, channel: { id: "channel-guid" } },
  }, allowlist), true);
});

test("denies direct messages, other teams, and other channels", () => {
  for (const activity of [
    { channelId: "msteams", channelData: { team: { id: "team-guid" }, channel: { id: "other" } } },
    { channelId: "msteams", channelData: { team: { id: "other" }, channel: { id: "channel-guid" } } },
    { channelId: "msteams", channelData: {} },
    { channelId: "emulator", channelData: { team: { id: "team-guid" }, channel: { id: "channel-guid" } } },
  ]) {
    assert.equal(isAllowedTeamsConversation(activity, allowlist), false);
  }
});
