import { Octokit } from "@octokit/rest";
import { env } from "@/lib/env";
let o: Octokit | null = null;
export const octokit = () => (o ??= new Octokit({ auth: env.githubToken() }));
export const splitRepo = (full: string) => { const [owner, repo] = full.split("/"); return { owner, repo }; };
