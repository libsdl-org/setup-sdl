import * as child_process from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import * as cache from "@actions/cache";
import * as core from "@actions/core";
import { Octokit } from "@octokit/rest";
import AdmZip = require("adm-zip");

import { SDL_GIT_REPO } from "./constants";
import { SetupSdlError, shlex_split } from "./util";
import * as linuxpm from "./linuxpm";

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

async function convert_git_branch_tag_to_hash(args: {
  branch_or_hash: string;
  octokit: Octokit;
}): Promise<string> {
  return await core.group(
    `Calculating git hash of ${args.branch_or_hash}`,
    async () => {
      try {
        core.debug(`Look for a branch named "${args.branch_or_hash}"...`);
        const response = await args.octokit.rest.repos.getBranch({
          owner: SDL_GIT_REPO.owner,
          repo: SDL_GIT_REPO.repo,
          branch: args.branch_or_hash,
        });
        core.debug("It was a branch.");
        const sha = response.data.commit.sha;
        core.info(`git hash = ${sha}`);
        return sha;
      } catch (e) {
        core.debug("It was not a branch.");
      }
      try {
        core.debug(`Look for a commit named "${args.branch_or_hash}"...`);
        const response = await args.octokit.rest.repos.getCommit({
          owner: SDL_GIT_REPO.owner,
          repo: SDL_GIT_REPO.repo,
          ref: args.branch_or_hash,
        });
        core.debug("It was a commit.");
        return response.data.sha;
      } catch (e) {
        core.debug("It was not a commit.");
      }
      throw new SetupSdlError(
        `Unable to convert ${args.branch_or_hash} into a git hash.`
      );
    }
  );
}

