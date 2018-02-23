import * as React from 'react'
import {
    Editor,
    EditorState,
    SelectionState,
    ContentState,
    RichUtils,
    getDefaultKeyBinding,
    KeyBindingUtil,
    Modifier,
    genKey,
    ContentBlock
} from 'draft-js'
import { List } from 'immutable'
import { CodeCell } from './CodeCell'
import { EditorMessage, EditorMessageType, EditorKeys } from '../utils/EditorMessages'
import { getNextBlockFor, getPrevBlockFor, isBlockBackwards } from '../utils/DraftStateUtils'
import { EditorMenu, getBlockStyle, styleMap } from './Menu'
/*import { convertFromMarkdown } from '../utils/draftImportUtils'
import { convertToMarkdown } from '../utils/draftExportUtils'*/

interface WorkbooksEditorProps {
    content: string | undefined
}

interface WorkbooksEditorState {
    editorState: EditorState,
    readOnly: boolean
}

export class WorkbookEditor extends React.Component<WorkbooksEditorProps, WorkbooksEditorState> {
    lastFocus?: Date;
    subscriptors: ((m: EditorMessage) => void)[];

    constructor(props: WorkbooksEditorProps) {
        super(props)

        this.subscriptors = []
        this.lastFocus = undefined

        let editorState = EditorState.createEmpty()

        this.state = {
            editorState: editorState,
            readOnly: false
        }
    }

    //   export() {
    //     const content = convertToMarkdown(this.state.editorState.getCurrentContent());
    //     console.log("Exported content:")
    //     console.log(content)
    //     return content
    //   }

    componentDidMount() {
        this.focus()
    }

    focus(e?: any) {
        const focusThresholdToBlur = this.lastFocus && (+Date.now() - +this.lastFocus) > 1000
        if (focusThresholdToBlur)
            (document.activeElement as any).blur();

        this.lastFocus = new Date();
        (this.refs.editor as any).focus();
    }

    onChange(editorState: EditorState) {
        this.setState({ editorState })
    }

    blockRenderer(block: Draft.ContentBlock) {
        if (block.getType() === 'code-block') {
            return {
                component: CodeCell,
                editable: false,
                props: {
                    editorReadOnly: (readOnly: boolean) => this.editorReadOnly(readOnly),
                    subscribeToEditor: (callback: () => void) => this.addMessageSubscriber(callback),
                    selectNext: (currentKey: string) => this.selectNext(currentKey),
                    selectPrevious: (currentKey: string) => this.selectPrevious(currentKey),
                    updateTextContentOfBlock: (blockKey: string, textContent: string) => this.updateTextContentOfBlock(blockKey, textContent),
                    setSelection: (anchorKey: string, offset: number) => this.setSelection(anchorKey, offset)
                }
            }
        }
        return null
    }

    selectNext(currentKey: string): boolean {
        this.editorReadOnly(false)

        let nextBlock = getNextBlockFor(this.getSelectionContext().currentContent, currentKey)
        if (!nextBlock) {
            const currentContent = this.state.editorState.getCurrentContent();
            const currentBlockType = currentContent.getBlockForKey(currentKey).getType();

            if (currentBlockType !== "code-block")
                return false;

            // If this is a code block, we should insert a new block immediately after
            const newBlock = new ContentBlock({
                key: genKey(),
                type: "unstyled",
                text: "",
                characterList: List()
            });

            const newBlockMap = currentContent.getBlockMap().set(newBlock.getKey(), newBlock)
            const contentState = ContentState.createFromBlockArray(newBlockMap.toArray(), undefined);

            this.setState({
                editorState: EditorState.push(this.state.editorState, contentState, "insert-fragment"),
            });
            nextBlock = newBlock;
        }

        var nextSelection = SelectionState.createEmpty(nextBlock.getKey())
        nextSelection
            .set('anchorOffset', 0)
            .set('focusOffset', 0)

        var editorState = EditorState.forceSelection(this.state.editorState, nextSelection)
        this.setState({ editorState })
        if (nextBlock.getType() !== "code-block")
            this.focus()

        return true
    }

    selectPrevious(currentKey: string): boolean {
        this.editorReadOnly(false)

        const nextBlock = getPrevBlockFor(this.getSelectionContext().currentContent, currentKey)
        if (!nextBlock) return false;
        var nextSelection = SelectionState.createEmpty(nextBlock.getKey())
        nextSelection
            .set('anchorOffset', 0)
            .set('focusOffset', 0)

        var editorState = EditorState.forceSelection(this.state.editorState, nextSelection)
        this.setState({ editorState })
        if (nextBlock.getType() !== "code-block")
            this.focus()

        return true
    }

    /**
     * Set readonly editor to fix bad behaviours moving focus between code blocks and text
     * https://draftjs.org/docs/advanced-topics-block-components.html#recommendations-and-other-notes
     * @param {boolean} readOnly
     */
    editorReadOnly(readOnly: boolean) {
        this.setState({ readOnly: readOnly })
    }

    updateTextContentOfBlock(blockKey: string, textContent: string) {
        // Create a selection of the hole block and replace it with new text
        const content = this.state.editorState.getCurrentContent()
        const end = content.getBlockForKey(blockKey).getText().length
        const selection = SelectionState.createEmpty(blockKey)
            .set("anchorOffset", 0)
            .set("focusKey", blockKey)
            .set("focusOffset", end)
        const newContent = Modifier.replaceText(content, selection as SelectionState, textContent)

        // apply changes
        const newState = EditorState.push(
            this.state.editorState,
            newContent,
            "insert-characters"
        )
        this.onChange(newState)

    }

