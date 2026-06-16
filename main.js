/* Regex-Replace 插件 - 完全重构版
 * 版本：Ver 2.6.0 20260616
 * 更新日志：
 * v2.6.0: 完全重构 - 修复替换按钮组引用异常(正确处理后向断言); 修复全部替换不关闭窗口; 修复预览关闭未停止计算; 修复高亮锁定侧边栏; 统一按钮行为
 * v2.5.0: 完全重写插件 - 修复全部替换不关闭窗口、替换按钮组引用异常、删除按钮状态不同步、预览功能停止计算等问题
 */

const obsidian = require("obsidian");

const DEFAULT_SETTINGS = {
    defaultFlags: "g",
    historyLimit: 10,
    showPreview: true,
    recentPatterns: [],
};

/**
 * 正则表达式引擎 - 纯净的正则处理，不依赖任何旧逻辑
 */
class RegexEngine {
    static compile(pattern, flags) {
        try {
            return new RegExp(pattern, flags);
        } catch (e) {
            return null;
        }
    }

    static processEscapes(text) {
        return text
            .replace(/\\n/g, "\n")
            .replace(/\\t/g, "\t")
            .replace(/\\r/g, "\r");
    }

    static collectMatches(text, pattern, replacement, flags) {
        try {
            const regex = this.compile(pattern, flags.includes("g") ? flags : flags + "g");
            if (!regex) return [];

            const matches = [];
            const processedReplacement = this.processEscapes(replacement);
            let match;

            while ((match = regex.exec(text)) !== null) {
                const fullMatch = match[0];
                const startIdx = match.index;
                const endIdx = startIdx + fullMatch.length;

                // 正确的替换方式：使用 String.replace 让引擎处理 $1 $2 等组引用
                const replaced = fullMatch.replace(
                    this.compile(pattern, flags),
                    processedReplacement
                );

                matches.push({
                    index: startIdx,
                    length: fullMatch.length,
                    match: fullMatch,
                    replacement: replaced,
                    endIndex: endIdx,
                });

                if (regex.lastIndex === match.index) {
                    regex.lastIndex++;
                }
            }
            return matches;
        } catch (e) {
            return [];
        }
    }

    static replaceAll(text, pattern, replacement, flags) {
        try {
            const regex = this.compile(pattern, flags);
            if (!regex) return { error: "无效的正则表达式" };
            const processed = this.processEscapes(replacement);
            return text.replace(regex, processed);
        } catch (e) {
            return { error: String(e) };
        }
    }
}

/**
 * 匹配收集器 - 管理匹配项的收集与计算
 */
class MatchCollector {
    constructor(text, pattern, replacement, flags) {
        this.text = text;
        this.pattern = pattern;
        this.replacement = replacement;
        this.flags = flags;
        this.allMatches = [];
        this.previewMatches = [];
        this.isValid = false;
        this.collect();
    }

    collect() {
        if (!this.pattern) return;
        const regex = RegexEngine.compile(this.pattern, this.flags);
        if (!regex) return;
        this.isValid = true;
        this.allMatches = RegexEngine.collectMatches(
            this.text,
            this.pattern,
            this.replacement,
            this.flags
        );
    }

    getPreviewMatches(maxLen = 1000) {
        if (this.allMatches.length === 0) return [];
        const firstMatch = this.allMatches[0];
        const start = Math.max(0, firstMatch.index - 200);
        const end = Math.min(this.text.length, firstMatch.endIndex + 800);
        const previewText = this.text.substring(start, end);
        return RegexEngine.collectMatches(previewText, this.pattern, this.replacement, this.flags);
    }
}

/**
 * 正则替换弹窗 - 完全重构的UI层
 */
class RegexReplaceModal extends obsidian.Modal {
    constructor(app, plugin, editor) {
        super(app);
        this.plugin = plugin;
        this.editor = editor;
        this.previewEnabled = plugin.settings.showPreview;
        this.selectionOnly = false;
        this.matchMarks = [];
        this.debounceTimer = null;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass("regex-replace-modal");
        contentEl.empty();

        // 构建UI
        this.buildSearchField(contentEl);
        this.buildReplaceField(contentEl);
        this.buildFlagsAndButtons(contentEl);
        this.buildMatchCount(contentEl);
        this.buildPreviewSection(contentEl);

        // 初始化
        this.autoFillSelection();
        this.searchInput.focus();
        this.refresh();
    }

