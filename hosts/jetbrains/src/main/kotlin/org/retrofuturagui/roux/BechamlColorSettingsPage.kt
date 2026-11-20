package org.retrofuturagui.roux

import com.intellij.openapi.editor.colors.TextAttributesKey
import com.intellij.openapi.fileTypes.SyntaxHighlighter
import com.intellij.openapi.options.colors.AttributesDescriptor
import com.intellij.openapi.options.colors.ColorDescriptor
import com.intellij.openapi.options.colors.ColorSettingsPage
import javax.swing.Icon

class BechamlColorSettingsPage : ColorSettingsPage
{
    override fun getIcon(): Icon? = null

    override fun getHighlighter(): SyntaxHighlighter = BechamlSyntaxHighlighter()

    override fun getDemoText(): String =
        "<!-- Bechaml markup and values -->\n" +
            "<Scene Name=\"MainScene\" OnLoad=Slots.SetUp>\n" +
            "    <Button Shown Colors:Hover={ #AABBCC, 0.5 } OnClick={ Slots.Accept, Slots.Cancel }>\n" +
            "        <Text String=\"Hello\" FontSize=24/>\n" +
            "    </Button>\n" +
            "</Scene>"

    override fun getAdditionalHighlightingTagToDescriptorMap(): Map<String, TextAttributesKey> = emptyMap()

    override fun getAttributeDescriptors(): Array<AttributesDescriptor> = arrayOf(
        AttributesDescriptor("Tag", BechamlTextAttributes.TAG),
        AttributesDescriptor("Attribute", BechamlTextAttributes.ATTRIBUTE),
        AttributesDescriptor("Comment", BechamlTextAttributes.COMMENT),
        AttributesDescriptor("String", BechamlTextAttributes.STRING),
        AttributesDescriptor("Number", BechamlTextAttributes.NUMBER),
        AttributesDescriptor("Color", BechamlTextAttributes.COLOR),
        AttributesDescriptor("Boolean", BechamlTextAttributes.BOOLEAN),
        AttributesDescriptor("Reference", BechamlTextAttributes.REFERENCE),
        AttributesDescriptor("Delimiter", BechamlTextAttributes.DELIMITER)
    )

    override fun getColorDescriptors(): Array<ColorDescriptor> = ColorDescriptor.EMPTY_ARRAY

    override fun getDisplayName(): String = "Bechaml"
}