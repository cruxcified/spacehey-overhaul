// ==UserScript==
// @name         SpaceHey BlogPad
// @namespace    spacehey-overhaul
// @version      1.1.0
// @description  Turns blog.spacehey.com/edit into a Windows 98 writing app: a real window with focus mode, live word count, and automatic drafts so you never lose a post.
// @author       Will
// @license      MIT
// @match        https://blog.spacehey.com/edit*
// @grant        none
// @run-at       document-idle
// @homepageURL  https://github.com/cruxcified/spacehey-overhaul
// @updateURL    https://raw.githubusercontent.com/cruxcified/spacehey-overhaul/main/spacehey-blogpad.user.js
// @downloadURL  https://raw.githubusercontent.com/cruxcified/spacehey-overhaul/main/spacehey-blogpad.user.js
// ==/UserScript==

/*
  How this works
  --------------
  SpaceHey's markup isn't something we control, so instead of guessing class
  names the script FINDS the pieces at runtime (the form, the editor, its
  toolbar, the writing area, the Publish button) and tags them with our own
  bp-* classes. All the styling targets those tags, so it keeps working even
  if SpaceHey renames things.

  It never moves the editor in the page (moving an editor iframe would wipe
  it). It only adds classes and inserts a few new elements around it.

  Drafts are saved in this browser only (localStorage on blog.spacehey.com).
*/

