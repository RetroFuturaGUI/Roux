package org.retrofuturagui.roux

import com.intellij.openapi.components.service
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.fileEditor.FileEditorProvider
import com.intellij.openapi.fileEditor.FileEditorState
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.UserDataHolderBase
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.testFramework.LightVirtualFile
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery
import java.beans.PropertyChangeListener
import java.nio.file.Files
import javax.swing.JComponent

//The tab's file: nothing on disk, only what the editor below shows
class RouxVirtualFile : LightVirtualFile("Roux")

class RouxEditorProvider : FileEditorProvider, DumbAware
{
    override fun accept(project: Project, file: VirtualFile): Boolean = file is RouxVirtualFile

    override fun createEditor(project: Project, file: VirtualFile): FileEditor = RouxEditor(project, file)

    override fun getEditorTypeId(): String = "roux"

    override fun getPolicy(): FileEditorPolicy = FileEditorPolicy.HIDE_DEFAULT_EDITOR
}

//Roux's UI in the IDE's browser (JCEF). The page sends through a JS query, which is defined as window.rouxJetBrains.send
//before the page's scripts run, and the core's lines reach it through window.rouxJetBrains.receive
class RouxEditor(project: Project, private val file: VirtualFile) : UserDataHolderBase(), FileEditor
{
    private val browser = JBCefBrowser()
    private val query = JBCefJSQuery.create(browser as JBCefBrowserBase)

    init
    {
        Disposer.register(this, browser)
        Disposer.register(this, query)

        val core = project.service<RouxCore>()
        query.addHandler { text ->
            core.send(text)
            null
        }
        core.addListener({ line -> browser.cefBrowser.executeJavaScript("window.rouxJetBrains && window.rouxJetBrains.receive($line);", browser.cefBrowser.url, 0) }, this)

        val folder = core.rouxFolder

        if (null == folder)
        {
            browser.loadHTML("<p style=\"font-family: sans-serif\">Roux wasn't found: this project needs Roux as its submodule in <code>Roux/</code>, built with <code>npm install</code> and <code>npm run build</code>.</p>")
        }
        else
        {
            val page = folder.resolve("packages/ui/src/index.html")
            val channel = "<script>window.rouxJetBrains = { send: function (text) { ${query.inject("text")} } };</script>"
            browser.loadHTML(Files.readString(page).replaceFirst("<head>", "<head>\n        $channel"), page.toUri().toString())
        }
    }

    override fun getComponent(): JComponent = browser.component

    override fun getPreferredFocusedComponent(): JComponent = browser.component

    override fun getName(): String = "Roux"

    override fun getFile(): VirtualFile = file

    override fun setState(state: FileEditorState) {}

    override fun isModified(): Boolean = false

    override fun isValid(): Boolean = true

    override fun addPropertyChangeListener(listener: PropertyChangeListener) {}

    override fun removePropertyChangeListener(listener: PropertyChangeListener) {}

    override fun dispose() {}
}
