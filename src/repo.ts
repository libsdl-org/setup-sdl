import * as core from "@actions/core";
import { Octokit } from "@octokit/rest";

import { SetupSdlError } from "./util";

export async function convert_git_branch_tag_to_hash(args: {
  branch_or_hash: string;
  owner: string;
  repo: string;
  octokit: Octokit;
}): Promise<string> {
  return await core.group(
    `Calculating git hash of ${args.owner}/${args.repo}:${args.branch_or_hash}`,
    async () => {
      try {
        core.debug(`Look for a branch named "${args.branch_or_hash}"...`);
        const response = await args.octokit.rest.repos.getBranch({
          owner: args.owner,
          repo: args.repo,
          branch: args.branch_or_hash,
        });
        core.debug("It was a branch.");
        const sha = response.data.commit.sha;
        core.info(`git hash = ${sha}`);
        return sha;
      } catch {
        core.debug("It was not a branch.");
      }
      try {
        core.debug(`Look for a commit named "${args.branch_or_hash}"...`);
        const response = await args.octokit.rest.repos.getCommit({
          owner: args.owner,
          repo: args.repo,
          ref: args.branch_or_hash,
        });
        core.debug("It was a commit.");
        return response.data.sha;
      } catch {
        core.debug("It was not a commit.");
      }
      throw new SetupSdlError(
        `Unable to convert ${args.branch_or_hash} into a git hash.`,
      );
    },
  );
}
