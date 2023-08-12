import shlex = require("shlex");

export class SetupSdlError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export function shlex_split(text: undefined | string): string[] {
  if (!text) {
    return [];
  } else {
    text = text.trim();
    if (text == "") {
      return [];
    }
    return shlex.split(text);
  }
}
