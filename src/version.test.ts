import {
  parse_requested_sdl_version,
  SdlVersion,
  SdlRelease,
  SdlReleaseType,
} from "./version";

import { describe, expect, test } from "@jest/globals";

describe("testing parsing of version string", () => {
  function add_parse_to_version_test(
    input: string,
    major: number,
    minor: number,
    patch: number,
    type: SdlReleaseType
  ) {
    test(`test ${input}`, () => {
      const result = parse_requested_sdl_version(input);
      expect(result).toBeTruthy();
      if (result) {
        expect(result.version).toStrictEqual(
          new SdlVersion({ major: major, minor: minor, patch: patch })
        );
        expect(result.type).toStrictEqual(type);
      }
    });
  }
  function add_invalid_version_test(input: string) {
    test(`test ${input}`, () => {
      const result = parse_requested_sdl_version(input);
      expect(result).toBeNull();
    });
  }

  add_parse_to_version_test("2-any", 2, 0, 0, SdlReleaseType.Any);
  add_parse_to_version_test("sdl2-any", 2, 0, 0, SdlReleaseType.Any);
  add_parse_to_version_test("SDL2-any", 2, 0, 0, SdlReleaseType.Any);
  add_parse_to_version_test("3-any", 3, 0, 0, SdlReleaseType.Any);
  add_parse_to_version_test("SDL3-any", 3, 0, 0, SdlReleaseType.Any);
  add_parse_to_version_test("sdl3-any", 3, 0, 0, SdlReleaseType.Any);

  add_parse_to_version_test("2-head", 2, 0, 0, SdlReleaseType.Head);
  add_parse_to_version_test("sdl2-head", 2, 0, 0, SdlReleaseType.Head);
  add_parse_to_version_test("SDL2-head", 2, 0, 0, SdlReleaseType.Head);
  add_parse_to_version_test("3-head", 3, 0, 0, SdlReleaseType.Head);
  add_parse_to_version_test("SDL3-head", 3, 0, 0, SdlReleaseType.Head);
  add_parse_to_version_test("sdl3-head", 3, 0, 0, SdlReleaseType.Head);

  add_parse_to_version_test("2-latest", 2, 0, 0, SdlReleaseType.Latest);
  add_parse_to_version_test("sdl2-latest", 2, 0, 0, SdlReleaseType.Latest);
  add_parse_to_version_test("SDL2-latest", 2, 0, 0, SdlReleaseType.Latest);
  add_parse_to_version_test("3-latest", 3, 0, 0, SdlReleaseType.Latest);
  add_parse_to_version_test("SDL3-latest", 3, 0, 0, SdlReleaseType.Latest);
  add_parse_to_version_test("sdl3-latest", 3, 0, 0, SdlReleaseType.Latest);

  add_parse_to_version_test("2.22.1", 2, 22, 1, SdlReleaseType.Exact);
  add_parse_to_version_test("2.0.18", 2, 0, 18, SdlReleaseType.Exact);
  add_parse_to_version_test("3.2.0", 3, 2, 0, SdlReleaseType.Exact);
  add_parse_to_version_test("3.2.2", 3, 2, 2, SdlReleaseType.Exact);
  add_parse_to_version_test("SDL2.22.1", 2, 22, 1, SdlReleaseType.Exact);
  add_parse_to_version_test("SDL2.0.18", 2, 0, 18, SdlReleaseType.Exact);
  add_parse_to_version_test("SDL3.2.0", 3, 2, 0, SdlReleaseType.Exact);
  add_parse_to_version_test("SDL3.2.2", 3, 2, 2, SdlReleaseType.Exact);

  add_invalid_version_test("f168f9c81326ad374aade49d1dc46f245b20d07a");
  add_invalid_version_test("main");
  add_invalid_version_test("SDL2");
});

describe("test finding a release", () => {
  expect(SdlRelease.get_releases()).toBeTruthy();

  test(`test finding exact 2.0.22 release`, () => {
    const v = new SdlVersion({ major: 2, minor: 0, patch: 22 });
    const rel = SdlRelease.find_release(v, true, SdlReleaseType.Exact);
    expect(rel).not.toBeNull();
    if (rel) {
      expect(rel.version).toStrictEqual(v);
      expect(rel.prerelease).toBeFalsy();
    }
  });

  test(`test finding exact 2.26.1 release`, () => {
    const v = new SdlVersion({ major: 2, minor: 26, patch: 1 });
    const rel = SdlRelease.find_release(v, true, SdlReleaseType.Exact);
    expect(rel).not.toBeNull();
    if (rel) {
      expect(rel.version).toStrictEqual(v);
      expect(rel.prerelease).toBeFalsy();
    }
  });

  test(`test finding latest 2 release`, () => {
    const v = new SdlVersion({ major: 2, minor: 0, patch: 0 });
    const rel = SdlRelease.find_release(v, true, SdlReleaseType.Latest);
    expect(rel).not.toBeNull();
    if (rel) {
      // 2.26.5 exists, so the result must be > 2.26.4
      expect(rel.version.compare(new SdlVersion("2.26.4"))).toBeLessThan(0);
      expect(rel.version.major).toBe(2);
    }
  });

  test(`test finding latest non-prerelease 2 release`, () => {
    console.log(SdlRelease.get_releases());
    const v = new SdlVersion({ major: 2, minor: 0, patch: 0 });
    const rel = SdlRelease.find_release(v, false, SdlReleaseType.Latest);
    expect(rel).not.toBeNull();
    if (rel) {
      // 2.26.5 exists, so the result must be > 2.26.4
      expect(rel.version.compare(new SdlVersion("2.26.4"))).toBeLessThan(0);
      expect(rel.version.major).toBe(2);
      expect(rel.prerelease).toBeFalsy();
    }
  });

  test(`test finding any 2 release`, () => {
    const v = new SdlVersion({ major: 2, minor: 0, patch: 0 });
    const rel = SdlRelease.find_release(v, true, SdlReleaseType.Any);
    expect(rel).not.toBeNull();
    if (rel) {
      // 2.26.5 exists, so the result must be > 2.26.4
      expect(rel.version.major).toBe(2);
    }
  });

  test(`test finding any 3 release`, () => {
    const v = new SdlVersion({ major: 3, minor: 0, patch: 0 });
    const rel = SdlRelease.find_release(v, true, SdlReleaseType.Any);
    expect(rel).not.toBeNull();
    if (rel) {
      // FIXME: Only 3.0.0-prerelease exists at the moment
      expect(rel.version.compare(new SdlVersion("3.0.0"))).toBeLessThanOrEqual(
        0
      );
      expect(rel.version.major).toBe(3);
    }
  });
});
