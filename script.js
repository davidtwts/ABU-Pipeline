import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, doc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// --- 1. 設定與權限 ---
const firebaseConfig = {
  apiKey: "AIzaSyDp5A_2rdWAc-74-47m9YwPB6hSIBPJm4k",
  authDomain: "abu-pipeline.firebaseapp.com",
  projectId: "abu-pipeline",
  storageBucket: "abu-pipeline.firebasestorage.app",
  messagingSenderId: "813248306952",
  appId: "1:813248306952:web:c2ad63244075396bab96bd",
  measurementId: "G-29PQ9X28MD"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ★ PM 名單
const PM_EMAILS = [
    "pm@company.com", 
    "boss@company.com",
    "davidtwts@gmail.com", 
    "angelwang@everlight.com",
    "normanhung@everlight.com",
    "carinachen@everlight.com",
    "stevenlee@everlight.com",
    "ailingting@everlight.com",
    "celialin@everlight.com",
    "liyangjen@everlight.com",
    "davidtseng@everlight.com",
    "brucezhang@everlight.com" 
];

const DAILY_LIMIT = 5; 

// 狀態變數
let currentUserRole = 'rd'; 
let allTasksData = [];
let allMembers = [];
let currentCalendarDate = new Date();
let draggedTaskId = null;
let currentDayFilter = new Date().toISOString().split('T')[0];
let currentGroupFilter = "ALL"; 

// DOM Elements
const loginOverlay = document.getElementById("login-overlay");
const appContainer = document.getElementById("app-container");
const taskModal = document.getElementById("task-modal");
const taskForm = document.getElementById("task-form");
const viewKanban = document.getElementById("view-kanban");
const viewCalendar = document.getElementById("view-calendar");
const groupFilterSelect = document.getElementById("group-filter");

// --- 2. 驗證與權限邏輯 ---
onAuthStateChanged(auth, (user) => {
  if (user) {
      console.log("目前登入者:", user.email);
      const userEmail = user.email.trim().toLowerCase(); 
      const isPM = PM_EMAILS.some(email => email.trim().toLowerCase() === userEmail);

      if (isPM) {
          currentUserRole = 'pm';
          document.getElementById("role-badge").textContent = "PM (管理者)";
          document.getElementById("role-badge").className = "mr-2 text-xs px-2 py-1 rounded font-bold bg-blue-600 text-white";
          
          document.querySelectorAll('.pm-only').forEach(el => {
              el.classList.remove('hidden'); 
              if (el.tagName === 'BUTTON') {
                  if (el.parentElement.classList.contains('flex')) {
                        el.style.display = 'block'; 
                  } else {
                        el.style.display = 'block'; 
                  }
              } else {
                  el.style.display = 'block';
              }
          });
          
          const pmControls = document.getElementById("pm-controls"); 
          if(pmControls) pmControls.style.display = "block";

      } else {
          currentUserRole = 'rd';
          document.getElementById("role-badge").textContent = "RD (檢視模式)";
          document.querySelectorAll('.pm-only').forEach(el => {
              el.classList.add('hidden');
          });
      }

      loginOverlay.classList.add("hidden");
      appContainer.style.display = "flex";
      
      document.getElementById("user-info").textContent = user.displayName || user.email;
      document.getElementById("current-date-display").textContent = currentDayFilter;
      
      loadMembers();
      listenToTasks();
      renderCalendar();
  } else {
      loginOverlay.classList.remove("hidden");
      appContainer.style.display = "none";
  }
});

// --- Email/Password 登入 ---
document.getElementById("loginBtn").addEventListener("click", async () => {
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const errorMsg = document.getElementById("login-error");

    if (!email || !password) {
        alert("請輸入帳號與密碼");
        return;
    }

    try {
        await signInWithEmailAndPassword(auth, email, password);
        errorMsg.classList.add("hidden");
    } catch (error) {
        console.error("登入失敗:", error.code, error.message);
        errorMsg.textContent = "登入失敗：帳號不存在或密碼錯誤";
        errorMsg.classList.remove("hidden");
    }
});

document.getElementById("logoutBtn").addEventListener("click", () => signOut(auth));

// --- 3. 篩選邏輯 ---
groupFilterSelect.addEventListener("change", (e) => {
    currentGroupFilter = e.target.value;
    listenToTasks(); 
    loadMembers();   
});


// --- 4. 瀑布流排程演算法 ---
function allocateBookings(startDateStr, totalHours, priority, targetAssignee = null) {
    let bookings = [];
    let remainingHours = parseFloat(totalHours);
    let checkDate = new Date(startDateStr);
    let occupied = {}; 

    allTasksData.forEach(t => {
        // ★ 關鍵修正：只計算目標 RD 的產能，避免被其他人的任務卡住
        if (targetAssignee && t.assignee !== targetAssignee) return;

        if(t.bookings) {
            t.bookings.forEach(b => {
                if(!occupied[b.date]) occupied[b.date] = 0;
                occupied[b.date] += parseFloat(b.hours);
            });
        }
    });

    while (remainingHours > 0) {
        const dateStr = checkDate.toISOString().split('T')[0];
        const dayUsage = occupied[dateStr] || 0;
        let available = DAILY_LIMIT - dayUsage;
        if (priority === 'red') available = 999; 

        if (available > 0) {
            const allocate = Math.min(remainingHours, available);
            bookings.push({ date: dateStr, hours: allocate });
            remainingHours -= allocate;
            if(!occupied[dateStr]) occupied[dateStr] = 0;
            occupied[dateStr] += allocate;
        }
        checkDate.setDate(checkDate.getDate() + 1);
        if (checkDate.getFullYear() > new Date().getFullYear() + 1) break; 
    }
    return bookings;
}


// --- 5. 任務監聽與渲染 ---
function listenToTasks() {
    const q = query(collection(db, "tasks"), orderBy("submitDate", "asc"));
    onSnapshot(q, (snapshot) => {
        document.getElementById("todo").innerHTML = "";
        document.getElementById("doing").innerHTML = "";
        document.getElementById("done").innerHTML = "";
        let counts = { todo: 0, doing: 0, done: 0 };
        allTasksData = [];
        
        snapshot.forEach((docSnap) => {
            const task = docSnap.data();
            task.id = docSnap.id;
            allTasksData.push(task);

            if (currentGroupFilter !== "ALL" && task.group !== currentGroupFilter) {
                return; 
            }

            const container = document.getElementById(task.status || "todo");
            if (container) {
                const card = createKanbanCard(task);
                container.appendChild(card);
                counts[task.status]++;
            }
        });

        document.getElementById("count-todo").textContent = counts.todo;
        document.getElementById("count-doing").textContent = counts.doing;
        document.getElementById("count-done").textContent = counts.done;

        renderRDList(); 
        if (!viewCalendar.classList.contains("hidden")) renderCalendar();
    });
}

function createKanbanCard(task) {
    const today = new Date().toISOString().split('T')[0];
    let isOverdue = (task.submitDate < today && task.status !== "done");
    
    const card = document.createElement("div");
    card.className = `kanban-card card-${task.status}`;
    card.classList.add(`group-${task.group || 'NONE'}`);

    if (task.status === 'done') card.classList.add('status-done');
    if (task.priority === 'red') card.classList.add('priority-red');
    if (isOverdue && task.priority !== 'red') card.style.border = "2px solid #f59e0b"; 

    if (currentUserRole === 'pm') {
        card.draggable = true;
        card.style.cursor = "grab";
        
        card.addEventListener("dragstart", (e) => {
            draggedTaskId = task.id;
            card.style.opacity = "0.5";
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", task.id);
        });
        
        card.addEventListener("dragend", () => {
            draggedTaskId = null;
            card.style.opacity = "1";
        });
        
        card.addEventListener("click", () => openModal(task.status, task));
    } else {
        card.style.cursor = "default";
    }

    // ★ 這裡加了 pointer-events-none 確保拖曳卡片內容不會干擾
    card.innerHTML = `
        <div class="flex justify-between items-start mb-1 pointer-events-none">
            <span class="font-bold text-gray-800 text-sm">${task.product || '未命名'}</span>
             <span class="text-[9px] px-1 rounded bg-gray-100 text-gray-500">${task.group || '-'}</span>
        </div>
        <div class="text-[11px] text-gray-500 mb-2 pointer-events-none">${task.bo || ''}</div>
        <div class="flex justify-between items-center text-[10px] pointer-events-none">
            <span class="${isOverdue ? 'text-red-600 font-bold' : 'text-gray-500'}">
                <i class="far fa-calendar-alt"></i> ${task.submitDate}
            </span>
            <div class="flex gap-1">
                 <span class="bg-gray-100 px-1 rounded border">⏳ ${task.estHours || 1}h</span>
                 ${task.assignee ? `<span class="bg-blue-100 text-blue-700 px-2 rounded-full font-bold">${task.assignee}</span>` : ''}
            </div>
        </div>
    `;
    return card;
}

// --- 6. R&D 成員載入與渲染 (★ 關鍵修正區域) ---
function loadMembers() {
    const q = query(collection(db, "members"), orderBy("name"));
    onSnapshot(q, (snapshot) => {
        allMembers = [];
        snapshot.forEach(doc => {
            allMembers.push({ id: doc.id, ...doc.data() });
        });
        renderRDList();
    });
}

function renderRDList() {
    const rdListDiv = document.getElementById("rd-list");
    if (!rdListDiv) return;
    rdListDiv.innerHTML = "";

    const rdUsage = {};
    allTasksData.forEach(task => {
        if (task.assignee && task.status !== 'done' && task.bookings) {
            const todayBooking = task.bookings.find(b => b.date === currentDayFilter);
            if (todayBooking) {
                if (!rdUsage[task.assignee]) rdUsage[task.assignee] = 0;
                rdUsage[task.assignee] += parseFloat(todayBooking.hours);
            }
        }
    });

    const displayedMembers = allMembers.filter(m => {
        const mGroup = m.group || 'ALFS';
        if (currentGroupFilter === "ALL") return true;
        return mGroup === currentGroupFilter;
    });

    displayedMembers.forEach(member => {
        const usedHours = rdUsage[member.name] || 0;
        const percentage = Math.min((usedHours / DAILY_LIMIT) * 100, 100);
        const memberGroup = member.group || 'ALFS'; 
        
        let barClass = "capacity-bar-fill";
        if (usedHours >= DAILY_LIMIT) barClass += " warning"; 
        if (usedHours > DAILY_LIMIT) barClass += " danger";   

        let barColor = "#64748b"; 
        if (memberGroup === 'ALFS') barColor = "#8b5cf6";
        if (memberGroup === 'HP')   barColor = "#3b82f6";
        if (memberGroup === 'LP')   barColor = "#06b6d4";
        if (memberGroup === 'RGB')  barColor = "#ec4899";
        if (memberGroup === 'APTS') barColor = "#f97316";

        const div = document.createElement("div");
        div.className = "rd-member-card flex-col items-start relative group hover:shadow-md"; 
        div.dataset.name = member.name;
        
        let editBtnHtml = "";
        if (currentUserRole === 'pm') {
            editBtnHtml = `
                <button class="edit-member-trigger absolute top-2 right-2 text-gray-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition" title="編輯成員">
                    <i class="fas fa-pen"></i>
                </button>
            `;
        }

        // ★★★ 關鍵修正：加上 style="pointer-events: none;" 強制讓滑鼠穿透文字 ★★★
        div.innerHTML = `
            ${editBtnHtml}
            <div class="flex justify-between w-full items-center" style="pointer-events: none;">
                <div class="flex items-center gap-2">
                    <div class="w-6 h-6 rounded-full flex items-center justify-center text-white font-bold text-[10px]" style="background-color: ${barColor}">
                        ${memberGroup.substring(0,1)}
                    </div>
                    <div class="font-medium text-gray-700 text-sm">
                        ${member.name} 
                        <span class="text-[9px] text-gray-400">(${memberGroup})</span>
                    </div>
                </div>
                <div class="text-xs font-bold ${usedHours > DAILY_LIMIT ? 'text-red-500' : 'text-gray-500'}">
                    ${usedHours} / ${DAILY_LIMIT} h
                </div>
            </div>
            <div class="w-full capacity-bar-bg" style="pointer-events: none;">
                <div class="${barClass}" style="width: ${percentage}%; background-color: ${usedHours > DAILY_LIMIT ? '#ef4444' : barColor};"></div>
            </div>
        `;

        if (currentUserRole === 'pm') {
            const editBtn = div.querySelector('.edit-member-trigger');
            if (editBtn) {
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation(); 
                    openMemberModal({ ...member, group: memberGroup }); 
                });
            }

            div.addEventListener("dragover", (e) => { 
                e.preventDefault(); 
                e.dataTransfer.dropEffect = "move"; 
                div.classList.add("drag-over"); 
            });
            div.addEventListener("dragleave", () => div.classList.remove("drag-over"));
            div.addEventListener("drop", async (e) => {
                e.preventDefault();
                div.classList.remove("drag-over");
                if (draggedTaskId) {
                    await assignTaskToRD(draggedTaskId, member.name);
                }
            });
        }
        rdListDiv.appendChild(div);
    });
}

