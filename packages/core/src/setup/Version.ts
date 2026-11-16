//Compares versions such as "3.31.2" and "4.0.0-rc1" part by part, numerically: below zero when left is older. Missing
//parts count as 0, and a pre-release comes before its release. Other suffixes name a vendor's build of the release
//(Visual Studio's CMake is "3.30.5-msvc23"), so they compare equal to it
export function compareVersions(left: string, right: string): number
{
    const [leftCore = "", leftPreRelease = ""] = splitPreRelease(left);
    const [rightCore = "", rightPreRelease = ""] = splitPreRelease(right);
    const leftParts = leftCore.split(".").map(part => Number.parseInt(part, 10) || 0);
    const rightParts = rightCore.split(".").map(part => Number.parseInt(part, 10) || 0);
    const partCount = Math.max(leftParts.length, rightParts.length);

    for (let index = 0; partCount > index; ++index)
    {
        const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);

        if (0 !== difference)
            return difference;
    }

    if (leftPreRelease === rightPreRelease)
        return 0;

    if (!leftPreRelease)
        return 1;

    if (!rightPreRelease)
        return -1;

    return leftPreRelease.localeCompare(rightPreRelease, "en", { numeric: true });
}

//Splits "4.0.0-rc1" into "4.0.0" and "rc1". A suffix that isn't a pre-release is dropped
function splitPreRelease(version: string): [string, string]
{
    const dash = version.indexOf("-");

    if (0 > dash)
        return [version, ""];

    const suffix = version.slice(dash + 1);
    return [version.slice(0, dash), /^(rc|alpha|beta|dev)/i.test(suffix) ? suffix : ""];
}