package org.retrofuturagui.roux

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service
import com.intellij.openapi.project.DumbAware

//Tools > Roux, and the button in the main toolbar: opens Roux's tab.
class OpenRouxAction : AnAction(), DumbAware
{
    override fun actionPerformed(event: AnActionEvent)
    {
        event.project?.service<RouxCore>()?.open()
    }
}