// 指派
async function assignTaskToRD(taskId, rdName) {
    const task = allTasksData.find(t => t.id === taskId);
    if (!task) return;
    if (confirm(`指派「${task.product}」給 ${rdName}？\n(排程將從 ${currentDayFilter} 開始計算)`)) {
        const startDate = currentDayFilter; 
        
        // ★ 確保傳入 rdName，解決時數沒加上去的問題
        const newBookings = allocateBookings(startDate, task.estHours || 1, task.priority, rdName);
        
        await updateDoc(doc(db, "tasks", taskId), {
            assignee: rdName,
            bookings: newBookings, 
            submitDate: newBookings.length > 0 ? newBookings[0].date : task.submitDate,
            lastUpdated: new Date().toISOString()
        });
    }
}

// --- 7. Task Modal 邏輯 ---
function openModal(status, taskData = null) {
    taskModal.classList.remove("hidden");
    const modalContent = document.getElementById("modal-content");
    
    if (taskData && taskData.priority === 'red') {
        modalContent.classList.remove('border-blue-500');
        modalContent.classList.add('border-red-500');
    } else {
        modalContent.classList.add('border-blue-500');
        modalContent.classList.remove('border-red-500');
    }

    if (taskData) {
        document.getElementById("modal-title").textContent = "編輯任務";
        document.getElementById("delete-btn").classList.remove("hidden");
        
        document.getElementById("task-id").value = taskData.id;
        document.getElementById("task-status").value = taskData.status;
        document.getElementById("inp-priority").value = taskData.priority || 'normal';
        document.getElementById("inp-group").value = taskData.group || 'ALFS'; 
        
        document.getElementById("inp-estHours").value = taskData.estHours || 1;
        document.getElementById("inp-isLocked").checked = taskData.isLocked || false;
        document.getElementById("inp-bo").value = taskData.bo || "";
        document.getElementById("inp-nbo").value = taskData.nbo || "";
        document.getElementById("inp-drsp").value = taskData.drsp || "";
        document.getElementById("inp-product").value = taskData.product || "";
        document.getElementById("inp-openDate").value = taskData.openDate || "";
        document.getElementById("inp-submitDate").value = taskData.submitDate || "";
        document.getElementById("inp-requirement").value = taskData.requirement || "";
        document.getElementById("inp-t1").value = taskData.t1 || "";
        document.getElementById("inp-oem").value = taskData.oem || "";
        document.getElementById("inp-assignee").value = taskData.assignee || "";
        document.getElementById("inp-note").value = taskData.note || "";

    } else {
        document.getElementById("modal-title").textContent = "新增排程";
        document.getElementById("delete-btn").classList.add("hidden");
        taskForm.reset();
        document.getElementById("task-id").value = "";
        document.getElementById("task-status").value = status;
        document.getElementById("inp-priority").value = "normal";
        document.getElementById("inp-group").value = currentGroupFilter !== 'ALL' ? currentGroupFilter : "ALFS"; 
        document.getElementById("inp-estHours").value = 1;
        document.getElementById("inp-openDate").value = new Date().toISOString().split('T')[0];
    }
}