    autoFillSelection() {
        const selected = this.editor.getSelection();
        if (!selected) return;
        if (selected.length <= 100) {
            this.searchInput.value = selected;
        } else {
            this.flagSelection.checked = true;
            this.selectionOnly = true;
        }
    }

    buildSearchField(container) {
        const fieldDiv = container.createDiv({ cls: "regex-replace-field" });
        this.searchInput = fieldDiv.createEl("input", {
            type: "text",
            placeholder: "搜索：输入文本、表达式 (如: \\d+)",
            cls: "regex-replace-input",
        });
        this.searchInput.addEventListener("input", () => this.onSearchChange());
    }

    buildReplaceField(container) {
        const fieldDiv = container.createDiv({ cls: "regex-replace-field" });
        this.replaceInput = fieldDiv.createEl("input", {
            type: "text",
            placeholder: "替换：输入文本、规则 (支持:\\n, \\r, \\t, $1…)",
            cls: "regex-replace-input",
        });
        this.replaceInput.addEventListener("input", () => this.onReplaceChange());
    }

    buildFlagsAndButtons(container) {
        const flagsDiv = container.createDiv({ cls: "regex-replace-flags" });
        const wrapperDiv = flagsDiv.createDiv({ cls: "regex-replace-flags-wrapper" });

        const defaults = this.plugin.settings.defaultFlags;
        this.flagGlobal = this.createCheckbox(wrapperDiv, "g 全局", defaults.includes("g"));
        this.flagMultiline = this.createCheckbox(wrapperDiv, "m 多行", defaults.includes("m"));
        this.flagCase = this.createCheckbox(wrapperDiv, "i 忽略大小写", defaults.includes("i"));
        this.flagSelection = this.createCheckbox(wrapperDiv, "替换选中", false);
        this.flagPreview = this.createCheckbox(wrapperDiv, "预览", this.previewEnabled);

        // 标志变化事件
        this.flagGlobal.addEventListener("change", () => this.refresh());
        this.flagMultiline.addEventListener("change", () => this.refresh());
        this.flagCase.addEventListener("change", () => this.refresh());
        this.flagSelection.addEventListener("change", () => {
            this.selectionOnly = this.flagSelection.checked;
            this.refresh();
        });
        this.flagPreview.addEventListener("change", () => {
            this.previewEnabled = this.flagPreview.checked;
            this.plugin.settings.showPreview = this.previewEnabled;
            this.plugin.saveSettings();
            if (this.previewContainer) {
                this.previewContainer.style.display = this.previewEnabled ? "block" : "none";
            }
            this.refresh();
        });

        // 按钮行
        const buttonsDiv = flagsDiv.createDiv({ cls: "regex-replace-buttons" });
        this.buildHistoryDropdown(buttonsDiv);
        this.buildDeleteButton(buttonsDiv);
        this.buildFindButton(buttonsDiv);
        this.buildReplaceOneButton(buttonsDiv);
        this.buildReplaceAllButton(buttonsDiv);
        this.buildCloseButton(buttonsDiv);
    }

    createCheckbox(container, label, checked) {
        const labelEl = container.createEl("label", { cls: "regex-replace-flag-label" });
        const checkboxEl = labelEl.createEl("input", { type: "checkbox" });
        checkboxEl.checked = checked;
        labelEl.appendText(` ${label}`);
        return checkboxEl;
    }

    buildHistoryDropdown(container) {
        this.historySelect = container.createEl("select", {
            cls: "regex-replace-history-select",
        });
        this.historySelect.createEl("option", {
            text: "选择历史项目",
            value: "",
        });
        this.plugin.settings.recentPatterns.forEach((pattern, index) => {
            this.historySelect.createEl("option", {
                text: `${pattern.search} → ${pattern.replace}`,
                value: String(index),
            });
        });
        this.historySelect.addEventListener("change", () => {
            const idx = parseInt(this.historySelect.value);
            if (isNaN(idx)) {
                this.updateDeleteButtonState(false);
                return;
            }
            const pattern = this.plugin.settings.recentPatterns[idx];
            this.searchInput.value = pattern.search;
            this.replaceInput.value = pattern.replace;
            this.flagGlobal.checked = pattern.flags.includes("g");
            this.flagCase.checked = pattern.flags.includes("i");
            this.flagMultiline.checked = pattern.flags.includes("m");
            this.updateDeleteButtonState(true);
            this.refresh();
        });
    }

