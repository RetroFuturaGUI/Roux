//The Build tab: Generate, Configure, Build and Run, one after another, each with its own output. A step that fails stops
//the ones after it. Opened as a file, it plays fake output, using the Project tab's platforms and settings (script.js).
//Served by Roux, the core runs the steps and its events fill the same views (the served parts at the end).

//Served by Roux: the target the core builds (platforms, build type, folder), else null.
let servedTarget = null;

//Fake data: output is played back line by line, as if it came from the processes.
const lineDelay = 40; //milliseconds between two lines.

//How a platform is configured: its toolchain (vcpkg's triplet on desktop, devkitPro's CMake files on its consoles), what
//runs the program, and whether the build goes through WSL when Roux runs on Windows (proposed).
const buildTargets =
{
    "Windows": { toolchain: "-DCMAKE_TOOLCHAIN_FILE=C:/vcpkg/scripts/buildsystems/vcpkg.cmake -DVCPKG_TARGET_TRIPLET=x64-windows", run: "{folder}/TestProject.exe", environment: "Using the Visual Studio 2022 environment (vcvars64, cached)" },
    "Linux": { toolchain: "-DCMAKE_TOOLCHAIN_FILE=$VCPKG_ROOT/scripts/buildsystems/vcpkg.cmake -DVCPKG_TARGET_TRIPLET=x64-linux", run: "{folder}/TestProject", environment: "Building in WSL (Ubuntu 24.04)", throughWsl: true },
    "macOS": { toolchain: "-DCMAKE_TOOLCHAIN_FILE=$VCPKG_ROOT/scripts/buildsystems/vcpkg.cmake -DVCPKG_TARGET_TRIPLET=arm64-osx", run: "{folder}/TestProject.app", unavailable: "macOS builds only on a Mac" },
    "Android": { toolchain: "-DCMAKE_TOOLCHAIN_FILE=$ANDROID_NDK/build/cmake/android.toolchain.cmake", run: "adb install {folder}/TestProject.apk" },
    "GameCube, Wii": { toolchain: "-DCMAKE_TOOLCHAIN_FILE=$DEVKITPRO/cmake/Wii.cmake", run: "wiiload {folder}/TestProject.dol" },
    "WiiU": { toolchain: "-DCMAKE_TOOLCHAIN_FILE=$DEVKITPRO/cmake/WiiU.cmake", run: "wiiload {folder}/TestProject.rpx" },
    "Nintendo3DS": { toolchain: "-DCMAKE_TOOLCHAIN_FILE=$DEVKITPRO/cmake/3DS.cmake", run: "3dslink {folder}/TestProject.3dsx" },
    "Switch": { toolchain: "-DCMAKE_TOOLCHAIN_FILE=$DEVKITPRO/cmake/Switch.cmake", run: "nxlink {folder}/TestProject.nro" },
    "Xbox": { toolchain: "(Microsoft GDK toolchain)", run: "(deploy to the console)" },
    "Dreamcast": { toolchain: "(KallistiOS toolchain)", run: "(send to the console or an emulator)" },
    "PS2": { toolchain: "(ps2sdk toolchain)", run: "(send to the console or an emulator)" }
};

const buildSteps =
[
    { id: "generate", name: "Generate" },
    { id: "configure", name: "Configure" },
    { id: "build", name: "Build" },
    { id: "run", name: "Run" }
];

//Per step: its state (idle, waiting, running, ok, failed, stopped), when it started and ended, its output and summary.
const stepStates = Object.fromEntries(buildSteps.map(step => [step.id, { state: "idle", started: 0, ended: 0, lines: [], summary: "" }]));

let shownStep = "generate";
let pendingTimer = 0;
let isRunning = false;

function buildFolder()
{
    if (servedTarget)
        return servedTarget.buildFolder;

    const platform = document.getElementById("build-platform").value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return "build/" + platform + "-" + document.getElementById("build-type").value.toLowerCase();
}

