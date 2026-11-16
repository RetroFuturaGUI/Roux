//What the Project and App tabs may write: the platforms of the roadmap, their languages and compilers, and the names the
//App Settings know. The UI offers a part of it (the platforms the library supports so far); the core checks against all of it

//Each one is also the element name of the platform's block, so it holds no spaces and doesn't start with a digit
export const platformNames = ["Windows", "Linux", "macOS", "Android", "GameCube", "Wii", "WiiU", "Nintendo3DS", "Switch", "Xbox", "Dreamcast", "PS2"];

//Groups App Settings can give values to at once. A platform's own block comes before its group's
export const platformGroups: Record<string, readonly string[]> =
{
    "Desktop": ["Windows", "Linux", "macOS"],
    "Nintendo": ["GameCube", "Wii", "WiiU", "Nintendo3DS", "Switch"]
};

//Every standard of each language, oldest first. Old ones stay, for legacy projects
export const languageStandards: Record<string, readonly string[]> =
{
    "C++": ["98", "03", "11", "14", "17", "20", "23", "26"],
    "C": ["89", "99", "11", "17", "23"],
    "C#": ["7.3", "8", "9", "10", "11", "12", "13"],
    "Python": ["3.8", "3.9", "3.10", "3.11", "3.12", "3.13", "3.14"],
    "Rust": ["2015", "2018", "2021", "2024"]
};

const desktopLanguages = ["C++", "C", "C#", "Python", "Rust"];
const consoleLanguages = ["C++", "C"];

export const platformLanguages: Record<string, readonly string[]> =
{
    "Windows": desktopLanguages,
    "Linux": desktopLanguages,
    "macOS": desktopLanguages,
    "Android": consoleLanguages,
    "GameCube": consoleLanguages,
    "Wii": consoleLanguages,
    "WiiU": consoleLanguages,
    "Nintendo3DS": consoleLanguages,
    "Switch": consoleLanguages,
    "Xbox": consoleLanguages,
    "Dreamcast": consoleLanguages,
    "PS2": consoleLanguages
};

//Compiler families per platform, the default first. The installation's path is the computer's, so it isn't kept here
export const platformCompilers: Record<string, readonly string[]> =
{
    "Windows": ["MSVC", "clang-cl", "Clang", "GCC"],
    "Linux": ["GCC", "Clang"],
    "macOS": ["Clang"],
    "Android": ["Clang"],
    "GameCube": ["devkitPPC"],
    "Wii": ["devkitPPC"],
    "WiiU": ["devkitPPC"],
    "Nintendo3DS": ["devkitARM"],
    "Switch": ["devkitA64"],
    "Xbox": ["MSVC"],
    "Dreamcast": ["KallistiOS"],
    "PS2": ["ps2sdk"]
};

//The compiler flags the Project tab offers as checkboxes, by the names Project.bechaml keeps (GCC's, without the dash).
//Each one is written for compilers taking MSVC's options (MSVC, clang-cl) and for the rest (GCC, Clang and the toolchains
//built on GCC). Empty where a compiler has nothing like it, so the flag is left out there: MSVC's /W4 already warns
//about shadowed names and lossy conversions
export const compilerFlags: Record<string, { readonly msvc: readonly string[]; readonly gnu: readonly string[] }> =
{
    "Wall": { msvc: ["/W4"], gnu: ["-Wall"] },
    "Wextra": { msvc: [], gnu: ["-Wextra"] },
    "Wpedantic": { msvc: [], gnu: ["-Wpedantic"] },
    "Wshadow": { msvc: [], gnu: ["-Wshadow"] },
    "Wconversion": { msvc: [], gnu: ["-Wconversion"] },
    "Werror": { msvc: ["/WX"], gnu: ["-Werror"] }
};

//The languages CMake compiles, so the only ones compiler flags are for. C#, Python and Rust leave them out
export const flagLanguages = ["C++", "C"];

export const featureNames =["Video", "Audio", "TrackerModules", "Models"];

export const capabilityNames = ["MultiWindow", "FileSystem", "Mouse", "Keyboard", "Touch", "Gamepad"];

//The platform this computer builds for without cross-compiling.
export function hostPlatform(platform: NodeJS.Platform): string
{
    return "win32" === platform ? "Windows" : "darwin" === platform ? "macOS" : "Linux";
}