    buildDeleteButton(container) {
        this.deleteBtn = container.createEl("button", {
            text: "删除",
            cls: "regex-replace-delete-btn",
        });
        this.deleteBtn.addEventListener("click", () => this.handleDelete());
        this.updateDeleteButtonState(false);
    }

    handleDelete() {
        const idx = parseInt(this.historySelect.value);
        if (isNaN(idx) || idx < 0) return;
        this.plugin.settings.recentPatterns.splice(idx, 1);
        this.plugin.saveSettings();
        new obsidian.Notice("已删除该记录");
        this.refreshHistoryDropdown();
        this.searchInput.value = "";
        this.replaceInput.value = "";
        this.updateDeleteButtonState(false);
        this.refresh();
    }

    refreshHistoryDropdown() {
        this.historySelect.empty();
        this.historySelect.createEl("option", {
            text: "选择历史项目",
            value: "",
        });
        this.plugin.settings.recentPatterns.forEach((pattern, index) => {
            this.historySelect.createEl("option", {
                text: `${pattern.search} → ${pattern.replace}`,
                value: String(index),
            });
        });
        this.historySelect.value = "";
    }

    updateDeleteButtonState(active) {
        if (!this.deleteBtn) return;
        if (active) {
            this.deleteBtn.classList.add("active");
        } else {
            this.deleteBtn.classList.remove("active");
        }
    }

    buildFindButton(container) {
        this.findBtn = container.createEl("button", {
            text: "查找",
            cls: "regex-replace-find-btn",
        });
        this.findBtn.addEventListener("click", () => this.handleFind());
    }

    handleFind() {
        const search = this.searchInput.value;
        const flags = this.getFlags();
        const regex = RegexEngine.compile(search, flags);
        if (!search || !regex) {
            new obsidian.Notice("请输入有效的正则表达式");
            return;
        }
        const docText = this.editor.getValue();
        const cursor = this.editor.getCursor();
        const startOffset = this.editor.posToOffset(cursor);
        const globalFlags = flags.includes("g") ? flags : flags + "g";
        const globalRegex = new RegExp(regex.source, globalFlags);
        globalRegex.lastIndex = startOffset;
        let match = globalRegex.exec(docText);
        if (!match && startOffset > 0) {
            globalRegex.lastIndex = 0;
            match = globalRegex.exec(docText);
        }
        if (match) {
            const from = this.editor.offsetToPos(match.index);
            const to = this.editor.offsetToPos(match.index + match[0].length);
            this.editor.setSelection(from, to);
            this.editor.scrollIntoView({ from, to }, true);
            new obsidian.Notice(`找到匹配项 (位置: ${match.index})`);
        } else {
            new obsidian.Notice("未找到匹配项");
        }
    }

    buildReplaceOneButton(container) {
        this.replaceOneBtn = container.createEl("button", {
            text: "替换",
            cls: "regex-replace-replaceone-btn",
        });
        this.replaceOneBtn.addEventListener("click", () => this.handleReplaceOne());
    }

    async handleReplaceOne() {
        const search = this.searchInput.value;
        const replacement = this.replaceInput.value;
        const flags = this.getFlags();
        const regex = RegexEngine.compile(search, flags);
        if (!search || !regex) {
            new obsidian.Notice("请输入有效的正则表达式");
            return;
        }
        const docText = this.editor.getValue();
        const cursor = this.editor.getCursor();
        const startOffset = this.editor.posToOffset(cursor);
        const globalFlags = flags.includes("g") ? flags : flags + "g";
        const globalRegex = new RegExp(regex.source, globalFlags);
        globalRegex.lastIndex = startOffset;
        let match = globalRegex.exec(docText);
        if (!match && startOffset > 0) {
            globalRegex.lastIndex = 0;
            match = globalRegex.exec(docText);
        }
        if (!match) {
            new obsidian.Notice("未找到匹配项");
            return;
        }
        // 关键修复：获取该匹配的正确替换文本
        const matches = RegexEngine.collectMatches(docText, search, replacement, flags);
        const targetMatch = matches.find((m) => m.index === match.index);
        if (!targetMatch) {
            new obsidian.Notice("无法定位匹配项");
            return;
        }
        // 执行替换
        const from = this.editor.offsetToPos(match.index);
        const to = this.editor.offsetToPos(match.index + match[0].length);
        this.editor.replaceRange(targetMatch.replacement, from, to);
        new obsidian.Notice("已替换 1 个匹配项");
        await this.plugin.addToHistory({
            search: search,
            replace: replacement,
            flags: flags,
        });
        this.clearHighlights();
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.close();
    }