//The Project tab's language, standard and compiler for the platform; the first of each when it was never shown there.
function targetSettings(name)
{
    const platform = platforms[name];
    const settings = platformSettings[name] || { language: platform.languages[0], standard: "", compiler: 0 };
    const compiler = platform.compilers[settings.compiler] || platform.compilers[0];
    return { language: settings.language, standard: settings.standard, compiler: compiler };
}

function showTarget()
{
    const name = document.getElementById("build-platform").value;
    const hint = document.getElementById("build-target-hint");

    updateButtons();

    if (servedTarget)
    {
        hint.textContent = servedTarget.summary + (servedTarget.unavailable ? " · " + servedTarget.unavailable : "");
        return;
    }

    if (!name)
    {
        hint.textContent = "Tick a platform in the Project tab first.";
        return;
    }

    const target = targetSettings(name);
    const unavailable = buildTargets[name].unavailable;
    hint.textContent = name + " · " + [target.language, target.standard].filter(Boolean).join(" ") + " · " + target.compiler.name + " · " + buildFolder()
        + (unavailable ? " · " + unavailable : "");
}

//The output each step would print, for the chosen target.
function stepLines(id)
{
    const name = document.getElementById("build-platform").value;
    const target = targetSettings(name);
    const settings = buildTargets[name];
    const folder = buildFolder();
    const wsl = settings.throughWsl ? "wsl " : "";
    const fails = document.getElementById("build-fail").checked;

    if ("generate" == id)
    {
        return [
            "$ roux generate",
            "Read Project.bechaml, Project.user.bechaml and 8 files in Markup/",
            "Wrote source/generated/impl/Scenes/MainScene_setup.cpp",
            "Wrote source/generated/impl/Styles/Flavors.cpp",
            "Unchanged: 10 files",
            "Updated the region 'target' in CMakeLists.txt (1 source added)",
            { summary: "12 files, 2 changed" }
        ];
    }

    if ("configure" == id)
    {
        return [
            settings.environment || "",
            "$ " + wsl + "cmake -S . -B " + folder + " -G Ninja " + settings.toolchain + " -DCMAKE_BUILD_TYPE=" + document.getElementById("build-type").value,
            "-- The CXX compiler identification is " + target.compiler.name,
            "-- Found glfw3, glm, freetype, harfbuzz, lunasvg, FFMPEG",
            "-- Configuring done (2.1s)",
            "-- Generating done (0.3s)",
            "-- Build files have been written to: " + folder,
            { summary: "Ninja, " + target.compiler.family }
        ].filter(line => "" !== line);
    }

    if ("build" == id)
    {
        const lines = [
            "$ " + wsl + "cmake --build " + folder,
            "[1/24] Building CXX object RetroFuturaGUI/source/Styling/Flavor.cpp",
            "[2/24] Building CXX object source/generated/impl/Styles/Flavors.cpp",
            "[3/24] Building CXX object source/generated/impl/Scenes/MainScene_setup.cpp"
        ];

        if (fails)
        {
            return lines.concat([
                "Markup/Scenes/MainScene.bechaml(7,13): error C2039: 'SetColour': is not a member of 'RetroFuturaGUI::FlavorPart'",
                "source/code/MainScene.cpp(42,5): warning C4100: 'deltaTime': unreferenced parameter",
                "ninja: build stopped: subcommand failed.",
                { summary: "1 error, 1 warning", failed: true }
            ]);
        }

        return lines.concat([
            "[4/24] Building CXX object source/code/MainScene.cpp",
            "...",
            "[24/24] Linking CXX executable TestProject",
            { summary: "24 of 24, no warnings" }
        ]);
    }

    const command = ("C++" == target.language || "C" == target.language)
        ? settings.run.replace("{folder}", folder)
        : { "C#": "dotnet run --project source/code/CSharpProject", "Python": "python source/code/Python/MainWindow.py", "Rust": "cargo run --manifest-path source/code/RustProject/Cargo.toml" }[target.language];

    return [
        "$ " + wsl + command,
        "MainWindow opened (1280 × 720)",
        "Closed by the user",
        "Exited with code 0",
        { summary: "Exited with code 0" }
    ];
}

