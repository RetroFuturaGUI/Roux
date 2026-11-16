import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { newCMakeListsText, updateRegions, type RegionContent } from "../generate/CMakeRegions.js";
import { generateNeed, generateProject } from "../generate/Generator.js";
import { cmakeRegions, cmakeString, projectCMakeText } from "../generate/ProjectCMake.js";
import { parseBechaml } from "../bechaml/Parser.js";
import { newProjectText, readProject } from "../project/ProjectFile.js";

const contents: RegionContent[] =
[
    { name: "project", description: "Rewritten.", lines: ["project(\"App\" VERSION 0.2.0)"] },
    { name: "target", description: "Rewritten.", lines: ["if(ROUX_DYNLIB)", "    add_library(\"App\" SHARED ${ROUX_SOURCES})", "else()", "    add_executable(\"App\" ${ROUX_SOURCES})", "endif()"] },
    { name: "assets", description: "Rewritten.", lines: ["copy(Resources)"] }
];

const file = (...lines: string[]) => lines.join("\n");

test("rewrites what's inside the regions and leaves every other line as it is", () =>
{
    const text = file(
        "# mine, before",
        "# >>> Roux: project. Old text.",
        "project(\"App\" VERSION 0.1.0)",
        "# <<< Roux",
        "if(MSVC)",
        "    add_compile_options(/utf-8)",
        "endif()",
        "# >>> Roux: target. Old text.",
        "add_executable(\"App\" a.cpp)",
        "# <<< Roux",
        "# >>> Roux: assets. Old text.",
        "# <<< Roux",
        "");

    const update = updateRegions(text, contents, "CMakeLists.txt");
    assert.deepEqual(update.problems, []);
    assert.equal(update.text, file(
        "# mine, before",
        "# >>> Roux: project. Rewritten.",
        "project(\"App\" VERSION 0.2.0)",
        "# <<< Roux",
        "if(MSVC)",
        "    add_compile_options(/utf-8)",
        "endif()",
        "# >>> Roux: target. Rewritten.",
        "if(ROUX_DYNLIB)",
        "    add_library(\"App\" SHARED ${ROUX_SOURCES})",
        "else()",
        "    add_executable(\"App\" ${ROUX_SOURCES})",
        "endif()",
        "# <<< Roux",
        "# >>> Roux: assets. Rewritten.",
        "copy(Resources)",
        "# <<< Roux",
        ""));

    assert.equal(updateRegions(update.text ?? "", contents, "CMakeLists.txt").text, update.text, "a second run changes nothing");
});

test("puts a kept block back below the line it followed, or at the region's end with a warning", () =>
{
    const text = file(
        "# >>> Roux: project",
        "# <<< Roux",
        "# >>> Roux: target",
        "#<!--",
        "set(FIRST ON)",
        "#-->",
        "if(ROUX_DYNLIB)",
        "else()",
        "    add_executable(\"App\" ${ROUX_SOURCES})",
        "    #<!--",
        "    target_sources(\"App\" PRIVATE app.manifest)",
        "    #-->",
        "endif()",
        "removed_by_roux()",
        "#<!-- my own",
        "set(ORPHAN ON)",
        "#-->",
        "# <<< Roux",
        "# >>> Roux: assets",
        "# <<< Roux");

    const update = updateRegions(text, contents, "CMakeLists.txt");
    assert.deepEqual(update.problems, [{ line: 15, severity: "warning", message: "The kept block starting here followed \"removed_by_roux()\", which Roux no longer writes, so it moved to the end of region target." }]);

    const lines = (update.text ?? "").split("\n");
    const start = lines.indexOf("# >>> Roux: target. Rewritten.");
    assert.deepEqual(lines.slice(start, start + 15), [
        "# >>> Roux: target. Rewritten.",
        "#<!--",
        "set(FIRST ON)",
        "#-->",
        "if(ROUX_DYNLIB)",
        "    add_library(\"App\" SHARED ${ROUX_SOURCES})",
        "else()",
        "    add_executable(\"App\" ${ROUX_SOURCES})",
        "    #<!--",
        "    target_sources(\"App\" PRIVATE app.manifest)",
        "    #-->",
        "endif()",
        "#<!-- my own",
        "set(ORPHAN ON)",
        "#-->"
    ]);
});

