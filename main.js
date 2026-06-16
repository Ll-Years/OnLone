/* Regex-Replace 插件
 * 版本：Ver 2.4.8 20260615
 * 更新日志：
 * v2.4.8: 未修复"全部替换"后不自动关闭窗口；未修复正则组替换异常(多余文本未清除)；未修复删除按钮高亮状态同步
 * v2.4.7: 未修复全部替换后不自动关闭窗口；未修复正则组替换异常(多余文本未清除)；禁用窗口关闭动画；修复删除按钮高亮状态同步
 * v2.4.6: 修复单个替换时正则组引用解析错误(改用 collectMatches)；修复删除按钮高亮不同步；优化关闭窗口速度(提前清除高亮和定时器)；确保全部替换后关闭窗口并提示
 * v2.4.5: 修复全文替换撤销步骤问题(改为整体替换，一次性撤销)；完善代码注释；按钮行等距布局
 * v2.4.4: 修复转义符 \\t 替换为 Tab 字符；优化替换逻辑注释
 * v2.4.3: 修复组引用($1,$2)未解析问题；修复单个替换时组引用失效；替换后关闭窗口；自动填充选中文本(短)或启用替换选中(长)；预览标题居中；按钮行防溢出
 * v2.4.2: 重构替换逻辑，全文替换改用 replaceRange 逐匹配替换以保留撤销历史；修复"替换选中"仅影响选区；修复删除按钮高亮联动；按钮行改为等距分布；统一按钮激活样式
 * v2.4.1: 新增"替换"按钮(单个替换，关闭窗口)；实现编辑器全局匹配高亮；修复按钮状态联动；优化布局防溢出；修正版本日期错误
 * v2.4.0: 新增"查找"按钮；优化预览截断逻辑；统一输入框圆角样式并加强覆盖；添加防抖减少高频计算
 * v2.3.1: 修复 initializeFromSelection 未定义导致的错误；删除历史记录后刷新按钮状态；完善 CSS 注释
 * v2.3: 修复预览开关状态刷新问题；修复关闭预览时统计和错误提示消失问题；实现"全部替换"按钮状态动态切换；汉化界面文本
 */
var v = Object.defineProperty;
var f = Object.getOwnPropertyDescriptor;
var E = Object.getOwnPropertyNames;
var w = Object.prototype.hasOwnProperty;

// 对象属性合并工具函数
var b = (o, a) => {
    for (var e in a) v(o, e, { get: a[e], enumerable: !0 });
},
R = (o, a, e, t) => {
    if ((a && typeof a == "object") || typeof a == "function")
        for (let i of E(a))
            !w.call(o, i) &&
            i !== e &&
            v(o, i, {
                get: () => a[i],
                enumerable: !(t = f(a, i)) || t.enumerable,
            });
    return o;
};
var y = (o) => R(v({}, "__esModule", { value: !0 }), o);
var T = {};
b(T, { default: () => m });
module.exports = y(T);