function stepIcon(state)
{
    return { idle: "○", waiting: "○", running: "●", ok: "✔", failed: "✖", stopped: "■", skipped: "–" }[state];
}

function formatSeconds(milliseconds)
{
    return (milliseconds / 1000).toFixed(1) + " s";
}

function showSteps()
{
    const list = document.getElementById("build-steps");

    list.replaceChildren(...buildSteps.map(step =>
    {
        const state = stepStates[step.id];
        const item = document.createElement("li");
        const button = document.createElement("button");
        const time = state.started ? formatSeconds((state.ended || performance.now()) - state.started) : "";

        item.className = state.state + (step.id == shownStep ? " shown" : "");
        button.type = "button";
        button.dataset.step = step.id;
        button.innerHTML = '<span class="status"></span><span class="name"></span><span class="time"></span><span class="summary"></span>';
        button.querySelector(".status").textContent = stepIcon(state.state);
        button.querySelector(".name").textContent = step.name;
        button.querySelector(".time").textContent = time;
        button.querySelector(".summary").textContent = "waiting" == state.state ? "waiting" : state.summary;
        item.append(button);
        return item;
    }));
}

//A log line that names file(line,column) becomes a link: the IDE opens the file there. Errors and warnings are colored.
//The core's lines come read already, with their severity and the file they name.
function logLine(text)
{
    if ("object" == typeof text)
        return servedLogLine(text);

    const line = document.createElement("div");
    const match = /^(.+?)\((\d+),(\d+)\): (error|warning)/.exec(text);

    if (!match)
    {
        line.textContent = text;
        return line;
    }

    const link = document.createElement("a");
    link.href = "#";
    link.textContent = match[1] + "(" + match[2] + "," + match[3] + ")";
    link.dataset.file = match[1];
    link.dataset.line = match[2];
    line.className = match[4];
    line.append(link, text.slice(link.textContent.length));
    return line;
}

function showLog()
{
    const step = buildSteps.find(each => each.id == shownStep);
    const log = document.getElementById("build-log");

    document.getElementById("build-log-title").textContent = "Output: " + step.name;
    log.replaceChildren(...stepStates[shownStep].lines.map(logLine));
    log.scrollTop = log.scrollHeight;
}

//Stop only while running; nothing else then. Without a ticked platform nothing runs; a target this computer can't build
//(macOS on a PC) only generates.
function updateButtons()
{
    const name = servedTarget ? servedTarget.platform : document.getElementById("build-platform").value;
    const unavailable = !name || Boolean(servedTarget ? servedTarget.unavailable : buildTargets[name].unavailable);

    for (const button of document.querySelectorAll("#build-form .build-actions button"))
    {
        if ("build-stop" == button.id)
            button.disabled = !isRunning;
        else if (isRunning || !name)
            button.disabled = true;
        else
            button.disabled = unavailable && "generate" != button.dataset.steps && "build-clean" != button.id;
    }

    document.getElementById("build-platform").disabled = isRunning;
    document.getElementById("build-type").disabled = isRunning;
}

function setRunning(running)
{
    isRunning = running;
    updateButtons();
}

//Runs the steps one after another; a failed or stopped step leaves the rest waiting.
function runSteps(ids)
{
    if (servedTarget)
        return startServedSteps(ids);

    for (const id of ids)
        Object.assign(stepStates[id], { state: "waiting", started: 0, ended: 0, lines: [], summary: "" });

    document.getElementById("build-log-note").textContent = "";
    setRunning(true);
    runStep(ids, 0);
}

function runStep(ids, index)
{
    if (ids.length <= index)
    {
        setRunning(false);
        showSteps();
        return;
    }

    const id = ids[index];
    const state = stepStates[id];
    const lines = stepLines(id);

    Object.assign(state, { state: "running", started: performance.now() });
    shownStep = id;
    showSteps();
    showLog();

    let next = 0;

    const playLine = () =>
    {
        const line = lines[next++];

        if ("object" == typeof line)
        {
            Object.assign(state, { state: line.failed ? "failed" : "ok", ended: performance.now(), summary: line.summary });

            if (line.failed)
            {
                for (const rest of ids.slice(index + 1))
                    stepStates[rest].state = "idle";

                setRunning(false);
                showSteps();
                showLog();
                return;
            }

            runStep(ids, index + 1);
            return;
        }

        state.lines.push(line);
        showSteps();
        showLog();
        pendingTimer = setTimeout(playLine, lineDelay);
    };

    pendingTimer = setTimeout(playLine, lineDelay);
}