(function () {
  'use strict';

  const SETTINGS = {
    desktop: '#008080',      // desktop color behind the window
    titleA: '#000080',       // title bar gradient, left
    titleB: '#1084d0',       // title bar gradient, right
    paperLines: true,        // ruled lines in the writing area
    editorHeight: 480,       // writing area height in px
    pageWidth: 1400,         // max page width in px (same widescreen as the home page style)
    sideGutter: 3,           // space at the sides, in % of the window width
    autosaveSeconds: 3,
  };

  const DRAFT_KEY = 'bp-draft:' + location.pathname + location.search;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ------------------------------------------------------------------ */
  /* Styles                                                              */
  /* ------------------------------------------------------------------ */

  const BEVEL = {
    raised: 'inset -1px -1px #0a0a0a, inset 1px 1px #fff, inset -2px -2px #808080, inset 2px 2px #dfdfdf',
    window: 'inset -1px -1px #0a0a0a, inset 1px 1px #dfdfdf, inset -2px -2px #808080, inset 2px 2px #fff',
    sunken: 'inset -1px -1px #fff, inset 1px 1px #808080, inset -2px -2px #dfdfdf, inset 2px 2px #0a0a0a',
    pressed: 'inset -1px -1px #fff, inset 1px 1px #0a0a0a, inset -2px -2px #dfdfdf, inset 2px 2px #808080',
    thinUp: 'inset 1px 1px #fff, inset -1px -1px #808080',
    thinDown: 'inset 1px 1px #808080, inset -1px -1px #fff',
  };
  const UI_FONT = "'BP Sans', Tahoma, 'MS Sans Serif', Geneva, Verdana, sans-serif";
  const LINE = 24; // writing line height in px, the ruled lines follow it

  const paperBackground = (pad) => SETTINGS.paperLines
    ? `linear-gradient(90deg, transparent 38px, #f3b6b6 38px, #f3b6b6 39px, transparent 39px),
       repeating-linear-gradient(to bottom, transparent 0 ${LINE - 1}px, #dbe7f5 ${LINE - 1}px ${LINE}px)`
    : 'none';

  const CSS = `
  @font-face { font-family: 'BP Sans'; font-weight: normal;
    src: url('https://unpkg.com/98.css@0.1.21/dist/ms_sans_serif.woff2') format('woff2'); }
  @font-face { font-family: 'BP Sans'; font-weight: bold;
    src: url('https://unpkg.com/98.css@0.1.21/dist/ms_sans_serif_bold.woff2') format('woff2'); }

  /* Widescreen, same as the home page: grow with the window up to pageWidth. */
  html.bp-on .container { width: calc(100vw - ${SETTINGS.sideGutter * 2}vw) !important;
    max-width: ${SETTINGS.pageWidth}px !important; }
  .bp-stretch { width: 100% !important; max-width: none !important; margin-left: 0 !important;
    margin-right: 0 !important; float: none !important; box-sizing: border-box; }
  html.bp-on main { background: ${SETTINGS.desktop} !important; padding: 14px 0 22px !important; }

  /* Layout: tip window on the left, BlogPad window on the right. */
  .bp-row { display: grid !important; grid-template-columns: 230px minmax(0, 1fr); gap: 14px;
    align-items: start; width: 100% !important; padding: 0 12px; box-sizing: border-box;
    background: transparent !important; box-shadow: none !important; }
  .bp-row > * { display: block !important; width: auto !important; padding: 0 !important;
    float: none !important; background: transparent !important; box-shadow: none !important; }
  .bp-row > .bp-window { background: #c0c0c0 !important; }

  /* Window chrome */
  .bp-window, .bp-tip { position: relative; background: #c0c0c0 !important; color: #000;
    box-shadow: ${BEVEL.window} !important; border: 0 !important; padding: 3px !important;
    font-family: ${UI_FONT}; font-size: 12px; box-sizing: border-box; }
  .bp-titlebar { display: flex; align-items: center; gap: 4px; height: 20px; padding: 0 3px 0 6px;
    background: linear-gradient(90deg, ${SETTINGS.titleA}, ${SETTINGS.titleB}); color: #fff;
    font-weight: bold; font-size: 12px; user-select: none; }
  .bp-titlebar .bp-title { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bp-titlebar button { all: unset; box-sizing: border-box; width: 16px; height: 14px;
    background: #c0c0c0; box-shadow: ${BEVEL.raised}; color: #000; font: bold 10px/14px ${UI_FONT};
    text-align: center; cursor: default; }
  .bp-titlebar button:active { box-shadow: ${BEVEL.pressed}; }
  .bp-titlebar button:focus-visible { outline: 1px dotted #000; outline-offset: -3px; }
  .bp-body { padding: 10px 12px 12px; }
  .bp-window > :not(.bp-titlebar):not(.bp-statusbar):not(form) { margin-left: 12px !important; margin-right: 12px !important; }
  .bp-statusbar { display: flex; gap: 2px; margin-top: 2px; font-size: 11px; }
  .bp-statusbar > span { box-shadow: ${BEVEL.thinDown}; padding: 2px 6px; white-space: nowrap; }
  .bp-statusbar > span:last-child { flex: 1; overflow: hidden; text-overflow: ellipsis; }

  /* The stock form keeps its own markup; we just restyle it. */
  .bp-window form { margin: 0; }
  .bp-window h1, .bp-window h2 { font: bold 15px ${UI_FONT} !important; margin: 4px 0 12px !important;
    padding-bottom: 8px; border-bottom: 1px solid #808080; box-shadow: 0 1px 0 #fff; }
  .bp-window label:not(.bp-editor *), .bp-window p:not(.bp-editor *), .bp-window b:not(.bp-editor *) { font-family: ${UI_FONT}; }
  .bp-window u:not(.bp-editor *) { text-decoration: none; }
  .bp-window p:not(.bp-editor *) { font-size: 11px !important; color: #333; }

  .bp-window input[type=text]:not(.bp-editor *), .bp-window select:not(.bp-editor *) {
    font: 12px ${UI_FONT} !important; color: #000; background-color: #fff !important;
    border: 0 !important; border-radius: 0 !important; box-shadow: ${BEVEL.sunken} !important;
    padding: 3px 6px !important; box-sizing: border-box; }
  .bp-window input.bp-subject { height: 28px; font-size: 14px !important; width: 100% !important;
    margin: 6px 0 12px !important; }
  .bp-window input[type=text]:focus, .bp-window select:focus { outline: 1px dotted #000; outline-offset: -4px; }

  .bp-window input[type=radio]:not(.bp-editor *), .bp-window input[type=checkbox]:not(.bp-editor *) {
    -webkit-appearance: none; appearance: none; width: 13px; height: 13px; margin: 0 6px 0 0 !important;
    vertical-align: -2px; background: #fff; position: relative; cursor: default; }
  .bp-window input[type=radio]:not(.bp-editor *) { border-radius: 50%;
    box-shadow: inset 1px 1px #808080, inset -1px -1px #fff, inset 2px 2px #0a0a0a, inset -2px -2px #dfdfdf; }
  .bp-window input[type=radio]:checked::after { content: ''; position: absolute; inset: 4px; border-radius: 50%; background: #000; }
  .bp-window input[type=checkbox]:not(.bp-editor *) { box-shadow: ${BEVEL.sunken}; }
  .bp-window input[type=checkbox]:checked::after { content: '\\2714'; position: absolute; inset: 0;
    font-size: 10px; line-height: 13px; text-align: center; }
  .bp-window input[type=radio]:focus-visible, .bp-window input[type=checkbox]:focus-visible { outline: 1px dotted #000; outline-offset: 2px; }
  .bp-window label + input[type=radio] { margin-left: 14px !important; }

  .bp-btn, .bp-window .bp-publish { font: 12px ${UI_FONT} !important; color: #000 !important;
    min-width: 75px; min-height: 23px; padding: 0 12px !important; background: #c0c0c0 !important;
    border: 0 !important; border-radius: 0 !important; box-shadow: ${BEVEL.raised} !important; cursor: default; }
  .bp-btn:active, .bp-window .bp-publish:active { box-shadow: ${BEVEL.pressed} !important; }
  .bp-btn:focus-visible, .bp-window .bp-publish:focus-visible { outline: 1px dotted #000; outline-offset: -4px; }
  .bp-window .bp-publish { font-weight: bold !important; min-width: 150px; min-height: 28px;
    margin: 16px 0 4px !important; box-shadow: 0 0 0 1px #000, ${BEVEL.raised} !important; }
  .bp-window .publish { background: none !important; border: 0 !important; box-shadow: none !important; }

  /* The editor */
  .bp-editor { border: 0 !important; background: #c0c0c0 !important; box-shadow: ${BEVEL.raised} !important;
    padding: 3px !important; margin: 6px 0 14px !important; box-sizing: border-box; }
  .bp-toolbar { background: #c0c0c0 !important; border: 0 !important; box-shadow: ${BEVEL.thinUp} !important;
    padding: 2px 3px 2px 12px !important; margin: 0 0 3px !important; position: relative; height: auto !important;
    min-height: 0 !important; }
  .bp-toolbar::after, .bp-group::before, .bp-group::after { display: none !important; }
  .bp-toolbar::before { content: '' !important; display: block !important; position: absolute !important;
    left: 4px !important; right: auto !important; top: 4px !important; bottom: 4px !important;
    width: 3px !important; height: auto !important; background: none !important; box-shadow: ${BEVEL.thinUp}; }
  .bp-group { background: transparent !important; border: 0 !important; margin: 0 !important;
    padding: 0 5px 0 0 !important; box-shadow: none !important; }
  .bp-group + .bp-group { padding-left: 6px !important;
    background: linear-gradient(90deg, #808080 0 1px, #fff 1px 2px, transparent 2px) no-repeat left center / 2px 70% !important; }
  /* Toolbar buttons: flat, pop out on hover, press in when active.
     Only border/shadow/background COLOR change, so the editor's own icons stay. */
  .bp-tool { border: 1px solid transparent !important; border-radius: 0 !important;
    background-color: transparent !important; box-shadow: none !important; }
  .bp-tool:hover { box-shadow: ${BEVEL.thinUp} !important; }
  .bp-tool:active, .bp-tool.active, .bp-tool[class*="-active"] { box-shadow: ${BEVEL.thinDown} !important;
    background-color: #dfdfdf !important; }
  .bp-editor [class*="dropdown"]:not(.bp-tool) { background: #fff !important; border: 1px solid #000 !important;
    border-radius: 0 !important; box-shadow: 2px 2px 0 rgba(0,0,0,.35) !important; font-family: ${UI_FONT}; }
  .bp-editor [class*="dropdown"]:not(.bp-tool) button:hover { background: #000080 !important; color: #fff !important; }

  /* Writing area. An iframe gets the frame here and the paper inside it;
     a plain editable box gets both here. */
  .bp-paper { display: block; width: 100% !important; min-height: ${SETTINGS.editorHeight}px !important;
    border: 0 !important; outline: none; box-sizing: border-box; background-color: #fff !important;
    box-shadow: ${BEVEL.sunken} !important; }
  div.bp-paper, .bp-paper[contenteditable] { padding: 10px 14px 10px 52px !important; color: #000;
    font: 14px/${LINE}px Georgia, 'Times New Roman', serif !important;
    background-image: ${paperBackground()} !important; background-attachment: local !important;
    background-position: 0 10px !important; }
  div.bp-paper p { margin: 0 0 ${LINE}px !important; }
  .bp-editor > .bp-source { margin: 0 !important; }
  .bp-source { font-family: 'Lucida Console', 'Courier New', monospace !important;
    box-shadow: ${BEVEL.sunken} !important; border: 0 !important; min-height: ${SETTINGS.editorHeight}px !important; }

  /* Tip of the Day */
  .bp-tip .bp-tipbody { padding: 6px; }
  .bp-tip p { background: #ffffe1; box-shadow: ${BEVEL.sunken}; padding: 8px 9px !important;
    margin: 0 0 6px !important; font: 11px/1.45 ${UI_FONT} !important; color: #000; }
  .bp-tip a { color: #0000ee; text-decoration: underline; }

  /* Focus mode (the maximize button): the window fills the screen. */
  html.bp-focus { overflow: hidden; }
  html.bp-focus .bp-window { position: fixed !important; inset: 0; z-index: 9999; overflow: auto;
    display: flex !important; flex-direction: column; }
  html.bp-focus .bp-window > :not(.bp-titlebar):not(.bp-statusbar) { max-width: 900px; width: 100%;
    margin-left: auto !important; margin-right: auto !important; box-sizing: border-box; }
  html.bp-focus .bp-window > form { flex: 1; }
  html.bp-focus .bp-titlebar, html.bp-focus .bp-statusbar { position: sticky; z-index: 1; }
  html.bp-focus .bp-titlebar { top: 0; } html.bp-focus .bp-statusbar { bottom: 0; background: #c0c0c0; }

  /* Dialogs */
  .bp-dialog-back { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; background: rgba(0,0,0,.15); }
  .bp-dialog { min-width: 320px; max-width: min(460px, calc(100vw - 32px)); }
  .bp-dialog .bp-dialog-body { display: flex; gap: 12px; padding: 14px 12px 8px; align-items: flex-start; line-height: 1.5; }
  .bp-dialog .bp-icon { font-size: 26px; line-height: 1; }
  .bp-dialog .bp-dialog-buttons { display: flex; justify-content: center; gap: 8px; padding: 6px 0 10px; }
  .bp-dialog kbd { font: inherit; padding: 0 3px; box-shadow: ${BEVEL.thinUp}; }

  @media (max-width: 30em) {
    .bp-row { grid-template-columns: 1fr; }
    .bp-statusbar > span:nth-child(2) { display: none; }
  }
  `;

  const IFRAME_CSS = `
    html { background: #fff; }
    body { margin: 0 !important; min-height: 100vh; box-sizing: border-box;
      padding: 10px 14px 10px 52px !important; color: #000;
      font: 14px/${LINE}px Georgia, 'Times New Roman', serif !important;
      background-color: #fff !important; background-image: ${paperBackground()} !important; background-attachment: local !important;
      background-position: 0 10px !important; }
    p { margin: 0 0 ${LINE}px !important; }
  `;

  /* ------------------------------------------------------------------ */
  /* Finding things on the page                                          */
  /* ------------------------------------------------------------------ */

  function findPaper(scope) {
    // Known editors first, then anything editable.
    const known = $('.trumbowyg-editor, .sceditor-container iframe, .ql-editor, .note-editable, .jodit-wysiwyg', scope);
    if (known) return known;
    for (const f of $$('iframe', scope)) {
      try {
        const d = f.contentDocument;
        if (d && d.body && (d.designMode === 'on' || d.body.isContentEditable)) return f;
      } catch (e) { /* cross-origin, not ours */ }
    }
    return $('[contenteditable=""], [contenteditable="true"]', scope);
  }

  const isTool = (el) => el.matches('button, [role="button"], a, li, span[onclick], div[onclick]');

  function findEditorRoot(paper, form) {
    const known = paper.closest('.trumbowyg-box, .sceditor-container, .wysiwyg, .note-editor, .jodit-container');
    if (known) return known;
    let el = paper.parentElement;
    while (el && el !== form) {
      const tools = $$('button, [role="button"], li, a', el).filter((t) => !paper.contains(t));
      if (tools.length >= 5) return el;
      el = el.parentElement;
    }
    return paper.parentElement;
  }

  function findToolbar(root, paper) {
    const known = $('.trumbowyg-button-pane, [class*="toolbar"], [role="toolbar"], ul.panel', root);
    if (known && !known.contains(paper)) return known;
    return Array.from(root.children).find((c) => !c.contains(paper) && $$('button, [role="button"], li, a', c).length >= 3) || null;
  }

  function commonAncestor(a, b) {
    const seen = new Set();
    for (let n = a; n; n = n.parentElement) seen.add(n);
    for (let n = b; n; n = n.parentElement) if (seen.has(n)) return n;
    return null;
  }
  const childOf = (ancestor, el) => { let n = el; while (n && n.parentElement !== ancestor) n = n.parentElement; return n; };

  /* ------------------------------------------------------------------ */
  /* Editor content                                                      */
  /* ------------------------------------------------------------------ */

  let paper, form, sourceArea;

  function paperDoc() {
    if (paper && paper.tagName === 'IFRAME') { try { return paper.contentDocument; } catch (e) { return null; } }
    return null;
  }
  function getHTML() {
    const d = paperDoc();
    if (d && d.body) return d.body.innerHTML;
    return paper ? paper.innerHTML : '';
  }
  function getText() {
    const d = paperDoc();
    return (d && d.body ? d.body.innerText : paper ? paper.innerText : '') || '';
  }
  const isBlank = (html) => !html || !html.replace(/<br\s*\/?>|&nbsp;|<\/?(p|div|span)[^>]*>|\s/gi, '');

  function setHTML(html) {
    // Prefer the editor's own API when it has one, so it stays in sync.
    const jq = window.jQuery;
    if (jq && sourceArea && jq.fn && jq.fn.trumbowyg && jq(sourceArea).data('trumbowyg')) {
      jq(sourceArea).trumbowyg('html', html);
      return;
    }
    const d = paperDoc();
    const target = d && d.body ? d.body : paper;
    target.innerHTML = html;
    if (sourceArea) sourceArea.value = html;
    for (const type of ['input', 'keyup', 'change']) target.dispatchEvent(new Event(type, { bubbles: true }));
  }

  /* ------------------------------------------------------------------ */
  /* Drafts                                                              */
  /* ------------------------------------------------------------------ */

  function readDraft() {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { return null; }
  }
  function writeDraft(d) {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); return true; } catch (e) { return false; }
  }
  const timeLabel = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dateLabel = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  /* ------------------------------------------------------------------ */
  /* UI helpers                                                          */
  /* ------------------------------------------------------------------ */

  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    Object.assign(n, props);
    for (const k of kids) n.append(k);
    return n;
  }

  function titleBar(title, buttons = []) {
    const bar = el('div', { className: 'bp-titlebar' }, el('span', { className: 'bp-title', textContent: title }));
    for (const b of buttons) {
      const btn = el('button', { type: 'button', textContent: b.label, title: b.title });
      btn.setAttribute('aria-label', b.title);
      btn.addEventListener('click', b.onClick);
      bar.append(btn);
    }
    return bar;
  }

  function dialog(title, icon, message, buttons) {
    return new Promise((resolve) => {
      const body = el('div', { className: 'bp-dialog-body' }, el('div', { className: 'bp-icon', textContent: icon }));
      const msg = el('div'); msg.innerHTML = message; body.append(msg);
      const btnRow = el('div', { className: 'bp-dialog-buttons' });
      const box = el('div', { className: 'bp-window bp-dialog', role: 'dialog' }, titleBar(title), body, btnRow);
      box.setAttribute('aria-modal', 'true');
      const back = el('div', { className: 'bp-dialog-back' }, box);
      const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(null); } };
      buttons.forEach((b, i) => {
        const btn = el('button', { type: 'button', className: 'bp-btn', textContent: b.label });
        if (i === 0) btn.style.boxShadow = '0 0 0 1px #000, ' + BEVEL.raised;
        btn.addEventListener('click', () => close(b.value));
        btnRow.append(btn);
      });
      document.addEventListener('keydown', onKey, true);
      document.body.append(back);
      btnRow.firstChild && btnRow.firstChild.focus();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Build                                                               */
  /* ------------------------------------------------------------------ */

  function build() {
    const style = el('style', { id: 'bp-style', textContent: CSS });
    document.head.append(style);

    const subject = $('input[name*="subject" i], input[name*="title" i], input[type="text"]', form);
    if (subject) subject.classList.add('bp-subject');

    // Editor pieces
    const root = findEditorRoot(paper, form);
    root.classList.add('bp-editor');
    paper.classList.add('bp-paper');
    const toolbar = findToolbar(root, paper);
    if (toolbar) {
      toolbar.classList.add('bp-toolbar');
      $$('button, [role="button"], li, a', toolbar).filter((t) => !$('button, [role="button"]', t)).forEach((t) => {
        if (/separator|divider/i.test(t.className)) return;
        t.classList.add('bp-tool');
      });
      const groups = Array.from(toolbar.children).filter((c) => !isTool(c) && $('button, [role="button"], li, a', c));
      if (groups.length > 1) groups.forEach((g) => g.classList.add('bp-group'));
    }
    sourceArea = $('textarea', root) || $('textarea', form);
    if (sourceArea && sourceArea !== paper && root.contains(sourceArea)) sourceArea.classList.add('bp-source');

    // Publish button: the form's submit button that isn't part of the editor.
    const publish = $$('button, input[type="submit"]', form).filter((b) => !root.contains(b))
      .find((b) => b.type === 'submit') || null;
    if (publish) publish.classList.add('bp-publish');

    // Window around the form's column, tip window beside it.
    const tip = $('.edit-info');
    let formCol = form;
    if (tip) {
      const row = commonAncestor(tip, form);
      if (row && row !== document.body && row.tagName !== 'MAIN') {
        row.classList.add('bp-row');
        // Anything between <main> and the row that limits the width gets
        // stretched, so the window really uses the whole page.
        for (let n = row.parentElement; n && n.tagName !== 'MAIN' && n !== document.body; n = n.parentElement) {
          n.classList.add('bp-stretch');
        }
        formCol = childOf(row, form) || form;
        const tipCol = childOf(row, tip);
        if (tipCol) tipCol.classList.add('bp-tipcol');
      }
      tip.classList.add('bp-tip');
      const tipBody = el('div', { className: 'bp-tipbody' });
      while (tip.firstChild) tipBody.append(tip.firstChild); // text and links only, safe to move
      tip.append(titleBar('Tip of the Day'), tipBody);
    }
    formCol.classList.add('bp-window');

    // Wrap the column's existing children visually: we only add a title bar
    // before and a status bar after, nothing gets moved.
    const isEdit = /[?&]id=/.test(location.search);
    const bar = titleBar('✎ BlogPad - ' + (isEdit ? 'Editing Entry' : 'New Entry'), [
      { label: '?', title: 'Help', onClick: showHelp },
      { label: '□', title: 'Focus mode (Esc to leave)', onClick: toggleFocus },
    ]);
    formCol.prepend(bar);
    // Give the form's own content some breathing room inside the window.
    form.classList.add('bp-body');

    const words = el('span', { textContent: 'Words: 0' });
    const saved = el('span', { textContent: 'Drafts save automatically' });
    const hint = el('span', { textContent: 'Ctrl/Cmd+S saves a draft now' });
    const status = el('div', { className: 'bp-statusbar' }, words, saved, hint);
    formCol.append(status);

    document.documentElement.classList.add('bp-on');

    // Style the inside of an iframe editor (re-done if the editor reloads it).
    const styleFrame = () => {
      const d = paperDoc();
      if (!d || !d.head || d.getElementById('bp-frame-style')) return;
      const s = d.createElement('style'); s.id = 'bp-frame-style'; s.textContent = IFRAME_CSS;
      d.head.append(s);
      d.addEventListener('keydown', onKeys, true);
    };
    if (paper.tagName === 'IFRAME') { styleFrame(); paper.addEventListener('load', () => setTimeout(styleFrame, 50)); }

    // Autosave + word count
    let last = '';
    const snapshot = () => JSON.stringify([subject ? subject.value : '', getHTML()]);
    function saveNow(manual) {
      const html = getHTML();
      const subj = subject ? subject.value : '';
      if (isBlank(html) && !subj.trim()) { if (manual) saved.textContent = 'Nothing to save yet'; return; }
      const ok = writeDraft({ subject: subj, html, t: Date.now(), submitted: false });
      saved.textContent = ok ? 'Draft saved ' + timeLabel(Date.now()) : 'Could not save a draft (storage full or blocked)';
      last = snapshot();
    }
    const countWords = () => {
      const text = getText().trim();
      words.textContent = 'Words: ' + (text ? text.split(/\s+/).length : 0).toLocaleString();
    };
    countWords();
    setInterval(countWords, 1000);
    setInterval(() => { if (snapshot() !== last) saveNow(false); }, SETTINGS.autosaveSeconds * 1000);

    form.addEventListener('submit', () => {
      const d = readDraft();
      if (d) { d.submitted = true; writeDraft(d); }
    });

    function onKeys(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(true); }
      if (e.key === 'Escape' && document.documentElement.classList.contains('bp-focus') && !$('.bp-dialog-back')) toggleFocus();
    }
    document.addEventListener('keydown', onKeys, true);

    // Offer to restore an unsent draft.
    const draft = readDraft();
    if (draft && !draft.submitted && !isBlank(draft.html) && draft.html !== getHTML()) {
      const editorHasText = !isBlank(getHTML());
      dialog('BlogPad', '💾',
        `You have an unsent draft from <b>${dateLabel(draft.t)}</b>${draft.subject ? ` called <b>${escapeHTML(draft.subject)}</b>` : ''}.<br>` +
        (editorHasText ? 'Restoring it will replace what is in the editor now.' : 'Do you want to restore it?'),
        [{ label: 'Restore', value: true }, { label: 'Discard', value: false }, { label: 'Not now', value: null }]
      ).then((v) => {
        if (v === true) {
          if (subject && draft.subject) subject.value = draft.subject;
          setHTML(draft.html);
          saved.textContent = 'Draft restored';
          countWords();
        } else if (v === false) {
          try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
        }
        last = snapshot();
      });
    } else {
      last = snapshot();
    }
  }

  function toggleFocus() { document.documentElement.classList.toggle('bp-focus'); }
  function showHelp() {
    dialog('BlogPad Help', 'ℹ️',
      '<b>Drafts</b> save automatically every few seconds, in this browser only. ' +
      'If you leave without publishing, BlogPad offers to bring the draft back next time.<br><br>' +
      '<kbd>Ctrl</kbd>+<kbd>S</kbd> (or <kbd>Cmd</kbd>+<kbd>S</kbd>) saves a draft right now.<br>' +
      'The <kbd>□</kbd> button is focus mode; <kbd>Esc</kbd> leaves it.',
      [{ label: 'OK', value: true }]);
  }
  const escapeHTML = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ------------------------------------------------------------------ */
  /* Start: wait for the editor to finish setting itself up              */
  /* ------------------------------------------------------------------ */

  let tries = 0;
  (function wait() {
    form = $$('form').find((f) => findPaper(f));
    if (form) paper = findPaper(form);
    if (form && paper) {
      try { build(); } catch (e) { console.error('[BlogPad] could not build:', e); }
      return;
    }
    if (++tries < 60) setTimeout(wait, 250);
    else console.warn('[BlogPad] editor not found, leaving the page stock.');
  })();
})();
