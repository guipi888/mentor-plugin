// 导师 Mentor - popup 逻辑
const STORAGE_KEY = "mentor_courses";

const $ = (id) => document.getElementById(id);

function showStatus(text) {
  const el = $("status");
  el.textContent = text;
  el.style.display = "block";
  setTimeout(() => { el.style.display = "none"; }, 3000);
}

async function getCourses() {
  const res = await chrome.storage.local.get(STORAGE_KEY);
  return res[STORAGE_KEY] || {};
}

async function setCourses(courses) {
  await chrome.storage.local.set({ [STORAGE_KEY]: courses });
}

async function renderList() {
  const courses = await getCourses();
  const list = $("course-list");
  list.innerHTML = "";
  const ids = Object.keys(courses);
  if (ids.length === 0) {
    list.innerHTML = '<div class="course-item"><span class="name" style="color:#8A7F76">暂无课程，用创作模式创建一门</span></div>';
    return;
  }
  ids.forEach((id) => {
    const c = courses[id];
    const item = document.createElement("div");
    item.className = "course-item";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = c.site;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `${(c.steps || []).length} 步`;
    const startBtn = document.createElement("button");
    startBtn.className = "primary";
    startBtn.textContent = "开始";
    startBtn.onclick = () => startCourse(id);
    const delBtn = document.createElement("button");
    delBtn.className = "ghost";
    delBtn.textContent = "删除";
    delBtn.onclick = async () => {
      if (!confirm(`确认删除课程「${c.site}」？此操作不可恢复。`)) return;
      delete courses[id];
      await setCourses(courses);
      renderList();
    };
    item.append(name, meta, startBtn, delBtn);
    list.appendChild(item);
  });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function startCourse(id) {
  const tab = await getActiveTab();
  if (!tab) return;
  const courses = await getCourses();
  chrome.tabs.sendMessage(tab.id, { type: "START_COURSE", courseId: id, course: courses[id] }, () => {
    if (chrome.runtime.lastError) {
      showStatus("当前页面不支持，请在课程匹配的网站上使用");
    }
  });
  window.close();
}

async function exportCourse() {
  const courses = await getCourses();
  const ids = Object.keys(courses);
  if (ids.length === 0) { showStatus("没有可导出的课程"); return; }
  const blob = new Blob([JSON.stringify(courses[ids[0]], null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${courses[ids[0]].site || "course"}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importCourse(file) {
  try {
    const text = await file.text();
    const course = JSON.parse(text);
    if (!course.site || !Array.isArray(course.steps) || course.steps.length === 0) {
      showStatus("课程文件格式不正确");
      return;
    }
    const courses = await getCourses();
    const id = `course_${Date.now()}`;
    courses[id] = course;
    await setCourses(courses);
    renderList();
    showStatus("导入成功");
  } catch (e) {
    showStatus("导入失败：" + e.message);
  }
}

$("btn-import").onclick = () => $("file-input").click();
$("file-input").onchange = (e) => { if (e.target.files[0]) importCourse(e.target.files[0]); };
$("btn-export").onclick = exportCourse;

$("btn-creator").onclick = async () => {
  const tab = await getActiveTab();
  if (!tab) return;
  chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_CREATOR" }, () => {
    if (chrome.runtime.lastError) showStatus("当前页面不支持创作模式");
  });
  window.close();
};

$("btn-stop").onclick = async () => {
  const tab = await getActiveTab();
  if (!tab) return;
  chrome.tabs.sendMessage(tab.id, { type: "STOP_ALL" });
  window.close();
};

renderList();
