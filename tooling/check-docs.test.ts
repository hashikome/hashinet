import { expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkDocsIndexed, checkMarkdownLinks } from "./check-docs";

it("checks inline/reference/heading links while ignoring fenced examples and external URLs", () => {
  const root = mkdtempSync(join(tmpdir(), "docs-check-"));
  try {
    writeFileSync(join(root, "target.md"), "# Heading\n# Heading\n```md\n# Example only\n```\n");
    writeFileSync(
      join(root, "readme.md"),
      [
        "[valid](target.md#heading-1)",
        "[external](https://example.invalid)",
        "```md",
        "[example](missing.md)",
        "```",
        "[ref]: target.md#heading",
      ].join("\n"),
    );
    expect(checkMarkdownLinks(root, ["readme.md"])).toEqual([]);
    writeFileSync(
      join(root, "readme.md"),
      "[bad](missing.md)\n[bad anchor](target.md#example-only)\n[ref]: ../outside.md",
    );
    expect(checkMarkdownLinks(root, ["readme.md"])).toHaveLength(3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("requires every doc under docs/ to be listed by its folder's README or a parent index", () => {
  const root = mkdtempSync(join(tmpdir(), "docs-index-"));
  try {
    mkdirSync(join(root, "docs/area"), { recursive: true });
    writeFileSync(
      join(root, "docs/README.md"),
      "[area](area/README.md) [direct](area/direct.md)\n",
    );
    writeFileSync(join(root, "docs/area/README.md"), "[listed](listed.md)\n");
    for (const f of ["listed", "direct", "orphan"])
      writeFileSync(join(root, `docs/area/${f}.md`), `# ${f}\n`);
    const files = [
      "docs/README.md",
      "docs/area/README.md",
      "docs/area/listed.md",
      "docs/area/direct.md",
      "docs/area/orphan.md",
    ];
    expect(checkDocsIndexed(root, files)).toEqual([
      "docs/area/orphan.md: not listed by docs/README.md or the README.md of its folder",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
