import * as child_process from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";

import * as cache from "@actions/cache";
import * as core from "@actions/core";

import { SDL_GIT_URL } from "./constants";
import { configure_ninja_build_tool } from "./ninja";
import { SetupSdlError } from "./util";

import {
  SdlRelease,
  SdlReleaseType,
  SdlVersion,
  parse_requested_sdl_version,
} from "./version";

import {
  get_sdl_build_platform,
  get_platform_root_directory,
} from "./platform";

async function convert_git_branch_tag_to_hash(
  branch_tag: string
): Promise<string> {
  const git_hash = await core.group(
    `Calculating git hash of ${branch_tag}`,
    async () => {
      const command = `git ls-remote ${SDL_GIT_URL} ${branch_tag}`;
      core.info(`Executing "${command}"`);
      const output = child_process.execSync(command, {
        stdio: "pipe",
        encoding: "utf8",
      });
      const git_hash = output.split("\t")[0];
      core.info(`git hash = ${git_hash}`);
      return git_hash;
    }
  );
  return git_hash;
}

async function echo_command_and_execute(command: string, directory: string) {
  core.info(`Executing "${command}`);
  child_process.execSync(command, { stdio: "inherit", cwd: directory });
}

async function checkout_sdl_git_hash(
  branch_tag_hash: string,
  directory: string
) {
  fs.mkdirSync(directory, { recursive: true });
  await core.group(
    `Checking out ${branch_tag_hash} into ${directory}`,
    async () => {
      await echo_command_and_execute(`git init`, directory);
      await echo_command_and_execute(
        `git remote add SDL ${SDL_GIT_URL}`,
        directory
      );
      await echo_command_and_execute(
        `git fetch --depth 1 SDL ${branch_tag_hash}`,
        directory
      );
      await echo_command_and_execute(`git checkout FETCH_HEAD`, directory);
    }
  );
}

async function cmake_configure_build(
  SOURCE_DIR: string,
  build_dir: string,
  prefix_dir: string,
  build_type: string,
  cmake_args: string
) {
  if (!cmake_args) {
    cmake_args = "";
  }

  const configure_command = `cmake -S "${SOURCE_DIR}" -B ${build_dir} ${cmake_args}`;
  const build_command = `cmake --build "${build_dir}" --config ${build_type}`;
  const install_command = `cmake --install "${build_dir}" --prefix ${prefix_dir} --config ${build_type}`;

  await core.group(`Configuring SDL (CMake)`, async () => {
    core.info(configure_command);
    child_process.execSync(configure_command, { stdio: "inherit" });
  });
  await core.group(`Building SDL (CMake)`, async () => {
    core.info(build_command);
    child_process.execSync(build_command, { stdio: "inherit" });
  });
  await core.group(`Installing SDL (CMake)`, async () => {
    core.info(install_command);
    child_process.execSync(install_command, { stdio: "inherit" });
  });
}

function calculate_state_hash(sdl_git_hash: string) {
  const ENV_KEYS = [
    "AR",
    "CC",
    "CXX",
    "ARFLAGS",
    "CFLAGS",
    "CXXFLAGS",
    "LDFLAGS",
    "CMAKE_PREFIX_PATH",
    "PKG_CONFIG_PATH",
  ];
  const env_state: string[] = [];
  for (const key of ENV_KEYS) {
    env_state.push(`${key}=${process.env[key]}`);
  }

  const ACTION_KEYS = ["build-type", "ninja"];
  const inputs_state: string[] = [];
  for (const key of ACTION_KEYS) {
    const v = core.getInput(key);
    inputs_state.push(`${key}=${v}`);
  }

  const misc_state = [`GIT_HASH=${sdl_git_hash}`, `platform=${os.platform()}`];

  const complete_state: string[] = [
    "ENVIRONMENT",
    ...env_state,
    "INPUTS",
    ...inputs_state,
    "MISC",
    ...misc_state,
  ];

  const state_string = complete_state.join("##");

  core.debug(`state_string=${state_string}`);

  return crypto.createHash("sha256").update(state_string).digest("hex");
}

