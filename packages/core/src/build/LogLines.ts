import path from "node:path";
import type { LogLine } from "@retrofuturagui/roux-protocol";

//MSVC and the tools that follow it: "C:\src\a.cpp(12,5): error C2039: ...", "a.cpp(12): warning C4100: ...".
const msvcExpression = /^\s*(.+?)\((\d+)(?:,(\d+))?\)\s*:\s*(fatal error|error|warning)(?:\s+[A-Z]+\d+)?\s*:/i;
//GCC and Clang: "src/a.cpp:12:5: error: ...".
const gccExpression = /^\s*(.+?):(\d+):(\d+):\s*(fatal error|error|warning):/i;
//CMake: "CMake Error at CMakeLists.txt:19 (message):", "CMake Warning (dev) at ...".
const cmakeExpression = /^CMake (Error|Warning)(?: \(dev\))? at (.+?):(\d+)/;
//What fails without a file: "LINK : fatal error LNK1168", "ninja: build stopped", "FAILED: ...", "CMake Error: ...".
const plainErrorExpression = /^(?:LINK : fatal error|ninja: build stopped|FAILED:|CMake Error|ninja: error|error:)/;

//Reads a line of output. Whether it's an error or a warning, and the file it names, made absolute against folder (CMake
//names files relative to the source folder, the compilers mostly absolute)
export function readLogLine(text: string, folder: string): LogLine
{
    const msvc = msvcExpression.exec(text);
    const gcc = msvc ? null : gccExpression.exec(text);
    const compiler = msvc ?? gcc;

    if (compiler?.[1] && compiler[2] && compiler[4])
        return located(text, compiler[4].toLowerCase().includes("error") ? "error" : "warning", folder, compiler[1], compiler[2], compiler[3]);

    const cmake = cmakeExpression.exec(text);

    if (cmake?.[1] && cmake[2] && cmake[3])
        return located(text, "Error" === cmake[1] ? "error" : "warning", folder, cmake[2], cmake[3], undefined);

    if (plainErrorExpression.test(text))
        return { text: text, severity: "error" };

    return { text: text, severity: "" };
}

function located(text: string, severity: "error" | "warning", folder: string, file: string, line: string, column: string | undefined): LogLine
{
    return { text: text, severity: severity, location: { file: path.resolve(folder, file.trim()), line: Number(line), column: column ? Number(column) : 1 } };
}

//"2 errors, 1 warning". Empty when there are none
export function problemSummary(errors: number, warnings: number): string
{
    const parts: string[] = [];

    if (0 < errors)
        parts.push(errors + (1 === errors ? " error" : " errors"));

    if (0 < warnings)
        parts.push(warnings + (1 === warnings ? " warning" : " warnings"));

    return parts.join(", ");
}