package org.retrofuturagui.roux

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.CopyOnWriteArrayList

//Roux's core for one project: `roux core --stdio`, a Node process of its own, since a JetBrains IDE can't load Node code.
//Each JSON-RPC message is one line each way. It starts with the first message and lives as long as the project is open,
//so a build goes on while the tab is closed
@Service(Service.Level.PROJECT)
class RouxCore(private val project: Project) : Disposable
{
    private val log = logger<RouxCore>()
    private val listeners = CopyOnWriteArrayList<(String) -> Unit>()
    private val file = RouxVirtualFile()
    private var process: Process? = null

    //Roux as the project's submodule, built. Shipping its core with the plugin comes later.
    val rouxFolder: Path?
        get() = project.basePath?.let { Path.of(it, "Roux") }?.takeIf { Files.isRegularFile(it.resolve("cli/out/main.js")) }

    //One tab: opening Roux again brings it to the front.
    fun open()
    {
        FileEditorManager.getInstance(project).openFile(file, true)
    }

    //Gets every line the core writes until parent is disposed.
    fun addListener(listener: (String) -> Unit, parent: Disposable)
    {
        listeners += listener
        Disposer.register(parent) { listeners -= listener }
    }

    @Synchronized
    fun send(line: String)
    {
        val running = start() ?: return
        running.outputStream.write((line + "\n").toByteArray(Charsets.UTF_8))
        running.outputStream.flush()
    }

    @Synchronized
    private fun start(): Process?
    {
        process?.takeIf { it.isAlive }?.let { return it }

        val folder = rouxFolder ?: return null
        val basePath = project.basePath ?: return null
        val started = ProcessBuilder("node", folder.resolve("cli/out/main.js").toString(), "core", "--stdio", "--project", basePath)
            .directory(folder.toFile())
            .start()

        //Answers and events go to the tab; the core's diagnostics go to the IDE's log. A lambda passed to a call opens on
        //the call's line in Kotlin.
        ApplicationManager.getApplication().executeOnPooledThread {
            started.inputStream.bufferedReader(Charsets.UTF_8).forEachLine { line -> listeners.forEach { it(line) } }
        }
        ApplicationManager.getApplication().executeOnPooledThread {
            started.errorStream.bufferedReader(Charsets.UTF_8).forEachLine { line -> log.info("Roux core: $line") }
        }

        process = started
        return started
    }

    override fun dispose()
    {
        process?.destroy()
    }
}
