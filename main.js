/* Regex-Replace 插件 - 完全重写
 * 版本：Ver 2.5.0 20260616
 * 更新日志：
 * v2.5.0: 完全重写 - 修复全部替换不关闭窗口；修复替换按钮组引用异常；修复删除按钮状态不同步；优化预览功能停止计算
 * v2.4.8: 未修复"全部替换"后不自动关闭窗口；未修复正则组替换异常；未修复删除按钮高亮状态同步
 */

const obsidian = require("obsidian");

const DEFAULT_SETTINGS = {
    defaultFlags: "g",
    historyLimit: 10,
    showPreview: true,
    recentPatterns: [],
};

class RegexUtils {
    static compile(pattern, flags) {
        try {
            return new RegExp(pattern, flags);
        } catch (e) {
            return null;
        }
    }

    static processReplacement(text) {
        return text
            .replace(/\\n/g, "\n")
            .replace(/\\t/g, "\t")
            .replace(/\\r/g, "\r");
    }

    static collectMatches(text, pattern, replacement, flags) {
        const matches = [];
        const globalFlags = flags.includes("g") ? flags : flags + "g";
        const regex = new RegExp(pattern, globalFlags);
        const processedReplacement = this.processReplacement(replacement);
        let match;

        while ((match = regex.exec(text)) !== null) {
            const matched = match[0];
            const replaced = matched.replace(new RegExp(pattern, flags), processedReplacement);
            matches.push({
                index: match.index,
                length: matched.length,
                match: matched,
                replacement: replaced,
            });
            if (match.index === regex.lastIndex) {
                regex.lastIndex++;
            }
        }
        return matches;
    }

    static executeReplace(text, pattern, replacement, flags) {
        try {
            const regex = this.compile(pattern, flags);
            if (!regex) return { error: "无效的正则表达式" };
            const processed = this.processReplacement(replacement);
            return text.replace(regex, processed);
        } catch (e) {
            return { error: String(e) };
        }
    }
}

class RegexReplaceModal extends obsidian.Modal {
    constructor(app, plugin, editor) {
        super(app);
        this.plugin = plugin;
        this.editor = editor;
        this.selectionOnly = false;
        this.debounceTimer = null;
        this.matchMarks = [];
        this.previewEnabled = plugin.settings.showPreview;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.addClass("regex-replace-modal");
        contentEl.empty();

        this.createSearchField(contentEl);
        this.createReplaceField(contentEl);
        this.createFlagsSection(contentEl);
        this.createMatchCountDisplay(contentEl);
        this.createPreviewSection(contentEl);

        this.autoFillFromSelection();
        this.searchInput.focus();
        this.refresh();
    }

    autoFillFromSelection() {
        const selectedText = this.editor.getSelection();
        if (!selectedText) return;
        if (selectedText.length < 100) {
            this.searchInput.value = selectedText;
        } else {
            this.flagSelection.checked = true;
            this.selectionOnly = true;
        }
    }

    createSearchField(container) {
        const fieldDiv = container.createDiv({ cls: "regex-replace-field" });
        this.searchInput = fieldDiv.createEl("input", {
            type: "text",
            placeholder: "搜索：输入文本、表达式 (如: \\d+)",
            cls: "regex-replace-input",
        });
        this.searchInput.addEventListener("input", () => this.onSearchChange());
    }

    createReplaceField(container) {
        const fieldDiv = container.createDiv({ cls: "regex-replace-field" });
        this.replaceInput = fieldDiv.createEl("input", {
            type: "text",
            placeholder: "替换：输入文本、规则 (支持:\\n, \\r, \\t, $1…)",
            cls: "regex-replace-input",
        });
        this.replaceInput.addEventListener("input", () => this.onReplaceChange());
    }