document.getElementById("save-task-btn").addEventListener("click", async () => {
    const taskId = document.getElementById("task-id").value;
    const estHours = parseFloat(document.getElementById("inp-estHours").value) || 1;
    const startDate = document.getElementById("inp-submitDate").value; 
    const priority = document.getElementById("inp-priority").value;
    const group = document.getElementById("inp-group").value; 
    const assignee = document.getElementById("inp-assignee").value;

    const bookings = allocateBookings(startDate, estHours, priority, assignee);

    const taskData = {
        status: document.getElementById("task-status").value,
        priority: priority,
        group: group, 
        estHours: estHours,
        isLocked: document.getElementById("inp-isLocked").checked,
        bookings: bookings,
        
        bo: document.getElementById("inp-bo").value,
        nbo: document.getElementById("inp-nbo").value,
        drsp: document.getElementById("inp-drsp").value,
        product: document.getElementById("inp-product").value,
        openDate: document.getElementById("inp-openDate").value,
        submitDate: startDate, 
        requirement: document.getElementById("inp-requirement").value,
        t1: document.getElementById("inp-t1").value,
        oem: document.getElementById("inp-oem").value,
        assignee: assignee,
        note: document.getElementById("inp-note").value,
        lastUpdated: new Date().toISOString()
    };

    try {
        if (taskId) {
            await updateDoc(doc(db, "tasks", taskId), taskData);
        } else {
            taskData.createdAt = new Date().toISOString();
            await addDoc(collection(db, "tasks"), taskData);
        }
        taskModal.classList.add("hidden");
    } catch (e) {
        alert("儲存失敗: " + e.message);
    }
});

