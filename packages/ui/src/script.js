function openTab(evt, tabItem)
{
    var i, tabcontent, tablinks;
    tabcontent = document.getElementsByClassName("tabcontent");

    for (i = 0; i < tabcontent.length; ++i)
    {
        tabcontent[i].style.display = "none";
    }

    tablinks = document.getElementsByClassName("tablinks");

    for (i = 0; i < tablinks.length; ++i)
    {
        tablinks[i].className = tablinks[i].className.replace(" active", "");
    }

    document.getElementById(tabItem).style.display = "block";
    evt.currentTarget.className += " active";
}

//Listeners instead of onclick and onsubmit attributes: the page's Content Security Policy runs no inline script.
for (const tablink of document.getElementsByClassName("tablinks"))
    tablink.addEventListener("click", event => openTab(event, tablink.dataset.tab));

for (const form of document.querySelectorAll("form"))
    form.addEventListener("submit", event => event.preventDefault());

//Marks a field invalid while its input doesn't match its data-pattern, with data-message under it.
function validateField(input)
{
    const field = input.closest(".field");
    const isValid = new RegExp(input.dataset.pattern).test(input.value);
    let message = field.querySelector(".message");

    field.classList.toggle("invalid", !isValid);

    if (isValid)
    {
        if (message)
            message.remove();

        return;
    }

    if (!message)
    {
        message = document.createElement("span");
        message.className = "message";
        field.appendChild(message);
    }

    message.textContent = input.dataset.message;
}

//Fake data: what each platform offers, and what Setup would find on this computer (a Windows PC with Visual Studio 2022,
//Clang 20, .NET SDK 9, Python 3.12 and 3.14, Rust 1.85). A compiler that isn't installed is listed grayed out. "Elsewhere"
//means it can only be found on that platform itself (Linux, macOS), so nothing is grayed out for it here.
const platforms =
{
    "Windows":
    {
        languages: ["C++", "C", "C#", "Python", "Rust"],
        compilers:
        [
            { name: "MSVC 19.44 (Visual Studio 2022 Community)", family: "MSVC", installed: true },
            { name: "clang-cl 19.1 (bundled with Visual Studio)", family: "clang-cl", installed: true },
            { name: "Clang 20.1 (LLVM)", family: "Clang", installed: true },
            { name: "GCC 14.2 (MinGW-w64)", family: "GCC", installed: false }
        ]
    },
    "Linux":
    {
        languages: ["C++", "C", "C#", "Python", "Rust"],
        compilers:
        [
            { name: "GCC", family: "GCC", elsewhere: "found when building on Linux" },
            { name: "Clang", family: "Clang", elsewhere: "found when building on Linux" }
        ]
    }/*,
    "macOS":
    {
        languages: ["C++", "C", "C#", "Python", "Rust"],
        compilers: [{ name: "Apple Clang (Xcode)", family: "Clang", elsewhere: "found when building on macOS" }]
    },
    "Android":
    {
        languages: ["C++", "C"],
        compilers: [{ name: "Clang (Android NDK)", family: "Clang", installed: false }]
    },
    "GameCube":
    {
        staticOnly: true,
        languages: ["C++", "C"],
        compilers: [{ name: "devkitPPC (GCC, devkitPro)", family: "GCC", installed: false }]
    },
    "Wii":
    {
        staticOnly: true,
        languages: ["C++", "C"],
        compilers: [{ name: "devkitPPC (GCC, devkitPro)", family: "GCC", installed: false }]
    },
    "WiiU":
    {
        staticOnly: true,
        languages: ["C++", "C"],
        compilers: [{ name: "devkitPPC (GCC, devkitPro)", family: "GCC", installed: false }]
    },
    "Nintendo3DS":
    {
        staticOnly: true,
        languages: ["C++", "C"],
        compilers: [{ name: "devkitARM (GCC, devkitPro)", family: "GCC", installed: false }]
    },
    "Switch":
    {
        staticOnly: true,
        languages: ["C++", "C"],
        compilers: [{ name: "devkitA64 (GCC, devkitPro)", family: "GCC", installed: false }]
    },
    "Xbox":
    {
        languages: ["C++", "C"],
        compilers: [{ name: "MSVC (Microsoft GDK)", family: "MSVC", installed: false }]
    },
    "Dreamcast":
    {
        staticOnly: true,
        languages: ["C++", "C"],
        compilers: [{ name: "GCC (KallistiOS)", family: "GCC", installed: false }]
    },
    "PS2":
    {
        staticOnly: true,
        languages: ["C++", "C"],
        compilers: [{ name: "GCC (ps2sdk)", family: "GCC", installed: false }]
    }*/
};

