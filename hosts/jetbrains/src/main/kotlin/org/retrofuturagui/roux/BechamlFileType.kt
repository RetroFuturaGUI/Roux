package org.retrofuturagui.roux

import com.intellij.openapi.fileTypes.LanguageFileType
import javax.swing.Icon

object BechamlFileType : LanguageFileType(BechamlLanguage)
{
    override fun getName(): String = "Bechaml"

    override fun getDescription(): String = ".bechaml configuration file"

    override fun getDefaultExtension(): String = "bechaml"

    override fun getIcon(): Icon? = null
}