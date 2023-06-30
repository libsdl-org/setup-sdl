import * as child_process from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import * as cache from "@actions/cache";
import * as core from "@actions/core";

import { SDL_GIT_URL } from "./constants";
import { configure_ninja_build_tool } from "./ninja";
import { SetupSdlError } from "./util";

import {
  GitHubRelease,
  SdlReleaseDb,
  SdlReleaseType,
  SdlVersion,
  parse_requested_sdl_version,
} from "./version";

import {
  export_environent_variables,
  get_sdl_build_platform,
  get_platform_root_directory,
  SdlBuildPlatform,
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

function execute_child_process(
  command: string,
  shell: string | undefined | null
) {
  core.info(`${command}`);
  let final_command: string;
  if (shell && shell.indexOf("{0}") >= 0) {
    const cmd_file = `${os.tmpdir}/cmd.txt`;
    fs.writeFileSync(cmd_file, command);
    final_command = shell.replace("{0}", cmd_file);
    core.info(`-> ${final_command}`);
  } else {
    final_command = command;
  }
  child_process.execSync(final_command, { stdio: "inherit" });
}

async function cmake_configure_build(args: {
  source_dir: string;
  build_dir: string;
  package_dir: string;
  build_type: string;
  cmake_configure_args: string[];
  shell: string;
  verbose: boolean;
}) {
  const configure_args = [
    "cmake",
    "-S",
    args.source_dir,
    "-B",
    args.build_dir,
    ...args.cmake_configure_args,
  ];
  if (core.isDebug()) {
    configure_args.push("--trace-expand");
  }

  const build_args = [
    "cmake",
    "--build",
    args.build_dir,
    "--config",
    args.build_type,
  ];
  if (args.verbose) {
    build_args.push("--verbose");
  }

  const install_args = [
    "cmake",
    "--install",
    args.build_dir,
    "--prefix",
    args.package_dir,
    "--config",
    args.build_type,
  ];

  await core.group(`Configuring SDL (CMake)`, async () => {
    const configure_command = configure_args.join(" ");
    execute_child_process(configure_command, args.shell);
  });
  await core.group(`Building SDL (CMake)`, async () => {
    const build_command = build_args.join(" ");
    execute_child_process(build_command, args.shell);
  });
  await core.group(`Installing SDL (CMake)`, async () => {
    const install_command = install_args.join(" ");
    execute_child_process(install_command, args.shell);
  });
}

function calculate_state_hash(args: {
  git_hash: string;
  build_platform: SdlBuildPlatform;
  shell: string;
  cmake_toolchain_file: string | undefined;
}) {
  const ENV_KEYS = [
    "AR",
    "CC",
    "CXX",
    "ARFLAGS",
    "CFLAGS",
    "CXXFLAGS",
    "INCLUDES",
    "LDFLAGS",
    "LIB",
    "LIBPATH",
    "CMAKE_PREFIX_PATH",
    "CMAKE_TOOLCHAIN_FILE",
    "PKG_CONFIG_PATH",
  ];
  const env_state: string[] = [];
  for (const key of ENV_KEYS) {
    env_state.push(`${key}=${process.env[key]}`);
  }

  const ACTION_KEYS = [
    "build-type",
    "cmake-toolchain-file",
    "discriminator",
    "ninja",
  ];
  const inputs_state: string[] = [];
  for (const key of ACTION_KEYS) {
    const v = core.getInput(key);
    inputs_state.push(`${key}=${v}`);
  }

  const misc_state = [
    `GIT_HASH=${args.git_hash}`,
    `build_platform=${args.build_platform}`,
    `shell=${args.shell}`,
  ];

  if (args.cmake_toolchain_file) {
    const toolchain_contents = fs.readFileSync(args.cmake_toolchain_file, {
      encoding: "utf8",
    });
    const cmake_toolchain_file_hash = crypto
      .createHash("sha256")
      .update(toolchain_contents)
      .digest("hex");
    misc_state.push(`cmake_toolchain_file_hash=${cmake_toolchain_file_hash}`);
  }

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

function resolve_workspace_path(in_path: string): string | undefined {
  if (!in_path) {
    return undefined;
  }
  if (fs.existsSync(in_path)) {
    return path.resolve(in_path);
  }
  const workspace_path = path.resolve(
    `${process.env.GITHUB_WORKSPACE}`,
    in_path
  );
  if (fs.existsSync(workspace_path)) {
    return workspace_path;
  }
  return undefined;
}

function get_cmake_toolchain_path(): string | undefined {
  const in_cmake_toolchain_file = core.getInput("cmake-toolchain-file");
  if (in_cmake_toolchain_file) {
    const resolved_cmake_toolchain_file = resolve_workspace_path(
      in_cmake_toolchain_file
    );
    if (!resolved_cmake_toolchain_file) {
      throw new SetupSdlError(
        `Cannot find CMake toolchain file: ${in_cmake_toolchain_file}`
      );
    }
    return resolved_cmake_toolchain_file;
  }
  const env_cmake_toolchain_file = process.env.CMAKE_TOOLCHAIN_FILE;
  if (env_cmake_toolchain_file) {
    const resolved_cmake_toolchain_file = resolve_workspace_path(
      env_cmake_toolchain_file
    );
    if (!resolved_cmake_toolchain_file) {
      throw new SetupSdlError(
        `Cannot find CMake toolchain file: ${env_cmake_toolchain_file}`
      );
    }
    return resolved_cmake_toolchain_file;
  }
  return undefined;
}

async function run() {
  const SDL_BUILD_PLATFORM = get_sdl_build_platform();
  core.info(`build platform=${SDL_BUILD_PLATFORM}`);

  const SETUP_SDL_ROOT = get_platform_root_directory(SDL_BUILD_PLATFORM);
  core.info(`root=${SETUP_SDL_ROOT}`);

  const IGNORED_SHELLS = ["bash", "pwsh", "sh", "cmd", "pwsh", "powershell"];
  let shell_in = core.getInput("shell");
  if (IGNORED_SHELLS.indexOf(shell_in) >= 0) {
    shell_in = "";
  }
  const SHELL = shell_in;

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
      const github_releases = GitHubRelease.fetch_all("libsdl-org/SDL");
      const release_db = SdlReleaseDb.create(github_releases);
      const sdl_release = release_db.find(
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

  const CMAKE_TOOLCHAIN_FILE = get_cmake_toolchain_path();

  const STATE_HASH = calculate_state_hash({
    git_hash: GIT_HASH,
    build_platform: SDL_BUILD_PLATFORM,
    shell: SHELL,
    cmake_toolchain_file: CMAKE_TOOLCHAIN_FILE,
  });

  const PACKAGE_DIR = `${SETUP_SDL_ROOT}/${STATE_HASH}/package`;

  const CACHE_KEY = `setup-sdl-${STATE_HASH}`;
  const CACHE_PATHS = [PACKAGE_DIR];

  const sdl_from_cache = await core.group(
    `Looking up a SDL build in the cache`,
    async () => {
      core.info(`setup-sdl state = ${STATE_HASH}`);

      // Pass a copy of CACHE_PATHS since cache.restoreCache modifies/modified its arguments
      const found_cache_key = await cache.restoreCache(
        CACHE_PATHS.slice(),
        CACHE_KEY
      );
      if (found_cache_key) {
        core.info(`SDL found in the chache: key = ${found_cache_key}`);
      } else {
        core.info("No match found in cache. Building SDL from scratch.");
      }

      return !!found_cache_key;
    }
  );

  if (!sdl_from_cache) {
    const SOURCE_DIR = `${SETUP_SDL_ROOT}/${STATE_HASH}/source`;
    const BUILD_DIR = `${SETUP_SDL_ROOT}/${STATE_HASH}/build`;

    await checkout_sdl_git_hash(GIT_HASH, SOURCE_DIR);

    const USE_NINJA = core.getBooleanInput("ninja");
    if (USE_NINJA) {
      await core.group(`Configuring Ninja`, async () => {
        await configure_ninja_build_tool(SDL_BUILD_PLATFORM);
      });
    }

    const cmake_configure_args = [
      `-DCMAKE_BUILD_TYPE=${CMAKE_BUILD_TYPE}`,
      "-DCMAKE_INSTALL_BINDIR=bin",
      "-DCMAKE_INSTALL_INCLUDEDIR=include",
      "-DCMAKE_INSTALL_LIBDIR=lib",
    ];
    if (CMAKE_TOOLCHAIN_FILE) {
      cmake_configure_args.push(
        `-DCMAKE_TOOLCHAIN_FILE="${CMAKE_TOOLCHAIN_FILE}"`
      );
    }
    if (USE_NINJA) {
      cmake_configure_args.push("-GNinja");
    }

    await cmake_configure_build({
      source_dir: SOURCE_DIR,
      build_dir: BUILD_DIR,
      package_dir: PACKAGE_DIR,
      build_type: CMAKE_BUILD_TYPE,
      cmake_configure_args: cmake_configure_args,
      verbose: core.getBooleanInput("verbose"),
      shell: SHELL,
    });

    await core.group("Storing SDL in the cache", async () => {
      core.info(`Caching ${CACHE_PATHS}.`);
      // Pass a copy of CACHE_PATHS since cache.saveCache modifies/modified its arguments
      await cache.saveCache(CACHE_PATHS.slice(), CACHE_KEY);
    });
  }

  const SDL_VERSION =
    SdlVersion.detect_sdl_version_from_install_prefix(PACKAGE_DIR);
  core.info(`SDL version is ${SDL_VERSION.toString()}`);

  if (core.getBooleanInput("add-to-environment")) {
    export_environent_variables(SDL_BUILD_PLATFORM, PACKAGE_DIR);
  }

  core.exportVariable(`SDL${SDL_VERSION.major}_ROOT`, PACKAGE_DIR);
  core.setOutput("prefix", PACKAGE_DIR);
  core.setOutput("version", SDL_VERSION.toString());
}

try {
  run();
} catch (e) {
  if (e instanceof Error) {
    core.error(e.message);
    core.setFailed(e.message);
  }
  throw e;
}