async function run() {
  const SDL_BUILD_PLATFORM = get_sdl_build_platform();
  core.info(`build platform=${SDL_BUILD_PLATFORM}`);

  const SETUP_SDL_ROOT = get_platform_root_directory(SDL_BUILD_PLATFORM);
  core.info(`root=${SETUP_SDL_ROOT}`);

  const USE_NINJA = core.getBooleanInput("ninja");

  const REQUESTED_VERSION_TYPE = parse_requested_sdl_version(
    core.getInput("version")
  );

  const CMAKE_BUILD_TYPE = core.getInput("build-type");
  const CMAKE_BUILD_TYPES = [
    "Release",
    "Debug",
    "MinSizeRel",
    "RelWithDebInfo",
  ];
  if (!CMAKE_BUILD_TYPES.includes(CMAKE_BUILD_TYPE)) {
    throw new SetupSdlError("Invalid build-type");
  }

  let git_branch_hash: string;
  if (REQUESTED_VERSION_TYPE == null) {
    git_branch_hash = core.getInput("version");
  } else {
    const { version: requested_version, type: requested_type } =
      REQUESTED_VERSION_TYPE;

    if (requested_type == SdlReleaseType.Head) {
      if (requested_version.major == 2) {
        git_branch_hash = "SDL2";
      } else if (requested_version.major == 3) {
        git_branch_hash = "main";
      } else {
        throw new SetupSdlError("Invalid -head version");
      }
    } else {
      const sdl_release = SdlRelease.find_release(
        requested_version,
        core.getBooleanInput("pre-release"),
        requested_type
      );
      if (!sdl_release) {
        throw new SetupSdlError(
          `Could not find a matching SDL release for ${requested_version}`
        );
      }
      git_branch_hash = sdl_release.tag;
    }
  }

  const GIT_HASH: string = await convert_git_branch_tag_to_hash(
    git_branch_hash
  );

  const STATE_HASH = calculate_state_hash(GIT_HASH);
  core.info(`setup-sdl state = ${STATE_HASH}`);

  const SOURCE_DIR = `${SETUP_SDL_ROOT}/${STATE_HASH}/source`;
  const BUILD_DIR = `${SETUP_SDL_ROOT}/${STATE_HASH}/build`;
  const PACKAGE_DIR = `${SETUP_SDL_ROOT}/${STATE_HASH}/package`;

  await checkout_sdl_git_hash(GIT_HASH, SOURCE_DIR);

  const SDL_VERSION =
    SdlVersion.detect_sdl_version_from_source_tree(SOURCE_DIR);
  core.info(`SDL version is ${SDL_VERSION.toString()}`);

  const CACHE_KEY = `setup-sdl-${STATE_HASH}`;
  const CACHE_PATHS = [PACKAGE_DIR];
  const found_cache_key = await cache.restoreCache(CACHE_PATHS, CACHE_KEY, []);

  if (!found_cache_key) {
    core.info("No match found in cache. Building SDL from scratch.");

    if (USE_NINJA) {
      await core.group(`Configuring Ninja`, async () => {
        await configure_ninja_build_tool(SDL_BUILD_PLATFORM);
      });
    }

    let cmake_args = `-DCMAKE_BUILD_TYPE=${CMAKE_BUILD_TYPE}`;
    if (USE_NINJA) {
      cmake_args += " -GNinja";
    }

    await cmake_configure_build(
      SOURCE_DIR,
      BUILD_DIR,
      PACKAGE_DIR,
      CMAKE_BUILD_TYPE,
      cmake_args
    );

    await cache.saveCache(CACHE_PATHS, CACHE_KEY);
  }

  core.exportVariable(`SDL${SDL_VERSION.major}_ROOT`, PACKAGE_DIR);
  core.setOutput("prefix", PACKAGE_DIR);
  core.setOutput("version", SDL_VERSION.toString());
}

run();