//What each compiler family can build. Missing: no switch for that standard at all. Latest: only through the compiler's
//switch for its newest draft features, which may change with compiler updates.
const compilerSupport =
{
    "MSVC":
    {
        "C++": { missing: ["98", "03", "11"], latest: ["26"], latestSwitch: "/std:c++latest" },
        "C": { missing: ["89", "99"], latest: ["23"], latestSwitch: "/std:clatest" }
    },
    "clang-cl":
    {
        "C++": { missing: ["98", "03", "11"], latest: ["26"], latestSwitch: "/std:c++latest" },
        "C": { missing: ["89", "99"], latest: ["23"], latestSwitch: "/std:clatest" }
    },
    "Clang":
    {
        "C++": { missing: [], latest: ["26"], latestSwitch: "-std=c++2c" },
        "C": { missing: [], latest: [], latestSwitch: "" }
    },
    "GCC":
    {
        "C++": { missing: [], latest: ["26"], latestSwitch: "-std=c++26" },
        "C": { missing: [], latest: [], latestSwitch: "" }
    }
};

//The standards each language offers, oldest first.
const languageStandards =
{
    "C++": ["98", "03", "11", "14", "17", "20", "23", "26"],
    "C": ["89", "99", "11", "17", "23"],
    "C#": ["7.3", "8", "9", "10", "11", "12", "13"],
    "Python": ["3.8", "3.9", "3.10", "3.11", "3.12", "3.13", "3.14"],
    "Rust": ["2015", "2018", "2021", "2024"]
};

//The Python versions Setup found. null while Setup doesn't look for them yet, so none is grayed out (project.js).
let installedPython = ["3.12", "3.14"];

//What each platform is set to; filled the first time a platform is shown.
const platformSettings = {};

//The compiler flags offered as checkboxes, as compilers taking MSVC's options and the rest (GCC, Clang, the toolchains
//built on GCC) write them. Empty where a compiler has nothing like it, so it isn't offered there. The core's Catalog.ts
//has the same table.
const compilerFlagChoices =
[
    { name: "Wall", label: "Common warnings", msvc: "/W4", gnu: "-Wall" },
    { name: "Wextra", label: "Extra warnings", msvc: "", gnu: "-Wextra" },
    { name: "Wpedantic", label: "Strict ISO C and C++", msvc: "", gnu: "-Wpedantic" },
    { name: "Wshadow", label: "Shadowed names", msvc: "", gnu: "-Wshadow" },
    { name: "Wconversion", label: "Lossy conversions", msvc: "", gnu: "-Wconversion" },
    { name: "Werror", label: "Warnings are errors", msvc: "/WX", gnu: "-Werror" }
];

//The compilers that take MSVC's options.
const msvcLikeCompilers = ["MSVC", "clang-cl"];

//The languages CMake compiles, so the only ones the flags are for.
const flagLanguages = ["C++", "C"];

//A compiler that isn't installed here. One found only on its own platform (elsewhere), or one Setup doesn't look for yet
//(unknown), isn't counted as missing.
function isMissing(compiler)
{
    return !compiler.elsewhere && !compiler.unknown && !compiler.installed;
}

function compilerLabel(compiler)
{
    if (compiler.elsewhere)
        return compiler.name + "  (" + compiler.elsewhere + ")";

    if (isMissing(compiler))
        return compiler.name + "  (not installed)";

    return compiler.name;
}