    setSelection(anchorKey: string, offset: number) {
        offset = offset | 0
        const selection = SelectionState.createEmpty(anchorKey)
            .set("anchorOffset", 0)

        this.onChange(EditorState.forceSelection(this.state.editorState, selection as SelectionState))
    }

    editorKeyBinding(e?: any) {
        const keyCode = e.keyCode
        if (keyCode === EditorKeys.LEFT || keyCode === EditorKeys.RIGHT)
            this.onArrow(keyCode, e)

        return getDefaultKeyBinding(e)
    }

    /**
     * Add a subscriber to custom messages/events of editor.
     * @param {fn} callback
     */
    addMessageSubscriber(callback: () => void) {
        this.subscriptors.push(callback)
    }

    /**
     * Send a message to subscribers
     * @param {EditorMessage} message
     */
    sendMessage(message: EditorMessage) {
        this.subscriptors.forEach(function (callback) {
            callback(message)
        })
    }

    getSelectionContext(): {
        selectionState: Draft.SelectionState,
        currentContent: Draft.ContentState,
    } {
        var selectionState = this.state.editorState.getSelection()
        var anchorKey = selectionState.getAnchorKey()
        var currentContent = this.state.editorState.getCurrentContent()

        return {
            selectionState,
            currentContent
        }
    }

    /**
     * Handle heyboard arrow navigation
     * @param {KeyboardArrows|number} dir Arrow keycode
     * @param {Event} e Event
     */
    onArrow(dir: number, e?: React.KeyboardEvent<{}>) {
        var selectionContext = this.getSelectionContext()
        var targetBlock = null
        const selection = window.getSelection();
        switch (dir) {
            case EditorKeys.UP:
                targetBlock = selectionContext.currentContent.getBlockBefore(selectionContext.selectionState.getFocusKey())
                break
            case EditorKeys.DOWN:
                targetBlock = selectionContext.currentContent.getBlockAfter(selectionContext.selectionState.getFocusKey())
                break
            case EditorKeys.RIGHT:
                const selectionIsEndOfLine = selection && selection.anchorNode && selection.anchorNode.textContent
                    && selection.anchorOffset === selection.anchorNode.textContent.length
                if (selectionIsEndOfLine)
                    targetBlock = selectionContext.currentContent.getBlockAfter(selectionContext.selectionState.getFocusKey())

                break
            case EditorKeys.LEFT:
                const selectionIsStartOfLine = selectionContext.selectionState.getStartOffset() === 0
                if (selectionIsStartOfLine)
                    targetBlock = selectionContext.currentContent.getBlockBefore(selectionContext.selectionState.getFocusKey())

                break
            default:
                break
        }

        if (!targetBlock) {
            return
        }

        const isBackwards = isBlockBackwards(this.state.editorState, targetBlock.getKey())
        this.sendMessage({
            type: EditorMessageType.setSelection,
            target: targetBlock.getKey(),
            data: {
                isBackwards: isBackwards,
                keyCode: e ? e.keyCode : undefined
            }
        })
    }

    handleKeyCommand(command: string): "handled" | "not-handled" {
        const newState = RichUtils.handleKeyCommand(this.state.editorState, command)
        if (newState) {
            this.onChange(newState)
            return "handled"
        }
        return "not-handled"
    }

    /**
     * Change the type of block on current selection
     * @param {string} blockType
     */
    toggleBlockType(blockType: string) {
        this.onChange(
            RichUtils.toggleBlockType(
                this.state.editorState,
                blockType
            )
        )
    }

    /**
     * Change the type of inline block on current selection
     * @param {*} blockType
     */
    toggleInlineStyle(inlineStyle: string) {
        this.onChange(
            RichUtils.toggleInlineStyle(
                this.state.editorState,
                inlineStyle
            )
        )
    }

    render() {
        let className = 'xi-editor'
        var contentState = this.state.editorState.getCurrentContent()
        if (!contentState.hasText()) {
            if (contentState.getBlockMap().first().getType() !== 'unstyled') {
                className += ' xi-editor--hidePlaceholder'
            }
        }

        return (
            <div className="xi-editor-container">
                <EditorMenu
                    editorState={this.state.editorState}
                    onToggleBlock={(type: string) => this.toggleBlockType(type)}
                    onToggleInline={(type: string) => this.toggleInlineStyle(type)}
                />
                <br />
                <div className={className} onClick={(e) => this.focus(e)}>
                    <Editor
                        ref="editor"
                        placeholder=""
                        spellCheck={false}
                        readOnly={this.state.readOnly}
                        blockRendererFn={(block) => this.blockRenderer(block)}
                        blockStyleFn={getBlockStyle}
                        customStyleMap={styleMap}
                        editorState={this.state.editorState}
                        onChange={(s) => this.onChange(s)}
                        keyBindingFn={(e) => this.editorKeyBinding(e)}
                        handleKeyCommand={(e) => this.handleKeyCommand(e)}
                        onUpArrow={(e) => this.onArrow(EditorKeys.UP, e)}
                        onDownArrow={(e) => this.onArrow(EditorKeys.DOWN, e)}
                    />
                </div>
                <div>
                    <hr />
                    <code>dev tools</code>
                    <i style={{ cursor: 'pointer', padding: 5 }} className="fa fa-terminal" onClick={() => this.logContent()}></i>
                </div>
            </div>
        )
    }

    logContent() {
        console.log("______editor content______")
        this.state.editorState.getCurrentContent().getBlockMap().forEach((e: any) => console.log(`${e.key}(${e.type}): "${e.text}"`))
        console.log("______editor selection______")
        console.log(
            `${this.state.editorState.getSelection().getAnchorKey()}[${this.state.editorState.getSelection().getAnchorOffset()}]-` +
            `${this.state.editorState.getSelection().getFocusKey()}[${this.state.editorState.getSelection().getFocusOffset()}]`
        )
    }
}