function stopSteps()
{
    if (servedTarget)
        return HostBridge.request("build.stop").catch(showBuildNote);

    clearTimeout(pendingTimer);

    for (const step of buildSteps)
    {
        const state = stepStates[step.id];

        if ("running" == state.state)
        {
            state.lines.push("Stopped.");
            Object.assign(state, { state: "stopped", ended: performance.now(), summary: "stopped" });
        }
        else if ("waiting" == state.state)
            state.state = "idle";
    }

    setRunning(false);
    showSteps();
    showLog();
}

function cleanBuild()
{
    if (servedTarget)
        return cleanServedBuild();

    for (const step of buildSteps)
        Object.assign(stepStates[step.id], { state: "idle", started: 0, ended: 0, lines: [], summary: "" });

    stepStates.generate.lines = ["Removed " + buildFolder() + " (the generated sources stay; Generate rewrites them anyway)"];
    shownStep = "generate";
    showSteps();
    showLog();
}

//Lists the platforms ticked in the Project tab, keeping the chosen one when it's still ticked.
function fillBuildPlatforms()
{
    const select = document.getElementById("build-platform");

    if (servedTarget)
    {
        select.replaceChildren(...servedTarget.platforms.map(name => new Option(name)));
        select.value = servedTarget.platform;
        document.getElementById("build-type").value = servedTarget.buildType;
        showTarget();
        return;
    }

    const chosen = select.value;
    const ticked = [...document.querySelectorAll("#project-platforms input:checked")].map(input => input.value);

    select.replaceChildren(...ticked.map(name => new Option(name)));

    if (ticked.includes(chosen))
        select.value = chosen;

    showTarget();
}

document.getElementById("build-form").addEventListener("click", event =>
{
    const button = event.target.closest("button");
    const link = event.target.closest("a[data-file]");

    if (link)
    {
        event.preventDefault();
        document.getElementById("build-log-note").textContent = servedTarget
            ? "Opens in the IDE once Roux runs inside one: " + link.dataset.file + ", line " + link.dataset.line + "."
            : "The IDE would open " + link.dataset.file + " at line " + link.dataset.line + ".";
        return;
    }

    if (!button)
        return;

    if (button.dataset.steps)
        runSteps(button.dataset.steps.split(" "));
    else if (button.dataset.step)
    {
        shownStep = button.dataset.step;
        showSteps();
        showLog();
    }
    else if ("build-stop" == button.id)
        stopSteps();
    else if ("build-clean" == button.id)
        cleanBuild();
});

document.getElementById("build-platform").addEventListener("change", showTarget);
document.getElementById("build-type").addEventListener("change", showTarget);

for (const input of document.querySelectorAll("#project-platforms input"))
    input.addEventListener("change", fillBuildPlatforms);

//The Project tab's language and compiler show in the target line when this tab is opened.
for (const tab of document.getElementsByClassName("tablinks"))
    tab.addEventListener("click", showTarget);

fillBuildPlatforms();
showSteps();
showLog();

//Served by Roux from here on: the core's steps and output replace the played-back ones.

function showBuildNote(message)
{
    document.getElementById("build-log-note").textContent = message instanceof Error ? "The core can't be reached: " + message.message : message;
}

//A line as the core read it: colored by its severity, the file it names a link.
function servedLogLine(entry)
{
    const line = document.createElement("div");
    line.className = entry.severity;

    if (!entry.location)
    {
        line.textContent = entry.text;
        return line;
    }

    const link = document.createElement("a");
    link.href = "#";
    link.textContent = entry.text;
    link.title = entry.location.file + ":" + entry.location.line + ":" + entry.location.column;
    link.dataset.file = entry.location.file;
    link.dataset.line = String(entry.location.line);
    line.append(link);
    return line;
}