document.getElementById("cancel-btn").addEventListener("click", () => taskModal.classList.add("hidden"));
document.getElementById("delete-btn").addEventListener("click", async () => {
    const taskId = document.getElementById("task-id").value;
    if (confirm("確定刪除？")) {
        await deleteDoc(doc(db, "tasks", taskId));
        taskModal.classList.add("hidden");
    }
});
document.getElementById("add-todo-btn").addEventListener("click", () => openModal("todo"));
document.getElementById("add-doing-btn").addEventListener("click", () => openModal("doing"));
document.getElementById("add-done-btn").addEventListener("click", () => openModal("done"));

// 新增 RD 成員 (含組別)
const addRdBtn = document.getElementById("add-rd-btn");
if (addRdBtn) {
    addRdBtn.addEventListener("click", async () => {
        const nameInput = document.getElementById("new-rd-name");
        const groupInput = document.getElementById("new-rd-group");
        const name = nameInput.value.trim();
        const group = groupInput.value;

        if(name) { 
            await addDoc(collection(db, "members"), { name, group }); 
            nameInput.value = ""; 
        }
    });
}

// --- 8. 行事曆 ---
function renderCalendar() {
    const grid = document.getElementById("calendar-grid");
    grid.innerHTML = "";
    const year = currentCalendarDate.getFullYear();
    const month = currentCalendarDate.getMonth();
    document.getElementById("calendar-month-title").textContent = `${year}年 ${month + 1}月`;

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < firstDay; i++) {
        const blank = document.createElement("div");
        blank.className = "bg-gray-50";
        grid.appendChild(blank);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const cell = document.createElement("div");
        cell.className = "calendar-cell";
        const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        
        const numDiv = document.createElement("div");
        numDiv.className = "calendar-date-num";
        numDiv.textContent = day;
        numDiv.onclick = () => { 
            currentDayFilter = dateStr; 
            document.getElementById("current-date-display").textContent = dateStr;
            renderRDList(); 
        };
        cell.appendChild(numDiv);

        allTasksData.forEach(task => {
            if (currentGroupFilter !== "ALL" && task.group !== currentGroupFilter) return;

            if (task.bookings) {
                const booking = task.bookings.find(b => b.date === dateStr);
                if (booking) {
                    const taskDiv = document.createElement("div");
                    taskDiv.className = `calendar-task status-${task.status}`;
                    
                    if(task.priority === 'red') {
                        taskDiv.classList.add('cal-RED');
                    } else {
                        taskDiv.classList.add(`cal-${task.group || 'NONE'}`);
                    }

                    taskDiv.textContent = `${task.product}`;
                    taskDiv.title = `[${task.group}] ${task.product} (${task.assignee})`;
                    taskDiv.addEventListener("click", (e) => { e.stopPropagation(); if(currentUserRole === 'pm') openModal(task.status, task); });
                    cell.appendChild(taskDiv);
                }
            }
        });
        grid.appendChild(cell);
    }
}

