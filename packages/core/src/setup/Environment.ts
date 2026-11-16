import os from "node:os";

//What the checks read about this computer. Tests pass their own
export interface MachineEnvironment
{
    platform: NodeJS.Platform;
    variables: NodeJS.ProcessEnv;
    homeDirectory: string;
}

export function currentEnvironment(): MachineEnvironment
{
    return { platform: process.platform, variables: process.env, homeDirectory: os.homedir() };
}

//Reads an environment variable, or "" when it isn't set. On Windows the name's case doesn't matter, as there
export function variable(environment: MachineEnvironment, name: string): string
{
    const exact = environment.variables[name];

    if (undefined !== exact || "win32" !== environment.platform)
        return exact ?? "";

    const lowerName = name.toLowerCase();
    const key = Object.keys(environment.variables).find(candidate => candidate.toLowerCase() === lowerName);
    return key ? environment.variables[key] ?? "" : "";
}

//The PATH's folders in their order, without quotes and empty entries.
export function pathDirectories(environment: MachineEnvironment): string[]
{
    const separator = "win32" === environment.platform ? ";" : ":";

    return variable(environment, "PATH")
        .split(separator)
        .map(directory => directory.trim().replace(/^"(.*)"$/, "$1"))
        .filter(directory => "" !== directory);
}