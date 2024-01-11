import {
  GitHubRelease,
  parse_version_string,
  Version,
  ReleaseDb,
  ReleaseType,
} from "./version";

import { describe, expect, test } from "@jest/globals";

const GH_RELEASE_OUTPUT =
  "" +
  "3.1.1\tLatest\tprerelease-3.1.1\t2023-12-25T18:45:17Z\n" +
  "2.28.0\tLatest\trelease-2.28.0\t2023-06-20T18:45:17Z\n" +
  "2.28.0 RC1\tPre-release\tprerelease-2.27.1\t2023-06-14T03:59:14Z\n" +
  "2.26.5\t\trelease-2.26.5\t2023-04-05T19:35:40Z\n" +
  "2.26.4\t\trelease-2.26.4\t2023-03-07T00:17:02Z\n" +
  "2.26.3\t\trelease-2.26.3\t2023-02-06T23:31:56Z\n" +
  "2.26.2\t\trelease-2.26.2\t2023-01-03T15:08:11Z\n" +
  "2.26.1\t\trelease-2.26.1\t2022-12-01T20:33:11Z\n" +
  "2.26.0\t\trelease-2.26.0\t2022-11-22T00:28:26Z\n" +
  "2.26.0 RC1\tPre-release\tprerelease-2.25.1\t2022-11-17T17:49:02Z\n" +
  "2.24.2\t\trelease-2.24.2\t2022-11-01T13:39:15Z\n" +
  "2.24.1\t\trelease-2.24.1\t2022-10-05T00:16:33Z\n" +
  "2.24.0\t\trelease-2.24.0\t2022-08-19T16:04:03Z\n" +
  "2.0.22\t\trelease-2.0.22\t2022-04-25T19:20:25Z\n" +
  "2.0.20\t\trelease-2.0.20\t2022-01-11T01:03:58Z\n" +
  "2.0.18\t\trelease-2.0.18\t2021-11-30T17:15:42Z\n" +
  "2.0.16\t\trelease-2.0.16\t2021-08-10T16:03:15Z\n" +
  "2.0.14\t\trelease-2.0.14\t2021-07-08T17:14:16Z\n" +
  "2.0.12\t\trelease-2.0.12\t2022-05-24T22:37:24Z\n" +
  "2.0.10\t\trelease-2.0.10\t2022-05-24T22:35:08Z\n" +
  "2.0.9\t\trelease-2.0.9\t2022-05-24T22:33:03Z\n" +
  "2.0.8\t\trelease-2.0.8\t2022-05-23T22:20:21Z\n";
describe("testing parsing of version string", () => {
  function add_parse_to_version_test(
    input: string,
    major: number,
    minor: number,
    patch: number,
    type: ReleaseType,
  ) {
    test(`test ${input}`, () => {
      const result = parse_version_string(input, "sdl");
      expect(result).toBeTruthy();
      if (result) {
        expect(result.type).toStrictEqual(type);
        expect(result.version).toStrictEqual(
          new Version({ major: major, minor: minor, patch: patch }),
        );
      }
    });
  }
  function add_parse_to_commit_test(input: string) {
    test(`test ${input}`, () => {
      const result = parse_version_string(input, "sdl");
      expect(result).toBeTruthy();
      if (result) {
        expect(result.type).toStrictEqual(ReleaseType.Commit);
        expect(result.version).toStrictEqual(input);
      }
    });
  }

  add_parse_to_version_test("2-any", 2, 0, 0, ReleaseType.Any);
  add_parse_to_version_test("sdl2-any", 2, 0, 0, ReleaseType.Any);
  add_parse_to_version_test("SDL2-any", 2, 0, 0, ReleaseType.Any);
  add_parse_to_version_test("3-any", 3, 0, 0, ReleaseType.Any);
  add_parse_to_version_test("SDL3-any", 3, 0, 0, ReleaseType.Any);
  add_parse_to_version_test("sdl3-any", 3, 0, 0, ReleaseType.Any);

  add_parse_to_version_test("2-head", 2, 0, 0, ReleaseType.Head);
  add_parse_to_version_test("sdl2-head", 2, 0, 0, ReleaseType.Head);
  add_parse_to_version_test("SDL2-head", 2, 0, 0, ReleaseType.Head);
  add_parse_to_version_test("3-head", 3, 0, 0, ReleaseType.Head);
  add_parse_to_version_test("SDL3-head", 3, 0, 0, ReleaseType.Head);
  add_parse_to_version_test("sdl3-head", 3, 0, 0, ReleaseType.Head);

  add_parse_to_version_test("2-latest", 2, 0, 0, ReleaseType.Latest);
  add_parse_to_version_test("sdl2-latest", 2, 0, 0, ReleaseType.Latest);
  add_parse_to_version_test("SDL2-latest", 2, 0, 0, ReleaseType.Latest);
  add_parse_to_version_test("3-latest", 3, 0, 0, ReleaseType.Latest);
  add_parse_to_version_test("SDL3-latest", 3, 0, 0, ReleaseType.Latest);
  add_parse_to_version_test("sdl3-latest", 3, 0, 0, ReleaseType.Latest);

  add_parse_to_version_test("2.22.1", 2, 22, 1, ReleaseType.Exact);
  add_parse_to_version_test("2.0.18", 2, 0, 18, ReleaseType.Exact);
  add_parse_to_version_test("3.2.0", 3, 2, 0, ReleaseType.Exact);
  add_parse_to_version_test("3.2.2", 3, 2, 2, ReleaseType.Exact);
  add_parse_to_version_test("SDL2.22.1", 2, 22, 1, ReleaseType.Exact);
  add_parse_to_version_test("SDL2.0.18", 2, 0, 18, ReleaseType.Exact);
  add_parse_to_version_test("SDL3.2.0", 3, 2, 0, ReleaseType.Exact);
  add_parse_to_version_test("SDL3.2.2", 3, 2, 2, ReleaseType.Exact);

  add_parse_to_commit_test("f168f9c81326ad374aade49d1dc46f245b20d07a");
  add_parse_to_commit_test("main");
  add_parse_to_commit_test("SDL2");
});

