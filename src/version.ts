import * as child_process from "child_process";
import * as fs from "fs";

import * as pm from "./pm";
import { SetupSdlError } from "./util";

export class GitHubRelease {
  name: string;
  prerelease: boolean;
  tag: string;
  time: number;
  constructor(name: string, prerelease: boolean, tag: string, time: number) {
    this.name = name;
    this.prerelease = prerelease;
    this.tag = tag;
    this.time = time;
  }

  static fetch_all(repo: string): GitHubRelease[] {
    const buffer = child_process.execSync(`gh release list -R ${repo} -L 1000`);
    return GitHubRelease.from_gh_output(buffer.toString());
  }

  static from_gh_output(text: string): GitHubRelease[] {
    return text
      .trim()
      .split("\n")
      .map((line_str) => {
        const line_parts = line_str.split("\t");
        return new GitHubRelease(
          line_parts[0],
          line_parts[1].toLowerCase() == "pre-release",
          line_parts[2],
          Date.parse(line_parts[3]),
        );
      });
  }
}

export class Version {
  major: number;
  minor: number;
  patch: number;
  constructor(
    version: string | { major: number; minor: number; patch: number },
  ) {
    if (typeof version == "string") {
      const v_list = version.split(".");
      if (v_list.length == 0 || v_list.length > 3) {
        throw new SetupSdlError(
          `Cannot convert version (${version}) to MAJOR.MINOR.PATCH`,
        );
      }
      this.major = Number(v_list[0]);
      if (v_list.length > 0) {
        this.minor = Number(v_list[1]);
      } else {
        this.minor = 0;
      }
      if (v_list.length > 1) {
        this.patch = Number(v_list[2]);
      } else {
        this.patch = 0;
      }
    } else {
      this.major = version.major;
      this.minor = version.minor;
      this.patch = version.patch;
    }
    if (isNaN(this.major) || isNaN(this.minor) || isNaN(this.patch)) {
      throw new SetupSdlError(
        `Cannot convert version (${version}) to MAJOR.MINOR.PATCH`,
      );
    }
  }

  compare(other: Version): number {
    if (this.major > other.major) {
      return -1;
    }
    if (other.major > this.major) {
      return 1;
    }

    if (this.minor > other.minor) {
      return -1;
    }
    if (other.minor > this.minor) {
      return 1;
    }

    if (this.patch > other.patch) {
      return -1;
    }
    if (other.patch > this.patch) {
      return 1;
    }

    return 0;
  }

  equals(other: Version): boolean {
    return this.compare(other) == 0;
  }

  toString(): string {
    return `${this.major}.${this.minor}.${this.patch}`;
  }
}

export enum Project {
  SDL = "SDL",
  SDL_image = "SDL_image",
  SDL_mixer = "SDL_mixer",
  SDL_net = "SDL_net",
  SDL_rtf = "SDL_rtf",
  SDL_ttf = "SDL_ttf",
}

interface ProjectDescription {
  option_name: string;
  discarded_prefix?: string;
  cmake_var_out_prefix: string;
  cmake_var_out_suffix: string;
  deps: Project[];
  major_define: string;
  minor_define: string;
  patch_define: string;
  header_paths: string[];
  header_filenames: string[];
  git_url: string;
  repo_owner: string;
  repo_name: string;
  version_branch_map: { [version: number]: string };
  packages?: pm.Packages;
}

export class VersionExtractor {
  major_define: string;
  minor_define: string;
  patch_define: string;
  header_paths: string[];
  header_filenames: string[];

  constructor(desc: ProjectDescription) {
    this.major_define = desc.major_define;
    this.minor_define = desc.minor_define;
    this.patch_define = desc.patch_define;
    this.header_paths = desc.header_paths;
    this.header_filenames = desc.header_filenames;
  }