document.getElementById("view-kanban-btn").addEventListener("click", () => {
    viewKanban.classList.remove("hidden"); viewKanban.classList.add("flex");
    viewCalendar.classList.add("hidden");
});
document.getElementById("view-calendar-btn").addEventListener("click", () => {
    viewKanban.classList.add("hidden"); viewKanban.classList.remove("flex");
    viewCalendar.classList.remove("hidden");
    renderCalendar();
});
document.getElementById("prev-month-btn").addEventListener("click", () => { currentCalendarDate.setMonth(currentCalendarDate.getMonth()-1); renderCalendar(); });
document.getElementById("next-month-btn").addEventListener("click", () => { currentCalendarDate.setMonth(currentCalendarDate.getMonth()+1); renderCalendar(); });
document.getElementById("today-btn").addEventListener("click", () => { currentCalendarDate = new Date(); renderCalendar(); });

// --- 9. 成員編輯視窗邏輯 ---
const memberModal = document.getElementById("member-modal");

function openMemberModal(member) {
    memberModal.classList.remove("hidden");
    document.getElementById("edit-member-id").value = member.id;
    document.getElementById("edit-member-name").value = member.name;
    document.getElementById("edit-member-group").value = member.group || "ALFS";
}

document.getElementById("cancel-member-btn").addEventListener("click", () => {
    memberModal.classList.add("hidden");
});

