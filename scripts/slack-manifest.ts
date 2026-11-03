// npm run slack:manifest — prints the Slack app manifest for this deployment (APP_URL from .env.local).
import { slackManifest } from "../src/lib/slack/manifest";

const url = process.argv[2] ?? process.env.APP_URL ?? "";
if (!/^https:\/\//.test(url)) {
  console.error("APP_URL must be a public https URL (a tunnel or your Vercel URL). Pass it as an argument or set it in .env.local.");
  process.exit(1);
}
console.log(JSON.stringify(slackManifest(url), null, 2));
