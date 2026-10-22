// 导师 Mentor - content script
// 双模式：learn（跟学渲染引擎）/ create（课程创作模式）
// 依赖：content.css

(function () {
  const STORAGE_KEY = "mentor_courses";
  const PREFIX = "mentor-";

  const state = {
    mode: null, // "learn" | "create" | null
    course: null,
    stepIndex: 0,
    highlightEl: null,
    tooltipEl: null,
    autoAdvance: null, // { el, handler }
    waitTimer: null,
    updatePos: null,
    // create 模式
    creator: null,
  };

  // ---------- 通用工具 ----------

  function cssEscape(s) {
    return String(s).replace(/([^\w-])/g, "\\$1");
  }

  function isUnique(selector) {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch (e) {
      return false;
    }
  }

  function pathSelector(el) {
    const parts = [];
    let node = el;
    while (node && node !== document.body && node.nodeType === 1) {
      if (node.id) {
        parts.unshift("#" + cssEscape(node.id));
        break;
      }
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (siblings.length > 1) {
          part += ":nth-child(" + (Array.from(parent.children).indexOf(node) + 1) + ")";
        }
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(" > ");
  }

  // 为选中元素生成尽量短且唯一的 selector
  function buildSelector(el) {
    if (el.id) return "#" + cssEscape(el.id);
    const classes = Array.from(el.classList).filter((c) => c && !c.startsWith(PREFIX));
    if (classes.length > 0) {
      const sel = el.tagName.toLowerCase() + "." + classes.slice(0, 2).map(cssEscape).join(".");
      if (isUnique(sel)) return sel;
    }
    let sel = pathSelector(el);
    if (!isUnique(sel) && el.getAttribute("aria-label")) {
      sel = el.tagName.toLowerCase() + '[aria-label="' + el.getAttribute("aria-label") + '"]';
    }
    return sel;
  }

  // 按 selector 找元素；失败则用 fallback_text 文本匹配（先精确后包含，取文本最短者防父容器误中）
  function findElement(step) {
    if (step.selector) {
      try {
        const el = document.querySelector(step.selector);
        if (el) return el;
      } catch (e) { /* selector 非法时忽略 */ }
    }
    if (step.fallback_text) {
      const tag = step.fallback_tag || "a, button, [role=button], li, span, div";
      const candidates = Array.from(document.querySelectorAll(tag)).filter((c) => {
        const r = c.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      const text = (c) => (c.textContent || "").trim();
      const byLen = (a, b) => text(a).length - text(b).length;
      let hit = candidates.filter((c) => text(c) === step.fallback_text).sort(byLen)[0];
      if (!hit) hit = candidates.filter((c) => text(c).includes(step.fallback_text)).sort(byLen)[0];
      if (hit) return hit;
    }
    return null;
  }

  function clearListeners() {
    window.removeEventListener("scroll", state.updatePos, true);
    window.removeEventListener("resize", state.updatePos);
    state.updatePos = null;
    if (state.autoAdvance) {
      state.autoAdvance.el.removeEventListener("click", state.autoAdvance.handler, { capture: true });
      state.autoAdvance = null;
    }
    if (state.waitTimer) {
      clearInterval(state.waitTimer);
      state.waitTimer = null;
    }
  }

  function clearOverlay() {
    clearListeners();
    if (state.highlightEl) { state.highlightEl.remove(); state.highlightEl = null; }
    if (state.tooltipEl) { state.tooltipEl.remove(); state.tooltipEl = null; }
  }

  // ---------- 跟学引擎 ----------

  function startLearn(course) {
    if (!course || !Array.isArray(course.steps) || course.steps.length === 0) return;
    stopAll();
    state.mode = "learn";
    state.course = course;
    state.stepIndex = 0;
    renderStep();
  }

  function stopLearn() {
    clearOverlay();
    state.mode = state.mode === "create" ? "create" : null;
    state.course = null;
    chrome.runtime.sendMessage({ type: "COURSE_STOPPED" });
  }

  function renderStep() {
    clearOverlay();
    const steps = state.course.steps;
    const step = steps[state.stepIndex];
    if (!step) { finishCourse(); return; }

    const el = findElement(step);
    if (!el) {
      showWaitingTooltip(step, steps.length);
      state.waitTimer = setInterval(() => {
        const found = findElement(step);
        if (found) {
          clearInterval(state.waitTimer);
          state.waitTimer = null;
          renderStep();
        }
      }, 800);
      return;
    }

    el.scrollIntoView({ block: "center", behavior: "smooth" });

    const hl = document.createElement("div");
    hl.className = PREFIX + "highlight " + PREFIX + "pulse";
    document.body.appendChild(hl);
    state.highlightEl = hl;

    const update = () => {
      const r = el.getBoundingClientRect();
      hl.style.left = r.left + "px";
      hl.style.top = r.top + "px";
      hl.style.width = r.width + "px";
      hl.style.height = r.height + "px";
      if (state.tooltipEl) placeTooltip(state.tooltipEl, r);
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    state.updatePos = update;

    const tip = buildTooltip(step, steps.length);
    document.body.appendChild(tip);
    state.tooltipEl = tip;
    placeTooltip(tip, el.getBoundingClientRect());

    if (step.advance === "auto") {
      const handler = () => { setTimeout(nextStep, 500); };
      el.addEventListener("click", handler, { once: true, capture: true });
      state.autoAdvance = { el, handler };
    }

    chrome.runtime.sendMessage({
      type: "STEP_CHANGED",
      step: state.stepIndex + 1,
      total: steps.length,
    });
  }

  function showWaitingTooltip(step, total) {
    const tip = document.createElement("div");
    tip.className = PREFIX + "tooltip";
    tip.style.left = "50%";
    tip.style.top = "24px";
    tip.style.transform = "translateX(-50%)";
    tip.innerHTML =
      '<div class="' + PREFIX + 'tooltip-head">' +
      '<span class="' + PREFIX + 'step-badge">' + (state.stepIndex + 1) + "</span>" +
      '<span class="' + PREFIX + 'step-progress">步骤 ' + (state.stepIndex + 1) + " / " + total + "</span>" +
      "</div>" +
      '<p class="' + PREFIX + 'tooltip-title"></p>' +
      '<p class="' + PREFIX + 'tooltip-body">' + escapeHtml(step.content || "") + "</p>" +
      '<div class="' + PREFIX + 'waiting">正在等待页面元素出现，请稍候（若页面未跳转，可点「跳过」）</div>' +
      '<div class="' + PREFIX + 'tooltip-actions">' +
      '<button class="' + PREFIX + 'btn" data-act="skip">跳过</button>' +
      '<button class="' + PREFIX + 'btn ' + PREFIX + 'btn-primary" data-act="next">下一步</button>' +
      "</div>";
    tip.querySelector("." + PREFIX + "tooltip-title").textContent = step.title || "";
    tip.addEventListener("click", (e) => {
      const act = e.target.dataset && e.target.dataset.act;
      if (act === "next") nextStep();
      if (act === "skip") nextStep();
    });
    document.body.appendChild(tip);
    state.tooltipEl = tip;
  }

  function buildTooltip(step, total) {
    const tip = document.createElement("div");
    tip.className = PREFIX + "tooltip";
    const isLast = state.stepIndex === total - 1;
    tip.innerHTML =
      '<div class="' + PREFIX + 'tooltip-head">' +
      '<span class="' + PREFIX + 'step-badge">' + (state.stepIndex + 1) + "</span>" +
      '<span class="' + PREFIX + 'step-progress">步骤 ' + (state.stepIndex + 1) + " / " + total + "</span>" +
      "</div>" +
      '<p class="' + PREFIX + 'tooltip-title"></p>' +
      '<p class="' + PREFIX + 'tooltip-body">' + escapeHtml(step.content || "") + "</p>" +
      (step.advance === "auto"
        ? '<div class="' + PREFIX + 'waiting">点击高亮区域完成本步（或点下方按钮继续）</div>'
        : "") +
      '<div class="' + PREFIX + 'tooltip-actions">' +
      '<button class="' + PREFIX + 'btn" data-act="prev"' + (state.stepIndex === 0 ? " disabled" : "") + ">上一步</button>" +
      (isLast
        ? '<button class="' + PREFIX + 'btn ' + PREFIX + 'btn-primary" data-act="finish">完成</button>'
        : '<button class="' + PREFIX + 'btn ' + PREFIX + 'btn-primary" data-act="next">下一步</button>') +
      '<button class="' + PREFIX + 'btn" data-act="stop">退出</button>' +
      "</div>";
    tip.querySelector("." + PREFIX + "tooltip-title").textContent = step.title || "";
    tip.addEventListener("click", (e) => {
      const act = e.target.dataset && e.target.dataset.act;
      if (act === "next") nextStep();
      else if (act === "prev") prevStep();
      else if (act === "skip") nextStep();
      else if (act === "finish") finishCourse();
      else if (act === "stop") stopLearn();
    });
    return tip;
  }

  // tooltip 四向避让：优先放在高亮框下/上/右/左，绝不遮挡高亮区域
  function placeTooltip(tip, rect) {
    const w = tip.offsetWidth || 300;
    const h = tip.offsetHeight || 160;
    const gap = 12;
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const candidates = [
      { x: rect.left, y: rect.bottom + gap },          // 下方（首选）
      { x: rect.left, y: rect.top - gap - h },         // 上方
      { x: rect.right + gap, y: rect.top },            // 右侧
      { x: rect.left - gap - w, y: rect.top },         // 左侧
    ];

    const inViewport = (p) =>
      p.x >= margin && p.y >= margin && p.x + w <= vw - margin && p.y + h <= vh - margin;

    const overlapArea = (p) => {
      const ox = Math.max(0, Math.min(p.x + w, rect.right) - Math.max(p.x, rect.left));
      const oy = Math.max(0, Math.min(p.y + h, rect.bottom) - Math.max(p.y, rect.top));
      return ox * oy;
    };

    const apply = (p) => {
      tip.style.left = p.x + "px";
      tip.style.top = p.y + "px";
      tip.style.transform = "none";
    };

    // 第一轮：完整落在视口内即采用（此时候选位天然不与高亮框重叠）
    const fit = candidates.find((p) => inViewport(p));
    if (fit) { apply(fit); return; }

    // 第二轮：高亮框贴近视口边缘，钳制到视口内，选遮挡面积最小的候选
    let best = null;
    let bestArea = Infinity;
    for (const p of candidates) {
      const cx = Math.min(Math.max(margin, p.x), Math.max(margin, vw - w - margin));
      const cy = Math.min(Math.max(margin, p.y), Math.max(margin, vh - h - margin));
      const area = overlapArea({ x: cx, y: cy });
      if (area < bestArea) { bestArea = area; best = { x: cx, y: cy }; }
    }
    apply(best);
  }

  function nextStep() {
    if (state.mode !== "learn") return;
    state.stepIndex += 1;
    renderStep();
  }

  function prevStep() {
    if (state.mode !== "learn") return;
    state.stepIndex = Math.max(0, state.stepIndex - 1);
    renderStep();
  }

  function finishCourse() {
    clearOverlay();
    const total = state.course ? state.course.steps.length : 0;
    const done = document.createElement("div");
    done.className = PREFIX + "tooltip";
    done.style.left = "50%";
    done.style.top = "40%";
    done.style.transform = "translate(-50%, -50%)";
    done.innerHTML =
      '<p class="' + PREFIX + 'tooltip-title">课程完成</p>' +
      '<p class="' + PREFIX + 'tooltip-body">共 ' + total + " 步，已全部学完。</p>" +
      '<p class="' + PREFIX + 'tooltip-body" style="font-size:12px;color:#8A7F76;margin-bottom:10px">💡 更多实用 AI 效率工具和技能，关注公众号「桂皮AI实战」</p>' +
      '<div class="' + PREFIX + 'tooltip-actions">' +
      '<button class="' + PREFIX + 'btn ' + PREFIX + 'btn-primary" data-act="close">好的</button>' +
      "</div>";
    done.addEventListener("click", () => done.remove());
    document.body.appendChild(done);
    state.mode = null;
    state.course = null;
    chrome.runtime.sendMessage({ type: "COURSE_FINISHED" });
  }

  // ---------- 创作模式 ----------

  function toggleCreator() {
    if (state.mode === "create") stopCreator();
    else startCreator();
  }

  function stopCreator() {
    if (state.creator) {
      state.creator.bar.remove();
      state.creator.panel.remove();
      document.removeEventListener("mouseover", state.creator.onHover, true);
      document.removeEventListener("click", state.creator.onClick, true);
      document.removeEventListener("keydown", state.creator.onKey, true);
    }
    state.creator = null;
    state.mode = null;
  }

  function startCreator() {
    stopAll();
    state.mode = "create";
    state.creator = {
      steps: [],
      picked: null,
      bar: null,
      panel: null,
    };

    const bar = document.createElement("div");
    bar.className = PREFIX + "creator-bar";
    bar.textContent = "创作模式：把鼠标移到目标元素上点击选中，右侧填写讲解后添加步骤";
    document.body.appendChild(bar);
    state.creator.bar = bar;

    const panel = document.createElement("div");
    panel.className = PREFIX + "creator-panel";
    panel.innerHTML =
      "<h3>课程编辑器</h3>" +
      "<label>课程名称（site）</label>" +
      '<input id="' + PREFIX + 'c-site" placeholder="例如：公众号后台">' +
      "<label>URL 匹配规则（url_pattern）</label>" +
      '<input id="' + PREFIX + 'c-url" value="' + location.origin + '/*">' +
      "<label>已选元素 selector</label>" +
      '<input id="' + PREFIX + 'c-sel" readonly placeholder="在页面上点击一个元素">' +
      "<label>步骤标题</label>" +
      '<input id="' + PREFIX + 'c-title" placeholder="例如：添加任务">' +
      "<label>讲解内容（这个区域/按钮是干嘛的）</label>" +
      '<textarea id="' + PREFIX + 'c-content" placeholder="例如：点击这里新建一条待办..."></textarea>' +
      "<label>推进方式</label>" +
      '<select id="' + PREFIX + 'c-advance">' +
      '<option value="manual">手动：用户点「下一步」继续</option>' +
      '<option value="auto">自动：用户点击本元素后继续</option>' +
      "</select>" +
      '<div class="' + PREFIX + 'tooltip-actions" style="margin-top:12px">' +
      '<button class="' + PREFIX + 'btn" data-act="clear-sel">重选元素</button>' +
      '<button class="' + PREFIX + 'btn ' + PREFIX + 'btn-primary" data-act="add-step">添加步骤</button>' +
      "</div>" +
      '<div id="' + PREFIX + 'c-steps"></div>' +
      '<div class="' + PREFIX + 'tooltip-actions" style="margin-top:12px">' +
      '<button class="' + PREFIX + 'btn" data-act="export">导出 JSON</button>' +
      '<button class="' + PREFIX + 'btn ' + PREFIX + 'btn-primary" data-act="save">保存课程</button>' +
      '<button class="' + PREFIX + 'btn" data-act="exit">退出</button>' +
      "</div>";
    document.body.appendChild(panel);
    state.creator.panel = panel;

    const onHover = (e) => {
      if (state.creator.panel.contains(e.target)) return;
      const prev = document.querySelector("." + PREFIX + "creator-hover");
      if (prev) prev.classList.remove(PREFIX + "creator-hover");
      e.target.classList.add(PREFIX + "creator-hover");
    };
    const onClick = (e) => {
      if (state.creator.panel.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      const prev = document.querySelector("." + PREFIX + "creator-hover");
      if (prev) prev.classList.remove(PREFIX + "creator-hover");
      e.target.classList.add(PREFIX + "creator-picked");
      state.creator.picked = e.target;
      panel.querySelector("#" + PREFIX + "c-sel").value = buildSelector(e.target);
    };
    const onKey = (e) => {
      if (e.key === "Escape") stopCreator();
    };
    document.addEventListener("mouseover", onHover, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    state.creator.onHover = onHover;
    state.creator.onClick = onClick;
    state.creator.onKey = onKey;

    panel.addEventListener("click", async (e) => {
      const act = e.target.dataset && e.target.dataset.act;
      if (act === "clear-sel") {
        document.querySelectorAll("." + PREFIX + "creator-picked").forEach((n) => n.classList.remove(PREFIX + "creator-picked"));
        state.creator.picked = null;
        panel.querySelector("#" + PREFIX + "c-sel").value = "";
      } else if (act === "add-step") {
        addCreatorStep(panel);
      } else if (act === "save") {
        await saveCourse(panel);
      } else if (act === "export") {
        exportCourseJson(panel);
      } else if (act === "exit") {
        stopCreator();
      }
    });

    renderCreatorSteps(panel);
  }

  function readCourseForm(panel) {
    const site = panel.querySelector("#" + PREFIX + "c-site").value.trim();
    const url = panel.querySelector("#" + PREFIX + "c-url").value.trim();
    const selector = panel.querySelector("#" + PREFIX + "c-sel").value.trim();
    const title = panel.querySelector("#" + PREFIX + "c-title").value.trim();
    const content = panel.querySelector("#" + PREFIX + "c-content").value.trim();
    const advance = panel.querySelector("#" + PREFIX + "c-advance").value;
    const text = state.creator.picked ? (state.creator.picked.textContent || "").trim().slice(0, 30) : "";
    return { site, url, selector, title, content, advance, fallback_text: text };
  }

  function addCreatorStep(panel) {
    const f = readCourseForm(panel);
    if (!f.selector) { flashPanel(panel, "请先在页面上点击选中一个元素"); return; }
    if (!f.title) { flashPanel(panel, "请填写步骤标题"); return; }
    const step = {
      id: state.creator.steps.length + 1,
      selector: f.selector,
      fallback_text: f.fallback_text,
      title: f.title,
      content: f.content,
      advance: f.advance,
    };
    state.creator.steps.push(step);
    panel.querySelector("#" + PREFIX + "c-title").value = "";
    panel.querySelector("#" + PREFIX + "c-content").value = "";
    renderCreatorSteps(panel);
  }

  function flashPanel(panel, msg) {
    const old = panel.querySelector("." + PREFIX + "waiting");
    if (old) old.remove();
    const tip = document.createElement("div");
    tip.className = PREFIX + "waiting";
    tip.textContent = msg;
    panel.appendChild(tip);
    setTimeout(() => tip.remove(), 2500);
  }

  function renderCreatorSteps(panel) {
    const box = panel.querySelector("#" + PREFIX + "c-steps");
    box.innerHTML = "";
    state.creator.steps.forEach((s, i) => {
      const item = document.createElement("div");
      item.className = PREFIX + "step-item";
      const no = document.createElement("span");
      no.className = PREFIX + "step-no";
      no.textContent = i + 1;
      const name = document.createElement("span");
      name.className = PREFIX + "step-name";
      name.textContent = s.title;
      name.title = s.selector;
      const up = document.createElement("button");
      up.textContent = "上移";
      up.onclick = () => {
        if (i === 0) return;
        const arr = state.creator.steps;
        [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
        arr.forEach((x, idx) => { x.id = idx + 1; });
        renderCreatorSteps(panel);
      };
      const down = document.createElement("button");
      down.textContent = "下移";
      down.onclick = () => {
        const arr = state.creator.steps;
        if (i === arr.length - 1) return;
        [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
        arr.forEach((x, idx) => { x.id = idx + 1; });
        renderCreatorSteps(panel);
      };
      const del = document.createElement("button");
      del.textContent = "删除";
      del.onclick = () => {
        state.creator.steps.splice(i, 1);
        state.creator.steps.forEach((x, idx) => { x.id = idx + 1; });
        renderCreatorSteps(panel);
      };
      item.append(no, name, up, down, del);
      box.appendChild(item);
    });
  }

  async function saveCourse(panel) {
    const site = panel.querySelector("#" + PREFIX + "c-site").value.trim();
    const url = panel.querySelector("#" + PREFIX + "c-url").value.trim();
    if (!site) { flashPanel(panel, "请填写课程名称"); return; }
    if (state.creator.steps.length === 0) { flashPanel(panel, "至少添加一个步骤"); return; }
    const course = {
      site,
      url_pattern: url,
      version: "1.0",
      created: new Date().toISOString().slice(0, 10),
      steps: state.creator.steps,
    };
    const res = await chrome.storage.local.get(STORAGE_KEY);
    const courses = res[STORAGE_KEY] || {};
    const id = "course_" + Date.now();
    courses[id] = course;
    await chrome.storage.local.set({ [STORAGE_KEY]: courses });
    flashPanel(panel, "已保存，可在插件弹窗中开始这门课");
  }

  function exportCourseJson(panel) {
    const site = panel.querySelector("#" + PREFIX + "c-site").value.trim() || "course";
    const url = panel.querySelector("#" + PREFIX + "c-url").value.trim();
    if (state.creator.steps.length === 0) { flashPanel(panel, "至少添加一个步骤"); return; }
    const course = {
      site,
      url_pattern: url,
      version: "1.0",
      created: new Date().toISOString().slice(0, 10),
      steps: state.creator.steps,
    };
    const blob = new Blob([JSON.stringify(course, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = site + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---------- 收尾 ----------

  function stopAll() {
    clearOverlay();
    if (state.creator) {
      state.creator.bar.remove();
      state.creator.panel.remove();
      document.removeEventListener("mouseover", state.creator.onHover, true);
      document.removeEventListener("click", state.creator.onClick, true);
      document.removeEventListener("keydown", state.creator.onKey, true);
      state.creator = null;
    }
    state.mode = null;
    state.course = null;
    chrome.runtime.sendMessage({ type: "COURSE_STOPPED" });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ---------- 消息路由 ----------

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "START_COURSE") {
      startLearn(msg.course);
      sendResponse({ ok: true });
    } else if (msg.type === "TOGGLE_CREATOR") {
      toggleCreator();
      sendResponse({ ok: true });
    } else if (msg.type === "STOP_ALL") {
      stopAll();
      sendResponse({ ok: true });
    }
    return false;
  });
})();
