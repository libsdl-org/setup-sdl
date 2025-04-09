import * as child_process from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

import * as cache from "@actions/cache";
import * as core from "@actions/core";
import { Octokit } from "@octokit/rest";
import AdmZip = require("adm-zip");

import { convert_git_branch_tag_to_hash } from "./repo";
import { SetupSdlError, command_arglist_to_string, shlex_split } from "./util";
import * as pm from "./pm";

import { GitHubRelease, ReleaseDb, ReleaseType } from "./version";

import {
  export_environment_variables,
  get_sdl_build_platform,
  get_platform_root_directory,
  SdlBuildPlatform,
} from "./platform";

interface GitSubmodule {
  path: string;
  repo_owner: string;
  repo_name: string;
  branch: string;
}

function read_gitmodules(path: string): GitSubmodule[] {
  if (!fs.existsSync(path)) {
    return [];
  }
  const submodules = [];
  const sdl_repo_regex =
    /https:\/\/github\.com\/([a-zA-Z0-9_-]+)\/([0-9a-zA-Z_-]+)(\.git)?/;
  const gitmodules_lines = fs
    .readFileSync(path, { encoding: "utf8" })
    .trim()
    .split("\n");
  for (let i = 0; 4 * i + 3 <= gitmodules_lines.length; i += 1) {
    const path = gitmodules_lines[4 * i + 1].split("=")[1].trim();
    const url = gitmodules_lines[4 * i + 2].split("=")[1].trim();
    const match = url.match(sdl_repo_regex);
    if (!match) {
      throw new SetupSdlError(`Unable to extract owner/name from "${url}"`);
    }
    const repo_owner = match[1];
    const repo_name = match[2];
    const branch = gitmodules_lines[4 * i + 3].split("=")[1].trim();
    submodules.push({
      path: path,
      repo_owner: repo_owner,
      repo_name: repo_name,
      branch: branch,
    });
  }
  return submodules;
}

async function download_git_repo(args: {
  repo_owner: string;
  repo_name: string;
  submodules: boolean;
  git_hash: string;
  directory: string;
  octokit: Octokit;
}) {
  fs.mkdirSync(args.directory, { recursive: true });
  await core.group(
    `Downloading and extracting ${args.repo_owner}/${args.repo_name} (${args.git_hash}) into ${args.directory}`,
    async () => {
      core.info("Downloading git zip archive...");
      /* Use streams to avoid HTTP 500 HttpError/RequestError: other side closed
       * https://github.com/octokit/rest.js/issues/12#issuecomment-1916023479
       * https://github.com/octokit/rest.js/issues/461#issuecomment-2293930969
       */
      const response = await args.octokit.rest.repos.downloadZipballArchive({
        owner: args.repo_owner,
        repo: args.repo_name,
        ref: args.git_hash,
        request: {
          parseSuccessResponseBody: false, // required to access response as stream
        },
      });
      const assetStream = response.data as unknown as NodeJS.ReadableStream;
      const ARCHIVE_PATH = path.join(args.directory, "archive.zip");
      const outputFile = createWriteStream(ARCHIVE_PATH);
      core.info("Writing zip archive to disk...");
      await pipeline(assetStream, outputFile);

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
            entry.entryName.slice(pos_first_slash + 1, pos_last_slash),
          );
          const maintainEntryPath = true;
          const overwrite = false;
          const keepOriginalPermission = false;
          const outFileName = entry.entryName.slice(pos_last_slash + 1);
          core.debug(
            `Extracting ${outFileName} to ${path.join(
              targetPath,
              outFileName,
            )}...`,
          );
          admzip.extractEntryTo(
            entry,
            targetPath,
            maintainEntryPath,
            overwrite,
            keepOriginalPermission,
            outFileName,
          );
        }
      });
    },
  );
  if (args.submodules) {
    const submodules = read_gitmodules(`${args.directory}/.gitmodules`);
    for (const submodule of submodules) {
      const submodule_hash = await convert_git_branch_tag_to_hash({
        branch_or_hash: submodule.branch,
        owner: submodule.repo_owner,
        repo: submodule.repo_name,
        octokit: args.octokit,
      });
      const submodule_directory = `${args.directory}/${submodule.path}`;
      await download_git_repo({
        repo_owner: submodule.repo_owner,
        repo_name: submodule.repo_name,
        submodules: false,
        git_hash: submodule_hash,
        directory: submodule_directory,
        octokit: args.octokit,
      });
    }
  }
}

