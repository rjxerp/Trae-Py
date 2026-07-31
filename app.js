/* ================= Task Reminder App ================= */

const STORAGE_KEY = "task_reminder_tasks_v1";
const NOTIFIED_KEY = "task_reminder_notified_v1";

let tasks = [];
let notifiedIds = new Set();
let currentFilter = "all";
let reminderTimer = null;

/* ---------- DOM Refs ---------- */
const $ = (id) => document.getElementById(id);
const taskForm = $("task-form");
const taskTitle = $("task-title");
const taskDesc = $("task-desc");
const taskDue = $("task-due");
const taskRemind = $("task-remind");
const taskList = $("task-list");
const emptyState = $("empty-state");
const filtersWrap = $("filters");
const toast = $("toast");
const enableNotifBtn = $("enable-notification");

/* ---------- Storage Helpers ---------- */
function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    tasks = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(tasks)) tasks = [];
  } catch (e) {
    console.error("加载任务失败", e);
    tasks = [];
  }
  try {
    const raw = localStorage.getItem(NOTIFIED_KEY);
    notifiedIds = new Set(raw ? JSON.parse(raw) : []);
  } catch (e) {
    notifiedIds = new Set();
  }
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...notifiedIds]));
}

/* ---------- Utilities ---------- */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function humanizeDelta(targetIso) {
  if (!targetIso) return { text: "", level: "normal" };
  const now = Date.now();
  const target = new Date(targetIso).getTime();
  if (isNaN(target)) return { text: "", level: "normal" };
  const diffMs = target - now;
  const absSec = Math.abs(Math.round(diffMs / 1000));

  if (diffMs < 0) {
    if (absSec < 60) return { text: "刚刚过期", level: "overdue" };
    if (absSec < 3600) return { text: `${Math.floor(absSec / 60)} 分钟前过期`, level: "overdue" };
    if (absSec < 86400) return { text: `${Math.floor(absSec / 3600)} 小时前过期`, level: "overdue" };
    return { text: `${Math.floor(absSec / 86400)} 天前过期`, level: "overdue" };
  }

  if (absSec < 60) return { text: "即将到达", level: "soon" };
  if (absSec < 3600) return { text: `${Math.floor(absSec / 60)} 分钟后到期`, level: absSec < 1800 ? "soon" : "normal" };
  if (absSec < 86400) return { text: `${Math.floor(absSec / 3600)} 小时后到期`, level: absSec < 3600 * 6 ? "soon" : "normal" };
  return { text: `${Math.floor(absSec / 86400)} 天后到期`, level: "normal" };
}

function getTaskStatus(task) {
  if (task.done) return "done";
  if (task.dueAt && new Date(task.dueAt).getTime() < Date.now()) return "overdue";
  return "pending";
}

function matchesFilter(task) {
  const status = getTaskStatus(task);
  if (currentFilter === "all") return true;
  return status === currentFilter;
}

/* ---------- Toast ---------- */
let toastTimer = null;
function showToast(message, type = "info", duration = 2200) {
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.className = "toast hidden";
  }, duration);
}

/* ---------- Render ---------- */
function renderCounts() {
  const counts = { all: tasks.length, pending: 0, overdue: 0, done: 0 };
  tasks.forEach((t) => counts[getTaskStatus(t)]++);
  $("count-all").textContent = counts.all;
  $("count-pending").textContent = counts.pending;
  $("count-overdue").textContent = counts.overdue;
  $("count-done").textContent = counts.done;
}

function statusLabel(status) {
  return { pending: "待办", overdue: "已过期", done: "已完成" }[status] || status;
}

function createTaskCard(task) {
  const status = getTaskStatus(task);
  const card = document.createElement("div");
  card.className = `task-card ${status}`;
  card.dataset.id = task.id;

  const dueInfo = task.dueAt ? humanizeDelta(task.dueAt) : null;
  const remindInfo = task.remindAt ? formatDateTime(task.remindAt) : "";

  const metaHTML = `
    <div class="task-meta">
      <span class="status-tag ${status}">${statusLabel(status)}</span>
      ${task.dueAt ? `
        <span class="meta-item ${dueInfo.level === "overdue" ? "overdue" : dueInfo.level === "soon" ? "due-soon" : ""}">
          ⏰ ${formatDateTime(task.dueAt)} · ${dueInfo.text}
        </span>` : ""}
      ${task.remindAt ? `
        <span class="meta-item">
          🔔 提醒：${remindInfo}
        </span>` : ""}
    </div>`;

  card.innerHTML = `
    <div class="task-main">
      <div class="task-title">${escapeHTML(task.title)}</div>
      ${task.description ? `<div class="task-desc">${escapeHTML(task.description)}</div>` : ""}
      ${metaHTML}
    </div>
    <div class="task-actions">
      ${status === "done"
        ? `<button class="icon-btn undo" data-action="undo" title="标记为未完成">↶ 撤销</button>`
        : `<button class="icon-btn done" data-action="done" title="标记完成">✓ 完成</button>`}
      <button class="icon-btn delete" data-action="delete" title="删除任务">✕ 删除</button>
    </div>`;

  return card;
}

function escapeHTML(s) {
  const div = document.createElement("div");
  div.textContent = String(s ?? "");
  return div.innerHTML;
}