//Whether a standard can be built with the compiler: a reason when it can't, and the switch when it's only reached through
//the compiler's latest (experimental) one.
function standardStatus(language, standard, compiler)
{
    if ("Python" == language)
        return { reason: !installedPython || installedPython.includes(standard) ? "" : "not installed", latestSwitch: "" };

    if ("C#" == language || "Rust" == language)
        return { reason: "", latestSwitch: "" };

    if (isMissing(compiler))
        return { reason: "compiler not installed", latestSwitch: "" };

    const support = compilerSupport[compiler.family][language];

    if (support.missing.includes(standard))
        return { reason: compiler.family + " has no switch for it", latestSwitch: "" };

    if (support.latest.includes(standard))
        return { reason: "", latestSwitch: support.latestSwitch };

    return { reason: "", latestSwitch: "" };
}

//What the chosen language and standard mean for how the app reaches the library. Platforms without shared libraries link
//the library and the app into one executable; the C interface is the same either way.
function standardHint(language, standard, status, platform)
{
    const missing = status.reason
        ? "Can't be built on this computer yet (" + status.reason + "). Setup offers what's missing. "
        : "";

    const latest = status.latestSwitch
        ? " Experimental: built with " + status.latestSwitch + ", the compiler's newest draft features, which may change with compiler updates."
        : "";

    if ("C++" == language && ["23", "26"].includes(standard))
        return missing + "The app includes the library's headers directly." + latest;

    const linking = platform.staticOnly
        ? "linked statically into one executable, since this platform has no shared libraries"
        : "as a shared library";

    if ("C++" == language)
        return missing + "Below C++23 the app can't include the library's headers: it uses the library through its C interface, " + linking + "." + latest;

    return missing + "The app uses the library through its C interface, " + linking + "." + latest;
}

function currentPlatform()
{
    return document.getElementById("project-platform").value;
}

function currentCompiler()
{
    const platform = platforms[currentPlatform()];
    return platform.compilers[document.getElementById("project-compiler").selectedIndex];
}

//Fills a select with options, grays out the ones flagged unavailable, and selects value when it's among them.
function fillSelect(select, entries, value)
{
    select.replaceChildren();

    for (const entry of entries)
    {
        const option = new Option(entry.label, entry.value);

        if (entry.unavailable)
            option.classList.add("unavailable");

        select.add(option);
    }

    if (entries.some(entry => entry.value == value))
        select.value = value;
}

function updateHints()
{
    const language = document.getElementById("project-language").value;
    const standardSelect = document.getElementById("project-standard");
    const compilerSelect = document.getElementById("project-compiler");
    const compiler = currentCompiler();
    const status = standardStatus(language, standardSelect.value, compiler);

    standardSelect.classList.toggle("unavailable", "" != status.reason);
    compilerSelect.classList.toggle("unavailable", isMissing(compiler));
    document.getElementById("project-standard-hint").textContent = standardHint(language, standardSelect.value, status, platforms[currentPlatform()]);
    document.getElementById("project-compiler-hint").textContent =
        "Builds the library and the generated code (always C++23) for this platform, and the app's own C and C++ code. The path of the chosen installation is saved for this computer (Machine.bechaml).";
    showFlags();
}

//The flags the platform's compiler has, ticked as the platform is set; none for a language CMake doesn't compile.
function showFlags()
{
    const settings = platformSettings[currentPlatform()];
    const compiler = currentCompiler();
    const kind = compiler && msvcLikeCompilers.includes(compiler.family) ? "msvc" : "gnu";
    const list = document.getElementById("project-flags");

    document.getElementById("project-flags-field").hidden = !flagLanguages.includes(settings.language);
    list.replaceChildren();

    for (const flag of compilerFlagChoices.filter(choice => choice[kind]))
    {
        const box = document.createElement("input");
        box.type = "checkbox";
        box.value = flag.name;
        box.checked = settings.compilerFlags.includes(flag.name);

        const code = document.createElement("code");
        code.textContent = flag[kind];

        const label = document.createElement("label");
        label.append(box, " " + flag.label + " ", code);
        list.append(label);
    }
}

