import * as os from "os";
import * as core from "@actions/core";

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
  platform: SdlBuildPlatform
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

export function export_environent_variables(
  platform: SdlBuildPlatform,
  prefix: string
) {
  switch (platform) {
    case SdlBuildPlatform.Windows:
      core.addPath(`${prefix}/bin`);
      break;
    case SdlBuildPlatform.Macos: {
      let libpath = process.env.DYLD_LIBRARY_PATH;
      if (libpath) {
        libpath = "`${prefix}`/lib:${libpath}";
      }
      core.exportVariable("DYLD_LIBRARY_PATH", libpath);
      break;
    }
    case SdlBuildPlatform.Linux: {
      let libpath = process.env.LD_LIBRARY_PATH;
      if (libpath) {
        libpath = "`${prefix}`/lib:${libpath}";
      }
      core.exportVariable("LD_LIBRARY_PATH", libpath);
      break;
    }
  }
}
