(() => {
  "use strict";

  const STORAGE_KEY = "mylist.v1";

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) throw new Error("empty");
      const parsed = JSON.parse(raw);
      return {
        notes: Array.isArray(parsed.notes) ? parsed.notes : [],
        todos: Array.isArray(parsed.todos) ? parsed.todos : [],
        checklists: Array.isArray(parsed.checklists) ? parsed.checklists : [],
      };
    } catch (e) {
      return { notes: [], todos: [], checklists: [] };
    }
  }

  let state = loadState();

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
    if (sameDay) return `วันนี้ ${time}`;
    return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" }) + ` ${time}`;
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  const checkSvg = '<svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const trashSvg = '<svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0v13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const plusSvg = '<svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

  // ---------- Tabs ----------
  const tabTitles = { notes: "Notes", todo: "Todo", checklist: "Checklist" };
  const tabButtons = document.querySelectorAll(".tab-btn");
  const panels = {
    notes: document.getElementById("panel-notes"),
    todo: document.getElementById("panel-todo"),
    checklist: document.getElementById("panel-checklist"),
  };
  const pageTitle = document.getElementById("page-title");
  let activeTab = "notes";

  function setTab(tab) {
    activeTab = tab;
    tabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tab));
    Object.entries(panels).forEach(([key, el]) => { el.hidden = key !== tab; });
    pageTitle.textContent = tabTitles[tab];
  }

  tabButtons.forEach((btn) => btn.addEventListener("click", () => setTab(btn.dataset.tab)));

  // ---------- Sheets ----------
  const backdrop = document.getElementById("sheet-backdrop");
  let openSheetEl = null;

  function openSheet(id) {
    const el = document.getElementById(id);
    openSheetEl = el;
    backdrop.classList.add("visible");
    el.classList.add("open");
    const input = el.querySelector("input, textarea");
    if (input) setTimeout(() => input.focus(), 200);
  }

  function closeSheet() {
    if (openSheetEl) openSheetEl.classList.remove("open");
    backdrop.classList.remove("visible");
    openSheetEl = null;
  }

  backdrop.addEventListener("click", closeSheet);
  document.querySelectorAll("[data-close-sheet]").forEach((btn) => {
    btn.addEventListener("click", () => closeSheet());
  });

  // ---------- Notes ----------
  const notesList = document.getElementById("notes-list");
  const notesEmpty = document.getElementById("notes-empty");

  function renderNotes() {
    notesList.innerHTML = "";
    notesEmpty.style.display = state.notes.length ? "none" : "";
    state.notes
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .forEach((note) => {
        const li = document.createElement("li");
        li.className = "card note-card";
        li.innerHTML = `
          <h3>${escapeHtml(note.title || "ไม่มีหัวข้อ")}</h3>
          ${note.content ? `<p>${escapeHtml(note.content)}</p>` : ""}
          <div class="card-footer">
            <span class="card-time">${formatTime(note.updatedAt)}</span>
            <button class="icon-btn" data-delete-note="${note.id}" aria-label="ลบ">${trashSvg}</button>
          </div>`;
        notesList.appendChild(li);
      });
  }

  notesList.addEventListener("click", (e) => {
    const delBtn = e.target.closest("[data-delete-note]");
    if (delBtn) {
      state.notes = state.notes.filter((n) => n.id !== delBtn.dataset.deleteNote);
      saveState();
      renderNotes();
    }
  });

  document.getElementById("note-save").addEventListener("click", () => {
    const titleEl = document.getElementById("note-title");
    const contentEl = document.getElementById("note-content");
    const title = titleEl.value.trim();
    const content = contentEl.value.trim();
    if (!title && !content) { closeSheet(); return; }
    state.notes.push({ id: uid(), title, content, updatedAt: Date.now() });
    saveState();
    renderNotes();
    titleEl.value = "";
    contentEl.value = "";
    closeSheet();
  });

  // ---------- Todo ----------
  const todoList = document.getElementById("todo-list");
  const todoEmpty = document.getElementById("todo-empty");

  function renderTodos() {
    todoList.innerHTML = "";
    todoEmpty.style.display = state.todos.length ? "none" : "";
    state.todos
      .slice()
      .sort((a, b) => Number(a.done) - Number(b.done) || b.createdAt - a.createdAt)
      .forEach((todo) => {
        const li = document.createElement("li");
        li.className = "card todo-item" + (todo.done ? " done" : "");
        li.innerHTML = `
          <span class="check-circle" data-toggle-todo="${todo.id}">${checkSvg}</span>
          <span class="todo-text">${escapeHtml(todo.text)}</span>
          <button class="icon-btn" data-delete-todo="${todo.id}" aria-label="ลบ">${trashSvg}</button>`;
        todoList.appendChild(li);
      });
  }

  todoList.addEventListener("click", (e) => {
    const toggle = e.target.closest("[data-toggle-todo]");
    const del = e.target.closest("[data-delete-todo]");
    if (toggle) {
      const t = state.todos.find((x) => x.id === toggle.dataset.toggleTodo);
      if (t) { t.done = !t.done; saveState(); renderTodos(); }
    } else if (del) {
      state.todos = state.todos.filter((x) => x.id !== del.dataset.deleteTodo);
      saveState();
      renderTodos();
    }
  });

  document.getElementById("todo-save").addEventListener("click", () => {
    const input = document.getElementById("todo-text");
    const text = input.value.trim();
    if (!text) { closeSheet(); return; }
    state.todos.push({ id: uid(), text, done: false, createdAt: Date.now() });
    saveState();
    renderTodos();
    input.value = "";
    closeSheet();
  });

  // ---------- Checklist ----------
  const checklistGroups = document.getElementById("checklist-groups");
  const checklistEmpty = document.getElementById("checklist-empty");
  let pendingChecklistId = null;

  function renderChecklists() {
    checklistGroups.innerHTML = "";
    checklistEmpty.style.display = state.checklists.length ? "none" : "";
    state.checklists
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .forEach((cl) => {
        const items = cl.items || [];
        const doneCount = items.filter((i) => i.done).length;
        const pct = items.length ? Math.round((doneCount / items.length) * 100) : 0;

        const card = document.createElement("div");
        card.className = "checklist-card";
        card.innerHTML = `
          <div class="checklist-head">
            <h3>${escapeHtml(cl.title)}</h3>
            <button class="icon-btn" data-delete-checklist="${cl.id}" aria-label="ลบ">${trashSvg}</button>
          </div>
          <div class="checklist-progress">${doneCount}/${items.length} เสร็จแล้ว</div>
          <div class="progress-bar"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
          <ul class="checklist-items">
            ${items.map((item) => `
              <li class="checklist-item${item.done ? " done" : ""}">
                <span class="check-circle" data-toggle-item="${cl.id}:${item.id}">${checkSvg}</span>
                <span class="item-text">${escapeHtml(item.text)}</span>
                <button class="icon-btn" data-delete-item="${cl.id}:${item.id}" aria-label="ลบ">${trashSvg}</button>
              </li>`).join("")}
          </ul>
          <div class="checklist-add-item">
            <button data-add-item="${cl.id}">${plusSvg} เพิ่มรายการ</button>
          </div>`;
        checklistGroups.appendChild(card);
      });
  }

  checklistGroups.addEventListener("click", (e) => {
    const toggle = e.target.closest("[data-toggle-item]");
    const delItem = e.target.closest("[data-delete-item]");
    const delCl = e.target.closest("[data-delete-checklist]");
    const addItem = e.target.closest("[data-add-item]");

    if (toggle) {
      const [clId, itemId] = toggle.dataset.toggleItem.split(":");
      const cl = state.checklists.find((c) => c.id === clId);
      const item = cl && cl.items.find((i) => i.id === itemId);
      if (item) { item.done = !item.done; saveState(); renderChecklists(); }
    } else if (delItem) {
      const [clId, itemId] = delItem.dataset.deleteItem.split(":");
      const cl = state.checklists.find((c) => c.id === clId);
      if (cl) { cl.items = cl.items.filter((i) => i.id !== itemId); saveState(); renderChecklists(); }
    } else if (delCl) {
      state.checklists = state.checklists.filter((c) => c.id !== delCl.dataset.deleteChecklist);
      saveState();
      renderChecklists();
    } else if (addItem) {
      pendingChecklistId = addItem.dataset.addItem;
      openSheet("checklist-item-sheet");
    }
  });

  document.getElementById("checklist-save").addEventListener("click", () => {
    const input = document.getElementById("checklist-title");
    const title = input.value.trim();
    if (!title) { closeSheet(); return; }
    state.checklists.push({ id: uid(), title, items: [], createdAt: Date.now() });
    saveState();
    renderChecklists();
    input.value = "";
    closeSheet();
  });

  document.getElementById("checklist-item-save").addEventListener("click", () => {
    const input = document.getElementById("checklist-item-text");
    const text = input.value.trim();
    if (text && pendingChecklistId) {
      const cl = state.checklists.find((c) => c.id === pendingChecklistId);
      if (cl) {
        cl.items.push({ id: uid(), text, done: false });
        saveState();
        renderChecklists();
      }
    }
    input.value = "";
    pendingChecklistId = null;
    closeSheet();
  });

  // ---------- FAB ----------
  document.getElementById("fab-add").addEventListener("click", () => {
    if (activeTab === "notes") openSheet("note-sheet");
    else if (activeTab === "todo") openSheet("todo-sheet");
    else openSheet("checklist-sheet");
  });

  // ---------- Init ----------
  renderNotes();
  renderTodos();
  renderChecklists();
  setTab("notes");

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
