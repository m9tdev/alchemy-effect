/**
 * Compile a `.dockerignore` text into a matcher function.
 * Rules follow Docker's documented `.dockerignore` syntax:
 *   - blank lines and `#` comments are skipped
 *   - leading `/` is stripped (paths are always relative to context root)
 *   - `*` matches a single path segment, `**` matches multiple
 *   - patterns ending in `/` match directories
 *   - leading `!` negates an earlier match
 */
export const compileDockerIgnore = (
  text: string,
): ((relPath: string) => boolean) => {
  const lines = text.split(/\r?\n/);
  const rules: { regex: RegExp; negate: boolean }[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let pattern = line;
    let negate = false;
    if (pattern.startsWith("!")) {
      negate = true;
      pattern = pattern.slice(1);
    }
    if (pattern.startsWith("/")) pattern = pattern.slice(1);
    rules.push({ regex: globToRegExp(pattern), negate });
  }
  return (relPath: string): boolean => {
    let matched = false;
    for (const rule of rules) {
      if (rule.regex.test(relPath)) {
        matched = !rule.negate;
      }
    }
    return matched;
  };
};

const globToRegExp = (pattern: string): RegExp => {
  // Escape regex special chars except *, ?, /
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        // ** matches across slashes (zero or more segments)
        if (pattern[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 3;
        } else {
          out += ".*";
          i += 2;
        }
      } else {
        out += "[^/]*";
        i++;
      }
    } else if (c === "?") {
      out += "[^/]";
      i++;
    } else if ("\\^$.|+()[]{}".includes(c)) {
      out += "\\" + c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  // Match the pattern as a prefix (so "node_modules" matches "node_modules/foo")
  // and as an exact path.
  return new RegExp(`^(?:${out})(?:/|$)`);
};