    buildReplaceAllButton(container) {
        this.replaceAllBtn = container.createEl("button", {
            text: "全部替换",
            cls: "mod-cta",
        });
        this.replaceAllBtn.addEventListener("click", () => this.handleReplaceAll());
    }

    async handleReplaceAll() {
        const search = this.searchInput.value;
        const replacement = this.replaceInput.value;
        const flags = this.getFlags();
        if (!search) {
            new obsidian.Notice("请输入搜索项目");
            return;
        }
        const regex = RegexEngine.compile(search, flags);
        if (!regex) {
            new obsidian.Notice("无效的正则表达式");
            return;
        }

        // 处理替换选中
        if (this.selectionOnly && this.editor.getSelection()) {
            const selected = this.editor.getSelection();
            const result = RegexEngine.replaceAll(selected, search, replacement, flags);
            if (typeof result === "object" && result.error) {
                new obsidian.Notice(`错误: ${result.error}`);
                return;
            }
            const from = this.editor.getCursor("from");
            const to = this.editor.getCursor("to");
            this.editor.replaceRange(result, from, to);
            const matchCount = (selected.match(new RegExp(regex.source, flags + "g")) || []).length;
            new obsidian.Notice(`已替换选区中的 ${matchCount} 个匹配项`);
            await this.plugin.addToHistory({
                search: search,
                replace: replacement,
                flags: flags,
            });
            this.clearHighlights();
            if (this.debounceTimer) clearTimeout(this.debounceTimer);
            this.close();
            return;
        }

        // 全文替换
        const fullText = this.editor.getValue();
        const result = RegexEngine.replaceAll(fullText, search, replacement, flags);
        if (typeof result === "object" && result.error) {
            new obsidian.Notice(`错误: ${result.error}`);
            return;
        }
        if (fullText === result) {
            new obsidian.Notice("未找到匹配项");
            return;
        }
        // 整体替换保证撤销
        this.editor.setValue(result);
        const matchCount = (fullText.match(new RegExp(regex.source, flags + "g")) || []).length;
        new obsidian.Notice(`已替换 ${matchCount} 个匹配项`);
        await this.plugin.addToHistory({
            search: search,
            replace: replacement,
            flags: flags,
        });
        this.clearHighlights();
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        // 关键修复：直接关闭，无延迟
        this.close();
    }

    buildCloseButton(container) {
        const closeBtn = container.createEl("button", { text: "关闭" });
        closeBtn.addEventListener("click", () => this.close());
    }

    buildMatchCount(container) {
        this.matchCountEl = container.createDiv({ cls: "regex-replace-match-count" });
    }

    buildPreviewSection(container) {
        this.previewContainer = container.createDiv({
            cls: "regex-replace-preview-container",
        });
        if (!this.previewEnabled) {
            this.previewContainer.style.display = "none";
        }
        this.previewEl = this.previewContainer.createDiv({
            cls: "regex-replace-preview",
        });
    }

