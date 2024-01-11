import * as os from "os";
import * as core from "@actions/core";
import * as path from "path";

import { SetupSdlError } from "./util";

export enum SdlBuildPlatform {
  Windows = "Windows",
  Linux = "Linux",
  Macos = "MacOS",
}

export function get_sdl_build_platform(): SdlBuildPlatform {
  switch (os.platform()) {
    case "linux":
      return SdlBuildPlatform.Linux;
    case "darwin":
      return SdlBuildPlatform.Macos;
    case "win32":
      return SdlBuildPlatform.Windows;
  }
  throw new SetupSdlError("Unsupported build platform");
}

export function get_platform_root_directory(
  platform: SdlBuildPlatform,
): string {
  const root: null | string = core.getInput("root");
  if (root) {
    return root;
  }
  switch (platform) {
    case SdlBuildPlatform.Windows:
      return "C:/setupsdl";
    case SdlBuildPlatform.Macos:
    case SdlBuildPlatform.Linux:
      return `${os.tmpdir()}/setupsdl`;
  }
}

export function export_environment_variables(
  platform: SdlBuildPlatform,
  prefixes: string[],
) {
  switch (platform) {
    case SdlBuildPlatform.Windows: {
      const bin_paths = prefixes.map((prefix) => {
        return `${prefix}/bin`;
      });
      const extra_path = bin_paths.join(path.delimiter);
      core.addPath(extra_path);
      break;
    }
    case SdlBuildPlatform.Macos: {
      const lib_paths = prefixes.map((prefix) => {
        return `${prefix}/lib`;
      });
      let dyld_path = lib_paths.join(path.delimiter);
      if (process.env.DYLD_LIBRARY_PATH) {
        dyld_path += `:${process.env.DYLD_LIBRARY_PATH}`;
      }
      core.exportVariable("DYLD_LIBRARY_PATH", dyld_path);
      break;
    }
    case SdlBuildPlatform.Linux: {
      const lib_paths = prefixes.map((prefix) => {
        return `${prefix}/lib`;
      });
      let ld_path = lib_paths.join(path.delimiter);
      if (process.env.LD_LIBRARY_PATH) {
        ld_path += `:${process.env.LD_LIBRARY_PATH}`;
      }
      core.exportVariable("LD_LIBRARY_PATH", ld_path);
      break;
    }
  }
}