async function download_sdl_git_hash(args: {
  git_hash: string;
  directory: string;
  octokit: Octokit;
}) {
  fs.mkdirSync(args.directory, { recursive: true });
  await core.group(
    `Downloading and extracting ${args.git_hash} into ${args.directory}`,
    async () => {
      core.info("Downloading git zip archive...");
      const response = await args.octokit.rest.repos.downloadZipballArchive({
        owner: SDL_GIT_REPO.owner,
        repo: SDL_GIT_REPO.repo,
        ref: args.git_hash,
      });
      core.info("Writing zip archive to disk...");
      const ARCHIVE_PATH = path.join(args.directory, "archive.zip");
      fs.writeFileSync(ARCHIVE_PATH, Buffer.from(response.data as ArrayBuffer));
      core.info("Extracting zip archive...");

      const admzip = new AdmZip(ARCHIVE_PATH);
      admzip.getEntries().forEach((entry) => {
        if (entry.isDirectory) {
          /* Ignore directories */
        } else {
          const pos_first_slash = entry.entryName.indexOf("/");
          const pos_last_slash = entry.entryName.lastIndexOf("/");
          const targetPath = path.join(
            args.directory,
            entry.entryName.slice(pos_first_slash + 1, pos_last_slash)
          );
          const maintainEntryPath = true;
          const overwrite = false;
          const keepOriginalPermission = false;
          const outFileName = entry.entryName.slice(pos_last_slash + 1);
          core.debug(
            `Extracting ${outFileName} to ${path.join(
              targetPath,
              outFileName
            )}...`
          );
          admzip.extractEntryTo(
            entry,
            targetPath,
            maintainEntryPath,
            overwrite,
            keepOriginalPermission,
            outFileName
          );
        }
      });
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
}) {
  const configure_args = [
    "cmake",
    "-S",
    args.source_dir,
    "-B",
    args.build_dir,
    '-DSDL_VENDOR_INFO="libsdl-org/setup-sdl"',
    "-DSDL_CMAKE_DEBUG_POSTFIX=",
    ...args.cmake_configure_args,
    `-DCMAKE_INSTALL_PREFIX=${args.package_dir}`,
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
    "--verbose",
  ];

  const install_args = [
    "cmake",
    "--install",
    args.build_dir,
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
  cmake_configure_arguments: string | undefined;
  package_manager: linuxpm.PackageManagerType | undefined;
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
    "MSYSTEM",
    "PKG_CONFIG_PATH",
  ];
  const env_state: string[] = [];
  for (const key of ENV_KEYS) {
    env_state.push(`${key}=${process.env[key]}`);
  }
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("CMAKE_")) {
      env_state.push(`${key}=${process.env[key]}`);
    }
  }

  const ACTION_KEYS = [
    "build-type",
    "cmake-toolchain-file",
    "cmake-generator",
    "discriminator",
    "sdl-test",
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

  if (args.package_manager) {
    misc_state.push(`package_manager=${args.package_manager}`);
  }

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

  if (args.cmake_configure_arguments) {
    misc_state.push(`cmake_arguments=${args.cmake_configure_arguments}`);
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

const SDL_LINUX_DEPENDENCIES: {
  [key in linuxpm.PackageManagerType]:
    | { required: string[]; optional: string[] }
    | undefined;
} = {
  [linuxpm.PackageManagerType.AptGet]: {
    required: [
      "cmake",
      "make",
      "ninja-build",
      "libasound2-dev",
      "libpulse-dev",
      "libaudio-dev",
      "libjack-dev",
      "libsndio-dev",
      "libsamplerate0-dev",
      "libx11-dev",
      "libxext-dev",
      "libxrandr-dev",
      "libxcursor-dev",
      "libxfixes-dev",
      "libxi-dev",
      "libxss-dev",
      "libwayland-dev",
      "libxkbcommon-dev",
      "libdrm-dev",
      "libgbm-dev",
      "libgl1-mesa-dev",
      "libgles2-mesa-dev",
      "libegl1-mesa-dev",
      "libdbus-1-dev",
      "libibus-1.0-dev",
      "libudev-dev",
      "fcitx-libs-dev",
    ],
    optional: [
      "libpipewire-0.3-dev" /* Ubuntu 22.04 */,
      "libdecor-0-dev" /* Ubuntu 22.04 */,
    ],
  },
  [linuxpm.PackageManagerType.Dnf]: {
    required: [
      "cmake",
      "make",
      "ninja-build",
      "alsa-lib-devel",
      "dbus-devel",
      "ibus-devel",
      "libX11-devel",
      "libXau-devel",
      "libXScrnSaver-devel",
      "libXcursor-devel",
      "libXext-devel",
      "libXfixes-devel",
      "libXi-devel",
      "libXrandr-devel",
      "libxkbcommon-devel",
      "libdecor-devel",
      "libglvnd-devel",
      "pipewire-devel",
      "pipewire-jack-audio-connection-kit-devel.x86_64",
      "pulseaudio-libs-devel",
      "wayland-devel",
    ],
    optional: [],
  },
  [linuxpm.PackageManagerType.Apk]: undefined, // FIXME
  [linuxpm.PackageManagerType.Pacman]: undefined, // FIXME
};

function parse_linux_package_manager(
  input: string | undefined,
  build_platform: SdlBuildPlatform
): linuxpm.PackageManagerType | undefined {
  if (build_platform != SdlBuildPlatform.Linux) {
    return undefined;
  }
  if (!input) {
    return undefined;
  }
  input = input.trim().toLowerCase();
  if (input.length == 0) {
    return undefined;
  }
  if (input == "false") {
    return undefined;
  } else if (input == "true") {
    return linuxpm.detect_package_manager();
  } else {
    return linuxpm.package_manager_type_from_string(input);
  }
}

async function install_linux_dependencies(
  package_manager_type: linuxpm.PackageManagerType
) {
  const package_manager = linuxpm.create_package_manager(package_manager_type);
  const packages = SDL_LINUX_DEPENDENCIES[package_manager_type];
  if (!packages) {
    throw new SetupSdlError(
      `Don't know what packages to install for ${package_manager_type}. Please create a pr.`
    );
  }
  await core.group(
    `Installing SDL dependencies using ${package_manager_type}`,
    async () => {
      package_manager.update();
      package_manager.install(packages.required);
      packages.optional.forEach((optional_package) => {
        try {
          package_manager.install([optional_package]);
        } catch (e) {
          /* intentionally left blank */
        }
      });
    }
  );
}

async function run() {
  const GITHUB_TOKEN = core.getInput("token");
  process.env.GH_TOKEN = GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = GITHUB_TOKEN;

  const OCTOKIT = new Octokit({ auth: GITHUB_TOKEN });

  const SDL_BUILD_PLATFORM = get_sdl_build_platform();
  core.info(`build platform = ${SDL_BUILD_PLATFORM}`);

  const SETUP_SDL_ROOT = get_platform_root_directory(SDL_BUILD_PLATFORM);
  core.info(`root = ${SETUP_SDL_ROOT}`);

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

  const GIT_HASH: string = await convert_git_branch_tag_to_hash({
    branch_or_hash: git_branch_hash,
    octokit: OCTOKIT,
  });

  const CMAKE_TOOLCHAIN_FILE = get_cmake_toolchain_path();
  const INPUT_CMAKE_CONFIGURE_ARGUMENTS = core.getInput("cmake-arguments");

  const PACKAGE_MANAGER_TYPE = parse_linux_package_manager(
    core.getInput("install-linux-dependencies"),
    SDL_BUILD_PLATFORM
  );

  const STATE_HASH = calculate_state_hash({
    git_hash: GIT_HASH,
    build_platform: SDL_BUILD_PLATFORM,
    shell: SHELL,
    cmake_toolchain_file: CMAKE_TOOLCHAIN_FILE,
    cmake_configure_arguments: INPUT_CMAKE_CONFIGURE_ARGUMENTS,
    package_manager: PACKAGE_MANAGER_TYPE,
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
        core.info(`SDL found in the cache: key = ${found_cache_key}`);
      } else {
        core.info("No match found in cache. Building SDL from scratch.");
      }

      return !!found_cache_key;
    }
  );

  if (!sdl_from_cache) {
    const BUILD_SDL_TEST = core.getBooleanInput("sdl-test");

    const SOURCE_DIR = `${SETUP_SDL_ROOT}/${STATE_HASH}/source`;
    const BUILD_DIR = `${SETUP_SDL_ROOT}/${STATE_HASH}/build`;

    await download_sdl_git_hash({
      git_hash: GIT_HASH,
      directory: SOURCE_DIR,
      octokit: OCTOKIT,
    });

    if (PACKAGE_MANAGER_TYPE) {
      install_linux_dependencies(PACKAGE_MANAGER_TYPE);
    }

    const cmake_configure_args = shlex_split(INPUT_CMAKE_CONFIGURE_ARGUMENTS);

    cmake_configure_args.push(
      `-DSDL_TEST=${BUILD_SDL_TEST}`,
      `-DCMAKE_BUILD_TYPE=${CMAKE_BUILD_TYPE}`,
      "-DCMAKE_INSTALL_BINDIR=bin",
      "-DCMAKE_INSTALL_INCLUDEDIR=include",
      "-DCMAKE_INSTALL_LIBDIR=lib"
    );
    if (CMAKE_TOOLCHAIN_FILE) {
      cmake_configure_args.push(
        `-DCMAKE_TOOLCHAIN_FILE="${CMAKE_TOOLCHAIN_FILE}"`
      );
    }

    const CMAKE_GENERATOR = core.getInput("cmake-generator");
    if (CMAKE_GENERATOR && CMAKE_GENERATOR.length > 0) {
      cmake_configure_args.push(`-G "${CMAKE_GENERATOR}"`);
    }

    await cmake_configure_build({
      source_dir: SOURCE_DIR,
      build_dir: BUILD_DIR,
      package_dir: PACKAGE_DIR,
      build_type: CMAKE_BUILD_TYPE,
      cmake_configure_args: cmake_configure_args,
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

  // Append <prefix>/lib/pkgconfig to PKG_CONFIG_PATH
  let pkg_config_path = process.env.PKG_CONFIG_PATH;
  if (pkg_config_path) {
    pkg_config_path += path.delimiter;
  } else {
    pkg_config_path = "";
  }
  pkg_config_path += [PACKAGE_DIR, "lib", "pkgconfig"].join("/");
  core.exportVariable("PKG_CONFIG_PATH", pkg_config_path);

  // Set SDL2_CONFIG environment variable
  if (SDL_VERSION.major == 2) {
    const sdl2_config = [PACKAGE_DIR, "bin", "sdl2-config"].join("/");
    core.exportVariable(`SDL2_CONFIG`, sdl2_config);
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
