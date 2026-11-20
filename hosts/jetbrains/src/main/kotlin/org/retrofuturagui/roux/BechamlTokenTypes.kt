package org.retrofuturagui.roux

import com.intellij.psi.tree.IElementType
import com.intellij.psi.TokenType

object BechamlTokenTypes
{
    @JvmField val TAG_DELIMITER = IElementType("BECHAML_TAG_DELIMITER", BechamlLanguage)
    @JvmField val TAG_NAME = IElementType("BECHAML_TAG_NAME", BechamlLanguage)
    @JvmField val ATTRIBUTE_NAME = IElementType("BECHAML_ATTRIBUTE_NAME", BechamlLanguage)
    @JvmField val COMMENT = IElementType("BECHAML_COMMENT", BechamlLanguage)
    @JvmField val STRING = IElementType("BECHAML_STRING", BechamlLanguage)
    @JvmField val NUMBER = IElementType("BECHAML_NUMBER", BechamlLanguage)
    @JvmField val COLOR = IElementType("BECHAML_COLOR", BechamlLanguage)
    @JvmField val BOOLEAN = IElementType("BECHAML_BOOLEAN", BechamlLanguage)
    @JvmField val REFERENCE = IElementType("BECHAML_REFERENCE", BechamlLanguage)
    @JvmField val LIST_DELIMITER = IElementType("BECHAML_LIST_DELIMITER", BechamlLanguage)
    @JvmField val COMMA = IElementType("BECHAML_COMMA", BechamlLanguage)
    @JvmField val EQUALS = IElementType("BECHAML_EQUALS", BechamlLanguage)
    @JvmField val TEXT = IElementType("BECHAML_TEXT", BechamlLanguage)
    @JvmField val WHITESPACE = TokenType.WHITE_SPACE
    @JvmField val BAD_CHARACTER = TokenType.BAD_CHARACTER
}