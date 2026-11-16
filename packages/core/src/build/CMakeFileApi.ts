import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

//CMake's file API: a query file in the build folder asks CMake to describe its targets on every configure, so Roux reads
//where the program is instead of guessing the path. Roux's query is its own client folder, so it leaves others' alone
const clientFolder = path.join(".cmake", "api", "v1", "query", "client-roux");

export async function writeCodeModelQuery(buildFolder: string): Promise<void>
{
    await mkdir(path.join(buildFolder, clientFolder), { recursive: true });
    await writeFile(path.join(buildFolder, clientFolder, "codemodel-v2"), "");
}

interface TargetReference
{
    name: string;
    jsonFile: string;
}

//The executable to run: the target named like the project, else the first executable defined in the project's own
//CMakeLists.txt (not in a subfolder such as RetroFuturaGUI's). Undefined when there's none, or nothing was configured
export async function findExecutable(buildFolder: string): Promise<{ name: string; file: string } | undefined>
{
    const replyFolder = path.join(buildFolder, ".cmake", "api", "v1", "reply");
    const index = (await readdir(replyFolder).catch(() => [] as string[])).filter(name => /^index-.*\.json$/.test(name)).sort().pop();

    if (!index)
        return undefined;

    const read = async (name: string) => JSON.parse(await readFile(path.join(replyFolder, name), "utf8")) as Record<string, unknown>;

    try
    {
        const reply = (await read(index)).reply as Record<string, Record<string, { jsonFile?: string }>> | undefined;
        const codeModelFile = reply?.["client-roux"]?.["codemodel-v2"]?.jsonFile;

        if (!codeModelFile)
            return undefined;

        const codeModel = await read(codeModelFile) as { configurations?: { projects?: { name?: string }[]; targets?: TargetReference[] }[] };
        const configuration = codeModel.configurations?.[0];
        const projectName = configuration?.projects?.[0]?.name;
        const executables: { name: string; file: string; isTopLevel: boolean }[] = [];

        for (const reference of configuration?.targets ?? [])
        {
            const target = await read(reference.jsonFile) as { type?: string; artifacts?: { path: string }[]; paths?: { source?: string } };
            const artifact = target.artifacts?.find(entry => /\.exe$/i.test(entry.path)) ?? target.artifacts?.[0];

            if ("EXECUTABLE" === target.type && artifact)
                executables.push({ name: reference.name, file: path.resolve(buildFolder, artifact.path), isTopLevel: "." === target.paths?.source });
        }

        const chosen = executables.find(entry => entry.name === projectName) ?? executables.find(entry => entry.isTopLevel);
        return chosen ? { name: chosen.name, file: chosen.file } : undefined;
    }
    catch
    {
        return undefined;
    }
}