  extract_from_header_path(path: string): Version | null {
    if (!fs.existsSync(path)) {
      throw new SetupSdlError(`Cannot find ${path}`);
    }

    const contents = fs.readFileSync(path, "utf8");

    const match_major = contents.match(
      new RegExp(`#define[ \\t]+${this.major_define}[ \\t]+([0-9]+)`),
    );
    if (!match_major) {
      return null;
    }
    const major_version = Number(match_major[1]);

    const match_minor = contents.match(
      new RegExp(`#define[ \\t]+${this.minor_define}[ \\t]+([0-9]+)`),
    );
    if (!match_minor) {
      return null;
    }
    const minor_version = Number(match_minor[1]);

    const match_patch = contents.match(
      new RegExp(`#define[ \\t]+${this.patch_define}[ \\t]+([0-9]+)`),
    );
    if (!match_patch) {
      return null;
    }
    const patch_version = Number(match_patch[1]);

    return new Version({
      major: major_version,
      minor: minor_version,
      patch: patch_version,
    });
  }

  extract_from_install_prefix(path: string): Version {
    const version = (() => {
      for (const infix_path of this.header_paths) {
        for (const header_filename of this.header_filenames) {
          const hdr_path = `${path}/${infix_path}/${header_filename}`;
          if (!fs.existsSync(hdr_path)) {
            continue;
          }
          const version = this.extract_from_header_path(hdr_path);
          if (version == null) {
            continue;
          }
          return version;
        }
      }
      throw new SetupSdlError(`Could not extract version from ${path}.`);
    })();
    return version;
  }
}

