import * as child_process from "child_process";

import * as core from "@actions/core";
import { SdlBuildPlatform } from "./platform";
import { SetupSdlError } from "./util";
import { Executor } from "./main";

export enum PackageManagerType {
  Apk = "apk",
  AptGet = "apt-get",
  Brew = "brew",
  Dnf = "dnf",
  Pacman = "pacman",
  Msys2Pacman = "msys2-pacman",
}

export type Packages = {
  [key in PackageManagerType]?: { required: string[]; optional: string[] };
};

export function package_manager_type_from_string(
  text: string,
): PackageManagerType | undefined {
  switch (text.trim().toLowerCase()) {
    case "apk":
    case "alpine":
      return PackageManagerType.Apk;
    case "aptget":
    case "apt-get":
    case "ubuntu":
    case "debian":
      return PackageManagerType.AptGet;
    case "dnf":
    case "fedora":
    case "rhel":
      return PackageManagerType.Dnf;
    case "pacman":
    case "arch":
      return PackageManagerType.Pacman;
  }
  throw new SetupSdlError(`Unknown package manager "${text}"`);
}

abstract class PackageManager {
  type: PackageManagerType;
  sudo: boolean;
  executor: Executor;

  protected constructor(args: {
    type: PackageManagerType;
    executor: Executor;
    sudo?: boolean;
  }) {
    this.type = args.type;
    this.executor = args.executor;
    this.sudo = args.sudo == undefined ? command_exists("sudo") : args.sudo;
  }
  abstract update(): void;
  abstract install(packages: string[]): void;

  maybe_sudo_execute(command: string) {
    command = (this.sudo ? " sudo " : "") + command;
    core.info(`Executing "${command}"`);
    this.executor.run(command, true);
  }
}

class AptGetPackageManager extends PackageManager {
  constructor(executor: Executor) {
    super({ executor: executor, type: PackageManagerType.AptGet });
  }

  update() {
    this.maybe_sudo_execute("apt-get update -y");
  }

  install(packages: string[]) {
    this.maybe_sudo_execute(`apt-get install -y ${packages.join(" ")}`);
  }
}

class DnfPackageManager extends PackageManager {
  constructor(executor: Executor) {
    super({ executor: executor, type: PackageManagerType.Dnf });
  }

  update() {
    // Not needed
  }

  install(packages: string[]) {
    this.maybe_sudo_execute(`dnf install -y ${packages.join(" ")}`);
  }
}

class ApkPackageManager extends PackageManager {
  constructor(executor: Executor) {
    super({ executor: executor, type: PackageManagerType.Apk });
  }

  update() {
    // Not needed
  }

  install(packages: string[]) {
    this.maybe_sudo_execute(`apk add ${packages.join(" ")}`);
  }
}

class BrewPackageManager extends PackageManager {
  constructor(executor: Executor) {
    super({ executor: executor, type: PackageManagerType.Apk });
  }

  update() {
    this.maybe_sudo_execute(`brew update`);
  }

  install(packages: string[]) {
    this.maybe_sudo_execute(`brew install -y ${packages.join(" ")}`);
  }
}

class PacmanPackageManager extends PackageManager {
  constructor(executor: Executor) {
    super({ executor: executor, type: PackageManagerType.Pacman });
  }

  update() {
    this.maybe_sudo_execute(`pacman -Sy`);
  }

  install(packages: string[]) {
    this.maybe_sudo_execute(`pacman --noconfirm -S ${packages.join(" ")}`);
  }
}

class Msys2PacmanPackageManager extends PackageManager {
  prefix: string;
  constructor(executor: Executor) {
    super({ executor: executor, type: PackageManagerType.Pacman, sudo: false });
    const msystem = process.env.MSYSTEM;
    if (!msystem) {
      throw new SetupSdlError(
        "msys2-pacman requires MSYSTEM environment variable",
      );
    }
    const msystem_lower = msystem.toLowerCase();
    if (msystem_lower === "mingw32") {
      this.prefix = "mingw-w64-i686-";
    } else if (msystem_lower === "mingw64") {
      this.prefix = "mingw-w64-x86_64-";
    } else if (msystem_lower === "clang32") {
      this.prefix = "mingw-w64-clang-i686-";
    } else if (msystem_lower === "clang64") {
      this.prefix = "mingw-w64-clang-x86_64-";
    } else if (msystem_lower === "ucrt64") {
      this.prefix = "mingw-w64-ucrt-x86_64-";
    } else {
      throw new SetupSdlError(`Invalid MSYSTEM=${msystem}`);
    }
  }

  update() {
    this.maybe_sudo_execute(`pacman -Sy`);
  }

  install(packages: string[]) {
    const prepended_packages = packages.map((p) => `${this.prefix}${p}`);
    this.maybe_sudo_execute(
      `pacman --noconfirm -S ${prepended_packages.join(" ")}`,
    );
  }
}

export function create_package_manager(args: {
  type: PackageManagerType;
  executor: Executor;
}): PackageManager {
  switch (args.type) {
    case PackageManagerType.AptGet:
      return new AptGetPackageManager(args.executor);
    case PackageManagerType.Apk:
      return new ApkPackageManager(args.executor);
    case PackageManagerType.Brew:
      return new BrewPackageManager(args.executor);
    case PackageManagerType.Pacman:
      return new PacmanPackageManager(args.executor);
    case PackageManagerType.Msys2Pacman:
      return new Msys2PacmanPackageManager(args.executor);
    case PackageManagerType.Dnf:
      return new DnfPackageManager(args.executor);
  }
}

function command_exists(name: string): boolean {
  try {
    child_process.execSync(`command -v ${name}`);
    return true;
  } catch {
    return false;
  }
}

export function detect_package_manager(args: {
  build_platform: SdlBuildPlatform;
}): PackageManagerType | undefined {
  if (args.build_platform == SdlBuildPlatform.Windows) {
    if (process.env.MSYSTEM) {
      return PackageManagerType.Msys2Pacman;
    }
    return undefined;
  } else if (args.build_platform == SdlBuildPlatform.Macos) {
    return PackageManagerType.Brew;
  }
  if (command_exists("apt-get")) {
    return PackageManagerType.AptGet;
  } else if (command_exists("apk")) {
    return PackageManagerType.Apk;
  } else if (command_exists("pacman")) {
    return PackageManagerType.Pacman;
  } else if (command_exists("dnf")) {
    return PackageManagerType.Dnf;
  }
  return undefined;
}
