import { createXrayClient } from "@workitem3/xray-cloud";
import { config } from "./config.js";

const xray = createXrayClient(config.xray);

export const xrayEnabled = xray.enabled;
export const publishTestCases = xray.publishTestCases;