export class Executor {
  shell?: string | undefined;

  constructor(args: { shell: string | undefined }) {
    this.shell = args.shell;
  }

  run(command: string, stdio_inherit: boolean = false) {
    core.info(`${command}`);
    let final_command: string;
    if (this.shell && this.shell.indexOf("{0}") >= 0) {
      const cmd_file = `${os.tmpdir}/cmd.txt`;
      fs.writeFileSync(cmd_file, command);
      final_command = this.shell.replace("{0}", cmd_file);
      core.info(`-> ${final_command}`);
    } else {
      final_command = command;
    }
    const stdio_options: { stdio?: "inherit" } = {};
    if (stdio_inherit) {
      stdio_options.stdio = "inherit";
    }
    child_process.execSync(final_command, stdio_options);
  }
}

async function cmake_configure_build(args: {
  project: string;
  source_dir: string;
  build_dir: string;
  package_dir: string;
  build_type: string;
  cmake_configure_args: string[];
  executor: Executor;
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

  await core.group(`Configuring ${args.project} (CMake)`, async () => {
    core.debug(`configure_args: ${configure_args}`);
    const configure_command = command_arglist_to_string(configure_args);
    core.debug(`configure_command: ${configure_command}`);
    args.executor.run(configure_command, true);
  });
  await core.group(`Building ${args.project} (CMake)`, async () => {
    core.debug(`build_args: ${build_args}`);
    const build_command = command_arglist_to_string(build_args);
    core.debug(`build_command: ${build_command}`);
    args.executor.run(build_command, true);
  });
  await core.group(`Installing ${args.project} (CMake)`, async () => {
    core.debug(`install_args: ${install_args}`);
    const install_command = command_arglist_to_string(install_args);
    core.debug(`install_command: ${install_command}`);
    args.executor.run(install_command, true);
  });
}

function calculate_state_hash(args: {
  git_hash: string;
  build_platform: SdlBuildPlatform;
  executor: Executor;
  cmake_toolchain_file: string | undefined;
  cmake_configure_arguments: string | undefined;
  package_manager: pm.PackageManagerType | undefined;
  dependency_hashes: { [_: string]: string };
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
    `shell=${args.executor.shell}`,
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

  for (const dep in args.dependency_hashes) {
    misc_state.push(`dependency_${dep}=${args.dependency_hashes[dep]}`);
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
    in_path,
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
      in_cmake_toolchain_file,
    );
    if (!resolved_cmake_toolchain_file) {
      throw new SetupSdlError(
        `Cannot find CMake toolchain file: ${in_cmake_toolchain_file}`,
      );
    }
    return resolved_cmake_toolchain_file;
  }
  const env_cmake_toolchain_file = process.env.CMAKE_TOOLCHAIN_FILE;
  if (env_cmake_toolchain_file) {
    const resolved_cmake_toolchain_file = resolve_workspace_path(
      env_cmake_toolchain_file,
    );
    if (!resolved_cmake_toolchain_file) {
      throw new SetupSdlError(
        `Cannot find CMake toolchain file: ${env_cmake_toolchain_file}`,
      );
    }
    return resolved_cmake_toolchain_file;
  }
  return undefined;
}

function parse_package_manager(args: {
  build_platform: SdlBuildPlatform;
  input: string | undefined;
}): pm.PackageManagerType | undefined {
  if (!args.input) {
    return undefined;
  }
  const input = args.input.trim().toLowerCase();
  if (input.length == 0) {
    return undefined;
  }
  if (input == "false") {
    return undefined;
  } else if (input == "true") {
    return pm.detect_package_manager({ build_platform: args.build_platform });
  } else {
    return pm.package_manager_type_from_string(input);
  }
}

async function install_dependencies(args: {
  project: Project;
  package_manager_type: pm.PackageManagerType;
  packages: pm.Packages;
  executor: Executor;
}) {
  const package_manager = pm.create_package_manager({
    type: args.package_manager_type,
    executor: args.executor,
  });
  const pm_packages = args.packages[args.package_manager_type];
  if (pm_packages && !package_manager) {
    core.info(
      `Don't know how to install packages the for current platform (${args.package_manager_type}). Please create a pr.`,
    );
    return;
  }
  if (!pm_packages) {
    return;
  }
  await core.group(
    `Installing ${args.project} dependencies using ${args.package_manager_type}`,
    async () => {
      package_manager.update();
      package_manager.install(pm_packages.required);
      pm_packages.optional.forEach((optional_package) => {
        try {
          package_manager.install([optional_package]);
        } catch (e) {
          /* intentionally left blank */
        }
      });
    },
  );
}

import {
  parse_version_string,
  Project,
  project_descriptions,
  ParsedVersion,
  VersionExtractor,
  Version,
} from "./version";

async function run() {
  core.debug("hello");
  const GITHUB_TOKEN = core.getInput("token");
  process.env.GH_TOKEN = GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = GITHUB_TOKEN;

  const OCTOKIT = new Octokit({ auth: GITHUB_TOKEN });

  const SDL_BUILD_PLATFORM = get_sdl_build_platform();
  core.info(`build platform = ${SDL_BUILD_PLATFORM}`);

  const SETUP_SDL_ROOT = get_platform_root_directory(SDL_BUILD_PLATFORM);
  core.info(`root = ${SETUP_SDL_ROOT}`);

  const SHELL = (() => {
    let shell_in = core.getInput("shell");
    const IGNORED_SHELLS = ["bash", "cmd", "powershell", "pwsh", "sh"];
    if (IGNORED_SHELLS.indexOf(shell_in) >= 0) {
      shell_in = "";
    }
    return shell_in;
  })();
  const EXECUTOR = new Executor({ shell: SHELL });
  const ALLOW_PRE_RELEASE = core.getBooleanInput("pre-release");
  const CMAKE_TOOLCHAIN_FILE = get_cmake_toolchain_path();
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
  const PACKAGE_MANAGER_TYPE = parse_package_manager({
    build_platform: SDL_BUILD_PLATFORM,
    input: core.getInput("install-linux-dependencies"),
  });
  const BUILD_SDL_TEST = core.getBooleanInput("sdl-test");

  let major_version: number | null = null;

  // Parse inputs
  const requested_versions: { [key in Project]?: ParsedVersion } = {};
  for (const project in Project) {
    const description = project_descriptions[project as Project];
    const version_string = core.getInput(description.option_name);
    core.debug(`Project ${project}: input "${version_string}"`);
    if (!version_string) {
      continue;
    }
    const parsed_version = parse_version_string(
      version_string,
      description.discarded_prefix,
    );
    switch (parsed_version.type) {
      case ReleaseType.Any:
      case ReleaseType.Head:
      case ReleaseType.Latest:
      case ReleaseType.Exact: {
        const v = parsed_version.version as Version;
        if (major_version != null) {
          if (major_version != v.major) {
            throw new SetupSdlError(
              `Version(s) are incompatiable: all must have the same major version.`,
            );
          }
          major_version = v.major;
        }
        break;
      }
    }

    core.debug(
      `Project ${project}: requested version type: ${
        parsed_version.type
      }, version: ${parsed_version.version.toString()}`,
    );
    requested_versions[project as Project] = parsed_version;
  }

  // Create build plan
  const build_order: Project[] = [];
  let projects_left: Project[] = Object.keys(requested_versions) as Project[];

  while (projects_left.length > 0) {
    core.debug(`projects_left=${projects_left} order=${build_order}`);
    const new_projects_left: Project[] = [];
    for (const project_left of projects_left) {
      core.debug(
        `project: ${project_left} deps: ${project_descriptions[project_left].deps}`,
      );
      if (
        project_descriptions[project_left].deps.every((proj) => {
          core.debug(`proj=${proj}`);
          core.debug(`build_order=${build_order}`);
          core.debug(`proj in build_order=${proj in build_order}`);
          if (
            proj == Project.SDL12_compat &&
            (build_order.indexOf(Project.SDL) >= 0 ||
              build_order.indexOf(Project.SDL2_compat) >= 0)
          ) {
            return 1;
          }
          if (
            proj == Project.SDL2_compat &&
            build_order.indexOf(Project.SDL) >= 0
          ) {
            return 1;
          }
          return build_order.findIndex((e) => e == proj) >= 0;
        })
      ) {
        build_order.push(project_left);
      } else {
        new_projects_left.push(project_left);
      }
    }
    if (new_projects_left.length == projects_left.length) {
      throw new SetupSdlError(`Unable to establish build order`);
    }
    projects_left = new_projects_left;
  }
  core.info(`Build order is ${build_order}.`);

  // Execute build plan

  const project_hashes: { [key in Project]?: string } = {};
  const package_dirs: { [key in Project]?: string } = {};
  const project_versions: { [key in Project]?: Version } = {};

  for (const project of build_order) {
    const project_description = project_descriptions[project];
    const req_step_version = requested_versions[project];

    // Calculate branch name
    const git_branch_hash: string = (() => {
      if (req_step_version == undefined) {
        if (major_version == undefined) {
          throw new SetupSdlError(
            `Don't know what branch/hash to fetch for ${project}.`,
          );
        }
        const branch = project_description.version_branch_map[major_version];
        if (branch == undefined) {
          throw new SetupSdlError(
            `Don't know what branch to use for ${project} ${major_version}.`,
          );
        }
        return branch;
      }
      if (req_step_version.type == ReleaseType.Commit) {
        return req_step_version.version as string;
      }
      const req_version = req_step_version.version as Version;
      if (req_step_version.type == ReleaseType.Head) {
        const branch =
          project_description.version_branch_map[req_version.major];
        if (branch == undefined) {
          throw new SetupSdlError("Invalid -head version");
        }
        return branch;
      }
      const github_releases = GitHubRelease.fetch_all(
        `${project_description.repo_owner}/${project_description.repo_name}`,
      );
      const release_db = ReleaseDb.create(github_releases);
      const sdl_release = release_db.find(
        req_version,
        ALLOW_PRE_RELEASE,
        req_step_version.type,
      );
      if (!sdl_release) {
        throw new SetupSdlError(
          `Could not find a matching release for ${project} ${req_version}`,
        );
      }
      return sdl_release.tag;
    })();

    // Calculate git hash
    const git_hash: string = await convert_git_branch_tag_to_hash({
      branch_or_hash: git_branch_hash,
      owner: project_description.repo_owner,
      repo: project_description.repo_name,
      octokit: OCTOKIT,
    });
    const project_cmake_arguments = (() => {
      const args = [];
      const input_cmake_arguments = core.getInput("cmake-arguments");
      if (input_cmake_arguments) {
        args.push(input_cmake_arguments);
      }
      if (project == Project.SDL) {
        args.push(`-DSDL_TEST_LIBRARY=${BUILD_SDL_TEST}`);
        args.push(`-DSDL_UNIX_CONSOLE_BUILD=ON`);
      }
      return args.join(" ");
    })();

    // Calculate unique hash for caching
    const dependency_hashes = (() => {
      const dep_hashes: { [_: string]: string } = {};
      for (const dep of project_description.deps) {
        dep_hashes[dep as string] = project_hashes[dep as Project] as string;
      }
      return dep_hashes;
    })();

    const project_hash = calculate_state_hash({
      git_hash: git_hash,
      build_platform: SDL_BUILD_PLATFORM,
      executor: EXECUTOR,
      cmake_toolchain_file: CMAKE_TOOLCHAIN_FILE,
      cmake_configure_arguments: project_cmake_arguments,
      package_manager: PACKAGE_MANAGER_TYPE,
      dependency_hashes: dependency_hashes,
    });
    project_hashes[project] = project_hash;

    const package_dir = `${SETUP_SDL_ROOT}/${project_hash}/package`;
    package_dirs[project] = package_dir;

    const cache_key = `setup-sdl-${project}-${project_hash}`;
    const cache_paths = [package_dir];

    // Look in cache
    const was_in_cache = await core.group(
      `Looking up a ${project} build in the cache`,
      async () => {
        core.info(`setup-sdl ${project} state = ${project_hash}`);

        // Pass a copy of cache_paths since cache.restoreCache modifies/modified its arguments
        const found_cache_key = await cache.restoreCache(
          cache_paths.slice(),
          cache_key,
        );
        if (found_cache_key) {
          core.info(`${project} found in the cache: key = ${found_cache_key}`);
        } else {
          core.info(
            `No match found in cache. Building ${project} from scratch.`,
          );
        }

        return !!found_cache_key;
      },
    );

    // Always install linux dependencies (SDL_ttf links to libfreetype)
    const project_packages = project_description.packages;
    if (project_packages && PACKAGE_MANAGER_TYPE) {
      await install_dependencies({
        project: project,
        executor: EXECUTOR,
        package_manager_type: PACKAGE_MANAGER_TYPE,
        packages: project_packages,
      });
    }

    // if not in cache, fetch sources + build + install + store
    if (!was_in_cache) {
      const source_dir = `${SETUP_SDL_ROOT}/${project_hash}/source`;
      const build_dir = `${SETUP_SDL_ROOT}/${project_hash}/build`;

      await download_git_repo({
        repo_owner: project_description.repo_owner,
        repo_name: project_description.repo_name,
        submodules: true,
        git_hash: git_hash,
        directory: source_dir,
        octokit: OCTOKIT,
      });

      const cmake_configure_args = shlex_split(project_cmake_arguments);

      cmake_configure_args.push(
        `-DCMAKE_BUILD_TYPE=${CMAKE_BUILD_TYPE}`,
        "-DCMAKE_INSTALL_BINDIR=bin",
        "-DCMAKE_INSTALL_INCLUDEDIR=include",
        "-DCMAKE_INSTALL_LIBDIR=lib",
      );
      if (CMAKE_TOOLCHAIN_FILE) {
        cmake_configure_args.push(
          `-DCMAKE_TOOLCHAIN_FILE="${CMAKE_TOOLCHAIN_FILE}"`,
        );
      }

      const CMAKE_GENERATOR = core.getInput("cmake-generator");
      if (CMAKE_GENERATOR && CMAKE_GENERATOR.length > 0) {
        cmake_configure_args.push("-G", `"${CMAKE_GENERATOR}"`);
      }

      await cmake_configure_build({
        project: project,
        source_dir: source_dir,
        build_dir: build_dir,
        package_dir: package_dir,
        build_type: CMAKE_BUILD_TYPE,
        cmake_configure_args: cmake_configure_args,
        executor: EXECUTOR,
      });

      await core.group(`Storing ${project} in the cache`, async () => {
        core.info(`Caching ${cache_paths}.`);
        // Pass a copy of cache_paths since cache.saveCache modifies/modified its arguments
        await cache.saveCache(cache_paths.slice(), cache_key);
      });
    }

    const version_extractor = new VersionExtractor(project_description);
    const project_version =
      version_extractor.extract_from_install_prefix(package_dir);
    project_versions[project] = project_version;
    core.info(`${project} version is ${project_version.toString()}`);

    // Set environment variable (e.g. SDL3_ROOT)
    const infix = project_version.major == 1 ? "" : `${project_version.major}`;
    const cmake_export_name = `${project_description.cmake_var_out_prefix}${infix}${project_description.cmake_var_out_suffix}`;
    core.exportVariable(cmake_export_name, package_dir);
  }

  if (core.getBooleanInput("add-to-environment")) {
    export_environment_variables(
      SDL_BUILD_PLATFORM,
      Object.values(package_dirs),
    );
  }

  // Append <prefix>/lib/pkgconfig to PKG_CONFIG_PATH
  const pkg_config_path = (() => {
    const extra_pkg_config_paths = Object.values(package_dirs).map(
      (package_dir) => {
        return `${package_dir}/lib/pkgconfig`;
      },
    );
    let pkg_config_path = process.env.PKG_CONFIG_PATH || "";
    if (pkg_config_path) {
      pkg_config_path += path.delimiter;
    }
    pkg_config_path += extra_pkg_config_paths.join(path.delimiter);
    return pkg_config_path;
  })();
  core.exportVariable("PKG_CONFIG_PATH", pkg_config_path);

  // Set SDL2_CONFIG environment variable
  if (major_version == 2) {
    const sdl2_config = [package_dirs[Project.SDL], "bin", "sdl2-config"].join(
      "/",
    );
    core.exportVariable(`SDL2_CONFIG`, sdl2_config);
  }

  core.setOutput("prefix", package_dirs[Project.SDL] as string);
  core.setOutput(
    "version",
    (project_versions[Project.SDL] as Version).toString(),
  );
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
