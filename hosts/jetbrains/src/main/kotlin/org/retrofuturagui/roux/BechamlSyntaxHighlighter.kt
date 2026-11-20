package org.retrofuturagui.roux

import com.intellij.openapi.editor.DefaultLanguageHighlighterColors
import com.intellij.openapi.editor.HighlighterColors
import com.intellij.openapi.editor.colors.TextAttributesKey
import com.intellij.openapi.fileTypes.SyntaxHighlighter
import com.intellij.openapi.fileTypes.SyntaxHighlighterBase
import com.intellij.openapi.fileTypes.SyntaxHighlighterFactory
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.lexer.Lexer
import com.intellij.psi.tree.IElementType

object BechamlTextAttributes
{
    val TAG = TextAttributesKey.createTextAttributesKey("BECHAML_TAG", DefaultLanguageHighlighterColors.MARKUP_TAG)
    val ATTRIBUTE = TextAttributesKey.createTextAttributesKey("BECHAML_ATTRIBUTE", DefaultLanguageHighlighterColors.MARKUP_ATTRIBUTE)
    val COMMENT = TextAttributesKey.createTextAttributesKey("BECHAML_COMMENT", DefaultLanguageHighlighterColors.BLOCK_COMMENT)
    val STRING = TextAttributesKey.createTextAttributesKey("BECHAML_STRING", DefaultLanguageHighlighterColors.STRING)
    val NUMBER = TextAttributesKey.createTextAttributesKey("BECHAML_NUMBER", DefaultLanguageHighlighterColors.NUMBER)
    val COLOR = TextAttributesKey.createTextAttributesKey("BECHAML_COLOR", DefaultLanguageHighlighterColors.CONSTANT)
    val BOOLEAN = TextAttributesKey.createTextAttributesKey("BECHAML_BOOLEAN", DefaultLanguageHighlighterColors.KEYWORD)
    val REFERENCE = TextAttributesKey.createTextAttributesKey("BECHAML_REFERENCE", DefaultLanguageHighlighterColors.INSTANCE_FIELD)
    val DELIMITER = TextAttributesKey.createTextAttributesKey("BECHAML_DELIMITER", DefaultLanguageHighlighterColors.BRACES)
    val BAD_CHARACTER = TextAttributesKey.createTextAttributesKey("BECHAML_BAD_CHARACTER", HighlighterColors.BAD_CHARACTER)
}

class BechamlSyntaxHighlighter : SyntaxHighlighterBase()
{
    override fun getHighlightingLexer(): Lexer = BechamlLexer()

    override fun getTokenHighlights(tokenType: IElementType): Array<TextAttributesKey> = when (tokenType)
    {
        BechamlTokenTypes.TAG_NAME -> pack(BechamlTextAttributes.TAG)
        BechamlTokenTypes.ATTRIBUTE_NAME -> pack(BechamlTextAttributes.ATTRIBUTE)
        BechamlTokenTypes.COMMENT -> pack(BechamlTextAttributes.COMMENT)
        BechamlTokenTypes.STRING -> pack(BechamlTextAttributes.STRING)
        BechamlTokenTypes.NUMBER -> pack(BechamlTextAttributes.NUMBER)
        BechamlTokenTypes.COLOR -> pack(BechamlTextAttributes.COLOR)
        BechamlTokenTypes.BOOLEAN -> pack(BechamlTextAttributes.BOOLEAN)
        BechamlTokenTypes.REFERENCE -> pack(BechamlTextAttributes.REFERENCE)
        BechamlTokenTypes.TAG_DELIMITER,
        BechamlTokenTypes.LIST_DELIMITER,
        BechamlTokenTypes.COMMA,
        BechamlTokenTypes.EQUALS -> pack(BechamlTextAttributes.DELIMITER)
        BechamlTokenTypes.BAD_CHARACTER -> pack(BechamlTextAttributes.BAD_CHARACTER)
        else -> emptyArray()
    }
}

class BechamlSyntaxHighlighterFactory : SyntaxHighlighterFactory()
{
    override fun getSyntaxHighlighter(project: Project?, virtualFile: VirtualFile?): SyntaxHighlighter =
        BechamlSyntaxHighlighter()
}