export const project_descriptions: { [key in Project]: ProjectDescription } = {
  [Project.SDL]: {
    option_name: "version",
    discarded_prefix: "sdl",
    cmake_var_out_prefix: "SDL",
    cmake_var_out_suffix: "_ROOT",
    deps: [],
    major_define: "SDL_MAJOR_VERSION",
    minor_define: "SDL_MINOR_VERSION",
    patch_define: "(?:SDL_PATCHLEVEL|SDL_MICRO_VERSION)",
    header_paths: ["include/SDL3", "include/SDL2"],
    header_filenames: ["SDL_version.h"],
    git_url: "https://github.com/libsdl-org/SDL.git",
    repo_owner: "libsdl-org",
    repo_name: "SDL",
    version_branch_map: { 2: "SDL2", 3: "main" },
    packages: {
      [pm.PackageManagerType.AptGet]: {
        required: [
          "cmake",
          "make",
          "ninja-build",
          "libasound2-dev",
          "libpulse-dev",
          "libaudio-dev",
          "libjack-dev",
          "libsndio-dev",
          "libusb-1.0-0-dev",
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
      [pm.PackageManagerType.Dnf]: {
        required: [
          "cmake",
          "make",
          "ninja-build",
          "alsa-lib-devel",
          "dbus-devel",
          "ibus-devel",
          "libusb1-devel",
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
          "pipewire-jack-audio-connection-kit-devel",
          "pulseaudio-libs-devel",
          "wayland-devel",
        ],
        optional: [],
      },
    },
  },
  [Project.SDL_image]: {
    option_name: "version-sdl-image",
    cmake_var_out_prefix: "SDL",
    cmake_var_out_suffix: "_image_ROOT",
    deps: [Project.SDL],
    major_define: "SDL_IMAGE_MAJOR_VERSION",
    minor_define: "SDL_IMAGE_MINOR_VERSION",
    patch_define: "(?:SDL_IMAGE_MICRO_VERSION|SDL_IMAGE_PATCHLEVEL)",
    header_paths: ["include/SDL3_image", "include/SDL2"],
    header_filenames: ["SDL_image.h"],
    git_url: "https://github.com/libsdl-org/SDL_image.git",
    repo_owner: "libsdl-org",
    repo_name: "SDL_image",
    version_branch_map: { 2: "SDL2", 3: "main" },
  },
  [Project.SDL_mixer]: {
    option_name: "version-sdl-mixer",
    cmake_var_out_prefix: "SDL",
    cmake_var_out_suffix: "_mixer_ROOT",
    deps: [Project.SDL],
    major_define: "SDL_MIXER_MAJOR_VERSION",
    minor_define: "SDL_MIXER_MINOR_VERSION",
    patch_define: "(?:SDL_MIXER_MICRO_VERSION|SDL_MIXER_PATCHLEVEL)",
    header_paths: ["include/SDL3_mixer", "include/SDL2"],
    header_filenames: ["SDL_mixer.h"],
    git_url: "https://github.com/libsdl-org/SDL_mixer.git",
    repo_owner: "libsdl-org",
    repo_name: "SDL_mixer",
    version_branch_map: { 2: "SDL2", 3: "main" },
  },
  [Project.SDL_net]: {
    option_name: "version-sdl-net",
    cmake_var_out_prefix: "SDL",
    cmake_var_out_suffix: "_net_ROOT",
    deps: [Project.SDL],
    major_define: "SDL_NET_MAJOR_VERSION",
    minor_define: "SDL_NET_MINOR_VERSION",
    patch_define: "(?:SDL_NET_MICRO_VERSION|SDL_NET_PATCHLEVEL)",
    header_paths: ["include/SDL3_net", "include/SDL2", "include"],
    header_filenames: ["SDL_net.h"],
    git_url: "https://github.com/libsdl-org/SDL_net.git",
    repo_owner: "libsdl-org",
    repo_name: "SDL_net",
    version_branch_map: { 2: "SDL2", 3: "main" },
  },
  [Project.SDL_rtf]: {
    option_name: "version-sdl-rtf",
    cmake_var_out_prefix: "SDL",
    cmake_var_out_suffix: "_rtf_ROOT",
    deps: [Project.SDL, Project.SDL_ttf],
    major_define: "SDL_RTF_MAJOR_VERSION",
    minor_define: "SDL_RTF_MINOR_VERSION",
    patch_define: "(?:SDL_RTF_MICRO_VERSION|SDL_RTF_PATCHLEVEL)",
    header_paths: ["include/SDL3_rtf", "include/SDL2", "include"],
    header_filenames: ["SDL_rtf.h"],
    git_url: "https://github.com/libsdl-org/SDL_rtf.git",
    repo_owner: "libsdl-org",
    repo_name: "SDL_rtf",
    version_branch_map: { 2: "SDL2", 3: "main" },
  },
  [Project.SDL_ttf]: {
    option_name: "version-sdl-ttf",
    cmake_var_out_prefix: "SDL",
    cmake_var_out_suffix: "_ttf_ROOT",
    deps: [Project.SDL],
    major_define: "SDL_TTF_MAJOR_VERSION",
    minor_define: "SDL_TTF_MINOR_VERSION",
    patch_define: "(?:SDL_TTF_MICRO_VERSION|SDL_TTF_PATCHLEVEL)",
    header_paths: ["include/SDL3_ttf", "include/SDL2"],
    header_filenames: ["SDL_ttf.h"],
    git_url: "https://github.com/libsdl-org/SDL_ttf.git",
    repo_owner: "libsdl-org",
    repo_name: "SDL_ttf",
    version_branch_map: { 2: "SDL2", 3: "main" },
    packages: {
      [pm.PackageManagerType.AptGet]: {
        required: ["libfreetype-dev", "libharfbuzz-dev"],
        optional: [],
      },
      [pm.PackageManagerType.Dnf]: {
        required: ["freetype-devel", "harfbuzz-devel"],
        optional: [],
      },
      [pm.PackageManagerType.Msys2Pacman]: {
        required: ["freetype", "harfbuzz"],
        optional: [],
      },
    },
  },
};

export enum ReleaseType {
  Any = "Any",
  Head = "Head",
  Latest = "Latest",
  Exact = "Exact",
  Commit = "Commit",
}

// FIXME: rename to ReleaseDb + rename SdlRelease to Release
export class ReleaseDb {
  releases: SdlRelease[];

  constructor(releases: SdlRelease[]) {
    this.releases = releases;
  }

  find(
    version: Version,
    prerelease: boolean,
    type: ReleaseType,
  ): SdlRelease | null {
    for (const release of this.releases) {
      // Skip if a pre-release has not been requested
      if (release.prerelease != null && !prerelease) {
        continue;
      }
      if (type == ReleaseType.Exact) {
        if (release.version.equals(version)) {
          return release;
        }
      }
      if (type == ReleaseType.Latest || type == ReleaseType.Any) {
        if (release.version.major == version.major) {
          return release;
        }
      }
    }
    return null;
  }

  static create(github_releases: GitHubRelease[]): ReleaseDb {
    const R = new RegExp("(release-|prerelease-)?([0-9.]+)(-RC([0-9]+))?");
    const releases = github_releases.map((gh_release) => {
      const m = gh_release.tag.match(R);
      if (m == null) {
        throw new SetupSdlError(`Invalid tag: ${gh_release.tag}`);
      }
      let prerelease: number | null = null;
      if (m[1] != null && m[1] != "release-") {
        prerelease = 1;
      } else if (m[3] != null && m[4] != null) {
        prerelease = Number(m[4]) + 1;
      }
      const version = m[2];
      return new SdlRelease(new Version(version), prerelease, gh_release.tag);
    });
    releases.sort((release1, release2) => {
      return release1.compare(release2);
    });

    return new ReleaseDb(releases);
  }
}

class Release {
  version: Version;
  prerelease: number | null;
  tag: string;

  constructor(version: Version, prerelease: number | null, tag: string) {
    this.version = version;
    this.prerelease = prerelease;
    this.tag = tag;
  }

  compare(other: Release): number {
    const cmp = this.version.compare(other.version);
    if (cmp != 0) {
      return cmp;
    }
    if (this.prerelease != null && other.prerelease != null) {
      return Number(other.prerelease) - Number(this.prerelease);
    }
    if (this.prerelease == null && other.prerelease == null) {
      return 0;
    }
    if (this.prerelease != null) {
      return 1;
    }
    return -1;
  }

  equals(other: Release): boolean {
    return this.compare(other) == 0;
  }

  toString(): string {
    return `<Release:version=${this.version} prerelease=${this.prerelease} tag=${this.tag}>`;
  }
}

export class SdlRelease extends Release {}

export type ParsedVersion = {
  version: Version | string;
  type: ReleaseType;
};

export function parse_version_string(
  version_request: string,
  discarded_prefix: string | undefined,
): ParsedVersion {
  const ANY_SUFFIX = "-any";
  const HEAD_SUFFIX = "-head";
  const LATEST_SUFFIX = "-latest";

  let version: Version;
  let version_type: ReleaseType;

  let stripped_version_request = version_request.toLowerCase();
  if (
    discarded_prefix &&
    stripped_version_request.startsWith(discarded_prefix)
  ) {
    stripped_version_request = stripped_version_request.substring(
      discarded_prefix.length,
    );
  }

  try {
    if (stripped_version_request.endsWith(ANY_SUFFIX)) {
      version_type = ReleaseType.Any;
      const version_str = stripped_version_request.substring(
        0,
        stripped_version_request.length - ANY_SUFFIX.length,
      );
      version = new Version({
        major: Number(version_str),
        minor: 0,
        patch: 0,
      });
    } else if (stripped_version_request.endsWith(HEAD_SUFFIX)) {
      version_type = ReleaseType.Head;
      const version_str = stripped_version_request.substring(
        0,
        stripped_version_request.length - HEAD_SUFFIX.length,
      );
      version = new Version({
        major: Number(version_str),
        minor: 0,
        patch: 0,
      });
    } else if (stripped_version_request.endsWith(LATEST_SUFFIX)) {
      version_type = ReleaseType.Latest;
      const version_str = stripped_version_request.substring(
        0,
        stripped_version_request.length - LATEST_SUFFIX.length,
      );
      version = new Version({
        major: Number(version_str),
        minor: 0,
        patch: 0,
      });
    } else {
      version_type = ReleaseType.Exact;
      const version_str = stripped_version_request;
      version = new Version(version_str);
    }
    return { version: version, type: version_type };
  } catch (e) {
    return { version: version_request, type: ReleaseType.Commit };
  }
}
