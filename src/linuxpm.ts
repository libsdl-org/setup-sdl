import * as child_process from "child_process";

import * as core from "@actions/core";
import { SetupSdlError } from "./util";

export enum PackageManagerType {
  Apk = "apk",
  AptGet = "apt-get",
  Dnf = "dnf",
  Pacman = "pacman",
}

export function package_manager_type_from_string(
  text: string
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
  protected constructor(type: PackageManagerType) {
    this.type = type;
  }
  abstract update(): void;
  abstract install(packages: string[]): void;
}

function echo_and_execute_process(command: string) {
  core.info(`Executing "${command}"`);
  child_process.execSync(command, { stdio: "inherit" });
}

class AptGetPackageManager extends PackageManager {
  constructor() {
    super(PackageManagerType.AptGet);
  }

  update() {
    const COMMAND = "sudo apt-get update -y";
    echo_and_execute_process(COMMAND);
  }

  install(packages: string[]) {
    const COMMAND = `sudo apt-get install -y ${packages.join(" ")}`;
    echo_and_execute_process(COMMAND);
  }
}

class DnfPackageManager extends PackageManager {
  constructor() {
    super(PackageManagerType.Dnf);
  }

  update() {
    // Not needed
  }

  install(packages: string[]) {
    const COMMAND = `sudo dnf install -y ${packages.join(" ")}`;
    echo_and_execute_process(COMMAND);
  }
}

class ApkPackageManager extends PackageManager {
  constructor() {
    super(PackageManagerType.Apk);
  }

  update() {
    // Not needed
  }

  install(packages: string[]) {
    const COMMAND = `sudo apk add ${packages.join(" ")}`;
    echo_and_execute_process(COMMAND);
  }
}

class PacmanPackageManager extends PackageManager {
  constructor() {
    super(PackageManagerType.Pacman);
  }

  update() {
    // Not needed
  }

  install(packages: string[]) {
    const COMMAND = `sudo pacman -S${packages.join(" ")}`;
    echo_and_execute_process(COMMAND);
  }
}

export function create_package_manager(
  type: PackageManagerType
): PackageManager {
  switch (type) {
    case PackageManagerType.AptGet:
      return new AptGetPackageManager();
    case PackageManagerType.Apk:
      return new ApkPackageManager();
    case PackageManagerType.Pacman:
      return new PacmanPackageManager();
    case PackageManagerType.Dnf:
      return new DnfPackageManager();
  }
}

function command_exists(name: string): boolean {
  try {
    child_process.execSync(`command -v ${name}`);
    return true;
  } catch (e) {
    return false;
  }
}

export function detect_package_manager(): PackageManagerType | undefined {
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