document.getElementById("save-member-btn").addEventListener("click", async () => {
    const memberId = document.getElementById("edit-member-id").value;
    const newGroup = document.getElementById("edit-member-group").value;

    try {
        await updateDoc(doc(db, "members", memberId), {
            group: newGroup
        });
        memberModal.classList.add("hidden");
    } catch (e) {
        alert("更新失敗：" + e.message);
    }
});

document.getElementById("del-member-btn").addEventListener("click", async () => {
    const memberId = document.getElementById("edit-member-id").value;
    const memberName = document.getElementById("edit-member-name").value;

    if (confirm(`警告：確定要刪除成員「${memberName}」嗎？\n\n注意：這不會刪除他已經被指派的任務紀錄，但之後將無法指派新任務給他。`)) {
        try {
            await deleteDoc(doc(db, "members", memberId));
            memberModal.classList.add("hidden");
        } catch (e) {
            alert("刪除失敗：" + e.message);
        }
    }
});

// --- 10. 看板欄位拖曳功能 (讓卡片可以在 ToDo/Doing/Done 之間移動) ---
const columns = ["todo", "doing", "done"];

columns.forEach(colId => {
    const column = document.getElementById(colId);
    
    // 當卡片拖曳經過欄位上方時
    column.addEventListener("dragover", (e) => {
        e.preventDefault(); // 必須允許放下
        e.dataTransfer.dropEffect = "move"; // 視覺提示
        column.classList.add("bg-gray-200"); // 視覺回饋：變深色
    });

    // 當卡片離開欄位時
    column.addEventListener("dragleave", () => {
        column.classList.remove("bg-gray-200"); // 恢復顏色
    });

    // 當卡片放下 (Drop) 時
    column.addEventListener("drop", async (e) => {
        e.preventDefault();
        column.classList.remove("bg-gray-200");
        
        // 只有 PM 且有拖曳目標時才執行
        if (currentUserRole === 'pm' && draggedTaskId) {
            try {
                await updateDoc(doc(db, "tasks", draggedTaskId), {
                    status: colId, // 將狀態更新為該欄位的 ID (todo, doing, done)
                    lastUpdated: new Date().toISOString()
                });
            } catch (e) {
                alert("移動失敗: " + e.message);
            }
        }
    });
});