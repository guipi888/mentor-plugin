// 导师 Mentor - background service worker
// 职责：课程存储初始化（内置示例课程）、徽标显示、popup 与 content 的消息中转

const STORAGE_KEY = "mentor_courses";
const STATE_KEY = "mentor_state";
const BUILTIN_COURSES = ["courses/gzh-basic.json"];

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get([STORAGE_KEY], async (res) => {
    const courses = res[STORAGE_KEY] || {};
    let changed = false;
    for (const path of BUILTIN_COURSES) {
      try {
        const resp = await fetch(chrome.runtime.getURL(path));
        const course = await resp.json();
        const id = course.id || "builtin_" + path;
        if (!courses[id]) {
          courses[id] = course;
          changed = true;
        }
      } catch (e) {
        console.warn("内置课程加载失败:", path, e);
      }
    }
    if (changed || !res[STORAGE_KEY]) {
      chrome.storage.local.set({ [STORAGE_KEY]: courses });
    }
  });
});

// 徽标显示当前步骤进度（如 2/5）
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "STEP_CHANGED" && sender.tab) {
    chrome.action.setBadgeBackgroundColor({ color: "#D97A3E" });
    chrome.action.setBadgeText({
      text: `${msg.step}/${msg.total}`,
      tabId: sender.tab.id,
    });
  }
  if (msg.type === "COURSE_FINISHED" && sender.tab) {
    chrome.action.setBadgeText({ text: "", tabId: sender.tab.id });
  }
  if (msg.type === "COURSE_STOPPED" && sender.tab) {
    chrome.action.setBadgeText({ text: "", tabId: sender.tab.id });
  }
  return false;
});