function renderTasks() {
  renderCounts();
  const visible = tasks.filter(matchesFilter);

  if (visible.length === 0) {
    taskList.innerHTML = "";
    emptyState.classList.remove("hidden");
    return;
  }
  emptyState.classList.add("hidden");

  const order = { overdue: 0, pending: 1, done: 2 };
  visible.sort((a, b) => {
    const sa = order[getTaskStatus(a)] ?? 3;
    const sb = order[getTaskStatus(b)] ?? 3;
    if (sa !== sb) return sa - sb;
    const at = a.dueAt ? new Date(a.dueAt).getTime() : 0;
    const bt = b.dueAt ? new Date(b.dueAt).getTime() : 0;
    if (at && bt) return at - bt;
    return b.createdAt - a.createdAt;
  });

  const frag = document.createDocumentFragment();
  visible.forEach((t) => frag.appendChild(createTaskCard(t)));
  taskList.innerHTML = "";
  taskList.appendChild(frag);
}

/* ---------- Task Actions ---------- */
function addTask(data) {
  const task = {
    id: uid(),
    title: data.title.trim(),
    description: (data.description || "").trim(),
    dueAt: data.dueAt || null,
    remindAt: data.remindAt || null,
    done: false,
    createdAt: Date.now(),
  };
  tasks.unshift(task);
  saveTasks();
  renderTasks();
  showToast("任务已添加 🎉", "success");
}

function toggleDone(id) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  t.done = !t.done;
  saveTasks();
  renderTasks();
  showToast(t.done ? "已标记完成 ✓" : "已撤销完成", "info");
}

function deleteTask(id) {
  const before = tasks.length;
  tasks = tasks.filter((x) => x.id !== id);
  notifiedIds.delete(id);
  if (tasks.length !== before) {
    saveTasks();
    renderTasks();
    showToast("任务已删除", "info");
  }
}

/* ---------- Form ---------- */
function onFormSubmit(e) {
  e.preventDefault();
  const title = taskTitle.value;
  if (!title.trim()) {
    showToast("请填写任务标题", "error");
    taskTitle.focus();
    return;
  }
  const dueAt = taskDue.value ? new Date(taskDue.value).toISOString() : null;
  let remindAt = taskRemind.value ? new Date(taskRemind.value).toISOString() : null;

  if (dueAt && remindAt && new Date(remindAt) > new Date(dueAt)) {
    showToast("提醒时间不能晚于截止时间", "error");
    return;
  }

  addTask({
    title,
    description: taskDesc.value,
    dueAt,
    remindAt,
  });
  taskForm.reset();
}

/* ---------- Filters ---------- */
function onFilterClick(e) {
  const btn = e.target.closest(".filter");
  if (!btn) return;
  currentFilter = btn.dataset.filter;
  [...filtersWrap.querySelectorAll(".filter")].forEach((b) => {
    b.classList.toggle("active", b === btn);
  });
  renderTasks();
}

/* ---------- Task list actions (delegation) ---------- */
function onTaskListClick(e) {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const card = e.target.closest(".task-card");
  if (!card) return;
  const id = card.dataset.id;
  const action = btn.dataset.action;
  if (action === "done" || action === "undo") toggleDone(id);
  else if (action === "delete") {
    if (confirm("确定要删除这个任务吗？")) deleteTask(id);
  }
}

/* ---------- Notifications & Reminders ---------- */
async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    showToast("当前浏览器不支持桌面通知", "error");
    return;
  }
  if (Notification.permission === "granted") {
    showToast("通知已开启 🔔", "success");
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      showToast("通知已开启 🔔", "success");
      sendNotification("任务提醒通知已启用", "当设置了提醒时间，你会在时间到达时收到通知。");
    } else {
      showToast("通知权限被拒绝", "error");
    }
  } catch (e) {
    showToast("无法请求通知权限", "error");
  }
}

function sendNotification(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, {
      body,
      icon: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📋</text></svg>",
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch (e) {
    console.warn("发送通知失败", e);
  }
}

function checkReminders() {
  const now = Date.now();
  let dirty = false;
  tasks.forEach((t) => {
    if (t.done || !t.remindAt) return;
    if (notifiedIds.has(t.id)) return;
    const remindTime = new Date(t.remindAt).getTime();
    if (remindTime <= now) {
      notifiedIds.add(t.id);
      dirty = true;
      const body =
        (t.dueAt ? `截止：${formatDateTime(t.dueAt)}\n` : "") +
        (t.description ? t.description : "点击查看详情");
      sendNotification(`🔔 任务提醒：${t.title}`, body);
      showToast(`提醒：${t.title}`, "info", 3500);
    }
  });
  if (dirty) saveTasks();
}

function startReminderLoop() {
  clearInterval(reminderTimer);
  checkReminders();
  reminderTimer = setInterval(checkReminders, 30_000);
}

/* ---------- Init ---------- */
function init() {
  loadTasks();
  renderTasks();

  taskForm.addEventListener("submit", onFormSubmit);
  filtersWrap.addEventListener("click", onFilterClick);
  taskList.addEventListener("click", onTaskListClick);
  enableNotifBtn.addEventListener("click", requestNotificationPermission);

  startReminderLoop();

  if ("Notification" in window && Notification.permission === "granted") {
    enableNotifBtn.textContent = "🔔 通知已开启";
    enableNotifBtn.disabled = true;
    enableNotifBtn.style.opacity = "0.7";
    enableNotifBtn.style.cursor = "default";
  }

  // 每 60 秒刷新一次渲染以更新倒计时文案
  setInterval(() => {
    const pendingOrOverdue = tasks.some((t) => !t.done && t.dueAt);
    if (pendingOrOverdue) renderTasks();
  }, 60_000);
}

document.addEventListener("DOMContentLoaded", init);