    onSearchChange() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.refresh(), 300);
    }

    onReplaceChange() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.refresh(), 300);
    }

    refresh() {
        this.updateButtonStates();
        this.updatePreview();
        this.highlightMatches();
    }

    updateButtonStates() {
        const search = this.searchInput.value;
        const flags = this.getFlags();
        const regex = RegexEngine.compile(search, flags);
        const isValid = search && regex;
        [this.findBtn, this.replaceOneBtn, this.replaceAllBtn].forEach((btn) => {
            if (isValid) {
                btn.classList.add("active");
            } else {
                btn.classList.remove("active");
            }
        });
    }

    updatePreview() {
        const search = this.searchInput.value;
        const replacement = this.replaceInput.value;
        const flags = this.getFlags();

        if (!search) {
            this.matchCountEl.setText("");
            this.matchCountEl.removeClass("regex-replace-error");
            if (this.previewEl) {
                this.previewEl.empty();
                if (this.previewEnabled) {
                    this.previewEl.setText("输入搜索项以查看预览");
                }
            }
            return;
        }

        const regex = RegexEngine.compile(search, flags);
        if (!regex) {
            this.matchCountEl.setText("错误: 无效的正则表达式");
            this.matchCountEl.addClass("regex-replace-error");
            if (this.previewEl) this.previewEl.empty();
            return;
        }

        this.matchCountEl.removeClass("regex-replace-error");
        const text = this.selectionOnly && this.editor.getSelection()
            ? this.editor.getSelection()
            : this.editor.getValue();

        // 关键修复：总是统计全文，不受预览开关影响
        const collector = new MatchCollector(text, search, replacement, flags);
        this.matchCountEl.setText(`全局匹配：${collector.allMatches.length} 个`);

        // 预览关闭时完全跳过计算
        if (!this.previewEnabled || !this.previewEl) return;

        if (collector.allMatches.length === 0) {
            this.previewEl.empty();
            this.previewEl.setText("未找到匹配项");
            return;
        }

        const previewMatches = collector.getPreviewMatches(1000);
        if (previewMatches.length === 0) {
            this.previewEl.empty();
            this.previewEl.setText("未找到匹配项");
            return;
        }

        const firstMatch = collector.allMatches[0];
        const start = Math.max(0, firstMatch.index - 200);
        const end = Math.min(text.length, firstMatch.endIndex + 800);
        const previewText = text.substring(start, end);

        this.previewEl.empty();

        // 替换前
        const origDiv = this.previewEl.createDiv({ cls: "regex-replace-preview-original" });
        origDiv.createEl("strong", { text: "========== 替换前 ==========" });
        const origContent = origDiv.createDiv({ cls: "regex-replace-highlight-content" });
        this.renderHighlighted(origContent, previewText, previewMatches, 1000);

        // 替换后
        const replDiv = this.previewEl.createDiv({ cls: "regex-replace-preview-replaced" });
        replDiv.createEl("strong", { text: "========== 替换后 ==========" });
        const replContent = replDiv.createDiv({ cls: "regex-replace-highlight-content" });
        this.renderReplaced(replContent, previewText, previewMatches, 1000);

        // 匹配列表
        if (previewMatches.length > 0) {
            const listDiv = this.previewEl.createDiv({ cls: "regex-replace-match-list" });
            listDiv.createEl("strong", { text: `预览匹配：${previewMatches.length} 个` });
            const ul = listDiv.createEl("ul");
            previewMatches.slice(0, 10).forEach((m) => {
                const li = ul.createEl("li");
                li.createEl("span", {
                    text: `"${this.truncate(m.match, 30)}"`,
                    cls: "regex-replace-match-text",
                });
                li.createEl("span", { text: " → " });
                li.createEl("span", {
                    text: `"${this.truncate(m.replacement, 30)}"`,
                    cls: "regex-replace-replacement-text",
                });
            });
            if (previewMatches.length > 10) {
                ul.createEl("li", {
                    text: `... 及其他 ${previewMatches.length - 10} 项`,
                    cls: "regex-replace-more",
                });
            }
        }
    }

    renderHighlighted(container, text, matches, maxLen) {
        let lastIdx = 0;
        const display = text.substring(0, maxLen);
        for (const match of matches) {
            if (match.index >= maxLen) break;
            if (match.index > lastIdx) {
                container.createSpan({ text: display.substring(lastIdx, match.index) });
            }
            const endIdx = Math.min(match.index + match.length, maxLen);
            container.createSpan({
                text: display.substring(match.index, endIdx),
                cls: "regex-replace-highlight-match",
            });
            lastIdx = match.index + match.length;
        }
        if (lastIdx < display.length) {
            container.createSpan({ text: display.substring(lastIdx) });
        }
        if (text.length > maxLen) {
            container.createSpan({ text: "...", cls: "regex-replace-truncated" });
        }
    }

    renderReplaced(container, text, matches, maxLen) {
        let displayLen = 0;
        let lastIdx = 0;
        for (const match of matches) {
            if (displayLen >= maxLen) break;
            if (match.index > lastIdx) {
                const segment = text.substring(lastIdx, match.index);
                const display = segment.substring(0, maxLen - displayLen);
                container.createSpan({ text: display });
                displayLen += display.length;
            }
            if (displayLen < maxLen) {
                const replSegment = match.replacement.substring(0, maxLen - displayLen);
                container.createSpan({
                    text: replSegment,
                    cls: "regex-replace-highlight-replacement",
                });
                displayLen += replSegment.length;
            }
            lastIdx = match.index + match.length;
        }
        if (displayLen < maxLen && lastIdx < text.length) {
            const remaining = text.substring(lastIdx, maxLen - displayLen);
            container.createSpan({ text: remaining });
            displayLen += remaining.length;
        }
        if (displayLen >= maxLen || text.length > maxLen) {
            container.createSpan({ text: "...", cls: "regex-replace-truncated" });
        }
    }

    truncate(text, len) {
        return text.length <= len ? text : text.substring(0, len) + "...";
    }

    getFlags() {
        let flags = "";
        if (this.flagGlobal.checked) flags += "g";
        if (this.flagCase.checked) flags += "i";
        if (this.flagMultiline.checked) flags += "m";
        return flags;
    }

    highlightMatches() {
        this.clearHighlights();
        const search = this.searchInput.value;
        const flags = this.getFlags();
        const regex = RegexEngine.compile(search, flags);
        if (!search || !regex) return;

        const globalFlags = flags.includes("g") ? flags : flags + "g";
        const globalRegex = new RegExp(regex.source, globalFlags);
        const text = this.selectionOnly && this.editor.getSelection()
            ? this.editor.getSelection()
            : this.editor.getValue();

        let match;
        while ((match = globalRegex.exec(text)) !== null) {
            const from = this.editor.offsetToPos(match.index);
            const to = this.editor.offsetToPos(match.index + match[0].length);
            const mark = this.editor.markText(from, to, {
                cssClass: "regex-replace-highlight-match",
            });
            this.matchMarks.push(mark);
            if (globalRegex.lastIndex === match.index) {
                globalRegex.lastIndex++;
            }
        }
    }

    clearHighlights() {
        this.matchMarks.forEach((mark) => {
            try {
                mark.clear();
            } catch (e) {
                // 忽略已清除的标记
            }
        });
        this.matchMarks = [];
    }

    onClose() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.clearHighlights();
        this.contentEl.empty();
    }
}

