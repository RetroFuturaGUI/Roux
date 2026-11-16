import { execFile } from "node:child_process";

//Runs a program and returns what it printed, or undefined when it can't start, fails or takes longer than timeoutMs. A
//file that isn't a program at all (a broken or empty executable) makes execFile throw rather than fail, so that's caught
//too. stdin is closed at once, so a program waiting for input ends instead of running into the timeout
export function runProcess(file: string, args: string[], timeoutMs = 15000): Promise<string | undefined>
{
    return new Promise(resolve =>
    {
        try
        {
            const child = execFile(file, args, { timeout: timeoutMs, windowsHide: true, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }, (error, stdout) =>
            {
                resolve(error ? undefined : stdout);
            });

            child.stdin?.end();
        }
        catch
        {
            resolve(undefined);
        }
    });
}
