import * as child_process from "child_process";
import * as fs from "fs";

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
          Date.parse(line_parts[3])
        );
      });
  }
}

export class SdlVersion {
  major: number;
  minor: number;
  patch: number;
  constructor(
    version: string | { major: number; minor: number; patch: number }
  ) {
    if (typeof version == "string") {
      const v_list = version.split(".");
      if (v_list.length == 0 || v_list.length > 3) {
        throw new SetupSdlError(
          `Cannot convert version (${version}) to MAJOR.MINOR.PATCH`
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
        `Cannot convert version (${version}) to MAJOR.MINOR.PATCH`
      );
    }
  }

  compare(other: SdlVersion): number {
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

  equals(other: SdlVersion): boolean {
    return this.compare(other) == 0;
  }

  toString(): string {
    return `${this.major}.${this.minor}.${this.patch}`;
  }

  static detect_sdl_version_from_source_tree(path: string): SdlVersion {
    const sdl3_SDL_version_h_path = `${path}/include/SDL3/SDL_version.h`;
    if (fs.existsSync(sdl3_SDL_version_h_path)) {
      return this.extract_sdl_version_from_SDL_version_h(
        sdl3_SDL_version_h_path
      );
    }

    const sdl2_SDL_version_h_path = `${path}/include/SDL_version.h`;
    if (fs.existsSync(sdl2_SDL_version_h_path)) {
      return this.extract_sdl_version_from_SDL_version_h(
        sdl2_SDL_version_h_path
      );
    }

    throw new SetupSdlError(
      `Could not find a SDL_version.h in the source tree (${path})`
    );
  }

  static detect_sdl_version_from_install_prefix(path: string): SdlVersion {
    const sdl3_SDL_version_h_path = `${path}/include/SDL3/SDL_version.h`;
    if (fs.existsSync(sdl3_SDL_version_h_path)) {
      return this.extract_sdl_version_from_SDL_version_h(
        sdl3_SDL_version_h_path
      );
    }

    const sdl2_SDL_version_h_path = `${path}/include/SDL2/SDL_version.h`;
    if (fs.existsSync(sdl2_SDL_version_h_path)) {
      return this.extract_sdl_version_from_SDL_version_h(
        sdl2_SDL_version_h_path
      );
    }

    throw new SetupSdlError(
      `Could not find a SDL_version.h in the prefix (${path})`
    );
  }

  static extract_sdl_version_from_SDL_version_h(
    SDL_version_h_path: string
  ): SdlVersion {
    const SDL_version_h = fs.readFileSync(SDL_version_h_path, "utf8");

    const match_major = SDL_version_h.match(
      /#define[ \t]+SDL_MAJOR_VERSION[ \t]+([0-9]+)/
    );
    if (!match_major) {
      throw new SdlVersion(
        `Unable to extract major SDL version from ${SDL_version_h_path}`
      );
    }
    const major_version = Number(match_major[1]);

    const match_minor = SDL_version_h.match(
      /#define[ \t]+SDL_MINOR_VERSION[ \t]+([0-9]+)/
    );
    if (!match_minor) {
      throw new SdlVersion(
        `Unable to extract minor SDL version from ${SDL_version_h_path}`
      );
    }
    const minor_version = Number(match_minor[1]);

    const match_patch = SDL_version_h.match(
      /#define[ \t]+SDL_PATCHLEVEL[ \t]+([0-9]+)/
    );
    if (!match_patch) {
      throw new SdlVersion(
        `Unable to extract patch SDL version from ${SDL_version_h_path}`
      );
    }
    const patch_version = Number(match_patch[1]);

    return new SdlVersion({
      major: major_version,
      minor: minor_version,
      patch: patch_version,
    });
  }
}

export enum SdlReleaseType {
  Any = "Any",
  Head = "Head",
  Latest = "Latest",
  Exact = "Exact",
}

export class SdlReleaseDb {
  releases: SdlRelease[];

  constructor(releases: SdlRelease[]) {
    this.releases = releases;
  }

  find(
    version: SdlVersion,
    prerelease: boolean,
    type: SdlReleaseType
  ): SdlRelease | null {
    for (const release of this.releases) {
      // Skip if a pre-release has not been requested
      if (release.prerelease != null && !prerelease) {
        continue;
      }
      if (type == SdlReleaseType.Exact) {
        if (release.version.equals(version)) {
          return release;
        }
      }
      if (type == SdlReleaseType.Latest || type == SdlReleaseType.Any) {
        if (release.version.major == version.major) {
          return release;
        }
      }
    }
    return null;
  }

  static create(github_releases: GitHubRelease[]): SdlReleaseDb {
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
      return new SdlRelease(
        new SdlVersion(version),
        prerelease,
        gh_release.tag
      );
    });
    releases.sort((release1, release2) => {
      return release1.compare(release2);
    });

    return new SdlReleaseDb(releases);
  }
}

export class SdlRelease {
  version: SdlVersion;
  prerelease: number | null;
  tag: string;

  constructor(version: SdlVersion, prerelease: number | null, tag: string) {
    this.version = version;
    this.prerelease = prerelease;
    this.tag = tag;
  }

  compare(other: SdlRelease): number {
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

  equals(other: SdlRelease): boolean {
    return this.compare(other) == 0;
  }

  toString(): string {
    return `<SDLRelease:version=${this.version} prerelease=${this.prerelease} tag=${this.tag}>`;
  }
}

export function parse_requested_sdl_version(
  version_request: string
): { version: SdlVersion; type: SdlReleaseType } | null {
  const ANY_SUFFIX = "-any";
  const HEAD_SUFFIX = "-head";
  const LATEST_SUFFIX = "-latest";

  let version: SdlVersion;
  let version_type: SdlReleaseType;

  version_request = version_request.toLowerCase();
  if (version_request.startsWith("sdl")) {
    version_request = version_request.substring(3);
  }

  try {
    if (version_request.endsWith(ANY_SUFFIX)) {
      version_type = SdlReleaseType.Any;
      const version_str = version_request.substring(
        0,
        version_request.length - ANY_SUFFIX.length
      );
      version = new SdlVersion({
        major: Number(version_str),
        minor: 0,
        patch: 0,
      });
    } else if (version_request.endsWith(HEAD_SUFFIX)) {
      version_type = SdlReleaseType.Head;
      const version_str = version_request.substring(
        0,
        version_request.length - HEAD_SUFFIX.length
      );
      version = new SdlVersion({
        major: Number(version_str),
        minor: 0,
        patch: 0,
      });
    } else if (version_request.endsWith(LATEST_SUFFIX)) {
      version_type = SdlReleaseType.Latest;
      const version_str = version_request.substring(
        0,
        version_request.length - LATEST_SUFFIX.length
      );
      version = new SdlVersion({
        major: Number(version_str),
        minor: 0,
        patch: 0,
      });
    } else {
      version_type = SdlReleaseType.Exact;
      const version_str = version_request;
      version = new SdlVersion(version_str);
    }
    return { version: version, type: version_type };
  } catch (e) {
    return null;
  }
}
