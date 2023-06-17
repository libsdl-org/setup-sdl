import { SDL_TAGS } from "./constants";
import { SetupSdlError } from "./util";

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
}

export enum SdlReleaseType {
  Any = "Any",
  Head = "Head",
  Latest = "Latest",
  Exact = "Exact",
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

  static get_releases(): SdlRelease[] {
    const releases: SdlRelease[] = [];
    const R = new RegExp("(release-|prerelease-)([0-9.]+)(-RC([0-9]+))");

    for (const tag of SDL_TAGS) {
      const m = tag.match(R);
      if (m == null) {
        throw new SetupSdlError(`Invalid tag: ${tag}`);
      }
      let prerelease: number | null = null;
      if (m[1] != null) {
        prerelease = 0;
      } else if (m[3] != null && m[4] != null) {
        prerelease = Number(m[4]);
      }
      const version = m[2];
      releases.push(new SdlRelease(new SdlVersion(version), prerelease, tag));
    }
    releases.sort(function (release1, release2) {
      return -release1.compare(release2);
    });
    return releases;
  }

  static find_release(
    version: SdlVersion,
    prerelease: boolean,
    type: SdlReleaseType
  ): SdlRelease | null {
    const RELEASES: SdlRelease[] = SdlRelease.get_releases();
    for (const sdl_release of RELEASES) {
      // Skip if a pre-release has not been requested
      if (sdl_release.prerelease != null && !prerelease) {
        continue;
      }
      if (type == SdlReleaseType.Exact) {
        if (sdl_release.version.equals(version)) {
          return sdl_release;
        }
      }
      if (type == SdlReleaseType.Latest || type == SdlReleaseType.Any) {
        if (sdl_release.version.major == version.major) {
          return sdl_release;
        }
      }
    }
    return null;
  }

  compare(other: SdlRelease): number {
    const cmp = this.version.compare(other.version);
    if (cmp != 0) {
      return cmp;
    }
    if (this.prerelease != null && other.prerelease != null) {
      return Number(this.prerelease) - Number(other.prerelease);
    }
    if (this.prerelease == null && other.prerelease == null) {
      return 0;
    }
    if (this.prerelease != null) {
      return -1;
    }
    return 0;
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
  const HEAD_SUFFIX = "-head";
  const LATEST_SUFFIX = "-latest";
  let version: SdlVersion;
  let version_type: SdlReleaseType;
  version_request = version_request.toLowerCase();
  if (version_request.startsWith("sdl")) {
    version_request = version_request.substring(3);
  }
  try {
    if (version_request.endsWith(HEAD_SUFFIX)) {
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
