
/**
 * @module editor/mathfield
 */
define(['mathlive/core/definitions', 'mathlive/core/mathAtom', 'mathlive/core/lexer', 'mathlive/core/parser', 'mathlive/core/span', 
    'mathlive/editor/editor-editableMathlist', 'mathlive/editor/editor-mathpath', 'mathlive/editor/editor-keyboard', 'mathlive/editor/editor-undo', 
    'mathlive/editor/editor-shortcuts', 'mathlive/editor/editor-commands',
    'mathlive/addons/outputLatex', 'mathlive/addons/outputSpokenText'], 
    function(Definitions, MathAtom, Lexer, ParserModule, Span, 
    EditableMathlist, MathPath, Keyboard, Undo, Shortcuts, Commands,
// eslint-disable-next-line no-unused-vars
    OutputLatex, OutputSpokenText) {

/* 
    Note: 
    The OutputLatex and OutputSpokenText modules are required, even though they 
    are not referenced directly.

    They modify the MathAtom class, adding toLatex() and toSpeakableText()
    respectively.
*/


const mathfields = {};
let mathfieldID = 0;



function on(el, selectors, listener, options) {
    selectors = selectors.split(' ');
    for (const sel of selectors) {
        el.addEventListener(sel, listener, options);
    }
}

function off(el, selectors, listener, options) {
    selectors = selectors.split(' ');
    for (const sel of selectors) {
        el.removeEventListener(sel, listener, options);
    }
}




/**
 * This function can either be used as a classic function to retrieve
 * a MathField object previously bound to a DOM element, e.g.:
 * 
 * ``` javascript
    mf = Mathlive.MathField(document.getElementById('id'));
   ```
 * 
 * Or it can be used as a constructor that will bind a new MathField 
 * object to a DOM element, e.g.
 * 
 * ``` javascript
    mf = new Mathlive.MathField(document.getElementById('id'));
   ```
 * 
 *  
 * @param {Element} element 
 * @param {Object} config - See [`MathField.setConfig()`]{@link MathField#setConfig} for details
 * @property {Element} element - The DOM element this mathfield is attached to.
 * @property {Object} config - A key/value/pair object that includes options
 * customizing the behavior of the mathfield
 * @property {string} id - A unique ID identifying this mathfield
 * @property {boolean} keystrokeCaptionVisible - True if the keystroke caption
 * panel is visible
 * @class
 * @memberof module:editor/mathfield
 */
function MathField(element, config) {
    if (!this || !(this instanceof MathField)) {
        // The MathField function is called directly, i.e. 
        // mf = Mathlive.MathField(document.getElementById('id'));

        // If the element is, in fact, not a DOM element, return null.
        if (!element || !element.nodeType) return null;

        // Find the corresponding mathfield by its blockID
        const blockID = element.getAttribute('mathlive-block-id');
        if (blockID) {
            return mathfields[blockID];
        }
    } else {
        // The MathField function is called as a constructor, with new, i.e.
        // mf = new MathField();

        // Setup default config options
        this.config(config || {});

        // Give it a new ID
        this.id = mathfieldID++;

        // Remember the mapping between ID and `this` in the mathfields array
        mathfields[this.id] = this;

        this.element = element;

        // Save existing content
        const elementText = this.element.innerText.trim();

        // Additional elements used for UI.
        // They are retrived in order a bit later, so they need to be kept in sync
        // 0/ The textarea field that will receive keyboard events
        // 1/ The field, where the math equation will be displayed
        // 2/ The widget to activate the command bar
        // 3/ The popover panel which displays info in command mode
        // 4/ The keystroke caption panel (option+shift+K)
        // 5/ The command bar
        let markup = '';
        if (!config.substituteTextArea) {
            markup += '<span class="ML__textarea" aria-hidden="true" role="none presentation">' +
                '<textarea autocapitalize="off" autocomplete="off" ' + 
                'autocorrect="off" spellcheck="false" ' + 
                'aria-hidden="true" role="none presentation">' +
                '</textarea>' +
            '</span>';
        } else {
            if (typeof config.substituteTextArea === 'string') {
                markup += config.substituteTextArea;
            } else {
                // We don't really need this one, but we keep it here so that the 
                // indexes below remain the same whether a substituteTextArea is 
                // provided or not.
                markup += '<span></span>';
            }
        }
        markup += '<span class="ML__fieldcontainer">' +
                '<span ></span>' +
                '<span class="ML__commandbartoggle"' +
                    'role="button" tabindex="0" aria-label="Toggle Command Bar">' +
                '</span>' +
            '</span>' +
            '<div class="ML__popover"></div>' + 
            '<div class="ML__keystrokecaption"></div>' + 
            '<div class="ML__commandbar">' +
                '<div class="ML__commandbuttons" role="toolbar" aria-label="Commmand Bar></div>' + 
                '<div class="ML__commandpanel"></div>' +
            '</div>';


        this.element.innerHTML = markup;

        if (typeof config.substituteTextArea === 'function') {
            this.textarea =  config.substituteTextArea();
        } else {
            this.textarea = this.element.children[0].firstElementChild;
        }
        this.field = this.element.children[1].children[0];
        this.commandbarToggle = this.element.children[1].children[1];
        this._attachButtonHandlers(this.commandbarToggle, 'toggleCommandBar');
        this.popover = this.element.children[2];
        this.keystrokeCaption = this.element.children[3];
        this.commandBar = this.element.children[4];
        this.commandButtons = this.commandBar.children[0];
        this.commandPanel = this.commandBar.children[1];

        // The keystroke caption panel and the command bar are 
        // initially hidden
        this.keystrokeCaptionVisible = false;
        this.commandBarVisible = false;

        // This index indicates which of the suggestions available to 
        // display in the popover panel
        this.suggestionIndex = 0;

        // Focus/blur state
        this.blurred = true;
        on(window, 'focus', this._onFocus.bind(this));
        on(window, 'blur', this._onBlur.bind(this));

        // Capture clipboard events
        on(this.textarea, 'cut', this._onCut.bind(this));
        on(this.textarea, 'copy', this._onCopy.bind(this));
        on(this.textarea, 'paste', this._onPaste.bind(this));

        // Delegate keyboard events
        Keyboard.delegateKeyboardEvents(this.textarea, {
            container:      this.element,
            typedText:      this._onTypedText.bind(this),
            paste:          this._onPaste.bind(this),
            keystroke:      this._onKeystroke.bind(this),
            focus:          this._onFocus.bind(this),
            blur:           this._onBlur.bind(this),
        })


        // Delegate mouse and touch events
        on(this.element, 'touchstart mousedown', this._onPointerDown.bind(this), 
            {passive: false, capture: false});

        // Request notification for when the window is resized (
        // or the device switched from portrait to landscape) to adjust
        // the UI (popover, etc...)
        on(window, 'resize', this._onResize.bind(this));


        // Override some handlers in the config
        const localConfig = Object.assign({}, config);
        localConfig.onSelectionDidChange = 
            MathField.prototype._onSelectionDidChange.bind(this);

        this.mathlist = new EditableMathlist.EditableMathlist(localConfig);

        // Prepare to manage undo/redo
        this.undoManager = new Undo.UndoManager(this.mathlist);

        // If there was some content in the element, use it for the initial
        // value of the mathfield
        if (elementText.length > 0) {
            this.latex(elementText);
        }
    }
}

/**
 * Utility function that returns the element which has the caret
 * 
 * @param {DomElement} el 
 * @function module:editor/mathfield#_findElementWithCaret
 */
function _findElementWithCaret(el) {
    if (el.classList.contains('ML__caret')) {
        return el;
    }
    let result;
    Array.from(el.children).forEach(function(child) {
        result = result || _findElementWithCaret(child);
    });
    return result;
}



/**
 * Return the (x,y) client coordinates of the caret
 * 
 * @method module:editor/mathfield.MathField#_getCaretPosition
 */
MathField.prototype._getCaretPosition = function() {
    const caret = _findElementWithCaret(this.field);
    if (caret) {
        const bounds = caret.getBoundingClientRect();
        return {
            x: bounds.right + window.scrollX, 
            y: bounds.bottom + window.scrollY };
    }
    return null;
}


/**
 * Return a tuple of an element and a distance from point (x, y)
 * @param {Element} el 
 * @param {number} x 
 * @param {number} y 
 * @function module:editor/mathfield#nearestElementFromPoint
 * @private
 */
function nearestElementFromPoint(el, x, y) {
    let result = { element: null };
    let considerChildren = true;
    const r = el.getBoundingClientRect();
    if (!el.getAttribute('data-atom-id')) {
        // This element may not have a matching atom, but its children might
        result.distance = Number.POSITIVE_INFINITY;
    } else {
        result.element = el;

        // Calculate the (square of the ) distance to the rectangle
        const dx = Math.max(r.left - x, 0, x - r.right);
        const dy = Math.max(r.top - y, 0, y - r.bottom);
        result.distance = dx * dx + dy * dy;

        // Only consider children if the target is inside the (horizontal) bounds of 
        // of the element.
        // This avoid searching the numerator/denominator when a fraction
        // is the last element in the formula.
        considerChildren = x >= r.left && x <= r.right;
    }

    if (considerChildren && el.children) {
        Array.from(el.children).forEach(function(child) {
            const nearest = nearestElementFromPoint(child, x, y);
            if (nearest.element && nearest.distance <= result.distance) {
                result = nearest;
            }
        });
    }

    return result;
}

MathField.prototype._pathFromPoint = function(x, y) {
    let result;
    // Try to find the deepest element that is near the point that was 
    // clicked on (the point could be outside of the element)
    const nearest = nearestElementFromPoint(this.element, x, y);
    const el = nearest.element;
    const id = el ? el.getAttribute('data-atom-id') : null;

    if (id) {
        // Let's find the atom that has a matching ID with the element that 
        // was clicked on (or near)
        const atoms = this.mathlist.filter(function(path, atom) {
            return atom.id === id;
        });

        if (atoms && atoms.length > 0) {
            // (There should be exactly one atom that matches this ID...)
            // Set the result to the path to this atom

            // If the point clicked is to the left of the vertical midline,
            // adjust the path to *before* the atom (i.e. after the 
            // preceding atom)
            const bounds = el.getBoundingClientRect();
            result = MathPath.pathFromString(atoms[0]).path;
            if (x < bounds.left + bounds.width / 2) {
                result[result.length - 1].offset -= 1;
            }
        }
    }
    return result;
}

MathField.prototype._onPointerDown = function(evt) {
    const that = this;
    let trackingPointer = false;

    // This should not be necessary, but just in case we got in a weird state...
    off(this.field, 'touchmove', onPointerMove);
    off(this.field, 'touchend touchleave', endPointerTracking);
    off(window, 'mousemove', onPointerMove);
    off(window, 'mouseup blur', endPointerTracking);


    function endPointerTracking(evt) {
        off(that.field, 'touchmove', onPointerMove);
        off(that.field, 'touchend touchleave', endPointerTracking);
        off(window, 'mousemove', onPointerMove);
        off(window, 'mouseup blur', endPointerTracking);

        trackingPointer = false;
        evt.preventDefault();
        evt.stopPropagation();
    }
    function onPointerMove(moveEvt) {
        const x = moveEvt.touches ? moveEvt.touches[0].clientX : moveEvt.clientX;
        const y = moveEvt.touches ? moveEvt.touches[0].clientY : moveEvt.clientY;
        const focus = that._pathFromPoint(x, y);
        if (anchor && focus) {
            that.mathlist.setRange(anchor, focus);
            setTimeout(that._render.bind(that), 0);
        }
        // Prevent synthetic mouseMove event when this is a touch event
        moveEvt.preventDefault();
        moveEvt.stopPropagation();
    }

    let dirty = false;
    
    // Switch the keyboard focus to the textarea to receive keyboard events
    // on behalf of the MathField
    if (!this.hasFocus()) {
        dirty = true;
        this.textarea.focus();
    }

    // If a mouse button other than the main one was pressed, return
    if (evt.buttons && evt.buttons !== 1) return;

    const x = evt.touches ? evt.touches[0].clientX : evt.clientX;
    const y = evt.touches ? evt.touches[0].clientY : evt.clientY;
    let anchor = this._pathFromPoint(x, y);
    if (anchor) {
        if (evt.shiftKey) {
            // Extend the selection if the shift-key is down
            this.mathlist.setRange(this.mathlist.path, anchor);
            anchor = MathPath.clone(this.mathlist.path);
            anchor[anchor.length - 1].offset -= 1;
        } else {
            this.mathlist.setPath(anchor, 0);
        }
        // The selection has changed, so we'll need to re-render
        dirty = true;

        if (evt.detail === 2 || evt.detail === 3) {
            off(this.field, 'touchmove', onPointerMove);
            off(this.field, 'touchend', endPointerTracking);
            off(window, 'mousemove', onPointerMove);
            off(window, 'mouseup blur', endPointerTracking);
            trackingPointer = false;
            if (evt.detail === 3) {
                // This is a triple-click
                this.mathlist.selectAll_();
            } else if (evt.detail === 2) {
                // This is a double-click
                this.mathlist.selectGroup_();
            }
        } else {
            if (!trackingPointer) {
                trackingPointer = true;
                on(window, 'blur', endPointerTracking);
                if (evt.touches) {
                    // To receive the subsequent touchmove/touch, need to 
                    // listen to this evt.target.
                    // This was a touch event
                    on(evt.target, 'touchend', endPointerTracking);
                    on(evt.target, 'touchmove', onPointerMove);
                } else {
                    on(window, 'mouseup', endPointerTracking);
                    on(window, 'mousemove', onPointerMove);
                }
            }
        }
    }


    if (dirty) this._render();

    // Prevent the browser from handling, in particular when this is a 
    // touch event prevent the synthetic mouseDown event from being generated
    evt.preventDefault();
}

MathField.prototype._onSelectionDidChange = function() {
    // Every atom before the new caret position is now comitted
    this.mathlist.commitCommandStringBeforeInsertionPoint();

    // If the selection is not collapsed, put it in the textarea
    // This will allow cut/copy to work.
    const mathlist = this.mathlist.extractContents();
    if (mathlist && !this.mathlist.isCollapsed()) {
        let result = '';
        for (const atom of mathlist) {
            result += atom.toLatex();
        }
        this.textarea.value = result;
        this.textarea.setAttribute('aria-label', MathAtom.toSpeakableText(mathlist));
        if (this.hasFocus()) {
            this.textarea.select();
        }
    } else {
        this.textarea.value = '';
        this.textarea.setAttribute('aria-label', '');
    }

    // Update the command bar
    this._updateCommandBar();

    // Defer the updating of the popover position: we'll need the tree to be
    // re-rendered first to get an updated caret position
    this._updatePopoverPosition({deferred:true});

    // Invoke client handlers, if provided.
    if (this.config.onSelectionDidChange) {
        this.config.onSelectionDidChange(this);
    }
}

MathField.prototype._onFocus = function() {
    if (this.blurred) {
        this.blurred = false;
        this.textarea.select();
        this._updatePopoverPosition();
        this._updateCommandBar();
        this._render();
        if (this.config.onFocus) this.config.onFocus(this);
    }
}

MathField.prototype._onBlur = function() {
    if (!this.blurred) {
        this.blurred = true;
        this._updatePopoverPosition();
        this._updateCommandBar();
        this._render();
        if (this.config.onBlur) this.config.onBlur(this);
    }
}

MathField.prototype._onResize = function() {
    this._updatePopoverPosition();
}


MathField.prototype._showKeystroke = function(keystroke) {
    const vb = this.keystrokeCaption;
    if (vb && this.keystrokeCaptionVisible) {
        const bounds = this.element.getBoundingClientRect();
        vb.style.left = bounds.left + 'px';
        vb.style.top = (bounds.top - 56) + 'px';
        vb.innerHTML += '<span>' + 
            (Shortcuts.stringify(keystroke) || keystroke) + 
            '</span>';
        vb.style.visibility = 'visible';
        setTimeout(function() {
            if (vb.childNodes.length > 0) {
                vb.removeChild(vb.childNodes[0]);
            }
            if (vb.childNodes.length === 0) {
                vb.style.visibility = 'hidden';
            }
        }, 3000);
    }
}

/**
 * @param {string}
 * @method module:editor/mathfield:MathField#perform
 */
MathField.prototype.perform = function(command) {
    let result = false;
    let selector;
    let args = [];
    if (Array.isArray(command)) {
        selector =  command[0] + '_';
        args = command.slice(1);
    } else {
        selector = command + '_';
    }

    if (typeof this.mathlist[selector] === 'function') {
        if (['delete_', 'transpose_', 'deleteToMathFieldEnd_',
            'deleteToGroupEnd_', 'deleteToGroupStart_', 'deletePreviousWord_',
            'deleteNextWord_', 'deletePreviousChar_', 'deleteNextChar_'].includes(selector)) {
            this.undoManager.snapshot();
        }

        this.mathlist[selector](...args);

        result = true;
    } else if (typeof this[selector] === 'function') {
        if (['complete_'].includes(selector)) {
            this.undoManager.snapshot();
        }
        
        this[selector](...args);

        result = true;
    } 

    if (result) {
        // Render the mathlist
        this._render();

        this.scrollIntoView_();
    }

    return result;
}

/**
 * @param {string} keystroke
 * @param {Event} evt
 * @method module:editor/mathfield.MathField#_onKeystroke
 */
MathField.prototype._onKeystroke = function(keystroke, evt) {
    
    const shortcut = Shortcuts.matchKeystroke(this.mathlist.parseMode(), 
        keystroke);

    if (!shortcut) return true;

    // Remove any error indicator (wavy underline) on the current command sequence 
    // (if there are any)
    this.mathlist.decorateCommandStringAroundInsertionPoint(false);

    this._showKeystroke(keystroke);

    if (!this.perform(shortcut)) {
        this.mathlist.insert(shortcut);
        // Render the mathlist
        this._render();

        this.scrollIntoView_();
    }

    // Keystroke has been handled, if it wasn't caught in the default
    // case, so prevent propagation
    evt.preventDefault();
    evt.stopPropagation();
    return false;
}





MathField.prototype._onTypedText = function(text) {    
    // Remove any error indicator on the current command sequence (if there is one)
    this.mathlist.decorateCommandStringAroundInsertionPoint(false);

    // Insert the specified text at the current insertion point.
    // If the selection is not collapsed, the content will be deleted first.

    let popoverText;
    let displayArrows;
    if (this.pasteInProgress) {
        this.pasteInProgress = false;
        // This call was made in response to a paste event.
        // Interpret `text` as a LaTeX expression
        this.mathlist.insert(text);

    } else {
        for (const c of text) {
            
            this._showKeystroke(c);

            let shortcut;
            // Inline shortcuts only apply in `math` parseMode
            if (this.mathlist.parseMode() === 'math') {
                const prefix = this.mathlist.extractGroupStringBeforeInsertionPoint();
                shortcut = Shortcuts.matchEndOf(prefix + c, this.config);
            }
            if (this.mathlist.parseMode() === 'command') {
                this.mathlist.removeSuggestion();
                this.suggestionIndex = 0;
                const command = this.mathlist.extractCommandStringAroundInsertionPoint();
                const suggestions = Definitions.suggest(command + c);
                displayArrows = suggestions.length > 1;
                if (suggestions.length === 0) {
                    this.mathlist.insert(c);
                    if (/^\\[a-zA-Z\\*]+$/.test(command + c)) {
                        // This looks like a command name, but not a known one
                        this.mathlist.decorateCommandStringAroundInsertionPoint(true);
                    }
                    this._hidePopover();
                } else {
                    this.mathlist.insert(c);
                    if (suggestions[0].match !== command + c) {

                        this.mathlist.insertSuggestion(suggestions[0].match, 
                            -suggestions[0].match.length + command.length + 1);
                    }
                    popoverText = suggestions[0].match;
                }
            } else if (shortcut) {
                // Insert the character before applying the substitution
                this.mathlist.insert(c);

                // Create a snapshot with the inserted character so we can 
                // revert to that. This will allow to undo the effect of 
                // the substitution if it was undesired.
                this.undoManager.snapshot();

                // Remove the characters we're replacing
                this.mathlist.delete(-shortcut.match.length - 1);

                // Insert the substitute
                this.mathlist.insert(shortcut.substitute);        
            } else {
                // if (!this.mathlist.isCollapsed()) {
                //     this.undoManager.snapshot();
                // }
                this.undoManager.snapshot();
                this.mathlist.insert(c);
                // this.undoManager.snapshot();
            }
        }
    }


    // Render the mathlist
    this._render();

    // Since the location of the popover depends on the positon of the caret
    // only show the popover after the formula has been rendered and the 
    // position of the caret calculated
    this._showPopoverWithLatex(popoverText, displayArrows);
}

MathField.prototype._render = function() {
    //
    // 1. Update selection state and blinking cursor (caret)
    //
    this.mathlist.root.forEach( a => { 
            a.hasCaret = false;
            a.isSelected = this.mathlist.contains(a);
        } );
    const hasFocus = this.hasFocus();
    if (hasFocus && this.mathlist.isCollapsed()) {
        this.mathlist.anchor().hasCaret = true;
    }

    //
    // 2. Create spans corresponding to the updated mathlist
    //
    const spans = MathAtom.decompose(
        {
            mathstyle: 'displaystyle', 
            generateID: 'true'
        }, this.mathlist.root.children);



    //
    // 3. Construct struts around the spans
    //

    const base = Span.makeSpan(spans, 'ML__base');
    base.attributes = {
        // Hint to screen readers to not attempt to read this span
        // They should use instead the 'ariaText' below.
        'aria-hidden': 'true',
        'role': 'none presentation'
    }

    const topStrut = Span.makeSpan('', 'ML__strut');
    topStrut.setStyle('height', base.height, 'em');

    const bottomStrut = Span.makeSpan('', 'ML__strut ML__bottom');
    bottomStrut.setStyle('height', base.height + base.depth, 'em');
    bottomStrut.setStyle('vertical-align', -base.depth, 'em');


    const wrapper = Span.makeSpan([topStrut, bottomStrut, base], 'ML__mathlive');
    wrapper.classes += hasFocus ? ' ML__focused' : ' ML__blured';

    //
    // 4. Decorate with a spoken text version for accessibility
    //

    wrapper.attributes = {
        // Accessibility: make sure this text span is taken into account
        // and read by screen readers, since it's intended to replace
        // the base span.
        // 'aria-hidden': false,
        // Accessibility: Indicate this is a math equation
        // 'role': 'math',
        // Accessibility: Indicate this content can get updated (as the user edits it)
        // 'aria-live': 'assertive',

        // Accessibility: Indicate this item can be focused
        'tabindex':     '0',

        // 'content-editable': 'true',

        'role':         'math',     // or 'application' ?
        // 'aria-multiline': 'true',
        'aria-label': MathAtom.toSpeakableText(this.mathlist.root)
    };



    //
    // 5. Generate markup
    //

    const markup = wrapper.toMarkup();
    this.field.innerHTML = markup;

    //
    // 6. Stop event propagation, and scroll cursor into view
    //

    // evt.preventDefault();
    this.scrollIntoView_();
}


MathField.prototype._onPaste = function() {
    // Make note we're in the process of pasting. The subsequent call to 
    // onTypedText() will take care of interpreting the clipboard content
    this.pasteInProgress = true;
    return true;
}
MathField.prototype._onCut = function() {
    // Clearing the selection will have the side effect of clearing the 
    // content of the textarea. However, the textarea value is what will 
    // be copied to the clipboard, so defer the clearing of the selection
    // to later, after the cut operation has been handled.
    setTimeout(function() {
        this.clearSelection();
        this._render(); 
    }.bind(this), 0);
    return true;

}
MathField.prototype._onCopy = function() {
    return true;
}


//
// PUBLIC API
//

/**
 * Return a textual representation of the mathfield.
 * @param {string} [format='latex']. One of 'latex', 'spoken', 'asciimath'
 * @return {string}
 * @method module:editor/mathfield.MathField#text
 */
MathField.prototype.text = function(format) {
    format = format || 'latex';
    let result = '';
    if (format === 'latex') {
        result = this.mathlist.root.toLatex();
    } else if (format === 'spoken') {
        result = MathAtom.toSpeakableText(this.mathlist.root, {markup:true});
    }

    return result;
}

/**
 * If `text` is not undefined, sets the content of the mathfield to the 
 * text interpreted as a LaTeX expression.
 * If `text` is undefined, return the content of the mahtfield as a 
 * LaTeX expression.
 * @param {string} text
 * @return {string}
 * @method module:editor/mathfield.MathField#latex
 */
MathField.prototype.latex = function(text) {
    if (text) {
        this.undoManager.snapshot();
        this.mathlist.insert(text, {
            insertionMode: 'replaceAll',
            format: 'latex'
        });
        this._render();
    }

    // Return the content as LaTeX
    // (The result might be different than the optional input, 
    // for example it may have been simplified or some commands ignored)
    return this.mathlist.root.toLatex();
}

MathField.prototype.el = function() {
    return this.element;
}

MathField.prototype.undo_ = MathField.prototype.undo = function() {
    this.undoManager.undo();
}

MathField.prototype.redo_ = MathField.prototype.redo = function() {
    this.undoManager.redo();
}


MathField.prototype.scrollIntoView_ = MathField.prototype.scrollIntoView = function() {
    // @todo
}

MathField.prototype.scrollToStart_ = MathField.prototype.scrollToStart = function() {
    // @todo
}

MathField.prototype.scrollToEnd_ = MathField.prototype.scrollToEnd = function() {
    // @todo
}

/**
 * 
 * @method module:editor/mathfield.MathField#enterCommandMode_
 */
MathField.prototype.enterCommandMode_ = function() {
    // Remove any error indicator on the current command sequence (if there is one)
    this.mathlist.decorateCommandStringAroundInsertionPoint(false);

    this.mathlist.removeSuggestion();
    this._hidePopover();
    this.suggestionIndex = 0;

    this.undoManager.snapshot();
    this.mathlist.insert('\u0027');
}

MathField.prototype.copyToClipboard_ = function() {
    document.execCommand('copy');
}

MathField.prototype.cutToClipboard_ = function() {
    document.execCommand('cut');
}

MathField.prototype.pasteFromClipboard_ = function() {
    document.execCommand('paste');
}


/**
 * This function can be invoked as a selector from or called explicitly.
 * It will insert the specified block of latex at the current selection point,
 * according to the insertion mode specified. After the insertion, the 
 * selection will be set according to the selectionMode.
 * @param {string} latex
 * @param {Object} options
 * @param {string} options.insertionMode - One of `"replaceSelection"`, 
 * `"replaceAll"`, `"insertBefore"` or `"insertAfter"`. Default: `"replaceSelection"`
 * @param {string} options.selectionMode - Describes where the selection 
 * will be after the insertion. One of 'placeholder' (the selection will be 
 * the first available placeholder in the item that has been inserted), 
 * 'after' (the selection will be an insertion point after the item that has 
 * been inserted), 'before' (the selection will be an insertion point before 
 * the item that has been inserted) or 'item' (the item that was inserted will
 * be selected). Default: 'placeholder'.
 * @method module:editor/mathfield.MathField#write
 */
MathField.prototype.write = MathField.prototype.insert_ = MathField.prototype.insert = function(latex, options) {
    if (typeof latex === 'string' && latex.length > 0) {
        if (!options) options = {};
        if (!options.format) options.format = 'auto';
        this.mathlist.insert(latex, options);
    }
}


/**
 * Completes an operation in progress, for example when in command mode, 
 * interpret the command
 * @method module:editor/mathfield.MathField#complete_
 */
MathField.prototype.complete_ = function() {
    this._hidePopover();

    const command = this.mathlist.extractCommandStringAroundInsertionPoint();
    if (command) {
        const mode = 'math'; // @todo this.mathlist.parseMode();
        let match = Definitions.matchFunction(mode, command);
        if (!match) {
            match = Definitions.matchSymbol(mode, command);
        }
        if (match) {
            const mathlist = ParserModule.parseTokens(
                    Lexer.tokenize(match.latexName), mode, null);

            this.mathlist.spliceCommandStringAroundInsertionPoint(mathlist);
        } else {
            // This wasn't a simple function or symbol.
            // Interpret the input as LaTeX code
            const mathlist = ParserModule.parseTokens(
                    Lexer.tokenize(command), mode, null);
            if (mathlist) {
                this.mathlist.spliceCommandStringAroundInsertionPoint(mathlist);
            } else {            
                this.mathlist.decorateCommandStringAroundInsertionPoint(true);
            }
        }
    }
}

function latexToMarkup(latex) {
    const parse = ParserModule.parseTokens(Lexer.tokenize(latex), 'math', null);
    const spans = MathAtom.decompose({mathstyle: 'displaystyle'}, parse);
    
    const base = Span.makeSpan(spans, 'ML__base');

    const topStrut = Span.makeSpan('', 'ML__strut');
    topStrut.setStyle('height', base.height, 'em');
    const bottomStrut = Span.makeSpan('', 'ML__strut ML__bottom');
    bottomStrut.setStyle('height', base.height + base.depth, 'em');
    bottomStrut.setStyle('vertical-align', -base.depth, 'em');
    const wrapper = Span.makeSpan([topStrut, bottomStrut, base], 'ML__mathlive');

    return wrapper.toMarkup();
}

MathField.prototype._showPopoverWithLatex = function(latex, displayArrows) {
    if (!latex || latex.length === 0) {
        this._hidePopover();
        return;
    }

    const command = latex;
    const command_markup = latexToMarkup(Definitions.SAMPLES[command] || latex);
    const command_note = Definitions.getNote(command);
    const command_shortcuts = Shortcuts.stringify(
        Shortcuts.getShortcutsForCommand(command)) || '';

    let template = displayArrows ? 
        '<div class="ML__popover_prev-shortcut" role="button" aria-label="Previous suggestion"><span><span>&#x25B2;</span></span></div>' : '';
    template += '<span class="ML__popover_content">';
    template += '<div class="ML__popover_command" role="button" >' + 
        command_markup + '</div>';
    if (command_note) {
        template += '<div class="ML__popover_note">' + 
            command_note + '</div>';
    }
    if (command_shortcuts) {
        template += '<div class="ML__popover_shortcut">' + 
            command_shortcuts + '</div>';
    }
    template += '</span>';
    template += displayArrows ? '<div class="ML__popover_next-shortcut" role="button" aria-label="Next suggestion"><span><span>&#x25BC;</span></span></div>' : '';
    this._showPopover(template);

    let el = this.popover.getElementsByClassName('ML__popover_content');
    if (el && el.length > 0) {
        this._attachButtonHandlers(el[0], 'complete');
    }
    
    
    el = this.popover.getElementsByClassName('ML__popover_prev-shortcut');
    if (el && el.length > 0) {
        this._attachButtonHandlers(el[0], 'previousSuggestion');
    }

    el = this.popover.getElementsByClassName('ML__popover_next-shortcut');
    if (el && el.length > 0) {
        this._attachButtonHandlers(el[0], 'nextSuggestion');
    }

}

MathField.prototype._updatePopoverPosition = function(options) {
    // If the popover pane is visible...
    if (this.popover.classList.contains('ML__popover_visible')) {
        if (options && options.deferred) {
            // Call ourselves again later, typically after the 
            // rendering/layout of the DOM has been completed
            setTimeout(this._updatePopoverPosition.bind(this), 0);    
        } else {
            if (this.blurred || !this.mathlist.anchor() || this.mathlist.anchor().type !== 'command') {
                this._hidePopover();
            } else {
                // ... get the caret position
                const position = this._getCaretPosition();
                if (position) {
                    // and position the popover right below the caret
                    this.popover.style.left = 
                        (position.x - this.popover.offsetWidth / 2) + 'px';
                    this.popover.style.top = (position.y + 5) + 'px';
                }
            }
        }
    }
}

MathField.prototype._showPopover = function(markup) {
    // Temporarily hide the command bar
    if (this.commandBar.style.visibility === 'visible') {
        this.commandBar.style.visibility = 'hidden';
    }

    this.popover.innerHTML = markup;

    const position = this._getCaretPosition();
    if (position) {
        this.popover.style.left = (position.x - this.popover.offsetWidth / 2) + 'px';
        this.popover.style.top = (position.y + 5) + 'px';
    }

    this.popover.classList.add('ML__popover_visible');
}


MathField.prototype._hidePopover = function() {
    this.popover.classList.remove('ML__popover_visible');    

    // Make the command bar visible again
    if (this.commandBarVisible) {
        this.commandBar.style.visibility = 'visible';
    }
}

MathField.prototype._updateSuggestion = function() {
    this.mathlist.positionInsertionPointAfterCommitedCommand();
    this.mathlist.removeSuggestion();
    const command = this.mathlist.extractCommandStringAroundInsertionPoint();
    const suggestions = Definitions.suggest(command);
    if (suggestions.length === 0) {
        this._hidePopover();
        this.mathlist.decorateCommandStringAroundInsertionPoint(true);
    } else {
        const index = this.suggestionIndex % suggestions.length;
        const l = command.length - suggestions[index].match.length;
        if (l !== 0) {
            this.mathlist.insertSuggestion(suggestions[index].match, l);
        }
        this._showPopoverWithLatex(suggestions[index].match, suggestions.length > 1);
    }

    this._render();
}

MathField.prototype.nextSuggestion_ = function() {
    this.suggestionIndex += 1;
    // The modulo of the suggestionIndex is used to determine which suggestion
    // to display, so no need to worry about rolling over.
    this._updateSuggestion();
}

MathField.prototype.previousSuggestion_ = function() {
    this.suggestionIndex -= 1;
    if (this.suggestionIndex < 0) {
        // We're rolling over
        // Get the list of suggestions, so we can know how many there are
        // Not very efficient, but simple.
        this.mathlist.removeSuggestion();
        const command = this.mathlist.extractCommandStringAroundInsertionPoint();
        const suggestions = Definitions.suggest(command);
        this.suggestionIndex = suggestions.length - 1;
    }
    this._updateSuggestion();
}


MathField.prototype.toggleKeystrokeCaption_ = function() {
    this.keystrokeCaptionVisible = !this.keystrokeCaptionVisible;
    const vb = this.keystrokeCaption;
    vb.innerHTML = '';
    if (this.keystrokeCaptionVisible) {
        vb.style.visibility = 'visible';
    } else {
        vb.style.visibility = 'hidden';
    }
}

MathField.prototype._attachButtonHandlers = function(el, command) {
    const that = this;
    // Command can be either a single selector or an array consisting of 
    // one selector followed by one or more arguments.

    // We need to turn the command into a string to attach it to the dataset 
    // associated with the button (the command could be an array made of a 
    // selector and one or more parameters)

    el.dataset.command = JSON.stringify(command);

    on(el, 'mousedown touchstart', function(ev) {
        if (ev.type !== 'mousedown' || ev.buttons === 1) {
            // The primary button was pressed.
            ev.target.classList.add('pressed');
            ev.stopPropagation(); 
            ev.preventDefault();
        }
    }, {passive: false, capture: false});
    on (el, 'mouseleave touchcancel', function(ev) {
        ev.target.classList.remove('pressed');
    });
    on (el, 'mouseenter', function(ev) {
        if (ev.buttons === 1) {
            ev.target.classList.add('pressed');
        }
    });

    on(el, 'mouseup touchend', function(ev) {
        el.classList.remove('pressed');
        el.classList.add('active');

        // Since we want the active state to be visible for a while,
        // use a timer to remove it after a while
        setTimeout(
            function(){ el.classList.remove('active'); },
            150);

        // Restore the command (and its optional arguments) and perform it
        that.perform(JSON.parse(el.dataset.command));
        ev.stopPropagation();
        ev.preventDefault();
    });
}

MathField.prototype._makeButton = function(label, cls, ariaLabel, command) {
    const button = document.createElement('span');
    button.innerHTML = label;

    if (cls) button.classList.add([].slice.call(cls.split(' ')));

    if (ariaLabel) button.setAttribute('aria-label', ariaLabel);

    this._attachButtonHandlers(button, command);

    return button;
}

MathField.prototype._updateCommandBar = function() {
    if (!this.blurred && this.commandBarVisible) {
        this.textarea.select();
        this.commandBar.style.visibility = 'visible';
        this.commandButtons.textContent = '';
        // let content = '';
        // content += '<span>bold</span><span>solve</span><span>&#x21e2;</span>';
        // content += '<span class="ML__round">&#8943;</span></div>';
        // content += '<div>color: #566778</div>';
        // content += '<div>gap: #566778</div>';

        const commands = Commands.suggest(
            this.mathlist.parseMode(), 
            '' /* environment */, 
            '' /* modifiers */, 
            this.mathlist.parent(),
            this.mathlist.extractGroupBeforeSelection(), 
            this.mathlist.extractContents(),
            this.mathlist.extractGroupAfterSelection());


        for (const command of commands) {
            const button  = this._makeButton(
                command.label, 
                command.cls,
                command.ariaLabel,
                command.selector);
            this.commandButtons.appendChild(button);
        }
    } else {
        this.commandBar.style.visibility = 'hidden';
    }
}

MathField.prototype.toggleCommandBar_ = function() {
    this.commandBarVisible = !this.commandBarVisible;

    // If the commanbar toggle was tapped, switch the focus to the mathfield
    // To trigger the keyboard reveal on iOS, this needs to be done from 
    // an invocation of a user action (mousedown)
    if (this.commandBarVisible) this.focus();

    this._updateCommandBar();
}

MathField.prototype.hasFocus = function() {
    return document.hasFocus() && document.activeElement === this.textarea;
}

MathField.prototype.focus = function() {
    if (!this.hasFocus()) {
        // this.textarea.focus();
        this.textarea.select();
        this._render();
    }
}

MathField.prototype.blur = function() {
    if (this.hasFocus()) {
        this.textarea.blur();
        this._render();
    }
}

MathField.prototype.select = function() {
    this.mathlist.selectAll_();
}

MathField.prototype.clearSelection = function() {
    this.mathlist.delete_();
}


/**
 * @param {string} keys A whitespace delimited list of key inputs
 * See https://www.w3.org/TR/2012/WD-DOM-Level-3-Events-20120614/#fixed-virtual-key-codes
 * @method module:editor/mathfield.MathField#keystroke
 */
MathField.prototype.keystroke = function(keys) {
    // This is the public API, while onKeystroke is the 
    // internal handler
    this._onKeystroke(keys);
}

/**
 * Simulate a user typing the keys indicated by text.
 * @method module:editor/mathfield.MathField#typedText
 */
MathField.prototype.typedText = function(text) {
    // This is the public API, while onTypedText is the 
    // internal handler
    this._onTypedText(text);
}


/**
 * @callback mathfieldCallback
 * @param {Mathfield}
 *
 * @callback mathfieldWithDirectionCallback
 * @param {Mathfield}
 * @param {number} direction
 * @return {boolean} False to suppress default behavior.
 */

/**
 * @param {Object} config
 * 
 * @param {*} config.substituteTextArea - A function that returns a focusable element
 * that can be used to capture text input.
 * 
 * @param {mathfieldCallback} config.onFocus - Invoked when the mathfield has been focused
 * 
 * @param {mathfieldCallback} config.onBlur - Invoked when the mathfield has been blurred
 * 
 * @param {boolean} config.overrideDefaultInlineShorctus - If true, the default 
 * inline shortcuts (e.g. 'p' + 'i' = 'π') are ignored. Default false.
 * 
 * @param {Object} config.inlineShortcuts - A map of shortcuts -> replacement value.
 * For example `{ 'pi': '\\pi'}`. If `overrideDefaultInlineShorcuts` is false, 
 * these shortcuts are applied after any default ones, and can therefore replace
 * them.
 * 
 * @param {mathfieldWithDirectionCallback} config.onMoveOutOf - A handler called when 
 * keyboard navigation would cause the insertion point to leave the mathfield.
 * 
 * By default, the insertion point will wrap around.
 * 
 * @param {mathfieldWithDirectionCallback} config.onTabOutOf - A handler called when 
 * pressing tab (or shift-tab) would cause the insertion point to leave the mathfield.
 * 
 * By default, the insertion point jumps to the next point of interest.
 * 
 * @param {mathfieldWithDirectionCallback} config.onDeleteOutOf - A handler called when 
 * deleting an item would cause the insertion point to leave the mathfield.
 * 
 * By default, nothing happens. @todo
 * 
 * @param {mathfieldWithDirectionCallback} config.onSelectOutOf - A handler called when 
 * the selection is extended so that it would cause the insertion point to 
 * leave the mathfield.
 * 
 * By default, nothing happens. @todo
 * 
 * @param {mathfieldCallback} config.onUpOutOf - A handler called when 
 * the up arrow key is pressed with no element to navigate to.
 * 
 * By default, nothing happens. @todo
 * 
 * @param {mathfieldCallback} config.onDownOutOf - A handler called when 
 * the up down key is pressed with no element to navigate to.
 * 
 * By default, nothing happens. @todo
 * 
 * @param {mathfieldCallback} config.onEnter - A handler called when 
 * the enter/return key is pressed and it is not otherwise handled. @todo
 * 
 * @param {mathfieldCallback} config.onContentWillChange - A handler called 
 * just before the content is about to be changed. @todo
 * 
 * @param {mathfieldCallback} config.onContentDidChange - A handler called 
 * just after the content has been changed.@todo
 * 
 * @param {mathfieldCallback} config.onSelectionWillChange - A handler called 
 * just before the selection is about to be changed.
 * 
 * @param {mathfieldCallback} config.onSelectionDidChange - A handler called  
 * just after the selection has been changed.
 * 
 * @method module:editor/mathfield.MathField#config
 */
MathField.prototype.config = function(config) {
    const def = {
        // If true, spacebar and shift-spacebar escape from the current block
        spacesBehavesLikeTab: false,
        // leftRightIntoCmdGoes: 
    }

    // Copy the values from `config` to `def`
    for (const c in config) {
        if (config.hasOwnProperty(c)) {
            def[c] = config[c];
        }
    }

    this.config = def;
}

return {
    MathField: MathField
}


})