//Lists every standard of the language; the ones this computer can't build are grayed out but can still be chosen. Keeps
//the platform's standard when it's still listed, else picks the newest stable one that can be built, else the newest
//experimental one, else the newest of all.
function fillStandards()
{
    const language = document.getElementById("project-language").value;
    const compiler = currentCompiler();
    const settings = platformSettings[currentPlatform()];
    let newestStable = "";
    let newestBuildable = "";

    const entries = languageStandards[language].map(standard =>
    {
        const status = standardStatus(language, standard, compiler);
        let label = standard;

        if (status.latestSwitch)
            label += "  (latest, experimental)";

        if (status.reason)
            label += "  (" + status.reason + ")";
        else
            newestBuildable = standard;

        if (!status.reason && !status.latestSwitch)
            newestStable = standard;

        return { label: label, value: standard, unavailable: "" != status.reason };
    });

    const standards = languageStandards[language];
    const kept = standards.includes(settings.standard) ? settings.standard : (newestStable || newestBuildable || standards[standards.length - 1]);
    fillSelect(document.getElementById("project-standard"), entries, kept);
    settings.standard = document.getElementById("project-standard").value;
    updateHints();
}

//Shows the chosen platform: only its languages and compilers, set to what the platform was set to before.
function showPlatform()
{
    const name = currentPlatform();
    const platform = platforms[name];

    if (!platformSettings[name])
        platformSettings[name] = { language: platform.languages[0], standard: "", compiler: 0, compilerFlags: [] };

    const settings = platformSettings[name];

    fillSelect(document.getElementById("project-language"),
        platform.languages.map(language => ({ label: language, value: language })), settings.language);
    fillSelect(document.getElementById("project-compiler"),
        platform.compilers.map((compiler, index) => ({ label: compilerLabel(compiler), value: String(index), unavailable: isMissing(compiler) })),
        String(settings.compiler));
    fillStandards();
}

//Lists the ticked platforms in the platform select, keeping the shown one when it's still ticked.
function fillPlatforms()
{
    const select = document.getElementById("project-platform");
    const shown = select.value;
    const ticked = [...document.querySelectorAll("#project-platforms input:checked")].map(input => input.value);
    const disabled = 0 == ticked.length;

    fillSelect(select, ticked.map(name => ({ label: name, value: name })), shown);

    for (const id of ["project-platform", "project-language", "project-standard", "project-compiler"])
        document.getElementById(id).disabled = disabled;

    if (disabled)
    {
        for (const id of ["project-language", "project-standard", "project-compiler"])
            document.getElementById(id).replaceChildren();

        document.getElementById("project-standard-hint").textContent = "Tick a platform above first.";
        document.getElementById("project-compiler-hint").textContent = "";
        document.getElementById("project-flags").replaceChildren();
        return;
    }

    showPlatform();
}

for (const input of document.querySelectorAll("input[data-pattern]"))
{
    input.addEventListener("input", () => validateField(input));
    validateField(input);
}

for (const input of document.querySelectorAll("#project-platforms input"))
    input.addEventListener("change", fillPlatforms);

document.getElementById("project-platform").addEventListener("change", showPlatform);

document.getElementById("project-language").addEventListener("change", () =>
{
    const settings = platformSettings[currentPlatform()];
    settings.language = document.getElementById("project-language").value;
    settings.standard = ""; //a new language starts from its newest buildable standard.
    fillStandards();
});

document.getElementById("project-standard").addEventListener("change", () =>
{
    platformSettings[currentPlatform()].standard = document.getElementById("project-standard").value;
    updateHints();
});

document.getElementById("project-compiler").addEventListener("change", () =>
{
    platformSettings[currentPlatform()].compiler = document.getElementById("project-compiler").selectedIndex;
    fillStandards();
});

//A flag the compiler doesn't offer stays as it was, so switching compilers back finds it again.
document.getElementById("project-flags").addEventListener("change", () =>
{
    const settings = platformSettings[currentPlatform()];
    const boxes = [...document.querySelectorAll("#project-flags input")];
    const shown = boxes.map(box => box.value);
    const ticked = boxes.filter(box => box.checked).map(box => box.value);
    settings.compilerFlags = compilerFlagChoices.map(choice => choice.name).filter(name => ticked.includes(name) || (!shown.includes(name) && settings.compilerFlags.includes(name)));
});

fillPlatforms();

document.getElementsByClassName("tablinks")[0].click(); //opens the first tab once the page is there.