test("adds a missing region next to the ones around it, and keeps CRLF", () =>
{
    const text = "# >>> Roux: project\r\n# <<< Roux\r\nmine()\r\n# >>> Roux: assets\r\n# <<< Roux\r\n";
    const update = updateRegions(text, contents, "CMakeLists.txt");

    assert.equal(update.text, [
        "# >>> Roux: project. Rewritten.",
        "project(\"App\" VERSION 0.2.0)",
        "# <<< Roux",
        "",
        "# >>> Roux: target. Rewritten.",
        "if(ROUX_DYNLIB)",
        "    add_library(\"App\" SHARED ${ROUX_SOURCES})",
        "else()",
        "    add_executable(\"App\" ${ROUX_SOURCES})",
        "endif()",
        "# <<< Roux",
        "mine()",
        "# >>> Roux: assets. Rewritten.",
        "copy(Resources)",
        "# <<< Roux",
        ""
    ].join("\r\n"));
});

test("refuses markers that don't fit, naming the line, and a file without regions", () =>
{
    const refused = (text: string) => updateRegions(text, contents, "CMakeLists.txt");
    const first = (text: string) => refused(text).problems[0];

    assert.equal(refused("project()\n").text, undefined);
    assert.match(first("project()\n")?.message ?? "", /^CMakeLists.txt has none of Roux's regions \(project, target, assets\)/);
    assert.deepEqual(first("a()\n#<!--\nb()\n#-->\n"), { line: 2, severity: "error", message: "A kept block (#<!--) only belongs inside a Roux region; outside them every line is kept anyway." });
    assert.equal(first("# >>> Roux: project\n#<!--\n#<!--\n#-->\n# <<< Roux\n")?.line, 3);
    assert.equal(first("# >>> Roux: project\n#<!--\n# <<< Roux\n")?.message, "A region marker is inside the kept block of line 2, which needs its #--> first.");
    assert.equal(first("# >>> Roux: project\n#<!--\n")?.message, "The kept block has no #--> to end it.");
    assert.equal(first("# >>> Roux: project\n")?.message, "Region project has no \"# <<< Roux\" to end it.");
    assert.equal(first("# <<< Roux\n")?.message, "\"# <<< Roux\" ends a region that never started.");
    assert.equal(first("# >>> Roux: project\n# >>> Roux: target\n")?.line, 2);
    assert.equal(first("# >>> Roux: project\n# <<< Roux\n# >>> Roux: project\n# <<< Roux\n")?.message, "There's a region project already, at line 1.");
    assert.match(first("#>>> Roux project\n")?.message ?? "", /^This looks like a Roux marker but isn't one/);
    assert.equal(first("# >>> Roux: project\n#-->\n# <<< Roux\n")?.message, "#--> ends a kept block that never started.");

    const unknown = refused("# >>> Roux: project\n# <<< Roux\n# >>> Roux: later\nkept()\n# <<< Roux\n");
    assert.ok(unknown.text?.includes("# >>> Roux: later\nkept()\n# <<< Roux"));
    assert.deepEqual(unknown.problems, [{ line: 3, severity: "warning", message: "Roux writes no region named later, so it leaves it as it is." }]);
});

test("quotes CMake text so nothing in it is read as a variable or a list", () =>
{
    assert.equal(cmakeString("a b"), "\"a b\"");
    assert.equal(cmakeString("C:\\x;${HOME}\"q"), "\"C:\\\\x\\;\\${HOME}\\\"q\"");
});

test("generates Project.cmake and CMakeLists.txt from Project.bechaml, then leaves them alone", async () =>
{
    const folder = mkdtempSync(path.join(os.tmpdir(), "roux-generate-"));

    try
    {
        assert.deepEqual(await generateProject(folder), { hasProject: false, problems: [], written: [], removed: [] });

        const project = newProjectText("App", "Windows").replace("<Features>{ }</Features>", "<Features>{ \"TrackerModules\" }</Features>").replace("<Assets>{ }</Assets>", "<Assets>{ \"Assets\", \"Missing\" }</Assets>");
        writeFileSync(path.join(folder, "Project.bechaml"), project);
        mkdirSync(path.join(folder, "source", "generated", "impl", "Scenes"), { recursive: true });
        mkdirSync(path.join(folder, "source", "generated", ".hidden"), { recursive: true });
        mkdirSync(path.join(folder, "Assets"));
        writeFileSync(path.join(folder, "source", "generated", "main.cpp"), "");
        writeFileSync(path.join(folder, "source", "generated", "impl", "Scenes", "MainScene_setup.cpp"), "");
        writeFileSync(path.join(folder, "source", "generated", "impl", "Scenes", "MainScene_p.hpp"), "");
        writeFileSync(path.join(folder, "source", "generated", ".hidden", "Old.cpp"), "");

        const result = await generateProject(folder);
        assert.deepEqual(result.problems.map(problem => problem.severity + " " + problem.line + ": " + problem.message), ["warning 16: The asset folder Missing doesn't exist, so the build copies nothing from it."]);
        assert.deepEqual(result.written.map(written => path.relative(folder, written).split(path.sep).join("/")), ["source/generated/Project.cmake", "CMakeLists.txt"]);

        const projectCMake = readFileSync(path.join(folder, "source", "generated", "Project.cmake"), "utf8");
        assert.ok(projectCMake.includes("if(ROUX_PLATFORM STREQUAL \"Windows\")\n    set(ROUX_LANGUAGE \"C++\")\n    set(ROUX_LANGUAGE_STANDARD \"23\")\n    set(ROUX_DYNLIB OFF)"));
        assert.ok(projectCMake.includes("set(RETROFUTURAGUI_TRACKER_MODULES ON)\nset(RETROFUTURAGUI_ROYALTY_FREE_CODECS_ONLY ON)"));
        assert.ok(projectCMake.includes("set(ROUX_SOURCES\n    \"${PROJECT_SOURCE_DIR}/source/generated/impl/Scenes/MainScene_setup.cpp\"\n    \"${PROJECT_SOURCE_DIR}/source/generated/main.cpp\"\n    ${ROUX_CODE_SOURCES}\n)"), "Roux's sources by name, without hidden folders; the user's by CMake's glob");
        assert.ok(projectCMake.includes("\"${PROJECT_SOURCE_DIR}/source/generated/impl/Scenes\"\n)"), "folders with headers are include directories");
        assert.ok(projectCMake.includes("list(FILTER ROUX_CODE_SOURCES EXCLUDE REGEX \"(^|/)(\\\\.[^/]*|bin|obj|out|build|target|node_modules|__pycache__)/\")"));

        const cmakeLists = readFileSync(path.join(folder, "CMakeLists.txt"), "utf8");
        assert.ok(cmakeLists.includes("cmake_minimum_required(VERSION 3.16)\nproject(\"App\" VERSION 0.1.0)"));
        assert.ok(cmakeLists.includes("\"${CMAKE_CURRENT_SOURCE_DIR}/Assets\"\n        \"$<TARGET_FILE_DIR:App>/Assets\""));
        assert.ok(!cmakeLists.includes("Missing"));

        assert.deepEqual((await generateProject(folder)).written, [], "nothing changed, so nothing is written");

        //A C# platform builds the shared library its binding loads.
        writeFileSync(path.join(folder, "Project.bechaml"), project.replace("<Language Name=\"C++\" Standard=\"23\"/>", "<Language Name=\"C#\" Standard=\"12\"/>"));
        assert.equal((await generateProject(folder)).written.length, 1);
        assert.ok(readFileSync(path.join(folder, "source", "generated", "Project.cmake"), "utf8").includes("    set(ROUX_DYNLIB ON)\n    set(LANG \"CSharp\")"));
    }
    finally
    {
        rmSync(folder, { recursive: true, force: true });
    }
});

test("writes nothing while Project.bechaml or CMakeLists.txt has an error, and says where", async () =>
{
    const folder = mkdtempSync(path.join(os.tmpdir(), "roux-generate-"));

    try
    {
        const project = newProjectText("App", "Linux");
        writeFileSync(path.join(folder, "Project.bechaml"), project.replace("<Version>\"0.1.0\"</Version>", "<Version>\"1.0\"</Version>"));

        const badVersion = await generateProject(folder);
        assert.deepEqual(badVersion.problems.map(problem => [problem.line, problem.column, problem.message]), [[4, 5, "<Version>: Needs three numbers: major.minor.patch (0.1.0)."]]);
        assert.deepEqual(badVersion.written, []);

        writeFileSync(path.join(folder, "Project.bechaml"), project);
        writeFileSync(path.join(folder, "CMakeLists.txt"), newCMakeListsText([{ name: "project", description: "", lines: [] }]).replace("# <<< Roux", "#<!--\n# <<< Roux"));

        const badRegions = await generateProject(folder);
        assert.equal(badRegions.problems[0]?.file, path.join(folder, "CMakeLists.txt"));
        assert.equal(badRegions.problems[0]?.message, "A region marker is inside the kept block of line 5, which needs its #--> first.");
        assert.deepEqual(badRegions.written, [], "not even Project.cmake");
    }
    finally
    {
        rmSync(folder, { recursive: true, force: true });
    }
});

test("writes the ticked compiler flags for MSVC-like and GCC-like compilers, and none for other languages", () =>
{
    const values = readProject(parseBechaml(newProjectText("App", "Windows"))).values;
    const files = { sources: [], includeDirectories: [], assetFolders: [] };
    const flagged = { language: "C++", standard: "23", compiler: "MSVC", compilerFlags: ["Wall", "Wextra", "Wshadow", "Werror"] };

    const cpp = projectCMakeText({ ...values, platformSettings: { Windows: flagged } }, files);
    assert.ok(cpp.includes("    set(ROUX_COMPILE_OPTIONS_MSVC /W4 /WX)\n    set(ROUX_COMPILE_OPTIONS_GNU -Wall -Wextra -Wshadow -Werror)"));
    assert.ok(cpp.includes("if(CMAKE_CXX_COMPILER_FRONTEND_VARIANT STREQUAL \"MSVC\")\n    set(ROUX_COMPILE_OPTIONS ${ROUX_COMPILE_OPTIONS_MSVC})"));

    const csharp = projectCMakeText({ ...values, platformSettings: { Windows: { ...flagged, language: "C#", standard: "12" } } }, files);
    assert.ok(csharp.includes("    set(ROUX_COMPILE_OPTIONS_MSVC )\n    set(ROUX_COMPILE_OPTIONS_GNU )"));

    const regions = cmakeRegions(values, files);
    assert.ok(regions.find(region => "target" === region.name)?.lines.includes("target_compile_options(\"App\" PRIVATE ${ROUX_COMPILE_OPTIONS})"));
    assert.deepEqual(regions.find(region => "library" === region.name)?.lines.slice(1, 3), ["add_compile_options(${ROUX_COMPILE_OPTIONS})", "add_subdirectory(\"${CMAKE_CURRENT_SOURCE_DIR}/RetroFuturaGUI\")"]);
});

test("copies the assets in a target of their own, on every build after the program, not only when the program links", () =>
{
    const values = readProject(parseBechaml(newProjectText("App", "Windows"))).values;
    const lines = cmakeRegions(values, { sources: [], includeDirectories: [], assetFolders: ["Resources"] }).find(region => "assets" === region.name)?.lines ?? [];

    assert.ok(!lines.some(line => line.includes("POST_BUILD")));
    assert.ok(lines.includes("add_custom_target(\"AppAssets\" ALL"));
    assert.ok(lines.includes("add_dependencies(\"AppAssets\" \"App\")"));
    assert.ok(lines.includes("    set(ROUX_COPY_DIRECTORY copy_directory_if_different)"));
    assert.deepEqual(lines.filter(line => line.includes("$<TARGET_FILE_DIR:App>")),
    [
        "        \"$<TARGET_FILE_DIR:App>/ShaderSource\"",
        "        \"$<TARGET_FILE_DIR:App>/Resources\"",
        "        \"$<TARGET_FILE_DIR:App>/Assets\""
    ]);
});

test("tells whether Generate has to run: after a change of what it reads, or when what it wrote is gone", async () =>
{
    const folder = mkdtempSync(path.join(os.tmpdir(), "roux-generate-need-"));

    try
    {
        assert.equal(await generateNeed(folder), "noProject");

        writeFileSync(path.join(folder, "Project.bechaml"), newProjectText("App", "Linux"));
        assert.equal(await generateNeed(folder), "changed", "never generated");

        await generateProject(folder);
        assert.equal(await generateNeed(folder), "unchanged");
        assert.ok(readFileSync(path.join(folder, "source", "generated", ".roux-inputs.json"), "utf8").includes("\"CMakeLists.txt\": \""));

        writeFileSync(path.join(folder, "CMakeLists.txt"), readFileSync(path.join(folder, "CMakeLists.txt"), "utf8") + "message(STATUS \"mine\")\n");
        assert.equal(await generateNeed(folder), "changed", "the project's own lines changed");

        await generateProject(folder);
        rmSync(path.join(folder, "source", "generated", "Project.cmake"));
        assert.equal(await generateNeed(folder), "changed", "Project.cmake is gone");
    }
    finally
    {
        rmSync(folder, { recursive: true, force: true });
    }
});