var c = require("obsidian"),
    C = {
        defaultFlags: "g",
        historyLimit: 10,
        showPreview: !0,
        recentPatterns: [],
    },
    /**
     * 正则表达式处理工具类
     * 提供正则编译、替换、匹配收集等功能
     */
    g = class {
        // 编译正则表达式
        static compile(a, e) {
            try {
                return new RegExp(a, e);
            } catch (t) {
                return null;
            }
        }
        // 处理替换字符串中的转义符：\n、\t、\r
        static processReplacement(a) {
            return a
                .replace(/\\n/g, "\n")
                .replace(/\\t/g, "\t")
                .replace(/\\r/g, "\r");
        }
        // 生成预览：展示替换前后的文本片段(基于第一个匹配位置附近)
        static preview(a, e, t, i) {
            let s = this.compile(e, i);
            if (!s) return { error: "无效的正则表达式" };
            try {
                let r = this.processReplacement(t),
                    n = a.replace(s, r),
                    l = this.collectMatches(a, e, r, i);
                return { original: a, replaced: n, matchCount: l.length, matches: l };
            } catch (r) {
                return { error: String(r) };
            }
        }
        // 收集所有匹配项，并计算每个匹配对应的替换文本(正确解析 $1 等组引用)
        // 修复：使用全局正则确保正确匹配，单独替换时直接应用替换字符串
        static collectMatches(a, e, t, i) {
            let s = [],
                // 确保使用全局标志进行匹配收集
                r = i.includes("g") ? i : i + "g",
                n = new RegExp(e, r),
                l = i.replace("g", ""),
                p,
                processedReplacement = this.processReplacement(t);
            while ((p = n.exec(a)) !== null) {
                let h = p[0],
                    // 修复：单个替换时直接使用替换字符串，避免重新编译正则导致匹配逻辑变化
                    // 使用 String.replace 方法正确处理 $1 等组引用
                    u = h.replace(new RegExp(e, i), processedReplacement);
                s.push({ index: p.index, length: h.length, match: h, replacement: u });
                if (p.index === n.lastIndex) n.lastIndex++;
            }
            return s;
        }
        // 执行完整替换(用于整体替换)
        static execute(a, e, t, i) {
            let s = this.compile(e, i);
            if (!s) return { error: "无效的正则表达式" };
            try {
                let r = this.processReplacement(t);
                return a.replace(s, r);
            } catch (r) {
                return { error: String(r) };
            }
        }
    },
    /**
     * 正则替换弹窗类
     * 负责界面渲染、用户交互、实时预览和替换操作
     */
    d = class extends c.Modal {
        constructor(e, t, i) {
            super(e);
            this.selectionOnly = !1;
            this.plugin = t;
            this.editor = i;
            this.debounceTimer = null;
            this.matchMarks = [];
        }
        onOpen() {
            let { contentEl: e } = this;
            e.addClass("regex-replace-modal");
            this.createSearchField(e);
            this.createReplaceField(e);
            this.createFlagsSection(e);
            this.createMatchCount(e);
            this.createPreviewSection(e);
            this.autoFillFromSelection();
            this.searchInput.focus();
            this.updatePreview();
            this.updateActionButtonsState();
            this.highlightAllMatches();
        }
        // 根据选中文本自动填充或启用"替换选中"
        autoFillFromSelection() {
            let selectedText = this.editor.getSelection();
            if (!selectedText) return;
            const THRESHOLD = 100;
            if (selectedText.length < THRESHOLD) {
                this.searchInput.value = selectedText;
            } else {
                this.flagSelection.checked = true;
                this.selectionOnly = true;
            }
        }
        createSearchField(e) {
            let t = e.createDiv({ cls: "regex-replace-field" });
            this.searchInput = t.createEl("input", {
                type: "text",
                placeholder: "搜索：输入文本、表达式 (如: \\d+)",
                cls: "regex-replace-input",
            });
            this.searchInput.addEventListener("input", () => {
                if (this.debounceTimer) clearTimeout(this.debounceTimer);
                this.debounceTimer = setTimeout(() => {
                    this.updatePreview();
                    this.updateActionButtonsState();
                    this.highlightAllMatches();
                }, 300);
            });
        }
        createReplaceField(e) {
            let t = e.createDiv({ cls: "regex-replace-field" });
            this.replaceInput = t.createEl("input", {
                type: "text",
                placeholder: "替换：输入文本、规则 (支持:\\n, \\r, \\t, $1…)",
                cls: "regex-replace-input",
            });
            this.replaceInput.addEventListener("input", () => {
                if (this.debounceTimer) clearTimeout(this.debounceTimer);
                this.debounceTimer = setTimeout(() => this.updatePreview(), 300);
            });
        }
        createFlagsSection(e) {
            let t = e.createDiv({ cls: "regex-replace-flags" });
            let i = t.createDiv({ cls: "regex-replace-flags-wrapper" }),
                s = this.plugin.settings.defaultFlags;
            this.flagGlobal = this.createFlagCheckbox(i, "g 全局", s.includes("g"));
            this.flagMultiline = this.createFlagCheckbox(
                i,
                "m 多行",
                s.includes("m"),
            );
            this.flagCase = this.createFlagCheckbox(
                i,
                "i 忽略大小写",
                s.includes("i"),
            );
            this.flagSelection = this.createFlagCheckbox(i, "替换选中", !1);
            this.flagPreview = this.createFlagCheckbox(
                i,
                "预览",
                this.plugin.settings.showPreview,
            );
            let r = t.createDiv({ cls: "regex-replace-buttons" });
            this.createHistoryDropdown(r);
            this.createDeleteButton(r);
            this.findButton = r.createEl("button", {
                text: "查找",
                cls: "regex-replace-find-btn",
            });
            this.findButton.addEventListener("click", () => {
                this.findNextMatch();
            });
            this.replaceOneButton = r.createEl("button", {
                text: "替换",
                cls: "regex-replace-replaceone-btn",
            });
            this.replaceOneButton.addEventListener("click", () => {
                this.replaceOne();
            });
            this.replaceAllButton = r.createEl("button", {
                text: "全部替换",
                cls: "mod-cta",
            });
            this.replaceAllButton.addEventListener("click", () => {
                this.performReplace();
            });
            r.createEl("button", { text: "关闭" }).addEventListener("click", () =>
                this.close(),
            );
        }
        // 历史记录下拉框
        createHistoryDropdown(e) {
            let t = this.plugin.settings.recentPatterns;
            this.historySelect = e.createEl("select", {
                cls: "regex-replace-history-select",
            });
            this.historySelect.createEl("option", {
                text: "选择历史项目",
                value: "",
            });
            t.forEach((r, n) => {
                this.historySelect.createEl("option", {
                    text: `${r.search} → ${r.replace}`,
                    value: String(n),
                });
            });
            this.historySelect.addEventListener("change", (r) => {
                let n = parseInt(r.target.value);
                if (isNaN(n)) {
                    this.updateDeleteBtnState(false);
                    return;
                }
                this.loadPattern(t[n]);
                // 选中历史记录后，高亮删除按钮
                this.updateDeleteBtnState(true);
            });
        }
        // 删除按钮
        createDeleteButton(e) {
            this.deleteBtn = e.createEl("button", {
                text: "删除",
                cls: "regex-replace-delete-btn",
            });
            this.deleteBtn.addEventListener("click", async () => {
                let idx = this.historySelect ? parseInt(this.historySelect.value) : -1;
                if (!isNaN(idx) && idx >= 0) {
                    await this.deleteHistory(idx);
                }
            });
            this.updateDeleteBtnState(false);
        }
        // 修复：确保高亮状态正确应用
        updateDeleteBtnState(e, t) {
            if (!this.deleteBtn) return;
            if (e) {
                this.deleteBtn.classList.add("active");
            } else {
                this.deleteBtn.classList.remove("active");
            }
        }
        async deleteHistory(e) {
            let t = this.plugin.settings.recentPatterns;
            if (t[e]) {
                t.splice(e, 1);
                await this.plugin.saveSettings();
                new c.Notice("已删除该记录");
                this.refreshHistoryDropdown();
                // 删除后清除高亮状态
                this.updateDeleteBtnState(false);
                this.searchInput.value = "";
                this.replaceInput.value = "";
                this.updatePreview();
                this.updateActionButtonsState();
                this.highlightAllMatches();
            }
        }
        refreshHistoryDropdown() {
            if (!this.historySelect) return;
            this.historySelect.empty();
            this.historySelect.createEl("option", {
                text: "选择历史项目",
                value: "",
            });
            let newList = this.plugin.settings.recentPatterns;
            newList.forEach((r, n) => {
                this.historySelect.createEl("option", {
                    text: `${r.search} → ${r.replace}`,
                    value: String(n),
                });
            });
            this.historySelect.value = "";
        }
        createFlagCheckbox(e, t, i) {
            let s = e.createEl("label", { cls: "regex-replace-flag-label" }),
                r = s.createEl("input", { type: "checkbox" });
            r.checked = i;
            s.appendText(` ${t}`);
            r.addEventListener("change", (l) => {
                if (t === "替换选中") {
                    this.selectionOnly = l.target.checked;
                    this.updatePreview(); // 切换后刷新预览
                } else if (t === "预览") {
                    this.plugin.settings.showPreview = l.target.checked;
                    this.plugin.saveSettings();
                    if (l.target.checked) {
                        this.createPreviewSection(this.contentEl);
                    } else {
                        if (this.previewContainer) {
                            this.previewContainer.detach();
                            this.previewContainer = null;
                            this.previewEl = null;
                        }
                    }
                    this.updatePreview();
                }
                this.highlightAllMatches();
            });
            return r;
        }
        createMatchCount(e) {
            this.matchCountEl = e.createDiv({ cls: "regex-replace-match-count" });
        }
        createPreviewSection(e) {
            if (this.previewContainer) {
                this.previewContainer.detach();
            }
            if (!this.plugin.settings.showPreview) {
                this.previewContainer = null;
                this.previewEl = null;
                return;
            }
            this.previewContainer = e.createDiv({
                cls: "regex-replace-preview-container",
            });
            this.previewEl = this.previewContainer.createDiv({
                cls: "regex-replace-preview",
            });
        }
        loadPattern(e) {
            this.searchInput.value = e.search;
            this.replaceInput.value = e.replace;
            this.flagGlobal.checked = e.flags.includes("g");
            this.flagCase.checked = e.flags.includes("i");
            this.flagMultiline.checked = e.flags.includes("m");
            this.updatePreview();
            this.updateActionButtonsState();
            this.highlightAllMatches();
        }
        getFlags() {
            let e = "";
            this.flagGlobal.checked && (e += "g");
            this.flagCase.checked && (e += "i");
            this.flagMultiline.checked && (e += "m");
            return e;
        }
        getText() {
            return this.selectionOnly && this.editor.getSelection()
                ? this.editor.getSelection()
                : this.editor.getValue();
        }
        updatePreview() {
            let e = this.searchInput.value,
                t = this.replaceInput.value,
                i = this.getFlags();
            if (!e) {
                this.matchCountEl.setText("");
                this.matchCountEl.removeClass("regex-replace-error");
                if (this.previewEl) {
                    this.previewEl.empty();
                    this.previewEl.setText("输入搜索项以查看预览");
                }
                return;
            }
            let fullText = this.getText();
            let regex = g.compile(e, i);
            if (!regex) {
                this.showError("无效的正则表达式");
                if (this.previewEl) this.previewEl.empty();
                return;
            }
            let allMatches = g.collectMatches(fullText, e, t, i);
            this.showResult({ matchCount: allMatches.length });
            if (!this.previewEl) return;
            if (allMatches.length === 0) {
                this.previewEl.empty();
                this.previewEl.setText("未找到匹配项");
                return;
            }
            // 从首个匹配附近截取预览内容(不影响全文统计)
            let firstMatch = allMatches[0];
            let previewStart = Math.max(0, firstMatch.index - 200);
            let previewEnd = Math.min(
                fullText.length,
                firstMatch.index + firstMatch.length + 800,
            );
            let previewText = fullText.substring(previewStart, previewEnd);
            let adjustedMatches = g.collectMatches(previewText, e, t, i);
            let previewResult = {
                original: previewText,
                replaced: previewText.replace(regex, g.processReplacement(t)),
                matchCount: adjustedMatches.length,
                matches: adjustedMatches,
            };
            this.renderPreview(previewResult);
        }
        showError(e) {
            this.matchCountEl.setText(`错误: ${e}`);
            this.matchCountEl.addClass("regex-replace-error");
        }
        showResult(e) {
            this.matchCountEl.removeClass("regex-replace-error");
            this.matchCountEl.setText(`全局匹配：${e.matchCount} 个`);
        }
        renderPreview(e) {
            if (!this.previewEl) return;
            this.previewEl.empty();
            if (e.matchCount === 0) {
                this.previewEl.setText("未找到匹配项");
                return;
            }
            let i = e.original,
                s = this.previewEl.createDiv({ cls: "regex-replace-preview-original" });
            s.createEl("strong", { text: "========== 替换前 ==========" });
            let r = s.createDiv({ cls: "regex-replace-highlight-content" });
            this.renderHighlightedText(r, i, e.matches, 1e3);
            let n = this.previewEl.createDiv({
                cls: "regex-replace-preview-replaced",
            });
            n.createEl("strong", { text: "========== 替换后 ==========" });
            let l = n.createDiv({ cls: "regex-replace-highlight-content" });
            this.renderReplacedText(l, i, e.matches, 1e3);
            this.renderMatchList(e.matches);
        }
        renderHighlightedText(e, t, i, s) {
            let r = 0,
                n = t.substring(0, s);
            for (let l of i) {
                if (l.index >= s) break;
                l.index > r && e.createSpan({ text: n.substring(r, l.index) });
                let p = Math.min(l.index + l.length, s);
                e.createSpan({
                    text: n.substring(l.index, p),
                    cls: "regex-replace-highlight-match",
                });
                r = l.index + l.length;
            }
            r < n.length && e.createSpan({ text: n.substring(r) });
            t.length > s &&
                e.createSpan({ text: "...", cls: "regex-replace-truncated" });
        }
        renderReplacedText(e, t, i, s) {
            let r = this.buildReplacementSegments(t, i),
                n = 0;
            for (let p of r) {
                if (n >= s) break;
                let h = s - n,
                    u = p.text.substring(0, h);
                e.createSpan({
                    text: u,
                    cls: p.isReplacement ? "regex-replace-highlight-replacement" : void 0,
                });
                n += u.length;
            }
            r.reduce((p, h) => p + h.text.length, 0) > s &&
                e.createSpan({ text: "...", cls: "regex-replace-truncated" });
        }
        buildReplacementSegments(e, t) {
            let i = [],
                s = 0;
            for (let r of t) {
                r.index > s &&
                    i.push({ text: e.substring(s, r.index), isReplacement: !1 });
                i.push({ text: r.replacement, isReplacement: !0 });
                s = r.index + r.length;
            }
            s < e.length && i.push({ text: e.substring(s), isReplacement: !1 });
            return i;
        }
        renderMatchList(e) {
            if (e.length === 0) return;
            let t = this.previewEl.createDiv({ cls: "regex-replace-match-list" });
            t.createEl("strong", { text: `预览匹配：${e.length} 个` });
            let i = t.createEl("ul"),
                s = e.slice(0, 10);
            for (let r of s) {
                let n = i.createEl("li");
                n.createEl("span", {
                    text: `"${this.truncate(r.match, 30)}"`,
                    cls: "regex-replace-match-text",
                });
                n.createEl("span", { text: " → " });
                n.createEl("span", {
                    text: `"${this.truncate(r.replacement, 30)}"`,
                    cls: "regex-replace-replacement-text",
                });
            }
            e.length > 10 &&
                i.createEl("li", {
                    text: `... 及其他 ${e.length - 10} 项`,
                    cls: "regex-replace-more",
                });
        }
        truncate(e, t) {
            return e.length <= t ? e : e.substring(0, t) + "...";
        }
        updateActionButtonsState() {
            let searchText = this.searchInput.value;
            let flags = this.getFlags();
            let regex = g.compile(searchText, flags);
            let isValid = searchText && regex;
            // 统一按钮样式逻辑
            let btns = [
                this.findButton,
                this.replaceOneButton,
                this.replaceAllButton,
            ];
            btns.forEach((btn) => {
                if (btn) {
                    if (isValid) {
                        btn.classList.add("active");
                    } else {
                        btn.classList.remove("active");
                    }
                }
            });
        }
        // 查找下一个匹配，并滚动到视图
        findNextMatch() {
            let searchText = this.searchInput.value;
            let flags = this.getFlags();
            let regex = g.compile(searchText, flags);
            if (!searchText || !regex) {
                new c.Notice("请输入有效的正则表达式");
                return;
            }
            let globalFlags = flags.includes("g") ? flags : flags + "g";
            let globalRegex = new RegExp(regex.source, globalFlags);
            let docText = this.editor.getValue();
            let cursor = this.editor.getCursor();
            let startOffset = this.editor.posToOffset(cursor);
            globalRegex.lastIndex = startOffset;
            let match = globalRegex.exec(docText);
            if (!match && startOffset > 0) {
                globalRegex.lastIndex = 0;
                match = globalRegex.exec(docText);
            }
            if (match) {
                let from = this.editor.offsetToPos(match.index);
                let to = this.editor.offsetToPos(match.index + match[0].length);
                this.editor.setSelection(from, to);
                this.editor.scrollIntoView({ from, to }, true);
            } else {
                new c.Notice("未找到匹配项");
            }
        }
        // 替换单个匹配(使用 collectMatches 确保组引用正确解析，替换后关闭窗口)
        async replaceOne() {
            let searchText = this.searchInput.value;
            let replaceText = this.replaceInput.value;
            let flags = this.getFlags();
            let regex = g.compile(searchText, flags);
            if (!searchText || !regex) {
                new c.Notice("请输入有效的正则表达式");
                return;
            }
            let docText = this.editor.getValue();
            let cursor = this.editor.getCursor();
            let startOffset = this.editor.posToOffset(cursor);
            let globalFlags = flags.includes("g") ? flags : flags + "g";
            let globalRegex = new RegExp(regex.source, globalFlags);
            globalRegex.lastIndex = startOffset;
            let match = globalRegex.exec(docText);
            if (!match && startOffset > 0) {
                globalRegex.lastIndex = 0;
                match = globalRegex.exec(docText);
            }
            if (match) {
                // 使用 collectMatches 获取正确的替换文本(支持组引用和后顾断言)
                let allMatches = g.collectMatches(
                    docText,
                    searchText,
                    replaceText,
                    flags,
                );
                // 找到与当前匹配位置对应的替换项
                let targetMatch = allMatches.find((m) => m.index === match.index);
                if (!targetMatch) {
                    new c.Notice("无法定位匹配项");
                    return;
                }
                let replacement = targetMatch.replacement;
                let from = this.editor.offsetToPos(match.index);
                let to = this.editor.offsetToPos(match.index + match[0].length);
                this.editor.replaceRange(replacement, from, to);
                // 提前清除高亮和定时器，加快关闭速度
                this.clearHighlights();
                if (this.debounceTimer) clearTimeout(this.debounceTimer);
                new c.Notice(`已替换 1 个匹配项`);
                this.close();
            } else {
                new c.Notice("未找到匹配项");
            }
        }
        // 执行替换：选中替换或全文整体替换(一次性撤销，替换后关闭窗口)
        async performReplace() {
            let searchText = this.searchInput.value;
            let replaceText = this.replaceInput.value;
            let flags = this.getFlags();
            if (!searchText) {
                new c.Notice("请输入搜索项目");
                return;
            }
            let regex = g.compile(searchText, flags);
            if (!regex) {
                new c.Notice("无效的正则表达式");
                return;
            }
            // 处理替换选中模式
            if (this.selectionOnly && this.editor.getSelection()) {
                let sel = this.editor.getSelection();
                let newSel = g.execute(sel, searchText, replaceText, flags);
                if (typeof newSel == "object" && "error" in newSel) {
                    new c.Notice(`错误: ${newSel.error}`);
                    return;
                }
                let from = this.editor.getCursor("from");
                let to = this.editor.getCursor("to");
                this.editor.replaceRange(newSel, from, to);
                let matchCount = (
                    sel.match(new RegExp(regex.source, flags + "g")) || []
                ).length;
                new c.Notice(`已替换选区中的 ${matchCount} 个匹配项`);
                await this.plugin.addToHistory({
                    search: searchText,
                    replace: replaceText,
                    flags: flags,
                    timestamp: Date.now(),
                });
                this.clearHighlights();
                if (this.debounceTimer) clearTimeout(this.debounceTimer);
                this.close();
                return;
            }
            // 全文替换：整体替换，一次撤销即可回退所有更改
            let fullText = this.editor.getValue();
            let newFullText = g.execute(fullText, searchText, replaceText, flags);
            if (typeof newFullText == "object" && "error" in newFullText) {
                new c.Notice(`错误: ${newFullText.error}`);
                return;
            }
            if (fullText === newFullText) {
                new c.Notice("未找到匹配项");
                return;
            }
            // 整体替换文档内容
            this.editor.setValue(newFullText);
            let matchCount = (
                fullText.match(new RegExp(regex.source, flags + "g")) || []
            ).length;
            new c.Notice(`已替换 ${matchCount} 个匹配项`);
            await this.plugin.addToHistory({
                search: searchText,
                replace: replaceText,
                flags: flags,
                timestamp: Date.now(),
            });
            // 提前清除高亮和定时器，加快关闭速度
            this.clearHighlights();
            if (this.debounceTimer) clearTimeout(this.debounceTimer);
            // 立即关闭插件窗口 - 确保执行
            setTimeout(() => {
                this.close();
            }, 50);
        }
        // 高亮编辑器中所有匹配项
        highlightAllMatches() {
            this.clearHighlights();
            let searchText = this.searchInput.value;
            let flags = this.getFlags();
            let regex = g.compile(searchText, flags);
            if (!searchText || !regex) return;
            let globalFlags = flags.includes("g") ? flags : flags + "g";
            let globalRegex = new RegExp(regex.source, globalFlags);
            let docText = this.getText();
            let match;
            while ((match = globalRegex.exec(docText)) !== null) {
                let from = this.editor.offsetToPos(match.index);
                let to = this.editor.offsetToPos(match.index + match[0].length);
                let mark = this.editor.markText(from, to, {
                    cssClass: "regex-replace-highlight-match",
                });
                this.matchMarks.push(mark);
                if (globalRegex.lastIndex === match.index) globalRegex.lastIndex++;
            }
        }
        clearHighlights() {
            this.matchMarks.forEach((mark) => mark.clear());
            this.matchMarks = [];
        }
        onClose() {
            if (this.debounceTimer) clearTimeout(this.debounceTimer);
            this.clearHighlights();
            this.contentEl.empty();
        }
    },
    /**
     * 插件设置面板类
     */
    x = class extends c.PluginSettingTab {
        constructor(e, t) {
            super(e, t);
            this.plugin = t;
        }
        display() {
            let { containerEl: e } = this;
            e.empty();
            new c.Setting(e)
                .setName("默认标志")
                .setDesc("默认正则标志(g=全局匹配，m=多行模式，i=忽略大小写)")
                .addText((t) =>
                    t
                        .setPlaceholder("输入标志")
                        .setValue(this.plugin.settings.defaultFlags)
                        .onChange(async (i) => {
                            this.plugin.settings.defaultFlags = i.replace(/[^gim]/g, "");
                            await this.plugin.saveSettings();
                        }),
                );
            new c.Setting(e)
                .setName("显示预览")
                .setDesc("在替换对话框中显示前后预览")
                .addToggle((t) =>
                    t.setValue(this.plugin.settings.showPreview).onChange(async (i) => {
                        this.plugin.settings.showPreview = i;
                        await this.plugin.saveSettings();
                    }),
                );
            new c.Setting(e)
                .setName("记录上限")
                .setDesc("最大历史记录数量")
                .addSlider((t) =>
                    t
                        .setLimits(0, 50, 5)
                        .setValue(this.plugin.settings.historyLimit)
                        .setDynamicTooltip()
                        .onChange(async (i) => {
                            this.plugin.settings.historyLimit = i;
                            this.plugin.settings.recentPatterns =
                                this.plugin.settings.recentPatterns.slice(0, i);
                            await this.plugin.saveSettings();
                        }),
                );
            new c.Setting(e)
                .setName("清除历史")
                .setDesc("移除所有历史记录")
                .addButton((t) =>
                    t.setButtonText("清除").onClick(() => {
                        this.plugin.settings.recentPatterns = [];
                        this.plugin.saveSettings();
                        new c.Notice("历史记录已全部清除");
                    }),
                );
        }
    },
    /**
     * 插件主类
     */
    m = class extends c.Plugin {
        async onload() {
            await this.loadSettings();
            this.addCommand({
                id: "open-modal",
                name: "替换",
                editorCallback: (e, t) => {
                    new d(this.app, this, e).open();
                },
            });
            this.addCommand({
                id: "replace-in-selection",
                name: "替换选中",
                editorCallback: (e, t) => {
                    new d(this.app, this, e).open();
                },
            });
            this.addSettingTab(new x(this.app, this));
        }
        async loadSettings() {
            this.settings = Object.assign({}, C, await this.loadData());
        }
        async saveSettings() {
            await this.saveData(this.settings);
        }
        async addToHistory(e) {
            this.settings.recentPatterns = this.settings.recentPatterns.filter(
                (t) => t.search !== e.search || t.replace !== e.replace,
            );
            this.settings.recentPatterns.unshift(e);
            this.settings.recentPatterns = this.settings.recentPatterns.slice(
                0,
                this.settings.historyLimit,
            );
            await this.saveSettings();
        }
    };