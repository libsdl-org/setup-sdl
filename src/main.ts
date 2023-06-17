import * as child_process from "child_process";
import * as fs from "fs";

import * as core from "@actions/core";

import { SDL_GIT_URL } from "./constants";
import { configure_ninja_build_tool } from "./ninja";
import { SetupSdlError } from "./util";

import {
  SdlRelease,
  SdlReleaseType,
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
  source_dir: string,
  build_dir: string,
  prefix_dir: string,
  build_type: string,
  cmake_args: string
) {
  if (!cmake_args) {
    cmake_args = "";
  }

  const configure_command = `cmake -S "${source_dir}" -B ${build_dir} ${cmake_args}`;
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

function detect_sdl_major_version(prefix: string): number {
  const sdl3_dir = `${prefix}/include/SDL3`;
  if (fs.existsSync(sdl3_dir)) {
    return 3;
  }

  const sdl2_dir = `${prefix}/include/SDL2`;
  if (fs.existsSync(sdl2_dir)) {
    return 2;
  }
  throw new SetupSdlError("Could not determine version of SDL");
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

  const git_hash: string = await convert_git_branch_tag_to_hash(
    git_branch_hash
  );

  if (USE_NINJA) {
    await core.group(`Configuring Ninja`, async () => {
      await configure_ninja_build_tool(SDL_BUILD_PLATFORM);
    });
  }

  const source_dir = `${SETUP_SDL_ROOT}/src`;
  const build_dir = `${SETUP_SDL_ROOT}/build`;
  const install_dir = `${SETUP_SDL_ROOT}`;
  let cmake_args = `-DCMAKE_BUILD_TYPE=${CMAKE_BUILD_TYPE}`;
  if (USE_NINJA) {
    cmake_args += " -GNinja";
  }

  await checkout_sdl_git_hash(git_hash, source_dir);

  await cmake_configure_build(
    source_dir,
    build_dir,
    install_dir,
    CMAKE_BUILD_TYPE,
    cmake_args
  );

  const sdl_major_version = detect_sdl_major_version(install_dir);

  core.exportVariable(`SDL${sdl_major_version}_ROOT`, install_dir);
  core.setOutput("prefix", install_dir);
}

run();
