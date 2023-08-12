import { shlex_split } from "./util";

import { describe, expect, test } from "@jest/globals";

describe("testing shlex.parse", () => {
  test("test undefined", () => {
    expect(shlex_split(undefined)).toStrictEqual([]);
  });
  test("test empty string", () => {
    expect(shlex_split("")).toStrictEqual([]);
  });
  test("test string with whitespace(s)", () => {
    expect(shlex_split(" ")).toStrictEqual([]);
    expect(shlex_split("   ")).toStrictEqual([]);
    expect(shlex_split("\t")).toStrictEqual([]);
    expect(shlex_split(" \t")).toStrictEqual([]);
    expect(shlex_split("\t\t    \t")).toStrictEqual([]);
  });
  test("test simple string with text", () => {
    expect(shlex_split("a")).toStrictEqual(["a"]);
    expect(shlex_split("a b")).toStrictEqual(["a", "b"]);
    expect(shlex_split("  a \t  \t b  ")).toStrictEqual(["a", "b"]);
  });
  test("test string with escape characters", () => {
    expect(shlex_split('"a"')).toStrictEqual(["a"]);
    expect(shlex_split('"a" "b"')).toStrictEqual(["a", "b"]);
    expect(shlex_split('"a b"  ')).toStrictEqual(["a b"]);
  });
  test("test example extra cmake arguments", () => {
    expect(shlex_split("-A win32")).toStrictEqual(["-A", "win32"]);
    expect(shlex_split("-DSDL_STATIC=ON -DSDL_X11=OFF")).toStrictEqual([
      "-DSDL_STATIC=ON",
      "-DSDL_X11=OFF",
    ]);
  });
});