//The core's times are the clock's; the views count from performance.now().
function sinceNow(time)
{
    return time ? performance.now() - (Date.now() - time) : 0;
}

function showServedState(state)
{
    const wasRunning = stepStates[shownStep].state;
    servedTarget = state.target;
    isRunning = state.isRunning;

    for (const step of state.steps)
        Object.assign(stepStates[step.step], { state: step.state, summary: step.summary, started: sinceNow(step.startedAt), ended: sinceNow(step.endedAt) });

    //The output follows the step that runs.
    const running = state.steps.find(step => "running" == step.state);

    if (running && running.step != shownStep)
    {
        shownStep = running.step;
        showLog();
    }
    else if ("running" == wasRunning && "running" != stepStates[shownStep].state)
    {
        showLog();
    }

    fillBuildPlatforms();
    showSteps();
}

//New lines go at the end of the log; it follows them only while it's scrolled to the bottom, so reading older ones works.
function appendServedLines(step, lines)
{
    stepStates[step].lines.push(...lines);

    if (step != shownStep)
        return;

    const log = document.getElementById("build-log");
    const isAtEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
    log.append(...lines.map(logLine));

    if (isAtEnd)
        log.scrollTop = log.scrollHeight;
}

async function startServedSteps(ids)
{
    showBuildNote("");

    try
    {
        const answer = await HostBridge.request("build.start", { steps: ids });

        if (!answer.isStarted)
            showBuildNote(answer.message);
    }
    catch (error)
    {
        showBuildNote(error);
    }
}

//Clean removes a build folder, which takes a whole build to make again, so it asks once more on the button itself.
let cleanTimer = 0;

async function cleanServedBuild()
{
    const button = document.getElementById("build-clean");

    if (!button.dataset.confirming)
    {
        button.dataset.confirming = "yes";
        button.textContent = "Remove " + buildFolder() + "?";
        cleanTimer = setTimeout(resetCleanButton, 5000);
        return;
    }

    resetCleanButton();

    try
    {
        const answer = await HostBridge.request("build.clean");

        for (const step of buildSteps)
            stepStates[step.id].lines = [];

        showServedState(answer.state);
        showLog();
        showBuildNote(answer.message);
    }
    catch (error)
    {
        showBuildNote(error);
    }
}

function resetCleanButton()
{
    clearTimeout(cleanTimer);
    const button = document.getElementById("build-clean");
    delete button.dataset.confirming;
    button.textContent = "Clean";
}

async function setServedTarget()
{
    try
    {
        const state = await HostBridge.request("build.setTarget",
            {
                platform: document.getElementById("build-platform").value,
                buildType: document.getElementById("build-type").value
            });

        for (const step of buildSteps)
            stepStates[step.id].lines = [];

        showServedState(state);
        showLog();
    }
    catch (error)
    {
        showBuildNote(error);
    }
}

async function loadServedBuild()
{
    try
    {
        const answer = await HostBridge.request("build.load");

        for (const step of buildSteps)
            stepStates[step.id].lines = answer.logs[step.id] ?? [];

        showServedState(answer.state);
        showLog();
    }
    catch (error)
    {
        showBuildNote(error);
    }
}

if (HostBridge.isAvailable)
{
    document.getElementById("build-fail").closest("label").hidden = true;

    HostBridge.onEvent("build.changed", showServedState);
    HostBridge.onEvent("build.log", event => appendServedLines(event.step, event.lines));
    document.getElementById("build-platform").addEventListener("change", setServedTarget);
    document.getElementById("build-type").addEventListener("change", setServedTarget);

    //The ticked platforms come from Project.bechaml, which the Project tab may have changed meanwhile.
    for (const tab of document.getElementsByClassName("tablinks"))
    {
        if ("Build" == tab.dataset.tab)
            tab.addEventListener("click", () => { if (!isRunning) loadServedBuild(); });
    }

    //A running step's time goes on.
    setInterval(() => { if (isRunning) showSteps(); }, 500);
    HostBridge.ready.then(loadServedBuild);
}