    createFlagsSection(container) {
        const flagsDiv = container.createDiv({ cls: "regex-replace-flags" });
        const wrapperDiv = flagsDiv.createDiv({ cls: "regex-replace-flags-wrapper" });

        const defaults = this.plugin.settings.defaultFlags;
        this.flagGlobal = this.createCheckbox(wrapperDiv, "g 全局", defaults.includes("g"));
        this.flagMultiline = this.createCheckbox(wrapperDiv, "m 多行", defaults.includes("m"));
        this.flagCase = this.createCheckbox(wrapperDiv, "i 忽略大小写", defaults.includes("i"));
        this.flagSelection = this.createCheckbox(wrapperDiv, "替换选中", false);
        this.flagPreview = this.createCheckbox(wrapperDiv, "预览", this.previewEnabled);

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
                if (this.previewEnabled) {
                    this.previewContainer.style.display = "block";
                } else {
                    this.previewContainer.style.display = "none";
                }
            }
            this.refresh();
        });

        const buttonsDiv = flagsDiv.createDiv({ cls: "regex-replace-buttons" });
        this.createHistoryDropdown(buttonsDiv);
        this.createDeleteButton(buttonsDiv);
        this.createFindButton(buttonsDiv);
        this.createReplaceOneButton(buttonsDiv);
        this.createReplaceAllButton(buttonsDiv);
        this.createCloseButton(buttonsDiv);
    }

    createCheckbox(container, label, checked) {
        const labelEl = container.createEl("label", { cls: "regex-replace-flag-label" });
        const checkboxEl = labelEl.createEl("input", { type: "checkbox" });
        checkboxEl.checked = checked;
        labelEl.appendText(` ${label}`);
        return checkboxEl;
    }

    createHistoryDropdown(container) {
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

    createDeleteButton(container) {
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

    createFindButton(container) {
        this.findBtn = container.createEl("button", {
            text: "查找",
            cls: "regex-replace-find-btn",
        });
        this.findBtn.addEventListener("click", () => this.handleFind());
    }

    handleFind() {
        const search = this.searchInput.value;
        const flags = this.getFlags();
        const regex = RegexUtils.compile(search, flags);
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
        } else {
            new obsidian.Notice("未找到匹配项");
        }
    }

    createReplaceOneButton(container) {
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
        const regex = RegexUtils.compile(search, flags);
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
        const matches = RegexUtils.collectMatches(docText, search, replacement, flags);
        const targetMatch = matches.find((m) => m.index === match.index);
        if (!targetMatch) {
            new obsidian.Notice("无法定位匹配项");
            return;
        }
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

    createReplaceAllButton(container) {
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
        const regex = RegexUtils.compile(search, flags);
        if (!regex) {
            new obsidian.Notice("无效的正则表达式");
            return;
        }

        if (this.selectionOnly && this.editor.getSelection()) {
            const sel = this.editor.getSelection();
            const result = RegexUtils.executeReplace(sel, search, replacement, flags);
            if (typeof result === "object" && result.error) {
                new obsidian.Notice(`错误: ${result.error}`);
                return;
            }
            const from = this.editor.getCursor("from");
            const to = this.editor.getCursor("to");
            this.editor.replaceRange(result, from, to);
            const matchCount = (sel.match(new RegExp(regex.source, flags + "g")) || []).length;
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

        const fullText = this.editor.getValue();
        const result = RegexUtils.executeReplace(fullText, search, replacement, flags);
        if (typeof result === "object" && result.error) {
            new obsidian.Notice(`错误: ${result.error}`);
            return;
        }
        if (fullText === result) {
            new obsidian.Notice("未找到匹配项");
            return;
        }
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
        this.close();
    }

    createCloseButton(container) {
        const closeBtn = container.createEl("button", { text: "关闭" });
        closeBtn.addEventListener("click", () => this.close());
    }

    createMatchCountDisplay(container) {
        this.matchCountEl = container.createDiv({ cls: "regex-replace-match-count" });
    }

    createPreviewSection(container) {
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
        this.updateActionButtonsState();
        this.updatePreview();
        this.highlightMatches();
    }

    updateActionButtonsState() {
        const search = this.searchInput.value;
        const flags = this.getFlags();
        const regex = RegexUtils.compile(search, flags);
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

        const regex = RegexUtils.compile(search, flags);
        if (!regex) {
            this.matchCountEl.setText(`错误: 无效的正则表达式`);
            this.matchCountEl.addClass("regex-replace-error");
            if (this.previewEl) this.previewEl.empty();
            return;
        }

        this.matchCountEl.removeClass("regex-replace-error");
        const text = this.selectionOnly && this.editor.getSelection()
            ? this.editor.getSelection()
            : this.editor.getValue();
        const allMatches = RegexUtils.collectMatches(text, search, replacement, flags);
        this.matchCountEl.setText(`全局匹配：${allMatches.length} 个`);

        if (!this.previewEnabled || !this.previewEl || allMatches.length === 0) {
            if (this.previewEl && this.previewEnabled) {
                this.previewEl.empty();
                if (allMatches.length === 0) {
                    this.previewEl.setText("未找到匹配项");
                }
            }
            return;
        }

        const firstMatch = allMatches[0];
        const previewStart = Math.max(0, firstMatch.index - 200);
        const previewEnd = Math.min(
            text.length,
            firstMatch.index + firstMatch.length + 800
        );
        const previewText = text.substring(previewStart, previewEnd);
        const previewMatches = RegexUtils.collectMatches(previewText, search, replacement, flags);

        this.previewEl.empty();
        if (previewMatches.length === 0) {
            this.previewEl.setText("未找到匹配项");
            return;
        }

        const originalDiv = this.previewEl.createDiv({ cls: "regex-replace-preview-original" });
        originalDiv.createEl("strong", { text: "========== 替换前 ==========" });
        const origContent = originalDiv.createDiv({ cls: "regex-replace-highlight-content" });
        this.renderHighlightedText(origContent, previewText, previewMatches, 1000);

        const replacedDiv = this.previewEl.createDiv({ cls: "regex-replace-preview-replaced" });
        replacedDiv.createEl("strong", { text: "========== 替换后 ==========" });
        const replContent = replacedDiv.createDiv({ cls: "regex-replace-highlight-content" });
        this.renderReplacedText(replContent, previewText, previewMatches, 1000);

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

    renderHighlightedText(container, text, matches, maxLen) {
        let lastIndex = 0;
        const displayText = text.substring(0, maxLen);
        for (const match of matches) {
            if (match.index >= maxLen) break;
            if (match.index > lastIndex) {
                container.createSpan({ text: displayText.substring(lastIndex, match.index) });
            }
            const endIdx = Math.min(match.index + match.length, maxLen);
            container.createSpan({
                text: displayText.substring(match.index, endIdx),
                cls: "regex-replace-highlight-match",
            });
            lastIndex = match.index + match.length;
        }
        if (lastIndex < displayText.length) {
            container.createSpan({ text: displayText.substring(lastIndex) });
        }
        if (text.length > maxLen) {
            container.createSpan({ text: "...", cls: "regex-replace-truncated" });
        }
    }

    renderReplacedText(container, text, matches, maxLen) {
        let lastIndex = 0;
        let displayLen = 0;
        for (const match of matches) {
            if (displayLen >= maxLen) break;
            if (match.index > lastIndex) {
                const segment = text.substring(lastIndex, match.index);
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
            lastIndex = match.index + match.length;
        }
        if (displayLen < maxLen && lastIndex < text.length) {
            const remaining = text.substring(lastIndex, maxLen - displayLen);
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
        const regex = RegexUtils.compile(search, flags);
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
        this.matchMarks.forEach((mark) => mark.clear());
        this.matchMarks = [];
    }

    onClose() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.clearHighlights();
        this.contentEl.empty();
    }
}

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
                        this.plugin.settings.recentPatterns = this.plugin.settings.recentPatterns.slice(
                            0,
                            value
                        );
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