/**
 * 插件核心类
 */
class RegexReplacePlugin extends obsidian.Plugin {
    async onload() {
        await this.loadSettings();
        this.addCommand({
            id: "regex-replace-open",
            name: "替换",
            editorCallback: (editor) => {
                new RegexReplaceModal(this.app, this, editor).open();
            },
        });
        this.addCommand({
            id: "regex-replace-selection",
            name: "替换选中",
            editorCallback: (editor) => {
                new RegexReplaceModal(this.app, this, editor).open();
            },
        });
        this.addSettingTab(new RegexReplaceSettingTab(this.app, this));
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async addToHistory(pattern) {
        this.settings.recentPatterns = this.settings.recentPatterns.filter(
            (p) => p.search !== pattern.search || p.replace !== pattern.replace
        );
        this.settings.recentPatterns.unshift(pattern);
        this.settings.recentPatterns = this.settings.recentPatterns.slice(
            0,
            this.settings.historyLimit
        );
        await this.saveSettings();
    }
}

/**
 * 设置面板
 */
class RegexReplaceSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        new obsidian.Setting(containerEl)
            .setName("默认标志")
            .setDesc("默认正则标志(g=全局匹配，m=多行模式，i=忽略大小写)")
            .addText((text) =>
                text
                    .setPlaceholder("输入标志")
                    .setValue(this.plugin.settings.defaultFlags)
                    .onChange(async (value) => {
                        this.plugin.settings.defaultFlags = value.replace(/[^gim]/g, "");
                        await this.plugin.saveSettings();
                    })
            );

        new obsidian.Setting(containerEl)
            .setName("显示预览")
            .setDesc("在替换对话框中显示前后预览")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.showPreview).onChange(async (value) => {
                    this.plugin.settings.showPreview = value;
                    await this.plugin.saveSettings();
                })
            );

        new obsidian.Setting(containerEl)
            .setName("记录上限")
            .setDesc("最大历史记录数量")
            .addSlider((slider) =>
                slider
                    .setLimits(0, 50, 5)
                    .setValue(this.plugin.settings.historyLimit)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.historyLimit = value;
                        this.plugin.settings.recentPatterns = this.plugin.settings.recentPatterns.slice(0, value);
                        await this.plugin.saveSettings();
                    })
            );

        new obsidian.Setting(containerEl)
            .setName("清除历史")
            .setDesc("移除所有历史记录")
            .addButton((button) =>
                button.setButtonText("清除").onClick(() => {
                    this.plugin.settings.recentPatterns = [];
                    this.plugin.saveSettings();
                    new obsidian.Notice("历史记录已全部清除");
                })
            );
    }
}

module.exports = RegexReplacePlugin;