describe("test finding a release", () => {
  const github_releases = GitHubRelease.from_gh_output(GH_RELEASE_OUTPUT);
  const sdl_release_db = ReleaseDb.create(github_releases);
  expect(sdl_release_db.releases).toBeTruthy();

  test(`test finding exact 2.0.22 release`, () => {
    const v = new Version({ major: 2, minor: 0, patch: 22 });
    const rel = sdl_release_db.find(v, true, ReleaseType.Exact);
    expect(rel).not.toBeNull();
    if (rel) {
      expect(rel.version).toStrictEqual(v);
      expect(rel.prerelease).toBeFalsy();
    }
  });

  test(`test finding exact 2.26.1 release`, () => {
    const v = new Version({ major: 2, minor: 26, patch: 1 });
    const rel = sdl_release_db.find(v, true, ReleaseType.Exact);
    expect(rel).not.toBeNull();
    if (rel) {
      expect(rel.version).toStrictEqual(v);
      expect(rel.prerelease).toBeFalsy();
    }
  });

  test(`test finding latest 2 release`, () => {
    const v = new Version({ major: 2, minor: 0, patch: 0 });
    const rel = sdl_release_db.find(v, true, ReleaseType.Latest);
    expect(rel).not.toBeNull();
    if (rel) {
      // 2.26.5 exists, so the result must be > 2.26.4
      expect(rel.version.compare(new Version("2.26.4"))).toBeLessThan(0);
      expect(rel.version.major).toBe(2);
    }
  });

  test(`test finding latest non-prerelease 2 release`, () => {
    const v = new Version({ major: 2, minor: 0, patch: 0 });
    const rel = sdl_release_db.find(v, false, ReleaseType.Latest);
    expect(rel).not.toBeNull();
    if (rel) {
      // 2.26.5 exists, so the result must be > 2.26.4
      expect(rel.version.compare(new Version("2.26.4"))).toBeLessThan(0);
      expect(rel.version.major).toBe(2);
      expect(rel.prerelease).toBeFalsy();
    }
  });

  test(`test finding any 2 release`, () => {
    const v = new Version({ major: 2, minor: 0, patch: 0 });
    const rel = sdl_release_db.find(v, true, ReleaseType.Any);
    expect(rel).not.toBeNull();
    if (rel) {
      // 2.26.5 exists, so the result must be > 2.26.4
      expect(rel.version.major).toBe(2);
    }
  });

  test(`test finding any 3 release`, () => {
    const v = new Version({ major: 3, minor: 0, patch: 0 });
    const rel = sdl_release_db.find(v, true, ReleaseType.Any);
    expect(rel).not.toBeNull();
    if (rel) {
      // FIXME: Only 3.0.0-prerelease exists at the moment
      expect(rel.version.compare(new Version("3.0.0"))).toBeLessThanOrEqual(0);
      expect(rel.version.major).toBe(3);
    }
  });
});
